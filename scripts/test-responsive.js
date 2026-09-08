/* Prüft alle Seiten auf horizontales Überlaufen bei den Breiten aus info.md §28.
   Nutzt nur die ausgelieferte HTML/CSS-Struktur, kein Headless-Browser: gemessen
   wird, ob Inhalte breiter als der Container erzwungen werden (feste px-Breiten). */
import fs from 'node:fs';
import path from 'node:path';

const PAGES = ['index.html', 'preise.html', 'galerie.html', 'kontakt.html', 'booking.html'];
let issues = 0;

// Feste Pixelbreiten sind die häufigste Overflow-Ursache. max-w-[...] ist davon
// ausgenommen: eine Maximalbreite schrumpft mit und erzwingt nie Überlauf.
const FIXED_WIDTH = /(?<!max-)\b(?:w|min-w)-\[(\d+)px\]/g;

for (const page of PAGES) {
  const html = fs.readFileSync(path.resolve('public', page), 'utf8');
  const found = [];
  let m;
  while ((m = FIXED_WIDTH.exec(html))) {
    if (Number(m[1]) > 320) found.push(m[0]);
  }
  const noViewport = !/name="viewport"[^>]*width=device-width/.test(html);
  const zoomBlocked = /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(html);

  const problems = [
    found.length ? `feste Breiten > 320px: ${[...new Set(found)].join(', ')}` : null,
    noViewport ? 'viewport-Meta fehlt' : null,
    zoomBlocked ? 'Zoom deaktiviert' : null,
  ].filter(Boolean);

  if (problems.length) { issues += 1; console.log(`  ❌ ${page}: ${problems.join(' | ')}`); }
  else console.log(`  ✅ ${page}`);
}

console.log(issues ? `\n  ${issues} Seite(n) mit Befund\n` : '\n  Keine festen Breiten, Viewport überall gesetzt, Zoom nirgends blockiert\n');
process.exit(issues ? 1 : 0);
