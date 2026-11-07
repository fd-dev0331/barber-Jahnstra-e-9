/* Portfolio demo: browser-side mock of the whole HTTP API.

   Loaded as the first classic <script> of every page. It replaces window.fetch
   for same-origin /api/... requests and answers them from an in-memory store
   with the same response shapes, status codes and error codes as the real
   backend (api/*.js, api/admin/[...path].js -> lib/admin/*.js). Everything else
   passes through to the real fetch.

   - State lives in sessionStorage: edits survive navigation inside one tab,
     a fresh tab starts from the seed data.
   - The admin is always signed in as the OWNER (logout -> login form, which
     accepts any credentials).
   - All data is fictional. Seed texts are bilingual ({ de, en }) and resolved
     per request (site_language / admin_language, else browser language).
   - Images point to static files under /demo/media/<id>.jpg; uploads in the
     admin are kept as data: URLs. */
(function () {
  'use strict';
  if (window.__bbDemoMock) return;
  window.__bbDemoMock = true;

  var realFetch = window.fetch.bind(window);
  var STORE_KEY = 'bb_demo_store_v1';
  var TZ = 'Europe/Vienna';
  var MIN = 60000;
  var DAY = 86400000;
  var ACTIVE_STATUSES = ['PENDING', 'CONFIRMED'];
  var STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
  var GENERIC = 'Das hat gerade nicht funktioniert. Bitte versuch es noch einmal oder ruf uns an: 0660 1234567.';

  try { document.cookie = 'bb_csrf=demo-csrf-token; path=/; SameSite=Lax'; } catch (e) { /* ignore */ }

  /* ------------------------------------------------------------ language */

  function browserLang() {
    var l = '';
    try { l = (navigator.languages && navigator.languages[0]) || navigator.language || ''; } catch (e) { /* ignore */ }
    return String(l).toLowerCase().indexOf('de') === 0 ? 'de' : 'en';
  }
  function contentLang() {
    var isAdmin = String(location.pathname || '').indexOf('/admin') === 0;
    var v = null;
    try { v = localStorage.getItem(isAdmin ? 'admin_language' : 'site_language'); } catch (e) { v = null; }
    if (isAdmin) {
      if (v === 'de') return 'de';
      if (v) return 'en';
      return browserLang();
    }
    if (v === 'de' || v === 'en') return v;
    return browserLang();
  }
  /** Resolve a { de, en } seed value; plain strings (admin edits) pass through. */
  function L(v) {
    if (v && typeof v === 'object' && ('de' in v || 'en' in v)) {
      var lang = contentLang();
      return v[lang] != null ? v[lang] : (v.de != null ? v.de : v.en);
    }
    return v == null ? null : v;
  }

  /* ---------------------------------------------------------------- time
     Ported from lib/time.js. */

  function offsetMs(date, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    var asUTC = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUTC - date.getTime();
  }
  function zonedToUtc(dateStr, timeStr, timeZone) {
    var naive = new Date(dateStr + 'T' + String(timeStr).slice(0, 5) + ':00Z');
    var first = offsetMs(naive, timeZone);
    var utc = new Date(naive.getTime() - first);
    var second = offsetMs(utc, timeZone);
    if (second !== first) utc = new Date(naive.getTime() - second);
    return utc;
  }
  function dateInZone(date, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function weekdayInZone(dateStr, timeZone) {
    var noon = zonedToUtc(dateStr, '12:00', timeZone);
    var name = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, weekday: 'short' }).format(noon);
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name];
  }
  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function isValidDateString(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
  }
  function overlaps(aS, aE, bS, bE) { return aS < bE && bS < aE; }
  var iso = function (d) { return new Date(d).toISOString(); };
  var ms = function (v) { return new Date(v).getTime(); };

  /* ------------------------------------------------------------ holidays
     Ported from lib/holidays.js. */

  var pad = function (n) { return String(n).padStart(2, '0'); };
  function easterSunday(year) {
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return year + '-' + pad(month) + '-' + pad(day);
  }
  var fixed = function (mo, d) { return function (y) { return y + '-' + pad(mo) + '-' + pad(d); }; };
  var afterEaster = function (n) { return function (y) { return addDays(easterSunday(y), n); }; };
  var HOLIDAYS = [
    { key: 'neujahr', name: 'Neujahr', date: fixed(1, 1) },
    { key: 'heilige-drei-koenige', name: 'Heilige Drei Könige', date: fixed(1, 6) },
    { key: 'ostermontag', name: 'Ostermontag', date: afterEaster(1) },
    { key: 'staatsfeiertag', name: 'Staatsfeiertag', date: fixed(5, 1) },
    { key: 'christi-himmelfahrt', name: 'Christi Himmelfahrt', date: afterEaster(39) },
    { key: 'pfingstmontag', name: 'Pfingstmontag', date: afterEaster(50) },
    { key: 'fronleichnam', name: 'Fronleichnam', date: afterEaster(60) },
    { key: 'mariae-himmelfahrt', name: 'Mariä Himmelfahrt', date: fixed(8, 15) },
    { key: 'nationalfeiertag', name: 'Nationalfeiertag', date: fixed(10, 26) },
    { key: 'allerheiligen', name: 'Allerheiligen', date: fixed(11, 1) },
    { key: 'mariae-empfaengnis', name: 'Mariä Empfängnis', date: fixed(12, 8) },
    { key: 'christtag', name: 'Christtag', date: fixed(12, 25) },
    { key: 'stefanitag', name: 'Stefanitag', date: fixed(12, 26) },
  ];
  var HOLIDAY_KEYS = HOLIDAYS.map(function (h) { return h.key; });
  function publicHolidaysBetween(from, to) {
    var out = [];
    for (var y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) {
      HOLIDAYS.forEach(function (h) {
        var date = h.date(y);
        if (date >= from && date <= to) out.push({ key: h.key, name: h.name, date: date });
      });
    }
    return out.sort(function (a, b) { return a.date.localeCompare(b.date); });
  }

  /* ----------------------------------------------------------------- ids */

  function uuid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* insecure context */ }
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function reference() {
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ALPHABET[b % ALPHABET.length]; }).join('');
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------------- seed */

  var MEDIA = {
    hero: '13f869c5-3d3a-442c-b652-c14fb98b6ba1',
    cut: '5c38b258-d241-41ab-bc43-2cb68fa45c14',
    interior: '40a2fa4b-c269-4dd8-9b73-5514a86237b9',
    cutWide: '52a6cb8f-d5b1-41b5-86b4-443b34ade31b',
    barber: '704cf1fb-13c6-48a9-bd4d-205273424b47',
  };

  function slugify(value) {
    return String(value).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'leistung';
  }

  function hours(def) {
    // def: { weekday: [start, end, breakStart, breakEnd] }
    var out = [];
    Object.keys(def).forEach(function (wd) {
      var d = def[wd];
      out.push({ weekday: Number(wd), start: d[0], end: d[1], is_break: false });
      if (d[2]) out.push({ weekday: Number(wd), start: d[2], end: d[3], is_break: true });
    });
    return out;
  }

  function seed() {
    var now = Date.now();
    var today = dateInZone(new Date(), TZ);
    var businessId = uuid();
    var ownerId = uuid();
    var eliasUserId = uuid();
    var created = iso(now - 400 * DAY);

    var media = {};
    Object.keys(MEDIA).forEach(function (k) { media[MEDIA[k]] = '/demo/media/' + MEDIA[k] + '.jpg'; });

    var svc = function (de, en, descDe, descEn, min, cents, offer, order) {
      return {
        id: uuid(), slug: slugify(de), name: { de: de, en: en }, description: { de: descDe, en: descEn },
        is_offer: offer, duration_minutes: min, price_cents: cents, status: 'ACTIVE', sort_order: order,
      };
    };
    var services = [
      svc('Herren - Haarschnitt', "Men's Haircut",
        'Klassischer Herrenhaarschnitt mit Maschine und Schere, inklusive Styling.',
        "Classic men's cut with clippers and scissors, styling included.", 30, 2500, false, 10),
      svc('Haarschnitt + Waschen', 'Haircut + Wash',
        'Haarwäsche mit Kopfmassage, Schnitt und Styling.',
        'Hair wash with scalp massage, cut and styling.', 40, 2700, true, 20),
      svc('Haarschnitt + Augenbrauen mit Messer', 'Haircut + Eyebrows with Razor',
        'Haarschnitt und sauber konturierte Augenbrauen mit dem Messer.',
        'Haircut plus neatly shaped eyebrows with the razor.', 40, 2500, true, 30),
      svc('Kinder - Haarschnitt bis 10 Jahre', "Kids' Haircut (up to 10)",
        'Schneller, entspannter Haarschnitt für Kinder bis 10 Jahre.',
        'A quick, relaxed haircut for kids up to 10.', 15, 1800, false, 40),
      svc('Bart trimmen & Konturen', 'Beard Trim & Line-up',
        'Bart in Form bringen, Konturen mit dem Messer nachziehen.',
        'Beard shaped and trimmed, lines sharpened with the razor.', 20, 1500, false, 50),
      svc('Rasur mit Messer & heißem Tuch', 'Razor Shave with Hot Towel',
        'Traditionelle Nassrasur mit heißem Tuch und Pflegebalsam.',
        'Traditional wet shave with a hot towel and soothing balm.', 30, 2200, false, 60),
      svc('Haarschnitt + Bart', 'Haircut + Beard',
        'Der komplette Look: Haarschnitt und Bartpflege in einem Termin.',
        'The full look: haircut and beard grooming in one appointment.', 50, 3500, false, 70),
    ];
    var SID = services.map(function (s) { return s.id; });

    var calendars = [
      { id: 'demo.calendar@example.com', summary: 'Bregenz Barbershop', primary: true },
      { id: 'murat.demo@group.calendar.google.com', summary: 'Murat – Termine', primary: false },
      { id: 'elias.demo@group.calendar.google.com', summary: 'Elias – Termine', primary: false },
      { id: 'jonas.demo@group.calendar.google.com', summary: 'Jonas – Termine', primary: false },
      { id: 'sami.demo@group.calendar.google.com', summary: 'Sami – Termine', primary: false },
    ];

    var emp = function (o) {
      return Object.assign({
        id: uuid(), status: 'ACTIVE', user_id: null, show_on_website: true, photo_media_id: null,
      }, o);
    };
    var employees = [
      emp({
        name: 'Murat Kaya', role_label: { de: 'Senior Barber', en: 'Senior Barber' }, sort_order: 10,
        google_calendar_id: calendars[1].id, photo_media_id: MEDIA.barber, experience_years: 12,
        headline: { de: 'Präzision bei jedem Fade', en: 'Precision in every fade' },
        bio: {
          de: 'Murat schneidet seit über zwölf Jahren Haare – vom klassischen Seitenscheitel bis zum Skin Fade.\n\nSeine Spezialität sind saubere Übergänge und Bartkonturen mit dem Messer.',
          en: 'Murat has been cutting hair for over twelve years – from classic side parts to skin fades.\n\nHis speciality is seamless blending and razor-sharp beard lines.',
        },
        languages: { de: 'Deutsch, Türkisch, Englisch', en: 'German, Turkish, English' },
        service_ids: SID.slice(),
        hours: hours({ 2: ['09:00', '18:30', '12:30', '13:15'], 3: ['09:00', '18:30', '12:30', '13:15'],
          4: ['09:00', '18:30', '12:30', '13:15'], 5: ['09:00', '18:30', '12:30', '13:15'], 6: ['09:00', '15:00'] }),
      }),
      emp({
        name: 'Elias Brunner', role_label: { de: 'Barber', en: 'Barber' }, sort_order: 20,
        google_calendar_id: calendars[2].id, experience_years: 6, user_id: eliasUserId,
        headline: { de: 'Klassiker mit modernem Twist', en: 'Classics with a modern twist' },
        bio: {
          de: 'Elias hat sein Handwerk in Innsbruck gelernt und liebt zeitlose Schnitte, die auch nach drei Wochen noch gut aussehen.',
          en: 'Elias learned his craft in Innsbruck and loves timeless cuts that still look sharp three weeks later.',
        },
        languages: { de: 'Deutsch, Englisch', en: 'German, English' },
        service_ids: SID.slice(),
        hours: hours({ 2: ['09:00', '18:30', '13:00', '13:45'], 3: ['09:00', '18:30', '13:00', '13:45'],
          4: ['09:00', '18:30', '13:00', '13:45'], 5: ['09:00', '18:30', '13:00', '13:45'], 6: ['09:00', '15:00'] }),
      }),
      emp({
        name: 'Jonas Weber', role_label: { de: 'Barber', en: 'Barber' }, sort_order: 30,
        google_calendar_id: calendars[3].id, experience_years: 4,
        headline: { de: 'Ruhige Hand, scharfer Blick', en: 'Steady hand, sharp eye' },
        bio: {
          de: 'Jonas nimmt sich Zeit für die Beratung und findet den Schnitt, der zu Haar und Alltag passt.',
          en: 'Jonas takes his time to listen and finds the cut that suits your hair and your everyday life.',
        },
        languages: { de: 'Deutsch, Italienisch', en: 'German, Italian' },
        service_ids: [SID[0], SID[1], SID[3], SID[4], SID[6]],
        hours: hours({ 2: ['10:00', '18:30', '13:30', '14:00'], 3: ['10:00', '18:30', '13:30', '14:00'],
          4: ['10:00', '18:30', '13:30', '14:00'], 5: ['09:00', '18:30', '13:00', '13:30'], 6: ['09:00', '14:00'] }),
      }),
      emp({
        name: 'Sami Haddad', role_label: { de: 'Junior Barber', en: 'Junior Barber' }, sort_order: 40,
        google_calendar_id: calendars[4].id, experience_years: 2,
        headline: { de: 'Bärte sind meine Leidenschaft', en: 'Beards are my passion' },
        bio: {
          de: 'Sami ist der Jüngste im Team und Spezialist für Rasuren mit heißem Tuch und gepflegte Bärte.',
          en: 'Sami is the youngest on the team and our go-to for hot-towel shaves and well-groomed beards.',
        },
        languages: { de: 'Deutsch, Arabisch, Englisch', en: 'German, Arabic, English' },
        service_ids: [SID[0], SID[2], SID[3], SID[4], SID[5]],
        hours: hours({ 3: ['09:00', '17:00', '12:00', '12:30'], 4: ['09:00', '17:00', '12:00', '12:30'],
          5: ['09:00', '17:00', '12:00', '12:30'], 6: ['09:00', '15:00'] }),
      }),
    ];

    // One future closure day: first Tue–Fri at least 9 days ahead.
    var closureDay = addDays(today, 9);
    while ([2, 3, 4, 5].indexOf(weekdayInZone(closureDay, TZ)) === -1) closureDay = addDays(closureDay, 1);
    var closures = [{ id: uuid(), day: closureDay, label: { de: 'Betriebsausflug', en: 'Team outing' } }];

    // Sami: a few days of vacation in about two and a half weeks.
    var vacStart = addDays(today, 16);
    var absences = [{
      id: uuid(), employee_id: employees[3].id,
      starts_at: iso(zonedToUtc(vacStart, '00:00', TZ)), ends_at: iso(zonedToUtc(addDays(vacStart, 3), '00:00', TZ)),
      kind: 'VACATION', note: { de: 'Urlaub', en: 'Vacation' },
    }];

    var gallery = [
      [MEDIA.cut, 'Frischer Herrenhaarschnitt mit Fade', "Fresh men's haircut with a fade"],
      [MEDIA.hero, 'Blick in den Salon in der Jahnstraße', 'Inside the salon on Jahnstraße'],
      [MEDIA.cutWide, 'Haarschnitt im Detail', 'A haircut up close'],
      [MEDIA.interior, 'Barberstuhl und Spiegel im Salon', 'Barber chair and mirror in the salon'],
    ].map(function (g, i) {
      return {
        id: uuid(), src: '/api/media?id=' + g[0], media_id: g[0], alt: { de: g[1], en: g[2] },
        status: 'ACTIVE', sort_order: (i + 1) * 10, source: 'MANUAL', media_type: 'IMAGE', permalink: null,
      };
    });

    var state = {
      version: 1,
      seededFor: today,
      loggedOut: false,
      business: {
        id: businessId, name: 'Bregenz Barbershop', timezone: TZ, address: 'Jahnstraße 9, 6900 Bregenz',
        phone: '0660 1234567', email: 'hello@bregenz-barbershop.at',
        instagram: 'https://www.instagram.com/bregenz_barbershop/', hero_media_id: MEDIA.hero,
        slot_step_minutes: 15, lead_time_minutes: 60, max_advance_days: 90, open_holidays: [],
      },
      users: [
        { id: ownerId, name: 'Alex Berger', email: 'alex@example.com', role: 'OWNER', status: 'ACTIVE', created_at: created },
        { id: eliasUserId, name: 'Elias Brunner', email: 'elias@example.com', role: 'EMPLOYEE', status: 'ACTIVE', created_at: iso(now - 200 * DAY) },
      ],
      currentUserId: ownerId,
      media: media,
      services: services,
      employees: employees,
      absences: absences,
      closures: closures,
      gallery: gallery,
      bookings: [],
      google: { status: 'ACTIVE', email: 'demo.calendar@example.com', connected_at: iso(now - 120 * DAY), last_error: null },
      calendars: calendars,
      reviews: [
        { author: 'Lukas G.', rating: 5, posted_at: iso(now - 6 * DAY), text: {
          de: 'Bester Fade in Bregenz. Murat nimmt sich Zeit und das Ergebnis ist jedes Mal top.',
          en: 'Best fade in Bregenz. Murat takes his time and the result is spot on every single time.' } },
        { author: 'Daniel H.', rating: 5, posted_at: iso(now - 19 * DAY), text: {
          de: 'Online gebucht, pünktlich drangekommen, super Atmosphäre. Die Rasur mit heißem Tuch kann ich nur empfehlen!',
          en: 'Booked online, was seen right on time, great atmosphere. Highly recommend the hot-towel shave!' } },
        { author: 'Ahmet Y.', rating: 5, posted_at: iso(now - 34 * DAY), text: {
          de: 'Freundliches Team, faire Preise und mein Sohn geht inzwischen auch gern zum Friseur.',
          en: 'Friendly team, fair prices – and now even my son enjoys going to the barber.' } },
      ],
      reviewSummary: { rating: '4.9', total: 63 },
      telegramAccounts: [],
    };

    state.bookings = seedBookings(state, today);
    return state;
  }

  function seedBookings(state, today) {
    var hash = 0;
    for (var i = 0; i < today.length; i += 1) hash = (hash * 31 + today.charCodeAt(i)) | 0;
    var rnd = mulberry32(hash);
    var pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    var now = Date.now();

    var names = ['Lukas Gruber', 'David Huber', 'Tobias Mayer', 'Florian Wagner', 'Stefan Moser', 'Ali Demir',
      'Matteo Rossi', 'Daniel Hofer', 'Patrick Steiner', 'Kevin Bauer', 'Emre Yilmaz', 'Simon Fuchs', 'Marco Eder',
      'Jakob Pichler', 'Leon Schmid', 'Benjamin Wolf', 'Adrian Novak', 'Fabian Lang', 'Thomas Winkler',
      'Michael Reiter', 'Paul Leitner', 'Noah Brandstätter', 'Elias Sommer', 'Omar Khalil', 'Julian Haas',
      'Raphael Koller', 'Dominik Wimmer', 'Can Öztürk', 'Felix Aigner', 'Samuel Holzer'];
    var notes = [
      { de: 'Bitte an den Seiten kurz.', en: 'Short on the sides, please.' },
      { de: 'Erster Besuch.', en: 'First visit.' },
      { de: 'Kommt mit seinem Sohn.', en: 'Coming with his son.' },
      { de: 'Wie beim letzten Mal.', en: 'Same as last time.' },
    ];
    var services = state.services;
    var closed = closedMap(state, addDays(today, -15), addDays(today, 15));
    var out = [];
    var hotDays = [today];
    var probe = addDays(today, 1);
    while (hotDays.length < 2) {
      var wd = weekdayInZone(probe, TZ);
      if (wd >= 2 && wd <= 6 && !closed.has(probe)) hotDays.push(probe);
      probe = addDays(probe, 1);
    }

    for (var offset = -14; offset <= 14; offset += 1) {
      var date = addDays(today, offset);
      if (closed.has(date)) continue;
      var weekday = weekdayInZone(date, TZ);
      state.employees.forEach(function (e) {
        var shifts = e.hours.filter(function (h) { return h.weekday === weekday && !h.is_break; });
        if (!shifts.length) return;
        var breaks = e.hours.filter(function (h) { return h.weekday === weekday && h.is_break; });
        var hot = hotDays.indexOf(date) !== -1;
        var count = hot ? 2 + Math.floor(rnd() * 2) : (rnd() < 0.3 ? 1 : 0);
        for (var n = 0; n < count; n += 1) {
          var preferred = [0, 0, 0, 1, 6, 6, 2, 4, 5, 3].map(function (idx) { return services[idx].id; })
            .filter(function (id) { return e.service_ids.indexOf(id) !== -1; });
          var chosenId = pick(preferred);
          var service = services.find(function (s) { return s.id === chosenId; });
          var dur = service.duration_minutes * MIN;
          var candidates = [];
          shifts.forEach(function (sh) {
            var s0 = zonedToUtc(date, sh.start, TZ).getTime();
            var s1 = zonedToUtc(date, sh.end, TZ).getTime();
            for (var t = s0; t + dur <= s1; t += 15 * MIN) {
              var clash = breaks.some(function (b) {
                return overlaps(t, t + dur, zonedToUtc(date, b.start, TZ).getTime(), zonedToUtc(date, b.end, TZ).getTime());
              }) || out.some(function (b) {
                return b.employee_id === e.id && overlaps(t, t + dur, ms(b.start_time), ms(b.end_time));
              });
              if (!clash) candidates.push(t);
            }
          });
          if (!candidates.length) continue;
          var start = pick(candidates);
          var name = names[out.length % names.length];
          var email = rnd() < 0.5 ? name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '') + '@example.com' : null;
          out.push({
            id: uuid(), reference: reference(), employee_id: e.id, service_id: service.id,
            customer_name: name, customer_phone: '+43 660 000 ' + String(1000 + Math.floor(rnd() * 9000)),
            customer_email: email, note: rnd() < 0.2 ? pick(notes) : null,
            start_time: iso(start), end_time: iso(start + dur), status: 'CONFIRMED',
            source: rnd() < 0.8 ? 'WEBSITE' : 'MANUAL', google_event_id: 'demo-' + reference().toLowerCase(),
            created_at: iso(Math.min(now - 30 * MIN, start - (1 + Math.floor(rnd() * 10)) * DAY)),
          });
        }
      });
    }

    out.sort(function (a, b) { return ms(a.start_time) - ms(b.start_time); });
    var past = out.filter(function (b) { return dateInZone(new Date(b.start_time), TZ) < today; });
    var future = out.filter(function (b) { return dateInZone(new Date(b.start_time), TZ) > today; });
    past.forEach(function (b) { b.status = 'COMPLETED'; });
    if (past.length > 3) {
      past[Math.floor(past.length / 3)].status = 'NO_SHOW';
      var c = past[Math.floor(past.length / 2)];
      c.status = 'CANCELLED'; c.google_event_id = null;
    }
    if (future.length > 2) {
      var fc = future[future.length - 2];
      fc.status = 'CANCELLED'; fc.google_event_id = null;
    }
    return out;
  }

  /* --------------------------------------------------------------- store */

  var S = null;
  function load() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) return parsed;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(S));
    } catch (e) {
      // Quota (large uploads): keep working in memory for this page.
      console.info('[mock] could not persist demo state', e && e.name);
    }
  }
  S = load();
  if (!S) { S = seed(); save(); }

  /* ------------------------------------------------------------- helpers */

  function ValidationError(code, message) { this.code = code; this.publicMessage = message; }
  var CONTROL = /[\u0000-\u001F\u007F]/g;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function text(value, o) {
    o = o || {};
    var max = o.max || 200, field = o.field || 'Feld', min = o.min || 0;
    if (value === undefined || value === null) {
      if (o.required) throw new ValidationError('invalid_input', field + ' fehlt.');
      return null;
    }
    if (typeof value !== 'string') throw new ValidationError('invalid_input', field + ' ist ungültig.');
    var t = value.replace(CONTROL, '').trim();
    if (!t) {
      if (o.required) throw new ValidationError('invalid_input', field + ' darf nicht leer sein.');
      return null;
    }
    if (t.length < min) throw new ValidationError('invalid_input', field + ' ist zu kurz.');
    return t.slice(0, max);
  }
  function emailField(value, o) {
    var raw = text(value, { max: 200, required: o && o.required, field: 'E-Mail' });
    if (!raw) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) throw new ValidationError('invalid_email', 'Diese E-Mail-Adresse sieht nicht richtig aus.');
    return raw.toLowerCase();
  }
  function integer(value, o) {
    o = o || {};
    var min = o.min == null ? 0 : o.min, max = o.max == null ? 1000000 : o.max, field = o.field || 'Zahl';
    if (value === undefined || value === null || value === '') {
      if (o.required) throw new ValidationError('invalid_input', field + ' fehlt.');
      return null;
    }
    var n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError('invalid_input', field + ' muss zwischen ' + min + ' und ' + max + ' liegen.');
    return n;
  }
  function uuidField(value, o) {
    o = o || {};
    var field = o.field || 'Kennung';
    if (!value) {
      if (o.required !== false) throw new ValidationError('invalid_input', field + ' fehlt.');
      return null;
    }
    if (typeof value !== 'string' || !UUID.test(value)) throw new ValidationError('not_found', field + ' ist unbekannt.');
    return value;
  }
  function oneOf(value, allowed, o) {
    o = o || {};
    if (value === undefined || value === null || value === '') {
      if (o.required) throw new ValidationError('invalid_input', (o.field || 'Wert') + ' fehlt.');
      return null;
    }
    if (allowed.indexOf(value) === -1) throw new ValidationError('invalid_input', (o.field || 'Wert') + ' ist ungültig.');
    return value;
  }
  function bool(value, fallback) {
    if (value === undefined || value === null) return fallback === undefined ? null : fallback;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new ValidationError('invalid_input', 'Erwartet wurde ja oder nein.');
  }
  function timeOfDay(value, field) {
    if (typeof value !== 'string') throw new ValidationError('invalid_input', field + ' ist ungültig.');
    var t = value.trim().slice(0, 5);
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) throw new ValidationError('invalid_input', field + ' muss im Format HH:MM stehen.');
    return t;
  }
  function isoDateTime(value, field) {
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ValidationError('invalid_input', field + ' ist ungültig.');
    return d;
  }
  function multiline(value, o) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new ValidationError('invalid_input', o.field + ' ist ungültig.');
    var c = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!c) return null;
    if (c.length > o.max) throw new ValidationError('invalid_input', o.field + ' ist zu lang (höchstens ' + o.max + ' Zeichen).');
    return c;
  }
  function passwordProblem(p) {
    if (typeof p !== 'string' || p.length < 10) return 'Das Passwort muss mindestens 10 Zeichen haben.';
    if (p.length > 200) return 'Das Passwort ist zu lang.';
    return null;
  }

  function ok(status, body) { return { status: status, body: body }; }
  function fail(status, code, message) { return { status: status, body: { error: code, message: message } }; }
  function methodNotAllowed() { return fail(405, 'method_not_allowed', 'Methode nicht erlaubt.'); }
  var notFoundRoute = function () { return fail(404, 'not_found', 'Diesen Endpunkt gibt es nicht.'); };

  var mediaUrl = function (id) { return id ? (S.media[id] || null) : null; };
  var findService = function (id) { return S.services.find(function (s) { return s.id === id; }); };
  var findEmployee = function (id) { return S.employees.find(function (e) { return e.id === id; }); };
  var currentUser = function () { return S.users.find(function (u) { return u.id === S.currentUserId; }) || S.users[0]; };
  var todayKey = function () { return dateInZone(new Date(), S.business.timezone); };
  var googleConnected = function () { return S.google && S.google.status === 'ACTIVE'; };
  var byStr = function (a, b) { return a < b ? -1 : a > b ? 1 : 0; };

  function mediaInUse(id) {
    return S.gallery.some(function (g) { return g.media_id === id; }) ||
      S.employees.some(function (e) { return e.photo_media_id === id; }) ||
      S.business.hero_media_id === id;
  }
  function deleteIfUnused(id) {
    if (id && S.media[id] && String(S.media[id]).indexOf('data:') === 0 && !mediaInUse(id)) delete S.media[id];
  }
  function assertMedia(id) {
    if (!S.media[id]) throw new ValidationError('not_found', 'Dieses Bild gibt es nicht.');
  }

  function closedMap(state, from, to) {
    var open = state.business.open_holidays || [];
    var map = new Map();
    publicHolidaysBetween(from, to).forEach(function (h) {
      if (open.indexOf(h.key) === -1) map.set(h.date, { type: 'holiday', key: h.key, name: h.name });
    });
    state.closures.forEach(function (c) {
      if (c.day >= from && c.day <= to) map.set(c.day, { type: 'closure', name: L(c.label) || 'Geschlossen' });
    });
    return map;
  }
  var closureOn = function (date) { return closedMap(S, date, date).get(date) || null; };

  /* -------------------------------------------------------- availability
     Ported from lib/availability.js (Google busy times = our own bookings). */

  function getAvailability(employee, service, date, knownClosure) {
    var closure = knownClosure !== undefined ? knownClosure : closureOn(date);
    if (closure) return { slots: [], closed: true, closure: closure };
    var tz = S.business.timezone;
    var weekday = weekdayInZone(date, tz);
    var hrs = employee.hours.filter(function (h) { return h.weekday === weekday; })
      .sort(function (a, b) { return byStr(a.start, b.start); });
    var shifts = hrs.filter(function (h) { return !h.is_break; });
    if (!shifts.length) return { slots: [], closed: true };
    var breaks = hrs.filter(function (h) { return h.is_break; });
    var dayStart = zonedToUtc(date, '00:00', tz).getTime();
    var dayEnd = zonedToUtc(addDays(date, 1), '00:00', tz).getTime();

    var blocked = [];
    S.bookings.forEach(function (b) {
      if (b.employee_id === employee.id && ACTIVE_STATUSES.indexOf(b.status) !== -1 &&
        ms(b.start_time) < dayEnd && ms(b.end_time) > dayStart) blocked.push([ms(b.start_time), ms(b.end_time)]);
    });
    S.absences.forEach(function (a) {
      if (a.employee_id === employee.id && ms(a.starts_at) < dayEnd && ms(a.ends_at) > dayStart) blocked.push([ms(a.starts_at), ms(a.ends_at)]);
    });
    breaks.forEach(function (b) { blocked.push([zonedToUtc(date, b.start, tz).getTime(), zonedToUtc(date, b.end, tz).getTime()]); });

    var step = S.business.slot_step_minutes * MIN;
    var dur = service.duration_minutes * MIN;
    var earliest = Date.now() + S.business.lead_time_minutes * MIN;
    var slots = [];
    shifts.forEach(function (sh) {
      var s0 = zonedToUtc(date, sh.start, tz).getTime();
      var s1 = zonedToUtc(date, sh.end, tz).getTime();
      for (var t = s0; t + dur <= s1; t += step) {
        if (t < earliest) continue;
        var free = !blocked.some(function (b) { return overlaps(t, t + dur, b[0], b[1]); });
        slots.push({ start: iso(t), end: iso(t + dur), available: free });
      }
    });
    return { slots: slots, closed: false };
  }

  function findNextAvailableDate(employee, service, fromDate) {
    var closures = closedMap(S, addDays(fromDate, 1), addDays(fromDate, 14));
    for (var i = 1; i <= 14; i += 1) {
      var date = addDays(fromDate, i);
      if (closures.has(date)) continue;
      if (getAvailability(employee, service, date, null).slots.some(function (s) { return s.available; })) return date;
    }
    return null;
  }

  function assertSlotFree(employee, start, end, ignoreWorkingHours) {
    var s = start.getTime(), e = end.getTime();
    if (S.bookings.some(function (b) {
      return b.employee_id === employee.id && ACTIVE_STATUSES.indexOf(b.status) !== -1 && overlaps(s, e, ms(b.start_time), ms(b.end_time));
    })) return false;
    if (S.absences.some(function (a) { return a.employee_id === employee.id && overlaps(s, e, ms(a.starts_at), ms(a.ends_at)); })) return false;
    var tz = S.business.timezone;
    var date = dateInZone(start, tz);
    var weekday = weekdayInZone(date, tz);
    var hrs = employee.hours.filter(function (h) { return h.weekday === weekday; });
    if (!ignoreWorkingHours) {
      if (closureOn(date)) return false;
      var inShift = hrs.filter(function (h) { return !h.is_break; }).some(function (h) {
        return s >= zonedToUtc(date, h.start, tz).getTime() && e <= zonedToUtc(date, h.end, tz).getTime();
      });
      if (!inShift) return false;
      var inBreak = hrs.filter(function (h) { return h.is_break; }).some(function (h) {
        return overlaps(s, e, zonedToUtc(date, h.start, tz).getTime(), zonedToUtc(date, h.end, tz).getTime());
      });
      if (inBreak) return false;
    }
    return true;
  }

  /* -------------------------------------------------------------- shapes */

  function bookingShape(b) {
    var s = findService(b.service_id) || {};
    var e = findEmployee(b.employee_id) || {};
    return {
      id: b.id, reference: b.reference, start: b.start_time, end: b.end_time, status: b.status, source: b.source,
      customer: { name: b.customer_name, phone: b.customer_phone, email: b.customer_email },
      note: L(b.note),
      service: { id: s.id, name: L(s.name), durationMinutes: s.duration_minutes },
      employee: { id: e.id, name: e.name },
      inCalendar: Boolean(b.google_event_id),
      createdAt: b.created_at,
    };
  }

  function sortHours(list) {
    return list.slice().sort(function (a, b) { return a.weekday - b.weekday || byStr(a.start, b.start); });
  }

  function employeeShape(e) {
    var now = Date.now();
    var mine = S.bookings.filter(function (b) { return b.employee_id === e.id; });
    var cutoff = now - 30 * DAY;
    return {
      id: e.id, name: e.name, role: L(e.role_label), status: e.status, googleCalendarId: e.google_calendar_id,
      sortOrder: e.sort_order, serviceIds: e.service_ids.slice(),
      upcomingBookings: mine.filter(function (b) { return ms(b.start_time) >= now && ACTIVE_STATUSES.indexOf(b.status) !== -1; }).length,
      totalBookings: mine.length,
      showOnWebsite: e.show_on_website !== false,
      headline: L(e.headline), bio: L(e.bio), languages: L(e.languages), experienceYears: e.experience_years,
      photoMediaId: e.photo_media_id, photoUrl: mediaUrl(e.photo_media_id),
      workingHours: sortHours(e.hours).map(function (h) { return { weekday: h.weekday, start: h.start, end: h.end, isBreak: h.is_break }; }),
      absences: S.absences.filter(function (a) { return a.employee_id === e.id && ms(a.ends_at) > cutoff; })
        .sort(function (a, b) { return ms(a.starts_at) - ms(b.starts_at); })
        .map(function (a) { return { id: a.id, start: a.starts_at, end: a.ends_at, kind: a.kind, note: L(a.note) }; }),
    };
  }

  function serviceShape(s, withTotal) {
    return {
      id: s.id, slug: s.slug, name: L(s.name), description: L(s.description), isOffer: s.is_offer === true,
      durationMinutes: s.duration_minutes, priceCents: s.price_cents, status: s.status, sortOrder: s.sort_order,
      totalBookings: withTotal ? S.bookings.filter(function (b) { return b.service_id === s.id; }).length : undefined,
    };
  }

  function galleryShape(g) {
    return {
      id: g.id, url: g.media_id ? mediaUrl(g.media_id) : g.src, mediaId: g.media_id, alt: L(g.alt),
      status: g.status, sortOrder: g.sort_order, source: g.source,
    };
  }

  var sortedEmployees = function () {
    return S.employees.slice().sort(function (a, b) { return byStr(a.status, b.status) || a.sort_order - b.sort_order || byStr(a.name, b.name); });
  };
  var activeEmployees = function () {
    return S.employees.filter(function (e) { return e.status === 'ACTIVE'; })
      .sort(function (a, b) { return a.sort_order - b.sort_order || byStr(a.name, b.name); });
  };

  /* ------------------------------------------------------ public routes */

  function splitLanguages(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return [];
    var parts = raw.split(/\s*[,;·/|]\s*/).filter(Boolean);
    if (parts.length === 1 && raw.split(/\s+/).every(function (t) { return t.length <= 3; })) parts = raw.split(/\s+/);
    return parts.map(function (p) { return p.trim(); }).filter(Boolean);
  }
  function mergeIntervals(intervals) {
    var sorted = intervals.slice().sort(function (a, b) { return byStr(a[0], b[0]); });
    var merged = [];
    sorted.forEach(function (iv) {
      var last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = iv[1] > last[1] ? iv[1] : last[1];
      else merged.push([iv[0], iv[1]]);
    });
    return merged;
  }
  // employee_service is a whitelist per service: no entries -> every active employee.
  function performers(serviceId) {
    var active = activeEmployees();
    var listed = active.filter(function (e) { return e.service_ids.indexOf(serviceId) !== -1; });
    var anyListed = S.employees.some(function (e) { return e.service_ids.indexOf(serviceId) !== -1; });
    return anyListed ? listed : active;
  }

  function publicBusiness() {
    var b = S.business;
    var today = todayKey();
    var active = activeEmployees();
    var hrs = [];
    active.forEach(function (e) { e.hours.forEach(function (h) { if (!h.is_break) hrs.push(Object.assign({ employee_id: e.id }, h)); }); });
    var closed = closedMap(S, today, addDays(today, 60));
    var services = S.services.filter(function (s) { return s.status === 'ACTIVE'; })
      .sort(function (x, y) { return (y.is_offer ? 1 : 0) - (x.is_offer ? 1 : 0) || x.sort_order - y.sort_order || byStr(L(x.name), L(y.name)); });
    return ok(200, {
      business: { name: b.name, address: b.address, phone: b.phone, email: b.email, instagram: b.instagram, timezone: b.timezone },
      images: { hero: mediaUrl(b.hero_media_id) },
      openingHours: [0, 1, 2, 3, 4, 5, 6].map(function (wd) {
        return { weekday: wd, intervals: mergeIntervals(hrs.filter(function (h) { return h.weekday === wd; }).map(function (h) { return [h.start, h.end]; })) };
      }),
      today: today,
      closures: Array.from(closed.entries()).sort(function (x, y) { return byStr(x[0], y[0]); })
        .map(function (en) { return { date: en[0], name: en[1].name, type: en[1].type }; }),
      team: active.filter(function (e) { return e.show_on_website !== false; }).map(function (e) {
        var days = [];
        e.hours.forEach(function (h) { if (!h.is_break && days.indexOf(h.weekday) === -1) days.push(h.weekday); });
        return {
          id: e.id, name: e.name, role: L(e.role_label), headline: L(e.headline), bio: L(e.bio),
          languages: splitLanguages(L(e.languages)), experienceYears: e.experience_years,
          photoUrl: mediaUrl(e.photo_media_id), workdays: days.sort(function (x, y) { return x - y; }),
        };
      }),
      services: services.map(function (s) {
        return {
          id: s.id, slug: s.slug, name: L(s.name), description: L(s.description), isOffer: s.is_offer === true,
          durationMinutes: s.duration_minutes, priceCents: s.price_cents,
          employees: performers(s.id).map(function (e) { return e.name; }),
        };
      }),
    });
  }

  function publicServices() {
    var list = S.services.filter(function (s) { return s.status === 'ACTIVE'; })
      .sort(function (a, b) { return a.sort_order - b.sort_order || byStr(L(a.name), L(b.name)); });
    return ok(200, { services: list.map(function (s) {
      return { id: s.id, slug: s.slug, name: L(s.name), description: L(s.description), durationMinutes: s.duration_minutes, priceCents: s.price_cents };
    }) });
  }

  function publicEmployees(params) {
    var serviceId = params.get('serviceId');
    var list = serviceId ? performers(serviceId) : activeEmployees();
    return ok(200, { employees: list.map(function (e) { return { id: e.id, name: e.name, role: L(e.role_label) }; }) });
  }

  function publicAvailability(params) {
    var b = S.business;
    var date = params.get('date');
    if (!isValidDateString(date)) return fail(400, 'invalid_date', 'Bitte wähle ein gültiges Datum.');
    var today = todayKey();
    if (date < today || date > addDays(today, b.max_advance_days)) {
      return fail(400, 'date_out_of_range', 'Termine sind nur bis ' + b.max_advance_days + ' Tage im Voraus buchbar.');
    }
    var service = findService(params.get('serviceId'));
    var employee = findEmployee(params.get('employeeId'));
    if (!service || service.status !== 'ACTIVE') return fail(404, 'service_not_found', 'Diese Leistung ist nicht mehr buchbar.');
    if (!employee || employee.status !== 'ACTIVE') return fail(404, 'employee_not_found', 'Diese Person ist nicht mehr buchbar.');
    var r = getAvailability(employee, service, date);
    var anyFree = r.slots.some(function (s) { return s.available; });
    return ok(200, {
      date: date, timezone: b.timezone, closed: r.closed,
      closure: r.closure ? { type: r.closure.type, name: r.closure.name, key: r.closure.key } : null,
      slots: r.slots, nextAvailableDate: anyFree ? null : findNextAvailableDate(employee, service, date),
    });
  }

  function cleanStr(value, max) {
    if (typeof value !== 'string') return null;
    var t = value.replace(CONTROL, '').trim();
    return t ? t.slice(0, max) : null;
  }

  function publicCreateBooking(body) {
    var name = cleanStr(body.customerName, 120);
    var phone = cleanStr(body.customerPhone, 40);
    var email = cleanStr(body.customerEmail, 200);
    var note = cleanStr(body.note, 500);
    if (!name || name.length < 2) return fail(400, 'invalid_name', 'Bitte gib deinen Namen an.');
    if (!phone || phone.replace(/[\s()/-]/g, '').length < 6) return fail(400, 'invalid_phone', 'Bitte gib eine erreichbare Telefonnummer an.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'invalid_email', 'Diese E-Mail-Adresse sieht nicht richtig aus.');
    var start = new Date(body.start);
    if (Number.isNaN(start.getTime())) return fail(400, 'invalid_start', 'Bitte wähle eine Uhrzeit.');

    var service = findService(body.serviceId);
    var employee = findEmployee(body.employeeId);
    if (!service || service.status !== 'ACTIVE') return fail(404, 'service_not_found', 'Diese Leistung ist nicht mehr buchbar.');
    if (!employee || employee.status !== 'ACTIVE') return fail(404, 'employee_not_found', 'Diese Person nimmt keine Termine mehr an.');
    var end = new Date(start.getTime() + service.duration_minutes * MIN);
    var tz = S.business.timezone;
    var closure = closureOn(dateInZone(start, tz));
    if (closure) {
      var day = new Intl.DateTimeFormat('de-AT', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(start);
      return fail(409, 'closed_day', 'Am ' + day + ' ist der Salon geschlossen (' + closure.name + '). Bitte wähle einen anderen Tag.');
    }
    if (start.getTime() < Date.now() + S.business.lead_time_minutes * MIN) {
      return fail(409, 'too_late', 'Dieser Termin liegt zu kurzfristig. Bitte wähle eine spätere Uhrzeit.');
    }
    if (!assertSlotFree(employee, start, end, false)) {
      return fail(409, 'slot_taken', 'Dieser Termin ist leider nicht mehr frei. Bitte wähle eine andere Uhrzeit.');
    }
    var row = {
      id: uuid(), reference: reference(), employee_id: employee.id, service_id: service.id,
      customer_name: name, customer_phone: phone, customer_email: email, note: note,
      start_time: iso(start), end_time: iso(end), status: 'CONFIRMED', source: 'WEBSITE',
      google_event_id: googleConnected() && employee.google_calendar_id ? 'demo-' + reference().toLowerCase() : null,
      created_at: iso(Date.now()),
    };
    S.bookings.push(row);
    return ok(201, { booking: {
      id: row.id, reference: row.reference, start: row.start_time, end: row.end_time, status: row.status,
      service: L(service.name), employee: employee.name,
    } });
  }

  function publicGallery(params) {
    var limit = Math.min(Math.max(Number(params.get('limit')) || 24, 1), 60);
    var items = S.gallery.filter(function (g) { return g.status === 'ACTIVE'; })
      .sort(function (a, b) { return a.sort_order - b.sort_order; }).slice(0, limit);
    return ok(200, { items: items.map(function (g) {
      var src = g.media_id ? mediaUrl(g.media_id) : g.src;
      return { src: src, thumbnail: src, alt: L(g.alt) || 'Arbeit aus dem Bregenz Barbershop', type: g.media_type, permalink: g.permalink, source: g.source };
    }) });
  }

  function publicReviews() {
    var reviews = S.reviews.slice().sort(function (a, b) { return ms(b.posted_at) - ms(a.posted_at); });
    if (!reviews.length) return ok(200, { reviews: [], rating: null, total: 0 });
    return ok(200, {
      reviews: reviews.map(function (r) { return { author: r.author, rating: Number(r.rating), text: L(r.text), postedAt: r.posted_at }; }),
      rating: S.reviewSummary.rating, total: S.reviewSummary.total, profileUrl: null,
    });
  }

  /* ------------------------------------------------------- admin routes */

  function sessionPayload(user) {
    var linked = S.employees.find(function (e) { return e.user_id === user.id; });
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business: { name: S.business.name, timezone: S.business.timezone },
      employee: linked ? { id: linked.id, name: linked.name, status: linked.status } : null,
      csrfToken: 'demo-csrf-token',
    };
  }

  function adminBookingsList(params) {
    var tz = S.business.timezone;
    var list = S.bookings.slice();
    var from = params.get('from'), to = params.get('to');
    if (from) {
      if (!isValidDateString(from)) throw new ValidationError('invalid_input', 'Das Von-Datum ist ungültig.');
      var f = zonedToUtc(from, '00:00', tz).getTime();
      list = list.filter(function (b) { return ms(b.start_time) >= f; });
    }
    if (to) {
      if (!isValidDateString(to)) throw new ValidationError('invalid_input', 'Das Bis-Datum ist ungültig.');
      var t = zonedToUtc(addDays(to, 1), '00:00', tz).getTime();
      list = list.filter(function (b) { return ms(b.start_time) < t; });
    }
    var status = params.get('status');
    if (status) {
      oneOf(status, STATUSES, { required: true, field: 'Status' });
      list = list.filter(function (b) { return b.status === status; });
    }
    var employeeId = params.get('employeeId');
    if (employeeId) {
      uuidField(employeeId, { field: 'Mitarbeiter' });
      list = list.filter(function (b) { return b.employee_id === employeeId; });
    }
    var q = text(params.get('q'), { max: 60, field: 'Suche' });
    if (q) {
      var needle = q.toLowerCase();
      list = list.filter(function (b) {
        return [b.customer_name, b.customer_phone, b.reference].some(function (v) { return String(v || '').toLowerCase().indexOf(needle) !== -1; });
      });
    }
    list.sort(function (a, b) { return ms(b.start_time) - ms(a.start_time); });
    return ok(200, { bookings: list.slice(0, 500).map(bookingShape), timezone: tz });
  }

  function adminOverview() {
    var b = S.business, now = Date.now(), today = todayKey();
    var active = S.bookings.filter(function (x) { return ACTIVE_STATUSES.indexOf(x.status) !== -1; });
    var counts = {
      employees: S.employees.filter(function (e) { return e.status === 'ACTIVE'; }).length,
      services: S.services.filter(function (s) { return s.status === 'ACTIVE'; }).length,
      upcoming_bookings: active.filter(function (x) { return ms(x.start_time) >= now; }).length,
    };
    var byStart = function (x, y) { return ms(x.start_time) - ms(y.start_time); };
    return ok(200, {
      business: { id: b.id, name: b.name, timezone: b.timezone },
      counts: counts,
      today: active.filter(function (x) { return dateInZone(new Date(x.start_time), b.timezone) === today; }).sort(byStart).map(bookingShape),
      upcoming: active.filter(function (x) { return ms(x.start_time) > now; }).sort(byStart).slice(0, 10).map(bookingShape),
      google: S.google
        ? { connected: googleConnected(), email: S.google.email, connectedAt: S.google.connected_at, lastError: S.google.last_error }
        : { connected: false },
      setupHints: { needsEmployee: counts.employees === 0, needsService: counts.services === 0 },
    });
  }

  function adminCreateBooking(body, user) {
    var customerName = text(body.customerName, { required: true, min: 2, max: 120, field: 'Name' });
    var customerPhone = text(body.customerPhone, { required: true, max: 40, field: 'Telefonnummer' });
    var customerEmail = text(body.customerEmail, { max: 200, field: 'E-Mail' });
    var note = text(body.note, { max: 500, field: 'Anmerkung' });
    var start = isoDateTime(body.start, 'Beginn');
    var serviceId = uuidField(body.serviceId, { field: 'Leistung' });
    var employeeId = uuidField(body.employeeId, { field: 'Mitarbeiter' });
    var outsideHours = bool(body.allowOutsideHours, false) && user.role !== 'EMPLOYEE';
    var service = findService(serviceId), employee = findEmployee(employeeId);
    if (!service || service.status !== 'ACTIVE') return fail(404, 'service_not_found', 'Diese Leistung ist nicht aktiv.');
    if (!employee || employee.status !== 'ACTIVE') return fail(404, 'employee_not_found', 'Diese Person ist nicht aktiv.');
    if (user.role === 'EMPLOYEE' && employee.user_id !== user.id) return fail(403, 'forbidden', 'Du kannst nur Termine für dich selbst eintragen.');
    if (!outsideHours) {
      var closure = closureOn(dateInZone(start, S.business.timezone));
      if (closure) return fail(409, 'closed_day', 'An diesem Tag ist der Salon geschlossen (' + closure.name + ').');
    }
    var end = new Date(start.getTime() + service.duration_minutes * MIN);
    if (!assertSlotFree(employee, start, end, outsideHours)) {
      return fail(409, 'slot_taken', outsideHours ? 'In dieser Zeit liegt bereits ein Termin.' : 'Diese Zeit ist belegt oder liegt außerhalb der Arbeitszeit.');
    }
    var row = {
      id: uuid(), reference: reference(), employee_id: employee.id, service_id: service.id,
      customer_name: customerName, customer_phone: customerPhone, customer_email: customerEmail, note: note,
      start_time: iso(start), end_time: iso(end), status: 'CONFIRMED', source: 'MANUAL',
      google_event_id: googleConnected() && employee.google_calendar_id ? 'demo-' + reference().toLowerCase() : null,
      created_at: iso(Date.now()),
    };
    S.bookings.push(row);
    return ok(201, { booking: bookingShape(row) });
  }

  function adminUpdateBooking(body, user, id) {
    uuidField(id, { field: 'Termin' });
    var status = oneOf(body.status, STATUSES, { required: true, field: 'Status' });
    var b = S.bookings.find(function (x) { return x.id === id; });
    if (!b) return fail(404, 'not_found', 'Diesen Termin gibt es nicht.');
    var releasing = status === 'CANCELLED' && b.status !== 'CANCELLED';
    b.status = status;
    if (releasing) b.google_event_id = null;
    return ok(200, { booking: { id: b.id, status: b.status } });
  }

  function adminRemoveBooking(id) {
    uuidField(id, { field: 'Termin' });
    var b = S.bookings.find(function (x) { return x.id === id; });
    if (!b) return fail(404, 'not_found', 'Diesen Termin gibt es nicht.');
    if (b.status !== 'CANCELLED') return fail(409, 'not_cancelled', 'Nur stornierte Termine lassen sich löschen. Storniere den Termin zuerst.');
    S.bookings = S.bookings.filter(function (x) { return x.id !== id; });
    return ok(200, { ok: true });
  }

  function profileFields(body) {
    var f = {};
    if (body.showOnWebsite !== undefined) f.show_on_website = bool(body.showOnWebsite, true);
    if (body.headline !== undefined) f.headline = text(body.headline, { max: 120, field: 'Überschrift' });
    if (body.bio !== undefined) f.bio = multiline(body.bio, { max: 2000, field: 'Profiltext' });
    if (body.languages !== undefined) f.languages = text(body.languages, { max: 120, field: 'Sprachen' });
    if (body.experienceYears !== undefined) f.experience_years = integer(body.experienceYears, { min: 0, max: 80, field: 'Erfahrung' });
    if (body.photoMediaId !== undefined) {
      var photo = body.photoMediaId ? uuidField(body.photoMediaId, { field: 'Foto' }) : null;
      if (photo) assertMedia(photo);
      f.photo_media_id = photo;
    }
    return f;
  }
  function validServiceIds(list) {
    var ids = list.map(function (v) { return uuidField(v, { field: 'Leistung' }); });
    ids.forEach(function (id) { if (!findService(id)) throw new ValidationError('not_found', 'Eine der Leistungen ist unbekannt.'); });
    return ids.filter(function (id, i) { return ids.indexOf(id) === i; });
  }
  function validHours(entries) {
    var rows = entries.map(function (en) {
      var weekday = integer(en.weekday, { min: 0, max: 6, required: true, field: 'Wochentag' });
      var start = timeOfDay(en.start, 'Beginn'), end = timeOfDay(en.end, 'Ende');
      if (end <= start) throw new ValidationError('invalid_input', 'Das Ende muss nach dem Beginn liegen.');
      return { weekday: weekday, start: start, end: end, is_break: en.isBreak === true };
    });
    var days = [];
    rows.forEach(function (r) { if (days.indexOf(r.weekday) === -1) days.push(r.weekday); });
    days.forEach(function (day) {
      var shifts = rows.filter(function (r) { return r.weekday === day && !r.is_break; }).sort(function (a, b) { return byStr(a.start, b.start); });
      for (var i = 1; i < shifts.length; i += 1) {
        if (shifts[i].start < shifts[i - 1].end) throw new ValidationError('invalid_input', 'Zwei Arbeitszeiten am selben Tag überschneiden sich.');
      }
      rows.filter(function (r) { return r.weekday === day && r.is_break; }).forEach(function (p) {
        if (!shifts.some(function (s) { return p.start >= s.start && p.end <= s.end; })) {
          throw new ValidationError('invalid_input', 'Eine Pause liegt außerhalb der Arbeitszeit.');
        }
      });
    });
    return rows;
  }

  function adminCreateEmployee(body) {
    var name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    var role = text(body.role, { max: 120, field: 'Funktion' });
    var cal = text(body.googleCalendarId, { max: 300, field: 'Kalender' });
    var sortOrder = integer(body.sortOrder, { min: 0, max: 9999 });
    var profile = profileFields(body);
    var serviceIds = Array.isArray(body.serviceIds) ? validServiceIds(body.serviceIds) : [];
    var hrs = Array.isArray(body.workingHours) ? validHours(body.workingHours) : [];
    var e = Object.assign({
      id: uuid(), name: name, role_label: role, google_calendar_id: cal, sort_order: sortOrder == null ? 100 : sortOrder,
      status: 'ACTIVE', user_id: null, show_on_website: true, headline: null, bio: null, languages: null,
      experience_years: null, photo_media_id: null, service_ids: serviceIds, hours: hrs,
    }, profile);
    S.employees.push(e);
    return ok(201, { employee: employeeShape(e) });
  }

  function adminUpdateEmployee(body, id) {
    uuidField(id, { field: 'Mitarbeiter' });
    var e = findEmployee(id);
    if (!e) return fail(404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');
    var previousPhoto = e.photo_media_id;
    var next = {};
    if (body.name !== undefined) next.name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    if (body.role !== undefined) next.role_label = text(body.role, { max: 120, field: 'Funktion' });
    if (body.status !== undefined) next.status = oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' });
    if (body.googleCalendarId !== undefined) next.google_calendar_id = text(body.googleCalendarId, { max: 300, field: 'Kalender' });
    if (body.sortOrder !== undefined) next.sort_order = integer(body.sortOrder, { min: 0, max: 9999, required: true, field: 'Reihenfolge' });
    Object.assign(next, profileFields(body));
    if (Array.isArray(body.serviceIds)) next.service_ids = validServiceIds(body.serviceIds);
    if (Array.isArray(body.workingHours)) next.hours = validHours(body.workingHours);
    Object.assign(e, next);
    if (body.photoMediaId !== undefined && previousPhoto && previousPhoto !== body.photoMediaId) deleteIfUnused(previousPhoto);
    return ok(200, { employee: employeeShape(e) });
  }

  function adminRemoveEmployee(id) {
    uuidField(id, { field: 'Mitarbeiter' });
    var e = findEmployee(id);
    if (!e) return fail(404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');
    if (S.bookings.some(function (b) { return b.employee_id === id; })) {
      return fail(409, 'has_bookings', 'Zu dieser Person gibt es Termine in der Historie. Setz sie auf „inaktiv“, statt sie zu löschen.');
    }
    S.employees = S.employees.filter(function (x) { return x.id !== id; });
    S.absences = S.absences.filter(function (a) { return a.employee_id !== id; });
    deleteIfUnused(e.photo_media_id);
    return ok(200, { ok: true });
  }

  function adminAddAbsence(body, id) {
    uuidField(id, { field: 'Mitarbeiter' });
    if (!findEmployee(id)) return fail(404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');
    var start = isoDateTime(body.start, 'Beginn'), end = isoDateTime(body.end, 'Ende');
    if (end <= start) throw new ValidationError('invalid_input', 'Das Ende muss nach dem Beginn liegen.');
    var kind = oneOf(body.kind, ['VACATION', 'SICK', 'OTHER'], { field: 'Art' }) || 'OTHER';
    var note = text(body.note, { max: 300, field: 'Notiz' });
    var clash = S.bookings.filter(function (b) {
      return b.employee_id === id && ACTIVE_STATUSES.indexOf(b.status) !== -1 && overlaps(start.getTime(), end.getTime(), ms(b.start_time), ms(b.end_time));
    }).length;
    var a = { id: uuid(), employee_id: id, starts_at: iso(start), ends_at: iso(end), kind: kind, note: note };
    S.absences.push(a);
    return ok(201, { absence: { id: a.id, start: a.starts_at, end: a.ends_at, kind: a.kind, note: a.note }, conflictingBookings: clash });
  }

  function adminRemoveAbsence(id, absenceId) {
    uuidField(id, { field: 'Mitarbeiter' });
    uuidField(absenceId, { field: 'Abwesenheit' });
    var before = S.absences.length;
    S.absences = S.absences.filter(function (a) { return !(a.id === absenceId && a.employee_id === id); });
    if (S.absences.length === before) return fail(404, 'not_found', 'Diesen Eintrag gibt es nicht.');
    return ok(200, { ok: true });
  }

  function adminServicesList() {
    var list = S.services.slice().sort(function (a, b) {
      return byStr(a.status, b.status) || (b.is_offer ? 1 : 0) - (a.is_offer ? 1 : 0) || a.sort_order - b.sort_order || byStr(L(a.name), L(b.name));
    });
    return ok(200, { services: list.map(function (s) { return serviceShape(s, true); }) });
  }

  function adminCreateService(body) {
    var name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    var slug = text(body.slug, { max: 60, field: 'Kürzel' }) || slugify(name);
    var description = text(body.description, { max: 500, field: 'Beschreibung' });
    var isOffer = bool(body.isOffer, false);
    var duration = integer(body.durationMinutes, { min: 5, max: 480, required: true, field: 'Dauer' });
    var price = integer(body.priceCents, { min: 0, max: 1000000, required: true, field: 'Preis' });
    var sortOrder = integer(body.sortOrder, { min: 0, max: 9999 });
    if (S.services.some(function (s) { return s.slug === slug; })) return fail(409, 'slug_taken', 'Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.');
    var s = {
      id: uuid(), slug: slug, name: name, description: description, is_offer: isOffer, duration_minutes: duration,
      price_cents: price, sort_order: sortOrder == null ? 100 : sortOrder, status: 'ACTIVE',
    };
    S.services.push(s);
    return ok(201, { service: serviceShape(s, false) });
  }

  function adminUpdateService(body, id) {
    uuidField(id, { field: 'Leistung' });
    var next = {};
    if (body.name !== undefined) next.name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    if (body.slug !== undefined) next.slug = text(body.slug, { required: true, max: 60, field: 'Kürzel' });
    if (body.description !== undefined) next.description = text(body.description, { max: 500, field: 'Beschreibung' });
    if (body.isOffer !== undefined) next.is_offer = bool(body.isOffer, false);
    if (body.durationMinutes !== undefined) next.duration_minutes = integer(body.durationMinutes, { min: 5, max: 480, required: true, field: 'Dauer' });
    if (body.priceCents !== undefined) next.price_cents = integer(body.priceCents, { min: 0, max: 1000000, required: true, field: 'Preis' });
    if (body.status !== undefined) next.status = oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' });
    if (body.sortOrder !== undefined) next.sort_order = integer(body.sortOrder, { min: 0, max: 9999, required: true, field: 'Reihenfolge' });
    if (!Object.keys(next).length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');
    var s = findService(id);
    if (!s) return fail(404, 'not_found', 'Diese Leistung gibt es nicht.');
    if (next.slug && S.services.some(function (x) { return x.id !== id && x.slug === next.slug; })) {
      return fail(409, 'slug_taken', 'Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.');
    }
    Object.assign(s, next);
    return ok(200, { service: serviceShape(s, false) });
  }

  function adminRemoveService(id) {
    uuidField(id, { field: 'Leistung' });
    if (!findService(id)) return fail(404, 'not_found', 'Diese Leistung gibt es nicht.');
    if (S.bookings.some(function (b) { return b.service_id === id; })) {
      return fail(409, 'has_bookings', 'Zu dieser Leistung gibt es Termine in der Historie. Setz sie auf „inaktiv“, statt sie zu löschen.');
    }
    S.services = S.services.filter(function (s) { return s.id !== id; });
    S.employees.forEach(function (e) { e.service_ids = e.service_ids.filter(function (x) { return x !== id; }); });
    return ok(200, { ok: true });
  }

  function adminUploadMedia(body) {
    if (typeof body.data !== 'string' || !body.data) throw new ValidationError('invalid_image', 'Bitte ein Bild auswählen.');
    var base64 = body.data.replace(/^data:[^;,]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new ValidationError('invalid_image', 'Das Bild konnte nicht gelesen werden.');
    if (base64.length * 0.75 > 3 * 1024 * 1024) return fail(413, 'image_too_large', 'Das Bild ist zu groß (höchstens 3 MB).');
    var type = base64.indexOf('/9j/') === 0 ? 'image/jpeg' : base64.indexOf('iVBORw0KGgo') === 0 ? 'image/png'
      : base64.indexOf('UklGR') === 0 ? 'image/webp' : null;
    if (!type) throw new ValidationError('invalid_image', 'Erlaubt sind JPEG, PNG und WebP.');
    var width = integer(body.width, { min: 1, max: 20000, field: 'Breite' });
    var height = integer(body.height, { min: 1, max: 20000, field: 'Höhe' });
    var id = uuid();
    S.media[id] = 'data:' + type + ';base64,' + base64.replace(/\s/g, '');
    return ok(201, { media: { id: id, url: S.media[id], width: width, height: height } });
  }

  function adminGalleryList() {
    var list = S.gallery.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    return ok(200, { items: list.map(galleryShape) });
  }
  function adminGalleryCreate(body) {
    var mediaId = uuidField(body.mediaId, { field: 'Bild' });
    var alt = text(body.alt, { max: 200, field: 'Beschreibung' });
    assertMedia(mediaId);
    var max = S.gallery.reduce(function (m, g) { return Math.max(m, g.sort_order); }, 0);
    var g = {
      id: uuid(), src: '/api/media?id=' + mediaId, media_id: mediaId, alt: alt, status: 'ACTIVE',
      sort_order: max + 10, source: 'MANUAL', media_type: 'IMAGE', permalink: null,
    };
    S.gallery.push(g);
    return ok(201, { item: galleryShape(g) });
  }
  function adminGalleryUpdate(body, id) {
    uuidField(id, { field: 'Bild' });
    var next = {};
    if (body.alt !== undefined) next.alt = text(body.alt, { max: 200, field: 'Beschreibung' });
    if (body.status !== undefined) next.status = oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' });
    if (body.sortOrder !== undefined) next.sort_order = integer(body.sortOrder, { min: 0, max: 1000000, required: true, field: 'Reihenfolge' });
    if (!Object.keys(next).length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');
    var g = S.gallery.find(function (x) { return x.id === id; });
    if (!g) return fail(404, 'not_found', 'Dieses Bild gibt es nicht.');
    Object.assign(g, next);
    return ok(200, { item: galleryShape(g) });
  }
  function adminGalleryReorder(body) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500) throw new ValidationError('invalid_input', 'Die Reihenfolge ist ungültig.');
    var ids = body.ids.map(function (v) { return uuidField(v, { field: 'Bild' }); });
    ids.forEach(function (id, i) {
      var g = S.gallery.find(function (x) { return x.id === id; });
      if (g) g.sort_order = (i + 1) * 10;
    });
    return adminGalleryList();
  }
  function adminGalleryRemove(id) {
    uuidField(id, { field: 'Bild' });
    var g = S.gallery.find(function (x) { return x.id === id; });
    if (!g) return fail(404, 'not_found', 'Dieses Bild gibt es nicht.');
    S.gallery = S.gallery.filter(function (x) { return x.id !== id; });
    deleteIfUnused(g.media_id);
    return ok(200, { ok: true });
  }

  function adminClosuresList() {
    var today = todayKey();
    var open = S.business.open_holidays || [];
    return ok(200, {
      today: today,
      holidays: publicHolidaysBetween(today, addDays(today, 364)).map(function (h) {
        return { key: h.key, name: h.name, date: h.date, closed: open.indexOf(h.key) === -1 };
      }),
      closures: S.closures.filter(function (c) { return c.day >= today; }).sort(function (a, b) { return byStr(a.day, b.day); })
        .map(function (c) { return { id: c.id, date: c.day, label: L(c.label) }; }),
    });
  }
  function adminClosuresAdd(body) {
    var date = text(body.date, { required: true, max: 10, field: 'Datum' });
    if (!isValidDateString(date)) throw new ValidationError('invalid_date', 'Bitte ein gültiges Datum wählen.');
    var label = text(body.label, { max: 120, field: 'Bezeichnung' });
    if (S.closures.some(function (c) { return c.day === date; })) return fail(409, 'closure_exists', 'Für diesen Tag ist schon ein Schließtag eingetragen.');
    var c = { id: uuid(), day: date, label: label };
    S.closures.push(c);
    var tz = S.business.timezone;
    var n = S.bookings.filter(function (b) {
      return ACTIVE_STATUSES.indexOf(b.status) !== -1 && dateInZone(new Date(b.start_time), tz) === date;
    }).length;
    return ok(201, { closure: { id: c.id, date: c.day, label: c.label }, conflictingBookings: n });
  }
  function adminClosuresRemove(id) {
    uuidField(id, { field: 'Schließtag' });
    var before = S.closures.length;
    S.closures = S.closures.filter(function (c) { return c.id !== id; });
    if (S.closures.length === before) return fail(404, 'not_found', 'Diesen Schließtag gibt es nicht.');
    return ok(200, { ok: true });
  }
  function adminClosuresHoliday(body) {
    var key = oneOf(body.key, HOLIDAY_KEYS, { required: true, field: 'Feiertag' });
    var closed = bool(body.closed, true);
    var open = (S.business.open_holidays || []).filter(function (k) { return k !== key; });
    if (!closed) open.push(key);
    S.business.open_holidays = open;
    return adminClosuresList();
  }

  function settingsPayload() {
    var b = S.business;
    return ok(200, { business: {
      id: b.id, name: b.name, timezone: b.timezone, address: b.address, phone: b.phone, email: b.email,
      instagram: b.instagram, heroMediaId: b.hero_media_id, heroUrl: mediaUrl(b.hero_media_id),
      slotStepMinutes: b.slot_step_minutes, leadTimeMinutes: b.lead_time_minutes, maxAdvanceDays: b.max_advance_days,
    } });
  }
  function adminUpdateSettings(body) {
    var next = {};
    if (body.name !== undefined) next.name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    if (body.address !== undefined) next.address = text(body.address, { max: 200, field: 'Adresse' }) || '';
    if (body.phone !== undefined) next.phone = text(body.phone, { max: 40, field: 'Telefon' }) || '';
    if (body.email !== undefined) next.email = emailField(body.email, { required: true });
    if (body.instagram !== undefined) next.instagram = text(body.instagram, { max: 200, field: 'Instagram' });
    if (body.timezone !== undefined) {
      var tz = text(body.timezone, { required: true, max: 60, field: 'Zeitzone' });
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) {
        throw new ValidationError('invalid_input', 'Diese Zeitzone kennt der Server nicht.');
      }
      next.timezone = tz;
    }
    if (body.slotStepMinutes !== undefined) next.slot_step_minutes = integer(body.slotStepMinutes, { min: 5, max: 120, required: true, field: 'Raster' });
    if (body.leadTimeMinutes !== undefined) next.lead_time_minutes = integer(body.leadTimeMinutes, { min: 0, max: 10080, required: true, field: 'Vorlaufzeit' });
    if (body.maxAdvanceDays !== undefined) next.max_advance_days = integer(body.maxAdvanceDays, { min: 1, max: 365, required: true, field: 'Vorausbuchung' });
    var previousHero = null;
    if (body.heroMediaId !== undefined) {
      var heroId = body.heroMediaId === null || body.heroMediaId === '' ? null : uuidField(body.heroMediaId, { field: 'Bild' });
      if (heroId) assertMedia(heroId);
      previousHero = S.business.hero_media_id;
      next.hero_media_id = heroId;
    }
    if (!Object.keys(next).length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');
    Object.assign(S.business, next);
    if (previousHero) deleteIfUnused(previousHero);
    return settingsPayload();
  }

  function usersList(user) {
    var rank = { ADMIN: 0, EMPLOYEE: 1, OWNER: 2 }; // Postgres enum order is not alphabetical; keep owner first
    var list = S.users.slice().sort(function (a, b) {
      if (a.role === 'OWNER') return -1;
      if (b.role === 'OWNER') return 1;
      return (rank[a.role] - rank[b.role]) || byStr(a.name, b.name);
    });
    return ok(200, { users: list.map(function (u) {
      var e = S.employees.find(function (x) { return x.user_id === u.id; });
      return {
        id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.created_at,
        employee: e ? { id: e.id, name: e.name } : null, isSelf: u.id === user.id,
      };
    }) });
  }
  function createUser(body) {
    var name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    var mail = emailField(body.email, { required: true });
    var role = oneOf(body.role, ['ADMIN', 'EMPLOYEE'], { required: true, field: 'Rolle' });
    var problem = passwordProblem(body.password);
    if (problem) return fail(400, 'weak_password', problem);
    var employeeId = body.employeeId ? uuidField(body.employeeId, { field: 'Mitarbeiter' }) : null;
    if (S.users.some(function (u) { return u.email.toLowerCase() === mail; })) return fail(409, 'email_taken', 'Für diese E-Mail-Adresse gibt es schon ein Konto.');
    var u = { id: uuid(), name: name, email: mail, role: role, status: 'ACTIVE', created_at: iso(Date.now()) };
    S.users.push(u);
    if (employeeId) { var e = findEmployee(employeeId); if (e) e.user_id = u.id; }
    return ok(201, { user: { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status } });
  }
  function updateUser(body, user, id) {
    uuidField(id, { field: 'Benutzer' });
    var target = S.users.find(function (u) { return u.id === id; });
    if (!target) return fail(404, 'not_found', 'Dieses Konto gibt es nicht.');
    if (target.role === 'OWNER' && (body.role !== undefined || body.status !== undefined)) {
      return fail(409, 'owner_protected', 'Das Inhaberkonto lässt sich nicht herabstufen oder sperren.');
    }
    var next = {};
    if (body.name !== undefined) next.name = text(body.name, { required: true, min: 2, max: 120, field: 'Name' });
    if (body.email !== undefined) next.email = emailField(body.email, { required: true });
    if (body.role !== undefined) next.role = oneOf(body.role, ['ADMIN', 'EMPLOYEE'], { required: true, field: 'Rolle' });
    if (body.status !== undefined) next.status = oneOf(body.status, ['ACTIVE', 'INACTIVE'], { required: true, field: 'Status' });
    if (body.password !== undefined) {
      var problem = passwordProblem(body.password);
      if (problem) return fail(400, 'weak_password', problem);
      next.passwordChanged = true;
    }
    if (!Object.keys(next).length) throw new ValidationError('invalid_input', 'Es gibt nichts zu ändern.');
    if (next.email && S.users.some(function (u) { return u.id !== id && u.email.toLowerCase() === next.email; })) {
      return fail(409, 'email_taken', 'Diese E-Mail-Adresse ist vergeben.');
    }
    delete next.passwordChanged;
    Object.assign(target, next);
    if (body.employeeId !== undefined) {
      var employeeId = body.employeeId ? uuidField(body.employeeId, { field: 'Mitarbeiter' }) : null;
      S.employees.forEach(function (e) { if (e.user_id === id) e.user_id = null; });
      if (employeeId) { var e = findEmployee(employeeId); if (e) e.user_id = id; }
    }
    return usersList(user);
  }

  function googleStatus() {
    var connected = googleConnected();
    return ok(200, {
      configured: true,
      connected: connected,
      account: S.google ? { email: S.google.email, connectedAt: S.google.connected_at } : null,
      lastError: (S.google && S.google.last_error) || null,
      calendars: connected ? S.calendars.slice() : null,
      calendarError: null,
      employees: sortedEmployees().map(function (e) {
        return { id: e.id, name: e.name, status: e.status, googleCalendarId: e.google_calendar_id };
      }),
      redirectUri: location.origin + '/api/google/callback',
    });
  }

  /* -------------------------------------------------------------- router */

  function adminRoute(method, parts, params, body) {
    var resource = parts[0], id = parts[1], sub = parts[2], subId = parts[3];

    if (resource === 'setup' && !id) {
      if (method === 'GET') return ok(200, { needsSetup: false });
      if (method === 'POST') return fail(409, 'setup_done', 'Für diesen Betrieb gibt es bereits einen Inhaber. Bitte melde dich an.');
      return methodNotAllowed();
    }
    if (resource === 'session' && id === 'telegram') {
      if (method !== 'POST') return methodNotAllowed();
      if (!sub || sub === 'link') return fail(503, 'telegram_disabled', 'Die Telegram-Anbindung ist für diesen Betrieb nicht eingerichtet.');
      return notFoundRoute();
    }
    if (resource === 'session' && !id) {
      if (method === 'POST') {
        // Demo: any credentials sign in as the owner.
        if (typeof body.password !== 'string' || !body.password) return fail(400, 'invalid_credentials', 'E-Mail-Adresse oder Passwort stimmt nicht.');
        S.loggedOut = false;
        S.currentUserId = S.users.find(function (u) { return u.role === 'OWNER'; }).id;
        var u = currentUser();
        return ok(200, { user: { id: u.id, name: u.name, email: u.email, role: u.role } });
      }
      if (method === 'GET') {
        if (S.loggedOut) return fail(401, 'unauthorized', 'Bitte melde dich an.');
        return ok(200, sessionPayload(currentUser()));
      }
      if (method === 'DELETE') { S.loggedOut = true; return ok(200, { ok: true }); }
      return methodNotAllowed();
    }

    if (S.loggedOut) return fail(401, 'unauthorized', 'Bitte melde dich an.');
    var user = currentUser();

    if (resource === 'password' && method === 'POST') {
      var problem = passwordProblem(body.newPassword);
      if (problem) return fail(400, 'weak_password', problem);
      if (!body.currentPassword) return fail(403, 'invalid_credentials', 'Das aktuelle Passwort stimmt nicht.');
      return ok(200, { ok: true });
    }
    if (resource === 'telegram') {
      if (method === 'GET' && !id) return ok(200, { bot: { configured: false, username: null, reachable: false }, accounts: [] });
      if (method === 'DELETE' && id) { uuidField(id, { field: 'Verknüpfung' }); return fail(404, 'not_found', 'Diese Verknüpfung wurde nicht gefunden.'); }
      return methodNotAllowed();
    }
    if (resource === 'overview') {
      if (method !== 'GET') return methodNotAllowed();
      return adminOverview();
    }
    if (resource === 'bookings') {
      if (method === 'GET' && !id) return adminBookingsList(params);
      if (method === 'POST' && !id) return adminCreateBooking(body, user);
      if (method === 'PATCH' && id) return adminUpdateBooking(body, user, id);
      if (method === 'DELETE' && id) return adminRemoveBooking(id);
      return methodNotAllowed();
    }
    if (resource === 'employees') {
      if (method === 'GET' && !id) return ok(200, { employees: sortedEmployees().map(employeeShape) });
      if (method === 'POST' && !id) return adminCreateEmployee(body);
      if (method === 'PATCH' && id && !sub) return adminUpdateEmployee(body, id);
      if (method === 'DELETE' && id && !sub) return adminRemoveEmployee(id);
      if (method === 'POST' && sub === 'absences') return adminAddAbsence(body, id);
      if (method === 'DELETE' && sub === 'absences' && subId) return adminRemoveAbsence(id, subId);
      return methodNotAllowed();
    }
    if (resource === 'services') {
      if (method === 'GET' && !id) return adminServicesList();
      if (method === 'POST' && !id) return adminCreateService(body);
      if (method === 'PATCH' && id) return adminUpdateService(body, id);
      if (method === 'DELETE' && id) return adminRemoveService(id);
      return methodNotAllowed();
    }
    if (resource === 'media') {
      if (method === 'POST' && !id) return adminUploadMedia(body);
      return methodNotAllowed();
    }
    if (resource === 'gallery') {
      if (method === 'GET' && !id) return adminGalleryList();
      if (method === 'POST' && !id) return adminGalleryCreate(body);
      if (method === 'POST' && id === 'reorder') return adminGalleryReorder(body);
      if (method === 'PATCH' && id) return adminGalleryUpdate(body, id);
      if (method === 'DELETE' && id) return adminGalleryRemove(id);
      return methodNotAllowed();
    }
    if (resource === 'closures') {
      if (method === 'GET' && !id) return adminClosuresList();
      if (method === 'POST' && !id) return adminClosuresAdd(body);
      if (method === 'POST' && id === 'holiday') return adminClosuresHoliday(body);
      if (method === 'DELETE' && id) return adminClosuresRemove(id);
      return methodNotAllowed();
    }
    if (resource === 'settings') {
      if (method === 'GET') return settingsPayload();
      if (method === 'PATCH') return adminUpdateSettings(body);
      return methodNotAllowed();
    }
    if (resource === 'users') {
      if (method === 'GET' && !id) return usersList(user);
      if (method === 'POST' && !id) return createUser(body);
      if (method === 'PATCH' && id) return updateUser(body, user, id);
      return methodNotAllowed();
    }
    if (resource === 'google') {
      if (method === 'GET' && !id) return googleStatus();
      if (method === 'POST' && id === 'calendar') {
        var employeeId = uuidField(body.employeeId, { field: 'Mitarbeiter' });
        var cal = text(body.googleCalendarId, { max: 300, field: 'Kalender' });
        var e = findEmployee(employeeId);
        if (!e) return fail(404, 'not_found', 'Diesen Mitarbeiter gibt es nicht.');
        e.google_calendar_id = cal;
        return googleStatus();
      }
      if (method === 'POST' && id === 'disconnect') {
        S.google = Object.assign({}, S.google, { status: 'INACTIVE', connected_at: null, last_error: null });
        return ok(200, { ok: true, connected: false });
      }
      return methodNotAllowed();
    }
    return null;
  }

  function route(method, url, body) {
    var path = url.pathname.replace(/\/+$/, '');
    var params = url.searchParams;
    var get = method === 'GET' || method === 'HEAD';

    if (path.indexOf('/api/admin/') === 0 || path === '/api/admin') {
      var parts = path.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
      return adminRoute(method, parts, params, body);
    }
    switch (path) {
      case '/api/business': return get ? publicBusiness() : methodNotAllowed();
      case '/api/services': return get ? publicServices() : methodNotAllowed();
      case '/api/employees': return get ? publicEmployees(params) : methodNotAllowed();
      case '/api/availability': return get ? publicAvailability(params) : methodNotAllowed();
      case '/api/bookings': return method === 'POST' ? publicCreateBooking(body) : methodNotAllowed();
      case '/api/gallery': return get ? publicGallery(params) : methodNotAllowed();
      case '/api/reviews': return get ? publicReviews() : methodNotAllowed();
      case '/api/telegram': return method === 'POST' ? fail(503, 'telegram_disabled', 'Der Telegram-Bot ist nicht eingerichtet.') : methodNotAllowed();
      default: return null;
    }
  }

  /* --------------------------------------------------------- fetch patch */

  function jsonResponse(result) {
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  var delay = function () { return new Promise(function (r) { setTimeout(r, 120 + Math.random() * 130); }); };

  async function readBody(input, init) {
    var raw = init && init.body !== undefined ? init.body : null;
    if (raw == null && input instanceof Request && !['GET', 'HEAD'].includes(input.method)) {
      try { raw = await input.clone().text(); } catch (e) { raw = null; }
    }
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  window.fetch = async function (input, init) {
    var href = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') !== 0) return realFetch(input, init);

    var method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Images: serve the static demo file (or the uploaded data: URL).
    if (url.pathname === '/api/media') {
      var mid = url.searchParams.get('id') || (url.searchParams.get('slot') === 'hero' ? S.business.hero_media_id : null);
      var target = mediaUrl(mid);
      if (!target) return jsonResponse(fail(404, 'not_found', 'Bild nicht gefunden.'));
      return realFetch(target);
    }

    var body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readBody(input, init) : {};
    await delay();
    if (body === null) return jsonResponse(fail(400, 'invalid_body', 'Die Anfrage konnte nicht gelesen werden.'));

    var result;
    try {
      result = route(method, url, body);
    } catch (err) {
      if (err instanceof ValidationError) result = fail(400, err.code, err.publicMessage);
      else {
        console.error('[mock] handler error', err);
        result = fail(500, 'server_error', GENERIC);
      }
    }
    if (!result) {
      console.warn('[mock] unhandled', method, url.pathname + url.search);
      result = notFoundRoute();
    }
    if (!['GET', 'HEAD'].includes(method) && result.status < 500) save();
    return jsonResponse(result);
  };

  /* Google OAuth is a browser navigation (<a href="/api/google/start">), not a
     fetch. In the demo it "connects" immediately and lands on the success URL. */
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href^="/api/google/start"]');
    if (!link) return;
    event.preventDefault();
    S.google = { status: 'ACTIVE', email: 'demo.calendar@example.com', connected_at: iso(Date.now()), last_error: null };
    save();
    location.href = '/admin/google?connected=1';
  }, true);

  // Small hook for scripted demos (Playwright): reset to seed data.
  window.__bbDemoReset = function () {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    S = seed();
    save();
  };
})();
