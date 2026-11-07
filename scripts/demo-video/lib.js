// Screen recording helpers: CDP screencast -> JPEG frames -> ffmpeg (CFR mp4, H.264).
//
// Slow-motion capture: the headless browser only delivers ~10–15 screencast
// frames per second. Everything on the page (CSS animations/transitions via
// the CDP Animation domain, smooth scrolling, cursor movement, typing, pauses)
// therefore runs SLOW times slower than real time, and the frame timestamps
// are divided by SLOW when the video is assembled. Result: smooth 30 fps.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const SLOW = Number(process.env.SLOW || 3);

const PAGE_JS = `
(() => {
  if (window.__demoRec) return; window.__demoRec = true;
  const K = __K__;
  const touch = __TOUCH__;

  /* ---- slow, controllable smooth scrolling ---- */
  const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const isDoc = (el) => el === window || el === document.documentElement || el === document.body || el === document.scrollingElement;
  function animate(el, left, top, dur) {
    const node = isDoc(el) ? document.scrollingElement : el;
    const fromL = node.scrollLeft, fromT = node.scrollTop;
    const toL = left == null ? fromL : left, toT = top == null ? fromT : top;
    const snap = node.style.scrollSnapType;
    node.style.scrollSnapType = 'none';
    const t0 = performance.now();
    const total = dur * K;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / total);
      const e = ease(p);
      node.scrollLeft = fromL + (toL - fromL) * e;
      node.scrollTop = fromT + (toT - fromT) * e;
      if (p < 1) requestAnimationFrame(step);
      else { node.style.scrollSnapType = snap; node.dispatchEvent(new Event('scroll')); }
    };
    requestAnimationFrame(step);
  }
  const wrap = (proto, name, toAbs) => {
    const orig = proto[name];
    proto[name] = function (a, b) {
      if (a && typeof a === 'object' && a.behavior === 'smooth') {
        const [l, t] = toAbs(this, a);
        return animate(this, l, t, 650);
      }
      return orig.call(this, a, b);
    };
  };
  const absTo = (el, o) => [o.left, o.top];
  const absBy = (el, o) => {
    const n = isDoc(el) ? document.scrollingElement : el;
    return [o.left == null ? null : n.scrollLeft + o.left, o.top == null ? null : n.scrollTop + o.top];
  };
  wrap(window, 'scrollTo', absTo); wrap(window, 'scroll', absTo); wrap(window, 'scrollBy', absBy);
  wrap(Element.prototype, 'scrollTo', absTo); wrap(Element.prototype, 'scroll', absTo); wrap(Element.prototype, 'scrollBy', absBy);
  const origSIV = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (o) {
    if (o && typeof o === 'object' && o.behavior === 'smooth') {
      const margin = parseFloat(getComputedStyle(this).scrollMarginTop) || 0;
      return animate(window, null, this.getBoundingClientRect().top + scrollY - margin, 650);
    }
    return origSIV.call(this, o);
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a || e.defaultPrevented) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    history.replaceState(null, '', url.hash);
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 0);
  }, false);

  /* ---- CSS transitions/animations SLOW times slower (Web Animations API) ---- */
  const slowAll = () => { try { document.getAnimations().forEach((an) => { if (an.playbackRate === 1) an.playbackRate = 1 / K; }); } catch {} };
  ['transitionrun', 'transitionstart', 'animationstart'].forEach((ev) => document.addEventListener(ev, slowAll, true));

  /* ---- cursor + tap ripple ---- */
  const add = () => {
    const st = document.createElement('style');
    st.textContent = \`
      html{scroll-behavior:auto!important}
      #__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px)}
      #__cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
      .__rip{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;
        width:44px;height:44px;margin:-22px 0 0 -22px;background:rgba(212,175,55,.45);
        border:2px solid rgba(255,255,255,.85);animation:__rip .55s ease-out forwards}
      @keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}\`;
    document.documentElement.appendChild(st);
    if (!touch) {
      const c = document.createElement('div'); c.id = '__cur';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L10 21z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      let last = null; try { last = JSON.parse(sessionStorage.getItem('__curpos') || 'null'); } catch {}
      if (last) c.style.transform = 'translate(' + last[0] + 'px,' + last[1] + 'px)';
      addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
        try { sessionStorage.setItem('__curpos', JSON.stringify([e.clientX, e.clientY])); } catch {} }, true);
    }
    addEventListener('pointerdown', (e) => { const r = document.createElement('div'); r.className = '__rip';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700 * K); }, true);
  };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
})();`;

