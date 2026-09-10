/* /admin/calendar — Tag, Woche, kommende Termine.
   Dieselben Daten wie die Terminliste (GET /api/admin/bookings), gruppiert nach
   Kalendertagen in der Geschäftszeitzone — nie in der des Browsers (info.md §23). */
import { t, tn, onLanguageChange } from './i18n.js';
import {
  api, ApiError, session, canManage, escapeHtml, fmtTime, fmtDayKey, dayKey, todayKey, shiftDay, mondayOf,
  getTimezone,
} from './core.js';
import { statusBadge, handleError, emptyState, errorState, skeletonList } from './ui.js';
import { requireSession } from './shell.js';

const view = document.querySelector('[data-calendar]');
const employeeSelect = document.querySelector('#c-employee');
const UPCOMING_DAYS = 30;

const state = { mode: 'week', anchor: null, bookings: null, error: null, employees: null };
let loadToken = 0;

function range() {
  if (state.mode === 'day') return { from: state.anchor, to: state.anchor };
  if (state.mode === 'week') {
    const monday = mondayOf(state.anchor);
    return { from: monday, to: shiftDay(monday, 6) };
  }
  const today = todayKey();
  return { from: today, to: shiftDay(today, UPCOMING_DAYS) };
}

function entry(booking, { compact = false } = {}) {
  const href = `/admin/bookings?q=${encodeURIComponent(booking.reference)}`;
  if (compact) {
    return `<a class="block rounded-md border border-line bg-surface-2 p-2 no-underline transition-colors hover:border-line-strong" href="${href}">
      <span class="tnum block text-[13px] font-semibold text-fg">${escapeHtml(fmtTime(booking.start))}–${escapeHtml(fmtTime(booking.end))}</span>
      <span class="block truncate text-[13px] text-fg-body">${escapeHtml(booking.customer.name)}</span>
      <span class="block truncate text-xs text-fg-muted">${escapeHtml(booking.service.name)}</span>
      <span class="block truncate text-xs text-fg-muted">${escapeHtml(booking.employee.name)}</span>
      <span class="mt-1.5 block">${statusBadge(booking.status)}</span>
    </a>`;
  }
  return `<a class="adm-item flex min-w-0 gap-3 no-underline transition-colors hover:border-line-strong sm:gap-4" href="${href}">
    <span class="tnum w-[52px] shrink-0 pt-0.5 text-sm font-semibold text-fg">${escapeHtml(fmtTime(booking.start))}
      <span class="block text-xs font-normal text-fg-muted">${escapeHtml(fmtTime(booking.end))}</span></span>
    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium text-fg">${escapeHtml(booking.customer.name)}</span>
      <span class="mt-0.5 block break-words text-[13px] text-fg-muted">${escapeHtml(booking.service.name)} · ${escapeHtml(booking.employee.name)}</span>
    </span>
    <span class="shrink-0">${statusBadge(booking.status)}</span>
  </a>`;
}

const byDay = (bookings, key) => bookings
  .filter((b) => dayKey(b.start) === key)
  .sort((a, b) => new Date(a.start) - new Date(b.start));

