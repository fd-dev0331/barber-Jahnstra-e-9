/* /admin/services — Leistungen anlegen, ändern, deaktivieren.
   Gelöscht wird nur, was nie gebucht wurde; alles andere wird inaktiv gesetzt,
   damit die Terminhistorie lesbar bleibt. */
import { api, requireSession, escapeHtml, fmtPrice, toast, handleError } from './core.js';

const list = document.querySelector('[data-list]');
const dialog = document.querySelector('[data-dialog]');
const form = dialog.querySelector('[data-form]');
const error = dialog.querySelector('[data-error]');

let services = [];
let editing = null;

function row(service) {
  const inactive = service.status === 'INACTIVE';
  return `<article class="card flex flex-wrap items-center justify-between gap-4 ${inactive ? 'opacity-70' : ''}">
    <div class="min-w-0">
      <p class="font-semibold text-fg">${escapeHtml(service.name)}</p>
      <p class="text-[13px] text-fg-muted">
        ${escapeHtml(service.category ?? 'ohne Kategorie')} · ${service.durationMinutes} min · ${escapeHtml(fmtPrice(service.priceCents))}
      </p>
      ${service.description ? `<p class="mt-1 text-[13px] text-fg-muted">${escapeHtml(service.description)}</p>` : ''}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge ${inactive ? 'bg-surface-2 text-fg-muted' : 'bg-ok/15 text-ok'}">${inactive ? 'inaktiv' : 'aktiv'}</span>
      <button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-edit="${service.id}">Bearbeiten</button>
      <button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-toggle="${service.id}">
        ${inactive ? 'Aktivieren' : 'Deaktivieren'}
      </button>
      ${service.totalBookings === 0
        ? `<button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px] hover:border-danger hover:text-danger" data-delete="${service.id}">Löschen</button>`
        : ''}
    </div>
  </article>`;
}

async function load() {
  list.innerHTML = '<p class="text-fg-muted">Wird geladen …</p>';
  const data = await api('/services');
  services = data.services;
  list.innerHTML = services.length
    ? services.map(row).join('')
    : '<p class="rounded-lg border border-dashed border-line p-6 text-center text-[15px] text-fg-muted">Noch keine Leistung angelegt.</p>';
}

function openDialog(service) {
  editing = service ?? null;
  error.hidden = true;
  form.reset();
  dialog.querySelector('[data-dialog-title]').textContent = service ? 'Leistung bearbeiten' : 'Leistung anlegen';
  form.name.value = service?.name ?? '';
  form.description.value = service?.description ?? '';
  form.category.value = service?.category ?? '';
  form.sortOrder.value = service?.sortOrder ?? 100;
  form.durationMinutes.value = service?.durationMinutes ?? 30;
  form.price.value = service ? (service.priceCents / 100).toFixed(2) : '';
  dialog.showModal();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;

  const body = {
    name: form.name.value,
    description: form.description.value || null,
    category: form.category.value || null,
    sortOrder: Number(form.sortOrder.value),
    durationMinutes: Number(form.durationMinutes.value),
    // Der Preis steht in der Datenbank in Cent — Rundung hier, nicht dort.
    priceCents: Math.round(Number(form.price.value) * 100),
  };

  try {
    if (editing) await api(`/services/${editing.id}`, { method: 'PATCH', body });
    else await api('/services', { method: 'POST', body });
    dialog.close();
    toast(editing ? 'Gespeichert.' : 'Leistung angelegt.');
    await load();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

list.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const { edit, toggle, delete: remove } = target.dataset;

  try {
    if (edit) return openDialog(services.find((s) => s.id === edit));
    if (toggle) {
      const service = services.find((s) => s.id === toggle);
      await api(`/services/${toggle}`, {
        method: 'PATCH',
        body: { status: service.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      toast('Status geändert.');
      return load();
    }
    if (remove) {
      if (!window.confirm('Diese Leistung endgültig löschen?')) return undefined;
      await api(`/services/${remove}`, { method: 'DELETE' });
      toast('Gelöscht.');
      return load();
    }
  } catch (err) {
    handleError(err);
  }
  return undefined;
});

dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
document.querySelector('[data-new]').addEventListener('click', () => openDialog(null));

(async () => {
  const user = await requireSession('/admin/services');
  if (!user) return;
  await load();
})().catch(handleError);
