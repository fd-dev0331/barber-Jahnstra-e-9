/* /admin/bookings — Terminliste, Details, Statuswechsel, manueller Termin (info.md §18, §21).

   Ein Mitarbeiter bekommt von GET /api/admin/bookings ohnehin nur die eigenen
   Termine und darf nur für sich selbst eintragen — beides setzt das Backend durch. */
import { t, tn, onLanguageChange } from './i18n.js';
import {
  api, publicApi, ApiError, session, canManage, escapeHtml, errorMessage, fmtDate, fmtTime, fmtDateTime,
  fmtPrice, fmtMinutes, todayKey, timeKey, shiftDay, businessTimeToUtc, BOOKING_STATUSES,
} from './core.js';
import {
  icon, statusBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList, bindDialog,
  validate, clearErrors, showFormError, setBusy,
} from './ui.js';
import { requireSession } from './shell.js';
import { canPerform } from './assignments.js';

const filters = document.querySelector('[data-filters]');
const results = document.querySelector('[data-results]');
const detailDialog = document.querySelector('[data-detail-dialog]');
const newDialog = document.querySelector('[data-new-dialog]');
const newForm = newDialog.querySelector('[data-new-form]');
const slotsBox = newForm.querySelector('[data-slots]');

const ACTIVE = ['PENDING', 'CONFIRMED'];
/* Aus STORNIERT führt kein Weg zurück: der Kalendereintrag ist dann gelöscht und
   der Platz womöglich neu vergeben. Stattdessen einen neuen Termin eintragen. */
const STATUS_ACTIONS = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
const LIMIT = 500; // Obergrenze in lib/admin/bookings.js

const state = {
  view: 'upcoming',
  bookings: null,
  error: null,
  employees: null,
  services: null,
  detailId: null,
  openSingle: false,
};
let loadToken = 0;

const canCreate = () => canManage(session.user) || Boolean(session.employee && session.employee.status !== 'INACTIVE');
const findBooking = (id) => state.bookings?.find((b) => b.id === id);

/* ---------------------------------------------------------------- Filter */

