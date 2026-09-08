/* /admin/google — Google-Konto verbinden und Kalender zuweisen.

   Der eigentliche OAuth-Flow läuft über /api/google/start; diese Seite hat weder
   Tokens noch das Client-Secret und fragt niemals nach einem Google-Passwort
   (info.md §11). */
import { api, requireSession, escapeHtml, fmtDate, toast, handleError } from './core.js';

const statusBox = document.querySelector('[data-status]');
const assignBox = document.querySelector('[data-assign]');
const helpBox = document.querySelector('[data-setup-help]');

const CALLBACK_ERRORS = {
  access_denied: 'Die Zustimmung wurde abgebrochen. Es wurde nichts gespeichert.',
  state_mismatch: 'Die Rückmeldung von Google passte nicht zur laufenden Sitzung. Bitte noch einmal versuchen.',
  no_refresh_token: 'Google hat kein dauerhaftes Token geschickt. Entzieh der App unter myaccount.google.com/permissions den Zugriff und verbinde sie danach erneut.',
  not_configured: 'In den Umgebungsvariablen fehlen GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET oder GOOGLE_REDIRECT_URI.',
};

function statusCard(data) {
  if (!data.configured) {
    return `<div class="card border-warn/40 bg-warn/10">
      <p class="font-semibold text-fg">Google OAuth ist nicht konfiguriert</p>
      <p class="mt-2 text-[15px] text-fg-body">
        Ohne <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> und
        <code>GOOGLE_REDIRECT_URI</code> lässt sich kein Konto verbinden. Die Anleitung
        unten sagt, was in der Google Cloud Console anzulegen ist.
      </p>
    </div>`;
  }

  if (!data.connected) {
    return `<div class="card">
      <p class="font-semibold text-fg">Kein Google-Konto verbunden</p>
      <p class="mt-2 text-[15px] text-fg-body">
        Termine werden derzeit nur in der Datenbank geführt. Nach dem Verbinden prüft die
        Verfügbarkeit zusätzlich den Google Kalender und trägt jeden Termin dort ein.
      </p>
      ${data.lastError ? `<p class="mt-3 text-[13px] text-danger">Zuletzt gemeldet: ${escapeHtml(data.lastError)}</p>` : ''}
      <a class="btn-primary mt-5" href="/api/google/start">Google-Konto verbinden</a>
    </div>`;
  }

  return `<div class="card border-ok/40">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p class="font-semibold text-fg">Verbunden${data.account?.email ? ` als ${escapeHtml(data.account.email)}` : ''}</p>
        ${data.account?.connectedAt ? `<p class="text-[13px] text-fg-muted">seit ${escapeHtml(fmtDate(data.account.connectedAt))}</p>` : ''}
      </div>
      <div class="flex gap-2">
        <a class="btn-ghost min-h-[40px] px-4 py-2 text-[13px]" href="/api/google/start">Neu verbinden</a>
        <button type="button" class="btn-ghost min-h-[40px] px-4 py-2 text-[13px] hover:border-danger hover:text-danger" data-disconnect>Trennen</button>
      </div>
    </div>
    ${data.lastError ? `<p class="mt-3 text-[13px] text-danger">Letzter Fehler: ${escapeHtml(data.lastError)}</p>` : ''}
    ${data.calendarError ? `<p class="mt-3 text-[13px] text-danger">${escapeHtml(data.calendarError)}</p>` : ''}
    ${Array.isArray(data.calendars)
      ? `<p class="mt-3 text-[13px] text-fg-muted">${data.calendars.length} Kalender im Konto gefunden.</p>`
      : ''}
  </div>`;
}

