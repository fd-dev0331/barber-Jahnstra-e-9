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

/* Noch ein Termin, später am selben Tag: an ihm wird in Abschnitt 7 das Löschen
   geprüft. Er entsteht hier, solange der Testmitarbeiter noch aktiv ist. */
const lateSlot = [...(availability.body.slots ?? [])].reverse().find((slot) => slot.available);
const forDeletion = lateSlot ? await call(owner, '/api/admin/bookings', {
  method: 'POST',
  body: {
    serviceId: service.id, employeeId, start: lateSlot.start,
    customerName: 'Loeschtest', customerPhone: '0664 0000003',
  },
}) : { status: 0, body: {} };
const deletableId = forDeletion.body.booking?.id;
check('Zweiter Termin für den Löschtest angelegt', forDeletion.status === 201 && Boolean(deletableId),
  `(${forDeletion.status} ${JSON.stringify(forDeletion.body).slice(0, 90)})`);

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

// Stornieren darf ein Mitarbeiter, endgültig löschen nicht.
const staffDelete = await call(staff, `/api/admin/bookings/${deletableId}`, { method: 'DELETE' });
check('Mitarbeiter darf Termine nicht löschen -> 403', staffDelete.status === 403, `(${staffDelete.status})`);

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

// Stornierte Termine lassen sich endgültig löschen, andere nicht.
const notCancelled = await call(owner, `/api/admin/bookings/${deletableId}`, { method: 'DELETE' });
check('Offener Termin lässt sich nicht löschen -> 409 not_cancelled',
  notCancelled.status === 409 && notCancelled.body.error === 'not_cancelled',
  `(${notCancelled.status} ${notCancelled.body.error})`);

await call(owner, `/api/admin/bookings/${deletableId}`, { method: 'PATCH', body: { status: 'CANCELLED' } });
const removed = await call(owner, `/api/admin/bookings/${deletableId}`, { method: 'DELETE' });
check('Stornierter Termin wird gelöscht', removed.status === 200, `(${removed.status} ${removed.body.error ?? ''})`);
const afterDelete = await call(owner, '/api/admin/bookings?view=all');
check('Gelöschter Termin ist aus der Liste verschwunden',
  !(afterDelete.body.bookings ?? []).some((b) => b.id === deletableId));
check('Zweites Löschen -> 404', (await call(owner, `/api/admin/bookings/${deletableId}`, { method: 'DELETE' })).status === 404);

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

// Angebot: die Website sortiert solche Leistungen nach vorn (zwei Blöcke,
// keine Gliederung nach Art der Leistung).
check('Neue Leistung ist kein Angebot', (await listed())?.isOffer === false);
const asOffer = await call(owner, `/api/admin/services/${syncId}`, { method: 'PATCH', body: { isOffer: true } });
check('Als Angebot markieren', asOffer.status === 200 && asOffer.body.service?.isOffer === true);
const withOffer = (await anon('/api/business')).body.services;
check('Angebot steht auf der Website vor den übrigen Leistungen',
  withOffer.findIndex((s) => s.id === syncId) < withOffer.findIndex((s) => !s.isOffer),
  withOffer.map((s) => `${s.isOffer ? '*' : '-'}${s.name}`).join(', '));
check('Häkchen lässt sich wieder entfernen',
  (await call(owner, `/api/admin/services/${syncId}`, { method: 'PATCH', body: { isOffer: false } }))
    .body.service?.isOffer === false);

await call(owner, `/api/admin/services/${syncId}`, { method: 'PATCH', body: { status: 'INACTIVE' } });
check('Deaktivierte Leistung verschwindet aus der Preisliste', !(await listed()));
check('Leistung ohne Termine lässt sich löschen',
  (await call(owner, `/api/admin/services/${syncId}`, { method: 'DELETE' })).status === 200);

console.log('\n▸ 9. Bilder, Galerie, Team-Profil');
// 1×1-PNG — ein echtes Bild, damit die Prüfung der Dateisignatur greift.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngUpload = (session) => call(session, '/api/admin/media', {
  method: 'POST', body: { data: `data:image/png;base64,${PNG}`, width: 1, height: 1 },
});

check('Bild-Upload ohne Anmeldung: 401', (await call(null, '/api/admin/media', { method: 'POST', body: { data: PNG } })).status === 401);
check('Kein Upload ohne echten Bildinhalt',
  (await call(owner, '/api/admin/media', { method: 'POST', body: { data: Buffer.from('<svg onload=alert(1)>').toString('base64') } })).status === 400);

const galleryMedia = (await pngUpload(owner)).body.media?.id;
const served = await fetch(`${BASE}/api/media?id=${galleryMedia}`);
check('Hochgeladenes Bild wird ausgeliefert', served.status === 200 && served.headers.get('content-type') === 'image/png');

