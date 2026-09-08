/* Termine im Admin: Liste, manuelle Buchung, Statuswechsel (info.md §18, §21).

   Manuelle Buchungen laufen durch dieselbe Prüfung und denselben Kalender wie
   Buchungen von der Website — es gibt hier keinen zweiten, laxeren Weg in die
   Datenbank (info.md §18). */
import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { json, fail } from '../http.js';
import { getBusiness } from '../business.js';
import { assertSlotFree } from '../availability.js';
import { isGoogleConnected, createEvent, deleteEvent, GoogleUnavailableError } from '../google.js';
import { text, uuid, oneOf, isoDateTime, bool, ValidationError } from './util.js';
import { isValidDateString, addDays } from '../time.js';

const STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

function reference() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

function shape(row) {
  return {
    id: row.id,
    reference: row.reference,
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    source: row.source,
    customer: { name: row.customer_name, phone: row.customer_phone, email: row.customer_email },
    note: row.note,
    service: { id: row.service_id, name: row.service_name, durationMinutes: row.duration_minutes },
    employee: { id: row.employee_id, name: row.employee_name },
    inCalendar: Boolean(row.google_event_id),
    createdAt: row.created_at,
  };
}

const SELECT = `
  SELECT b.id, b.reference, b.start_time, b.end_time, b.status, b.source, b.note,
         b.customer_name, b.customer_phone, b.customer_email, b.google_event_id, b.created_at,
         s.id AS service_id, s.name AS service_name, s.duration_minutes,
         e.id AS employee_id, e.name AS employee_name
    FROM booking b
    JOIN service s  ON s.id = b.service_id
    JOIN employee e ON e.id = b.employee_id
   WHERE b.business_id = $1`;

