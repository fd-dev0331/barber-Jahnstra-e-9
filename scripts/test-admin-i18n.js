/* Prüft die Übersetzungen der Verwaltung, ohne Server und ohne Browser.

   1. DE, RU und TR haben exakt dieselben Schlüssel, kein Wert ist leer.
   2. Jeder Schlüssel, den Admin-JS (t/tn) oder Admin-HTML (data-i18n) benutzt, existiert.
   3. Schlüssel, die im Code zusammengesetzt werden (Status, Rollen, Fehlercodes des
      Backends …), sind vollständig vorhanden.
   4. Kein sichtbarer Text ist im Admin-HTML oder -JS fest verdrahtet (Heuristik).
   5. Spracherkennung, Vorrang der gespeicherten Wahl, Speicherung, Pluralformen.
   6. Die öffentliche Website lädt nichts davon.

   Aufruf:  node scripts/test-admin-i18n.js          (Prüfung)
            node scripts/test-admin-i18n.js --list   (nur benutzte Schlüssel ausgeben) */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const ADMIN_JS = path.join(ROOT, 'public/assets/js/admin');
const ADMIN_HTML = path.join(ROOT, 'public/admin');
const listOnly = process.argv.includes('--list');

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); } else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

const read = (file) => fs.readFileSync(file, 'utf8');
const jsFiles = fs.readdirSync(ADMIN_JS).filter((f) => f.endsWith('.js')).map((f) => path.join(ADMIN_JS, f));
const htmlFiles = fs.readdirSync(ADMIN_HTML).filter((f) => f.endsWith('.html')).map((f) => path.join(ADMIN_HTML, f));

/* ------------------------------------------------------ benutzte Schlüssel */

const NAMESPACES = ['common', 'nav', 'shell', 'roles', 'status', 'login', 'setup', 'validation', 'errors', 'holidays',
  'dashboard', 'bookings', 'calendar', 'employees', 'services', 'gallery', 'business', 'google', 'settings'];
const used = new Map(); // key -> Set(file)
const use = (key, file) => {
  if (!used.has(key)) used.set(key, new Set());
  used.get(key).add(path.relative(ROOT, file));
};

for (const file of jsFiles) {
  const source = read(file);
  // Jedes String-Literal, das wie ein Schlüssel aussieht — auch in Ternären oder
  // Variablen (const step = cond ? 'calendar.prevDay' : …; t(step)).
  for (const m of source.matchAll(new RegExp(`'((?:${NAMESPACES.join('|')})\\.[a-zA-Z0-9_.]+)'`, 'g'))) use(m[1], file);
}
for (const file of htmlFiles) {
  const source = read(file);
  for (const m of source.matchAll(/data-i18n="([^"]+)"/g)) use(m[1], file);
  for (const m of source.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(';')) {
      const key = pair.split(':')[1]?.trim();
      if (key) use(key, file);
    }
  }
}

/* Zusammengesetzte Schlüssel: vollständig erwartet. */
const backendCodes = new Set();
for (const dir of ['lib', 'api']) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!entry.name.endsWith('.js')) return;
    const source = read(full);
    for (const m of source.matchAll(/fail\(res,\s*\d+,\s*'([a-z_]+)'/g)) backendCodes.add(m[1]);
    for (const m of source.matchAll(/new ValidationError\(\s*'([a-z_]+)'/g)) backendCodes.add(m[1]);
  });
  walk(path.join(ROOT, dir));
}
// Aus dem Frontend selbst erzeugte Codes.
['offline', 'error'].forEach((code) => backendCodes.add(code));

const dynamic = [
  ...['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].map((s) => `status.${s}`),
  ...['OWNER', 'ADMIN', 'EMPLOYEE', 'CLIENT'].map((r) => `roles.${r}`),
  ...['dashboard', 'bookings', 'calendar', 'employees', 'services', 'gallery', 'business', 'google', 'settings'].map((p) => `nav.${p}`),
  ...['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'].map((s) => `bookings.setStatus.${s}`),
  ...['VACATION', 'SICK', 'OTHER'].map((k) => `employees.absenceKinds.${k}`),
  ...['access_denied', 'state_mismatch', 'no_refresh_token', 'not_configured', 'generic'].map((c) => `google.callbackErrors.${c}`),
  'employees.shift', 'employees.break', 'common.active', 'common.inactive',
  // Feiertagsnamen: Schlüssel aus lib/holidays.js, im Code als `holidays.${key}`.
  ...['neujahr', 'heilige-drei-koenige', 'ostermontag', 'staatsfeiertag', 'christi-himmelfahrt', 'pfingstmontag',
    'fronleichnam', 'mariae-himmelfahrt', 'nationalfeiertag', 'allerheiligen', 'mariae-empfaengnis', 'christtag',
    'stefanitag'].map((key) => `holidays.${key}`),
  'errors.generic', 'errors.forbidden', 'errors.not_found', 'errors.conflict', 'errors.server_error',
  ...[...backendCodes].map((code) => `errors.${code}`),
];
dynamic.forEach((key) => use(key, 'dynamic'));

if (listOnly) {
  console.log([...used.keys()].sort().join('\n'));
  process.exit(0);
}

/* ------------------------------------------------------------ Wörterbücher */

const dictionaries = {};
for (const lang of ['de', 'ru', 'tr']) {
  dictionaries[lang] = (await import(pathToFileURL(path.join(ADMIN_JS, 'i18n', `${lang}.js`)).href)).default;
}

function flatten(node, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const isPlural = value && typeof value === 'object' && 'other' in value;
    if (typeof value === 'string' || isPlural) out.set(full, value);
    else if (value && typeof value === 'object') flatten(value, full, out);
    else out.set(full, value);
  }
  return out;
}

