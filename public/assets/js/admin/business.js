/* /admin/business — Betriebsdaten, Zeitzone, Buchungsregeln (GET/PATCH /api/admin/settings).

   Öffnungszeiten haben in der Datenbank keine eigene Tabelle: gebucht werden
   kann, wann aktive Mitarbeiter arbeiten (working_hours). Diese Seite zeigt sie
   deshalb zusammengefasst an und verweist zum Bearbeiten auf die Mitarbeiter —
   ohne das Schema zu ändern. */
import { t, tn, onLanguageChange } from './i18n.js';
import {
  api, ApiError, session, setTimezone, escapeHtml, weekdayName, WEEK_ORDER, fmtDayKey,
} from './core.js';
import {
  icon, toast, handleError, errorState, skeletonList, validate, clearErrors, showFormError, setBusy, uploadImage,
} from './ui.js';
import { requireSession, refreshShell } from './shell.js';

const form = document.querySelector('[data-business-form]');
const DEFAULT_TIMEZONE = 'Europe/Vienna';
const PREFERRED_ZONES = ['Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/Istanbul', 'Europe/Moscow', 'UTC'];

const state = { business: null, employees: null, error: null, closures: null, closuresError: null, hero: null };
const holidaysBox = document.querySelector('[data-holidays]');
const closuresBox = document.querySelector('[data-closures]');
const closureForm = document.querySelector('[data-closure-form]');

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
  state.hero = business.heroMediaId ? { mediaId: business.heroMediaId, url: business.heroUrl } : null;
  renderHero();
}

/* ------------------------------------------------------------- Titelbild
   Wie beim Mitarbeiterfoto: das Bild wandert beim Auswählen sofort nach oben,
   zugeordnet wird es erst mit „Speichern". */
const heroPreview = document.querySelector('[data-hero-preview]');
const heroInput = document.querySelector('[data-hero-input]');
const heroStatus = document.querySelector('[data-hero-status]');

function renderHero(statusKey = 'business.heroStatus') {
  heroPreview.innerHTML = state.hero
    ? `<img src="${escapeHtml(state.hero.url)}" alt="" class="h-full w-full object-cover">`
    : `<span class="text-fg-muted">${icon('image')}</span>`;
  document.querySelector('[data-hero-remove]').hidden = !state.hero;
  heroStatus.textContent = t(state.hero ? statusKey : 'business.heroEmpty');
}

heroInput.addEventListener('change', async () => {
  const [file] = heroInput.files;
  heroInput.value = '';
  if (!file) return;
  heroStatus.textContent = t('business.heroUploading');
  heroInput.disabled = true;
  try {
    const media = await uploadImage(file);
    state.hero = { mediaId: media.id, url: media.url };
    renderHero('business.heroReady');
  } catch (err) {
    renderHero();
    showFormError(form, err);
  } finally {
    heroInput.disabled = false;
  }
});

document.querySelector('[data-hero-remove]').addEventListener('click', () => {
  state.hero = null;
  renderHero();
});

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
        heroMediaId: state.hero?.mediaId ?? null,
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

/* ------------------------------------------------- Feiertage und Schließtage
   Feiertage berechnet der Server (Österreich); hier wird nur festgelegt, ob der
   Salon an einem davon trotzdem öffnet. Eigene Schließtage kommen dazu. */

const dayLabel = (date) => fmtDayKey(date, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

function renderClosures() {
  if (state.closuresError) {
    holidaysBox.innerHTML = errorState(state.closuresError);
    closuresBox.innerHTML = '';
    return;
  }
  if (!state.closures) {
    holidaysBox.innerHTML = skeletonList(2);
    closuresBox.innerHTML = '';
    return;
  }

  holidaysBox.innerHTML = `<ul class="grid gap-1.5">${state.closures.holidays.map((holiday) => `
    <li class="flex min-h-[48px] flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-3 py-1.5">
      <span class="min-w-0">
        <span class="font-medium text-fg">${escapeHtml(t(`holidays.${holiday.key}`))}</span>
        <span class="tnum ml-1 text-[13px] text-fg-muted">${escapeHtml(dayLabel(holiday.date))}</span>
      </span>
      <label class="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px] text-fg-body">
        <input type="checkbox" class="adm-check" data-holiday="${holiday.key}" ${holiday.closed ? 'checked' : ''}>
        <span>${escapeHtml(t('business.holidayClosed'))}</span>
      </label>
    </li>`).join('')}</ul>`;

  closuresBox.innerHTML = state.closures.closures.length
    ? `<ul class="grid gap-1.5">${state.closures.closures.map((closure) => `
      <li class="flex min-h-[48px] items-center justify-between gap-3 rounded-md border border-line px-3 py-1.5">
        <span class="min-w-0 break-words">
          <span class="tnum font-medium text-fg">${escapeHtml(dayLabel(closure.date))}</span>
          ${closure.label ? `<span class="text-fg-body"> · ${escapeHtml(closure.label)}</span>` : ''}
        </span>
        <button type="button" class="adm-icon-btn adm-icon-btn-plain h-10 w-10 hover:text-danger" data-remove-closure="${closure.id}"
          aria-label="${escapeHtml(t('business.removeClosure'))}" title="${escapeHtml(t('business.removeClosure'))}">${icon('trash')}</button>
      </li>`).join('')}</ul>`
    : `<p class="text-[13px] text-fg-muted">${escapeHtml(t('business.noClosures'))}</p>`;
}

async function loadClosures() {
  state.closuresError = null;
  try {
    state.closures = await api('/closures');
    if (!closureForm.elements.date.value) closureForm.elements.date.value = state.closures.today;
    closureForm.elements.date.min = state.closures.today;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.closuresError = err;
  }
  renderClosures();
  return undefined;
}

holidaysBox.addEventListener('change', async (event) => {
  const checkbox = event.target.closest('[data-holiday]');
  if (!checkbox) return;
  checkbox.disabled = true;
  try {
    state.closures = await api('/closures/holiday', {
      method: 'POST', body: { key: checkbox.dataset.holiday, closed: checkbox.checked },
    });
    renderClosures();
    toast(t('business.holidaySaved'));
  } catch (err) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    handleError(err);
  }
});
holidaysBox.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) loadClosures();
});

closuresBox.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-closure]');
  if (!button) return;
  setBusy(button, true);
  try {
    await api(`/closures/${button.dataset.removeClosure}`, { method: 'DELETE' });
    toast(t('business.closureRemoved'));
    await loadClosures();
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
});

closureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate(closureForm, [{ name: 'date', required: true }, { name: 'label', max: 120 }])) return;
  const submit = closureForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    const result = await api('/closures', {
      method: 'POST',
      body: { date: closureForm.elements.date.value, label: closureForm.elements.label.value.trim() || null },
    });
    closureForm.elements.label.value = '';
    if (result.conflictingBookings) toast(tn('business.closureConflicts', result.conflictingBookings), 'warn');
    else toast(t('business.closureAdded'));
    await loadClosures();
  } catch (err) {
    showFormError(closureForm, err);
  } finally {
    setBusy(submit, false);
  }
});

onLanguageChange(() => {
  if (state.business) renderTimezones(form.elements.timezone.value);
  clearErrors(form);
  clearErrors(closureForm);
  render();
  renderClosures();
});

(async () => {
  const user = await requireSession('business');
  if (!user) return;
  renderClosures();
  await Promise.all([load(), loadClosures()]);
})().catch(handleError);
