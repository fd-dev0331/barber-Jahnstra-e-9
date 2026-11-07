// Records the admin panel with personal data blurred.
// Usage: node admin.js <desktop|mobile> <outDir> [baseUrl] [lang]
const path = require('path');
const fs = require('fs');
const { makeRecorder, helpers } = require('./lib');

const mode = process.argv[2] || 'desktop';
const outDir = process.argv[3];
const BASE = process.argv[4] || 'http://localhost:4180';
const lang = process.argv[5] || 'en';
const mobile = mode === 'mobile';

// Names of the demo customers + owner (from public/demo/mock-api.js seed).
const mock = fs.readFileSync('/home/fdtech/workspace/projects/bregenz-barber/public/demo/mock-api.js', 'utf8');
const names = [...mock.matchAll(/'([A-ZÄÖÜ][\wäöüß]+ [A-ZÄÖÜ][\wäöüß]+)'/g)].map((m) => m[1]);
const SENSITIVE = [...new Set([...names, 'Alex Berger', 'Daniel Hofer'])]
  .filter((n) => !['Murat Kaya', 'Elias Brunner', 'Jonas Weber', 'Sami Haddad', 'Bregenz Barbershop'].includes(n));

const BLUR_JS = (list) => `
(() => {
  const NAMES = ${JSON.stringify(list)};
  const RE = new RegExp('(' + NAMES.map(n => n.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('|')
    + '|\\\\+43[\\\\d ]{6,}\\\\d|[\\\\w.+-]+@[\\\\w-]+\\\\.[\\\\w.]+)', 'g');
  const css = document.createElement('style');
  css.textContent = '.__pii{filter:blur(5px);user-select:none}'
    + ' input.__pii-in,textarea.__pii-in{color:transparent!important;text-shadow:0 0 9px rgba(255,255,255,.85)!important}';
  const scan = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (w.nextNode()) {
      const n = w.currentNode;
      if (n.parentElement && (n.parentElement.closest('.__pii,script,style'))) continue;
      RE.lastIndex = 0;
      if (RE.test(n.nodeValue)) hits.push(n);
    }
    for (const n of hits) {
      const frag = document.createDocumentFragment();
      let last = 0; const s = n.nodeValue; RE.lastIndex = 0; let m;
      while ((m = RE.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const sp = document.createElement('span'); sp.className = '__pii'; sp.textContent = m[0];
        frag.appendChild(sp); last = m.index + m[0].length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
    document.querySelectorAll('input,textarea').forEach((el) => {
      RE.lastIndex = 0;
      const t = el.type;
      const pii = (el.value && RE.test(el.value)) || t === 'email' || t === 'tel' || /^(n-name|n-phone|n-email|u-name|u-email)$/.test(el.id);
      el.classList.toggle('__pii-in', !!(pii && el.value));
    });
  };
  const start = () => {
    document.head.appendChild(css);
    scan(document.body);
    new MutationObserver(() => scan(document.body)).observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('input', () => scan(document.body), true);
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();`;

