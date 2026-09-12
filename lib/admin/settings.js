/* Betriebseinstellungen und Benutzerkonten.

   Alles hier ist der Leitung vorbehalten (OWNER/ADMIN); der Router setzt das
   durch, nicht das Frontend. */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { resetBusinessCache } from '../business.js';
import { hashPassword, passwordProblem, destroySessionsForUser } from '../auth.js';
import { text, email as emailField, integer, oneOf, uuid, ValidationError } from './util.js';
import { mediaUrl, assertMedia, deleteIfUnused } from './media.js';

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function getSettings(req, res) {
  const { rows } = await query(
    `SELECT id, name, timezone, address, phone, email, instagram, hero_media_id,
            slot_step_minutes, lead_time_minutes, max_advance_days
       FROM business ORDER BY created_at LIMIT 1`
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Kein Betrieb angelegt.');
  const b = rows[0];
  json(res, 200, {
    business: {
      id: b.id, name: b.name, timezone: b.timezone, address: b.address, phone: b.phone,
      email: b.email, instagram: b.instagram,
      heroMediaId: b.hero_media_id,
      heroUrl: mediaUrl(b.hero_media_id),
      slotStepMinutes: b.slot_step_minutes,
      leadTimeMinutes: b.lead_time_minutes,
      maxAdvanceDays: b.max_advance_days,
    },
  });
}

export async function updateSettings(req, res, body, user) {
  const sets = [];
  const params = [user.businessId];
  const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.name !== undefined) push('name', text(body.name, { required: true, min: 2, max: 120, field: 'Name' }));
  if (body.address !== undefined) push('address', text(body.address, { max: 200, field: 'Adresse' }) ?? '');
  if (body.phone !== undefined) push('phone', text(body.phone, { max: 40, field: 'Telefon' }) ?? '');
  if (body.email !== undefined) push('email', emailField(body.email, { required: true }));
  if (body.instagram !== undefined) push('instagram', text(body.instagram, { max: 200, field: 'Instagram' }));
  if (body.timezone !== undefined) {
    const tz = text(body.timezone, { required: true, max: 60, field: 'Zeitzone' });
    if (!validTimezone(tz)) throw new ValidationError('invalid_input', 'Diese Zeitzone kennt der Server nicht.');
    push('timezone', tz);
  }
  if (body.slotStepMinutes !== undefined) push('slot_step_minutes', integer(body.slotStepMinutes, { min: 5, max: 120, required: true, field: 'Raster' }));
  if (body.leadTimeMinutes !== undefined) push('lead_time_minutes', integer(body.leadTimeMinutes, { min: 0, max: 10_080, required: true, field: 'Vorlaufzeit' }));
  if (body.maxAdvanceDays !== undefined) push('max_advance_days', integer(body.maxAdvanceDays, { min: 1, max: 365, required: true, field: 'Vorausbuchung' }));

  /* Titelbild der Startseite. Das Bild selbst liegt schon in media (hochgeladen
     über POST /api/admin/media); hier wird nur die Zuordnung gesetzt. */
  let previousHero = null;
  if (body.heroMediaId !== undefined) {
    const heroId = body.heroMediaId === null || body.heroMediaId === ''
      ? null
      : uuid(body.heroMediaId, { field: 'Bild' });
    if (heroId) await assertMedia(user.businessId, heroId);
    const { rows } = await query('SELECT hero_media_id FROM business WHERE id = $1', [user.businessId]);
    previousHero = rows[0]?.hero_media_id ?? null;
    push('hero_media_id', heroId);
  }

  if (!sets.length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');

  await query(`UPDATE business SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  // Ersetztes Titelbild aufräumen, sofern es niemand sonst benutzt.
  if (previousHero) await deleteIfUnused(user.businessId, previousHero);
  // Der Betrieb ist 60 s gecached — nach einer Änderung sofort neu lesen.
  resetBusinessCache();
  return getSettings(req, res);
}

/* --------------------------------------------------------------- Benutzer */

export async function listUsers(req, res, user) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
            e.id AS employee_id, e.name AS employee_name
       FROM app_user u
       LEFT JOIN employee e ON e.user_id = u.id
      WHERE u.business_id = $1
      ORDER BY u.role, u.name`,
    [user.businessId]
  );
  json(res, 200, {
    users: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, role: r.role, status: r.status,
      createdAt: r.created_at,
      employee: r.employee_id ? { id: r.employee_id, name: r.employee_name } : null,
      isSelf: r.id === user.id,
    })),
  });
}

