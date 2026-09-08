/* Gleichzeitigkeitstest: zwei Anfragen für denselben Slot im selben Moment.
   Genau eine darf gewinnen (info.md §16). */
const BASE = process.env.BASE || 'http://localhost:3210';
const get = (u) => fetch(BASE + u).then((r) => r.json());
const post = (b) =>
  fetch(`${BASE}/api/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const services = (await get('/api/services')).services;
const svc = services.find((s) => s.slug === 'herren-haarschnitt');
const emp = (await get(`/api/employees?serviceId=${svc.id}`)).employees[0];

const d = new Date(); d.setDate(d.getDate() + 5);
while (d.getDay() === 0) d.setDate(d.getDate() + 1);
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const { slots } = await get(`/api/availability?date=${date}&serviceId=${svc.id}&employeeId=${emp.id}`);
const free = slots.filter((s) => s.available);

// Der Endpunkt begrenzt auf 8 Anfragen/Minute pro IP. Jede Runde verbraucht zwei,
// also passen drei Runden ins Fenster — mehr würde nur den Limiter testen.
let races = 0, ok = 0, limited = 0;
for (let i = 0; i < 3; i += 1) {
  const slot = free[i * 4];
  if (!slot) break;
  races += 1;
  // Beide Anfragen starten gleichzeitig, ohne await dazwischen.
  const [a, b] = await Promise.all([
    post({ serviceId: svc.id, employeeId: emp.id, start: slot.start, customerName: `Race A${i}`, customerPhone: '0664 1111111' }),
    post({ serviceId: svc.id, employeeId: emp.id, start: slot.start, customerName: `Race B${i}`, customerPhone: '0664 2222222' }),
  ]);
  const created = [a, b].filter((r) => r.status === 201).length;
  const rejected = [a, b].filter((r) => r.status === 409).length;
  if ([a, b].some((r) => r.status === 429)) {
    limited += 1;
    console.log(`  ⏭  Runde ${i + 1}: durch Rate-Limit übersprungen`);
    races -= 1;
    continue;
  }
  const good = created === 1 && rejected === 1;
  if (good) ok += 1;
  console.log(`  ${good ? '✅' : '❌'} Runde ${i + 1}: ${created}× 201, ${rejected}× 409  (${a.status}/${b.status})`);
}

console.log(`\n  ${ok}/${races} Runden korrekt aufgelöst` + (limited ? `, ${limited} durch Rate-Limit übersprungen` : '') + '\n');
process.exit(races > 0 && ok === races ? 0 : 1);
