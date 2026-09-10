/* /admin/employees — anlegen, bearbeiten, deaktivieren, reaktivieren, löschen,
   Leistungen, Google-Kalender, Arbeitszeiten, Pausen, Abwesenheiten.

   Deaktivieren statt löschen ist der Normalfall: historische Termine bleiben
   erhalten und die Person verschwindet trotzdem sofort aus der Buchungsseite
   (info.md §9). Löschen bietet die Oberfläche nur an, wenn es keine Termine gibt;
   das Backend antwortet sonst ohnehin mit 409. */
import { t, tn, onLanguageChange } from './i18n.js';
import {
  api, ApiError, escapeHtml, fmtDate, todayKey, weekdayName, WEEK_ORDER, businessTimeToUtc,
} from './core.js';
import {
  icon, activeBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList, bindDialog,
  validate, clearErrors, showFormError, setBusy,
} from './ui.js';
import { requireSession } from './shell.js';
import { whitelist, canPerform, normalizeSelection, planAssignments } from './assignments.js';

const list = document.querySelector('[data-list]');
const editDialog = document.querySelector('[data-edit-dialog]');
const editForm = editDialog.querySelector('[data-edit-form]');
const hoursBox = editForm.querySelector('[data-hours]');
const absenceDialog = document.querySelector('[data-absence-dialog]');
const absenceForm = absenceDialog.querySelector('[data-absence-form]');

const ABSENCE_KINDS = ['VACATION', 'SICK', 'OTHER'];

const state = {
  employees: null,
  services: [],
  calendars: null, // null = Google nicht verbunden oder Liste nicht ladbar
  googleConnected: false,
  error: null,
  editing: null,
  absenceFor: null,
};

const activeServices = () => state.services.filter((s) => s.status === 'ACTIVE');

/* ------------------------------------------------------------------ Liste */

function hoursSummary(employee) {
  return WEEK_ORDER.map((weekday) => {
    const shifts = employee.workingHours.filter((h) => h.weekday === weekday && !h.isBreak);
    const breaks = employee.workingHours.filter((h) => h.weekday === weekday && h.isBreak);
    const value = shifts.length
      ? `<span class="tnum text-fg-body">${shifts.map((h) => `${h.start}–${h.end}`).join(', ')}</span>${breaks.length
        ? ` <span class="tnum text-fg-muted">· ${escapeHtml(t('employees.break'))} ${breaks.map((h) => `${h.start}–${h.end}`).join(', ')}</span>`
        : ''}`
      : `<span class="text-fg-muted">${escapeHtml(t('employees.dayOff'))}</span>`;
    return `<dt class="text-fg-muted">${escapeHtml(weekdayName(weekday, 'short'))}</dt><dd class="min-w-0 break-words">${value}</dd>`;
  }).join('');
}

function servicesSummary(employee) {
  const services = activeServices();
  if (!services.length) return escapeHtml(t('employees.noServicesYet'));
  const allowed = services.filter((s) => canPerform(employee, s.id, state.employees));
  if (allowed.length === services.length) return escapeHtml(t('employees.allServices'));
  if (!allowed.length) return `<span class="text-warn">${escapeHtml(t('employees.noServices'))}</span>`;
  return escapeHtml(allowed.map((s) => s.name).join(', '));
}

function calendarName(id) {
  if (!id) return `<span class="text-fg-muted">${escapeHtml(t('employees.noCalendar'))}</span>`;
  const match = state.calendars?.find((c) => c.id === id);
  return escapeHtml(match?.summary ?? id);
}

