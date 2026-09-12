/* Wiederverwendbare Oberflächenteile der Verwaltung: Icons, Statusanzeigen,
   Toast, Bestätigungsdialog, Lade-/Leer-/Fehlerzustände, Formularprüfung.
   Jeder Text kommt über t() aus den Wörterbüchern. */
import { t } from './i18n.js';
import { api, ApiError, errorMessage, escapeHtml, redirectToLogin } from './core.js';

/* ---------------------------------------------------------------- Bilder
   Fotos vom Telefon haben oft 5–10 MB. Vor dem Hochladen wird im Browser auf
   höchstens 1600 px verkleinert und als JPEG gespeichert — das hält den Upload
   klein und die Website schnell. Der Server prüft das Ergebnis trotzdem. */

const IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;

export async function prepareImage(file, { maxSize = 1600, quality = 0.85 } = {}) {
  if (!file || !IMAGE_TYPES.test(file.type)) throw new ApiError(0, 'invalid_image');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new ApiError(0, 'invalid_image'));
      image.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    // Transparente PNGs bekommen den Hintergrund der Website statt Schwarz.
    context.fillStyle = '#1A1816';
    context.fillRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    return { data: canvas.toDataURL('image/jpeg', quality), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Verkleinern und hochladen; liefert { id, url, width, height }. */
export async function uploadImage(file) {
  const { data, width, height } = await prepareImage(file);
  const { media } = await api('/media', { method: 'POST', body: { data, width, height } });
  return media;
}

/* ---------------------------------------------------------------- Icons */

const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  calendarCheck: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9 15l2 2 4-4"/>',
  calendarX: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M9.5 13l5 5M14.5 13l-5 5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.7 2.7 2.4 3 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
  userX: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.5 0 2.9.4 4 1.2"/><path d="m16 15 5 5M21 15l-5 5"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
  store: '<path d="M3.5 9.5 5 4h14l1.5 5.5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0"/><path d="M5 12.5V20h14v-7.5M10 20v-4.5h4V20"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  phone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6.5 6.5l1.5-2.3 4.5 1.8V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z"/><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5v2.5M12 3.5v2.5"/>',
  unlink: '<path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a4.2 4.2 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4.2 4.2 0 0 1-6-6l1.5-1.5"/>',
  link: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

export function icon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] ?? PATHS.info}</svg>`;
}

/* -------------------------------------------------------------- Statusse */

const STATUS_ICON = {
  PENDING: 'clock', CONFIRMED: 'checkCircle', CANCELLED: 'xCircle', COMPLETED: 'check', NO_SHOW: 'userX',
};

/** Nie Farbe allein: Icon + Text + Farbe (WCAG 1.4.1, admin.md). */
export const statusBadge = (status) =>
  `<span class="adm-badge st-${escapeHtml(String(status).toLowerCase())}">${icon(STATUS_ICON[status] ?? 'info')}<span>${escapeHtml(t(`status.${status}`))}</span></span>`;

export const activeBadge = (active) =>
  `<span class="adm-badge ${active ? 'st-active' : 'st-inactive'}">${icon(active ? 'checkCircle' : 'power')}<span>${escapeHtml(t(active ? 'common.active' : 'common.inactive'))}</span></span>`;

/* ----------------------------------------------------------------- Toast */

let toastTimer;
export function toast(message, kind = 'ok') {
  let host = document.querySelector('[data-toast]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-toast', '');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
  }
  host.className = `adm-toast ${kind === 'error' ? 'bg-danger text-bg' : kind === 'warn' ? 'bg-warn text-bg' : 'bg-accent text-accent-on'}`;
  host.textContent = message;
  host.hidden = false;
  // Ein modaler Dialog liegt in der obersten Ebene — der Toast muss mit hinein.
  const openDialogs = document.querySelectorAll('dialog[open]');
  const openDialog = openDialogs[openDialogs.length - 1];
  (openDialog ?? document.body).append(host);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.hidden = true; }, kind === 'error' ? 6000 : 3500);
}

/** Einheitliche Fehlerbehandlung: abgelaufene Session führt zurück zur Anmeldung. */
export function handleError(err) {
  if (err instanceof ApiError && err.status === 401) {
    redirectToLogin();
    return;
  }
  console.error(err);
  toast(errorMessage(err), 'error');
}

/* --------------------------------------------------------------- Dialoge */

export const closeButton = () =>
  `<button type="button" class="adm-icon-btn adm-icon-btn-plain" data-close aria-label="${escapeHtml(t('common.close'))}">${icon('close')}</button>`;

/** Schließen über [data-close] und über einen Klick auf den Hintergrund. */
/**
 * Klick auf die Fläche neben dem Dialog schließt ihn — aber nur, wenn er dort
 * auch begonnen hat.
 *
 * Ohne diese Einschränkung ging das Fenster beim Markieren von Text zu: wer in
 * einem Feld die Maus drückt und außerhalb loslässt, erzeugt ein Klick-Ereignis
 * auf dem gemeinsamen Elternelement — und das ist das <dialog> selbst. Die
 * Eingaben waren damit weg, ohne dass jemand etwas geschlossen hätte.
 */
export function closeOnBackdrop(dialog, close) {
  let startedOutside = false;
  dialog.addEventListener('pointerdown', (event) => {
    startedOutside = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    const outside = event.target === dialog && startedOutside;
    startedOutside = false;
    if (outside) close();
  });
}

export function bindDialog(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) dialog.close();
  });
  closeOnBackdrop(dialog, () => dialog.close());
}

/** Ersatz für window.confirm: übersetzt, im Stil der Verwaltung, "Abbrechen" vorausgewählt. */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'adm-dialog adm-dialog-narrow';
    dialog.setAttribute('aria-labelledby', 'adm-confirm-title');
    dialog.innerHTML = `
      <div class="adm-dialog-head"><h2 id="adm-confirm-title" class="adm-dialog-title">${escapeHtml(title)}</h2></div>
      <div class="adm-dialog-body"><p class="text-sm leading-relaxed text-fg-body">${escapeHtml(message)}</p></div>
      <div class="adm-dialog-foot">
        <button type="button" class="adm-btn-ghost" data-answer="no">${escapeHtml(t('common.cancel'))}</button>
        <button type="button" class="${danger ? 'adm-btn-danger' : 'adm-btn-primary'}" data-answer="yes">${escapeHtml(confirmLabel ?? t('common.confirm'))}</button>
      </div>`;
    /* Die Antwort wird direkt beim Klick weitergegeben. Das close-Ereignis des
       Dialogs kommt asynchron — in einem Hintergrund-Tab erst verzögert — und
       dient nur noch als Rückfallweg (z. B. Schließen über den Browser). */
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    };
    dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-answer]');
      if (button) finish(button.dataset.answer === 'yes');
    });
    closeOnBackdrop(dialog, () => finish(false));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('[data-answer="no"]').focus();
  });
}

/* --------------------------------------------------------------- Zustände */

export function skeletonList(count = 4) {
  const item = '<div class="adm-item"><div class="adm-skel h-4 w-2/5"></div><div class="adm-skel mt-3 h-3 w-3/4"></div><div class="adm-skel mt-2 h-3 w-1/2"></div></div>';
  return `<div class="adm-list" aria-busy="true"><span class="sr-only">${escapeHtml(t('common.loading'))}</span>${item.repeat(count)}</div>`;
}

export function skeletonStats(count = 4) {
  const tile = '<div class="adm-stat"><div class="adm-skel h-3 w-1/2"></div><div class="adm-skel mt-2 h-7 w-1/3"></div></div>';
  return `<span class="sr-only">${escapeHtml(t('common.loading'))}</span>${tile.repeat(count)}`;
}

export function emptyState({ title, text = '', action = '' }) {
  return `<div class="adm-empty">
    <p class="adm-empty-title">${escapeHtml(title)}</p>
    ${text ? `<p class="adm-empty-text">${escapeHtml(text)}</p>` : ''}
    ${action ? `<div class="mt-4 flex flex-wrap justify-center gap-2">${action}</div>` : ''}
  </div>`;
}

/** Fehlerzustand mit "Erneut versuchen"; der Knopf trägt [data-retry]. */
export function errorState(err) {
  return `<div class="adm-callout adm-callout-danger" role="alert">${icon('alert')}
    <div class="min-w-0 flex-1">
      <p>${escapeHtml(typeof err === 'string' ? err : errorMessage(err))}</p>
      <button type="button" class="adm-btn-ghost adm-btn-sm mt-3" data-retry>${icon('refresh')}<span>${escapeHtml(t('common.retry'))}</span></button>
    </div>
  </div>`;
}

export function setBusy(button, busy, labelKey = 'common.saving') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = t(labelKey);
  } else {
    if (button.dataset.label !== undefined) button.innerHTML = button.dataset.label;
    delete button.dataset.label;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/* ---------------------------------------------------------- Formularprüfung
   Bequemlichkeit, kein Schutz — dieselben Regeln prüft das Backend noch einmal.
   Sie steht hier, damit Fehler in der gewählten Sprache und am Feld erscheinen. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function clearErrors(form) {
  form.querySelectorAll('[data-field-error]').forEach((node) => node.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
    field.removeAttribute('aria-invalid');
    const rest = (field.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && !id.endsWith('-error'));
    if (rest.length) field.setAttribute('aria-describedby', rest.join(' '));
    else field.removeAttribute('aria-describedby');
  });
  const box = form.querySelector('[data-form-error]');
  if (box) box.hidden = true;
}

export function fieldError(field, message) {
  const id = `${field.id || field.name || 'field'}-error`;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
  const node = document.createElement('p');
  node.className = 'adm-field-error';
  node.id = id;
  node.setAttribute('data-field-error', '');
  node.textContent = message;
  (field.closest('[data-field]') ?? field.parentElement).append(node);
}

/**
 * rules: [{ name, required, min, max, email, number, integer, minValue, maxValue, check(value) }]
 * Liefert true, wenn alles passt; sonst stehen die Meldungen an den Feldern.
 */
export function validate(form, rules) {
  clearErrors(form);
  let first = null;
  for (const rule of rules) {
    const field = form.elements[rule.name];
    if (!field) continue;
    const value = String(field.value ?? '').trim();
    let message = null;

    if (rule.required && !value) message = t('validation.required');
    else if (value && rule.min && value.length < rule.min) message = t('validation.minLength', { min: rule.min });
    else if (value && rule.max && value.length > rule.max) message = t('validation.maxLength', { max: rule.max });
    else if (value && rule.email && !EMAIL.test(value)) message = t('validation.email');
    else if (value && rule.number) {
      const n = Number(value);
      if (!Number.isFinite(n)) message = t('validation.number');
      else if (rule.integer && !Number.isInteger(n)) message = t('validation.integer');
      else if ((rule.minValue !== undefined && n < rule.minValue) || (rule.maxValue !== undefined && n > rule.maxValue)) {
        message = t('validation.range', { min: rule.minValue, max: rule.maxValue });
      }
    }
    if (!message && rule.check) message = rule.check(value);

    if (message) {
      fieldError(field, message);
      if (!first) first = field;
    }
  }
  first?.focus();
  return !first;
}

/** Fehler der API oben im Formular anzeigen; 401 führt zur Anmeldung. */
export function showFormError(form, err) {
  if (err instanceof ApiError && err.status === 401) {
    redirectToLogin();
    return;
  }
  const box = form.querySelector('[data-form-error]');
  const message = typeof err === 'string' ? err : errorMessage(err);
  if (!box) {
    toast(message, 'error');
    return;
  }
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}

export const formErrorBox = () => '<p class="adm-form-error" data-form-error role="alert" hidden></p>';