(async () => {
  const rec = await makeRecorder(mobile
    ? { viewport: { width: 360, height: 640 }, dsf: 3, mobile: true, locale: lang === 'de' ? 'de-AT' : 'en-US', storage: { admin_language: lang } }
    : { viewport: { width: 1600, height: 900 }, dsf: 1.2, locale: lang === 'de' ? 'de-AT' : 'en-US', storage: { admin_language: lang } });
  const { page, ctx } = rec;
  await ctx.addInitScript(BLUR_JS(SENSITIVE));
  const h = helpers(page, { mobile });
  const { sleep } = h;

  async function nav(href) {
    if (mobile) {
      await h.smoothScrollTo(0, 500);
      await h.click('[data-menu-open]', { after: 1000 });
      await h.click(`dialog[open] a.adm-nav-link[href="${href}"], #adm-menu a.adm-nav-link[href="${href}"]`, { after: 300 });
    } else {
      await h.click(`[data-app-sidebar] a.adm-nav-link[href="${href}"]`, { after: 300 });
    }
    await page.waitForLoadState('networkidle'); await sleep(1500);
  }
  const closeDialog = () => h.click('dialog[open] [data-close]', { after: 900 });

  // Warm-up
  for (const p of ['/admin', '/admin/calendar', '/admin/employees', '/admin']) {
    await page.goto(BASE + p); await page.waitForLoadState('networkidle');
  }
  await sleep(1200);

  await rec.start(path.join(outDir, `frames-admin-${mode}-${lang}`));
  await sleep(2000);

  // Dashboard
  await h.scrollBy(mobile ? 900 : 450, 2200); await sleep(1000);
  if (mobile) { await h.scrollBy(900, 2200); await sleep(800); }
  await h.smoothScrollTo(0, 1400); await sleep(600);

  // Calendar
  await nav('/admin/calendar');
  if (await page.locator('[data-mode="week"]').isVisible()) { await h.click('[data-mode="week"]', { after: 1800 }); }
  await h.scrollBy(mobile ? 700 : 350, 1800); await sleep(900);
  await h.click('[data-next]', { after: 1600 });
  await h.click('[data-today]', { after: 1400 });
  if (await page.locator('[data-mode="day"]').isVisible()) { await h.click('[data-mode="day"]', { after: 1800 }); }
  await h.scrollBy(mobile ? 700 : 350, 1800); await sleep(900);

  // Bookings
  await nav('/admin/bookings');
  await h.click('[data-view="today"]', { after: 1500 });
  await h.click('[data-detail]:visible >> nth=1', { after: 2200 });
  await page.evaluate(() => document.querySelector('dialog[open]')?.scrollBy({ top: 300, behavior: 'smooth' }));
  await sleep(1500);
  await closeDialog();
  await h.click('[data-view="upcoming"]', { after: 1300 });
  await h.click('[data-new]', { after: 1800 });
  await sleep(800);
  await closeDialog();

  // Services
  await nav('/admin/services');
  await h.scrollBy(mobile ? 600 : 250, 1500); await sleep(600);
  await h.click('[data-edit]:visible >> nth=0', { after: 1600 });
  await sleep(1200);
  await closeDialog();

  // Staff
  await nav('/admin/employees');
  await h.click('[data-edit]:visible >> nth=1', { after: 1800 });
  await page.evaluate(() => { const d = document.querySelector('dialog[open]'); d && d.querySelector('form, .adm-dialog-body, div')?.scrollBy?.({ top: 500, behavior: 'smooth' }); d?.scrollBy({ top: 500, behavior: 'smooth' }); });
  await sleep(1800);
  await page.evaluate(() => { const d = document.querySelector('dialog[open]'); d?.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 40) el.scrollBy({ top: 600, behavior: 'smooth' }); }); });
  await sleep(1800);
  await closeDialog();

  // Gallery
  await nav('/admin/gallery');
  await h.scrollBy(mobile ? 700 : 300, 1600); await sleep(1000);

  // Business
  await nav('/admin/business');
  await h.scrollBy(mobile ? 900 : 450, 2000); await sleep(900);
  await h.scrollBy(mobile ? 900 : 450, 2000); await sleep(900);

  // Google Calendar
  await nav('/admin/google');
  await sleep(800);

  // Settings + language switch
  await nav('/admin/settings');
  await h.scrollBy(mobile ? 600 : 300, 1500); await sleep(800);
  const other = lang === 'de' ? 'en' : 'de';
  await h.smoothScrollTo(0, 800);
  await h.click('[data-lang-toggle]', { after: 900 });
  await h.click(`.adm-lang-menu:not([hidden]) [data-lang-option="${other}"]`, { after: 1800 });
  await h.click('[data-lang-toggle]', { after: 900 });
  await h.click(`.adm-lang-menu:not([hidden]) [data-lang-option="${lang}"]`, { after: 1500 });
  await nav('/admin');
  await sleep(1000);

  await rec.stop(path.join(outDir, `admin-${mode}-${lang}.mp4`));
  await rec.close();
})().catch((e) => { console.error(e); process.exit(1); });