function card(employee) {
  const inactive = employee.status === 'INACTIVE';
  const absences = employee.absences.length
    ? `<ul class="mt-1 grid gap-1">${employee.absences.map((a) => `<li class="flex min-h-[40px] items-center justify-between gap-2 rounded-md bg-surface-2 px-3 text-[13px]">
        <span class="min-w-0 break-words"><span class="tnum">${escapeHtml(fmtDate(a.start))} – ${escapeHtml(fmtDate(a.end))}</span>
          · ${escapeHtml(t(`employees.absenceKinds.${a.kind}`))}${a.note ? ` · ${escapeHtml(a.note)}` : ''}</span>
        <button type="button" class="adm-icon-btn adm-icon-btn-plain h-10 w-10 hover:text-danger" data-remove-absence="${a.id}" data-employee="${employee.id}"
          aria-label="${escapeHtml(t('employees.removeAbsence'))}">${icon('trash')}</button>
      </li>`).join('')}</ul>`
    : `<p class="text-[13px] text-fg-muted">${escapeHtml(t('employees.noAbsences'))}</p>`;

  return `<article class="adm-card grid min-w-0 content-start gap-4 p-4 sm:p-5 ${inactive ? 'opacity-80' : ''}">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="truncate text-base font-semibold text-fg">${escapeHtml(employee.name)}</h2>
        <p class="truncate text-[13px] text-fg-muted">${escapeHtml(employee.role || t('employees.noRole'))}</p>
      </div>
      <span class="shrink-0">${activeBadge(!inactive)}</span>
    </div>

    <dl class="adm-dl text-[13px]">
      <dt>${escapeHtml(t('employees.bookings'))}</dt>
      <dd class="tnum">${escapeHtml(t('employees.bookingsSummary', { upcoming: employee.upcomingBookings, total: employee.totalBookings }))}</dd>
      <dt>${escapeHtml(t('employees.googleCalendar'))}</dt><dd>${calendarName(employee.googleCalendarId)}</dd>
      <dt>${escapeHtml(t('nav.services'))}</dt><dd>${servicesSummary(employee)}</dd>
    </dl>

    <div>
      <h3 class="mb-1.5 text-[13px] font-semibold text-fg">${escapeHtml(t('employees.sectionHours'))}</h3>
      <dl class="adm-dl gap-y-1 text-[13px]">${hoursSummary(employee)}</dl>
    </div>

    <div>
      <h3 class="mb-1.5 text-[13px] font-semibold text-fg">${escapeHtml(t('employees.absences'))}</h3>
      ${absences}
    </div>

    <div class="flex flex-wrap gap-2 border-t border-line pt-4">
      <button type="button" class="adm-btn-ghost adm-btn-sm" data-edit="${employee.id}">${icon('edit')}<span>${escapeHtml(t('common.edit'))}</span></button>
      <button type="button" class="adm-btn-ghost adm-btn-sm" data-absence="${employee.id}">${icon('calendarX')}<span>${escapeHtml(t('employees.addAbsence'))}</span></button>
      ${inactive
        ? `<button type="button" class="adm-btn-secondary adm-btn-sm" data-toggle="${employee.id}">${icon('power')}<span>${escapeHtml(t('employees.reactivate'))}</span></button>`
        : `<button type="button" class="adm-btn-ghost adm-btn-sm" data-toggle="${employee.id}">${icon('power')}<span>${escapeHtml(t('employees.deactivate'))}</span></button>`}
      ${employee.totalBookings === 0
        ? `<button type="button" class="adm-btn-danger adm-btn-sm" data-delete="${employee.id}">${icon('trash')}<span>${escapeHtml(t('common.delete'))}</span></button>`
        : ''}
    </div>
  </article>`;
}

function renderList() {
  if (state.error) {
    list.innerHTML = errorState(state.error);
    return;
  }
  if (!state.employees) {
    list.innerHTML = skeletonList(3);
    return;
  }
  if (!state.employees.length) {
    list.innerHTML = emptyState({
      title: t('employees.empty'),
      text: t('employees.emptyHint'),
      action: `<button type="button" class="adm-btn-primary" data-new-inline>${icon('plus')}<span>${escapeHtml(t('employees.add'))}</span></button>`,
    });
    return;
  }
  const active = state.employees.filter((e) => e.status === 'ACTIVE');
  const inactive = state.employees.filter((e) => e.status !== 'ACTIVE');
  list.innerHTML = `
    <div class="grid gap-3 lg:grid-cols-2">${active.map(card).join('')}</div>
    ${inactive.length ? `<h2 class="adm-h2 mb-3 mt-8">${escapeHtml(tn('employees.inactiveCount', inactive.length))}</h2>
      <div class="grid gap-3 lg:grid-cols-2">${inactive.map(card).join('')}</div>` : ''}`;
}