function renderFilterOptions() {
  const status = filters.elements.status;
  const selected = status.value;
  status.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>${BOOKING_STATUSES
    .map((s) => `<option value="${s}">${escapeHtml(t(`status.${s}`))}</option>`).join('')}`;
  status.value = selected;

  if (canManage(session.user) && state.employees) {
    const employee = filters.elements.employeeId;
    const current = employee.value;
    employee.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>${state.employees
      .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.status === 'INACTIVE' ? ` (${escapeHtml(t('common.inactive'))})` : ''}</option>`)
      .join('')}`;
    employee.value = current;
    filters.querySelector('[data-employee-filter]').hidden = false;
  }

  filters.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  });
}

function queryParams() {
  const f = filters.elements;
  const params = new URLSearchParams();
  const today = todayKey();
  if (state.view === 'upcoming') params.set('from', today);
  if (state.view === 'today') { params.set('from', today); params.set('to', today); }
  if (state.view === 'past') params.set('to', shiftDay(today, -1));
  if (state.view === 'custom') {
    if (f.from.value) params.set('from', f.from.value);
    if (f.to.value) params.set('to', f.to.value);
  }
  if (f.status.value) params.set('status', f.status.value);
  if (f.employeeId.value) params.set('employeeId', f.employeeId.value);
  const q = f.q.value.trim();
  if (q) params.set('q', q.slice(0, 60));
  return params;
}

filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) {
    state.view = button.dataset.view;
    filters.elements.from.value = '';
    filters.elements.to.value = '';
    renderFilterOptions();
    load();
    return;
  }
  if (event.target.closest('[data-reset]')) {
    filters.reset();
    state.view = 'upcoming';
    renderFilterOptions();
    load();
  }
});

filters.addEventListener('change', (event) => {
  if (event.target.name === 'from' || event.target.name === 'to') {
    state.view = filters.elements.from.value || filters.elements.to.value ? 'custom' : 'all';
    renderFilterOptions();
  }
  if (['from', 'to', 'status', 'employeeId'].includes(event.target.name)) load();
});

filters.addEventListener('submit', (event) => {
  event.preventDefault();
  load();
});

/* ----------------------------------------------------------------- Liste */

function actionButtons(booking, { compact = false } = {}) {
  const details = escapeHtml(t('common.details'));
  const buttons = [compact
    ? `<button type="button" class="adm-icon-btn h-10 w-10" data-detail="${booking.id}"
        aria-label="${details}: ${escapeHtml(booking.customer.name)}" title="${details}">${icon('eye')}</button>`
    : `<button type="button" class="adm-btn-ghost adm-btn-sm" data-detail="${booking.id}">
        ${icon('eye')}<span>${details}</span></button>`];
  if (booking.status === 'PENDING' && !compact) {
    buttons.push(`<button type="button" class="adm-btn-ghost adm-btn-sm" data-status="CONFIRMED" data-id="${booking.id}">
      ${icon('checkCircle')}<span>${escapeHtml(t('bookings.actionConfirm'))}</span></button>`);
  }
  if (ACTIVE.includes(booking.status)) {
    const label = escapeHtml(t('bookings.actionCancel'));
    buttons.push(compact
      ? `<button type="button" class="adm-icon-btn h-10 w-10 hover:border-danger hover:text-danger" data-status="CANCELLED" data-id="${booking.id}"
          aria-label="${label}: ${escapeHtml(booking.customer.name)}" title="${label}">${icon('xCircle')}</button>`
      : `<button type="button" class="adm-btn-danger adm-btn-sm" data-status="CANCELLED" data-id="${booking.id}">
          ${icon('xCircle')}<span>${label}</span></button>`);
  }
  /* Stornierte Termine lassen sich endgültig löschen — nur sie, und nur von der
     Leitung. Das Backend prüft beides noch einmal. */
  if (booking.status === 'CANCELLED' && canManage(session.user)) {
    const label = escapeHtml(t('bookings.delete'));
    buttons.push(compact
      ? `<button type="button" class="adm-icon-btn h-10 w-10 hover:border-danger hover:text-danger" data-remove="${booking.id}"
          aria-label="${label}: ${escapeHtml(booking.customer.name)}" title="${label}">${icon('trash')}</button>`
      : `<button type="button" class="adm-btn-danger adm-btn-sm" data-remove="${booking.id}">
          ${icon('trash')}<span>${label}</span></button>`);
  }
  return buttons.join('');
}

function tableView(bookings) {
  const rows = bookings.map((b) => `<tr>
    <td class="tnum whitespace-nowrap">${escapeHtml(fmtDate(b.start))}</td>
    <td class="tnum whitespace-nowrap">${escapeHtml(fmtTime(b.start))}–${escapeHtml(fmtTime(b.end))}</td>
    <td><div class="max-w-[160px] truncate font-medium text-fg 2xl:max-w-[260px]">${escapeHtml(b.customer.name)}</div>
        <div class="max-w-[160px] truncate text-xs text-fg-muted 2xl:max-w-[260px]">${escapeHtml(b.customer.phone)}</div></td>
    <td><div class="max-w-[180px] truncate 2xl:max-w-[320px]">${escapeHtml(b.service.name)}</div></td>
    <td><div class="max-w-[130px] truncate 2xl:max-w-[200px]">${escapeHtml(b.employee.name)}</div></td>
    <td>${statusBadge(b.status)}</td>
    <td><div class="flex justify-end gap-1.5">${actionButtons(b, { compact: true })}</div></td>
  </tr>`).join('');

  return `<div class="adm-table-wrap hidden xl:block">
    <table class="adm-table">
      <caption class="sr-only">${escapeHtml(t('nav.bookings'))}</caption>
      <thead><tr>
        <th scope="col">${escapeHtml(t('bookings.colDate'))}</th>
        <th scope="col">${escapeHtml(t('bookings.colTime'))}</th>
        <th scope="col">${escapeHtml(t('bookings.colCustomer'))}</th>
        <th scope="col">${escapeHtml(t('bookings.colService'))}</th>
        <th scope="col">${escapeHtml(t('bookings.colEmployee'))}</th>
        <th scope="col">${escapeHtml(t('bookings.colStatus'))}</th>
        <th scope="col" class="text-right">${escapeHtml(t('bookings.colActions'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function cardView(bookings) {
  const cards = bookings.map((b) => `<article class="adm-item grid min-w-0 gap-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="tnum font-semibold text-fg">${escapeHtml(fmtDate(b.start))} · ${escapeHtml(fmtTime(b.start))}–${escapeHtml(fmtTime(b.end))}</p>
        <p class="mt-0.5 truncate font-medium text-fg-body">${escapeHtml(b.customer.name)}</p>
      </div>
      <span class="shrink-0">${statusBadge(b.status)}</span>
    </div>
    <p class="break-words text-[13px] text-fg-muted">${escapeHtml(b.service.name)} · ${escapeHtml(b.employee.name)}</p>
    <div class="flex flex-wrap gap-2">${actionButtons(b)}</div>
  </article>`).join('');
  return `<div class="grid gap-2.5 md:grid-cols-2 xl:hidden">${cards}</div>`;
}

function renderResults() {
  const count = document.querySelector('[data-count]');
  if (state.error) {
    count.textContent = '';
    results.innerHTML = errorState(state.error);
    return;
  }
  if (!state.bookings) {
    count.textContent = t('common.loading');
    results.innerHTML = skeletonList(5);
    return;
  }
  const n = state.bookings.length;
  count.textContent = `${tn('bookings.count', n)}${n >= LIMIT ? ` · ${t('bookings.limitHint', { limit: LIMIT })}` : ''}`;

  if (!n) {
    results.innerHTML = emptyState({
      title: t('bookings.empty'),
      text: t('bookings.emptyHint'),
      action: canCreate()
        ? `<button type="button" class="adm-btn-primary" data-new-inline>${icon('plus')}<span>${escapeHtml(t('bookings.new'))}</span></button>`
        : '',
    });
    return;
  }
  results.innerHTML = tableView(state.bookings) + cardView(state.bookings);
}

async function load() {
  const token = ++loadToken;
  state.error = null;
  state.bookings = null;
  renderResults();
  try {
    const { bookings } = await api(`/bookings?${queryParams()}`);
    if (token !== loadToken) return;
    // Die API sortiert absteigend; für "kommend" und "heute" ist aufsteigend natürlicher.
    state.bookings = ['upcoming', 'today'].includes(state.view) ? [...bookings].reverse() : bookings;
  } catch (err) {
    if (token !== loadToken) return;
    if (err instanceof ApiError && err.status === 401) {
      handleError(err);
      return;
    }
    state.error = err;
  }
  renderResults();

  // Aus dem Dashboard kommend (?q=Referenz): ein eindeutiger Treffer öffnet gleich die Details.
  if (state.openSingle && state.bookings?.length === 1) openDetail(state.bookings[0].id);
  state.openSingle = false;
}

results.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry]')) return load();
  if (event.target.closest('[data-new-inline]')) return openNew();
  const detail = event.target.closest('[data-detail]');
  if (detail) return openDetail(detail.dataset.detail);
  const statusButton = event.target.closest('[data-status]');
  if (statusButton) return changeStatus(statusButton.dataset.id, statusButton.dataset.status, statusButton);
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton) return removeBooking(removeButton.dataset.remove, removeButton);
  return undefined;
});

