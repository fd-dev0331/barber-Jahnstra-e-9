/* /admin/google — Status der Google-Anbindung, Kalender, Zuordnung je Mitarbeiter.

   Der OAuth-Flow selbst bleibt unverändert in api/google/[...path].js: diese
   Seite verlinkt nur /api/google/start. Sie sieht weder Client-Secret noch
   Tokens — GET /api/admin/google liefert davon nichts (info.md §11). */
import { t, has, onLanguageChange } from './i18n.js';
import { api, ApiError, escapeHtml, fmtDate } from './core.js';
import { icon, activeBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList } from './ui.js';
import { requireSession } from './shell.js';

const statusBox = document.querySelector('[data-status]');
const calendarsBox = document.querySelector('[data-calendars]');
const assignBox = document.querySelector('[data-assign]');
const helpBox = document.querySelector('[data-setup-help]');

const state = { data: null, error: null };

function statusCard(data) {
  if (!data.configured) {
    return `<div class="adm-callout adm-callout-warn">${icon('alert')}
      <div class="min-w-0 flex-1">
        <p class="font-semibold text-fg">${escapeHtml(t('google.notConfiguredTitle'))}</p>
        <p class="mt-1">${escapeHtml(t('google.notConfiguredText'))}</p>
      </div>
    </div>`;
  }

  const connectHref = '/api/google/start';
  if (!data.connected) {
    return `<div class="adm-card adm-card-pad">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2">
            <span class="adm-badge st-inactive">${icon('unlink')}<span>${escapeHtml(t('google.notConnected'))}</span></span>
          </p>
          <p class="mt-3 max-w-2xl text-sm text-fg-body">${escapeHtml(t('google.notConnectedText'))}</p>
          ${data.lastError ? `<p class="mt-3 text-[13px] text-danger">${escapeHtml(t('google.lastError'))}: <span class="adm-code">${escapeHtml(data.lastError)}</span></p>` : ''}
        </div>
        <a class="adm-btn-primary" href="${connectHref}">${icon('link')}<span>${escapeHtml(t('google.connect'))}</span></a>
      </div>
    </div>`;
  }

  return `<div class="adm-card adm-card-pad border-ok/40">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0">
        <p><span class="adm-badge st-ok">${icon('checkCircle')}<span>${escapeHtml(t('google.connected'))}</span></span></p>
        <dl class="adm-dl mt-3">
          <dt>${escapeHtml(t('google.account'))}</dt>
          <dd>${data.account?.email ? escapeHtml(data.account.email) : `<span class="text-fg-muted">${escapeHtml(t('google.accountUnknown'))}</span>`}</dd>
          ${data.account?.connectedAt ? `<dt>${escapeHtml(t('google.connectedSince'))}</dt><dd class="tnum">${escapeHtml(fmtDate(data.account.connectedAt))}</dd>` : ''}
          <dt>${escapeHtml(t('google.calendars'))}</dt>
          <dd class="tnum">${Array.isArray(data.calendars) ? escapeHtml(String(data.calendars.length)) : '—'}</dd>
        </dl>
        ${data.lastError ? `<p class="mt-3 text-[13px] text-danger">${escapeHtml(t('google.lastError'))}: <span class="adm-code">${escapeHtml(data.lastError)}</span></p>` : ''}
        ${data.calendarError ? `<p class="mt-3 text-[13px] text-danger">${escapeHtml(t('google.calendarListFailed'))}</p>` : ''}
      </div>
      <div class="flex flex-wrap gap-2">
        <a class="adm-btn-ghost adm-btn-sm" href="${connectHref}">${icon('refresh')}<span>${escapeHtml(t('google.reconnect'))}</span></a>
        <button type="button" class="adm-btn-danger adm-btn-sm" data-disconnect>${icon('unlink')}<span>${escapeHtml(t('google.disconnect'))}</span></button>
      </div>
    </div>
  </div>`;
}

function calendarsList(data) {
  if (!data.connected) return emptyState({ title: t('google.calendarsNeedConnection') });
  if (!Array.isArray(data.calendars)) return `<p class="text-sm text-danger">${escapeHtml(t('google.calendarListFailed'))}</p>`;
  if (!data.calendars.length) return emptyState({ title: t('google.noCalendars') });

  return `<ul class="grid gap-2">${data.calendars.map((calendar) => {
    const assigned = data.employees.filter((e) => e.googleCalendarId === calendar.id);
    return `<li class="rounded-md border border-line bg-surface-2 px-3 py-2.5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="min-w-0 break-words font-medium text-fg">${escapeHtml(calendar.summary)}</span>
        ${calendar.primary ? `<span class="adm-badge st-gold">${escapeHtml(t('google.primary'))}</span>` : ''}
      </div>
      <p class="mt-1 text-xs text-fg-muted">${assigned.length
        ? `${escapeHtml(t('google.usedBy'))}: ${escapeHtml(assigned.map((e) => e.name).join(', '))}`
        : escapeHtml(t('google.unused'))}</p>
    </li>`;
  }).join('')}</ul>`;
}