function renderToolbar() {
  document.querySelector('[data-timezone]').textContent = t('calendar.timezoneNote', { timezone: getTimezone() });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  });

  const nav = document.querySelector('[data-nav]');
  const { from, to } = range();
  const label = document.querySelector('[data-range]');
  if (state.mode === 'day') {
    label.textContent = fmtDayKey(from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (state.mode === 'week') {
    label.textContent = `${fmtDayKey(from, { day: 'numeric', month: 'short' })} – ${fmtDayKey(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else {
    label.textContent = tn('calendar.nextDays', UPCOMING_DAYS);
  }
  nav.querySelectorAll('[data-prev], [data-next], [data-date]').forEach((node) => {
    node.closest('div.w-full, button').hidden = state.mode === 'upcoming';
  });
  const step = state.mode === 'day' ? 'calendar.prevDay' : 'calendar.prevWeek';
  nav.querySelector('[data-prev]').setAttribute('aria-label', t(step));
  nav.querySelector('[data-next]').setAttribute('aria-label', t(state.mode === 'day' ? 'calendar.nextDay' : 'calendar.nextWeek'));
  nav.querySelector('[data-date]').value = state.anchor;

  if (canManage(session.user) && state.employees) {
    const current = employeeSelect.value;
    employeeSelect.innerHTML = `<option value="">${escapeHtml(t('calendar.allEmployees'))}</option>${state.employees
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.status === 'INACTIVE' ? ` (${escapeHtml(t('common.inactive'))})` : ''}</option>`)
      .join('')}`;
    employeeSelect.value = current;
    document.querySelector('[data-employee-filter]').hidden = false;
  }
}

function renderView() {
  if (state.error) {
    view.innerHTML = errorState(state.error);
    return;
  }
  if (!state.bookings) {
    view.innerHTML = skeletonList(state.mode === 'week' ? 4 : 3);
    return;
  }
  // Stornierte Termine blockieren nichts und würden den Tag nur unübersichtlich machen.
  const active = state.bookings.filter((b) => b.status !== 'CANCELLED');
  const today = todayKey();

  if (state.mode === 'day') {
    const entries = byDay(active, state.anchor);
    view.innerHTML = entries.length
      ? `<p class="mb-3 text-[13px] text-fg-muted">${escapeHtml(tn('dashboard.bookingsCount', entries.length))}</p>
         <div class="adm-list">${entries.map((b) => entry(b)).join('')}</div>`
      : emptyState({ title: t('calendar.dayEmpty') });
    return;
  }

  if (state.mode === 'week') {
    const monday = mondayOf(state.anchor);
    view.innerHTML = `<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-7">${Array.from({ length: 7 }, (_, index) => {
      const key = shiftDay(monday, index);
      const entries = byDay(active, key);
      const isToday = key === today;
      return `<section class="min-w-0 rounded-lg border ${isToday ? 'border-accent' : 'border-line'} bg-surface p-3" aria-label="${escapeHtml(fmtDayKey(key, { weekday: 'long', day: 'numeric', month: 'long' }))}">
        <h2 class="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold ${isToday ? 'text-accent' : 'text-fg'}">
          <span class="truncate">${escapeHtml(fmtDayKey(key, { weekday: 'short', day: '2-digit', month: '2-digit' }))}</span>
          ${entries.length ? `<span class="tnum text-xs font-medium text-fg-muted">${entries.length}</span>` : ''}
        </h2>
        <div class="grid gap-2">${entries.length
          ? entries.map((b) => entry(b, { compact: true })).join('')
          : `<p class="text-[13px] text-fg-muted">${escapeHtml(t('calendar.free'))}</p>`}</div>
      </section>`;
    }).join('')}</div>`;
    return;
  }

  // Kommend: ab jetzt, nach Tagen gruppiert.
  const now = Date.now();
  const upcoming = active
    .filter((b) => new Date(b.end).getTime() >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!upcoming.length) {
    view.innerHTML = emptyState({ title: t('calendar.upcomingEmpty') });
    return;
  }
  const days = [...new Set(upcoming.map((b) => dayKey(b.start)))];
  view.innerHTML = days.map((key) => `<section class="mb-5">
      <h2 class="adm-h2 mb-2 ${key === today ? 'text-accent' : ''}">${escapeHtml(key === today
        ? `${t('calendar.today')} · ${fmtDayKey(key, { day: 'numeric', month: 'long' })}`
        : fmtDayKey(key, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
      <div class="adm-list">${byDay(upcoming, key).map((b) => entry(b)).join('')}</div>
    </section>`).join('');
}

async function load() {
  const token = ++loadToken;
  state.bookings = null;
  state.error = null;
  renderToolbar();
  renderView();

  const { from, to } = range();
  const params = new URLSearchParams({ from, to });
  if (employeeSelect.value) params.set('employeeId', employeeSelect.value);
  try {
    const { bookings } = await api(`/bookings?${params}`);
    if (token !== loadToken) return;
    state.bookings = bookings;
  } catch (err) {
    if (token !== loadToken) return;
    if (err instanceof ApiError && err.status === 401) {
      handleError(err);
      return;
    }
    state.error = err;
  }
  renderView();
}

document.querySelectorAll('[data-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    load();
  });
});
document.querySelector('[data-prev]').addEventListener('click', () => {
  state.anchor = shiftDay(state.anchor, state.mode === 'day' ? -1 : -7);
  load();
});
document.querySelector('[data-next]').addEventListener('click', () => {
  state.anchor = shiftDay(state.anchor, state.mode === 'day' ? 1 : 7);
  load();
});
document.querySelector('[data-today]').addEventListener('click', () => {
  state.anchor = todayKey();
  if (state.mode === 'upcoming') state.mode = 'day';
  load();
});
document.querySelector('[data-date]').addEventListener('change', (event) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
    state.anchor = event.target.value;
    load();
  }
});
employeeSelect.addEventListener('change', load);
view.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) load();
});

onLanguageChange(() => {
  renderToolbar();
  renderView();
});

(async () => {
  const user = await requireSession('calendar');
  if (!user) return;
  // Erst nach requireSession steht die Geschäftszeitzone fest.
  state.anchor = todayKey();
  // Auf dem Telefon ist eine Woche mit sieben Spalten zu eng — dort startet der Tag.
  if (window.matchMedia('(max-width: 767px)').matches) state.mode = 'day';
  renderToolbar();
  renderView(); // Ladezustand sofort, nicht erst nach der Mitarbeiterliste
  if (canManage(user)) {
    state.employees = (await api('/employees').catch(() => null))?.employees ?? null;
  }
  await load();
})().catch(handleError);
