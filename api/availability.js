/* GET /api/availability?date=&serviceId=&employeeId= */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { getAvailability, findNextAvailableDate } from '../lib/availability.js';
import { isValidDateString, addDays, dateInZone } from '../lib/time.js';
import { json, methodNotAllowed, fail, serverError } from '../lib/http.js';
import { GoogleUnavailableError } from '../lib/google.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const business = await getBusiness();
    const url = new URL(req.url, 'http://localhost');
    const date = url.searchParams.get('date');
    const serviceId = url.searchParams.get('serviceId');
    const employeeId = url.searchParams.get('employeeId');

    if (!isValidDateString(date)) {
      return fail(res, 400, 'invalid_date', 'Bitte wähle ein gültiges Datum.');
    }
    const today = dateInZone(new Date(), business.timezone);
    if (date < today || date > addDays(today, business.max_advance_days)) {
      return fail(res, 400, 'date_out_of_range',
        `Termine sind nur bis ${business.max_advance_days} Tage im Voraus buchbar.`);
    }

    const [{ rows: services }, { rows: employees }] = await Promise.all([
      query(`SELECT id, duration_minutes FROM service WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
        [serviceId, business.id]),
      query(`SELECT id, google_calendar_id FROM employee WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
        [employeeId, business.id]),
    ]);

    if (!services.length) return fail(res, 404, 'service_not_found', 'Diese Leistung ist nicht mehr buchbar.');
    if (!employees.length) return fail(res, 404, 'employee_not_found', 'Diese Person ist nicht mehr buchbar.');

    const { slots, closed } = await getAvailability({
      business, employee: employees[0], service: services[0], date,
    });

    const anyFree = slots.some((s) => s.available);
    const nextAvailableDate = anyFree
      ? null
      : await findNextAvailableDate({ business, employee: employees[0], service: services[0], fromDate: date });

    json(res, 200, { date, timezone: business.timezone, closed, slots, nextAvailableDate });
  } catch (err) {
    if (err instanceof GoogleUnavailableError) {
      // Lieber gar keine Zeiten als falsche: belegte Zeiten als frei anzuzeigen
      // führt zu Doppelbuchungen (info.md §32).
      return fail(res, 503, 'calendar_unavailable',
        'Die Terminverfügbarkeit ist gerade nicht abrufbar. Bitte versuch es gleich noch einmal oder ruf uns an: 0681 20397906.',
        err);
    }
    serverError(res, err);
  }
}
