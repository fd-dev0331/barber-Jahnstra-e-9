/* /admin/settings — Betriebsdaten, eigenes Passwort, Konten.
   Der Abschnitt „Konten“ ist dem Inhaber vorbehalten; das Backend prüft das
   ebenfalls, hier wird er nur ausgeblendet. */
import { api, requireSession, escapeHtml, toast, handleError, isOwner, ROLE_LABEL } from './core.js';

const businessForm = document.querySelector('[data-form="business"]');
const passwordForm = document.querySelector('[data-form="password"]');
const usersBox = document.querySelector('[data-users]');
const userDialog = document.querySelector('[data-user-dialog]');
const userForm = userDialog.querySelector('[data-form]');

let employees = [];

async function loadBusiness() {
  const { business } = await api('/settings');
  for (const [key, value] of Object.entries({
    name: business.name,
    timezone: business.timezone,
    address: business.address,
    phone: business.phone,
    email: business.email,
    instagram: business.instagram ?? '',
    slotStepMinutes: business.slotStepMinutes,
    leadTimeMinutes: business.leadTimeMinutes,
    maxAdvanceDays: business.maxAdvanceDays,
  })) {
    if (businessForm[key]) businessForm[key].value = value ?? '';
  }
}

businessForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('[data-error="business"]');
  errorBox.hidden = true;
  try {
    await api('/settings', {
      method: 'PATCH',
      body: {
        name: businessForm.name.value,
        timezone: businessForm.timezone.value,
        address: businessForm.address.value,
        phone: businessForm.phone.value,
        email: businessForm.email.value,
        instagram: businessForm.instagram.value || null,
        slotStepMinutes: Number(businessForm.slotStepMinutes.value),
        leadTimeMinutes: Number(businessForm.leadTimeMinutes.value),
        maxAdvanceDays: Number(businessForm.maxAdvanceDays.value),
      },
    });
    toast('Gespeichert.');
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = document.querySelector('[data-error="password"]');
  errorBox.hidden = true;
  try {
    await api('/password', {
      method: 'POST',
      body: {
        currentPassword: passwordForm.currentPassword.value,
        newPassword: passwordForm.newPassword.value,
      },
    });
    passwordForm.reset();
    toast('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

/* ------------------------------------------------------------------ Konten */

function userRow(user) {
  const inactive = user.status === 'INACTIVE';
  return `<div class="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line bg-surface-2 px-4 py-3 ${inactive ? 'opacity-70' : ''}">
    <div class="min-w-0">
      <p class="font-semibold text-fg">${escapeHtml(user.name)}${user.isSelf ? ' (du)' : ''}</p>
      <p class="text-[13px] text-fg-muted">
        ${escapeHtml(user.email)} · ${escapeHtml(ROLE_LABEL[user.role] ?? user.role)}
        ${user.employee ? ` · verknüpft mit ${escapeHtml(user.employee.name)}` : ''}
      </p>
    </div>
    ${user.role === 'OWNER' || user.isSelf
      ? `<span class="badge bg-surface text-fg-muted">${inactive ? 'gesperrt' : 'aktiv'}</span>`
      : `<button type="button" class="btn-ghost min-h-[36px] px-3 py-1.5 text-[13px]" data-toggle-user="${user.id}" data-next="${inactive ? 'ACTIVE' : 'INACTIVE'}">
          ${inactive ? 'Entsperren' : 'Sperren'}
        </button>`}
  </div>`;
}

async function loadUsers() {
  const [{ users }, { employees: list }] = await Promise.all([api('/users'), api('/employees')]);
  employees = list;
  usersBox.innerHTML = users.map(userRow).join('');
}

usersBox.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-toggle-user]');
  if (!button) return;
  try {
    await api(`/users/${button.dataset.toggleUser}`, { method: 'PATCH', body: { status: button.dataset.next } });
    toast(button.dataset.next === 'INACTIVE' ? 'Konto gesperrt.' : 'Konto entsperrt.');
    await loadUsers();
  } catch (err) {
    handleError(err);
  }
});

document.querySelector('[data-new-user]')?.addEventListener('click', () => {
  userForm.reset();
  userForm.querySelector('[data-error]').hidden = true;
  userForm.employeeId.innerHTML = ['<option value="">— keiner —</option>']
    .concat(employees.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`))
    .join('');
  userDialog.showModal();
});

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = userForm.querySelector('[data-error]');
  errorBox.hidden = true;
  try {
    await api('/users', {
      method: 'POST',
      body: {
        name: userForm.name.value,
        email: userForm.email.value,
        password: userForm.password.value,
        role: userForm.role.value,
        employeeId: userForm.employeeId.value || null,
      },
    });
    userDialog.close();
    toast('Konto angelegt.');
    await loadUsers();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
});

userDialog.querySelector('[data-cancel]').addEventListener('click', () => userDialog.close());

(async () => {
  const user = await requireSession('/admin/settings');
  if (!user) return;
  await loadBusiness();
  if (isOwner(user)) {
    document.querySelector('[data-owner-only]').hidden = false;
    await loadUsers();
  }
})().catch(handleError);
