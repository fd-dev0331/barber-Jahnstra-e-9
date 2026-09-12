/* /admin/settings — Konto, Sprache der Verwaltung, Passwort, Benutzerkonten, Abmelden.

   Für jede Rolle erreichbar: das eigene Passwort darf jeder ändern
   (POST /api/admin/password). Die Konten sieht nur der Inhaber; das Backend
   verweigert sie allen anderen ohnehin mit 403. */
import { t, getLanguage, setLanguage, LANGUAGES, onLanguageChange } from './i18n.js';
import { api, ApiError, session, isOwner, roleLabel, escapeHtml } from './core.js';
import {
  icon, activeBadge, toast, handleError, confirmDialog, emptyState, errorState, skeletonList, bindDialog,
  validate, clearErrors, showFormError, setBusy,
} from './ui.js';
import { requireSession } from './shell.js';
import { isMiniApp, clearToken } from './telegram.js';

const passwordForm = document.querySelector('[data-password-form]');
const usersBox = document.querySelector('[data-users]');
const userDialog = document.querySelector('[data-user-dialog]');
const userForm = userDialog.querySelector('[data-user-form]');
const telegramBox = document.querySelector('[data-telegram]');
const telegramBotBox = document.querySelector('[data-telegram-bot]');

const state = { users: null, employees: [], usersError: null, telegram: null, telegramError: null };

/* -------------------------------------------------------------- Konto */

function renderAccount() {
  const { user, employee } = session;
  document.querySelector('[data-account]').innerHTML = `<dl class="adm-dl">
    <dt>${escapeHtml(t('employees.name'))}</dt><dd>${escapeHtml(user.name)}</dd>
    <dt>${escapeHtml(t('login.email'))}</dt><dd class="break-all">${escapeHtml(user.email)}</dd>
    <dt>${escapeHtml(t('settings.role'))}</dt><dd><span class="adm-badge st-gold">${escapeHtml(roleLabel(user.role))}</span></dd>
    <dt>${escapeHtml(t('settings.linkedEmployee'))}</dt>
    <dd>${employee ? escapeHtml(employee.name) : `<span class="text-fg-muted">${escapeHtml(t('settings.noLinkedEmployee'))}</span>`}</dd>
  </dl>`;
}

/* ------------------------------------------------------------- Sprache */

function renderLanguages() {
  const current = getLanguage();
  document.querySelector('[data-languages]').innerHTML = LANGUAGES.map((language) => `
    <label class="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors ${language.code === current
      ? 'border-accent bg-accent/10 text-fg' : 'border-line-strong text-fg-body hover:border-accent'}">
      <input type="radio" name="language" value="${language.code}" class="adm-check" ${language.code === current ? 'checked' : ''}>
      <span class="min-w-0 flex-1" lang="${language.code}">${escapeHtml(language.label)}</span>
      <span class="text-xs font-semibold text-fg-muted">${language.code.toUpperCase()}</span>
    </label>`).join('');
}

document.querySelector('[data-languages]').addEventListener('change', (event) => {
  if (event.target.name !== 'language') return;
  setLanguage(event.target.value);
  toast(t('settings.languageSaved'));
});

/* ------------------------------------------------------------- Passwort */

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = passwordForm.elements;
  const ok = validate(passwordForm, [
    { name: 'currentPassword', required: true },
    { name: 'newPassword', required: true, min: 10, max: 200 },
    { name: 'repeatPassword', required: true, check: (v) => (v !== f.newPassword.value ? t('validation.passwordMismatch') : null) },
  ]);
  if (!ok) return;

  const submit = passwordForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    await api('/password', {
      method: 'POST',
      body: { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value },
    });
    passwordForm.reset();
    toast(t('settings.passwordChanged'));
  } catch (err) {
    showFormError(passwordForm, err);
  } finally {
    setBusy(submit, false);
  }
});

/* ---------------------------------------------------------------- Telegram */

function telegramRow(account) {
  return `<div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-3 sm:px-4">
    <div class="min-w-0">
      <p class="break-words font-semibold text-fg">${escapeHtml(account.name)}${
        account.username ? ` <span class="font-normal text-fg-muted">@${escapeHtml(account.username)}</span>` : ''}</p>
      <p class="break-all text-[13px] text-fg-muted">${escapeHtml(account.account.name)} · ${escapeHtml(account.account.email)}</p>
      <p class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span class="adm-badge st-gold">${escapeHtml(roleLabel(account.account.role))}</span>
        ${account.isSelf ? `<span class="text-xs text-fg-muted">${escapeHtml(t('settings.you'))}</span>` : ''}
      </p>
    </div>
    <button type="button" class="adm-btn-ghost adm-btn-sm" data-unlink="${account.id}">
      ${icon('unlink')}<span>${escapeHtml(t('telegram.unlink'))}</span>
    </button>
  </div>`;
}

