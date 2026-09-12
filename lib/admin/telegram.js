/* Anmeldung und Kontoverknüpfung für die Telegram Mini App.

   Ablauf, einmal pro Person:
     1. Die Mini App wird im Bot geöffnet und schickt ihr signiertes `initData`.
     2. Ist dieses Telegram-Konto noch mit keinem Zugang verknüpft, antwortet
        der Server mit 403 `telegram_not_linked`. Die App fragt dann einmalig
        E-Mail und Passwort ab — dieselben Zugangsdaten wie im Browser.
     3. Stimmen sie, wird das Telegram-Konto verknüpft und eine Session erzeugt.
     4. Jeder weitere Start braucht nur noch `initData`.

   Ein Telegram-Konto allein ist also nie ein Zugang: ohne Passwort entsteht
   keine Verknüpfung, und ohne Verknüpfung gibt es keine Session. Gesperrte
   Konten (status != ACTIVE) kommen auch mit Verknüpfung nicht herein. */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { verifyPassword, createSession, pruneSessions, hasRole } from '../auth.js';
import { verifyInitData, isConfigured, getBot, displayName } from '../telegram.js';
import { sessionPayload } from './account.js';
import { email as emailField, uuid, ValidationError } from './util.js';

/* Damit sich an der Antwortzeit nicht ablesen lässt, ob es ein Konto gibt,
   wird auch ohne Treffer gehasht — wie in account.login(). */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';

function checkedUser(res, initData) {
  if (!isConfigured()) {
    fail(res, 503, 'telegram_disabled', 'Die Telegram-Anbindung ist für diesen Betrieb nicht eingerichtet.');
    return null;
  }
  const result = verifyInitData(initData);
  if (!result.ok) {
    const message = result.error === 'telegram_expired'
      ? 'Der Telegram-Start ist abgelaufen. Bitte öffne die Verwaltung im Bot noch einmal.'
      : 'Diese Telegram-Anfrage konnte nicht überprüft werden.';
    fail(res, 401, result.error, message);
    return null;
  }
  return result.user;
}

/** Session erzeugen und die Antwort schicken, die jede Admin-Seite erwartet. */
async function respondWithSession(req, res, row, status = 200) {
  const { csrf, token } = await createSession(req, res, row.id, { cookies: false });
  const user = {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    email: row.email,
    role: row.role,
    csrf,
  };
  json(res, status, { ...(await sessionPayload(user)), token });
}

/* --------------------------------------------------------------- Anmeldung */

/** POST /api/admin/session/telegram — Start der Mini App. */
export async function signIn(req, res, body) {
  const telegramUser = checkedUser(res, body.initData);
  if (!telegramUser) return;

  await pruneSessions();

  const { rows } = await query(
    `SELECT u.id, u.business_id, u.name, u.email, u.role, u.status, t.id AS link_id
       FROM telegram_account t
       JOIN app_user u ON u.id = t.user_id
      WHERE t.telegram_id = $1`,
    [telegramUser.id]
  );
  const found = rows[0];

  if (!found) {
    return fail(res, 403, 'telegram_not_linked',
      'Dieses Telegram-Konto ist noch mit keinem Zugang verknüpft.');
  }
  if (found.status !== 'ACTIVE' || !hasRole(found, 'EMPLOYEE')) {
    return fail(res, 403, 'forbidden', 'Dieser Zugang ist gesperrt.');
  }

  await query(
    `UPDATE telegram_account
        SET last_seen_at = now(), username = $2, first_name = $3, last_name = $4, language_code = $5
      WHERE id = $1`,
    [found.link_id, telegramUser.username || null, telegramUser.firstName || null,
      telegramUser.lastName || null, telegramUser.languageCode || null]
  );

  return respondWithSession(req, res, found);
}

