/* Antwort-Helfer für die API. Interne Fehlerdetails erreichen den Client nie
   (info.md §35) — sie landen ausschließlich im Server-Log. */

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  json(res, 405, { error: 'method_not_allowed', message: 'Methode nicht erlaubt.' });
}

/** Öffentliche Fehlermeldung + interne Protokollierung. */
export function fail(res, status, code, message, internal) {
  if (internal) console.error(`[api:${code}]`, internal);
  json(res, status, { error: code, message });
}

const GENERIC =
  'Das hat gerade nicht funktioniert. Bitte versuch es noch einmal oder ruf uns an: 0681 20397906.';

export function serverError(res, internal) {
  return fail(res, 500, 'server_error', GENERIC, internal);
}

/** Einfache Ratenbegrenzung pro Instanz. Ersetzt keinen echten Gateway-Schutz,
    bremst aber Skript-Spam auf den Schreib-Endpunkten. */
const hits = new Map();
export function rateLimit(req, res, { limit = 10, windowMs = 60_000, key = 'default' } = {}) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const id = `${key}:${ip}`;
  const now = Date.now();
  const entry = hits.get(id);
  if (!entry || now > entry.reset) {
    hits.set(id, { count: 1, reset: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    fail(res, 429, 'rate_limited', 'Zu viele Anfragen. Bitte versuch es gleich noch einmal.');
    return false;
  }
  entry.count += 1;
  return true;
}

/** Body als Objekt, unabhängig davon ob die Runtime schon geparst hat. */
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_000) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