function renderTelegram() {
  if (state.telegramError) {
    telegramBotBox.innerHTML = '';
    telegramBox.innerHTML = errorState(state.telegramError);
    return;
  }
  if (!state.telegram) {
    telegramBotBox.innerHTML = '';
    telegramBox.innerHTML = skeletonList(1);
    return;
  }

  const { bot, accounts } = state.telegram;
  if (!bot.configured) {
    telegramBotBox.innerHTML = `<p class="text-sm text-fg-body">${escapeHtml(t('telegram.notConfigured'))}</p>`;
  } else if (bot.username) {
    telegramBotBox.innerHTML = `<p class="text-sm text-fg-body">${escapeHtml(t('telegram.botIs'))}
      <a class="adm-link" href="https://t.me/${encodeURIComponent(bot.username)}" target="_blank" rel="noopener">@${escapeHtml(bot.username)}</a></p>`;
  } else {
    telegramBotBox.innerHTML = `<p class="text-sm text-fg-body">${escapeHtml(t('telegram.botUnreachable'))}</p>`;
  }

  telegramBox.innerHTML = accounts.length
    ? accounts.map(telegramRow).join('')
    : emptyState({ title: t('telegram.noAccounts'), text: t('telegram.noAccountsHint') });
}

async function loadTelegram() {
  state.telegramError = null;
  try {
    state.telegram = await api('/telegram');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.telegramError = err;
  }
  renderTelegram();
  return undefined;
}

telegramBox.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return loadTelegram();
  const button = event.target.closest('[data-unlink]');
  if (!button) return undefined;
  const account = state.telegram.accounts.find((entry) => entry.id === button.dataset.unlink);
  const confirmed = await confirmDialog({
    title: t('telegram.unlinkTitle', { name: account.name }),
    message: t(account.isSelf ? 'telegram.unlinkOwnMessage' : 'telegram.unlinkMessage'),
    confirmLabel: t('telegram.unlink'),
    danger: true,
  });
  if (!confirmed) return undefined;

  setBusy(button, true);
  try {
    await api(`/telegram/${account.id}`, { method: 'DELETE' });
    /* Die eigene Verknüpfung in der Mini App zu lösen heißt: diese Sitzung ist
       vorbei. Das Token wegwerfen und zurück zur Anmeldung. */
    if (account.isSelf && isMiniApp()) {
      clearToken();
      window.location.href = '/admin';
      return undefined;
    }
    toast(t('telegram.unlinked'));
    await loadTelegram();
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
  return undefined;
});

/* ------------------------------------------------------------------ Konten */

function userRow(user) {
  const inactive = user.status === 'INACTIVE';
  const locked = user.role === 'OWNER' || user.isSelf;
  return `<div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-3 sm:px-4">
    <div class="min-w-0">
      <p class="break-words font-semibold text-fg">${escapeHtml(user.name)}${user.isSelf ? ` <span class="font-normal text-fg-muted">(${escapeHtml(t('settings.you'))})</span>` : ''}</p>
      <p class="break-all text-[13px] text-fg-muted">${escapeHtml(user.email)}</p>
      <p class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span class="adm-badge st-gold">${escapeHtml(roleLabel(user.role))}</span>
        ${activeBadge(!inactive)}
        ${user.employee ? `<span class="text-xs text-fg-muted">${escapeHtml(t('settings.linkedWith', { name: user.employee.name }))}</span>` : ''}
      </p>
    </div>
    ${locked ? '' : `<button type="button" class="${inactive ? 'adm-btn-secondary' : 'adm-btn-ghost'} adm-btn-sm"
        data-toggle-user="${user.id}" data-next="${inactive ? 'ACTIVE' : 'INACTIVE'}">
        ${icon(inactive ? 'checkCircle' : 'lock')}<span>${escapeHtml(t(inactive ? 'settings.unlock' : 'settings.lock'))}</span>
      </button>`}
  </div>`;
}

function renderUsers() {
  if (state.usersError) {
    usersBox.innerHTML = errorState(state.usersError);
    return;
  }
  if (!state.users) {
    usersBox.innerHTML = skeletonList(2);
    return;
  }
  usersBox.innerHTML = state.users.length ? state.users.map(userRow).join('') : emptyState({ title: t('settings.noUsers') });
}

