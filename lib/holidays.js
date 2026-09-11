/* Gesetzliche Feiertage in Österreich und Schließtage aus der Verwaltung.

   Feiertage werden berechnet (Ostern nach dem gregorianischen Osteralgorithmus),
   nicht gepflegt. In der Verwaltung lässt sich je Feiertag festlegen, dass der
   Salon trotzdem geöffnet hat (business.open_holidays), und es lassen sich
   eigene Schließtage eintragen (closure_day, z. B. Betriebsurlaub).

   An einem geschlossenen Tag gibt es keine freien Zeiten, und das Backend nimmt
   keine Buchung an — auch nicht, wenn jemand die Buchungsseite umgeht. */
import { query } from './db.js';
import { addDays } from './time.js';
import { ensureSchema } from './schema.js';

const pad = (n) => String(n).padStart(2, '0');

/** Ostersonntag als YYYY-MM-DD (anonymer gregorianischer Algorithmus). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

const fixed = (month, day) => (year) => `${year}-${pad(month)}-${pad(day)}`;
const afterEaster = (days) => (year) => addDays(easterSunday(year), days);

/* Bundesweite gesetzliche Feiertage (Feiertagsruhegesetz). Der Karfreitag ist
   seit 2019 kein allgemeiner Feiertag mehr. */
export const AUSTRIAN_HOLIDAYS = [
  { key: 'neujahr', name: 'Neujahr', date: fixed(1, 1) },
  { key: 'heilige-drei-koenige', name: 'Heilige Drei Könige', date: fixed(1, 6) },
  { key: 'ostermontag', name: 'Ostermontag', date: afterEaster(1) },
  { key: 'staatsfeiertag', name: 'Staatsfeiertag', date: fixed(5, 1) },
  { key: 'christi-himmelfahrt', name: 'Christi Himmelfahrt', date: afterEaster(39) },
  { key: 'pfingstmontag', name: 'Pfingstmontag', date: afterEaster(50) },
  { key: 'fronleichnam', name: 'Fronleichnam', date: afterEaster(60) },
  { key: 'mariae-himmelfahrt', name: 'Mariä Himmelfahrt', date: fixed(8, 15) },
  { key: 'nationalfeiertag', name: 'Nationalfeiertag', date: fixed(10, 26) },
  { key: 'allerheiligen', name: 'Allerheiligen', date: fixed(11, 1) },
  { key: 'mariae-empfaengnis', name: 'Mariä Empfängnis', date: fixed(12, 8) },
  { key: 'christtag', name: 'Christtag', date: fixed(12, 25) },
  { key: 'stefanitag', name: 'Stefanitag', date: fixed(12, 26) },
];

export const HOLIDAY_KEYS = AUSTRIAN_HOLIDAYS.map((h) => h.key);

export const publicHolidays = (year) =>
  AUSTRIAN_HOLIDAYS.map((h) => ({ key: h.key, name: h.name, date: h.date(year) }));

/** Feiertage zwischen from und to (YYYY-MM-DD, jeweils einschließlich). */
export function publicHolidaysBetween(from, to) {
  const out = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    for (const holiday of publicHolidays(year)) {
      if (holiday.date >= from && holiday.date <= to) out.push(holiday);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Geschlossene Tage im Zeitraum als Map<YYYY-MM-DD, { type, key?, name }>:
 * Feiertage (außer den als geöffnet markierten) und eigene Schließtage.
 */
export async function closuresBetween(businessId, from, to) {
  await ensureSchema();
  const [{ rows: business }, { rows: days }] = await Promise.all([
    query('SELECT open_holidays FROM business WHERE id = $1', [businessId]),
    query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, label FROM closure_day
        WHERE business_id = $1 AND day BETWEEN $2::date AND $3::date`,
      [businessId, from, to]
    ),
  ]);
  const open = new Set(business[0]?.open_holidays ?? []);
  const closed = new Map();
  for (const holiday of publicHolidaysBetween(from, to)) {
    if (!open.has(holiday.key)) closed.set(holiday.date, { type: 'holiday', key: holiday.key, name: holiday.name });
  }
  // Ein eigener Schließtag am selben Datum gewinnt — er trägt den Text der Verwaltung.
  for (const day of days) closed.set(day.day, { type: 'closure', name: day.label || 'Geschlossen' });
  return closed;
}

export async function closureOn(businessId, date) {
  return (await closuresBetween(businessId, date, date)).get(date) ?? null;
}
