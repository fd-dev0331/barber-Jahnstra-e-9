/* Authentifizierung und Autorisierung für /admin (info.md §22, promt.md §6).

   Grundregeln, die hier durchgesetzt werden:
   - Passwörter liegen nur als scrypt-Hash in der Datenbank, nie im Klartext.
   - Im Cookie steht ein Zufallstoken, in der Datenbank dessen SHA-256-Hash.
   - Die Rolle kommt IMMER aus der Session-Zeile in der Datenbank. Was das
     Frontend über sich behauptet, wird nirgends geglaubt. */
import crypto from 'node:crypto';
import { query } from './db.js';
import { fail } from './http.js';

const SESSION_COOKIE = 'bb_session';
const CSRF_COOKIE = 'bb_csrf';
const SESSION_DAYS = 7;
/** Nach 12 h ohne Aktivität ist Schluss, auch wenn die Session noch nicht abläuft. */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- Passwörter */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  let actual;
  try {
    actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Mindestanforderung an ein Passwort. Länge schlägt Sonderzeichen. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Das Passwort muss mindestens 10 Zeichen haben.';
  }
  if (password.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

/* ------------------------------------------------------------------- Cookies */

function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  if (process.env.VERCEL_ENV || process.env.VERCEL) return true;
  return (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
}

function setCookie(res, cookie) {
  const previous = res.getHeader('Set-Cookie');
  const list = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

/* SameSite=Lax, nicht Strict: der Google-OAuth-Callback ist eine Top-Level-
   Navigation von accounts.google.com zurück auf unsere Domain. Bei Strict käme
   das Cookie dort nicht mit und der Rückweg wäre nicht authentifiziert. */
function sessionCookie(req, token, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

/* Das CSRF-Cookie ist bewusst NICHT HttpOnly: das Admin-JavaScript muss es lesen
   und als Header zurückschicken (Double-Submit). Es ist kein Geheimnis, das
   allein Zugriff gibt — ohne das HttpOnly-Session-Cookie ist es wertlos. */
function csrfCookie(req, value, maxAgeSeconds) {
  const parts = [`${CSRF_COOKIE}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

/* --------------------------------------------------------------- Sessions */

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

/**
 * In der Telegram Mini App steht die Verwaltung in einem fremden Kontext: auf
 * Telegram Web läuft sie in einem iframe, und ein `SameSite=Lax`-Cookie käme
 * dort nicht mit. Solche Sessions arbeiten deshalb mit einem Bearer-Token im
 * Authorization-Header — dasselbe Token, dieselbe Tabelle, derselbe Ablauf,
 * nur ein anderer Transportweg. Einen Header kann eine fremde Seite nicht
 * ungefragt mitschicken; dieser Weg braucht deshalb kein CSRF-Token.
 */
function bearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]{20,300}=*)$/.exec(header.trim());
  return match ? match[1] : null;
}

/** `cookies: false` gibt das Token nur zurück, statt Cookies zu setzen. */
export async function createSession(req, res, userId, { cookies = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const maxAge = SESSION_DAYS * 24 * 60 * 60;

  await query(
    `INSERT INTO app_session (user_id, token_hash, csrf_token, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [userId, sha256(token), csrf, String(req.headers['user-agent'] || '').slice(0, 300), String(SESSION_DAYS)]
  );

  if (cookies) {
    setCookie(res, sessionCookie(req, token, maxAge));
    setCookie(res, csrfCookie(req, csrf, maxAge));
  }
  return { csrf, token };
}

export async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE] ?? bearerToken(req);
  if (token) await query('DELETE FROM app_session WHERE token_hash = $1', [sha256(token)]).catch(() => {});
  setCookie(res, sessionCookie(req, '', 0));
  setCookie(res, csrfCookie(req, '', 0));
}

/** Alle Sessions eines Benutzers beenden — nach Passwortwechsel oder Sperrung. */
export async function destroySessionsForUser(userId) {
  await query('DELETE FROM app_session WHERE user_id = $1', [userId]);
}

/**
 * Der eingeloggte Benutzer oder null. Rolle und Status kommen frisch aus der
 * Datenbank: ein zwischenzeitlich deaktiviertes Konto verliert sofort Zugriff.
 */
export async function getSessionUser(req) {
  const cookieToken = parseCookies(req)[SESSION_COOKIE];
  const token = cookieToken ?? bearerToken(req);
  if (!token) return null;

  const { rows } = await query(
    `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at,
            u.id, u.business_id, u.name, u.email, u.role, u.status
       FROM app_session s
       JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)]
  );
  if (!rows.length) return null;

  const session = rows[0];
  if (session.status !== 'ACTIVE') {
    await query('DELETE FROM app_session WHERE id = $1', [session.session_id]).catch(() => {});
    return null;
  }
  if (Date.now() - new Date(session.last_seen_at).getTime() > IDLE_TIMEOUT_MS) {
    await query('DELETE FROM app_session WHERE id = $1', [session.session_id]).catch(() => {});
    return null;
  }

  // Nicht bei jedem Request schreiben — einmal pro Minute reicht völlig.
  if (Date.now() - new Date(session.last_seen_at).getTime() > 60_000) {
    await query('UPDATE app_session SET last_seen_at = now() WHERE id = $1', [session.session_id]).catch(() => {});
  }

  return {
    sessionId: session.session_id,
    csrf: session.csrf_token,
    // Bearer-Sessions kommen aus der Mini App; für sie entfällt die
    // CSRF-Prüfung (siehe bearerToken).
    viaBearer: !cookieToken,
    id: session.id,
    businessId: session.business_id,
    name: session.name,
    email: session.email,
    role: session.role,
    status: session.status,
  };
}

/** Abgelaufene Sessions aufräumen (billig, läuft im Setup/Login mit). */
export async function pruneSessions() {
  await query('DELETE FROM app_session WHERE expires_at < now()').catch(() => {});
}

/* ------------------------------------------------------------------- Guards */

const ROLE_RANK = { CLIENT: 0, EMPLOYEE: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(user, minimum) {
  return (ROLE_RANK[user?.role] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}

/**
 * Session prüfen und, bei schreibenden Methoden, das CSRF-Token.
 * Gibt den Benutzer zurück oder null — dann wurde die Antwort bereits gesendet.
 */
export async function requireUser(req, res, { minimum = 'EMPLOYEE' } = {}) {
  const user = await getSessionUser(req);
  if (!user) {
    fail(res, 401, 'unauthorized', 'Bitte melde dich an.');
    return null;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !user.viaBearer) {
    const sent = req.headers['x-csrf-token'];
    if (!sent || sent !== user.csrf) {
      fail(res, 403, 'csrf_failed', 'Die Sitzung ist abgelaufen. Bitte lade die Seite neu.');
      return null;
    }
  }
  if (!hasRole(user, minimum)) {
    fail(res, 403, 'forbidden', 'Dafür fehlt dir die Berechtigung.');
    return null;
  }
  return user;
}

/** Gibt es überhaupt schon einen Inhaber? Entscheidet über den Setup-Flow. */
export async function ownerExists() {
  const { rows } = await query(
    `SELECT 1 FROM app_user WHERE role = 'OWNER' AND status = 'ACTIVE' LIMIT 1`
  );
  return rows.length > 0;
}
