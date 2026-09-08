/* Google Calendar über den offiziellen OAuth-2.0-Flow.
   Es gibt hier bewusst keine Fallback-Credentials und keinen Mock: ohne echte
   Verbindung meldet das Modul "nicht verbunden" statt so zu tun, als ginge es
   (info.md §11, §32). */
import { google } from 'googleapis';
import { query } from './db.js';
import { encryptJson, decryptJson } from './crypto.js';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];

export class GoogleUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'GoogleUnavailableError';
    this.cause = cause;
  }
}

export function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new GoogleUnavailableError('Google OAuth ist nicht konfiguriert');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
  );
}

export async function isGoogleConnected(businessId) {
  if (!isGoogleConfigured()) return false;
  const { rows } = await query(
    `SELECT 1 FROM google_integration WHERE business_id = $1 AND status = 'ACTIVE' AND encrypted_credentials IS NOT NULL`,
    [businessId]
  );
  return rows.length > 0;
}

export async function saveCredentials(businessId, tokens, profile = {}) {
  await query(
    `INSERT INTO google_integration
       (business_id, google_account_id, google_account_email, encrypted_credentials, status, connected_at, last_error, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', now(), NULL, now())
     ON CONFLICT (business_id) DO UPDATE
       SET google_account_id = EXCLUDED.google_account_id,
           google_account_email = EXCLUDED.google_account_email,
           encrypted_credentials = EXCLUDED.encrypted_credentials,
           status = 'ACTIVE', connected_at = now(), last_error = NULL, updated_at = now()`,
    [businessId, profile.id ?? null, profile.email ?? null, encryptJson(tokens)]
  );
}

/** Authentifizierter Client. Erneuerte Tokens werden sofort zurückgeschrieben. */
export async function authorizedClient(businessId) {
  const { rows } = await query(
    `SELECT encrypted_credentials FROM google_integration
      WHERE business_id = $1 AND status = 'ACTIVE' LIMIT 1`,
    [businessId]
  );
  if (!rows.length || !rows[0].encrypted_credentials) {
    throw new GoogleUnavailableError('Google Calendar ist für diesen Betrieb nicht verbunden');
  }

  const client = oauthClient();
  client.setCredentials(decryptJson(rows[0].encrypted_credentials));

  // Refresh-Token bleibt erhalten, auch wenn Google es beim Refresh nicht mitschickt.
  client.on('tokens', async (tokens) => {
    try {
      const { rows: current } = await query(
        `SELECT encrypted_credentials FROM google_integration WHERE business_id = $1`,
        [businessId]
      );
      const merged = { ...decryptJson(current[0].encrypted_credentials), ...tokens };
      await query(
        `UPDATE google_integration SET encrypted_credentials = $2, updated_at = now() WHERE business_id = $1`,
        [businessId, encryptJson(merged)]
      );
    } catch (err) {
      console.error('[google] Token-Refresh konnte nicht gespeichert werden', err);
    }
  });

  return client;
}

async function calendar(businessId) {
  return google.calendar({ version: 'v3', auth: await authorizedClient(businessId) });
}

/** Fehler markieren die Integration, damit das Dashboard den Zustand zeigt. */
async function markError(businessId, err) {
  const revoked = err?.response?.status === 401 || err?.response?.data?.error === 'invalid_grant';
  await query(
    `UPDATE google_integration SET last_error = $2, status = $3, updated_at = now() WHERE business_id = $1`,
    [businessId, String(err?.message ?? err).slice(0, 500), revoked ? 'INACTIVE' : 'ACTIVE']
  ).catch(() => {});
}

export async function getBusyPeriods({ businessId, calendarId, timeMin, timeMax }) {
  try {
    const cal = await calendar(businessId);
    const { data } = await cal.freebusy.query({
      requestBody: {
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const entry = data.calendars?.[calendarId];
    if (entry?.errors?.length) {
      throw new GoogleUnavailableError(`Kalender nicht verfügbar: ${entry.errors[0].reason}`);
    }
    return entry?.busy ?? [];
  } catch (err) {
    await markError(businessId, err);
    throw new GoogleUnavailableError('Google Calendar ist gerade nicht erreichbar', err);
  }
}

export async function createEvent({ businessId, calendarId, booking, timezone }) {
  try {
    const cal = await calendar(businessId);
    const { data } = await cal.events.insert({
      calendarId,
      requestBody: {
        summary: `${booking.serviceName} — ${booking.customerName}`,
        description: [
          `Leistung: ${booking.serviceName}`,
          `Kunde: ${booking.customerName}`,
          `Telefon: ${booking.customerPhone}`,
          booking.customerEmail ? `E-Mail: ${booking.customerEmail}` : null,
          booking.note ? `Anmerkung: ${booking.note}` : null,
          `Referenz: ${booking.reference}`,
          `Quelle: ${booking.source === 'MANUAL' ? 'Manuell angelegt' : 'Website-Buchung'}`,
        ].filter(Boolean).join('\n'),
        start: { dateTime: new Date(booking.start).toISOString(), timeZone: timezone },
        end: { dateTime: new Date(booking.end).toISOString(), timeZone: timezone },
      },
    });
    return data.id;
  } catch (err) {
    await markError(businessId, err);
    throw new GoogleUnavailableError('Der Termin konnte nicht in den Kalender eingetragen werden', err);
  }
}

export async function updateEvent({ businessId, calendarId, eventId, booking, timezone }) {
  try {
    const cal = await calendar(businessId);
    await cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: new Date(booking.start).toISOString(), timeZone: timezone },
        end: { dateTime: new Date(booking.end).toISOString(), timeZone: timezone },
      },
    });
  } catch (err) {
    await markError(businessId, err);
    throw new GoogleUnavailableError('Der Kalendereintrag konnte nicht aktualisiert werden', err);
  }
}

export async function deleteEvent({ businessId, calendarId, eventId }) {
  try {
    const cal = await calendar(businessId);
    await cal.events.delete({ calendarId, eventId });
  } catch (err) {
    // 404/410 = schon gelöscht; das ist kein Fehlerzustand.
    const status = err?.response?.status;
    if (status === 404 || status === 410) return;
    await markError(businessId, err);
    throw new GoogleUnavailableError('Der Kalendereintrag konnte nicht storniert werden', err);
  }
}

export async function listCalendars(businessId) {
  try {
    const cal = await calendar(businessId);
    const { data } = await cal.calendarList.list({ maxResults: 100 });
    return (data.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: Boolean(c.primary) }));
  } catch (err) {
    await markError(businessId, err);
    throw new GoogleUnavailableError('Die Kalenderliste konnte nicht geladen werden', err);
  }
}
