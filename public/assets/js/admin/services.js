/* /admin/services — Leistungen anlegen, bearbeiten, aktivieren, deaktivieren,
   Mitarbeiter zuordnen. Gelöscht wird nur, was nie gebucht wurde; alles andere
   wird inaktiv gesetzt, damit die Terminhistorie lesbar bleibt. */
import { t, onLanguageChange } from './i18n.js';
import { api, ApiError, escapeHtml, fmtPrice, fmtMinutes } from './core.js';
import {
  icon, activeBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList, bindDialog,
  validate, clearErrors, showFormError, setBusy, fieldError,
} from './ui.js';
import { requireSession } from './shell.js';
import { whitelist, normalizeSelection, planAssignments } from './assignments.js';

const list = document.querySelector('[data-list]');
const dialog = document.querySelector('[data-edit-dialog]');
const form = dialog.querySelector('[data-edit-form]');
const employeesBox = form.querySelector('[data-employees]');

const state = { services: null, employees: [], error: null, editing: null };

function employeesLabel(service) {
  const allowed = whitelist(service.id, state.employees);
  if (!allowed) return t('services.employeesAll');
  const names = state.employees.filter((e) => allowed.has(e.id)).map((e) => e.name);
  return names.join(', ');
}

/* ------------------------------------------------------------------ Liste */

/** „Angebot" — dieselbe Kennzeichnung wie im ersten Block der Website. */
const offerBadge = (service) => (service.isOffer
  ? ` <span class="adm-badge st-gold align-middle">${escapeHtml(t('services.offerBadge'))}</span>`
  : '');

function actions(service) {
  const inactive = service.status === 'INACTIVE';
  return `<button type="button" class="adm-btn-ghost adm-btn-sm" data-edit="${service.id}">${icon('edit')}<span>${escapeHtml(t('common.edit'))}</span></button>
    ${inactive
      ? `<button type="button" class="adm-btn-secondary adm-btn-sm" data-toggle="${service.id}">${icon('power')}<span>${escapeHtml(t('services.activate'))}</span></button>`
      : `<button type="button" class="adm-btn-ghost adm-btn-sm" data-toggle="${service.id}">${icon('power')}<span>${escapeHtml(t('services.deactivate'))}</span></button>`}
    ${service.totalBookings === 0
      ? `<button type="button" class="adm-btn-danger adm-btn-sm" data-delete="${service.id}">${icon('trash')}<span>${escapeHtml(t('common.delete'))}</span></button>`
      : ''}`;
}

