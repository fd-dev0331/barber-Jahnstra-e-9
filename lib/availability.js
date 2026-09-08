/* Verfügbarkeitsberechnung (info.md §13–§16).
   Freie Kalenderzeit allein reicht nicht: Arbeitszeiten, Pausen, Abwesenheiten,
   bestehende Buchungen UND Google-Calendar-Busy-Zeiten werden abgezogen. */
import { query } from './db.js';
import { zonedToUtc, weekdayInZone, overlaps, addDays } from './time.js';
import { getBusyPeriods, isGoogleConnected } from './google.js';

/**
 * @returns {Promise<{slots: Array<{start:string,end:string,available:boolean}>, closed:boolean}>}
 */
export async function getAvailability({ business, employee, service, date }) {
  const tz = business.timezone;
  const weekday = weekdayInZone(date, tz);

  const { rows: hours } = await query(
    `SELECT start_time, end_time, is_break FROM working_hours
      WHERE employee_id = $1 AND weekday = $2
      ORDER BY start_time`,
    [employee.id, weekday]
  );

  const shifts = hours.filter((h) => !h.is_break);
  if (!shifts.length) return { slots: [], closed: true };
  const breaks = hours.filter((h) => h.is_break);

  const dayStart = zonedToUtc(date, '00:00', tz);
  const dayEnd = zonedToUtc(addDays(date, 1), '00:00', tz);

  // Alles, was den Tag blockiert.
  const [{ rows: bookings }, { rows: absences }] = await Promise.all([
    query(
      `SELECT start_time, end_time FROM booking
        WHERE employee_id = $1 AND status IN ('PENDING','CONFIRMED')
          AND start_time < $3 AND end_time > $2`,
      [employee.id, dayStart, dayEnd]
    ),
    query(
      `SELECT starts_at AS start_time, ends_at AS end_time FROM absence
        WHERE employee_id = $1 AND starts_at < $3 AND ends_at > $2`,
      [employee.id, dayStart, dayEnd]
    ),
  ]);

  const blocked = [
    ...bookings.map((b) => [new Date(b.start_time), new Date(b.end_time)]),
    ...absences.map((a) => [new Date(a.start_time), new Date(a.end_time)]),
    ...breaks.map((b) => [zonedToUtc(date, String(b.start_time), tz), zonedToUtc(date, String(b.end_time), tz)]),
  ];

  // Google ist die zweite Quelle der Wahrheit. Ist die Integration verbunden,
  // aber nicht erreichbar, brechen wir ab statt belegte Zeiten als frei zu zeigen.
  if (await isGoogleConnected(business.id) && employee.google_calendar_id) {
    const busy = await getBusyPeriods({
      businessId: business.id,
      calendarId: employee.google_calendar_id,
      timeMin: dayStart,
      timeMax: dayEnd,
    });
    for (const period of busy) blocked.push([new Date(period.start), new Date(period.end)]);
  }

  const stepMs = business.slot_step_minutes * 60_000;
  const durationMs = service.duration_minutes * 60_000;
  const earliest = new Date(Date.now() + business.lead_time_minutes * 60_000);

  const slots = [];
  for (const shift of shifts) {
    const shiftStart = zonedToUtc(date, String(shift.start_time), tz);
    const shiftEnd = zonedToUtc(date, String(shift.end_time), tz);

    for (let t = shiftStart.getTime(); t + durationMs <= shiftEnd.getTime(); t += stepMs) {
      const start = new Date(t);
      const end = new Date(t + durationMs);

      // Vergangene Slots und die Vorlaufzeit tauchen gar nicht erst auf.
      if (start < earliest) continue;

      // Eine Leistung von 45 Minuten braucht 45 zusammenhängende freie Minuten:
      // geprüft wird das ganze Intervall, nicht nur der Startzeitpunkt (info.md §15).
      const free = !blocked.some(([bs, be]) => overlaps(start, end, bs, be));

      slots.push({ start: start.toISOString(), end: end.toISOString(), available: free });
    }
  }

  return { slots, closed: false };
}

/** Nächster Tag mit mindestens einem freien Slot, für den Leerzustand im UI. */
export async function findNextAvailableDate({ business, employee, service, fromDate, maxDays = 14 }) {
  for (let i = 1; i <= maxDays; i += 1) {
    const date = addDays(fromDate, i);
    const { slots } = await getAvailability({ business, employee, service, date });
    if (slots.some((s) => s.available)) return date;
  }
  return null;
}

/**
 * Letzte Prüfung unmittelbar vor dem Anlegen (info.md §16). Der Verfügbarkeit,
 * die das Frontend vor ein paar Sekunden bekommen hat, wird nicht vertraut.
 *
 * `ignoreWorkingHours` gibt es nur für manuelle Buchungen aus dem Admin: die
 * Leitung darf einen Termin außerhalb der Öffnungszeiten eintragen. Der Schutz
 * gegen Doppelbuchungen bleibt davon unberührt und lässt sich nicht abschalten.
 */
export async function assertSlotFree({
  client, business, employee, service, start, end, ignoreWorkingHours = false,
}) {
  const { rows } = await client.query(
    `SELECT 1 FROM booking
      WHERE employee_id = $1 AND status IN ('PENDING','CONFIRMED')
        AND start_time < $3 AND end_time > $2
      LIMIT 1`,
    [employee.id, start, end]
  );
  if (rows.length) return false;

  const { rows: abs } = await client.query(
    `SELECT 1 FROM absence WHERE employee_id = $1 AND starts_at < $3 AND ends_at > $2 LIMIT 1`,
    [employee.id, start, end]
  );
  if (abs.length) return false;

  // Liegt der Termin überhaupt in einer Arbeitszeit und außerhalb der Pausen?
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: business.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(start);
  const weekday = weekdayInZone(date, business.timezone);
  const { rows: hours } = await client.query(
    `SELECT start_time, end_time, is_break FROM working_hours WHERE employee_id = $1 AND weekday = $2`,
    [employee.id, weekday]
  );
  if (!ignoreWorkingHours) {
    const inShift = hours
      .filter((h) => !h.is_break)
      .some((h) => start >= zonedToUtc(date, String(h.start_time), business.timezone)
                && end <= zonedToUtc(date, String(h.end_time), business.timezone));
    if (!inShift) return false;

    const inBreak = hours
      .filter((h) => h.is_break)
      .some((h) => overlaps(start, end,
        zonedToUtc(date, String(h.start_time), business.timezone),
        zonedToUtc(date, String(h.end_time), business.timezone)));
    if (inBreak) return false;
  }

  if (await isGoogleConnected(business.id) && employee.google_calendar_id) {
    const busy = await getBusyPeriods({
      businessId: business.id,
      calendarId: employee.google_calendar_id,
      timeMin: start,
      timeMax: end,
    });
    if (busy.length) return false;
  }

  return true;
}
