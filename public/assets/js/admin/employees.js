/* /admin/employees — anlegen, ändern, deaktivieren, Kalender und Zeiten zuweisen.

   Deaktivieren statt löschen ist der Normalfall: historische Termine bleiben
   erhalten und die Person verschwindet trotzdem sofort aus der Buchungsseite
   (info.md §9). Löschen bietet die Oberfläche nur an, wenn es keine Termine gibt. */
import {
  api, requireSession, escapeHtml, fmtDate, toast, handleError, WEEKDAYS, businessTimeToUtc,
} from './core.js';

const list = document.querySelector('[data-list]');
const dialog = document.querySelector('[data-dialog]');
const form = dialog.querySelector('[data-form]');
const error = dialog.querySelector('[data-error]');
const hoursBox = form.querySelector('[data-hours]');
const absenceDialog = document.querySelector('[data-absence-dialog]');
const absenceForm = absenceDialog.querySelector('[data-form]');

let employees = [];
let services = [];
let calendars = null;
let editing = null;

/* ------------------------------------------------------------------ Liste */

function card(employee) {
  const inactive = employee.status === 'INACTIVE';
  const hours = employee.workingHours.filter((h) => !h.isBreak);
  const breaks = employee.workingHours.filter((h) => h.isBreak);

  const hoursText = hours.length
    ? hours.map((h) => `${WEEKDAYS[h.weekday].slice(0, 2)} ${h.start}–${h.end}`).join(' · ')
    : 'keine Arbeitszeiten hinterlegt';

  const absences = employee.absences.length
    ? `<ul class="mt-3 grid gap-1">${employee.absences.map((a) => `<li class="flex items-center justify-between gap-3 text-[13px] text-fg-muted">
        <span>${escapeHtml(fmtDate(a.start))} – ${escapeHtml(fmtDate(a.end))} · ${escapeHtml({ VACATION: 'Urlaub', SICK: 'Krankheit', OTHER: 'Sonstiges' }[a.kind] ?? a.kind)}${a.note ? ` · ${escapeHtml(a.note)}` : ''}</span>
        <button type="button" class="text-danger hover:underline" data-remove-absence="${a.id}" data-employee="${employee.id}">entfernen</button>
      </li>`).join('')}</ul>`
    : '';

  return `<article class="card grid gap-3 ${inactive ? 'opacity-70' : ''}">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-display text-xl font-bold uppercase text-fg">${escapeHtml(employee.name)}</p>
        <p class="text-[15px] text-fg-body">${escapeHtml(employee.role ?? '')}</p>
        <p class="mt-1 text-[13px] text-fg-muted">${escapeHtml(hoursText)}</p>
        ${breaks.length ? `<p class="text-[13px] text-fg-muted">Pausen: ${breaks.map((b) => `${WEEKDAYS[b.weekday].slice(0, 2)} ${b.start}–${b.end}`).join(' · ')}</p>` : ''}
        <p class="mt-1 text-[13px] text-fg-muted">
          Kalender: ${employee.googleCalendarId ? escapeHtml(employee.googleCalendarId) : 'nicht zugewiesen'}
          · ${employee.upcomingBookings} offene / ${employee.totalBookings} Termine gesamt
        </p>
        ${absences}
      </div>
      <span class="badge ${inactive ? 'bg-surface-2 text-fg-muted' : 'bg-ok/15 text-ok'}">${inactive ? 'inaktiv' : 'aktiv'}</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-edit="${employee.id}">Bearbeiten</button>
      <button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-absence="${employee.id}">Abwesenheit</button>
      <button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-toggle="${employee.id}">
        ${inactive ? 'Wieder aktivieren' : 'Deaktivieren'}
      </button>
      ${employee.totalBookings === 0
        ? `<button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px] hover:border-danger hover:text-danger" data-delete="${employee.id}">Löschen</button>`
        : ''}
    </div>
  </article>`;
}

async function load() {
  list.innerHTML = '<p class="text-fg-muted">Wird geladen …</p>';
  const [employeeData, serviceData, googleData] = await Promise.all([
    api('/employees'),
    api('/services'),
    api('/google').catch(() => null),
  ]);
  employees = employeeData.employees;
  services = serviceData.services.filter((s) => s.status === 'ACTIVE');
  calendars = googleData?.calendars ?? null;

  list.innerHTML = employees.length
    ? employees.map(card).join('')
    : '<p class="rounded-lg border border-dashed border-line p-6 text-center text-[15px] text-fg-muted">Noch kein Mitarbeiter angelegt.</p>';
}

/* ---------------------------------------------------------- Arbeitszeiten */

function hourRow(entry = { weekday: 1, start: '09:00', end: '18:00', isBreak: false }) {
  return `<div class="flex flex-wrap items-center gap-2" data-hour-row>
    <select class="input min-h-[40px] w-auto py-1.5" data-hour="weekday" aria-label="Wochentag">
      ${WEEKDAYS.map((name, index) => `<option value="${index}" ${index === entry.weekday ? 'selected' : ''}>${name}</option>`).join('')}
    </select>
    <input class="input min-h-[40px] w-auto py-1.5" type="time" step="300" value="${entry.start}" data-hour="start" aria-label="Beginn">
    <input class="input min-h-[40px] w-auto py-1.5" type="time" step="300" value="${entry.end}" data-hour="end" aria-label="Ende">
    <label class="flex items-center gap-2 text-[13px] text-fg-muted">
      <input type="checkbox" class="h-4 w-4 accent-[#D4AF37]" data-hour="isBreak" ${entry.isBreak ? 'checked' : ''}> Pause
    </label>
    <button type="button" class="text-[13px] text-danger hover:underline" data-remove-hour>entfernen</button>
  </div>`;
}

function readHours() {
  return [...hoursBox.querySelectorAll('[data-hour-row]')].map((row) => ({
    weekday: Number(row.querySelector('[data-hour="weekday"]').value),
    start: row.querySelector('[data-hour="start"]').value,
    end: row.querySelector('[data-hour="end"]').value,
    isBreak: row.querySelector('[data-hour="isBreak"]').checked,
  }));
}

/* ------------------------------------------------------------------ Dialog */

function openDialog(employee) {
  editing = employee ?? null;
  error.hidden = true;
  form.reset();

  dialog.querySelector('[data-dialog-title]').textContent = employee ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter anlegen';
  form.name.value = employee?.name ?? '';
  form.role.value = employee?.role ?? '';
  form.sortOrder.value = employee?.sortOrder ?? 100;

  const assigned = employee?.googleCalendarId ?? '';
  const options = ['<option value="">— kein Kalender —</option>'];
  if (calendars) {
    options.push(...calendars.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.summary)}${c.primary ? ' (Standard)' : ''}</option>`));
  }
  // Eine bereits gespeicherte Kennung darf nicht verloren gehen, nur weil die
  // Liste gerade nicht geladen werden konnte.
  if (assigned && !calendars?.some((c) => c.id === assigned)) {
    options.push(`<option value="${escapeHtml(assigned)}">${escapeHtml(assigned)}</option>`);
  }
  form.googleCalendarId.innerHTML = options.join('');
  form.googleCalendarId.value = assigned;
  form.querySelector('[data-calendar-hint]').textContent = calendars
    ? 'Kalender aus dem verbundenen Google-Konto.'
    : 'Google ist nicht verbunden — ohne Kalender laufen Termine nur über die Datenbank.';

  form.querySelector('[data-services]').innerHTML = services.map((service) => `
    <label class="flex items-center gap-2 text-[15px] text-fg-body">
      <input type="checkbox" class="h-4 w-4 accent-[#D4AF37]" data-service="${service.id}"
        ${employee?.serviceIds.includes(service.id) ? 'checked' : ''}>
      ${escapeHtml(service.name)}
    </label>`).join('');

  hoursBox.innerHTML = (employee?.workingHours ?? []).map(hourRow).join('');
  dialog.showModal();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;

  const body = {
    name: form.name.value,
    role: form.role.value,
    sortOrder: Number(form.sortOrder.value),
    googleCalendarId: form.googleCalendarId.value || null,
    serviceIds: [...form.querySelectorAll('[data-service]')].filter((c) => c.checked).map((c) => c.dataset.service),
    workingHours: readHours(),
  };

  try {
    if (editing) await api(`/employees/${editing.id}`, { method: 'PATCH', body });
    else await api('/employees', { method: 'POST', body });
    dialog.close();
    toast(editing ? 'Gespeichert.' : 'Mitarbeiter angelegt.');
    await load();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

hoursBox.addEventListener('click', (event) => {
  if (event.target.closest('[data-remove-hour]')) event.target.closest('[data-hour-row]').remove();
});
form.querySelector('[data-add-hour]').addEventListener('click', () => {
  hoursBox.insertAdjacentHTML('beforeend', hourRow());
});
dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

/* -------------------------------------------------------------- Abwesenheit */

let absenceFor = null;

absenceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = absenceForm.querySelector('[data-error]');
  errorBox.hidden = true;
  try {
    // "Bis" ist einschließlich gemeint: der ganze letzte Tag ist frei.
    const result = await api(`/employees/${absenceFor}/absences`, {
      method: 'POST',
      body: {
        start: businessTimeToUtc(absenceForm.from.value, '00:00'),
        end: businessTimeToUtc(absenceForm.to.value, '23:59'),
        kind: absenceForm.kind.value,
        note: absenceForm.note.value || undefined,
      },
    });
    absenceDialog.close();
    toast(result.conflictingBookings
      ? `Eingetragen. Achtung: ${result.conflictingBookings} bestehende Termine liegen in diesem Zeitraum.`
      : 'Abwesenheit eingetragen.', result.conflictingBookings ? 'error' : 'ok');
    await load();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});