function assignRows(data) {
  if (!data.employees.length) return emptyState({ title: t('employees.empty') });
  const calendars = Array.isArray(data.calendars) ? data.calendars : [];

  return data.employees.map((employee) => {
    const options = [`<option value="">${escapeHtml(t('employees.noCalendar'))}</option>`]
      .concat(calendars.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === employee.googleCalendarId ? 'selected' : ''}>${escapeHtml(c.summary)}${c.primary ? ` (${escapeHtml(t('google.primary'))})` : ''}</option>`));
    // Eine gespeicherte Kennung bleibt sichtbar, auch wenn die Liste sie gerade nicht enthält.
    if (employee.googleCalendarId && !calendars.some((c) => c.id === employee.googleCalendarId)) {
      options.push(`<option value="${escapeHtml(employee.googleCalendarId)}" selected>${escapeHtml(employee.googleCalendarId)}</option>`);
    }
    const selectId = `cal-${employee.id}`;
    return `<div class="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
      <label class="flex min-w-0 flex-wrap items-center gap-2" for="${selectId}">
        <span class="min-w-0 break-words font-medium text-fg">${escapeHtml(employee.name)}</span>
        ${employee.status === 'INACTIVE' ? activeBadge(false) : ''}
      </label>
      <select class="adm-input" id="${selectId}" data-employee="${employee.id}" ${data.connected && Array.isArray(data.calendars) ? '' : 'disabled'}>
        ${options.join('')}
      </select>
    </div>`;
  }).join('');
}

function setupHelp(redirectUri) {
  const steps = [
    t('google.step1'),
    t('google.step2'),
    t('google.step3'),
    `${escapeHtml(t('google.step4'))} <span class="adm-code">${escapeHtml(redirectUri ?? t('google.redirectMissing'))}</span>`,
    t('google.step5'),
    t('google.step6'),
  ];
  return `<ol class="grid gap-3">${steps.map((step, index) => `<li class="flex gap-3">
      <span class="tnum w-5 shrink-0 font-semibold text-accent">${index + 1}.</span>
      <span class="min-w-0 break-words">${index === 3 ? step : escapeHtml(step)}</span>
    </li>`).join('')}</ol>`;
}

function render() {
  if (state.error) {
    statusBox.innerHTML = errorState(state.error);
    calendarsBox.innerHTML = '';
    assignBox.innerHTML = '';
    helpBox.innerHTML = setupHelp(null);
    return;
  }
  if (!state.data) {
    statusBox.innerHTML = skeletonList(1);
    calendarsBox.innerHTML = skeletonList(2);
    assignBox.innerHTML = skeletonList(2);
    helpBox.innerHTML = '';
    return;
  }
  statusBox.innerHTML = statusCard(state.data);
  calendarsBox.innerHTML = calendarsList(state.data);
  assignBox.innerHTML = assignRows(state.data);
  helpBox.innerHTML = setupHelp(state.data.redirectUri);
}

async function load() {
  state.error = null;
  state.data = null;
  render();
  try {
    state.data = await api('/google');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.error = err;
  }
  render();
  return undefined;
}

statusBox.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return load();
  if (!event.target.closest('[data-disconnect]')) return undefined;
  const confirmed = await confirmDialog({
    title: t('google.disconnectTitle'),
    message: t('google.disconnectMessage'),
    confirmLabel: t('google.disconnect'),
    danger: true,
  });
  if (!confirmed) return undefined;
  try {
    await api('/google/disconnect', { method: 'POST' });
    toast(t('google.disconnected'));
    await load();
  } catch (err) {
    handleError(err);
  }
  return undefined;
});

assignBox.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-employee]');
  if (!select) return;
  select.disabled = true;
  try {
    // Die Antwort ist der aktuelle Status inklusive Zuordnungen.
    state.data = await api('/google/calendar', {
      method: 'POST',
      body: { employeeId: select.dataset.employee, googleCalendarId: select.value || null },
    });
    render();
    toast(t('google.assigned'));
  } catch (err) {
    handleError(err);
    await load();
  }
});

onLanguageChange(render);

(async () => {
  const user = await requireSession('google');
  if (!user) return;

  // Rückmeldung aus dem OAuth-Callback sichtbar machen.
  const params = new URL(window.location.href).searchParams;
  if (params.get('connected')) toast(t('google.connectedToast'));
  const callbackError = params.get('error');
  if (callbackError) {
    const key = `google.callbackErrors.${callbackError}`;
    toast(has(key) ? t(key) : t('google.callbackErrors.generic'), 'error');
  }
  if ([...params.keys()].length) window.history.replaceState({}, '', '/admin/google');

  await load();
})().catch(handleError);
