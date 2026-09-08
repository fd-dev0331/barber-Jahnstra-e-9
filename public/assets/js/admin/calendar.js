/* /admin/calendar — Wochenansicht. Zeigt dieselben Daten wie die Terminliste,
   nur nach Tagen sortiert; gerechnet wird in der Geschäftszeitzone. */
import {
  api, requireSession, escapeHtml, fmtTime, dayKey, handleError,
  STATUS_LABEL, STATUS_CLASS,
} from './core.js';

const week = document.querySelector('[data-week]');
const range = document.querySelector('[data-range]');

/** Montag der Woche, in der `date` liegt — als YYYY-MM-DD in Betriebszeit. */
function mondayOf(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function shift(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const label = (dateKey) => new Intl.DateTimeFormat('de-AT', {
  timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit',
}).format(new Date(`${dateKey}T12:00:00Z`));

let monday = mondayOf(dayKey(new Date()));

async function load() {
  const sunday = shift(monday, 6);
  range.textContent = `${label(monday)} – ${label(sunday)}`;
  week.innerHTML = '<p class="text-fg-muted">Wird geladen …</p>';

  try {
    const { bookings } = await api(`/bookings?from=${monday}&to=${sunday}`);
    const active = bookings.filter((b) => b.status !== 'CANCELLED');
    const today = dayKey(new Date());

    week.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const day = shift(monday, index);
      const entries = active
        .filter((b) => dayKey(b.start) === day)
        .sort((a, b) => new Date(a.start) - new Date(b.start));

      return `<section class="rounded-lg border ${day === today ? 'border-accent' : 'border-line'} bg-surface p-3">
        <h2 class="mb-3 text-sm font-semibold ${day === today ? 'text-accent' : 'text-fg'}">${escapeHtml(label(day))}</h2>
        ${entries.length
          ? entries.map((b) => `<article class="mb-2 rounded-sm border border-line bg-surface-2 p-2">
              <p class="tnum text-[13px] font-semibold text-fg">${escapeHtml(fmtTime(b.start))}–${escapeHtml(fmtTime(b.end))}</p>
              <p class="truncate text-[13px] text-fg-body">${escapeHtml(b.customer.name)}</p>
              <p class="truncate text-[12px] text-fg-muted">${escapeHtml(b.service.name)} · ${escapeHtml(b.employee.name)}</p>
              <span class="badge mt-1 px-2 py-0.5 text-[11px] ${STATUS_CLASS[b.status] ?? ''}">${escapeHtml(STATUS_LABEL[b.status] ?? b.status)}</span>
            </article>`).join('')
          : '<p class="text-[13px] text-fg-muted">frei</p>'}
      </section>`;
    }).join('');
  } catch (err) {
    week.innerHTML = '';
    handleError(err);
  }
}

document.querySelector('[data-prev]').addEventListener('click', () => { monday = shift(monday, -7); load(); });
document.querySelector('[data-next]').addEventListener('click', () => { monday = shift(monday, 7); load(); });
document.querySelector('[data-today]').addEventListener('click', () => { monday = mondayOf(dayKey(new Date())); load(); });

(async () => {
  const user = await requireSession('/admin/calendar');
  if (!user) return;
  // Erst nach requireSession steht die Geschäftszeitzone fest.
  monday = mondayOf(dayKey(new Date()));
  await load();
})().catch(handleError);