async function load() {
  state.error = null;
  try {
    const [employeeData, serviceData, googleData] = await Promise.all([
      api('/employees'),
      api('/services'),
      api('/google').catch(() => null),
    ]);
    state.employees = employeeData.employees;
    state.services = serviceData.services;
    state.googleConnected = Boolean(googleData?.connected);
    state.calendars = googleData?.calendars ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.error = err;
  }
  renderList();
  return undefined;
}

/* ---------------------------------------------------------- Arbeitszeiten */

function hourRow(entry) {
  const kind = entry.isBreak ? 'break' : 'shift';
  const day = weekdayName(entry.weekday);
  return `<div class="grid gap-1 ${entry.isBreak ? 'border-l-2 border-warn pl-2' : ''}" data-row data-break="${entry.isBreak}">
    <span class="flex items-center gap-1.5 text-xs font-medium ${entry.isBreak ? 'text-warn' : 'text-fg-muted'}">
      ${icon(entry.isBreak ? 'coffee' : 'clock').replace('width="20" height="20"', 'width="14" height="14"')}
      ${escapeHtml(t(`employees.${kind}`))}
    </span>
    <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
      <input class="adm-input tnum" type="time" step="300" value="${escapeHtml(entry.start)}" data-start
        aria-label="${escapeHtml(`${day} · ${t(`employees.${kind}`)} · ${t('employees.start')}`)}">
      <span class="text-fg-muted" aria-hidden="true">–</span>
      <input class="adm-input tnum" type="time" step="300" value="${escapeHtml(entry.end)}" data-end
        aria-label="${escapeHtml(`${day} · ${t(`employees.${kind}`)} · ${t('employees.end')}`)}">
      <button type="button" class="adm-icon-btn adm-icon-btn-plain hover:text-danger" data-remove-row
        aria-label="${escapeHtml(t('employees.removeRow'))}">${icon('trash')}</button>
    </div>
  </div>`;
}

function renderHours(entries) {
  hoursBox.innerHTML = WEEK_ORDER.map((weekday) => {
    const rows = entries
      .filter((h) => h.weekday === weekday)
      .sort((a, b) => Number(a.isBreak) - Number(b.isBreak) || a.start.localeCompare(b.start));
    return `<div class="rounded-md border border-line p-3" data-day="${weekday}">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-semibold text-fg">${escapeHtml(weekdayName(weekday))}</span>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="adm-btn-ghost adm-btn-sm" data-add="shift">${icon('plus')}<span>${escapeHtml(t('employees.shift'))}</span></button>
          <button type="button" class="adm-btn-ghost adm-btn-sm" data-add="break">${icon('coffee')}<span>${escapeHtml(t('employees.break'))}</span></button>
        </div>
      </div>
      <div class="mt-2 grid gap-2" data-rows>${rows.length
        ? rows.map(hourRow).join('')
        : `<p class="text-[13px] text-fg-muted" data-day-off>${escapeHtml(t('employees.dayOff'))}</p>`}</div>
    </div>`;
  }).join('');
}

function readHours() {
  return [...hoursBox.querySelectorAll('[data-day]')].flatMap((day) =>
    [...day.querySelectorAll('[data-row]')].map((row) => ({
      weekday: Number(day.dataset.day),
      start: row.querySelector('[data-start]').value,
      end: row.querySelector('[data-end]').value,
      isBreak: row.dataset.break === 'true',
    })));
}

/** Dieselben Regeln wie replaceHours() im Backend — hier nur, um sie verständlich zu melden. */
function hoursProblem(entries) {
  for (const entry of entries) {
    if (!/^\d{2}:\d{2}$/.test(entry.start) || !/^\d{2}:\d{2}$/.test(entry.end)) {
      return t('employees.hoursInvalid', { day: weekdayName(entry.weekday) });
    }
    if (entry.end <= entry.start) return t('employees.hoursEndBeforeStart', { day: weekdayName(entry.weekday) });
  }
  for (const weekday of WEEK_ORDER) {
    const shifts = entries.filter((e) => e.weekday === weekday && !e.isBreak).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < shifts.length; i += 1) {
      if (shifts[i].start < shifts[i - 1].end) return t('employees.hoursOverlap', { day: weekdayName(weekday) });
    }
    const breaks = entries.filter((e) => e.weekday === weekday && e.isBreak);
    if (breaks.some((b) => !shifts.some((s) => b.start >= s.start && b.end <= s.end))) {
      return t('employees.breakOutside', { day: weekdayName(weekday) });
    }
  }
  return null;
}

