// Screen recording helpers: CDP screencast -> JPEG frames -> ffmpeg (CFR mp4, H.264).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CURSOR_JS = `
(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const touch = ${'__TOUCH__'};
  const add = () => {
    const st = document.createElement('style');
    st.textContent = \`
      #__cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);transition:transform .02s linear}
      #__cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
      .__rip{position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;
        width:44px;height:44px;margin:-22px 0 0 -22px;background:rgba(212,175,55,.45);
        border:2px solid rgba(255,255,255,.85);animation:__rip .55s ease-out forwards}
      @keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}\`;
    document.documentElement.appendChild(st);
    if (!touch) {
      const c = document.createElement('div'); c.id='__cur';
      c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L10 21z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      const last = JSON.parse(sessionStorage.getItem('__curpos') || 'null');
      if (last) c.style.transform = 'translate(' + last[0] + 'px,' + last[1] + 'px)';
      addEventListener('mousemove', e => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
        try { sessionStorage.setItem('__curpos', JSON.stringify([e.clientX, e.clientY])); } catch {} }, true);
    }
    addEventListener('pointerdown', e => { const r = document.createElement('div'); r.className='__rip';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700); }, true);
  };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
})();`;

async function makeRecorder({ viewport, dsf, mobile, locale = 'en-US', storage }) {
  const browser = await chromium.launch({ args: ['--hide-scrollbars', '--font-render-hinting=none'] });
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: dsf, isMobile: !!mobile, hasTouch: !!mobile, locale,
    timezoneId: 'Europe/Vienna', colorScheme: 'dark', reducedMotion: 'no-preference',
  });
  await ctx.addInitScript(CURSOR_JS.replace('__TOUCH__', mobile ? 'true' : 'false'));
  if (storage) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) try { localStorage.setItem(k, v); } catch {} }, storage);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[mock]')) console.log('console:', m.text()); });

  let frames = [];
  let cdp = null;
  let dir = null;
  async function attach() {
    cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', async (f) => {
      const file = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
      frames.push({ file, t: f.metadata.timestamp });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 92,
      maxWidth: Math.round(viewport.width * dsf), maxHeight: Math.round(viewport.height * dsf), everyNthFrame: 1,
    });
  }

  return {
    page, ctx, browser,
    async start(workdir) {
      dir = workdir; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      frames = [];
      await attach();
    },
    async stop(outFile, { fps = 30, tail = 1.0 } = {}) {
      await page.waitForTimeout(300);
      await cdp.send('Page.stopScreencast').catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      const end = Date.now() / 1000;
      const lines = [];
      for (let i = 0; i < frames.length; i++) {
        const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(frames[i].t + tail, end);
        lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, next - frames[i].t).toFixed(4)}`);
      }
      lines.push(`file '${frames[frames.length - 1].file}'`);
      const list = path.join(dir, 'list.txt');
      fs.writeFileSync(list, lines.join('\n'));
      const W = Math.round(viewport.width * dsf / 2) * 2;
      const H = Math.round(viewport.height * dsf / 2) * 2;
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', `scale=${W}:${H}:flags=lanczos,fps=${fps},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', outFile]);
      console.log('saved', outFile, frames.length, 'frames');
    },
    async close() { await browser.close(); },
  };
}

/* ---------- interaction helpers ---------- */
function helpers(page, { mobile }) {
  const sleep = (ms) => page.waitForTimeout(ms);
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
    }, [y, ms]);
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
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('no box');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (!mobile) {
      const dist = Math.hypot(x - mouse.x, y - mouse.y);
      await page.mouse.move(x, y, { steps: Math.max(8, Math.min(40, Math.round(dist / 18))) });
    }
    mouse = { x, y };
    return { x, y };
  }
  async function click(target, { pause = 350, after = 700 } = {}) {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    await loc.waitFor({ state: 'visible', timeout: 10000 });
    const { x, y } = await moveTo(loc);
    await sleep(pause);
    if (mobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await sleep(after);
  }
  async function type(target, text, { delay = 70 } = {}) {
    await click(target, { after: 250 });
    await page.keyboard.type(text, { delay });
    await sleep(300);
  }
  return { sleep, smoothScrollTo, scrollToEl, scrollBy, click, type, moveTo };
}

module.exports = { makeRecorder, helpers };
