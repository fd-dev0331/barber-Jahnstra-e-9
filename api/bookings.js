/* POST /api/bookings — Termin anlegen.
   Ablauf nach info.md §16: Verfügbarkeit wird im Backend NEU geprüft, erst dann
   wird gebucht. Der Verfügbarkeit, die das Frontend vor Sekunden gesehen hat,
   wird ausdrücklich nicht vertraut. */
import crypto from 'node:crypto';
import { query, withTransaction } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { assertSlotFree } from '../lib/availability.js';
import { json, methodNotAllowed, fail, serverError, rateLimit, readJson } from '../lib/http.js';
import { isGoogleConnected, createEvent, GoogleUnavailableError } from '../lib/google.js';

const MAX = { name: 120, email: 200, phone: 40, note: 500 };
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function clean(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(CONTROL_CHARS, '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function reference() {
  // 8 Zeichen, keine leicht verwechselbaren Glyphen.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!rateLimit(req, res, { limit: 8, windowMs: 60_000, key: 'bookings' })) return;

  let body;
  try {
    body = await readJson(req);
  } catch {
    return fail(res, 400, 'invalid_body', 'Die Anfrage konnte nicht gelesen werden.');
  }

  const customerName = clean(body.customerName, MAX.name);
  const customerPhone = clean(body.customerPhone, MAX.phone);
  const customerEmail = clean(body.customerEmail, MAX.email);
  const note = clean(body.note, MAX.note);

  // Serverseitige Validierung — die Prüfung im Browser ist reine Bequemlichkeit
  // und schützt gar nichts (info.md §22).
  if (!customerName || customerName.length < 2) {
    return fail(res, 400, 'invalid_name', 'Bitte gib deinen Namen an.');
  }
  if (!customerPhone || customerPhone.replace(/[\s()/-]/g, '').length < 6) {
    return fail(res, 400, 'invalid_phone', 'Bitte gib eine erreichbare Telefonnummer an.');
  }
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customerEmail)) {
    return fail(res, 400, 'invalid_email', 'Diese E-Mail-Adresse sieht nicht richtig aus.');
  }
  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) {
    return fail(res, 400, 'invalid_start', 'Bitte wähle eine Uhrzeit.');
  }

  try {
    const business = await getBusiness();

    const [{ rows: services }, { rows: employees }] = await Promise.all([
      query(
        `SELECT id, name, duration_minutes FROM service
          WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
        [body.serviceId, business.id]
      ),
      query(
        `SELECT id, name, google_calendar_id FROM employee
          WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
        [body.employeeId, business.id]
      ),
    ]);
    if (!services.length) return fail(res, 404, 'service_not_found', 'Diese Leistung ist nicht mehr buchbar.');
    // Ein deaktivierter Mitarbeiter nimmt keine neuen Buchungen an (info.md §9, §31).
    if (!employees.length) return fail(res, 404, 'employee_not_found', 'Diese Person nimmt keine Termine mehr an.');

    const service = services[0];
    const employee = employees[0];
    const end = new Date(start.getTime() + service.duration_minutes * 60_000);

    if (start.getTime() < Date.now() + business.lead_time_minutes * 60_000) {
      return fail(res, 409, 'too_late', 'Dieser Termin liegt zu kurzfristig. Bitte wähle eine spätere Uhrzeit.');
    }

    const ref = reference();
    let googleEventId = null;

    const booking = await withTransaction(async (client) => {
      // Sperrt die Zeile des Mitarbeiters für die Dauer der Transaktion, damit
      // zwei gleichzeitige Anfragen nicht beide "frei" sehen.
      await client.query('SELECT id FROM employee WHERE id = $1 FOR UPDATE', [employee.id]);

      const free = await assertSlotFree({ client, business, employee, service, start, end });
      if (!free) {
        const conflict = new Error('slot_taken');
        conflict.code = 'SLOT_TAKEN';
        throw conflict;
      }

      // Kalendereintrag zuerst: schlägt Google fehl, gibt es auch keine Buchung,
      // statt einer Buchung, die niemand im Kalender sieht (info.md §32).
      if ((await isGoogleConnected(business.id)) && employee.google_calendar_id) {
        googleEventId = await createEvent({
          businessId: business.id,
          calendarId: employee.google_calendar_id,
          timezone: business.timezone,
          booking: {
            serviceName: service.name,
            customerName,
            customerPhone,
            customerEmail,
            note,
            reference: ref,
            source: 'WEBSITE',
            start,
            end,
          },
        });
      }

      const { rows } = await client.query(
        `INSERT INTO booking
           (business_id, employee_id, service_id, reference, customer_name, customer_email,
            customer_phone, note, start_time, end_time, status, source, google_event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED','WEBSITE',$11)
         RETURNING id, reference, start_time, end_time, status`,
        [business.id, employee.id, service.id, ref, customerName, customerEmail,
         customerPhone, note, start, end, googleEventId]
      );
      return rows[0];
    });

    json(res, 201, {
      booking: {
        id: booking.id,
        reference: booking.reference,
        start: booking.start_time,
        end: booking.end_time,
        status: booking.status,
        service: service.name,
        employee: employee.name,
        icsUrl: `/api/ics?reference=${encodeURIComponent(booking.reference)}`,
      },
    });
  } catch (err) {
    // Die EXCLUDE-Constraint der Datenbank ist die letzte Verteidigungslinie:
    // 23P01 heißt, zwei Anfragen haben es gleichzeitig bis zum INSERT geschafft.
    if (err?.code === 'SLOT_TAKEN' || err?.code === '23P01') {
      return fail(res, 409, 'slot_taken',
        'Dieser Termin ist leider nicht mehr frei. Bitte wähle eine andere Uhrzeit.');
    }
    if (err instanceof GoogleUnavailableError) {
      return fail(res, 503, 'calendar_unavailable',
        'Der Termin konnte nicht im Kalender eingetragen werden. Bitte versuch es gleich noch einmal oder ruf uns an: 0681 20397906.',
        err);
    }
    serverError(res, err);
  }
}