function tableView(services) {
  return `<div class="adm-table-wrap hidden lg:block">
    <table class="adm-table">
      <caption class="sr-only">${escapeHtml(t('nav.services'))}</caption>
      <thead><tr>
        <th scope="col">${escapeHtml(t('services.name'))}</th>
        <th scope="col" class="text-right">${escapeHtml(t('services.duration'))}</th>
        <th scope="col" class="text-right">${escapeHtml(t('services.price'))}</th>
        <th scope="col">${escapeHtml(t('services.employees'))}</th>
        <th scope="col">${escapeHtml(t('services.status'))}</th>
        <th scope="col" class="text-right">${escapeHtml(t('bookings.colActions'))}</th>
      </tr></thead>
      <tbody>${services.map((s) => `<tr class="${s.status === 'INACTIVE' ? 'text-fg-muted' : ''}">
        <td><div class="max-w-[320px] font-medium text-fg">${escapeHtml(s.name)}${offerBadge(s)}</div>
          ${s.description ? `<div class="max-w-[320px] truncate text-xs text-fg-muted">${escapeHtml(s.description)}</div>` : ''}</td>
        <td class="num">${escapeHtml(fmtMinutes(s.durationMinutes))}</td>
        <td class="num">${escapeHtml(fmtPrice(s.priceCents))}</td>
        <td><div class="max-w-[220px] truncate">${escapeHtml(employeesLabel(s))}</div></td>
        <td>${activeBadge(s.status === 'ACTIVE')}</td>
        <td><div class="flex justify-end gap-1.5">${actions(s)}</div></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function cardView(services) {
  return `<div class="grid gap-2.5 md:grid-cols-2 lg:hidden">${services.map((s) => `<article class="adm-item grid min-w-0 gap-2">
    <div class="flex items-start justify-between gap-3">
      <h2 class="min-w-0 break-words font-semibold text-fg">${escapeHtml(s.name)}${offerBadge(s)}</h2>
      <span class="shrink-0">${activeBadge(s.status === 'ACTIVE')}</span>
    </div>
    ${s.description ? `<p class="break-words text-[13px] text-fg-muted">${escapeHtml(s.description)}</p>` : ''}
    <p class="tnum text-sm text-fg-body">${escapeHtml(fmtMinutes(s.durationMinutes))} · ${escapeHtml(fmtPrice(s.priceCents))}</p>
    <p class="break-words text-[13px] text-fg-muted">${escapeHtml(t('services.employees'))}: ${escapeHtml(employeesLabel(s))}</p>
    <div class="mt-1 flex flex-wrap gap-2">${actions(s)}</div>
  </article>`).join('')}</div>`;
}

function renderList() {
  if (state.error) {
    list.innerHTML = errorState(state.error);
    return;
  }
  if (!state.services) {
    list.innerHTML = skeletonList(4);
    return;
  }
  if (!state.services.length) {
    list.innerHTML = emptyState({
      title: t('services.empty'),
      text: t('services.emptyHint'),
      action: `<button type="button" class="adm-btn-primary" data-new-inline>${icon('plus')}<span>${escapeHtml(t('services.add'))}</span></button>`,
    });
    return;
  }
  list.innerHTML = tableView(state.services) + cardView(state.services);
}

async function load() {
  state.error = null;
  try {
    const [serviceData, employeeData] = await Promise.all([api('/services'), api('/employees')]);
    state.services = serviceData.services;
    state.employees = employeeData.employees;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.error = err;
  }
  renderList();
  return undefined;
}

/* ------------------------------------------------------------------ Dialog */

function renderEmployeeChoices(selectedIds) {
  const active = state.employees.filter((e) => e.status === 'ACTIVE');
  employeesBox.innerHTML = active.length
    ? active.map((e) => `<label class="adm-check-row">
        <input type="checkbox" class="adm-check" data-employee="${e.id}" ${selectedIds.has(e.id) ? 'checked' : ''}>
        <span class="min-w-0 break-words">${escapeHtml(e.name)}</span>
      </label>`).join('')
    : `<p class="py-2 text-[13px] text-fg-muted">${escapeHtml(t('services.noEmployees'))}</p>`;
  syncEmployeeMode();
}

function syncEmployeeMode() {
  const selectedMode = form.elements.employeeMode.value === 'selected';
  employeesBox.querySelectorAll('[data-employee]').forEach((checkbox) => { checkbox.disabled = !selectedMode; });
  employeesBox.classList.toggle('opacity-60', !selectedMode);
}

function renderStatusOptions() {
  const select = form.elements.status;
  const value = select.value;
  select.innerHTML = ['ACTIVE', 'INACTIVE']
    .map((s) => `<option value="${s}">${escapeHtml(t(s === 'ACTIVE' ? 'common.active' : 'common.inactive'))}</option>`).join('');
  if (value) select.value = value;
}

function openEdit(service) {
  state.editing = service ?? null;
  clearErrors(form);
  form.reset();
  dialog.querySelector('[data-edit-title]').textContent = t(service ? 'services.editTitle' : 'services.addTitle');
  form.elements.name.value = service?.name ?? '';
  form.elements.description.value = service?.description ?? '';
  form.elements.isOffer.checked = service?.isOffer === true;
  form.elements.sortOrder.value = service?.sortOrder ?? 100;
  form.elements.durationMinutes.value = service?.durationMinutes ?? 30;
  form.elements.price.value = service ? (service.priceCents / 100).toFixed(2) : '';
  form.querySelector('[data-status-field]').hidden = !service;
  renderStatusOptions();
  form.elements.status.value = service?.status ?? 'ACTIVE';

  const allowed = service ? whitelist(service.id, state.employees) : null;
  form.elements.employeeMode.value = allowed ? 'selected' : 'all';
  renderEmployeeChoices(allowed ?? new Set());
  dialog.showModal();
  form.elements.name.focus();
}

const parsePrice = (value) => Number(String(value).trim().replace(/\s/g, '').replace(',', '.'));

form.addEventListener('change', (event) => {
  if (event.target.name === 'employeeMode') syncEmployeeMode();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = validate(form, [
    { name: 'name', required: true, min: 2, max: 120 },
    { name: 'description', max: 500 },
    { name: 'durationMinutes', required: true, number: true, integer: true, minValue: 5, maxValue: 480 },
    {
      name: 'price',
      required: true,
      check: (value) => {
        const n = parsePrice(value);
        return Number.isFinite(n) && n >= 0 && n <= 10000 ? null : t('validation.range', { min: 0, max: 10000 });
      },
    },
    { name: 'sortOrder', number: true, integer: true, minValue: 0, maxValue: 9999 },
  ]);
  if (!ok) return;

  const selectedMode = form.elements.employeeMode.value === 'selected';
  const selected = new Set([...employeesBox.querySelectorAll('[data-employee]:checked')].map((c) => c.dataset.employee));
  if (selectedMode && !selected.size) {
    const first = employeesBox.querySelector('[data-employee]');
    if (first) fieldError(first, t('services.employeesRequired'));
    else showFormError(form, t('services.employeesRequired'));
    return;
  }

  const body = {
    name: form.elements.name.value.trim(),
    description: form.elements.description.value.trim() || null,
    isOffer: form.elements.isOffer.checked,
    sortOrder: Number(form.elements.sortOrder.value || 100),
    durationMinutes: Number(form.elements.durationMinutes.value),
    // Der Preis steht in der Datenbank in Cent — Rundung hier, nicht dort.
    priceCents: Math.round(parsePrice(form.elements.price.value) * 100),
  };
  if (state.editing && form.elements.status.value !== state.editing.status) body.status = form.elements.status.value;

  const submit = form.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    let id = state.editing?.id;
    if (id) await api(`/services/${id}`, { method: 'PATCH', body });
    else id = (await api('/services', { method: 'POST', body })).service.id;

    // Zuordnung: nur schreiben, was sich tatsächlich ändert.
    const desired = selectedMode ? normalizeSelection(selected, state.employees) : null;
    const current = state.editing ? whitelist(id, state.employees) : null;
    const same = (!desired && !current)
      || (desired && current && desired.size === current.size && [...desired].every((e) => current.has(e)));
    if (!same) {
      for (const change of planAssignments(state.employees, new Map([[id, desired]]))) {
        await api(`/employees/${change.id}`, { method: 'PATCH', body: { serviceIds: change.serviceIds } });
      }
    }

    dialog.close();
    toast(t(state.editing ? 'common.saved' : 'services.created'));
    await load();
  } catch (err) {
    showFormError(form, err);
    if (!state.editing) await load();
  } finally {
    setBusy(submit, false);
  }
});
bindDialog(dialog);