function assignRow(employee, calendars) {
  const options = ['<option value="">— kein Kalender —</option>']
    .concat((calendars ?? []).map((c) =>
      `<option value="${escapeHtml(c.id)}" ${c.id === employee.googleCalendarId ? 'selected' : ''}>${escapeHtml(c.summary)}${c.primary ? ' (Standard)' : ''}</option>`));

  if (employee.googleCalendarId && !(calendars ?? []).some((c) => c.id === employee.googleCalendarId)) {
    options.push(`<option value="${escapeHtml(employee.googleCalendarId)}" selected>${escapeHtml(employee.googleCalendarId)}</option>`);
  }

  return `<div class="card flex flex-wrap items-center justify-between gap-4 ${employee.status === 'INACTIVE' ? 'opacity-70' : ''}">
    <div>
      <p class="font-semibold text-fg">${escapeHtml(employee.name)}</p>
      <p class="text-[13px] text-fg-muted">${employee.status === 'INACTIVE' ? 'inaktiv' : 'aktiv'}</p>
    </div>
    <div class="flex items-center gap-2">
      <select class="input min-h-[44px] w-auto py-2" data-employee="${employee.id}" aria-label="Kalender für ${escapeHtml(employee.name)}"
        ${calendars ? '' : 'disabled'}>${options.join('')}</select>
    </div>
  </div>`;
}

function help(redirectUri) {
  const steps = [
    'In der Google Cloud Console ein Projekt wählen und die <strong>Google Calendar API</strong> aktivieren.',
    'Unter <strong>APIs &amp; Services → OAuth consent screen</strong> den Zustimmungsbildschirm ausfüllen. Solange die App im Test-Modus steht, muss das Konto des Betriebs als Testnutzer eingetragen sein.',
    'Unter <strong>Credentials → Create credentials → OAuth client ID</strong> den Typ <em>Web application</em> anlegen.',
    `Als <strong>Authorized redirect URI</strong> exakt diesen Wert eintragen: <code class="break-all">${escapeHtml(redirectUri ?? 'GOOGLE_REDIRECT_URI ist nicht gesetzt')}</code>`,
    'Client-ID und Client-Secret als <code>GOOGLE_CLIENT_ID</code> und <code>GOOGLE_CLIENT_SECRET</code> hinterlegen (lokal in <code>.env</code>, auf Vercel unter Environment Variables) und neu deployen.',
    'Danach hier oben auf „Google-Konto verbinden“ klicken.',
  ];
  return steps.map((stepText, index) =>
    `<p class="flex gap-3"><span class="tnum font-semibold text-accent">${index + 1}.</span><span>${stepText}</span></p>`).join('');
}

async function load() {
  const data = await api('/google');
  statusBox.innerHTML = statusCard(data);
  assignBox.innerHTML = data.employees.length
    ? data.employees.map((employee) => assignRow(employee, data.calendars)).join('')
    : '<p class="rounded-lg border border-dashed border-line p-6 text-center text-[15px] text-fg-muted">Noch kein Mitarbeiter angelegt.</p>';
  helpBox.innerHTML = help(data.redirectUri);
}

statusBox.addEventListener('click', async (event) => {
  if (!event.target.closest('[data-disconnect]')) return;
  if (!window.confirm('Verbindung zu Google trennen? Neue Termine werden dann nicht mehr in den Kalender eingetragen.')) return;
  try {
    await api('/google/disconnect', { method: 'POST' });
    toast('Verbindung getrennt.');
    await load();
  } catch (err) {
    handleError(err);
  }
});

assignBox.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-employee]');
  if (!select) return;
  try {
    await api('/google/calendar', {
      method: 'POST',
      body: { employeeId: select.dataset.employee, googleCalendarId: select.value || null },
    });
    toast('Kalender zugewiesen.');
  } catch (err) {
    handleError(err);
    await load();
  }
});

(async () => {
  const user = await requireSession('/admin/google');
  if (!user) return;

  // Rückmeldung aus dem OAuth-Callback sichtbar machen.
  const params = new URL(window.location.href).searchParams;
  if (params.get('connected')) toast('Google-Konto verbunden.');
  const callbackError = params.get('error');
  if (callbackError) {
    toast(CALLBACK_ERRORS[callbackError] ?? `Google meldet: ${callbackError}`, 'error');
  }
  if (params.size) window.history.replaceState({}, '', '/admin/google');

  await load();
})().catch(handleError);