absenceDialog.querySelector('[data-cancel]').addEventListener('click', () => absenceDialog.close());

/* ------------------------------------------------------------------ Aktionen */

list.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const { edit, toggle, delete: remove, absence, removeAbsence, employee: employeeId } = target.dataset;

  try {
    if (edit) return openDialog(employees.find((e) => e.id === edit));

    if (absence) {
      absenceFor = absence;
      absenceForm.reset();
      absenceForm.querySelector('[data-error]').hidden = true;
      absenceForm.from.value = new Date().toISOString().slice(0, 10);
      absenceForm.to.value = new Date().toISOString().slice(0, 10);
      return absenceDialog.showModal();
    }

    if (removeAbsence) {
      await api(`/employees/${employeeId}/absences/${removeAbsence}`, { method: 'DELETE' });
      toast('Abwesenheit entfernt.');
      return load();
    }

    if (toggle) {
      const employee = employees.find((e) => e.id === toggle);
      const next = employee.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      if (next === 'INACTIVE' && employee.upcomingBookings > 0
          && !window.confirm(`${employee.name} hat ${employee.upcomingBookings} offene Termine. Diese bleiben bestehen, neue Buchungen sind aber nicht mehr möglich. Fortfahren?`)) {
        return undefined;
      }
      await api(`/employees/${toggle}`, { method: 'PATCH', body: { status: next } });
      toast(next === 'INACTIVE' ? 'Deaktiviert.' : 'Wieder aktiv.');
      return load();
    }

    if (remove) {
      if (!window.confirm('Diesen Mitarbeiter endgültig löschen?')) return undefined;
      await api(`/employees/${remove}`, { method: 'DELETE' });
      toast('Gelöscht.');
      return load();
    }
  } catch (err) {
    handleError(err);
  }
  return undefined;
});

document.querySelector('[data-new]').addEventListener('click', () => openDialog(null));

(async () => {
  const user = await requireSession('/admin/employees');
  if (!user) return;
  await load();
})().catch(handleError);
