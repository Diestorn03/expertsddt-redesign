// Focused probes behind the inner-page findings (each one isolates a root cause). Output: out/<name>/probes.json + screenshots.
//   reduced-split   reduced motion, first load: split headings stay hidden; same pages with CSS transitions off (proves the cause)
//   softnav-split   reduced motion, ClientRouter hop /services/ -> /store/: trailing h1 words stay at opacity 0
//   entrance        motion, first load: page-hero h1 entrance vs the moment the loader wipe uncovers it
//   loader-img      which image initLoader waits for (and whether it is lazy / far below the fold)
//   failsafe        loader with JS off / a module chunk failing: does the page ever show?
//   softnav-classes <html> classes after a ClientRouter swap, and the dialog's scroll containment before the first scroll
//   breakpoint      reading an inner page, then crossing 1180 px (window resize / iPad Pro rotation): where does the reader end up?
//   dialog-title    download dialog title vs the x button at common phone widths (EN/ES)
// node scenarios/inner/probes.mjs --out inner-probes [--only reduced-split,entrance]
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url)), QA = join(HERE, '..', '..'), ROOT = join(QA, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'inner-probes' }, only: { type: 'string', default: 'reduced-split,softnav-split,entrance,loader-img,failsafe,softnav-classes,breakpoint,dialog-title' } } });
const ONLY = new Set(o.only.split(','));
const runDir = join(QA, 'out', o.out);
mkdirSync(runDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESK = { viewport: { width: 1440, height: 900 } }, PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const server = spawn(process.execPath, [join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--outDir', join(QA, 'out', '.dist-default'), '--ignore-lock'], { cwd: ROOT, stdio: 'ignore' });
process.on('exit', () => server.kill());
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; i < 150; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await sleep(200); }
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const out = {};
const shot = async (page, name) => { const f = join(runDir, `${name}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 70 }); return relative(runDir, f).replace(/\\/g, '/'); };
const ready = (page) => page.waitForFunction(() => document.readyState === 'complete' && !document.getElementById('loader'), null, { timeout: 20000 });
// hidden parts of every [data-split] heading: opacity < .05 or pushed down more than half its height (masked)
const splitState = (page) => page.evaluate(() => [...document.querySelectorAll('[data-split]')].map((el) => {
  const parts = [...el.querySelectorAll('.split-char')].length ? [...el.querySelectorAll('.split-char')] : [...el.querySelectorAll('.split-word')].length ? [...el.querySelectorAll('.split-word')] : [...el.querySelectorAll('.split-line')];
  const hidden = parts.filter((x) => { const cs = getComputedStyle(x), m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform); return +cs.opacity < 0.05 || Math.abs(m.m42) > x.offsetHeight * 0.5; }).length;
  return { el: `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 32)}"`, hidden, of: parts.length };
}));
const noTransitions = () => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important}'; document.head.appendChild(s); });

