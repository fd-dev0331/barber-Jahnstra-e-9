/* Gemeinsame Basis aller Admin-Seiten: API-Aufrufe, Sitzungsdaten, Formate.

   Wichtig: die Rollenprüfung hier ist reine Anzeige-Logik. Ob jemand etwas darf,
   entscheidet ausschließlich das Backend — dieses Skript versteckt nur Knöpfe,
   die sowieso in einem 403 enden würden (info.md §22). */
import { t, has, getLocale } from './i18n.js';
import { authToken, isMiniApp, reauthenticate } from './telegram.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function cookie(name) {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

async function request(url, { method = 'GET', body } = {}, mayRetry = true) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = cookie('bb_csrf') ?? '';
  /* In der Telegram Mini App kommt kein Cookie an; dort trägt dieser Header die
     Sitzung (public/assets/js/admin/telegram.js, lib/auth.js). */
  const token = authToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    /* Abgelaufene Sitzung in Telegram: dort lässt sie sich aus dem signierten
       Start ohne Zutun erneuern — einmal, dann gilt der Fehler. */
    if (response.status === 401 && mayRetry && isMiniApp() && (await reauthenticate())) {
      return request(url, { method, body }, false);
    }
    // Die Servermeldung ist deutsch; angezeigt wird der übersetzte Text zum Code.
    throw new ApiError(response.status, payload.error ?? 'error', payload.message);
  }
  return payload;
}

/** Admin-Endpunkte unter /api/admin. */
export const api = (path, options) => request(`/api/admin${path}`, options);

/** Bestehende öffentliche Endpunkte (z. B. freie Zeiten) — nur lesend. */
export const publicApi = (path) => request(`/api${path}`);

/** Übersetzte Fehlermeldung zu einem API-Fehler. */
export function errorMessage(err) {
  if (err instanceof ApiError) {
    if (has(`errors.${err.code}`)) return t(`errors.${err.code}`);
    if (err.status === 403) return t('errors.forbidden');
    if (err.status === 404) return t('errors.not_found');
    if (err.status === 409) return t('errors.conflict');
    if (err.status >= 500) return t('errors.server_error');
  }
  return t('errors.generic');
}

/* ------------------------------------------------------------- Sitzung */

/** Wird von requireSession() gefüllt: angemeldete Person, Betrieb, eigener Mitarbeiter. */
export const session = { user: null, business: null, employee: null };

const RANK = { EMPLOYEE: 1, ADMIN: 2, OWNER: 3 };
export const hasRank = (user, minimum) => (RANK[user?.role] ?? 0) >= RANK[minimum];
export const canManage = (user) => hasRank(user, 'ADMIN');
export const isOwner = (user) => user?.role === 'OWNER';
export const roleLabel = (role) => (has(`roles.${role}`) ? t(`roles.${role}`) : role);

export function redirectToLogin() {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/admin?next=${encodeURIComponent(next)}`;
}

/* -------------------------------------------------------------- Formate */

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let timezone = 'Europe/Vienna';
export const getTimezone = () => timezone;
export function setTimezone(value) {
  if (value) timezone = value;
}

const zoned = (options) => new Intl.DateTimeFormat(getLocale(), { timeZone: timezone, ...options });

export const fmtTime = (value) => zoned({ hour: '2-digit', minute: '2-digit' }).format(new Date(value));
export const fmtDate = (value) => zoned({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
export const fmtDateLong = (value) => zoned({ weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(value));
export const fmtDateTime = (value) =>
  zoned({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export const fmtPrice = (cents) =>
  new Intl.NumberFormat(getLocale(), { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);

export const fmtMinutes = (minutes) => t('common.minutes', { n: minutes });

/* Kalendertage als YYYY-MM-DD in der Geschäftszeitzone. Gerechnet wird mit
   12:00 UTC, damit keine Sommerzeitumstellung den Tag verschiebt. */
export const dayKey = (value) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value));

export const todayKey = () => dayKey(new Date());

/** Uhrzeit HH:MM (24 h) in der Geschäftszeitzone — als Formularwert, nicht zur Anzeige. */
export const timeKey = (value) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(value));

export function shiftDay(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOf(key) {
  const date = new Date(`${key}T12:00:00Z`);
  return shiftDay(key, -((date.getUTCDay() + 6) % 7));
}

/** Beschriftung eines Kalendertags (ohne Zeitzonenverschiebung). */
export const fmtDayKey = (key, options) =>
  new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC', ...options }).format(new Date(`${key}T12:00:00Z`));

/** Wochentagsname, 0 = Sonntag (wie working_hours.weekday). 2024-01-07 war ein Sonntag. */
export const weekdayName = (index, style = 'long') => fmtDayKey(shiftDay('2024-01-07', index), { weekday: style });

/** Anzeigereihenfolge Montag … Sonntag. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Wandzeit im Betrieb -> UTC-ISO. Ohne diese Umrechnung landete ein im Browser
 * eingegebener Termin in der Zeitzone des Rechners statt in der des Salons
 * (info.md §23).
 */
export function businessTimeToUtc(dateValue, timeValue) {
  const naive = new Date(`${dateValue}T${timeValue.slice(0, 5)}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(naive).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return new Date(naive.getTime() - (asUtc - naive.getTime())).toISOString();
}

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