hoursBox.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-row]');
  if (remove) {
    const rows = remove.closest('[data-rows]');
    remove.closest('[data-row]').remove();
    if (!rows.querySelector('[data-row]')) {
      rows.innerHTML = `<p class="text-[13px] text-fg-muted" data-day-off>${escapeHtml(t('employees.dayOff'))}</p>`;
    }
    return;
  }
  const add = event.target.closest('[data-add]');
  if (!add) return;
  const day = add.closest('[data-day]');
  const rows = day.querySelector('[data-rows]');
  rows.querySelector('[data-day-off]')?.remove();
  const isBreak = add.dataset.add === 'break';
  rows.insertAdjacentHTML('beforeend', hourRow({
    weekday: Number(day.dataset.day),
    start: isBreak ? '12:00' : '09:00',
    end: isBreak ? '12:30' : '18:00',
    isBreak,
  }));
  rows.querySelector('[data-row]:last-child [data-start]')?.focus();
});

/* ------------------------------------------------------------------ Dialog */

function renderServiceChoices(employee) {
  const box = editForm.querySelector('[data-services]');
  const services = activeServices();
  if (!services.length) {
    box.innerHTML = `<p class="text-[13px] text-fg-muted">${escapeHtml(t('employees.noServicesYet'))}</p>`;
    return;
  }
  box.innerHTML = services.map((service) => {
    // Neue Person: sie kann alles, wofür es keine Einschränkung auf bestimmte Mitarbeiter gibt.
    const checked = employee ? canPerform(employee, service.id, state.employees) : !whitelist(service.id, state.employees);
    return `<label class="adm-check-row">
      <input type="checkbox" class="adm-check" data-service="${service.id}" ${checked ? 'checked' : ''}>
      <span class="min-w-0 break-words">${escapeHtml(service.name)}</span>
    </label>`;
  }).join('');
}

function renderCalendarChoice(employee) {
  const select = editForm.elements.googleCalendarId;
  const assigned = employee?.googleCalendarId ?? '';
  const options = [`<option value="">${escapeHtml(t('employees.noCalendar'))}</option>`];
  (state.calendars ?? []).forEach((c) => {
    options.push(`<option value="${escapeHtml(c.id)}">${escapeHtml(c.summary)}${c.primary ? ` (${escapeHtml(t('google.primary'))})` : ''}</option>`);
  });
  // Eine gespeicherte Kennung darf nicht verloren gehen, nur weil die Liste gerade fehlt.
  if (assigned && !state.calendars?.some((c) => c.id === assigned)) {
    options.push(`<option value="${escapeHtml(assigned)}">${escapeHtml(assigned)}</option>`);
  }
  select.innerHTML = options.join('');
  select.value = assigned;
  editForm.querySelector('[data-calendar-hint]').textContent = t(state.calendars
    ? 'employees.calendarHint'
    : state.googleConnected ? 'employees.calendarListUnavailable' : 'employees.calendarNotConnected');
}

