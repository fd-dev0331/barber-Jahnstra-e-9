/* End-to-End-Test des Buchungsablaufs gegen den laufenden Dev-Server.
   Prüft die Punkte aus info.md §30: Verfügbarkeit, Anlegen, Doppelbuchung,
   Zeiten außerhalb der Arbeitszeit, Sonntag, unterschiedliche Dauern. */
const BASE = process.env.BASE || 'http://localhost:3210';
let pass = 0, fail = 0;

const get = (url) => fetch(BASE + url).then(async (r) => ({ status: r.status, body: await r.json() }));
const post = (url, body) =>
  fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

/** Nächster Wochentag (Mo–Sa) als YYYY-MM-DD in Wien. */
function nextWorkday(offset = 2) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function nextSunday() {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 0);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

console.log('\n▸ 1. Leistungen und Mitarbeiter');
const services = (await get('/api/services')).body.services;
check('Leistungen geladen', services.length === 9, `(${services.length})`);
const cut = services.find((s) => s.slug === 'herren-haarschnitt');
const wash = services.find((s) => s.slug === 'herren-haare-waschen');
check('Herren – Haarschnitt: 30 Min., 25,00 €', cut.durationMinutes === 30 && cut.priceCents === 2500);
check('Herren – Haare waschen: 10 Min., 5,00 €', wash.durationMinutes === 10 && wash.priceCents === 500);

const employees = (await get(`/api/employees?serviceId=${cut.id}`)).body.employees;
check('Genau ein aktiver Mitarbeiter (Abo)', employees.length === 1 && employees[0].name === 'Abo');
const abo = employees[0];

console.log('\n▸ 2. Verfügbarkeit');
const day = nextWorkday();
const avail = await get(`/api/availability?date=${day}&serviceId=${cut.id}&employeeId=${abo.id}`);
const slots = avail.body.slots;
check(`Slots für ${day} geladen`, slots.length > 0, `(${slots.length})`);
check('Zeitzone Europe/Vienna gemeldet', avail.body.timezone === 'Europe/Vienna');
const firstLocal = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(slots[0].start));
const lastEnd = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(slots.at(-1).end));
check(`Erster Slot ab 09:00 (ist ${firstLocal})`, firstLocal === '09:00');
check(`Letztes Ende bis 19:00 (ist ${lastEnd})`, lastEnd <= '19:00');
check('15-Minuten-Raster', new Date(slots[1].start) - new Date(slots[0].start) === 15 * 60_000);

console.log('\n▸ 3. Sonntag ist geschlossen');
const sunday = await get(`/api/availability?date=${nextSunday()}&serviceId=${cut.id}&employeeId=${abo.id}`);
check('Sonntag: closed=true, keine Slots', sunday.body.closed === true && sunday.body.slots.length === 0);

console.log('\n▸ 4. Buchung anlegen');
const target = slots.find((s) => s.available);
const created = await post('/api/bookings', {
  serviceId: cut.id, employeeId: abo.id, start: target.start,
  customerName: 'Max Mustermann', customerPhone: '0664 1234567', customerEmail: 'max@example.at',
});
check('201 Created', created.status === 201, JSON.stringify(created.body).slice(0, 120));
check('Referenz vergeben', /^[A-Z0-9]{8}$/.test(created.body.booking?.reference || ''));
check('Status CONFIRMED', created.body.booking?.status === 'CONFIRMED');

console.log('\n▸ 5. Doppelbuchungsschutz (info.md §16)');
const dup = await post('/api/bookings', {
  serviceId: cut.id, employeeId: abo.id, start: target.start,
  customerName: 'Zweiter Kunde', customerPhone: '0664 7654321',
});
check('Zweite Buchung wird mit 409 abgelehnt', dup.status === 409, `(${dup.status})`);
check('Fehlermeldung ist verständlich, ohne interne Details',
  /nicht mehr frei/.test(dup.body.message || '') && !/Error|stack|pg|SQL/i.test(dup.body.message || ''));

console.log('\n▸ 6. Überlappender Termin (versetzt, nicht identisch)');
const overlapStart = new Date(new Date(target.start).getTime() + 15 * 60_000).toISOString();
const overlap = await post('/api/bookings', {
  serviceId: cut.id, employeeId: abo.id, start: overlapStart,
  customerName: 'Dritter Kunde', customerPhone: '0664 1112223',
});
check('Überlappung wird abgelehnt', overlap.status === 409, `(${overlap.status})`);

console.log('\n▸ 7. Slot ist danach als belegt markiert');
const after = await get(`/api/availability?date=${day}&serviceId=${cut.id}&employeeId=${abo.id}`);
const same = after.body.slots.find((s) => s.start === target.start);
check('Gebuchter Slot: available=false', same && same.available === false);
const blockedCount = after.body.slots.filter((s) => !s.available).length;
check(`30-Min-Buchung blockiert mehrere 15-Min-Raster (${blockedCount})`, blockedCount >= 2);

console.log('\n▸ 8. Außerhalb der Arbeitszeit');
const night = await post('/api/bookings', {
  serviceId: cut.id, employeeId: abo.id, start: `${day}T22:00:00.000Z`,
  customerName: 'Nacht Kunde', customerPhone: '0664 9998887',
});
check('22:00 UTC wird abgelehnt', night.status >= 400, `(${night.status})`);

console.log('\n▸ 9. Eingabevalidierung serverseitig');
const noName = await post('/api/bookings', { serviceId: cut.id, employeeId: abo.id, start: target.start, customerName: '', customerPhone: '0664 1' });
check('Leerer Name -> 400', noName.status === 400);
const badDate = await get(`/api/availability?date=nonsense&serviceId=${cut.id}&employeeId=${abo.id}`);
check('Ungültiges Datum -> 400', badDate.status === 400);
const pastDate = await get(`/api/availability?date=2020-01-01&serviceId=${cut.id}&employeeId=${abo.id}`);
check('Vergangenes Datum -> 400', pastDate.status === 400);

console.log(`\n${'─'.repeat(48)}\n  ${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
