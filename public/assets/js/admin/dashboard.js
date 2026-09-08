/* /admin — Anmeldung, Ersteinrichtung und Übersicht in einer Seite.

   Welche der drei Ansichten erscheint, sagt der Server: erst /api/admin/session,
   bei 401 dann /api/admin/setup. Das Frontend rät nie. */
import {
  api, ApiError, requireSession, escapeHtml, fmtTime, fmtDateLong, toast, handleError,
  STATUS_LABEL, STATUS_CLASS,
} from './core.js';

const gate = document.querySelector('[data-gate]');

function showView(name) {
  gate.hidden = false;
  gate.querySelectorAll('[data-view]').forEach((section) => {
    section.hidden = section.dataset.view !== name;
  });
  gate.querySelector(`[data-view="${name}"] input`)?.focus();
}

function bindForm(name, submit) {
  const form = gate.querySelector(`[data-form="${name}"]`);
  const error = form.querySelector('[data-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Einen Moment …';
    try {
      await submit(Object.fromEntries(new FormData(form)));
      // Nach dem Anmelden dorthin, wo die Person eigentlich hinwollte.
      const next = new URL(window.location.href).searchParams.get('next');
      window.location.href = next && next.startsWith('/admin') ? next : '/admin';
    } catch (err) {
      error.textContent = err instanceof ApiError ? err.message : 'Das hat nicht funktioniert.';
      error.hidden = false;
      button.disabled = false;
      button.textContent = label;
    }
  });
}

function card(title, value, hint) {
  return `<div class="card">
    <p class="text-sm text-fg-muted">${escapeHtml(title)}</p>
    <p class="tnum mt-1 font-display text-3xl font-bold text-fg">${escapeHtml(String(value))}</p>
    ${hint ? `<p class="mt-1 text-[13px] text-fg-muted">${escapeHtml(hint)}</p>` : ''}
  </div>`;
}

function bookingRow(booking, { withDate = false } = {}) {
  return `<article class="card card-hover flex flex-wrap items-center justify-between gap-4 py-4">
    <div class="min-w-0">
      <p class="tnum font-semibold text-fg">
        ${withDate ? `${escapeHtml(fmtDateLong(booking.start))}, ` : ''}${escapeHtml(fmtTime(booking.start))}–${escapeHtml(fmtTime(booking.end))}
      </p>
      <p class="truncate text-[15px] text-fg-body">${escapeHtml(booking.customer.name)} · ${escapeHtml(booking.service.name)}</p>
      <p class="text-[13px] text-fg-muted">${escapeHtml(booking.employee.name)} · ${escapeHtml(booking.customer.phone)}</p>
    </div>
    <span class="badge ${STATUS_CLASS[booking.status] ?? ''}">${escapeHtml(STATUS_LABEL[booking.status] ?? booking.status)}</span>
  </article>`;
}

function empty(message) {
  return `<p class="rounded-lg border border-dashed border-line p-6 text-center text-[15px] text-fg-muted">${escapeHtml(message)}</p>`;
}

async function renderDashboard() {
  const data = await api('/overview');

  const hints = [];
  if (data.setupHints.needsEmployee) {
    hints.push(['Es ist noch kein Mitarbeiter angelegt — ohne den zeigt die Buchungsseite nichts an.', '/admin/employees']);
  }
  if (data.setupHints.needsService) {
    hints.push(['Es ist noch keine Leistung angelegt.', '/admin/services']);
  }
  if (!data.google.connected) {
    hints.push(['Google Kalender ist nicht verbunden. Termine landen dann nur in der Datenbank.', '/admin/google']);
  } else if (data.google.lastError) {
    hints.push([`Google meldet ein Problem: ${data.google.lastError}`, '/admin/google']);
  }

  document.querySelector('[data-hints]').innerHTML = hints
    .map(([message, href]) => `<a href="${href}" class="flex items-center justify-between gap-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-[15px] text-fg-body transition-colors hover:border-warn">
      <span>${escapeHtml(message)}</span><span aria-hidden="true" class="text-warn">→</span></a>`)
    .join('');

  document.querySelector('[data-counts]').innerHTML = [
    card('Offene Termine', data.counts.upcoming_bookings, 'ab jetzt'),
    card('Termine heute', data.today.length, ''),
    card('Aktive Mitarbeiter', data.counts.employees, ''),
    card('Aktive Leistungen', data.counts.services, ''),
  ].join('');

  document.querySelector('[data-today]').innerHTML = data.today.length
    ? data.today.map((b) => bookingRow(b)).join('')
    : empty('Heute steht nichts an.');

  document.querySelector('[data-upcoming]').innerHTML = data.upcoming.length
    ? data.upcoming.map((b) => bookingRow(b, { withDate: true })).join('')
    : empty('Keine kommenden Termine.');
}

async function start() {
  try {
    await api('/session');
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) {
      handleError(err);
      return;
    }
    // Keine Session: der Server sagt, ob angemeldet oder eingerichtet wird.
    const { needsSetup } = await api('/setup').catch(() => ({ needsSetup: false }));
    bindForm('login', (values) => api('/session', { method: 'POST', body: values }));
    bindForm('setup', (values) => api('/setup', { method: 'POST', body: values }));
    showView(needsSetup ? 'setup' : 'login');
    return;
  }

  const user = await requireSession('/admin');
  if (!user) return;
  try {
    await renderDashboard();
  } catch (error) {
    handleError(error);
  }
}

start().catch((err) => {
  handleError(err);
  toast('Die Verwaltung konnte nicht geladen werden.', 'error');
});
