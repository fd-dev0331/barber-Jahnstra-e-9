/* Mitarbeiterverwaltung (info.md §9, promt.md §10).

   Kündigt jemand, wird status = 'INACTIVE' gesetzt — nie gelöscht. Die
   öffentlichen Endpunkte filtern auf ACTIVE, historische Buchungen bleiben
   vollständig erhalten. Löschen ist nur erlaubt, solange kein einziger Termin
   an der Person hängt; sonst antwortet der Endpunkt mit 409. */
import { query, withTransaction } from '../db.js';
import { json, fail } from '../http.js';
import { text, uuid, integer, oneOf, timeOfDay, isoDateTime, ValidationError } from './util.js';

const SELECT = `
  SELECT e.id, e.name, e.role_label, e.status, e.google_calendar_id, e.sort_order, e.user_id,
         COALESCE(s.service_ids, '{}') AS service_ids,
         COALESCE(b.upcoming, 0)      AS upcoming_bookings,
         COALESCE(b.total, 0)         AS total_bookings
    FROM employee e
    LEFT JOIN LATERAL (
      SELECT array_agg(es.service_id) AS service_ids
        FROM employee_service es WHERE es.employee_id = e.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE bo.start_time >= now() AND bo.status IN ('PENDING','CONFIRMED'))::int AS upcoming,
             count(*)::int AS total
        FROM booking bo WHERE bo.employee_id = e.id
    ) b ON true
   WHERE e.business_id = $1`;

function shape(row, hours = [], absences = []) {
  return {
    id: row.id,
    name: row.name,
    role: row.role_label,
    status: row.status,
    googleCalendarId: row.google_calendar_id,
    sortOrder: row.sort_order,
    serviceIds: (row.service_ids ?? []).filter(Boolean),
    upcomingBookings: row.upcoming_bookings,
    totalBookings: row.total_bookings,
    workingHours: hours.map((h) => ({
      weekday: h.weekday,
      start: String(h.start_time).slice(0, 5),
      end: String(h.end_time).slice(0, 5),
      isBreak: h.is_break,
    })),
    absences: absences.map((a) => ({
      id: a.id, start: a.starts_at, end: a.ends_at, kind: a.kind, note: a.note,
    })),
  };
}

export async function list(req, res, user) {
  const { rows } = await query(`${SELECT} ORDER BY e.status, e.sort_order, e.name`, [user.businessId]);
  const ids = rows.map((r) => r.id);

  const [{ rows: hours }, { rows: absences }] = await Promise.all([
    ids.length
      ? query(`SELECT employee_id, weekday, start_time, end_time, is_break FROM working_hours
                WHERE employee_id = ANY($1::uuid[]) ORDER BY weekday, start_time`, [ids])
      : { rows: [] },
    ids.length
      ? query(`SELECT id, employee_id, starts_at, ends_at, kind, note FROM absence
                WHERE employee_id = ANY($1::uuid[]) AND ends_at > now() - interval '30 days'
                ORDER BY starts_at`, [ids])
      : { rows: [] },
  ]);

  json(res, 200, {
    employees: rows.map((row) => shape(
      row,
      hours.filter((h) => h.employee_id === row.id),
      absences.filter((a) => a.employee_id === row.id)
    )),
  });
}

export async function create(req, res, body, user) {
  const name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
  const roleLabel = text(body.role, { max: 120, field: 'Funktion' });
  const calendarId = text(body.googleCalendarId, { max: 300, field: 'Kalender' });
  const sortOrder = integer(body.sortOrder, { min: 0, max: 9999 }) ?? 100;

  const employee = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO employee (business_id, name, role_label, google_calendar_id, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
      [user.businessId, name, roleLabel, calendarId, sortOrder]
    );
    const id = rows[0].id;
    if (Array.isArray(body.serviceIds)) await replaceServices(client, user.businessId, id, body.serviceIds);
    if (Array.isArray(body.workingHours)) await replaceHours(client, id, body.workingHours);
    return id;
  });

  const { rows } = await query(`${SELECT} AND e.id = $2`, [user.businessId, employee]);
  json(res, 201, { employee: shape(rows[0]) });
}

