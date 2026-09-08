/* Zeitzonen-Helfer ohne externe Bibliothek.
   Regel aus info.md §23: die Geschäftszeitzone entscheidet, niemals die Serverzeit. */

/** Offset der Zone zu UTC in Millisekunden, für den gegebenen Zeitpunkt. */
function offsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return asUTC - date.getTime();
}

/**
 * Wandelt lokale Wandzeit ("2026-09-14", "10:30") in der Zone in einen echten
 * UTC-Zeitpunkt um. Der zweite Durchlauf fängt Sommerzeit-Wechsel ab, bei denen
 * der erste Offset noch der alte war.
 */
export function zonedToUtc(dateStr, timeStr, timeZone) {
  const naive = new Date(`${dateStr}T${timeStr.length === 5 ? timeStr : timeStr.slice(0, 5)}:00Z`);
  const first = offsetMs(naive, timeZone);
  let utc = new Date(naive.getTime() - first);
  const second = offsetMs(utc, timeZone);
  if (second !== first) utc = new Date(naive.getTime() - second);
  return utc;
}

/** Kalenderdatum (YYYY-MM-DD) eines Zeitpunkts in der Zone. */
export function dateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Wochentag in der Zone: 0 = Sonntag … 6 = Samstag. */
export function weekdayInZone(dateStr, timeZone) {
  const noon = zonedToUtc(dateStr, '12:00', timeZone);
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(noon);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name];
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

/** Überschneiden sich [aStart,aEnd) und [bStart,bEnd)? */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