export async function list(req, res, user, params) {
  const business = await getBusiness();
  const filters = [];
  const values = [business.id];

  const from = params.get('from');
  const to = params.get('to');
  if (from) {
    if (!isValidDateString(from)) throw new ValidationError('invalid_input', 'Das Von-Datum ist ungültig.');
    values.push(from);
    filters.push(`b.start_time >= ($${values.length}::date AT TIME ZONE $${values.length + 1})`);
    values.push(business.timezone);
  }
  if (to) {
    if (!isValidDateString(to)) throw new ValidationError('invalid_input', 'Das Bis-Datum ist ungültig.');
    values.push(addDays(to, 1));
    filters.push(`b.start_time < ($${values.length}::date AT TIME ZONE $${values.length + 1})`);
    values.push(business.timezone);
  }
  const status = params.get('status');
  if (status) {
    values.push(oneOf(status, STATUSES, { required: true, field: 'Status' }));
    filters.push(`b.status = $${values.length}`);
  }
  const employeeId = params.get('employeeId');
  if (employeeId) {
    values.push(uuid(employeeId, { field: 'Mitarbeiter' }));
    filters.push(`b.employee_id = $${values.length}`);
  }
  const search = text(params.get('q'), { max: 60, field: 'Suche' });
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(b.customer_name ILIKE $${values.length} OR b.customer_phone ILIKE $${values.length} OR b.reference ILIKE $${values.length})`);
  }

  /* Ein Mitarbeiter sieht nur die eigenen Termine. Diese Einschränkung steht
     bewusst hier im Backend und nicht als Filter im Frontend (info.md §22). */
  if (user.role === 'EMPLOYEE') {
    values.push(user.id);
    filters.push(`b.employee_id IN (SELECT id FROM employee WHERE user_id = $${values.length})`);
  }

  const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const { rows } = await query(`${SELECT}${where} ORDER BY b.start_time DESC LIMIT 500`, values);
  json(res, 200, { bookings: rows.map(shape), timezone: business.timezone });
}

/** Zahlen für das Dashboard (info.md §20). */
export async function overview(req, res, user) {
  const business = await getBusiness();
  const [{ rows: counts }, { rows: today }, { rows: upcoming }, { rows: integration }] = await Promise.all([
    query(
      `SELECT (SELECT count(*) FROM employee WHERE business_id = $1 AND status = 'ACTIVE')::int AS employees,
              (SELECT count(*) FROM service  WHERE business_id = $1 AND status = 'ACTIVE')::int AS services,
              (SELECT count(*) FROM booking  WHERE business_id = $1 AND status IN ('PENDING','CONFIRMED')
                 AND start_time >= now())::int AS upcoming_bookings`,
      [business.id]
    ),
    query(
      `${SELECT} AND b.status IN ('PENDING','CONFIRMED')
         AND (b.start_time AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
       ORDER BY b.start_time`,
      [business.id, business.timezone]
    ),
    query(
      `${SELECT} AND b.status IN ('PENDING','CONFIRMED') AND b.start_time > now()
       ORDER BY b.start_time LIMIT 10`,
      [business.id]
    ),
    query(
      `SELECT google_account_email, status, connected_at, last_error
         FROM google_integration WHERE business_id = $1`,
      [business.id]
    ),
  ]);

  json(res, 200, {
    business: { id: business.id, name: business.name, timezone: business.timezone },
    counts: counts[0],
    today: today.map(shape),
    upcoming: upcoming.map(shape),
    google: integration[0]
      ? {
        connected: integration[0].status === 'ACTIVE',
        email: integration[0].google_account_email,
        connectedAt: integration[0].connected_at,
        lastError: integration[0].last_error,
      }
      : { connected: false },
    // Ohne diese beiden ist die Buchungsseite leer — das Dashboard sagt es direkt.
    setupHints: {
      needsEmployee: counts[0].employees === 0,
      needsService: counts[0].services === 0,
    },
  });
}

export async function create(req, res, body, user) {
  const business = await getBusiness();

  const customerName = text(body.customerName, { required: true, min: 2, max: 120, field: 'Name' });
  const customerPhone = text(body.customerPhone, { required: true, max: 40, field: 'Telefonnummer' });
  const customerEmail = text(body.customerEmail, { max: 200, field: 'E-Mail' });
  const note = text(body.note, { max: 500, field: 'Anmerkung' });
  const start = isoDateTime(body.start, 'Beginn');
  const serviceId = uuid(body.serviceId, { field: 'Leistung' });
  const employeeId = uuid(body.employeeId, { field: 'Mitarbeiter' });

  /* Außerhalb der Arbeitszeit buchen darf nur die Leitung — der Doppelbuchungs-
     schutz gilt trotzdem, den kann hier niemand abschalten. */
  const outsideHours = bool(body.allowOutsideHours, false) && user.role !== 'EMPLOYEE';

  const [{ rows: services }, { rows: employees }] = await Promise.all([
    query(`SELECT id, name, duration_minutes FROM service
            WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [serviceId, business.id]),
    query(`SELECT id, name, google_calendar_id, user_id FROM employee
            WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [employeeId, business.id]),
  ]);
  if (!services.length) return fail(res, 404, 'service_not_found', 'Diese Leistung ist nicht aktiv.');
  if (!employees.length) return fail(res, 404, 'employee_not_found', 'Diese Person ist nicht aktiv.');

  const service = services[0];
  const employee = employees[0];
  if (user.role === 'EMPLOYEE' && employee.user_id !== user.id) {
    return fail(res, 403, 'forbidden', 'Du kannst nur Termine für dich selbst eintragen.');
  }

  const end = new Date(start.getTime() + service.duration_minutes * 60_000);
  const ref = reference();
  let googleEventId = null;

  try {
    const booking = await withTransaction(async (client) => {
      await client.query('SELECT id FROM employee WHERE id = $1 FOR UPDATE', [employee.id]);

      const free = await assertSlotFree({
        client, business, employee, service, start, end, ignoreWorkingHours: outsideHours,
      });
      if (!free) {
        const conflict = new Error('slot_taken');
        conflict.code = 'SLOT_TAKEN';
        throw conflict;
      }

      if ((await isGoogleConnected(business.id)) && employee.google_calendar_id) {
        googleEventId = await createEvent({
          businessId: business.id,
          calendarId: employee.google_calendar_id,
          timezone: business.timezone,
          booking: {
            serviceName: service.name, customerName, customerPhone, customerEmail, note,
            reference: ref, source: 'MANUAL', start, end,
          },
        });
      }

      const { rows } = await client.query(
        `INSERT INTO booking
           (business_id, employee_id, service_id, reference, customer_name, customer_email,
            customer_phone, note, start_time, end_time, status, source, google_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED','MANUAL',$11)
         RETURNING id`,
        [business.id, employee.id, service.id, ref, customerName, customerEmail,
         customerPhone, note, start, end, googleEventId]
      );
      return rows[0].id;
    });

    const { rows } = await query(`${SELECT} AND b.id = $2`, [business.id, booking]);
    json(res, 201, { booking: shape(rows[0]) });
  } catch (err) {
    if (err?.code === 'SLOT_TAKEN' || err?.code === '23P01') {
      return fail(res, 409, 'slot_taken',
        outsideHours
          ? 'In dieser Zeit liegt bereits ein Termin.'
          : 'Diese Zeit ist belegt oder liegt außerhalb der Arbeitszeit.');
    }
    throw err;
  }
}

/** Statuswechsel. Beim Stornieren verschwindet auch der Kalendereintrag. */
export async function update(req, res, body, user, id) {
  uuid(id, { field: 'Termin' });
  const business = await getBusiness();
  const status = oneOf(body.status, STATUSES, { required: true, field: 'Status' });

  const { rows } = await query(
    `SELECT b.id, b.status, b.google_event_id, e.google_calendar_id, e.user_id
       FROM booking b JOIN employee e ON e.id = b.employee_id
      WHERE b.id = $1 AND b.business_id = $2`,
    [id, business.id]
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Diesen Termin gibt es nicht.');
  const booking = rows[0];
  if (user.role === 'EMPLOYEE' && booking.user_id !== user.id) {
    return fail(res, 403, 'forbidden', 'Du kannst nur eigene Termine ändern.');
  }

  const releasing = status === 'CANCELLED' && booking.status !== 'CANCELLED';
  if (releasing && booking.google_event_id && booking.google_calendar_id) {
    try {
      await deleteEvent({
        businessId: business.id,
        calendarId: booking.google_calendar_id,
        eventId: booking.google_event_id,
      });
    } catch (err) {
      if (!(err instanceof GoogleUnavailableError)) throw err;
      /* Der Kalendereintrag bleibt vorerst stehen. Die Stornierung trotzdem zu
         verweigern hieße, den Termin für alle anderen blockiert zu lassen; der
         Hinweis in der Antwort sagt, dass Google noch nachgezogen werden muss. */
      await query(`UPDATE booking SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
      return json(res, 200, {
        booking: { id, status },
        warning: 'Der Termin ist storniert, der Eintrag im Google Kalender konnte aber nicht gelöscht werden. Bitte dort nachsehen.',
      });
    }
  }

  const { rows: updated } = await query(
    `UPDATE booking SET status = $2,
            google_event_id = CASE WHEN $3 THEN NULL ELSE google_event_id END,
            updated_at = now()
      WHERE id = $1 RETURNING id, status`,
    [id, status, releasing]
  );
  json(res, 200, { booking: updated[0] });
}
