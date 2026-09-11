/* End-to-End-Test der Verwaltung gegen den laufenden Dev-Server.
   Deckt den Ablauf aus promt.md §18 ab: Ersteinrichtung, Anmeldung, Rechte,
   Mitarbeiter, Leistungen, manuelle Buchung, Doppelbuchungsschutz, Kündigung.

   Aufruf:  npm run dev   (in einem zweiten Terminal)
            node scripts/test-admin.js

   Der Test legt einen Mitarbeiter, ein Mitarbeiterkonto und Termine an und
   räumt am Ende alles wieder weg. Das Inhaberkonto bleibt bestehen: es gibt je
   Betrieb nur eines, und es zwischendurch zu löschen wäre kein realistischer
   Zustand. */
const BASE = process.env.BASE || 'http://localhost:3210';
const OWNER_EMAIL = process.env.ADMIN_TEST_EMAIL || 'abo@example.com';
const OWNER_PASSWORD = process.env.ADMIN_TEST_PASSWORD || 'barbier-2026!';

let pass = 0, fail = 0;

function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

/** Minimaler Cookie-Jar: der Test muss sich wie ein Browser verhalten. */
function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    csrf: () => store.get('bb_csrf') ?? '',
    absorb(response) {
      for (const raw of response.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (value) store.set(name, value); else store.delete(name);
      }
    },
  };
}

async function call(cookies, path, { method = 'GET', body, csrf = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookies) headers.Cookie = cookies.header();
  if (cookies && csrf && method !== 'GET') headers['X-CSRF-Token'] = cookies.csrf();

  const response = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookies?.absorb(response);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

const anon = (path, options) => call(null, path, options);

/** Nächster Wochentag (Mo–Sa) als YYYY-MM-DD in Wien. */
function nextWorkday(offset = 3) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

const owner = jar();
const staff = jar();

console.log('\n▸ 1. Ersteinrichtung');
const setupState = await anon('/api/admin/setup');
check('Setup-Status ist abrufbar', setupState.status === 200 && 'needsSetup' in setupState.body);

if (setupState.body.needsSetup) {
  const created = await call(owner, '/api/admin/setup', {
    method: 'POST',
    body: {
      businessName: 'Bregenz Barbershop',
      ownerName: 'Inhaber',
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    },
  });
  check('Erster Inhaber wird angelegt', created.status === 201 && created.body.user.role === 'OWNER');
} else {
  const login = await call(owner, '/api/admin/session', {
    method: 'POST', body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  check('Anmeldung als Inhaber', login.status === 200 && login.body.user.role === 'OWNER',
    '(ADMIN_TEST_EMAIL/ADMIN_TEST_PASSWORD setzen, falls abweichend)');
}

const second = await anon('/api/admin/setup', {
  method: 'POST',
  body: { businessName: 'Fremd', ownerName: 'Zweiter', email: 'zweiter@example.com', password: 'passwort-1234' },
});
check('Zweite Ersteinrichtung wird abgelehnt', second.status === 409);

console.log('\n▸ 2. Zugriffsschutz');
check('Ohne Session: 401', (await anon('/api/admin/overview')).status === 401);
check('Falsches Passwort: 401',
  (await anon('/api/admin/session', { method: 'POST', body: { email: OWNER_EMAIL, password: 'falsch-falsch' } })).status === 401);
check('Schreiben ohne CSRF-Token: 403',
  (await call(owner, '/api/admin/employees', { method: 'POST', body: { name: 'Ohne Token' }, csrf: false })).status === 403);

const me = await call(owner, '/api/admin/session');
check('Eigene Sitzung liefert Rolle und Zeitzone',
  me.status === 200 && me.body.user.role === 'OWNER' && Boolean(me.body.business.timezone));

console.log('\n▸ 3. Mitarbeiter');
const createdEmployee = await call(owner, '/api/admin/employees', {
  method: 'POST',
  body: {
    name: 'Testperson', role: 'Barbier', sortOrder: 900,
    workingHours: [
      { weekday: 1, start: '09:00', end: '18:00' }, { weekday: 2, start: '09:00', end: '18:00' },
      { weekday: 3, start: '09:00', end: '18:00' }, { weekday: 4, start: '09:00', end: '18:00' },
      { weekday: 5, start: '09:00', end: '18:00' }, { weekday: 6, start: '09:00', end: '18:00' },
    ],
  },
});
check('Mitarbeiter wird angelegt', createdEmployee.status === 201);
const employeeId = createdEmployee.body.employee?.id;

check('Pause außerhalb der Arbeitszeit wird abgelehnt',
  (await call(owner, `/api/admin/employees/${employeeId}`, {
    method: 'PATCH',
    body: { workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '14:00', end: '14:30', isBreak: true }] },
  })).status === 400);

check('Überlappende Arbeitszeiten werden abgelehnt',
  (await call(owner, `/api/admin/employees/${employeeId}`, {
    method: 'PATCH',
    body: { workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '15:00' }] },
  })).status === 400);

