/* Kleine Helfer für die Admin-Endpunkte. Jede Eingabe wird hier serverseitig
   geprüft — die Validierung im Browser ist Bequemlichkeit, kein Schutz. */

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.publicMessage = message;
  }
}

export function text(value, { max = 200, required = false, field = 'Feld', min = 0 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError('invalid_input', `${field} fehlt.`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError('invalid_input', `${field} ist ungültig.`);
  const trimmed = value.replace(CONTROL_CHARS, '').trim();
  if (!trimmed) {
    if (required) throw new ValidationError('invalid_input', `${field} darf nicht leer sein.`);
    return null;
  }
  if (trimmed.length < min) throw new ValidationError('invalid_input', `${field} ist zu kurz.`);
  return trimmed.slice(0, max);
}

export function email(value, { required = false } = {}) {
  const raw = text(value, { max: 200, required, field: 'E-Mail' });
  if (!raw) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) {
    throw new ValidationError('invalid_email', 'Diese E-Mail-Adresse sieht nicht richtig aus.');
  }
  return raw.toLowerCase();
}

export function integer(value, { min = 0, max = 1_000_000, required = false, field = 'Zahl' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('invalid_input', `${field} fehlt.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError('invalid_input', `${field} muss zwischen ${min} und ${max} liegen.`);
  }
  return n;
}

export function uuid(value, { required = true, field = 'Kennung' } = {}) {
  if (!value) {
    if (required) throw new ValidationError('invalid_input', `${field} fehlt.`);
    return null;
  }
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ValidationError('not_found', `${field} ist unbekannt.`);
  }
  return value;
}

export function oneOf(value, allowed, { required = false, field = 'Wert' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('invalid_input', `${field} fehlt.`);
    return null;
  }
  if (!allowed.includes(value)) throw new ValidationError('invalid_input', `${field} ist ungültig.`);
  return value;
}

export function bool(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError('invalid_input', 'Erwartet wurde ja oder nein.');
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function timeOfDay(value, field = 'Uhrzeit') {
  if (typeof value !== 'string') throw new ValidationError('invalid_input', `${field} ist ungültig.`);
  const trimmed = value.trim().slice(0, 5);
  if (!TIME.test(trimmed)) throw new ValidationError('invalid_input', `${field} muss im Format HH:MM stehen.`);
  return trimmed;
}

export function isoDateTime(value, field = 'Zeitpunkt') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError('invalid_input', `${field} ist ungültig.`);
  return date;
}

/** "Herren – Bart" -> "herren-bart". Für Service-Slugs, wenn keiner angegeben ist. */
export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'leistung';
}