const flat = Object.fromEntries(Object.entries(dictionaries).map(([lang, dict]) => [lang, flatten(dict)]));

console.log('\n▸ 1. Gleiche Schlüssel in DE / RU / TR');
for (const lang of ['ru', 'tr']) {
  const missing = [...flat.de.keys()].filter((k) => !flat[lang].has(k));
  const extra = [...flat[lang].keys()].filter((k) => !flat.de.has(k));
  check(`${lang.toUpperCase()} hat alle DE-Schlüssel`, !missing.length, missing.join(', '));
  check(`${lang.toUpperCase()} hat keine zusätzlichen Schlüssel`, !extra.length, extra.join(', '));
}
for (const lang of ['de', 'ru', 'tr']) {
  const empty = [...flat[lang]].filter(([, v]) => (typeof v === 'string' ? !v.trim() : !v?.other)).map(([k]) => k);
  check(`${lang.toUpperCase()}: keine leeren Werte`, !empty.length, empty.join(', '));
  const plurals = [...flat[lang]].filter(([, v]) => typeof v === 'object');
  const required = new Intl.PluralRules({ de: 'de-AT', ru: 'ru-RU', tr: 'tr-TR' }[lang]).resolvedOptions().pluralCategories;
  const incomplete = plurals.filter(([, v]) => required.some((cat) => !v[cat] && !(cat !== 'other' && v.other && lang !== 'ru'))).map(([k]) => k);
  check(`${lang.toUpperCase()}: Pluralformen vollständig (${required.join('/')})`, !incomplete.length, incomplete.join(', '));
  // Platzhalter müssen in allen Sprachen dieselben sein.
  if (lang !== 'de') {
    const mismatch = [...flat.de].filter(([k, v]) => {
      const names = (s) => [...JSON.stringify(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      return flat[lang].has(k) && names(v) !== names(flat[lang].get(k)) && !(typeof v === 'object');
    }).map(([k]) => k);
    check(`${lang.toUpperCase()}: gleiche Platzhalter wie DE`, !mismatch.length, mismatch.join(', '));
  }
}
const identical = [...flat.de].filter(([k, v]) => typeof v === 'string' && v.length > 3
  && v === flat.ru.get(k) && v === flat.tr.get(k) && !/^[A-Z0-9 /().:·–-]+$/.test(v)
  && !/^(Instagram|Google|Telegram|Dashboard|Details)$/.test(v)).map(([k]) => k);
check('Keine Texte, die in RU/TR einfach deutsch geblieben sind', !identical.length, identical.join(', '));

console.log('\n▸ 2. Jeder benutzte Schlüssel existiert');
const unknown = [...used].filter(([key]) => !flat.de.has(key)).map(([key, files]) => `${key} (${[...files].join(', ')})`);
check(`${used.size} benutzte Schlüssel gefunden, alle vorhanden`, !unknown.length, `\n     ${unknown.join('\n     ')}`);
const unused = [...flat.de.keys()].filter((key) => !used.has(key));
if (unused.length) console.log(`  ℹ️  nicht direkt referenziert (evtl. dynamisch): ${unused.join(', ')}`);

console.log('\n▸ 3. Kein fest verdrahteter Text');
const ALLOWED_TEXT = new Set(['Bregenz Barbershop', '–', '·']);
for (const file of htmlFiles) {
  const visible = read(file)
    .replace(/<(script|style|noscript|svg|title)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n').map((s) => s.trim()).filter((s) => s && !ALLOWED_TEXT.has(s));
  check(`${path.basename(file)}: kein sichtbarer Text ohne data-i18n`, !visible.length, visible.join(' | '));
  const rawAria = [...read(file).matchAll(/<[^>]*\s(?:aria-label|placeholder|title)="([^"]*[a-zäöü]{3}[^"]*)"[^>]*>/gi)]
    .filter((m) => !m[0].includes('data-i18n-attr') && !m[1].startsWith('http')).map((m) => m[1]);
  check(`${path.basename(file)}: keine unübersetzten Attribute`, !rawAria.length, rawAria.join(' | '));
}
for (const file of jsFiles.filter((f) => !f.includes(`${path.sep}i18n`))) {
  const code = read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const german = [...code.matchAll(/(['"`])((?:(?!\1).)*[äöüÄÖÜß](?:(?!\1).)*)\1/g)].map((m) => m[2]);
  check(`${path.basename(file)}: keine deutschen Texte im Code`, !german.length, german.join(' | '));
}

console.log('\n▸ 4. Spracherkennung und Speicherung');
/** `telegram` ist die Sprache des Telegram-Kontos, wie sie in der Adresse steht. */
function environment({ stored = null, languages = ['de-AT'], telegram = null } = {}) {
  const storage = new Map(stored ? [['admin_language', stored]] : []);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages, language: languages[0] } });
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { documentElement: {}, querySelectorAll: () => [] },
  });
  const initData = telegram
    ? `user=${encodeURIComponent(JSON.stringify({ id: 1, first_name: 'T', language_code: telegram }))}&auth_date=1`
    : null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent() {}, addEventListener() {},
      location: { pathname: '/admin', search: '', hash: initData ? `#tgWebAppData=${encodeURIComponent(initData)}` : '' },
    },
  });
  return storage;
}
let run = 0;
async function freshI18n(options) {
  const storage = environment(options);
  run += 1;
  const mod = await import(`${pathToFileURL(path.join(ADMIN_JS, 'i18n.js')).href}?run=${run}`);
  return { mod, storage };
}