function openEdit(employee) {
  state.editing = employee ?? null;
  clearErrors(editForm);
  editForm.reset();
  editDialog.querySelector('[data-edit-title]').textContent = t(employee ? 'employees.editTitle' : 'employees.addTitle');
  editForm.elements.name.value = employee?.name ?? '';
  editForm.elements.role.value = employee?.role ?? '';
  editForm.elements.sortOrder.value = employee?.sortOrder ?? 100;
  renderCalendarChoice(employee);
  renderServiceChoices(employee);
  // Neue Person: typische Woche vorschlagen, damit sie gleich buchbar ist.
  renderHours(employee?.workingHours ?? [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00', isBreak: false })));
  editDialog.showModal();
  editForm.elements.name.focus();
}

/** Gewünschte Leistungszuordnung für `employeeId` in Änderungen je Leistung übersetzen. */
function desiredAssignments(employeeId, employees) {
  const desired = new Map();
  const self = employees.find((e) => e.id === employeeId);
  const activeIds = employees.filter((e) => e.status === 'ACTIVE').map((e) => e.id);

  for (const checkbox of editForm.querySelectorAll('[data-service]')) {
    const serviceId = checkbox.dataset.service;
    const current = whitelist(serviceId, employees);
    const now = canPerform(self, serviceId, employees);
    if (checkbox.checked === now) continue;

    let selected;
    if (checkbox.checked) {
      selected = new Set([...(current ?? []), employeeId]);
    } else {
      selected = new Set((current ? [...current] : activeIds).filter((id) => id !== employeeId));
      if (!selected.size) {
        const service = state.services.find((s) => s.id === serviceId);
        throw new Error(t('employees.serviceNeedsSomeone', { service: service?.name ?? '' }));
      }
    }
    desired.set(serviceId, normalizeSelection(selected, employees));
  }
  return desired;
}

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = validate(editForm, [
    { name: 'name', required: true, min: 2, max: 120 },
    { name: 'role', max: 120 },
    { name: 'sortOrder', number: true, integer: true, minValue: 0, maxValue: 9999 },
  ]);
  if (!ok) return;

  const workingHours = readHours();
  const problem = hoursProblem(workingHours);
  if (problem) return showFormError(editForm, problem);

  const submit = editForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  const body = {
    name: editForm.elements.name.value.trim(),
    role: editForm.elements.role.value.trim(),
    sortOrder: Number(editForm.elements.sortOrder.value || 100),
    googleCalendarId: editForm.elements.googleCalendarId.value || null,
    workingHours,
  };

  try {
    // Die Zuordnung vorher prüfen: lieber gar nicht speichern als halb.
    const probeId = state.editing?.id ?? '__new__';
    const probeList = state.editing
      ? state.employees
      : [...state.employees, { id: probeId, status: 'ACTIVE', serviceIds: [] }];
    desiredAssignments(probeId, probeList);

    let id = state.editing?.id;
    if (id) {
      await api(`/employees/${id}`, { method: 'PATCH', body });
    } else {
      const created = await api('/employees', { method: 'POST', body });
      id = created.employee.id;
    }

    const employees = state.editing
      ? state.employees
      : [...state.employees, { id, status: 'ACTIVE', serviceIds: [] }];
    const changes = planAssignments(employees, desiredAssignments(id, employees));
    for (const change of changes) {
      await api(`/employees/${change.id}`, { method: 'PATCH', body: { serviceIds: change.serviceIds } });
    }

    editDialog.close();
    toast(t(state.editing ? 'common.saved' : 'employees.created'));
    await load();
  } catch (err) {
    showFormError(editForm, err instanceof ApiError ? err : err.message);
    if (!state.editing && err instanceof ApiError) await load();
  } finally {
    setBusy(submit, false);
  }
  return undefined;
});
bindDialog(editDialog);

/* -------------------------------------------------------------- Abwesenheit */

function openAbsence(employee) {
  state.absenceFor = employee.id;
  clearErrors(absenceForm);
  absenceForm.reset();
  absenceDialog.querySelector('[data-absence-title]').textContent = t('employees.absenceTitle', { name: employee.name });
  absenceForm.elements.kind.innerHTML = ABSENCE_KINDS
    .map((kind) => `<option value="${kind}">${escapeHtml(t(`employees.absenceKinds.${kind}`))}</option>`).join('');
  absenceForm.elements.from.value = todayKey();
  absenceForm.elements.to.value = todayKey();
  absenceDialog.showModal();
}

absenceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = absenceForm.elements;
  const ok = validate(absenceForm, [
    { name: 'from', required: true },
    { name: 'to', required: true, check: (v) => (v < f.from.value ? t('employees.absenceEndBeforeStart') : null) },
    { name: 'note', max: 300 },
  ]);
  if (!ok) return;

  const submit = absenceForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    // "Bis" ist einschließlich gemeint: der ganze letzte Tag ist frei.
    const result = await api(`/employees/${state.absenceFor}/absences`, {
      method: 'POST',
      body: {
        start: businessTimeToUtc(f.from.value, '00:00'),
        end: businessTimeToUtc(f.to.value, '23:59'),
        kind: f.kind.value,
        note: f.note.value.trim() || undefined,
      },
    });
    absenceDialog.close();
    if (result.conflictingBookings) toast(tn('employees.absenceConflicts', result.conflictingBookings), 'warn');
    else toast(t('employees.absenceSaved'));
    await load();
  } catch (err) {
    showFormError(absenceForm, err);
  } finally {
    setBusy(submit, false);
  }
});
bindDialog(absenceDialog);

