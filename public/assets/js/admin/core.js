/* Gemeinsame Basis aller Admin-Seiten: Anmeldung, Navigation, API-Aufrufe.

   Wichtig: die Rollenprüfung hier ist reine Anzeige-Logik. Ob jemand etwas darf,
   entscheidet ausschließlich das Backend — dieses Skript versteckt nur Knöpfe,
   die sowieso in einem 403 enden würden (info.md §22). */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
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

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = cookie('bb_csrf') ?? '';

  let response;
  try {
    response = await fetch(`/api/admin${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'Keine Verbindung zum Server.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'error', payload.message ?? 'Das hat nicht funktioniert.');
  }
  return payload;
}

/* ------------------------------------------------------------- Darstellung */

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let timezone = 'Europe/Vienna';
export const getTimezone = () => timezone;

export const fmtTime = (value) =>
  new Intl.DateTimeFormat('de-AT', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));

export const fmtDate = (value) =>
  new Intl.DateTimeFormat('de-AT', { timeZone: timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));

export const fmtDateLong = (value) =>
  new Intl.DateTimeFormat('de-AT', { timeZone: timezone, weekday: 'short', day: '2-digit', month: 'long' }).format(new Date(value));

export const fmtPrice = (cents) =>
  new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in der Geschäftszeitzone. */
export const dayKey = (value) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value));

/**
 * Wandzeit im Betrieb -> UTC-ISO. Ohne diese Umrechnung landete ein im Browser
 * eingegebener Termin in der Zeitzone des Rechners statt in der des Salons
 * (info.md §23).
 */
export function businessTimeToUtc(dateValue, timeValue) {
  const naive = new Date(`${dateValue}T${timeValue.length === 5 ? timeValue : timeValue.slice(0, 5)}:00Z`);
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

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export const STATUS_LABEL = {
  PENDING: 'Offen',
  CONFIRMED: 'Bestätigt',
  CANCELLED: 'Storniert',
  COMPLETED: 'Erledigt',
  NO_SHOW: 'Nicht erschienen',
};

export const STATUS_CLASS = {
  PENDING: 'bg-warn/15 text-warn',
  CONFIRMED: 'bg-ok/15 text-ok',
  CANCELLED: 'bg-danger/15 text-danger',
  COMPLETED: 'bg-surface-2 text-fg-muted',
  NO_SHOW: 'bg-danger/10 text-danger',
};

/* ------------------------------------------------------------------ Toast */

let toastTimer;
export function toast(message, kind = 'ok') {
  let host = document.querySelector('[data-toast]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-toast', '');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.className = 'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-3 text-[15px] font-medium shadow-lg';
    document.body.append(host);
  }
  host.className = `fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-3 text-[15px] font-medium shadow-lg ${
    kind === 'error' ? 'bg-danger text-bg' : 'bg-accent text-accent-on'}`;
  host.textContent = message;
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.hidden = true; }, kind === 'error' ? 6000 : 3000);
}

/** Einheitliche Fehlerbehandlung: abgelaufene Session führt zurück zur Anmeldung. */
export function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    window.location.href = `/admin?next=${encodeURIComponent(window.location.pathname)}`;
    return;
  }
  console.error(err);
  toast(err?.message ?? 'Unbekannter Fehler.', 'error');
}

/* -------------------------------------------------------------- Navigation */

const NAV = [
  { href: '/admin', label: 'Übersicht', role: 'EMPLOYEE' },
  { href: '/admin/bookings', label: 'Termine', role: 'EMPLOYEE' },
  { href: '/admin/calendar', label: 'Kalender', role: 'EMPLOYEE' },
  { href: '/admin/employees', label: 'Mitarbeiter', role: 'ADMIN' },
  { href: '/admin/services', label: 'Leistungen', role: 'ADMIN' },
  { href: '/admin/google', label: 'Google', role: 'ADMIN' },
  { href: '/admin/settings', label: 'Einstellungen', role: 'ADMIN' },
];

const RANK = { EMPLOYEE: 1, ADMIN: 2, OWNER: 3 };
export const canManage = (user) => (RANK[user.role] ?? 0) >= RANK.ADMIN;
export const isOwner = (user) => user.role === 'OWNER';

function renderNav(user, active) {
  const nav = document.querySelector('[data-nav]');
  if (!nav) return;
  nav.innerHTML = NAV
    .filter((item) => (RANK[user.role] ?? 0) >= RANK[item.role])
    .map((item) => {
      const current = item.href === active;
      return `<a href="${item.href}" ${current ? 'aria-current="page"' : ''}
        class="inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
        current ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:text-fg'}">${item.label}</a>`;
    })
    .join('');

  const who = document.querySelector('[data-user]');
  if (who) {
    who.innerHTML = `<span class="text-fg-body">${escapeHtml(user.name)}</span>
      <span class="text-fg-muted"> · ${escapeHtml(ROLE_LABEL[user.role] ?? user.role)}</span>`;
  }

  document.querySelector('[data-logout]')?.addEventListener('click', async () => {
    try {
      await api('/session', { method: 'DELETE' });
    } finally {
      window.location.href = '/admin';
    }
  });
}

export const ROLE_LABEL = { OWNER: 'Inhaber', ADMIN: 'Verwaltung', EMPLOYEE: 'Mitarbeiter', CLIENT: 'Kunde' };

/**
 * Session prüfen und die Seitenhülle aufbauen.
 * Ohne gültige Session geht es zurück auf /admin — die Seite selbst rendert nie
 * Daten, die sie nicht vom Server bekommen hat.
 */
export async function requireSession(active) {
  try {
    const { user, business } = await api('/session');
    timezone = business?.timezone ?? timezone;
    document.documentElement.dataset.role = user.role;
    renderNav(user, active);
    document.querySelectorAll('[data-shell]').forEach((node) => node.removeAttribute('hidden'));
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      window.location.href = `/admin?next=${encodeURIComponent(window.location.pathname)}`;
      return null;
    }
    document.querySelector('[data-boot-error]')?.removeAttribute('hidden');
    handleError(err);
    return null;
  }
}

export function setTimezone(value) {
  if (value) timezone = value;
}