check('Browser ru-RU -> RU', (await freshI18n({ languages: ['ru-RU', 'en'] })).mod.getLanguage() === 'ru');
check('Browser tr -> TR', (await freshI18n({ languages: ['tr'] })).mod.getLanguage() === 'tr');
check('Browser de-AT -> DE', (await freshI18n({ languages: ['de-AT'] })).mod.getLanguage() === 'de');
check('Browser en-US/fr -> Fallback DE', (await freshI18n({ languages: ['en-US', 'fr'] })).mod.getLanguage() === 'de');
check('Browser en, dann ru -> RU (erste unterstützte)', (await freshI18n({ languages: ['en', 'ru'] })).mod.getLanguage() === 'ru');
check('Gespeicherte Wahl TR schlägt Browser RU', (await freshI18n({ stored: 'tr', languages: ['ru'] })).mod.getLanguage() === 'tr');
check('Ungültiger gespeicherter Wert -> Erkennung', (await freshI18n({ stored: 'xx', languages: ['tr-TR'] })).mod.getLanguage() === 'tr');

check('Telegram-Sprache RU schlägt Browser DE',
  (await freshI18n({ languages: ['de-AT'], telegram: 'ru' })).mod.getLanguage() === 'ru');
check('Telegram-Sprache TR schlägt Browser RU',
  (await freshI18n({ languages: ['ru-RU'], telegram: 'tr' })).mod.getLanguage() === 'tr');
check('Gespeicherte Wahl schlägt die Telegram-Sprache',
  (await freshI18n({ stored: 'de', languages: ['ru'], telegram: 'tr' })).mod.getLanguage() === 'de');
check('Unbekannte Telegram-Sprache -> Browsersprache',
  (await freshI18n({ languages: ['tr-TR'], telegram: 'uk' })).mod.getLanguage() === 'tr');

const detected = await freshI18n({ languages: ['ru'] });
check('Erkennung allein speichert nichts', !detected.storage.has('admin_language'));
detected.mod.setLanguage('tr');
check('Manuelle Wahl wird als admin_language gespeichert', detected.storage.get('admin_language') === 'tr');
check('Nach der Wahl liefert t() Türkisch', detected.mod.getLanguage() === 'tr' && detected.mod.t('nav.bookings') === dictionaries.tr.nav.bookings);
check('Nach „Neuladen" bleibt TR', (await freshI18n({ stored: detected.storage.get('admin_language'), languages: ['ru'] })).mod.getLanguage() === 'tr');

const ru = (await freshI18n({ stored: 'ru' })).mod;
const plural = dictionaries.ru.bookings.count;
check('RU-Plural 1 / 3 / 5', ru.tn('bookings.count', 1) === plural.one.replace('{count}', '1')
  && ru.tn('bookings.count', 3) === plural.few.replace('{count}', '3')
  && ru.tn('bookings.count', 5) === plural.many.replace('{count}', '5'));
check('Platzhalter werden ersetzt', !ru.t('bookings.statusChanged', { status: 'X' }).includes('{status}'));

console.log('\n▸ 5. Öffentliche Website bleibt deutsch und ohne Sprachwahl');
for (const page of ['index.html', 'booking.html', 'galerie.html']) {
  const html = read(path.join(ROOT, 'public', page));
  check(`${page}: lang="de", kein Admin-Skript, keine Sprachwahl`,
    /<html lang="de"/.test(html) && !/assets\/js\/admin|admin\.css|data-lang|admin_language/.test(html));
}
for (const file of ['site.js', 'home.js', 'booking.js', 'gallery.js']) {
  const source = read(path.join(ROOT, 'public/assets/js', file));
  check(`${file}: importiert nichts aus der Verwaltung`, !/admin\/|i18n|admin_language/.test(source));
}

console.log(`\n${'─'.repeat(48)}\n  ${pass} bestanden, ${fail} fehlgeschlagen`);
process.exitCode = fail ? 1 : 0;
