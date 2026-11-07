// Records the public website. Usage: node site.js <desktop|mobile> <outDir> [baseUrl] [locale]
const path = require('path');
const { makeRecorder, helpers } = require('./lib');

const mode = process.argv[2] || 'desktop';
const outDir = process.argv[3];
const BASE = process.argv[4] || 'http://localhost:4180';
const locale = process.argv[5] || 'en-US';
const mobile = mode === 'mobile';
const lang = locale.startsWith('de') ? 'de' : 'en';

(async () => {
  const rec = await makeRecorder(mobile
    ? { viewport: { width: 360, height: 640 }, dsf: 3, mobile: true, locale }
    : { viewport: { width: 1600, height: 900 }, dsf: 1.2, locale });
  const { page } = rec;
  const h = helpers(page, { mobile });
  const { sleep } = h;

  // Warm-up (fonts, images) before recording.
  await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle'); await sleep(800);
  await page.goto(`${BASE}/galerie`); await page.waitForLoadState('networkidle');
  await page.goto(`${BASE}/`); await page.waitForLoadState('networkidle'); await sleep(1200);

  await rec.start(path.join(outDir, `frames-site-${mode}-${lang}`));
  await sleep(1800);

  // Hero -> team
  if (mobile) {
    await h.click('[data-menu-toggle]', { after: 1300 });
    await h.click('#mobile-menu a[href="#ueber-uns"]', { after: 1200 });
  } else {
    await h.click('header nav a[href="#ueber-uns"]', { after: 1200 });
    await h.scrollToEl('#ueber-uns', { offset: 0, ms: 600 });
  }
  await sleep(1500);
  if (mobile) {
    await h.scrollBy(520, 1600); await sleep(1200);
    await h.scrollToEl('[data-team-controls]', { offset: 380, ms: 1200 });
  }
  for (let i = 0; i < 2; i++) { await h.click('[data-team-next]', { after: 1500 }); }
  if (!mobile) await sleep(500);

  // Prices
  await h.scrollToEl('#preise', { offset: 80, ms: 1800 }); await sleep(1500);
  await h.scrollBy(mobile ? 560 : 420, 2200); await sleep(1000);
  await h.scrollBy(mobile ? 560 : 420, 2200); await sleep(1000);
  if (mobile) { await h.scrollBy(560, 2200); await sleep(900); }

  // Reviews, hours, contact
  await h.scrollToEl('#reviews', { offset: 80, ms: 1800 }); await sleep(1800);
  if (mobile) { await h.scrollBy(500, 1800); await sleep(900); }
  await h.scrollToEl('#oeffnungszeiten', { offset: 80, ms: 1800 }); await sleep(1800);
  if (mobile) { await h.scrollBy(480, 1800); await sleep(1200); }
  await h.scrollToEl('#kontakt', { offset: 80, ms: 1800 }); await sleep(1800);
  await h.scrollBy(mobile ? 1500 : 900, 3000); await sleep(1200);

  // Gallery
  if (mobile) {
    await h.smoothScrollTo(0, 1500);
    await h.click('[data-menu-toggle]', { after: 1100 });
    await h.click('#mobile-menu a[href="/galerie.html"]', { after: 400 });
  } else {
    await h.smoothScrollTo(0, 1800);
    await h.click('header nav a[href="/galerie.html"]', { after: 400 });
  }
  await page.waitForLoadState('networkidle'); await sleep(1500);
  await h.scrollToEl('[data-gallery]', { offset: mobile ? 90 : 120, ms: 1400 }); await sleep(1000);
  await h.click('[data-lightbox-open]', { after: 1600 });
  await h.click('[data-lightbox-next]', { after: 1500 });
  await h.click('[data-lightbox-next]', { after: 1500 });
  await h.click('[data-lightbox-close]', { after: 1000 });

  // Booking flow
  await h.smoothScrollTo(0, 1000);
  if (mobile) {
    await h.click('[data-menu-toggle]', { after: 1100 });
    await h.click('#mobile-menu a[href="/booking.html"]', { after: 400 });
  } else {
    await h.click('header nav a[href="/booking.html"]', { after: 400 });
  }
  await page.waitForLoadState('networkidle'); await sleep(1500);
  await h.click('[data-service-id] >> nth=1', { after: 1500 });
  if (await page.locator('[data-employee-id]').first().isVisible().catch(() => false)) {
    await h.click('[data-employee-id] >> nth=0', { after: 1500 });
  }
  // Pick tomorrow (or the next day with free slots).
  await page.waitForSelector('[data-slots]:not([hidden]), [data-slots-empty]:not([hidden])');
  for (let tries = 0; tries < 6; tries++) {
    const has = await page.locator('[data-slot]').count();
    if (has > 3) break;
    await page.evaluate(() => {
      const input = document.querySelector('[data-date]');
      const d = new Date(`${input.value}T12:00:00`); d.setDate(d.getDate() + 1);
      input.value = d.toISOString().slice(0, 10);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(900);
  }
  await sleep(800);
  if (mobile) await h.scrollToEl('[data-slots]', { offset: 160, ms: 900 });
  const slots = page.locator('[data-slot]');
  await h.click(slots.nth(Math.min(4, (await slots.count()) - 1)), { after: 1100 });
  await h.click('[data-next-3]', { after: 1500 });
  await h.type('#customer-name', 'Daniel Hofer');
  await h.type('#customer-phone', '+43 660 555 0142');
  await h.type('#customer-email', 'daniel.hofer@example.com');
  if (mobile) await h.scrollToEl('[data-summary]', { offset: 200, ms: 1200 });
  else await h.scrollBy(260, 1000);
  await sleep(1500);
  await h.click('[data-submit]', { after: 2500 });
  await sleep(1500);

  // Language switch demo (desktop): back home, switch DE <-> EN
  await h.click('[data-step="5"] a[href="/"]', { after: 400 });
  await page.waitForLoadState('networkidle'); await sleep(1500);
  const other = lang === 'en' ? 'de' : 'en';
  const sw = mobile ? '[data-lang-switch].lg\\:hidden button[data-lang="' + other + '"]' : 'header nav [data-lang-switch] button[data-lang="' + other + '"]';
  await h.click(sw, { after: 400 });
  await page.waitForLoadState('networkidle'); await sleep(2500);
  await h.scrollToEl('#preise', { offset: 80, ms: 1800 }); await sleep(2000);
  await h.smoothScrollTo(0, 1500); await sleep(800);
  const back = mobile ? '[data-lang-switch].lg\\:hidden button[data-lang="' + lang + '"]' : 'header nav [data-lang-switch] button[data-lang="' + lang + '"]';
  await h.click(back, { after: 400 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => { const i = document.querySelector('[data-hero-image]'); return i && !i.hidden && i.complete; }, null, { timeout: 8000 }).catch(() => {});
  await sleep(3000);

  await rec.stop(path.join(outDir, `site-${mode}-${lang}.mp4`));
  await rec.close();
})().catch((e) => { console.error(e); process.exit(1); });
