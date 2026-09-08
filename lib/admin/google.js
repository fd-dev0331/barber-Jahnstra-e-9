/* Status der Google-Anbindung für /admin/google.

   Hier wird nichts vorgetäuscht: ist kein OAuth-Client konfiguriert oder keine
   Verbindung hergestellt, sagt der Endpunkt genau das (promt.md §21). */
import { query } from '../db.js';
import { json, fail } from '../http.js';
import { isGoogleConfigured, listCalendars, GoogleUnavailableError } from '../google.js';
import { uuid, text } from './util.js';

export async function status(req, res, user) {
  const configured = isGoogleConfigured();

  const [{ rows: integration }, { rows: employees }] = await Promise.all([
    query(
      `SELECT google_account_email, status, connected_at, last_error, encrypted_credentials IS NOT NULL AS has_tokens
         FROM google_integration WHERE business_id = $1`,
      [user.businessId]
    ),
    query(
      `SELECT id, name, status, google_calendar_id FROM employee
        WHERE business_id = $1 ORDER BY status, sort_order, name`,
      [user.businessId]
    ),
  ]);

  const record = integration[0];
  const connected = Boolean(record?.has_tokens && record.status === 'ACTIVE');

  let calendars = null;
  let calendarError = null;
  if (connected) {
    try {
      calendars = await listCalendars(user.businessId);
    } catch (err) {
      if (!(err instanceof GoogleUnavailableError)) throw err;
      calendarError = 'Die Kalenderliste ließ sich gerade nicht laden. Bitte später erneut versuchen.';
      console.error('[admin:google] listCalendars', err);
    }
  }

  json(res, 200, {
    configured,
    connected,
    account: record ? { email: record.google_account_email, connectedAt: record.connected_at } : null,
    lastError: record?.last_error ?? null,
    calendars,
    calendarError,
    employees: employees.map((e) => ({
      id: e.id, name: e.name, status: e.status, googleCalendarId: e.google_calendar_id,
    })),
    // Für die Anleitung auf der Seite: welche Redirect-URI muss in der Google
    // Cloud Console eingetragen sein?
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? null,
  });
}

/** Kalender einem Mitarbeiter zuordnen (promt.md §8/§9). */
export async function assignCalendar(req, res, body, user) {
  const employeeId = uuid(body.employeeId, { field: 'Mitarbeiter' });
  const calendarId = text(body.googleCalendarId, { max: 300, field: 'Kalender' });

  const { rowCount } = await query(
    'UPDATE employee SET google_calendar_id = $3, updated_at = now() WHERE id = $1 AND business_id = $2',
    [employeeId, user.businessId, calendarId]
  );
  if (!rowCount) return fail(res, 404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');
  return status(req, res, user);
}

/** Verbindung trennen. Die Tokens werden gelöscht, nicht nur deaktiviert. */
export async function disconnect(req, res, user) {
  await query(
    `UPDATE google_integration
        SET encrypted_credentials = NULL, status = 'INACTIVE', connected_at = NULL,
            last_error = NULL, updated_at = now()
      WHERE business_id = $1`,
    [user.businessId]
  );
  json(res, 200, { ok: true, connected: false });
}
