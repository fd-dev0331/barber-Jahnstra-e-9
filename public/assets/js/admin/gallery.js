/* /admin/gallery — Bilder der Galerie auf der Website: hochladen, beschreiben,
   sortieren, ein- und ausblenden, löschen.

   Solange hier kein aktives Bild steht, zeigt die Website ihre Beispielbilder
   aus dem HTML weiter — eine leere Galerie sieht niemand. */
import { t, tn, onLanguageChange } from './i18n.js';
import { api, ApiError, escapeHtml, errorMessage } from './core.js';
import {
  icon, activeBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList, bindDialog,
  validate, clearErrors, showFormError, setBusy, uploadImage,
} from './ui.js';
import { requireSession } from './shell.js';

const list = document.querySelector('[data-list]');
const uploadInput = document.querySelector('[data-upload-input]');
const uploadStatus = document.querySelector('[data-upload-status]');
const dialog = document.querySelector('[data-edit-dialog]');
const form = dialog.querySelector('[data-edit-form]');

const state = { items: null, error: null, editing: null };

/* ------------------------------------------------------------------ Liste */

function card(item, index) {
  const active = item.status === 'ACTIVE';
  const iconButton = (attrs, name, labelKey, disabled = false) => {
    const label = escapeHtml(t(labelKey));
    return `<button type="button" class="adm-icon-btn h-10 w-10" ${attrs} aria-label="${label}" title="${label}" ${disabled ? 'disabled' : ''}>${icon(name)}</button>`;
  };
  return `<article class="adm-card flex min-w-0 flex-col overflow-hidden ${active ? '' : 'opacity-80'}">
    <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || '')}" loading="lazy" decoding="async"
      class="aspect-square w-full bg-bg object-cover">
    <div class="grid flex-1 content-start gap-2 p-3">
      <div class="flex items-start justify-between gap-2">
        <p class="min-w-0 break-words text-[13px] ${item.alt ? 'text-fg-body' : 'text-fg-muted'}">${escapeHtml(item.alt || t('gallery.noAlt'))}</p>
        <span class="shrink-0">${activeBadge(active)}</span>
      </div>
      ${item.source === 'INSTAGRAM' ? `<p class="text-xs text-fg-muted">${escapeHtml(t('gallery.sourceInstagram'))}</p>` : ''}
      <div class="flex flex-wrap gap-1.5">
        ${iconButton(`data-move="-1" data-id="${item.id}"`, 'arrowUp', 'gallery.moveUp', index === 0)}
        ${iconButton(`data-move="1" data-id="${item.id}"`, 'arrowDown', 'gallery.moveDown', index === state.items.length - 1)}
        ${iconButton(`data-edit="${item.id}"`, 'edit', 'common.edit')}
        ${iconButton(`data-toggle="${item.id}"`, active ? 'power' : 'checkCircle', active ? 'gallery.hide' : 'gallery.show')}
        <button type="button" class="adm-icon-btn h-10 w-10 hover:border-danger hover:text-danger" data-delete="${item.id}"
          aria-label="${escapeHtml(t('common.delete'))}" title="${escapeHtml(t('common.delete'))}">${icon('trash')}</button>
      </div>
    </div>
  </article>`;
}

function render() {
  if (state.error) {
    list.innerHTML = errorState(state.error);
    return;
  }
  if (!state.items) {
    list.innerHTML = skeletonList(3);
    return;
  }
  if (!state.items.length) {
    list.innerHTML = emptyState({ title: t('gallery.empty'), text: t('gallery.emptyHint') });
    return;
  }
  const visible = state.items.filter((i) => i.status === 'ACTIVE').length;
  list.innerHTML = `<p class="mb-3 text-[13px] text-fg-muted">${escapeHtml(tn('gallery.count', state.items.length, { visible }))}</p>
    <div class="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">${state.items.map(card).join('')}</div>`;
}

async function load() {
  state.error = null;
  try {
    state.items = (await api('/gallery')).items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.error = err;
  }
  render();
  return undefined;
}

/* -------------------------------------------------------------- Hochladen */

uploadInput.addEventListener('change', async () => {
  const files = [...uploadInput.files];
  uploadInput.value = '';
  if (!files.length) return;

  uploadInput.disabled = true;
  uploadStatus.hidden = false;
  let done = 0;
  let lastError = null;
  for (const file of files) {
    uploadStatus.textContent = t('gallery.uploading', { current: done + 1, total: files.length });
    try {
      const media = await uploadImage(file);
      await api('/gallery', { method: 'POST', body: { mediaId: media.id } });
      done += 1;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return handleError(err);
      lastError = err;
    }
  }
  uploadInput.disabled = false;
  uploadStatus.hidden = true;

  if (lastError) {
    toast(`${t('gallery.uploadFailed', { failed: files.length - done, total: files.length })} ${errorMessage(lastError)}`, 'error');
  } else {
    toast(tn('gallery.uploaded', done));
  }
  await load();
  return undefined;
});

/* ------------------------------------------------------------------ Aktionen */

list.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return load();
  const button = event.target.closest('button');
  if (!button || button.disabled) return undefined;
  const { move, edit, toggle, delete: remove, id } = button.dataset;
  const find = (itemId) => state.items.find((i) => i.id === itemId);

  try {
    if (move) {
      const ids = state.items.map((i) => i.id);
      const from = ids.indexOf(id);
      const to = from + Number(move);
      if (to < 0 || to >= ids.length) return undefined;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      button.disabled = true;
      state.items = (await api('/gallery/reorder', { method: 'POST', body: { ids } })).items;
      render();
      // Fokus bleibt beim verschobenen Bild, damit man weiter schieben kann.
      list.querySelector(`[data-move="${move}"][data-id="${id}"]:not([disabled])`)?.focus();
      return undefined;
    }

    if (edit) {
      const item = find(edit);
      state.editing = item;
      clearErrors(form);
      form.elements.alt.value = item.alt ?? '';
      dialog.querySelector('[data-edit-preview]').src = item.url;
      dialog.showModal();
      form.elements.alt.focus();
      return undefined;
    }

    if (toggle) {
      const item = find(toggle);
      setBusy(button, true);
      await api(`/gallery/${toggle}`, {
        method: 'PATCH',
        body: { status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
      });
      toast(t(item.status === 'ACTIVE' ? 'gallery.hidden' : 'gallery.shown'));
      return load();
    }

    if (remove) {
      const confirmed = await confirmDialog({
        title: t('gallery.deleteTitle'),
        message: t('gallery.deleteMessage'),
        confirmLabel: t('common.delete'),
        danger: true,
      });
      if (!confirmed) return undefined;
      setBusy(button, true);
      await api(`/gallery/${remove}`, { method: 'DELETE' });
      toast(t('gallery.deleted'));
      return load();
    }
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
  return undefined;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate(form, [{ name: 'alt', max: 200 }])) return;
  const submit = form.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    await api(`/gallery/${state.editing.id}`, {
      method: 'PATCH',
      body: { alt: form.elements.alt.value.trim() || null },
    });
    dialog.close();
    toast(t('common.saved'));
    await load();
  } catch (err) {
    showFormError(form, err);
  } finally {
    setBusy(submit, false);
  }
});
bindDialog(dialog);

onLanguageChange(() => {
  render();
  if (dialog.open) clearErrors(form);
});

(async () => {
  const user = await requireSession('gallery');
  if (!user) return;
  render();
  await load();
})().catch(handleError);