const galleryItem = await call(owner, '/api/admin/gallery', { method: 'POST', body: { mediaId: galleryMedia, alt: 'Testbild' } });
check('Galeriebild wird angelegt', galleryItem.status === 201);
const inPublicGallery = async () => (await anon('/api/gallery?limit=60')).body.items
  .some((i) => i.src === `/api/media?id=${galleryMedia}`);
check('Galeriebild erscheint auf der Website', await inPublicGallery());
await call(owner, `/api/admin/gallery/${galleryItem.body.item.id}`, { method: 'PATCH', body: { status: 'INACTIVE' } });
check('Ausgeblendetes Galeriebild verschwindet von der Website', !(await inPublicGallery()));

const profilePhoto = (await pngUpload(owner)).body.media?.id;
await call(owner, `/api/admin/employees/${employeeId}`, {
  method: 'PATCH',
  body: {
    status: 'ACTIVE', showOnWebsite: true, headline: 'Test-Überschrift', bio: 'Absatz eins.\n\nAbsatz zwei.',
    languages: 'DE, EN', experienceYears: 7, photoMediaId: profilePhoto,
  },
});
const member = (await anon('/api/business')).body.team?.find((m) => m.id === employeeId);
check('Mitarbeiterprofil erscheint im Team-Slider',
  member?.headline === 'Test-Überschrift' && member.bio === 'Absatz eins.\n\nAbsatz zwei.'
  && member.languages.join() === 'DE,EN' && member.experienceYears === 7
  && member.photoUrl === `/api/media?id=${profilePhoto}` && member.workdays.length > 0);

await call(owner, `/api/admin/employees/${employeeId}`, { method: 'PATCH', body: { showOnWebsite: false } });
check('Profil „nicht auf der Website" verschwindet aus dem Team',
  !(await anon('/api/business')).body.team.some((m) => m.id === employeeId));

await call(owner, `/api/admin/employees/${employeeId}`, { method: 'PATCH', body: { photoMediaId: null, status: 'INACTIVE' } });
check('Entferntes Profilfoto wird gelöscht', (await fetch(`${BASE}/api/media?id=${profilePhoto}`)).status === 404);

const deletedItem = await call(owner, `/api/admin/gallery/${galleryItem.body.item.id}`, { method: 'DELETE' });
check('Gelöschtes Galeriebild ist samt Datei weg',
  deletedItem.status === 200 && (await fetch(`${BASE}/api/media?id=${galleryMedia}`)).status === 404);

console.log('\n▸ 10. Feiertage und Schließtage');
const { publicHolidaysBetween } = await import('../lib/holidays.js');
const closureList = await call(owner, '/api/admin/closures');
check('Alle 13 Feiertage der nächsten 12 Monate werden geliefert',
  closureList.status === 200 && closureList.body.holidays.length === 13);

const bookable = (await anon('/api/employees')).body.employees[0];
const closureDay = nextWorkday(6);
const addedClosure = await call(owner, '/api/admin/closures', { method: 'POST', body: { date: closureDay, label: 'Testschließtag' } });
check('Eigener Schließtag wird angelegt', addedClosure.status === 201);
check('Doppelter Schließtag wird abgelehnt',
  (await call(owner, '/api/admin/closures', { method: 'POST', body: { date: closureDay } })).status === 409);

const closedDay = await anon(`/api/availability?date=${closureDay}&serviceId=${service.id}&employeeId=${bookable.id}`);
check('Verfügbarkeit meldet den Schließtag mit Namen und ohne Zeiten',
  closedDay.body.closed === true && closedDay.body.closure?.name === 'Testschließtag' && closedDay.body.slots.length === 0);

const websiteOnClosure = await anon('/api/bookings', {
  method: 'POST',
  body: { serviceId: service.id, employeeId: bookable.id, start: `${closureDay}T09:00:00Z`, customerName: 'Feiertag', customerPhone: '0664 0000009' },
});
check('Website-Buchung am Schließtag: 409 mit Grund',
  websiteOnClosure.status === 409 && websiteOnClosure.body.error === 'closed_day' && websiteOnClosure.body.message.includes('Testschließtag'));
check('Manueller Termin am Schließtag: 409',
  (await call(owner, '/api/admin/bookings', {
    method: 'POST',
    body: { serviceId: service.id, employeeId: bookable.id, start: `${closureDay}T09:00:00Z`, customerName: 'Feiertag', customerPhone: '0664 0000010' },
  })).body.error === 'closed_day');

await call(owner, `/api/admin/closures/${addedClosure.body.closure.id}`, { method: 'DELETE' });
check('Nach dem Entfernen ist der Tag wieder buchbar',
  (await anon(`/api/availability?date=${closureDay}&serviceId=${service.id}&employeeId=${bookable.id}`)).body.closure === null);