/* ---------------------------------------------------------------- Details */

function detailRow(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
}

function renderDetail() {
  const booking = findBooking(state.detailId);
  const body = detailDialog.querySelector('[data-detail-body]');
  if (!booking) {
    body.innerHTML = emptyState({ title: t('errors.not_found') });
    return;
  }

  const phone = escapeHtml(booking.customer.phone);
  const email = booking.customer.email ? escapeHtml(booking.customer.email) : null;
  const rows = [
    detailRow(t('bookings.colStatus'), statusBadge(booking.status)),
    detailRow(t('bookings.colDate'), `<span class="tnum">${escapeHtml(fmtDate(booking.start))}</span>`),
    detailRow(t('bookings.colTime'), `<span class="tnum">${escapeHtml(fmtTime(booking.start))}–${escapeHtml(fmtTime(booking.end))}</span>`),
    detailRow(t('bookings.colCustomer'), escapeHtml(booking.customer.name)),
    detailRow(t('bookings.phone'), `<a class="adm-link" href="tel:${phone.replace(/\s+/g, '')}">${phone}</a>`),
    detailRow(t('bookings.email'), email ? `<a class="adm-link" href="mailto:${email}">${email}</a>` : `<span class="text-fg-muted">—</span>`),
    detailRow(t('bookings.colService'), `${escapeHtml(booking.service.name)} <span class="text-fg-muted">· ${escapeHtml(fmtMinutes(booking.service.durationMinutes))}</span>`),
    detailRow(t('bookings.colEmployee'), escapeHtml(booking.employee.name)),
    detailRow(t('bookings.note'), booking.note ? escapeHtml(booking.note) : '<span class="text-fg-muted">—</span>'),
    detailRow(t('bookings.reference'), `<span class="adm-code">${escapeHtml(booking.reference)}</span>`),
    detailRow(t('bookings.source'), escapeHtml(t(booking.source === 'MANUAL' ? 'bookings.sourceManual' : 'bookings.sourceWebsite'))),
    detailRow(t('bookings.googleCalendar'), escapeHtml(t(booking.inCalendar ? 'bookings.inCalendar' : 'bookings.notInCalendar'))),
    detailRow(t('bookings.createdAt'), `<span class="tnum">${escapeHtml(fmtDateTime(booking.createdAt))}</span>`),
  ].join('');

  const actions = booking.status === 'CANCELLED'
    ? `<p class="adm-hint mt-0">${escapeHtml(t('bookings.cancelledFinal'))}</p>
       ${canManage(session.user) ? `<button type="button" class="adm-btn-danger adm-btn-sm mt-3" data-remove="${booking.id}">
         ${icon('trash')}<span>${escapeHtml(t('bookings.delete'))}</span></button>` : ''}`
    : `<div class="flex flex-wrap gap-2">${STATUS_ACTIONS
      .filter((status) => status !== booking.status)
      .map((status) => `<button type="button" class="${status === 'CANCELLED' ? 'adm-btn-danger' : 'adm-btn-ghost'} adm-btn-sm"
          data-status="${status}" data-id="${booking.id}">${escapeHtml(t(`bookings.setStatus.${status}`))}</button>`)
      .join('')}</div>`;

  body.innerHTML = `<dl class="adm-dl">${rows}</dl>
    <div class="adm-divider my-4"></div>
    <h3 class="adm-h2 mb-3">${escapeHtml(t('bookings.changeStatus'))}</h3>
    ${actions}`;
}

