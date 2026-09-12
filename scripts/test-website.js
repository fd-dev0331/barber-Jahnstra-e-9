/* Die Website zeigt nur, was in der Verwaltung steht.

   Aufruf:  npm run dev   (zweites Terminal)
            node scripts/test-website.js

   Hintergrund: Im HTML standen früher Beispielpreise, eine erfundene Person im
   Team, feste Öffnungszeiten und Kontaktdaten als „Rückfall". Beim Laden waren
   sie kurz zu sehen und wurden dann von den echten Daten ersetzt — wer etwas in
   der Verwaltung geändert hatte, sah für einen Moment den alten Stand.

   Dieser Test hält den Zustand fest: im ausgelieferten HTML steht nichts davon,
   und die Endpunkte liefern, was die Seiten dafür brauchen. Er prüft den
   Quelltext, nicht den fertig gerenderten Zustand — genau darum geht es. */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:3210';
const PUBLIC_DIR = path.resolve('public');

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label} ${detail}`); }
}

const read = (file) => fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');

/** Nur der sichtbare Teil: Titel, Beschreibung und JSON-LD zählen nicht mit. */
function body(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

async function main() {
  console.log(`\nWebsite ohne Beispieldaten · ${BASE}\n`);

  console.log('1) Startseite: keine Inhalte im Quelltext');
  const index = body(read('index.html'));
  const cases = [
    ['keine Preise', /\d+,\d\d\s*(?:&nbsp;|&#160;|\s)?€/],
    ['keine Öffnungszeiten', /\b\d\d:\d\d\s*[–-]\s*\d\d:\d\d/],
    ['keine Wochentagsliste', />(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)</],
    ['keine Telefonnummer', /0681[\s ]*20397906|\+436812039790/],
    ['keine E-Mail-Adresse', /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
    ['kein Mitarbeitername', /Abdulrahman|Abo\b/],
    ['keine Beispielkacheln', /4 Min\.|6 Tage/],
    ['keine Bilddatei aus /assets/img', /\/assets\/img\//],
  ];
  for (const [label, pattern] of cases) {
    const hit = pattern.exec(index);
    check(label, !hit, hit ? `(gefunden: ${JSON.stringify(hit[0])})` : '');
  }

  console.log('\n2) Platzhalter statt erfundener Angaben');
  const raw = read('index.html');
  check('Preisliste hat eine graue Ladefläche', /data-services-skeleton/.test(raw));
  check('Öffnungszeiten haben eine graue Ladefläche', /data-hours-skeleton/.test(raw));
  check('Team-Abschnitt startet ausgeblendet', /data-team-section hidden/.test(raw));
  check('Team-Spur ist leer', /data-team-track[^>]*\n?\s*(?:class="[^"]*"\s*)?><\/div>|data-team-track[\s\S]{0,220}?><\/div>/.test(raw));
  check('Titelbild wartet auf die Verwaltung', /data-hero-image\s+hidden/.test(raw));
  check('Kontaktfelder sind leer', !/<span data-biz-text="[a-z-]+"\s*>[^<]/.test(raw));

  console.log('\n3) Vorschaubild beim Teilen kommt aus der Verwaltung');
  for (const page of ['index.html', 'galerie.html']) {
    const html = read(page);
    const og = /<meta\s+property="og:image"\s+content="([^"]+)"/.exec(html)
      ?? /content="([^"]+)"[\s\S]{0,40}property="og:image"/.exec(html);
    check(`${page}: og:image zeigt auf /api/media?slot=hero`,
      Boolean(og) && og[1].includes('/api/media?slot=hero'), og ? og[1] : '(kein og:image)');
  }

  console.log('\n4) Buchung und Galerie ohne Beispieldaten');
  for (const page of ['booking.html', 'galerie.html']) {
    const html = read(page);
    check(`${page}: keine Telefonnummer im Quelltext`, !/0681[\s ]*20397906|\+436812039790/.test(body(html)));
    check(`${page}: keine E-Mail-Adresse im Quelltext`, !/[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(body(html)));
  }

  console.log('\n5) Endpunkte liefern, was die Seiten brauchen');
  const business = await fetch(`${BASE}/api/business`).then((r) => r.json());
  check('/api/business nennt die Bilder der Website', business.images !== undefined && 'hero' in business.images,
    JSON.stringify(business.images));
  check('Öffnungszeiten für alle sieben Tage', Array.isArray(business.openingHours) && business.openingHours.length === 7);
  check('Team und Leistungen sind Listen', Array.isArray(business.team) && Array.isArray(business.services));

  const hero = await fetch(`${BASE}/api/media?slot=hero`);
  const heroSet = Boolean(business.images?.hero);
  check(`Titelbild-Adresse antwortet passend (${heroSet ? 'hinterlegt' : 'nicht hinterlegt'})`,
    heroSet ? hero.status === 200 : hero.status === 404, `(${hero.status})`);
  if (heroSet) {
    check('Titelbild wird als Bild ausgeliefert', (hero.headers.get('content-type') || '').startsWith('image/'));
    check('Titelbild-Slot wird nur kurz gecacht',
      !(hero.headers.get('cache-control') || '').includes('immutable'), hero.headers.get('cache-control'));
    const byId = await fetch(BASE + business.images.hero);
    check('Bild-ID darf dauerhaft gecacht werden',
      (byId.headers.get('cache-control') || '').includes('immutable'), byId.headers.get('cache-control'));
  }

  const unknownSlot = await fetch(`${BASE}/api/media?slot=gibtesnicht`);
  check('Unbekannter Slot -> 404', unknownSlot.status === 404, `(${unknownSlot.status})`);

  console.log(`\n  ${pass} bestanden, ${fail} fehlgeschlagen\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
