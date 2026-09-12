/* Telegram-Bot und Mini App.

   Die Verwaltung läuft unverändert im Browser; in Telegram wird dieselbe
   Oberfläche als Mini App geöffnet. Telegram schickt dabei `initData` mit —
   eine signierte Zeichenkette, die belegt, WER die App geöffnet hat.

   Vertrauen entsteht ausschließlich hier: die Signatur wird mit dem Bot-Token
   nachgerechnet (Telegram: „Validating data received via the Mini App"). Was
   das Frontend über sich behauptet, wird nirgends geglaubt — genauso wie bei
   Passwort-Sessions (lib/auth.js).

   Ohne TELEGRAM_BOT_TOKEN ist die ganze Anbindung aus: die Endpunkte antworten
   dann mit 503, und in der Verwaltung erscheint der Bereich als „nicht
   eingerichtet". Die Website und der normale Login sind davon nicht berührt. */
import crypto from 'node:crypto';

/** 24 h: so lange gilt ein `initData` aus einem Mini-App-Start als frisch. */
const MAX_AGE_SECONDS = 24 * 60 * 60;
/** Mehr als das schickt Telegram nie; alles Längere ist Unsinn oder Angriff. */
const MAX_INIT_DATA = 4096;

export const botToken = () => (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
export const isConfigured = () => botToken().length > 0;

/** Basis-URL der Mini App. Auf Vercel steht VERCEL_URL ohne Schema bereit. */
export function baseUrl() {
  const configured = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const vercel = (process.env.VERCEL_URL ?? '').trim();
  return vercel ? `https://${vercel}` : '';
}

/**
 * Signatur von `initData` prüfen.
 *
 * Rechenweg (Telegram Bot API):
 *   secret = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash   = HMAC_SHA256(key = secret, data = "k=v\n…" alphabetisch, ohne hash)
 *
 * Zusätzlich zählt `auth_date`: ein abgefangenes initData soll nicht ewig als
 * Eintrittskarte taugen.
 */
export function verifyInitData(initData, { maxAgeSeconds = MAX_AGE_SECONDS } = {}) {
  const token = botToken();
  if (!token) return { ok: false, error: 'telegram_disabled' };
  if (typeof initData !== 'string' || !initData || initData.length > MAX_INIT_DATA) {
    return { ok: false, error: 'telegram_invalid' };
  }

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: 'telegram_invalid' };
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, error: 'telegram_invalid' };
  /* Nur `hash` fällt heraus. `signature` bleibt drin: es wird erst bei der
     Drittanbieter-Prüfung (Ed25519) ausgenommen, nicht bei dieser mit dem
     Bot-Token. Seit Bot API 8.0 schickt Telegram das Feld immer mit — wer es
     hier entfernt, weist jeden echten Start ab. */
  params.delete('hash');

  const checkString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, error: 'telegram_invalid' };
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, error: 'telegram_expired' };
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    user = null;
  }
  // Ein Kanal- oder Gruppenstart hat keinen `user` — damit lässt sich kein
  // Konto zuordnen, also gilt er als ungültig.
  if (!user || !Number.isInteger(user.id)) return { ok: false, error: 'telegram_invalid' };

  return {
    ok: true,
    authDate,
    user: {
      id: user.id,
      firstName: String(user.first_name ?? '').slice(0, 120),
      lastName: String(user.last_name ?? '').slice(0, 120),
      username: String(user.username ?? '').slice(0, 120),
      languageCode: String(user.language_code ?? '').slice(0, 12).toLowerCase(),
    },
  };
}

/** Anzeigename eines Telegram-Kontos: Vor-/Nachname, sonst @username. */
export function displayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return user.username ? `@${user.username}` : `ID ${user.id}`;
}

/* ------------------------------------------------------------- Bot-API */

export class TelegramError extends Error {
  constructor(method, description) {
    super(`${method}: ${description}`);
    this.method = method;
  }
}

/** Aufruf der Bot-API. Wirft nur bei echten Fehlern, nie mit Token im Text. */
export async function callApi(method, payload = {}, { token = botToken() } = {}) {
  if (!token) throw new TelegramError(method, 'kein Bot-Token gesetzt');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!data?.ok) throw new TelegramError(method, data?.description ?? `HTTP ${response.status}`);
  return data.result;
}

/* Der Bot-Name ändert sich praktisch nie; einmal pro Instanz reicht. */
let botInfo = null;
export async function getBot() {
  if (!isConfigured()) return null;
  if (botInfo) return botInfo;
  const me = await callApi('getMe');
  botInfo = { id: me.id, username: me.username, name: me.first_name };
  return botInfo;
}
