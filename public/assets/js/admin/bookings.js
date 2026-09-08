/* /admin/bookings — Terminliste, Statuswechsel, manueller Termin (info.md §18, §21). */
import {
  api, requireSession, escapeHtml, fmtTime, fmtDate, fmtPrice, toast, handleError,
  STATUS_LABEL, STATUS_CLASS, businessTimeToUtc,
} from './core.js';

const list = document.querySelector('[data-list]');
const dialog = document.querySelector('[data-dialog]');
const form = dialog.querySelector('[data-form]');
const error = dialog.querySelector('[data-error]');

const NEXT_STATUS = [
  ['CONFIRMED', 'Bestätigen'],
  ['COMPLETED', 'Erledigt'],
  ['NO_SHOW', 'Nicht erschienen'],
  ['CANCELLED', 'Stornieren'],
];

function row(booking) {
  const actions = NEXT_STATUS
    .filter(([status]) => status !== booking.status)
    .map(([status, label]) => `<button type="button" data-status="${status}" data-id="${booking.id}"
        class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px] ${status === 'CANCELLED' ? 'hover:border-danger hover:text-danger' : ''}">${label}</button>`)
    .join('');

  return `<article class="card grid gap-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="tnum font-semibold text-fg">${escapeHtml(fmtDate(booking.start))} · ${escapeHtml(fmtTime(booking.start))}–${escapeHtml(fmtTime(booking.end))}</p>
        <p class="text-[15px] text-fg-body">${escapeHtml(booking.customer.name)} · ${escapeHtml(booking.service.name)}</p>
        <p class="text-[13px] text-fg-muted">
          ${escapeHtml(booking.employee.name)} · ${escapeHtml(booking.customer.phone)}${
            booking.customer.email ? ` · ${escapeHtml(booking.customer.email)}` : ''}
        </p>
        ${booking.note ? `<p class="mt-1 text-[13px] text-fg-muted">Anmerkung: ${escapeHtml(booking.note)}</p>` : ''}
        <p class="mt-1 text-[13px] text-fg-muted">
          Ref. ${escapeHtml(booking.reference)} · ${booking.source === 'MANUAL' ? 'manuell' : 'Website'}
          · ${booking.inCalendar ? 'im Google Kalender' : 'nicht im Kalender'}
        </p>
      </div>
      <span class="badge ${STATUS_CLASS[booking.status] ?? ''}">${escapeHtml(STATUS_LABEL[booking.status] ?? booking.status)}</span>
    </div>
    <div class="flex flex-wrap gap-2">${actions}</div>
  </article>`;
}

async function load() {
  const params = new URLSearchParams();
  document.querySelectorAll('[data-filter]').forEach((input) => {
    if (input.value) params.set(input.dataset.filter, input.value);
  });

  list.innerHTML = '<p class="text-fg-muted">Wird geladen …</p>';
  try {
    const { bookings } = await api(`/bookings?${params}`);
    list.innerHTML = bookings.length
      ? bookings.map(row).join('')
      : '<p class="rounded-lg border border-dashed border-line p-6 text-center text-[15px] text-fg-muted">Keine Termine für diese Auswahl.</p>';
  } catch (err) {
    list.innerHTML = '';
    handleError(err);
  }
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-status]');
  if (!button) return;
  if (button.dataset.status === 'CANCELLED'
      && !window.confirm('Termin stornieren? Der Eintrag im Google Kalender wird gelöscht.')) return;

  button.disabled = true;
  try {
    const result = await api(`/bookings/${button.dataset.id}`, {
      method: 'PATCH',
      body: { status: button.dataset.status },
    });
    toast(result.warning ?? 'Status geändert.', result.warning ? 'error' : 'ok');
    await load();
  } catch (err) {
    button.disabled = false;
    handleError(err);
  }
});

/* ------------------------------------------------------- manueller Termin */

async function openDialog() {
  error.hidden = true;
  form.reset();

  const [serviceData, employeeData] = await Promise.all([api('/services'), api('/employees')]);
  const services = serviceData.services.filter((s) => s.status === 'ACTIVE');
  const employees = employeeData.employees.filter((e) => e.status === 'ACTIVE');

  form.serviceId.innerHTML = services
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} · ${s.durationMinutes} min · ${escapeHtml(fmtPrice(s.priceCents))}</option>`)
    .join('');
  form.employeeId.innerHTML = employees
    .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`)
    .join('');

  form.date.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    await api('/bookings', {
      method: 'POST',
      body: {
        serviceId: values.serviceId,
        employeeId: values.employeeId,
        start: businessTimeToUtc(values.date, values.time),
        customerName: values.customerName,
        customerPhone: values.customerPhone,
        customerEmail: values.customerEmail || undefined,
        note: values.note || undefined,
        allowOutsideHours: values.allowOutsideHours === 'on',
      },
    });
    dialog.close();
    toast('Termin eingetragen.');
    await load();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
document.querySelector('[data-reload]').addEventListener('click', load);
document.querySelector('[data-new]').addEventListener('click', () => openDialog().catch(handleError));
document.querySelectorAll('[data-filter]').forEach((input) => {
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') load(); });
});

/* Ein Mitarbeiter bekommt in der Liste ohnehin nur die eigenen Termine und darf
   auch nur für sich selbst eintragen — beides setzt das Backend durch. */
(async () => {
  const user = await requireSession('/admin/bookings');
  if (!user) return;
  await load();
})().catch(handleError);
