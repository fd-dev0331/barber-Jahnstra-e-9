/* /admin — Anmeldung, Ersteinrichtung und Dashboard in einer Seite.

   Welche Ansicht erscheint, sagt der Server: erst GET /api/admin/session, bei
   401 dann GET /api/admin/setup. Das Frontend rät nie.
   Das Dashboard zeigt nur echte Daten aus GET /api/admin/overview (info.md §20). */
import { t, tn, onLanguageChange } from './i18n.js';
import {
  api, ApiError, session, escapeHtml, errorMessage, fmtTime, fmtDateLong, fmtDayKey, todayKey, canManage,
} from './core.js';
import {
  icon, statusBadge, handleError, emptyState, errorState, skeletonList, skeletonStats, validate, clearErrors, setBusy,
} from './ui.js';
import { requireSession, languageSwitcher, bindLanguageEvents, showBootError } from './shell.js';

const gate = document.querySelector('[data-gate]');

/* ------------------------------------------------ Anmeldung / Einrichtung */

let gateView = 'login';

function renderGate() {
  gate.querySelector('[data-lang-slot]').innerHTML = languageSwitcher();
  document.title = `${t(gateView === 'setup' ? 'setup.title' : 'login.title')} – Bregenz Barbershop`;
  // Feldfehler stammen aus der vorherigen Sprache — weg damit.
  gate.querySelectorAll('form').forEach((form) => clearErrors(form));
}

function showView(name) {
  gateView = name;
  gate.hidden = false;
  document.querySelector('[data-boot]')?.setAttribute('hidden', '');
  document.querySelector('.skip-link')?.setAttribute('href', '#gate-main');
  gate.querySelectorAll('[data-view]').forEach((section) => {
    section.hidden = section.dataset.view !== name;
  });
  renderGate();
  gate.querySelector(`[data-view="${name}"] input`)?.focus();
}

function bindForm(name, rules, submit) {
  const form = gate.querySelector(`[data-form="${name}"]`);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validate(form, rules)) return;
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, 'common.pleaseWait');
    try {
      await submit(Object.fromEntries(new FormData(form)));
      // Nach dem Anmelden dorthin, wo die Person eigentlich hinwollte.
      const next = new URL(window.location.href).searchParams.get('next');
      window.location.href = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
    } catch (err) {
      setBusy(button, false);
      // Hier ist 401 die Antwort auf falsche Zugangsdaten, keine abgelaufene Sitzung.
      const box = form.querySelector('[data-form-error]');
      box.textContent = errorMessage(err);
      box.hidden = false;
    }
  });
}

/* ------------------------------------------------------------ Dashboard */

let overview = null;
let loadError = null;