export async function createUser(req, res, body, user) {
  const name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
  const mail = emailField(body.email, { required: true });
  // OWNER wird ausschließlich im Setup vergeben und kann hier nicht entstehen.
  const role = oneOf(body.role, ['ADMIN', 'EMPLOYEE'], { required: true, field: 'Rolle' });
  const problem = passwordProblem(body.password);
  if (problem) return fail(res, 400, 'weak_password', problem);
  const employeeId = body.employeeId ? uuid(body.employeeId, { field: 'Mitarbeiter' }) : null;

  try {
    const { rows } = await query(
      `INSERT INTO app_user (business_id, name, email, password_hash, role, status)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id, name, email, role, status`,
      [user.businessId, name, mail, hashPassword(body.password), role]
    );
    if (employeeId) {
      await query('UPDATE employee SET user_id = $2, updated_at = now() WHERE id = $1 AND business_id = $3',
        [employeeId, rows[0].id, user.businessId]);
    }
    json(res, 201, { user: rows[0] });
  } catch (err) {
    if (err?.code === '23505') {
      return fail(res, 409, 'email_taken', 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
    }
    throw err;
  }
}

export async function updateUser(req, res, body, user, id) {
  uuid(id, { field: 'Benutzer' });

  const { rows: target } = await query(
    'SELECT id, role FROM app_user WHERE id = $1 AND business_id = $2', [id, user.businessId]
  );
  if (!target.length) return fail(res, 404, 'not_found', 'Dieses Konto gibt es nicht.');
  // Der Inhaber bleibt Inhaber: sich selbst oder den OWNER herabzustufen würde
  // den Betrieb aussperren.
  if (target[0].role === 'OWNER' && (body.role !== undefined || body.status !== undefined)) {
    return fail(res, 409, 'owner_protected', 'Das Inhaberkonto lässt sich nicht herabstufen oder sperren.');
  }

  const sets = [];
  const params = [id, user.businessId];
  const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.name !== undefined) push('name', text(body.name, { required: true, min: 2, max: 120, field: 'Name' }));
  if (body.email !== undefined) push('email', emailField(body.email, { required: true }));
  if (body.role !== undefined) push('role', oneOf(body.role, ['ADMIN', 'EMPLOYEE'], { required: true, field: 'Rolle' }));
  if (body.status !== undefined) push('status', oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' }));
  if (body.password !== undefined) {
    const problem = passwordProblem(body.password);
    if (problem) return fail(res, 400, 'weak_password', problem);
    push('password_hash', hashPassword(body.password));
  }
  if (!sets.length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');

  try {
    await query(`UPDATE app_user SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND business_id = $2`, params);
  } catch (err) {
    if (err?.code === '23505') return fail(res, 409, 'email_taken', 'Diese E-Mail-Adresse ist vergeben.');
    throw err;
  }

  // Gesperrt oder neues Passwort: bestehende Sitzungen sind sofort ungültig.
  if (body.status === 'INACTIVE' || body.password !== undefined) await destroySessionsForUser(id);

  if (body.employeeId !== undefined) {
    const employeeId = body.employeeId ? uuid(body.employeeId, { field: 'Mitarbeiter' }) : null;
    await query('UPDATE employee SET user_id = NULL, updated_at = now() WHERE user_id = $1', [id]);
    if (employeeId) {
      await query('UPDATE employee SET user_id = $2, updated_at = now() WHERE id = $1 AND business_id = $3',
        [employeeId, id, user.businessId]);
    }
  }

  return listUsers(req, res, user);
}