async function makeRecorder({ viewport, dsf, mobile, locale = 'en-US', storage }) {
  const browser = await chromium.launch({ args: ['--hide-scrollbars', '--font-render-hinting=none'] });
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: dsf, isMobile: !!mobile, hasTouch: !!mobile, locale,
    timezoneId: 'Europe/Vienna', colorScheme: 'dark', reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(PAGE_JS.replace('__K__', String(SLOW)).replace('__TOUCH__', mobile ? 'true' : 'false'));
  if (storage) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) try { localStorage.setItem(k, v); } catch {} }, storage);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[mock]')) console.log('console:', m.text()); });

  const cdp = await ctx.newCDPSession(page);

  let frames = [];
  let dir = null;
  let t0 = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    if (!dir) return;
    const file = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });

  return {
    page, ctx, browser, SLOW,
    async start(workdir) {
      dir = workdir; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      frames = [];
      t0 = Date.now() / 1000;
      await cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: 92,
        maxWidth: Math.round(viewport.width * dsf), maxHeight: Math.round(viewport.height * dsf), everyNthFrame: 1,
      });
    },
    async stop(outFile, { fps = 30 } = {}) {
      await page.waitForTimeout(400 * SLOW);
      await cdp.send('Page.stopScreencast').catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      const end = Date.now() / 1000;
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : end;
        lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, (next - frames[i].t) / SLOW).toFixed(5)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(dir, 'list.txt');
      fs.writeFileSync(list, lines.join('\n'));
      const W = Math.round(viewport.width * dsf / 2) * 2;
      const H = Math.round(viewport.height * dsf / 2) * 2;
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `scale=${W}:${H}:flags=lanczos,fps=${fps},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', outFile]);
      const real = end - frames[0].t;
      console.log('saved', outFile, frames.length, 'frames,', (frames.length / (real / SLOW)).toFixed(1), 'fps effective');
    },
    async close() { await browser.close(); },
  };
}

/* ---------- interaction helpers (all timings in output-video milliseconds) ---------- */
function helpers(page, { mobile }) {
  const sleep = (ms) => page.waitForTimeout(ms * SLOW);
  let mouse = { x: 200, y: 200 };

  async function smoothScrollTo(y, ms = 1600) {
    await page.evaluate(async ([target, dur]) => {
      const el = document.scrollingElement;
      const from = el.scrollTop;
      const to = Math.max(0, Math.min(typeof target === 'number' ? target : 0, el.scrollHeight - innerHeight));
      const t0 = performance.now();
      await new Promise((res) => {
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          el.scrollTop = from + (to - from) * e;
          if (p < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    }, [y, ms * SLOW]);
  }
  async function scrollToEl(selector, { offset = 90, ms = 1600 } = {}) {
    const y = await page.evaluate(([s, o]) => {
      const el = document.querySelector(s); if (!el) return null;
      return el.getBoundingClientRect().top + scrollY - o;
    }, [selector, offset]);
    if (y == null) { console.log('scroll: missing', selector); return; }
    await smoothScrollTo(y, ms);
  }
  async function scrollBy(dy, ms = 1200) {
    const y = await page.evaluate(() => scrollY);
    await smoothScrollTo(y + dy, ms);
  }
  async function moveTo(locator) {
    const visible = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 70 && r.bottom <= innerHeight - 10;
    }).catch(() => false);
    if (!visible) {
      const y = await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top + scrollY - innerHeight / 2 + r.height / 2;
      });
      const inDialog = await locator.evaluate((el) => !!el.closest('dialog'));
      if (inDialog) await locator.scrollIntoViewIfNeeded(); else await smoothScrollTo(y, 700);
      await sleep(150);
    }
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (!mobile) {
      const dist = Math.hypot(x - mouse.x, y - mouse.y);
      const dur = Math.max(250, Math.min(900, dist * 0.9)); // output ms
      const steps = Math.max(10, Math.round(dur / 16));
      for (let i = 1; i <= steps; i++) {
        const p = i / steps, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        await page.mouse.move(mouse.x + (x - mouse.x) * e, mouse.y + (y - mouse.y) * e);
        await page.waitForTimeout((dur / steps) * SLOW);
      }
    }
    mouse = { x, y };
    return { x, y };
  }
  async function click(target, { pause = 300, after = 700 } = {}) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const { x, y } = await moveTo(loc);
    await sleep(pause);
    if (mobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await sleep(after);
  }
  async function type(target, text, { delay = 70 } = {}) {
    await click(target, { after: 250 });
    await page.keyboard.type(text, { delay: delay * SLOW });
    await sleep(300);
  }
  return { sleep, smoothScrollTo, scrollToEl, scrollBy, click, type, moveTo };
}

module.exports = { makeRecorder, helpers, SLOW };