function stat({ label, value, foot = '', href = null, extra = '' }) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="adm-stat" ${href ? `href="${href}"` : ''}>
    <span class="adm-stat-label">${escapeHtml(label)}</span>
    ${value !== null ? `<span class="adm-stat-value">${escapeHtml(String(value))}</span>` : ''}
    ${extra}
    ${foot ? `<span class="adm-stat-foot">${escapeHtml(foot)}</span>` : ''}
  </${tag}>`;
}

function googleTile(google, manager) {
  let badge;
  let foot;
  if (!google.connected) {
    badge = `<span class="adm-badge st-inactive">${icon('unlink')}<span>${escapeHtml(t('google.notConnected'))}</span></span>`;
    foot = t('dashboard.googleOffHint');
  } else if (google.lastError) {
    badge = `<span class="adm-badge st-pending">${icon('alert')}<span>${escapeHtml(t('google.problem'))}</span></span>`;
    foot = t('dashboard.googleErrorHint');
  } else {
    badge = `<span class="adm-badge st-ok">${icon('checkCircle')}<span>${escapeHtml(t('google.connected'))}</span></span>`;
    foot = google.email ?? t('dashboard.googleOnHint');
  }
  return stat({
    label: t('dashboard.statGoogle'),
    value: null,
    extra: `<span class="mt-1">${badge}</span>`,
    foot,
    href: manager ? '/admin/google' : null,
  });
}

function bookingItem(booking, { withDate }) {
  const when = `${withDate ? `${fmtDateLong(booking.start)} · ` : ''}${fmtTime(booking.start)}–${fmtTime(booking.end)}`;
  return `<a class="adm-item flex items-start justify-between gap-3 no-underline transition-colors hover:border-line-strong"
      href="/admin/bookings?q=${encodeURIComponent(booking.reference)}">
    <span class="min-w-0">
      <span class="tnum block font-semibold text-fg">${escapeHtml(when)}</span>
      <span class="mt-0.5 block truncate text-fg-body">${escapeHtml(booking.customer.name)} · ${escapeHtml(booking.service.name)}</span>
      <span class="mt-0.5 block truncate text-xs text-fg-muted">${escapeHtml(booking.employee.name)}</span>
    </span>
    <span class="shrink-0">${statusBadge(booking.status)}</span>
  </a>`;
}

function renderQuickActions() {
  const manager = canManage(session.user);
  const actions = [];
  // Ein Mitarbeiter ohne verknüpften Mitarbeitereintrag kann keinen Termin anlegen.
  if (manager || session.employee) {
    actions.push(`<a class="adm-btn-primary" href="/admin/bookings?new=1">${icon('plus')}<span>${escapeHtml(t('dashboard.quickBooking'))}</span></a>`);
  }
  if (manager) {
    actions.push(`<a class="adm-btn-ghost" href="/admin/employees?new=1">${icon('users')}<span>${escapeHtml(t('dashboard.quickEmployee'))}</span></a>`);
    actions.push(`<a class="adm-btn-ghost" href="/admin/services?new=1">${icon('scissors')}<span>${escapeHtml(t('dashboard.quickService'))}</span></a>`);
    if (!overview?.google.connected) {
      actions.push(`<a class="adm-btn-ghost" href="/admin/google">${icon('link')}<span>${escapeHtml(t('dashboard.quickGoogle'))}</span></a>`);
    }
  }
  document.querySelector('[data-quick]').innerHTML = actions.join('');
}

function renderDashboard() {
  document.querySelector('[data-today-label]').textContent =
    fmtDayKey(todayKey(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderQuickActions();

  const errorBox = document.querySelector('[data-error]');
  const hintsBox = document.querySelector('[data-hints]');
  const statsBox = document.querySelector('[data-stats]');
  const todayBox = document.querySelector('[data-today]');
  const upcomingBox = document.querySelector('[data-upcoming]');

  if (loadError) {
    errorBox.innerHTML = errorState(loadError);
    [hintsBox, statsBox, todayBox, upcomingBox].forEach((box) => { box.innerHTML = ''; });
    return;
  }
  errorBox.innerHTML = '';

  if (!overview) {
    hintsBox.innerHTML = '';
    statsBox.innerHTML = skeletonStats(5);
    todayBox.innerHTML = skeletonList(2);
    upcomingBox.innerHTML = skeletonList(3);
    return;
  }

  const data = overview;
  const manager = canManage(session.user);

  const hints = [];
  if (manager && data.setupHints?.needsEmployee) hints.push(['warn', t('dashboard.hintNoEmployee'), '/admin/employees?new=1']);
  if (manager && data.setupHints?.needsService) hints.push(['warn', t('dashboard.hintNoService'), '/admin/services?new=1']);
  if (manager && !data.google.connected) hints.push(['info', t('dashboard.hintGoogleOff'), '/admin/google']);
  if (manager && data.google.connected && data.google.lastError) hints.push(['danger', t('dashboard.hintGoogleError'), '/admin/google']);
  if (!manager && !session.employee) hints.push(['info', t('dashboard.hintNotLinked'), null]);

  hintsBox.innerHTML = hints.map(([kind, message, href]) => {
    const body = `${icon(kind === 'info' ? 'info' : 'alert')}<span class="min-w-0 flex-1">${escapeHtml(message)}</span>${href ? `<span aria-hidden="true">${icon('chevronRight')}</span>` : ''}`;
    return href
      ? `<a class="adm-callout adm-callout-${kind} no-underline transition-colors hover:border-line-strong" href="${href}">${body}</a>`
      : `<div class="adm-callout adm-callout-${kind}">${body}</div>`;
  }).join('');

  statsBox.innerHTML = [
    stat({ label: t('dashboard.statToday'), value: data.today.length, foot: tn('dashboard.bookingsCount', data.today.length), href: '/admin/calendar' }),
    stat({ label: t('dashboard.statUpcoming'), value: data.counts.upcoming_bookings, foot: t('dashboard.fromNow'), href: '/admin/bookings?view=upcoming' }),
    stat({ label: t('dashboard.statEmployees'), value: data.counts.employees, foot: t('dashboard.activeOnly'), href: manager ? '/admin/employees' : null }),
    stat({ label: t('dashboard.statServices'), value: data.counts.services, foot: t('dashboard.activeOnly'), href: manager ? '/admin/services' : null }),
    googleTile(data.google, manager),
  ].join('');

  todayBox.innerHTML = data.today.length
    ? `<div class="adm-list">${data.today.map((b) => bookingItem(b, { withDate: false })).join('')}</div>`
    : emptyState({ title: t('dashboard.todayEmpty') });

  upcomingBox.innerHTML = data.upcoming.length
    ? `<div class="adm-list">${data.upcoming.map((b) => bookingItem(b, { withDate: true })).join('')}</div>`
    : emptyState({ title: t('dashboard.upcomingEmpty') });
}

async function loadDashboard() {
  loadError = null;
  overview = null;
  renderDashboard();
  try {
    overview = await api('/overview');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    loadError = err;
  }
  renderDashboard();
  return undefined;
}

document.querySelector('[data-error]').addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) loadDashboard();
});

/* --------------------------------------------------------------- Start */

async function start() {
  let data;
  try {
    data = await api('/session');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      showBootError();
      handleError(err);
      return;
    }
    // Keine Session: der Server sagt, ob angemeldet oder eingerichtet wird.
    const { needsSetup } = await api('/setup').catch(() => ({ needsSetup: false }));
    bindLanguageEvents();
    onLanguageChange(renderGate);
    bindForm('login', [
      { name: 'email', required: true, email: true },
      { name: 'password', required: true },
    ], (values) => api('/session', { method: 'POST', body: values }));
    bindForm('setup', [
      { name: 'businessName', required: true, min: 2, max: 120 },
      { name: 'ownerName', required: true, min: 2, max: 120 },
      { name: 'email', required: true, email: true },
      { name: 'password', required: true, min: 10, max: 200 },
    ], (values) => api('/setup', { method: 'POST', body: values }));
    showView(needsSetup ? 'setup' : 'login');
    return;
  }

  const user = await requireSession('dashboard', data);
  if (!user) return;
  onLanguageChange(renderDashboard);
  await loadDashboard();
}

start().catch((err) => {
  showBootError();
  handleError(err);
});
