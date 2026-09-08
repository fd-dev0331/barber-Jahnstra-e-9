/* GET /api/ics?reference=XXXX — Kalenderdatei für die Bestätigungsseite.
   Die Referenz ist ein 8-stelliger Zufallscode; sie gibt nur den eigenen Termin
   heraus und enthält bewusst keine Telefonnummer oder E-Mail-Adresse. */
import { query } from '../lib/db.js';
import { getBusiness } from '../lib/business.js';
import { methodNotAllowed, fail, serverError } from '../lib/http.js';

const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545: Zeilenumbrüche, Kommata und Semikola müssen escaped werden. */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const url = new URL(req.url, 'http://localhost');
    const reference = url.searchParams.get('reference');
    if (!reference || !/^[A-Z0-9]{8}$/.test(reference)) {
      return fail(res, 400, 'invalid_reference', 'Ungültige Referenz.');
    }

    const business = await getBusiness();
    const { rows } = await query(
      `SELECT b.reference, b.start_time, b.end_time, s.name AS service, e.name AS employee
         FROM booking b
         JOIN service s ON s.id = b.service_id
         JOIN employee e ON e.id = b.employee_id
        WHERE b.business_id = $1 AND b.reference = $2 AND b.status IN ('PENDING','CONFIRMED')`,
      [business.id, reference]
    );
    if (!rows.length) return fail(res, 404, 'not_found', 'Termin nicht gefunden.');

    const b = rows[0];
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bregenz Barbershop//Termin//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${b.reference}@bregenz-barbershop.at`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(b.start_time)}`,
      `DTEND:${stamp(b.end_time)}`,
      `SUMMARY:${escapeText(`${b.service} — Bregenz Barbershop`)}`,
      `DESCRIPTION:${escapeText(`Bei ${b.employee}. Referenz: ${b.reference}`)}`,
      `LOCATION:${escapeText(business.address)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText('Termin im Bregenz Barbershop in 2 Stunden')}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="termin-${b.reference}.ics"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(ics);
  } catch (err) {
    serverError(res, err);
  }
}