const publicBefore = (await anon('/api/employees')).body.employees;
check('Neuer Mitarbeiter erscheint öffentlich', publicBefore.some((e) => e.id === employeeId));

console.log('\n▸ 4. Manueller Termin');
const services = (await call(owner, '/api/admin/services')).body.services.filter((s) => s.status === 'ACTIVE');
const service = services.find((s) => s.durationMinutes <= 30) ?? services[0];
const day = nextWorkday();
const availability = await anon(`/api/availability?date=${day}&serviceId=${service.id}&employeeId=${employeeId}`);
const freeSlot = availability.body.slots?.find((s) => s.available);
check('Freie Zeiten für den neuen Mitarbeiter', Boolean(freeSlot), `(${day})`);

const manual = await call(owner, '/api/admin/bookings', {
  method: 'POST',
  body: {
    serviceId: service.id, employeeId, start: freeSlot.start,
    customerName: 'Testkunde Verwaltung', customerPhone: '0664 0000000',
  },
});
check('Manueller Termin wird angelegt', manual.status === 201 && manual.body.booking.source === 'MANUAL');
const bookingId = manual.body.booking?.id;

const duplicate = await call(owner, '/api/admin/bookings', {
  method: 'POST',
  body: {
    serviceId: service.id, employeeId, start: freeSlot.start,
    customerName: 'Doppelt', customerPhone: '0664 0000001',
  },
});
check('Zweiter Termin auf dieselbe Zeit: 409', duplicate.status === 409);

const fromWebsite = await anon('/api/bookings', {
  method: 'POST',
  body: {
    serviceId: service.id, employeeId, start: freeSlot.start,
    customerName: 'Website', customerPhone: '0664 0000002',
  },
});
check('Auch die Website bekommt für diese Zeit 409', fromWebsite.status === 409);

console.log('\n▸ 5. Rollen');
const staffUser = await call(owner, '/api/admin/users', {
  method: 'POST',
  body: {
    name: 'Testkonto', email: `test-${Date.now()}@example.com`,
    password: 'mitarbeiter-2026', role: 'EMPLOYEE', employeeId,
  },
});
check('Mitarbeiterkonto wird angelegt', staffUser.status === 201);

const staffLogin = await call(staff, '/api/admin/session', {
  method: 'POST', body: { email: staffUser.body.user.email, password: 'mitarbeiter-2026' },
});
check('Mitarbeiter kann sich anmelden', staffLogin.status === 200 && staffLogin.body.user.role === 'EMPLOYEE');

check('Mitarbeiter darf keine Mitarbeiter anlegen',
  (await call(staff, '/api/admin/employees', { method: 'POST', body: { name: 'Heimlich' } })).status === 403);
check('Mitarbeiter darf die Einstellungen nicht ändern',
  (await call(staff, '/api/admin/settings', { method: 'PATCH', body: { name: 'Übernommen' } })).status === 403);
check('Mitarbeiter sieht keine Konten',
  (await call(staff, '/api/admin/users')).status === 403);

const staffBookings = await call(staff, '/api/admin/bookings');
check('Mitarbeiter sieht ausschließlich eigene Termine',
  staffBookings.status === 200 && staffBookings.body.bookings.every((b) => b.employee.id === employeeId));

// Dashboard: dieselbe Einschränkung wie die Terminliste, keine Google-Kontodaten.
const staffOverview = await call(staff, '/api/admin/overview');
const ownUpcoming = staffBookings.body.bookings
  .filter((b) => ['PENDING', 'CONFIRMED'].includes(b.status) && new Date(b.start) >= new Date()).length;
check('Mitarbeiter-Dashboard zeigt nur eigene Termine',
  staffOverview.status === 200
  && [...staffOverview.body.today, ...staffOverview.body.upcoming].every((b) => b.employee.id === employeeId)
  && staffOverview.body.counts.upcoming_bookings === ownUpcoming,
  `(${staffOverview.body.counts?.upcoming_bookings} statt ${ownUpcoming})`);
check('Mitarbeiter-Dashboard enthält keine Google-Kontodaten',
  staffOverview.body.google && !('email' in staffOverview.body.google) && !('lastError' in staffOverview.body.google));

const staffSession = await call(staff, '/api/admin/session');
check('Sitzung nennt den verknüpften Mitarbeiter', staffSession.body.employee?.id === employeeId);