// Nächster Feiertag innerhalb der Vorausbuchungsfrist, der nicht auf einen Sonntag fällt.
const todayVienna = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date());
const inRange = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date(Date.now() + 80 * 86_400_000));
const holiday = publicHolidaysBetween(todayVienna, inRange)
  .find((h) => h.date > todayVienna && new Date(`${h.date}T12:00:00Z`).getUTCDay() !== 0);
if (holiday) {
  const onHoliday = await anon(`/api/availability?date=${holiday.date}&serviceId=${service.id}&employeeId=${bookable.id}`);
  check(`Feiertag ${holiday.name} (${holiday.date}) ist geschlossen`,
    onHoliday.body.closed === true && onHoliday.body.closure?.name === holiday.name);
  await call(owner, '/api/admin/closures/holiday', { method: 'POST', body: { key: holiday.key, closed: false } });
  check('Als geöffnet markierter Feiertag ist buchbar',
    (await anon(`/api/availability?date=${holiday.date}&serviceId=${service.id}&employeeId=${bookable.id}`)).body.closure === null);
  await call(owner, '/api/admin/closures/holiday', { method: 'POST', body: { key: holiday.key, closed: true } });
} else {
  console.log('  ⏭  kein Feiertag in den nächsten 80 Tagen (außer sonntags) — Feiertagsprüfung übersprungen');
}

console.log('\n▸ 11. Leistungen je Mitarbeiter, Arbeitszeiten, Abwesenheiten');
{
  const activeServices = (await call(owner, '/api/admin/services')).body.services.filter((s) => s.status === 'ACTIVE');
  const chosen = activeServices.slice(0, 2).map((s) => s.id);
  const created = await call(owner, '/api/admin/employees', {
    method: 'POST',
    body: {
      name: `Abwesenheitstest ${Date.now()}`,
      serviceIds: chosen,
      workingHours: [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 1, start: '12:00', end: '12:30', isBreak: true },
      ],
    },
  });
  const tempId = created.body.employee?.id;
  check('Mitarbeiter mit Leistungen und Arbeitszeiten angelegt', created.status === 201 && Boolean(tempId),
    `(${created.status} ${created.body.error ?? ''})`);

  const find = async () => (await call(owner, '/api/admin/employees')).body.employees.find((e) => e.id === tempId);
  const listed = await find();
  check('Leistungen je Mitarbeiter gespeichert (employee_service)',
    JSON.stringify([...(listed?.serviceIds ?? [])].sort()) === JSON.stringify([...chosen].sort()),
    JSON.stringify(listed?.serviceIds));
  check('Arbeitszeit samt Pause gespeichert (working_hours)', listed?.workingHours?.length === 2,
    JSON.stringify(listed?.workingHours));

  const changed = await call(owner, `/api/admin/employees/${tempId}`, { method: 'PATCH', body: { serviceIds: [chosen[0]] } });
  check('Leistungen je Mitarbeiter geändert', changed.status === 200 && (await find())?.serviceIds?.length === 1,
    `(${changed.status})`);

  const absence = await call(owner, `/api/admin/employees/${tempId}/absences`, {
    method: 'POST',
    body: { start: '2099-01-05T08:00:00Z', end: '2099-01-09T18:00:00Z', kind: 'VACATION', note: 'Test' },
  });
  const absenceId = absence.body.absence?.id;
  check('Abwesenheit eingetragen (absence)', absence.status === 201 && Boolean(absenceId),
    `(${absence.status} ${absence.body.error ?? ''})`);
  check('Abwesenheit erscheint beim Mitarbeiter', (await find())?.absences?.some((a) => a.id === absenceId));
  check('Mitarbeiter darf keine Abwesenheiten eintragen -> 401/403',
    [401, 403].includes((await call(staff, `/api/admin/employees/${tempId}/absences`, {
      method: 'POST', body: { start: '2099-02-01T08:00:00Z', end: '2099-02-02T08:00:00Z' },
    })).status));
  check('Ohne Anmeldung keine Abwesenheiten -> 401',
    (await anon(`/api/admin/employees/${tempId}/absences`, { method: 'POST', body: {} })).status === 401);

  const removedAbsence = await call(owner, `/api/admin/employees/${tempId}/absences/${absenceId}`, { method: 'DELETE' });
  check('Abwesenheit gelöscht', removedAbsence.status === 200 && !(await find())?.absences?.some((a) => a.id === absenceId));
  check('Testmitarbeiter ohne Termine wieder gelöscht',
    (await call(owner, `/api/admin/employees/${tempId}`, { method: 'DELETE' })).status === 200);
}

console.log('\n' + '─'.repeat(48));
console.log(`  ${pass} bestanden, ${fail} fehlgeschlagen`);
console.log('  Hinweis: Testmitarbeiter „Testperson", das Testkonto und der');
console.log('  stornierte Termin bleiben in der Datenbank — historische Termine');
console.log('  werden bewusst nie automatisch gelöscht.');
process.exitCode = fail ? 1 : 0;
