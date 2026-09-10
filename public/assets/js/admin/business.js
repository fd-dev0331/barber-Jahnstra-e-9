/* /admin/business — Betriebsdaten, Zeitzone, Buchungsregeln (GET/PATCH /api/admin/settings).

   Öffnungszeiten haben in der Datenbank keine eigene Tabelle: gebucht werden
   kann, wann aktive Mitarbeiter arbeiten (working_hours). Diese Seite zeigt sie
   deshalb zusammengefasst an und verweist zum Bearbeiten auf die Mitarbeiter —
   ohne das Schema zu ändern. */
import { t, onLanguageChange } from './i18n.js';
import { api, ApiError, session, setTimezone, escapeHtml, weekdayName, WEEK_ORDER } from './core.js';
import {
  toast, handleError, errorState, skeletonList, validate, clearErrors, showFormError, setBusy,
} from './ui.js';
import { requireSession, refreshShell } from './shell.js';

const form = document.querySelector('[data-business-form]');
const DEFAULT_TIMEZONE = 'Europe/Vienna';
const PREFERRED_ZONES = ['Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Istanbul', 'Europe/Moscow', 'UTC'];

const state = { business: null, employees: null, error: null };

function renderTimezones(selected) {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const rest = all.filter((zone) => !PREFERRED_ZONES.includes(zone));
  if (selected && !PREFERRED_ZONES.includes(selected) && !rest.includes(selected)) rest.unshift(selected);
  form.elements.timezone.innerHTML = `
    <optgroup label="${escapeHtml(t('business.timezoneCommon'))}">${PREFERRED_ZONES.map((z) => `<option value="${z}">${z}</option>`).join('')}</optgroup>
    ${rest.length ? `<optgroup label="${escapeHtml(t('business.timezoneAll'))}">${rest.map((z) => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join('')}</optgroup>` : ''}`;
  form.elements.timezone.value = selected || DEFAULT_TIMEZONE;
}

function fillForm(business) {
  const f = form.elements;
  f.name.value = business.name ?? '';
  f.address.value = business.address ?? '';
  f.phone.value = business.phone ?? '';
  f.email.value = business.email ?? '';
  f.instagram.value = business.instagram ?? '';
  f.slotStepMinutes.value = business.slotStepMinutes;
  f.leadTimeMinutes.value = business.leadTimeMinutes;
  f.maxAdvanceDays.value = business.maxAdvanceDays;
  renderTimezones(business.timezone || DEFAULT_TIMEZONE);
}

/** Vereinigung der Schichten aller aktiven Mitarbeiter je Wochentag. */
function openingIntervals(weekday) {
  const shifts = (state.employees ?? [])
    .filter((e) => e.status === 'ACTIVE')
    .flatMap((e) => e.workingHours.filter((h) => h.weekday === weekday && !h.isBreak))
    .map((h) => [h.start, h.end])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const merged = [];
  for (const [start, end] of shifts) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = end > last[1] ? end : last[1];
    else merged.push([start, end]);
  }
  return merged;
}

function renderHours() {
  const box = document.querySelector('[data-hours]');
  if (!state.employees) {
    box.innerHTML = skeletonList(1);
    return;
  }
  box.innerHTML = `<dl class="adm-dl">${WEEK_ORDER.map((weekday) => {
    const intervals = openingIntervals(weekday);
    return `<dt>${escapeHtml(weekdayName(weekday))}</dt>
      <dd class="tnum">${intervals.length
        ? escapeHtml(intervals.map(([s, e]) => `${s}–${e}`).join(', '))
        : `<span class="text-fg-muted">${escapeHtml(t('business.closed'))}</span>`}</dd>`;
  }).join('')}</dl>`;
}

function render() {
  const errorBox = document.querySelector('[data-error]');
  if (state.error) {
    errorBox.innerHTML = errorState(state.error);
    form.hidden = true;
  } else {
    errorBox.innerHTML = state.business ? '' : skeletonList(2);
    form.hidden = !state.business;
  }
  renderHours();
}

async function load() {
  state.error = null;
  state.business = null;
  render();
  try {
    const [{ business }, { employees }] = await Promise.all([api('/settings'), api('/employees')]);
    state.business = business;
    state.employees = employees;
    fillForm(business);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.error = err;
  }
  render();
  return undefined;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = validate(form, [
    { name: 'name', required: true, min: 2, max: 120 },
    { name: 'email', required: true, email: true, max: 200 },
    { name: 'address', max: 200 },
    { name: 'phone', max: 40 },
    { name: 'instagram', max: 200 },
    { name: 'timezone', required: true },
    { name: 'slotStepMinutes', required: true, number: true, integer: true, minValue: 5, maxValue: 120 },
    { name: 'leadTimeMinutes', required: true, number: true, integer: true, minValue: 0, maxValue: 10080 },
    { name: 'maxAdvanceDays', required: true, number: true, integer: true, minValue: 1, maxValue: 365 },
  ]);
  if (!ok) return;

  const f = form.elements;
  const submit = form.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    const { business } = await api('/settings', {
      method: 'PATCH',
      body: {
        name: f.name.value.trim(),
        timezone: f.timezone.value,
        address: f.address.value.trim(),
        phone: f.phone.value.trim(),
        email: f.email.value.trim(),
        instagram: f.instagram.value.trim() || null,
        slotStepMinutes: Number(f.slotStepMinutes.value),
        leadTimeMinutes: Number(f.leadTimeMinutes.value),
        maxAdvanceDays: Number(f.maxAdvanceDays.value),
      },
    });
    state.business = business;
    fillForm(business);
    // Kopfzeile und Zeitformate sofort nachziehen.
    session.business = { ...session.business, name: business.name, timezone: business.timezone };
    setTimezone(business.timezone);
    refreshShell();
    toast(t('common.saved'));
  } catch (err) {
    showFormError(form, err);
  } finally {
    setBusy(submit, false);
  }
});

document.querySelector('[data-error]').addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) load();
});

onLanguageChange(() => {
  if (state.business) renderTimezones(form.elements.timezone.value);
  clearErrors(form);
  render();
});

(async () => {
  const user = await requireSession('business');
  if (!user) return;
  await load();
})().catch(handleError);