function openDetail(id) {
  state.detailId = id;
  renderDetail();
  if (!detailDialog.open) detailDialog.showModal();
}

detailDialog.addEventListener('click', (event) => {
  const statusButton = event.target.closest('[data-status]');
  if (statusButton) changeStatus(statusButton.dataset.id, statusButton.dataset.status, statusButton);
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton) removeBooking(removeButton.dataset.remove, removeButton);
});
bindDialog(detailDialog);

/**
 * Stornierten Termin endgültig löschen. Danach ist er weg — kein Papierkorb,
 * keine Wiederherstellung; deshalb die Rückfrage mit Namen und Zeitpunkt.
 */
async function removeBooking(id, button) {
  const booking = findBooking(id);
  if (!booking) return;

  const ok = await confirmDialog({
    title: t('bookings.deleteTitle'),
    message: t('bookings.deleteMessage', {
      name: booking.customer.name, date: fmtDate(booking.start), time: fmtTime(booking.start),
    }),
    confirmLabel: t('bookings.delete'),
    danger: true,
  });
  if (!ok) return;

  setBusy(button, true);
  try {
    const result = await api(`/bookings/${id}`, { method: 'DELETE' });
    state.bookings = (state.bookings ?? []).filter((entry) => entry.id !== id);
    if (detailDialog.open && state.detailId === id) detailDialog.close();
    renderResults();
    if (result.warning) toast(t('bookings.deleteGoogleWarning'), 'warn');
    else toast(t('bookings.deleted'));
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
}

async function changeStatus(id, status, button) {
  const booking = findBooking(id);
  if (!booking) return;

  if (status === 'CANCELLED') {
    const ok = await confirmDialog({
      title: t('bookings.cancelTitle'),
      message: t(booking.inCalendar ? 'bookings.cancelMessageCalendar' : 'bookings.cancelMessage', {
        name: booking.customer.name, date: fmtDate(booking.start), time: fmtTime(booking.start),
      }),
      confirmLabel: t('bookings.actionCancel'),
      danger: true,
    });
    if (!ok) return;
  }

  setBusy(button, true);
  try {
    const result = await api(`/bookings/${id}`, { method: 'PATCH', body: { status } });
    booking.status = result.booking?.status ?? status;
    if (status === 'CANCELLED' && !result.warning) booking.inCalendar = false;
    renderResults();
    if (detailDialog.open) renderDetail();
    if (result.warning) toast(t('bookings.cancelGoogleWarning'), 'warn');
    else toast(t('bookings.statusChanged', { status: t(`status.${booking.status}`) }));
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
}

/* ------------------------------------------------------- manueller Termin */

async function ensureLists() {
  if (state.services && state.employees) return;
  const [serviceData, employeeData] = await Promise.all([api('/services'), api('/employees')]);
  state.services = serviceData.services;
  state.employees = employeeData.employees;
}

function bookableEmployees(serviceId) {
  const all = state.employees ?? [];
  const pool = canManage(session.user)
    ? all.filter((e) => e.status === 'ACTIVE')
    : all.filter((e) => e.id === session.employee?.id && e.status === 'ACTIVE');
  return serviceId ? pool.filter((e) => canPerform(e, serviceId, all)) : pool;
}

function fillServiceSelect() {
  const select = newForm.elements.serviceId;
  const current = select.value;
  const own = canManage(session.user) ? null : (state.employees ?? []).find((e) => e.id === session.employee?.id);
  const services = (state.services ?? [])
    .filter((s) => s.status === 'ACTIVE')
    .filter((s) => !own || canPerform(own, s.id, state.employees));
  select.innerHTML = `<option value="">${escapeHtml(t('common.choose'))}</option>${services
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} · ${escapeHtml(fmtMinutes(s.durationMinutes))} · ${escapeHtml(fmtPrice(s.priceCents))}</option>`)
    .join('')}`;
  if (services.some((s) => s.id === current)) select.value = current;
}

function fillEmployeeSelect() {
  const select = newForm.elements.employeeId;
  const current = select.value;
  const employees = bookableEmployees(newForm.elements.serviceId.value);
  const manager = canManage(session.user);
  select.innerHTML = `${manager ? `<option value="">${escapeHtml(t('common.choose'))}</option>` : ''}${employees
    .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}`;
  if (employees.some((e) => e.id === current)) select.value = current;
  else if (!manager && employees.length) select.value = employees[0].id;
  // Ein Mitarbeiter trägt nur für sich selbst ein; das Backend prüft das ebenfalls.
  select.disabled = !manager;
}

let slotToken = 0;
async function loadSlots() {
  const { serviceId, employeeId, date, time } = newForm.elements;
  if (!serviceId.value || !employeeId.value || !date.value) {
    slotsBox.innerHTML = `<p class="adm-hint mt-0">${escapeHtml(t('bookings.slotsPick'))}</p>`;
    return;
  }
  const token = ++slotToken;
  slotsBox.innerHTML = `<p class="adm-hint mt-0">${escapeHtml(t('common.loading'))}</p>`;
  try {
    const params = new URLSearchParams({ date: date.value, serviceId: serviceId.value, employeeId: employeeId.value });
    const data = await publicApi(`/availability?${params}`);
    if (token !== slotToken) return;
    const free = data.slots.filter((slot) => slot.available);
    if (data.closed) {
      slotsBox.innerHTML = `<p class="adm-hint mt-0">${escapeHtml(t('bookings.slotsClosed'))}</p>`;
    } else if (!free.length) {
      slotsBox.innerHTML = `<p class="adm-hint mt-0">${escapeHtml(t('bookings.slotsNone'))}</p>`;
    } else {
      slotsBox.innerHTML = free.map((slot) => {
        const value = timeKey(slot.start);
        return `<button type="button" class="adm-chip" data-slot="${value}" aria-pressed="${value === time.value}">${escapeHtml(fmtTime(slot.start))}</button>`;
      }).join('');
    }
  } catch (err) {
    if (token !== slotToken) return;
    slotsBox.innerHTML = `<p class="adm-hint mt-0">${escapeHtml(errorMessage(err))}</p>`;
  }
}

async function openNew() {
  if (!canCreate()) return;
  clearErrors(newForm);
  newForm.reset();
  newForm.querySelector('[data-outside-hours]').hidden = !canManage(session.user);
  slotsBox.innerHTML = '';
  newDialog.showModal();
  try {
    await ensureLists();
  } catch (err) {
    showFormError(newForm, err);
    return;
  }
  fillServiceSelect();
  fillEmployeeSelect();
  newForm.elements.date.value = todayKey();
  newForm.elements.date.min = todayKey();
  loadSlots();
  newForm.elements.serviceId.focus();
}

newForm.addEventListener('change', (event) => {
  const { name } = event.target;
  if (name === 'serviceId') fillEmployeeSelect();
  if (['serviceId', 'employeeId', 'date'].includes(name)) loadSlots();
  if (name === 'time') {
    slotsBox.querySelectorAll('[data-slot]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.slot === event.target.value));
    });
  }
});

slotsBox.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-slot]');
  if (!chip) return;
  newForm.elements.time.value = chip.dataset.slot;
  slotsBox.querySelectorAll('[data-slot]').forEach((node) => node.setAttribute('aria-pressed', String(node === chip)));
});

newForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = validate(newForm, [
    { name: 'serviceId', required: true },
    { name: 'employeeId', required: true },
    { name: 'date', required: true },
    { name: 'time', required: true, check: (v) => (/^\d{2}:\d{2}/.test(v) ? null : t('validation.time')) },
    { name: 'customerName', required: true, min: 2, max: 120 },
    { name: 'customerPhone', required: true, max: 40 },
    { name: 'customerEmail', email: true, max: 200 },
    { name: 'note', max: 500 },
  ]);
  if (!ok) return;

  const f = newForm.elements;
  const submit = newForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    await api('/bookings', {
      method: 'POST',
      body: {
        serviceId: f.serviceId.value,
        employeeId: f.employeeId.value,
        start: businessTimeToUtc(f.date.value, f.time.value),
        customerName: f.customerName.value.trim(),
        customerPhone: f.customerPhone.value.trim(),
        customerEmail: f.customerEmail.value.trim() || undefined,
        note: f.note.value.trim() || undefined,
        allowOutsideHours: canManage(session.user) && f.allowOutsideHours.checked,
      },
    });
    newDialog.close();
    toast(t('bookings.created'));
    await load();
  } catch (err) {
    showFormError(newForm, err);
    // Der Platz ist womöglich gerade weg — frische Zeiten zeigen.
    if (err instanceof ApiError && err.status === 409) loadSlots();
  } finally {
    setBusy(submit, false);
  }
});
bindDialog(newDialog);

document.querySelector('[data-new]').addEventListener('click', openNew);

/* ---------------------------------------------------------------- Start */

onLanguageChange(() => {
  renderFilterOptions();
  renderResults();
  if (detailDialog.open) renderDetail();
  if (newDialog.open) {
    fillServiceSelect();
    fillEmployeeSelect();
    loadSlots();
    clearErrors(newForm);
  }
});

(async () => {
  const user = await requireSession('bookings');
  if (!user) return;

  document.querySelector('[data-new]').hidden = !canCreate();
  renderFilterOptions();
  renderResults(); // Ladezustand sofort, nicht erst nach der Mitarbeiterliste

  const params = new URL(window.location.href).searchParams;
  const view = params.get('view');
  if (['upcoming', 'today', 'past', 'all'].includes(view)) state.view = view;
  const q = params.get('q');
  if (q) {
    filters.elements.q.value = q.slice(0, 60);
    state.view = 'all';
    state.openSingle = true;
  }

  if (canManage(user)) {
    await ensureLists().catch(() => {}); // Filter nach Mitarbeiter; ohne Liste geht es auch.
  }
  renderFilterOptions();
  await load();

  if (params.get('new')) {
    window.history.replaceState({}, '', '/admin/bookings');
    openNew();
  }
})().catch(handleError);
