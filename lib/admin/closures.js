/* Feiertage und Schließtage in der Verwaltung.

   GET  /api/admin/closures           Feiertage der nächsten 12 Monate + eigene Schließtage
   POST /api/admin/closures           eigenen Schließtag anlegen { date, label }
   POST /api/admin/closures/holiday   Feiertag geöffnet/geschlossen { key, closed }
   DELETE /api/admin/closures/:id     eigenen Schließtag entfernen */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { getBusiness } from '../business.js';
import { ensureSchema } from '../schema.js';
import { publicHolidaysBetween, HOLIDAY_KEYS } from '../holidays.js';
import { dateInZone, addDays, isValidDateString } from '../time.js';
import { text, uuid, oneOf, bool, ValidationError } from './util.js';

export async function list(req, res, user) {
  await ensureSchema();
  const business = await getBusiness();
  const today = dateInZone(new Date(), business.timezone);

  const [{ rows: settings }, { rows: days }] = await Promise.all([
    query('SELECT open_holidays FROM business WHERE id = $1', [user.businessId]),
    query(
      `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, label FROM closure_day
        WHERE business_id = $1 AND day >= $2::date ORDER BY day`,
      [user.businessId, today]
    ),
  ]);
  const open = new Set(settings[0]?.open_holidays ?? []);

  json(res, 200, {
    today,
    // Genau ein Jahr: jeder Feiertag erscheint einmal, mit seinem nächsten Datum.
    holidays: publicHolidaysBetween(today, addDays(today, 364))
      .map((h) => ({ key: h.key, name: h.name, date: h.date, closed: !open.has(h.key) })),
    closures: days.map((d) => ({ id: d.id, date: d.day, label: d.label })),
  });
}

export async function add(req, res, body, user) {
  await ensureSchema();
  const date = text(body.date, { required: true, max: 10, field: 'Datum' });
  if (!isValidDateString(date)) throw new ValidationError('invalid_date', 'Bitte ein gültiges Datum wählen.');
  const label = text(body.label, { max: 120, field: 'Bezeichnung' });

  try {
    const { rows } = await query(
      `INSERT INTO closure_day (business_id, day, label) VALUES ($1, $2::date, $3)
       RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, label`,
      [user.businessId, date, label]
    );
    // Bestehende Termine werden nicht storniert — der Betrieb entscheidet selbst.
    const { rows: clash } = await query(
      `SELECT count(*)::int AS n FROM booking b JOIN business bz ON bz.id = b.business_id
        WHERE b.business_id = $1 AND b.status IN ('PENDING','CONFIRMED')
          AND (b.start_time AT TIME ZONE bz.timezone)::date = $2::date`,
      [user.businessId, date]
    );
    json(res, 201, {
      closure: { id: rows[0].id, date: rows[0].day, label: rows[0].label },
      conflictingBookings: clash[0].n,
    });
  } catch (err) {
    if (err?.code === '23505') {
      return fail(res, 409, 'closure_exists', 'Für diesen Tag ist schon ein Schließtag eingetragen.');
    }
    throw err;
  }
}

export async function remove(req, res, user, id) {
  await ensureSchema();
  uuid(id, { field: 'Schließtag' });
  const { rowCount } = await query('DELETE FROM closure_day WHERE id = $1 AND business_id = $2', [id, user.businessId]);
  if (!rowCount) return fail(res, 404, 'not_found', 'Diesen Schließtag gibt es nicht.');
  json(res, 200, { ok: true });
}

export async function setHoliday(req, res, body, user) {
  await ensureSchema();
  const key = oneOf(body.key, HOLIDAY_KEYS, { required: true, field: 'Feiertag' });
  const closed = bool(body.closed, true);
  await query(
    closed
      ? `UPDATE business SET open_holidays = array_remove(open_holidays, $2::text), updated_at = now() WHERE id = $1`
      : `UPDATE business SET open_holidays = CASE WHEN $2::text = ANY(open_holidays) THEN open_holidays
                                                ELSE array_append(open_holidays, $2::text) END,
                             updated_at = now()
          WHERE id = $1`,
    [user.businessId, key]
  );
  return list(req, res, user);
}
