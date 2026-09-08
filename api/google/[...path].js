/* Echter Google-OAuth-2.0-Flow (info.md §11, promt.md §7).

     GET /api/google/start     -> Weiterleitung zum Google-Zustimmungsbildschirm
     GET /api/google/callback  <- Google kommt mit ?code= zurück

   Was hier bewusst NICHT passiert: kein eigenes Passwortformular für Google,
   keine Attrappe, kein Token im Frontend. Der Austausch von Code gegen Tokens
   läuft serverseitig, das Ergebnis wird AES-256-GCM-verschlüsselt gespeichert.

   Beide Routen setzen eine Admin-Session voraus. Das Session-Cookie ist
   SameSite=Lax, kommt beim Rücksprung von Google also mit. */
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { getSessionUser, hasRole } from '../../lib/auth.js';
import { oauthClient, saveCredentials, CALENDAR_SCOPES, GoogleUnavailableError } from '../../lib/google.js';
import { fail, methodNotAllowed, serverError } from '../../lib/http.js';

const STATE_COOKIE = 'bb_oauth_state';
/* openid/email nur, um die verbundene Konto-Adresse anzeigen zu können —
   Kalenderrechte kommen aus CALENDAR_SCOPES. */
const SCOPES = [...CALENDAR_SCOPES, 'openid', 'email'];

function stateSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET ist nicht gesetzt');
  return secret;
}

/** state = Zufallswert + HMAC über die Session — CSRF-Schutz für den OAuth-Weg. */
function signState(nonce, sessionId) {
  return crypto.createHmac('sha256', stateSecret()).update(`${nonce}.${sessionId}`).digest('base64url');
}

function cookieOptions(req) {
  const secure = process.env.VERCEL_ENV || process.env.VERCEL ||
    (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
  return secure ? '; Secure' : '';
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function redirect(res, location) {
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.status(302).send('');
}

function step(req) {
  const fromRuntime = req.query?.path;
  if (Array.isArray(fromRuntime)) return fromRuntime[0];
  if (typeof fromRuntime === 'string') return fromRuntime.split('/').filter(Boolean)[0];
  const { pathname } = new URL(req.url, 'http://localhost');
  return pathname.replace(/^\/api\/google\/?/, '').split('/').filter(Boolean)[0];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const action = step(req);
    const user = await getSessionUser(req);
    // Beide Schritte sind Browser-Navigationen: bei fehlender Session geht es
    // zurück auf die Anmeldung statt in eine JSON-Fehlermeldung.
    if (!user || !hasRole(user, 'ADMIN')) {
      return redirect(res, '/admin?next=google');
    }

    if (action === 'start') return startFlow(req, res, user);
    if (action === 'callback') return await finishFlow(req, res, user);
    return fail(res, 404, 'not_found', 'Diesen Endpunkt gibt es nicht.');
  } catch (err) {
    if (err instanceof GoogleUnavailableError) {
      return redirect(res, '/admin/google?error=not_configured');
    }
    return serverError(res, err);
  }
}

function startFlow(req, res, user) {
  const client = oauthClient();
  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = `${nonce}.${signState(nonce, user.sessionId)}`;

  res.setHeader('Set-Cookie',
    `${STATE_COOKIE}=${nonce}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=600${cookieOptions(req)}`);

  /* access_type=offline + prompt=consent: nur so schickt Google zuverlässig ein
     Refresh-Token mit. Ohne das wäre die Verbindung nach einer Stunde tot. */
  redirect(res, client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  }));
}

async function finishFlow(req, res, user) {
  const url = new URL(req.url, 'http://localhost');
  const error = url.searchParams.get('error');
  if (error) {
    // z. B. access_denied, wenn die Zustimmung abgebrochen wurde.
    return redirect(res, `/admin/google?error=${encodeURIComponent(error.slice(0, 40))}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') || '';
  const nonce = readCookie(req, STATE_COOKIE);
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${cookieOptions(req)}`);

  const [statePart, signature] = state.split('.');
  const expected = statePart ? signState(statePart, user.sessionId) : '';
  const signatureOk = Boolean(signature) && signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!code || !nonce || statePart !== nonce || !signatureOk) {
    return redirect(res, '/admin/google?error=state_mismatch');
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  /* Ohne Refresh-Token wäre die Verbindung nur eine Stunde haltbar. Das passiert,
     wenn dieselbe App schon einmal zugestimmt bekam; wir speichern dann nichts
     und schicken die Person mit klarer Meldung noch einmal durch. */
  if (!tokens.refresh_token) {
    return redirect(res, '/admin/google?error=no_refresh_token');
  }

  client.setCredentials(tokens);
  let profile = {};
  try {
    const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    profile = { id: data.id, email: data.email };
  } catch (err) {
    // Die Kalenderrechte sind da; nur der Anzeigename fehlt dann.
    console.error('[google] userinfo', err);
  }

  await saveCredentials(user.businessId, tokens, profile);
  redirect(res, '/admin/google?connected=1');
}