/** POST /api/admin/session/telegram/link — einmalige Verknüpfung mit Passwort. */
export async function link(req, res, body) {
  const telegramUser = checkedUser(res, body.initData);
  if (!telegramUser) return;

  await pruneSessions();

  const mail = emailField(body.email, { required: true });
  if (typeof body.password !== 'string' || !body.password) {
    return fail(res, 401, 'invalid_credentials', 'E-Mail-Adresse oder Passwort stimmt nicht.');
  }

  const { rows } = await query(
    `SELECT id, business_id, name, email, password_hash, role, status
       FROM app_user WHERE lower(email) = lower($1) LIMIT 1`,
    [mail]
  );
  const found = rows[0];
  const ok = verifyPassword(body.password, found?.password_hash ?? DUMMY_HASH);

  if (!found || !ok || found.status !== 'ACTIVE' || !hasRole(found, 'EMPLOYEE')) {
    return fail(res, 401, 'invalid_credentials', 'E-Mail-Adresse oder Passwort stimmt nicht.');
  }

  /* Ein Telegram-Konto gehört zu genau einem Zugang. Meldet sich jemand mit
     anderen Zugangsdaten an, wandert die Verknüpfung mit — belegt ist sie durch
     das Passwort, das dabei eingegeben wurde. */
  await query(
    `INSERT INTO telegram_account
       (business_id, user_id, telegram_id, username, first_name, last_name, language_code, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (telegram_id) DO UPDATE
        SET business_id = EXCLUDED.business_id, user_id = EXCLUDED.user_id,
            username = EXCLUDED.username, first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name, language_code = EXCLUDED.language_code,
            linked_at = now(), last_seen_at = now()`,
    [found.business_id, found.id, telegramUser.id, telegramUser.username || null,
      telegramUser.firstName || null, telegramUser.lastName || null, telegramUser.languageCode || null]
  );

  return respondWithSession(req, res, found, 201);
}

/* ------------------------------------------------------------- Verwaltung */

function shape(row, currentUserId) {
  return {
    id: row.id,
    name: displayName({
      id: row.telegram_id,
      firstName: row.first_name ?? '',
      lastName: row.last_name ?? '',
      username: row.username ?? '',
    }),
    username: row.username ?? null,
    account: { id: row.user_id, name: row.user_name, email: row.user_email, role: row.user_role },
    isSelf: row.user_id === currentUserId,
    linkedAt: row.linked_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * GET /api/admin/telegram — Zustand der Anbindung.
 * Der Inhaber sieht alle Verknüpfungen des Betriebs, alle anderen nur ihre eigene.
 */
export async function status(req, res, user) {
  const all = hasRole(user, 'OWNER');
  const { rows } = await query(
    `SELECT t.id, t.telegram_id, t.username, t.first_name, t.last_name, t.linked_at, t.last_seen_at,
            t.user_id, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM telegram_account t
       JOIN app_user u ON u.id = t.user_id
      WHERE t.business_id = $1 ${all ? '' : 'AND t.user_id = $2'}
      ORDER BY t.linked_at DESC`,
    all ? [user.businessId] : [user.businessId, user.id]
  );

  const bot = { configured: isConfigured(), username: null, reachable: isConfigured() };
  if (bot.configured) {
    try {
      const info = await getBot();
      bot.username = info?.username ?? null;
    } catch (err) {
      // Der Bot-Name ist Beiwerk; die Liste soll trotzdem erscheinen.
      console.error('[telegram:getMe]', err?.message ?? err);
      bot.reachable = false;
    }
  }

  json(res, 200, { bot, accounts: rows.map((row) => shape(row, user.id)) });
}

/** DELETE /api/admin/telegram/:id — Verknüpfung lösen. */
export async function unlink(req, res, user, rawId) {
  const id = uuid(rawId, { field: 'Verknüpfung' });
  const own = hasRole(user, 'OWNER') ? '' : 'AND user_id = $3';
  const params = hasRole(user, 'OWNER') ? [id, user.businessId] : [id, user.businessId, user.id];
  const { rowCount } = await query(
    `DELETE FROM telegram_account WHERE id = $1 AND business_id = $2 ${own}`,
    params
  );
  if (!rowCount) return fail(res, 404, 'not_found', 'Diese Verknüpfung wurde nicht gefunden.');
  json(res, 200, { ok: true });
}

export { ValidationError };