check('Inhaberkonto lässt sich nicht herabstufen',
  (await call(owner, `/api/admin/users/${(await call(owner, '/api/admin/users')).body.users.find((u) => u.role === 'OWNER').id}`, {
    method: 'PATCH', body: { role: 'EMPLOYEE' },
  })).status === 409);

await call(owner, `/api/admin/users/${staffUser.body.user.id}`, { method: 'PATCH', body: { status: 'INACTIVE' } });
check('Gesperrtes Konto verliert seine Sitzung sofort',
  (await call(staff, '/api/admin/session')).status === 401);

console.log('\n▸ 6. Kündigung');
const deactivated = await call(owner, `/api/admin/employees/${employeeId}`, {
  method: 'PATCH', body: { status: 'INACTIVE' },
});
check('Mitarbeiter wird deaktiviert', deactivated.status === 200);

check('Deaktivierter Mitarbeiter verschwindet aus der öffentlichen Liste',
  !(await anon('/api/employees')).body.employees.some((e) => e.id === employeeId));

const laterSlot = availability.body.slots.filter((s) => s.available).at(-1);
check('Website kann ihn nicht mehr buchen',
  (await anon('/api/bookings', {
    method: 'POST',
    body: { serviceId: service.id, employeeId, start: laterSlot.start, customerName: 'Zu spät', customerPhone: '0664 0000003' },
  })).status === 404);

const history = await call(owner, `/api/admin/bookings?employeeId=${employeeId}`);
check('Historische Termine bleiben erhalten',
  history.body.bookings.some((b) => b.id === bookingId));

check('Mitarbeiter mit Terminen lässt sich nicht löschen',
  (await call(owner, `/api/admin/employees/${employeeId}`, { method: 'DELETE' })).status === 409);

console.log('\n▸ 7. Aufräumen');
const cancelled = await call(owner, `/api/admin/bookings/${bookingId}`, {
  method: 'PATCH', body: { status: 'CANCELLED' },
});
check('Termin wird storniert', cancelled.status === 200);

// Erst ohne Termine ist das endgültige Löschen erlaubt — genau darum geht es.
const stillThere = await call(owner, `/api/admin/employees/${employeeId}`, { method: 'DELETE' });
check('Löschen bleibt gesperrt, solange stornierte Termine vorliegen', stillThere.status === 409);

console.log('\n▸ 8. Website-Synchronisierung');
const site = await anon('/api/business');
check('Öffentliche Stammdaten sind abrufbar',
  site.status === 200 && Boolean(site.body.business?.name) && site.body.openingHours?.length === 7);

const originalPhone = (await call(owner, '/api/admin/settings')).body.business.phone;
await call(owner, '/api/admin/settings', { method: 'PATCH', body: { phone: '0664 1111111' } });
check('Geänderte Telefonnummer erscheint auf der Website',
  (await anon('/api/business')).body.business?.phone === '0664 1111111');
await call(owner, '/api/admin/settings', { method: 'PATCH', body: { phone: originalPhone ?? '' } });

const syncService = await call(owner, '/api/admin/services', {
  method: 'POST', body: { name: `Sync-Test ${Date.now()}`, durationMinutes: 20, priceCents: 1234 },
});
const syncId = syncService.body.service?.id;
const listed = async () => (await anon('/api/business')).body.services.find((s) => s.id === syncId);
check('Neue Leistung erscheint in der Preisliste', (await listed())?.priceCents === 1234);

// So kommt ein Pfad mit ID auf Vercel an: vercel.json schreibt
// /api/admin/services/<id> auf /api/admin/services?__rest=<id> um.
const viaRewrite = await call(owner, `/api/admin/services?__rest=${syncId}`, { method: 'PATCH', body: { priceCents: 1500 } });
check('Umgeschriebener Pfad (__rest wie auf Vercel) erreicht den Handler', viaRewrite.status === 200);
check('Preisänderung erscheint in der Preisliste', (await listed())?.priceCents === 1500);

await call(owner, `/api/admin/services/${syncId}`, { method: 'PATCH', body: { status: 'INACTIVE' } });
check('Deaktivierte Leistung verschwindet aus der Preisliste', !(await listed()));
check('Leistung ohne Termine lässt sich löschen',
  (await call(owner, `/api/admin/services/${syncId}`, { method: 'DELETE' })).status === 200);

console.log('\n' + '─'.repeat(48));
console.log(`  ${pass} bestanden, ${fail} fehlgeschlagen`);
console.log('  Hinweis: Testmitarbeiter „Testperson", das Testkonto und der');
console.log('  stornierte Termin bleiben in der Datenbank — historische Termine');
console.log('  werden bewusst nie automatisch gelöscht.');
process.exitCode = fail ? 1 : 0;