async function loadUsers() {
  state.usersError = null;
  try {
    const [{ users }, { employees }] = await Promise.all([api('/users'), api('/employees')]);
    state.users = users;
    state.employees = employees;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return handleError(err);
    state.usersError = err;
  }
  renderUsers();
  return undefined;
}

usersBox.addEventListener('click', async (event) => {
  if (event.target.closest('[data-retry]')) return loadUsers();
  const button = event.target.closest('[data-toggle-user]');
  if (!button) return undefined;
  const user = state.users.find((u) => u.id === button.dataset.toggleUser);
  const lock = button.dataset.next === 'INACTIVE';
  if (lock) {
    const confirmed = await confirmDialog({
      title: t('settings.lockTitle', { name: user.name }),
      message: t('settings.lockMessage'),
      confirmLabel: t('settings.lock'),
      danger: true,
    });
    if (!confirmed) return undefined;
  }
  setBusy(button, true);
  try {
    await api(`/users/${user.id}`, { method: 'PATCH', body: { status: button.dataset.next } });
    toast(t(lock ? 'settings.locked' : 'settings.unlocked', { name: user.name }));
    await loadUsers();
  } catch (err) {
    setBusy(button, false);
    handleError(err);
  }
  return undefined;
});

function renderUserSelects() {
  const role = userForm.elements.role;
  const roleValue = role.value || 'EMPLOYEE';
  role.innerHTML = ['EMPLOYEE', 'ADMIN'].map((r) => `<option value="${r}">${escapeHtml(roleLabel(r))}</option>`).join('');
  role.value = roleValue;

  const employee = userForm.elements.employeeId;
  const employeeValue = employee.value;
  // Ein Mitarbeitereintrag hängt höchstens an einem Konto (employee_user_idx).
  const taken = new Set((state.users ?? []).map((u) => u.employee?.id).filter(Boolean));
  employee.innerHTML = `<option value="">${escapeHtml(t('settings.noLinkedEmployee'))}</option>${state.employees
    .filter((e) => !taken.has(e.id))
    .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.status === 'INACTIVE' ? ` (${escapeHtml(t('common.inactive'))})` : ''}</option>`)
    .join('')}`;
  employee.value = employeeValue;
}

document.querySelector('[data-new-user]').addEventListener('click', () => {
  clearErrors(userForm);
  userForm.reset();
  renderUserSelects();
  userDialog.showModal();
  userForm.elements.name.focus();
});

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = userForm.elements;
  const ok = validate(userForm, [
    { name: 'name', required: true, min: 2, max: 120 },
    { name: 'email', required: true, email: true, max: 200 },
    { name: 'password', required: true, min: 10, max: 200 },
    { name: 'employeeId', check: (v) => (!v && f.role.value === 'EMPLOYEE' ? t('settings.employeeLinkRequired') : null) },
  ]);
  if (!ok) return;

  const submit = userForm.querySelector('button[type="submit"]');
  setBusy(submit, true);
  try {
    await api('/users', {
      method: 'POST',
      body: {
        name: f.name.value.trim(),
        email: f.email.value.trim(),
        password: f.password.value,
        role: f.role.value,
        employeeId: f.employeeId.value || null,
      },
    });
    userDialog.close();
    toast(t('settings.userCreated'));
    await loadUsers();
  } catch (err) {
    showFormError(userForm, err);
  } finally {
    setBusy(submit, false);
  }
});
bindDialog(userDialog);

/* ---------------------------------------------------------------- Start */

onLanguageChange(() => {
  renderAccount();
  renderLanguages();
  renderTelegram();
  clearErrors(passwordForm);
  if (isOwner(session.user)) {
    renderUsers();
    if (userDialog.open) {
      renderUserSelects();
      clearErrors(userForm);
    }
  }
});

(async () => {
  const user = await requireSession('settings');
  if (!user) return;
  renderAccount();
  renderLanguages();
  // In Telegram beendet der Knopf „Abmelden" nichts: der nächste Start meldet
  // sich sofort wieder an. Dort führt der Weg über „Verknüpfung lösen".
  if (isMiniApp()) document.querySelector('[data-logout-section]').hidden = true;
  renderTelegram();
  await loadTelegram();
  if (isOwner(user)) {
    document.querySelector('[data-owner-only]').hidden = false;
    renderUsers();
    await loadUsers();
  }
})().catch(handleError);