/* ------------------------------------------------------------------ Aktionen */

list.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return load();
  if (event.target.closest('[data-new-inline]')) return openEdit(null);
  const button = event.target.closest('button');
  if (!button) return undefined;
  const { edit, toggle, delete: remove, absence, removeAbsence, employee: employeeId } = button.dataset;
  const find = (id) => state.employees.find((e) => e.id === id);

  try {
    if (edit) return openEdit(find(edit));
    if (absence) return openAbsence(find(absence));

    if (removeAbsence) {
      const confirmed = await confirmDialog({
        title: t('employees.removeAbsence'), message: t('employees.removeAbsenceConfirm'),
        confirmLabel: t('common.remove'), danger: true,
      });
      if (!confirmed) return undefined;
      await api(`/employees/${employeeId}/absences/${removeAbsence}`, { method: 'DELETE' });
      toast(t('employees.absenceRemoved'));
      return load();
    }

    if (toggle) {
      const employee = find(toggle);
      const deactivate = employee.status === 'ACTIVE';
      const confirmed = await confirmDialog(deactivate
        ? {
          title: t('employees.deactivateTitle', { name: employee.name }),
          message: `${t('employees.deactivateMessage', { name: employee.name })}${employee.upcomingBookings
            ? ` ${tn('employees.deactivateUpcoming', employee.upcomingBookings)}` : ''}`,
          confirmLabel: t('employees.deactivate'),
          danger: true,
        }
        : {
          title: t('employees.reactivateTitle', { name: employee.name }),
          message: t('employees.reactivateMessage', { name: employee.name }),
          confirmLabel: t('employees.reactivate'),
        });
      if (!confirmed) return undefined;
      setBusy(button, true);
      await api(`/employees/${toggle}`, { method: 'PATCH', body: { status: deactivate ? 'INACTIVE' : 'ACTIVE' } });
      toast(t(deactivate ? 'employees.deactivated' : 'employees.reactivated', { name: employee.name }));
      return load();
    }

    if (remove) {
      const employee = find(remove);
      const confirmed = await confirmDialog({
        title: t('employees.deleteTitle', { name: employee.name }),
        message: t('employees.deleteMessage'),
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!confirmed) return undefined;
      setBusy(button, true);
      await api(`/employees/${remove}`, { method: 'DELETE' });
      toast(t('employees.deleted', { name: employee.name }));
      return load();
    }
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
  return undefined;
});

document.querySelector('[data-new]').addEventListener('click', () => openEdit(null));

onLanguageChange(() => {
  renderList();
  if (editDialog.open) {
    // Eingaben erhalten: nur die Beschriftungen neu aufbauen.
    const hours = readHours();
    const checked = new Set([...editForm.querySelectorAll('[data-service]:checked')].map((c) => c.dataset.service));
    editDialog.querySelector('[data-edit-title]').textContent = t(state.editing ? 'employees.editTitle' : 'employees.addTitle');
    const calendar = editForm.elements.googleCalendarId.value;
    renderCalendarChoice(state.editing);
    editForm.elements.googleCalendarId.value = calendar;
    renderServiceChoices(state.editing);
    editForm.querySelectorAll('[data-service]').forEach((c) => { c.checked = checked.has(c.dataset.service); });
    renderHours(hours);
    clearErrors(editForm);
  }
  if (absenceDialog.open) {
    const employee = state.employees?.find((e) => e.id === state.absenceFor);
    const kind = absenceForm.elements.kind.value;
    if (employee) absenceDialog.querySelector('[data-absence-title]').textContent = t('employees.absenceTitle', { name: employee.name });
    absenceForm.elements.kind.innerHTML = ABSENCE_KINDS
      .map((k) => `<option value="${k}">${escapeHtml(t(`employees.absenceKinds.${k}`))}</option>`).join('');
    absenceForm.elements.kind.value = kind;
    clearErrors(absenceForm);
  }
});

(async () => {
  const user = await requireSession('employees');
  if (!user) return;
  renderList();
  await load();
  if (new URL(window.location.href).searchParams.get('new') && state.employees) {
    window.history.replaceState({}, '', '/admin/employees');
    openEdit(null);
  }
})().catch(handleError);