/* ------------------------------------------------------------------ Aktionen */

list.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return load();
  if (event.target.closest('[data-new-inline]')) return openEdit(null);
  const button = event.target.closest('button');
  if (!button) return undefined;
  const { edit, toggle, delete: remove } = button.dataset;
  const find = (id) => state.services.find((s) => s.id === id);

  try {
    if (edit) return openEdit(find(edit));

    if (toggle) {
      const service = find(toggle);
      const deactivate = service.status === 'ACTIVE';
      if (deactivate) {
        const confirmed = await confirmDialog({
          title: t('services.deactivateTitle', { name: service.name }),
          message: t('services.deactivateMessage'),
          confirmLabel: t('services.deactivate'),
          danger: true,
        });
        if (!confirmed) return undefined;
      }
      setBusy(button, true);
      await api(`/services/${toggle}`, { method: 'PATCH', body: { status: deactivate ? 'INACTIVE' : 'ACTIVE' } });
      toast(t(deactivate ? 'services.deactivated' : 'services.activated', { name: service.name }));
      return load();
    }

    if (remove) {
      const service = find(remove);
      const confirmed = await confirmDialog({
        title: t('services.deleteTitle', { name: service.name }),
        message: t('services.deleteMessage'),
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!confirmed) return undefined;
      setBusy(button, true);
      await api(`/services/${remove}`, { method: 'DELETE' });
      toast(t('services.deleted', { name: service.name }));
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
  if (dialog.open) {
    dialog.querySelector('[data-edit-title]').textContent = t(state.editing ? 'services.editTitle' : 'services.addTitle');
    renderStatusOptions();
    clearErrors(form);
  }
});

(async () => {
  const user = await requireSession('services');
  if (!user) return;
  renderList();
  await load();
  if (new URL(window.location.href).searchParams.get('new') && state.services) {
    window.history.replaceState({}, '', '/admin/services');
    openEdit(null);
  }
})().catch(handleError);