export async function update(req, res, body, user, id) {
  uuid(id, { field: 'Mitarbeiter' });

  const { rows: existing } = await query(
    'SELECT id FROM employee WHERE id = $1 AND business_id = $2', [id, user.businessId]
  );
  if (!existing.length) return fail(res, 404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');

  const sets = [];
  const params = [id];
  const push = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.name !== undefined) push('name', text(body.name, { required: true, min: 2, max: 120, field: 'Name' }));
  if (body.role !== undefined) push('role_label', text(body.role, { max: 120, field: 'Funktion' }));
  if (body.status !== undefined) push('status', oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' }));
  if (body.googleCalendarId !== undefined) push('google_calendar_id', text(body.googleCalendarId, { max: 300, field: 'Kalender' }));
  if (body.sortOrder !== undefined) push('sort_order', integer(body.sortOrder, { min: 0, max: 9999, required: true, field: 'Reihenfolge' }));

  await withTransaction(async (client) => {
    if (sets.length) {
      await client.query(`UPDATE employee SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    }
    if (Array.isArray(body.serviceIds)) await replaceServices(client, user.businessId, id, body.serviceIds);
    if (Array.isArray(body.workingHours)) await replaceHours(client, id, body.workingHours);
  });

  const { rows } = await query(`${SELECT} AND e.id = $2`, [user.businessId, id]);
  const { rows: hours } = await query(
    `SELECT weekday, start_time, end_time, is_break FROM working_hours
      WHERE employee_id = $1 ORDER BY weekday, start_time`, [id]
  );
  json(res, 200, { employee: shape(rows[0], hours) });
}

export async function remove(req, res, user, id) {
  uuid(id, { field: 'Mitarbeiter' });

  const { rows } = await query(
    `SELECT (SELECT count(*) FROM booking WHERE employee_id = e.id)::int AS bookings
       FROM employee e WHERE e.id = $1 AND e.business_id = $2`,
    [id, user.businessId]
  );
  if (!rows.length) return fail(res, 404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');

  // Historische Buchungen sind unantastbar (info.md §9). Wer Termine hat, wird
  // deaktiviert statt gelöscht — das Frontend bietet genau das an.
  if (rows[0].bookings > 0) {
    return fail(res, 409, 'has_bookings',
      'Zu dieser Person gibt es Termine in der Historie. Setz sie auf „inaktiv“, statt sie zu löschen.');
  }

  await query('DELETE FROM employee WHERE id = $1 AND business_id = $2', [id, user.businessId]);
  json(res, 200, { ok: true });
}

/* -------------------------------------------------------------- Abwesenheit */

export async function addAbsence(req, res, body, user, id) {
  uuid(id, { field: 'Mitarbeiter' });
  const { rows: owned } = await query(
    'SELECT id FROM employee WHERE id = $1 AND business_id = $2', [id, user.businessId]
  );
  if (!owned.length) return fail(res, 404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');

  const start = isoDateTime(body.start, 'Beginn');
  const end = isoDateTime(body.end, 'Ende');
  if (end <= start) throw new ValidationError('invalid_input', 'Das Ende muss nach dem Beginn liegen.');

  const kind = oneOf(body.kind, ['VACATION', 'SICK', 'OTHER'], { field: 'Art' }) ?? 'OTHER';
  const note = text(body.note, { max: 300, field: 'Notiz' });

  const { rows: clash } = await query(
    `SELECT count(*)::int AS n FROM booking
      WHERE employee_id = $1 AND status IN ('PENDING','CONFIRMED')
        AND start_time < $3 AND end_time > $2`,
    [id, start, end]
  );

  const { rows } = await query(
    `INSERT INTO absence (employee_id, starts_at, ends_at, kind, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, starts_at, ends_at, kind, note`,
    [id, start, end, kind, note]
  );

  json(res, 201, {
    absence: { id: rows[0].id, start: rows[0].starts_at, end: rows[0].ends_at, kind: rows[0].kind, note: rows[0].note },
    // Bereits gebuchte Termine werden nicht automatisch storniert — der Betrieb
    // muss entscheiden, was mit ihnen passiert.
    conflictingBookings: clash[0].n,
  });
}

export async function removeAbsence(req, res, user, id, absenceId) {
  uuid(id, { field: 'Mitarbeiter' });
  uuid(absenceId, { field: 'Abwesenheit' });
  const { rowCount } = await query(
    `DELETE FROM absence a USING employee e
      WHERE a.id = $1 AND a.employee_id = e.id AND e.id = $2 AND e.business_id = $3`,
    [absenceId, id, user.businessId]
  );
  if (!rowCount) return fail(res, 404, 'not_found', 'Diesen Eintrag gibt es nicht.');
  json(res, 200, { ok: true });
}

/* ----------------------------------------------------------------- intern */

async function replaceServices(client, businessId, employeeId, serviceIds) {
  const ids = serviceIds.map((value) => uuid(value, { field: 'Leistung' }));
  await client.query('DELETE FROM employee_service WHERE employee_id = $1', [employeeId]);
  if (!ids.length) return;

  // Nur Leistungen des eigenen Betriebs — sonst ließe sich über eine fremde
  // Kennung eine Zuordnung quer über Betriebe hinweg anlegen.
  const { rows } = await client.query(
    'SELECT id FROM service WHERE business_id = $1 AND id = ANY($2::uuid[])', [businessId, ids]
  );
  if (rows.length !== ids.length) throw new ValidationError('not_found', 'Eine der Leistungen ist unbekannt.');

  await client.query(
    `INSERT INTO employee_service (employee_id, service_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [employeeId, ids]
  );
}

async function replaceHours(client, employeeId, entries) {
  const rows = entries.map((entry) => {
    const weekday = integer(entry.weekday, { min: 0, max: 6, required: true, field: 'Wochentag' });
    const start = timeOfDay(entry.start, 'Beginn');
    const end = timeOfDay(entry.end, 'Ende');
    if (end <= start) throw new ValidationError('invalid_input', 'Das Ende muss nach dem Beginn liegen.');
    return { weekday, start, end, isBreak: entry.isBreak === true };
  });

  // Zwei Schichten am selben Tag dürfen sich nicht überschneiden; Pausen dagegen
  // liegen absichtlich innerhalb einer Schicht.
  for (const day of new Set(rows.map((r) => r.weekday))) {
    const shifts = rows.filter((r) => r.weekday === day && !r.isBreak).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < shifts.length; i += 1) {
      if (shifts[i].start < shifts[i - 1].end) {
        throw new ValidationError('invalid_input', 'Zwei Arbeitszeiten am selben Tag überschneiden sich.');
      }
    }
    for (const pause of rows.filter((r) => r.weekday === day && r.isBreak)) {
      const inside = shifts.some((s) => pause.start >= s.start && pause.end <= s.end);
      if (!inside) throw new ValidationError('invalid_input', 'Eine Pause liegt außerhalb der Arbeitszeit.');
    }
  }

  await client.query('DELETE FROM working_hours WHERE employee_id = $1', [employeeId]);
  for (const row of rows) {
    await client.query(
      `INSERT INTO working_hours (employee_id, weekday, start_time, end_time, is_break)
       VALUES ($1,$2,$3,$4,$5)`,
      [employeeId, row.weekday, row.start, row.end, row.isBreak]
    );
  }
}
