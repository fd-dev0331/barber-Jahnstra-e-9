/* Setup, Login, Logout, eigenes Profil (promt.md §4–§6).

   Der Setup-Flow ist die einzige Stelle, an der ein OWNER entsteht, und er ist
   genau einmal offen: sobald ein aktiver OWNER existiert, antwortet er mit 409.
   Zusätzlich verhindert ein partieller Unique-Index in der Datenbank einen
   zweiten aktiven OWNER, auch bei zwei gleichzeitigen Anfragen. */
import { query, withTransaction } from '../db.js';
import { json, fail } from '../http.js';
import {
  hashPassword, verifyPassword, passwordProblem, createSession, destroySession,
  destroySessionsForUser, ownerExists, pruneSessions, getSessionUser,
} from '../auth.js';
import { text, email as emailField, ValidationError } from './util.js';

/** Öffentliche Antwort für /admin: Muss zuerst ein Inhaber angelegt werden? */
export async function getSetupState(req, res) {
  const needsSetup = !(await ownerExists());
  json(res, 200, { needsSetup });
}

export async function runSetup(req, res, body) {
  await pruneSessions();

  if (await ownerExists()) {
    return fail(res, 409, 'setup_done',
      'Für diesen Betrieb gibt es bereits einen Inhaber. Bitte melde dich an.');
  }

  const businessName = text(body.businessName, { required: true, max: 120, min: 2, field: 'Name des Betriebs' });
  const ownerName = text(body.ownerName, { required: true, max: 120, min: 2, field: 'Dein Name' });
  const mail = emailField(body.email, { required: true });
  const problem = passwordProblem(body.password);
  if (problem) return fail(res, 400, 'weak_password', problem);

  const passwordHash = hashPassword(body.password);

  let user;
  try {
    user = await withTransaction(async (client) => {
      // Der Seed hat den Betrieb meist schon angelegt; dann wird er verwendet
      // und nur umbenannt, statt einen zweiten Betrieb danebenzustellen.
      const { rows: existing } = await client.query('SELECT id FROM business ORDER BY created_at LIMIT 1');
      let businessId = existing[0]?.id;

      if (businessId) {
        await client.query('UPDATE business SET name = $2, updated_at = now() WHERE id = $1',
          [businessId, businessName]);
      } else {
        const { rows } = await client.query(
          `INSERT INTO business (name, timezone, address, phone, email)
           VALUES ($1, 'Europe/Vienna', '', '', $2) RETURNING id`,
          [businessName, mail]
        );
        businessId = rows[0].id;
      }

      const { rows } = await client.query(
        `INSERT INTO app_user (business_id, name, email, password_hash, role, status)
         VALUES ($1, $2, $3, $4, 'OWNER', 'ACTIVE')
         RETURNING id, business_id, name, email, role, status`,
        [businessId, ownerName, mail, passwordHash]
      );
      return rows[0];
    });
  } catch (err) {
    // 23505 = der Unique-Index hat zugeschlagen: entweder E-Mail doppelt oder
    // jemand war beim zweiten OWNER eine Millisekunde schneller.
    if (err?.code === '23505') {
      return fail(res, 409, 'setup_done',
        'Dieser Betrieb hat bereits einen Inhaber oder die E-Mail-Adresse ist vergeben.');
    }
    throw err;
  }

  await createSession(req, res, user.id);
  json(res, 201, { user: publicUser(user) });
}

export async function login(req, res, body) {
  await pruneSessions();

  const mail = emailField(body.email, { required: true });
  if (typeof body.password !== 'string' || !body.password) {
    return fail(res, 400, 'invalid_credentials', 'E-Mail-Adresse oder Passwort stimmt nicht.');
  }

  const { rows } = await query(
    `SELECT id, business_id, name, email, password_hash, role, status
       FROM app_user WHERE lower(email) = lower($1) LIMIT 1`,
    [mail]
  );
  const found = rows[0];

  /* Immer dieselbe Meldung und immer dieselbe Arbeit: ob es das Konto gibt,
     darf sich weder am Text noch an der Antwortzeit ablesen lassen. */
  const stored = found?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const ok = verifyPassword(body.password, stored);

  if (!found || !ok || found.status !== 'ACTIVE' || found.role === 'CLIENT') {
    return fail(res, 401, 'invalid_credentials', 'E-Mail-Adresse oder Passwort stimmt nicht.');
  }

  await createSession(req, res, found.id);
  json(res, 200, { user: publicUser(found) });
}

export async function logout(req, res) {
  await destroySession(req, res);
  json(res, 200, { ok: true });
}

export async function me(req, res) {
  const user = await getSessionUser(req);
  if (!user) return fail(res, 401, 'unauthorized', 'Bitte melde dich an.');
  // Zeitzone gleich mitgeben: jede Admin-Seite formatiert Zeiten damit und soll
  // dafür keinen zweiten Aufruf brauchen (info.md §23).
  const [{ rows }, { rows: linked }] = await Promise.all([
    query('SELECT name, timezone FROM business WHERE id = $1', [user.businessId]),
    // Mit welchem Mitarbeiter ist das Konto verknüpft? Ein EMPLOYEE darf nur für
    // sich selbst eintragen — die Oberfläche wählt ihn damit gleich vor. Geprüft
    // wird das weiterhin in bookings.create().
    query('SELECT id, name, status FROM employee WHERE user_id = $1 AND business_id = $2 LIMIT 1',
      [user.id, user.businessId]),
  ]);
  json(res, 200, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    business: { name: rows[0]?.name ?? '', timezone: rows[0]?.timezone ?? 'Europe/Vienna' },
    employee: linked[0] ? { id: linked[0].id, name: linked[0].name, status: linked[0].status } : null,
    csrfToken: user.csrf,
  });
}

/** Passwortwechsel: das alte Passwort ist Pflicht, danach fliegen alle Sessions. */
export async function changePassword(req, res, body, user) {
  const problem = passwordProblem(body.newPassword);
  if (problem) return fail(res, 400, 'weak_password', problem);

  const { rows } = await query('SELECT password_hash FROM app_user WHERE id = $1', [user.id]);
  if (!verifyPassword(String(body.currentPassword ?? ''), rows[0]?.password_hash)) {
    return fail(res, 403, 'invalid_credentials', 'Das aktuelle Passwort stimmt nicht.');
  }

  await query('UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1',
    [user.id, hashPassword(body.newPassword)]);
  await destroySessionsForUser(user.id);
  await createSession(req, res, user.id);
  json(res, 200, { ok: true });
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export { ValidationError };