try {
  if (ONLY.has('reduced-split')) {
    out['reduced-split'] = [];
    for (const [dev, opts] of [['desktop', DESK], ['phone', PHONE]]) for (const variant of ['site CSS', 'transitions off']) for (const path of ['/services/', '/courses/', '/store/', '/contact/']) {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
      if (variant === 'transitions off') await ctx.addInitScript(noTransitions);
      const page = await ctx.newPage();
      await page.goto(BASE + path); await ready(page); await sleep(1500);
      const top = await splitState(page);
      const topShot = variant === 'site CSS' ? await shot(page, `reduced-${dev}${path.replace(/\//g, '_')}top`) : null;
      for (let y = 0; y < 12000; y += 400) { await page.evaluate((y) => scrollTo(0, y), y); await sleep(160); }
      await sleep(2200);
      const after = await splitState(page);
      out['reduced-split'].push({ dev, variant, path, topShot, hiddenAtTop: top.filter((s) => s.hidden).map((s) => `${s.el} ${s.hidden}/${s.of}`), hiddenAfterScrollingThrough: after.filter((s) => s.hidden).map((s) => `${s.el} ${s.hidden}/${s.of}`) });
      console.log('reduced-split', dev, variant.padEnd(15), path.padEnd(11), 'top:', top.filter((s) => s.hidden).length, 'after scroll:', after.filter((s) => s.hidden).length);
      await ctx.close();
    }
  }

  if (ONLY.has('softnav-split')) {
    out['softnav-split'] = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ ...DESK, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/services/'); await ready(page); await sleep(1200);
      await page.click('.nav__links a[href="/store/"]');
      await sleep(3000);
      const s = await splitState(page);
      const h1 = s.find((x) => x.el.startsWith('h1'));
      out['softnav-split'].push({ run: i + 1, h1, shot: i === 0 ? await shot(page, 'softnav-reduced-store-h1') : null });
      console.log('softnav-split run', i + 1, JSON.stringify(h1));
      await ctx.close();
    }
  }

  if (ONLY.has('entrance')) {
    out.entrance = [];
    for (const [dev, opts] of [['desktop', DESK], ['phone', PHONE]]) for (const path of ['/services/', '/courses/', '/store/', '/contact/', '/terms-and-conditions/']) {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => {
        const L = (window.__L = []);
        const f = () => {
          const ld = document.getElementById('loader'), h = document.querySelector('main h1');
          if (h) {
            const ws = [...h.querySelectorAll('.split-word')].map((w) => +getComputedStyle(w).opacity);
            const cp = ld ? getComputedStyle(ld).clipPath : null, m = cp && /inset\(0px 0px ([\d.]+)%/.exec(cp);
            const covered = ld ? (m ? 1 - m[1] / 100 : 1) : 0; // share of the viewport, from the top, still under the loader
            const r = h.getBoundingClientRect();
            L.push({ t: Math.round(performance.now()), covered, top: r.top / innerHeight, bottom: r.bottom / innerHeight, avg: ws.length ? ws.reduce((a, c) => a + c, 0) / ws.length : null, last: ws.length ? ws[ws.length - 1] : null });
          }
          if (performance.now() < 6000) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      const page = await ctx.newPage();
      await page.goto(BASE + '/robots.txt');
      await page.goto(BASE + path); await sleep(5000);
      const L = await page.evaluate(() => window.__L);
      const starts = L.find((x) => x.avg != null && x.avg < 0.99), done = L.find((x) => x.avg >= 0.99 && x.last >= 0.99 && x.t > (starts?.t ?? 0));
      const firstSeen = L.find((x) => x.covered < x.bottom), fully = L.find((x) => x.covered <= x.top);
      const r = { dev, path, wordsAnimateFrom: starts?.t ?? null, coveredThen: starts ? +starts.covered.toFixed(2) : null, wordsCompleteAt: done?.t ?? null, h1FirstUncoveredAt: firstSeen?.t ?? null, h1FullyUncoveredAt: fully?.t ?? null, wordsAvgWhenFirstUncovered: firstSeen?.avg != null ? +firstSeen.avg.toFixed(2) : null };
      r.verdict = r.wordsCompleteAt != null && r.h1FirstUncoveredAt != null && r.wordsCompleteAt <= r.h1FirstUncoveredAt ? 'entrance finished behind the loader' : 'entrance partly visible';
      out.entrance.push(r);
      console.log('entrance', dev, path.padEnd(24), JSON.stringify(r));
      await ctx.close();
    }
  }

  if (ONLY.has('loader-img')) {
    out['loader-img'] = [];
    for (const [dev, opts] of [['desktop', DESK], ['phone', PHONE]]) for (const path of ['/services/', '/store/']) {
      const ctx = await browser.newContext({ ...opts, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => document.addEventListener('loader:done', () => { window.__done = Math.round(performance.now()); }));
      const page = await ctx.newPage();
      await page.goto(BASE + '/robots.txt');
      await page.goto(BASE + path); await ready(page);
      const r = await page.evaluate(() => { const i = document.querySelector('.hero__laptop img') || [...document.querySelectorAll('main img')].find((x) => x.loading !== 'lazy' && x.getBoundingClientRect().top < innerHeight); if (!i) return { img: null, note: 'no eager first-viewport image: the loader waits for fonts only', loaderDoneAt: window.__done }; return { img: i.getAttribute('src'), loading: i.getAttribute('loading'), docTop: Math.round(i.getBoundingClientRect().top + scrollY), viewport: innerHeight, completeNow: i.complete, loaderDoneAt: window.__done, jsStart: Math.round(window.__t0) }; });
      out['loader-img'].push({ dev, path, ...r });
      console.log('loader-img', dev, path, JSON.stringify(r));
      await ctx.close();
    }
  }

  if (ONLY.has('failsafe')) {
    out.failsafe = [];
    for (const [label, opts, block] of [['js-disabled', { javaScriptEnabled: false }, null], ['ClientRouter chunk fails', {}, /ClientRouter\.astro_astro_type_script/], ['motion chunk fails', {}, /Base\.astro_astro_type_script/]]) {
      const ctx = await browser.newContext({ ...DESK, reducedMotion: 'no-preference', ...opts });
      const page = await ctx.newPage();
      if (block) await page.route(block, (r) => r.abort());
      await page.goto(BASE + '/contact/'); await sleep(8000);
      // the CSS fail-safe fades the node (opacity/visibility), noscript hides it: "present" alone does not mean it covers the page
      const s = await page.evaluate(() => { const l = document.getElementById('loader'), cs = l && getComputedStyle(l); return { loaderPresent: !!l, isDone: l?.classList.contains('is-done') ?? null, clip: cs ? cs.clipPath : null, covering: !!cs && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 }; });
      out.failsafe.push({ label, after: '8 s', ...s, shot: await shot(page, `failsafe-${label.replace(/\W+/g, '-')}`) });
      console.log('failsafe', label, JSON.stringify(s));
      await ctx.close();
    }
  }

  if (ONLY.has('softnav-classes')) {
    const ctx = await browser.newContext({ ...DESK, reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    const st = () => page.evaluate(() => { const d = document.getElementById('lib-dialog'); return { y: Math.round(scrollY), html: document.documentElement.className, dialogOverscroll: d ? getComputedStyle(d).overscrollBehaviorY : null }; });
    await page.goto(BASE + '/services/'); await ready(page); await sleep(1200);
    const fresh = await st();
    await page.click('.nav__links a[href="/exocad-libraries/"]'); await sleep(1800);
    const afterSwap = await st();
    await page.click('[data-lib-open]'); await sleep(400);
    const r = await page.evaluate(() => document.getElementById('lib-dialog').getBoundingClientRect().toJSON());
    await page.mouse.move(r.x + r.width / 2, r.y + 90);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await sleep(80); }
    await sleep(800);
    const afterWheel = await st();
    out['softnav-classes'] = { fresh, afterSwap, wheelOverOpenDialog: afterWheel, shot: await shot(page, 'softnav-dialog-wheel') };
    console.log('softnav-classes', JSON.stringify(out['softnav-classes']));
    await ctx.close();
  }

  if (ONLY.has('breakpoint')) {
    out.breakpoint = [];
    for (const [label, a, b, touch] of [['window resize 1440x900 -> 1100x900', [1440, 900], [1100, 900], false], ['iPad Pro rotation 1366x1024 -> 1024x1366', [1366, 1024], [1024, 1366], true]]) for (const path of ['/terms-and-conditions/', '/services/']) {
      const ctx = await browser.newContext({ viewport: { width: a[0], height: a[1] }, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, reducedMotion: 'no-preference' });
      const page = await ctx.newPage();
      await page.goto(BASE + path); await ready(page); await sleep(1200);
      if (touch) {
        const cdp = await ctx.newCDPSession(page);
        for (let i = 0; i < 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 900 }] }); for (let k = 1; k <= 8; k++) { await sleep(25); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300, y: 900 - k * 70 }] }); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); }
      } else { await page.mouse.move(8, 400); for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 120); await sleep(60); } }
      await sleep(1500);
      const before = await page.evaluate(() => Math.round(scrollY));
      await page.setViewportSize({ width: b[0], height: b[1] }); await sleep(1500);
      const after = await page.evaluate(() => Math.round(scrollY));
      out.breakpoint.push({ label, path, yBefore: before, yAfter: after, shot: await shot(page, `breakpoint-${touch ? 'ipad' : 'window'}${path.replace(/\//g, '_')}after`) });
      console.log('breakpoint', label, path, before, '->', after);
      await ctx.close();
    }
  }

  if (ONLY.has('dialog-title')) {
    out['dialog-title'] = [];
    for (const lang of ['', '/es']) for (const w of [360, 375, 390, 414]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${lang}/exocad-libraries/`); await ready(page);
      await page.evaluate(() => document.getElementById('lib-dialog').showModal()); await sleep(200);
      const r = await page.evaluate(() => {
        const h = document.getElementById('lib-title'), x = document.querySelector('.lib-close').getBoundingClientRect(), rg = document.createRange();
        rg.selectNodeContents(h);
        const rs = [...rg.getClientRects()];
        return { title: h.textContent, textRight: Math.round(Math.max(...rs.map((t) => t.right))), closeBox: [Math.round(x.left), Math.round(x.right)], closeGlyphCentre: Math.round(x.left + x.width / 2) };
      });
      r.overlapsGlyph = r.textRight > r.closeGlyphCentre - 8;
      out['dialog-title'].push({ lang: lang || '/en', width: w, ...r, shot: r.overlapsGlyph ? await shot(page, `dialog-title${lang.replace('/', '-')}-${w}`) : null });
      console.log('dialog-title', lang || '/en', w, JSON.stringify(r));
      await ctx.close();
    }
  }
} finally {
  // verdict per root cause (exit 1 on any FAIL, so the pre-deploy run gates on these probes too)
  const F = (cond, msg) => { if (cond) (out.fails ??= []).push(msg); };
  (out['reduced-split'] || []).filter((r) => r.variant === 'site CSS').forEach((r) => F(r.hiddenAtTop.length || r.hiddenAfterScrollingThrough.length, `reduced-split ${r.dev} ${r.path}: hidden split parts ${[...r.hiddenAtTop, ...r.hiddenAfterScrollingThrough].join(', ')}`));
  (out['softnav-split'] || []).forEach((r) => F(r.h1?.hidden, `softnav-split run ${r.run}: ${r.h1?.el} ${r.h1?.hidden}/${r.h1?.of} hidden`));
  (out.entrance || []).forEach((r) => F(r.verdict === 'entrance finished behind the loader', `entrance ${r.dev} ${r.path}: ${r.verdict}`));
  (out['loader-img'] || []).forEach((r) => F(r.loading === 'lazy' || r.loaderDoneAt >= 1950, `loader-img ${r.dev} ${r.path}: waits for ${r.img} (${r.loading || 'eager'}), done at ${r.loaderDoneAt} ms`));
  (out.failsafe || []).forEach((r) => F(r.covering, `failsafe ${r.label}: the loader still covers the page after ${r.after}`));
  const sc = out['softnav-classes'];
  if (sc) F(!/\bjs\b/.test(sc.afterSwap.html) || !/\blenis\b/.test(sc.afterSwap.html) || sc.wheelOverOpenDialog.y !== sc.afterSwap.y, `softnav-classes: html "${sc.afterSwap.html}" after the swap, wheel over the open dialog y ${sc.afterSwap.y} -> ${sc.wheelOverOpenDialog.y}`);
  (out.breakpoint || []).forEach((r) => F(r.yBefore > 400 && r.yAfter < 100, `breakpoint ${r.label} ${r.path}: y ${r.yBefore} -> ${r.yAfter} (thrown to the top)`));
  (out['dialog-title'] || []).forEach((r) => F(r.overlapsGlyph, `dialog-title ${r.lang} ${r.width}px: title runs into the x`));
  writeFileSync(join(runDir, 'probes.json'), JSON.stringify(out, null, 1));
  console.log(out.fails ? `${out.fails.length} FAIL\n  ${out.fails.join('\n  ')}` : '0 FAIL');
  process.exitCode = out.fails ? 1 : 0;
  await browser.close().catch(() => {});
  server.kill();
}
