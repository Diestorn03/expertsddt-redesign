// Home-page probes the shared harness does not cover. Standalone: serves an existing QA build, never builds.
//   node scenarios/home/probe.mjs --probe reduced-hero,focus,net-loader,scroll-during-loader,intro-scroll [--dist out/.dist-reviews] [--out probe-x]
// Output: out/<out>/probe.json + screenshots. Reuses inpage.js (window.__qa) for the loader/reveal probes.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const QA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = resolve(QA, '..', '..');
const { values: o } = parseArgs({ options: { probe: { type: 'string', default: 'reduced-hero' }, dist: { type: 'string', default: 'out/.dist-default' }, out: { type: 'string', default: 'probe' }, path: { type: 'string', default: '/' } } });
const OUT = join(QA, 'out', o.out);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { desktop: [1440, 900], laptop: [1280, 720], 'tablet-land': [1024, 768], tablet: [768, 1024], phone: [390, 844], 'phone-small': [375, 667] };

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function serve(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--outDir', resolve(QA, dir), '--ignore-lock'], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => child.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(url + '/')).ok) return { url, stop: () => child.kill() }; } catch {} await sleep(200); }
  throw new Error('preview did not start');
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const srv = await serve(o.dist);
const results = {};
async function open(vp, motion, { cpu = 1, net } = {}) {
  const [w, h] = VP[vp] || vp.split('x').map(Number), touch = /tablet|phone/.test(vp);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, reducedMotion: motion });
  await ctx.addInitScript({ path: join(QA, 'inpage.js') });
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net }); }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  return { ctx, page, cdp, w, h, touch, errors, close: () => ctx.close() };
}
const ready = (page, t = 30000) => page.waitForFunction(() => window.__qa && document.readyState === 'complete' && !document.getElementById('loader'), null, { timeout: t, polling: 100 });
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 70 }).catch(() => {});

/* ---- reduced motion: is the portal chapter shown, does the intro animate, are the hero buttons clickable? ---- */
async function reducedHero() {
  const out = {};
  for (const vp of ['desktop', 'laptop', 'tablet-land', 'phone']) {
    const E = await open(vp, 'reduce');
    const { page } = E;
    // sample the hero intro elements every frame from the moment the loader lifts
    await page.addInitScript(() => {
      window.__samples = [];
      document.addEventListener('loader:done', () => {
        const t0 = performance.now(), els = [...document.querySelectorAll('.hero__title .w, .hero__lead, .hero__rise, .hero__cta > *')];
        const tick = () => { const t = performance.now() - t0; window.__samples.push({ t: Math.round(t), v: els.map((e) => { const cs = getComputedStyle(e); return `${(+cs.opacity).toFixed(2)}|${cs.transform}`; }) }); if (t < 3000) requestAnimationFrame(tick); };
        tick();
      }, { once: true });
    });
    await page.goto(srv.url + o.path);
    await ready(page);
    await sleep(2600);
    const s = await page.evaluate(() => {
      const op = (sel) => [...document.querySelectorAll(sel)].map((e) => +getComputedStyle(e).opacity);
      const samples = window.__samples || [];
      const distinct = samples.length ? new Set(samples.map((x) => x.v.join(','))).size : null;
      const centre = (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
      const hits = [...document.querySelectorAll('.hero__cta a, .portal__cta a')].map((a) => { const [x, y] = centre(a); const top = document.elementFromPoint(x, y); return { link: a.textContent.trim().slice(0, 24), inView: y > 0 && y < innerHeight, topIsLink: !!top && (top === a || a.contains(top)), top: top && __qa.sel(top) }; });
      return { portalHead: op('.portal__head'), features: op('.portal__feature'), portalCta: op('.portal__cta'), introFramesSampled: samples.length, introDistinctStates: distinct, firstSample: samples[0]?.v.slice(0, 2), lastSample: samples[samples.length - 1]?.v.slice(0, 2), hits, lenis: document.documentElement.classList.contains('lenis'), hiddenAll: __qa.hiddenAll().slice(0, 12) };
    });
    await shot(page, `reduced-${vp}-top`);
    out[vp] = { ...s, errors: E.errors };
    await E.close();
  }
  return out;
}

/* ---- keyboard focus: Tab through the home and flag focus on invisible / off-screen elements ---- */
async function focus() {
  const out = {};
  for (const [vp, motion] of [['desktop', 'no-preference'], ['laptop', 'no-preference'], ['desktop', 'reduce']]) {
    const E = await open(vp, motion);
    const { page } = E;
    await page.goto(srv.url + o.path);
    await ready(page); await sleep(2200);
    const bad = [];
    let n = 0, shotN = 0;
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      await sleep(motion === 'reduce' ? 120 : 700); // focus scroll + Lenis settle
      const f = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body) return null;
        const r = a.getBoundingClientRect();
        let o = 1; for (let e = a; e; e = e.parentElement) o *= +getComputedStyle(e).opacity;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
        return { el: __qa.sel(a), scene: a.closest('[data-scene], footer, header, .floats')?.id || a.closest('[data-scene], footer, header, .floats')?.className.split(' ')[0], y: Math.round(scrollY), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], opacity: +o.toFixed(2), onScreen: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight, covered: !!top && top !== a && !a.contains(top) ? __qa.sel(top) : null };
      });
      if (!f) continue;
      n++;
      if (f.opacity < 0.5 || !f.onScreen || f.covered) { bad.push({ tab: i + 1, ...f }); if (shotN < 6) await shot(page, `focus-${vp}-${motion}-${++shotN}-tab${i + 1}`); }
      if (/footer/.test(f.scene || '')) break;
    }
    out[`${vp}-${motion}`] = { focused: n, problems: bad };
    await E.close();
  }
  return out;
}

/* ---- loader on a real-ish network: how long the page stays covered, and what delays boot ---- */
const NET = { slow4g: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }, fast4g: { latency: 40, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 } };
async function netLoader() {
  const out = {};
  for (const [vp, net, cpu] of [['phone', 'slow4g', 4], ['phone', 'fast4g', 4], ['desktop', 'fast4g', 1], ['desktop', 'slow4g', 1]]) {
    const E = await open(vp, 'no-preference', { cpu, net: NET[net] });
    const { page } = E;
    const media = [];
    page.on('request', (q) => { if (q.resourceType() === 'media') media.push({ url: q.url().split('/').pop(), at: Date.now() }); });
    const t0 = Date.now();
    await page.goto(srv.url + o.path, { waitUntil: 'commit' });
    await ready(page, 60000).catch(() => {});
    await sleep(500);
    const d = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0], p = (k) => Math.round(performance.getEntriesByName(k)[0]?.startTime ?? -1);
      const at = (t) => __qa.log.find((e) => e.type === t)?.t ?? null;
      const res = performance.getEntriesByType('resource').filter((r) => /\.(mp4|webp|woff2|js|css)$/.test(r.name)).map((r) => ({ f: r.name.split('/').pop().slice(0, 32), start: Math.round(r.startTime), end: Math.round(r.responseEnd), kb: Math.round(r.transferSize / 1024) }));
      return { firstPaint: p('first-paint'), fcp: p('first-contentful-paint'), dcl: Math.round(n.domContentLoadedEventEnd), loadEvent: Math.round(n.loadEventStart), pageLoad: at('astro:page-load'), loaderDone: at('loader:done'), wipeStart: at('loader:start') ?? at('loader:run'), removed: at('loader:removed'), resources: res.sort((a, b) => b.end - a.end).slice(0, 8) };
    });
    d.mediaRequests = media.map((m) => `${m.url} @${m.at - t0}ms`);
    d.coveredMs = d.wipeStart != null && d.firstPaint > 0 ? d.wipeStart - d.firstPaint : null;
    out[`${vp}-${net}-cpu${cpu}`] = d;
    await E.close();
  }
  return out;
}

/* ---- wheel while the loader is still up: is the page consistent when it lifts? ---- */
async function scrollDuringLoader() {
  const out = {};
  for (const vp of ['desktop', 'laptop']) {
    const E = await open(vp, 'no-preference', { cpu: 4 });
    const { page } = E;
    const go = page.goto(srv.url + o.path, { waitUntil: 'commit' });
    await go;
    await page.waitForFunction(() => document.getElementById('loader') && document.querySelector('#hero'), null, { polling: 20 }).catch(() => {});
    await page.mouse.move(E.w / 2, E.h / 2);
    const log = [];
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 120); await sleep(60); log.push(await page.evaluate(() => [Math.round(scrollY), !!document.getElementById('loader'), document.getElementById('loader')?.classList.contains('is-done') || false]).catch(() => null)); }
    await ready(page).catch(() => {});
    await sleep(2500);
    const s = await page.evaluate(() => ({ y: Math.round(scrollY), hero: __qa.hero(), pins: __qa.pins().map((p) => [p.id, p.top, p.spacerH]), hiddenInView: __qa.hiddenInView() }));
    await shot(page, `scroll-during-loader-${vp}`);
    out[vp] = { wheelLog: log, after: s };
    await E.close();
  }
  return out;
}

/* ---- scroll the moment the loader lifts (intro still running): frames of the hero/scrub hand-off ---- */
async function introScroll() {
  const out = {};
  for (const [vp, cpu] of [['desktop', 1], ['desktop', 4], ['laptop', 4]]) {
    const E = await open(vp, 'no-preference', { cpu });
    const { page } = E;
    await page.goto(srv.url + o.path, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__qa && __qa.log.some((e) => e.type === 'loader:done'), null, { timeout: 20000, polling: 20 });
    await page.mouse.move(E.w / 2, E.h / 2);
    const states = [];
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 100); await sleep(80);
      if (i % 3 === 0) { states.push(await page.evaluate(() => ({ y: Math.round(scrollY), hero: __qa.hero() }))); await shot(page, `intro-scroll-${vp}-cpu${cpu}-${i}`); }
    }
    await sleep(1800);
    states.push(await page.evaluate(() => ({ y: Math.round(scrollY), hero: __qa.hero() })));
    await shot(page, `intro-scroll-${vp}-cpu${cpu}-settled`);
    // back to the top: the hero must be exactly the start pose again
    await page.mouse.wheel(0, -3000); await sleep(2000);
    states.push(await page.evaluate(() => ({ y: Math.round(scrollY), hero: __qa.hero() })));
    await shot(page, `intro-scroll-${vp}-cpu${cpu}-back`);
    out[`${vp}-cpu${cpu}`] = states;
    await E.close();
  }
  return out;
}

/* ---- invisible links on top: a 24px grid of hit tests at several scroll positions ---- */
async function ghostClicks() {
  const out = {};
  for (const [vp, motion] of [['desktop', 'no-preference'], ['laptop', 'no-preference'], ['desktop', 'reduce'], ['tablet-land', 'no-preference'], ['phone', 'no-preference']]) {
    const E = await open(vp, motion);
    const { page } = E;
    await page.goto(srv.url + o.path);
    await ready(page); await sleep(2400);
    const ys = await page.evaluate(() => {
      const pins = [...document.querySelectorAll('.pin-spacer')].map((sp) => [sp.getBoundingClientRect().top + scrollY, sp.offsetHeight - sp.firstElementChild.offsetHeight]);
      const out = [0];
      pins.forEach(([top, dist]) => [0.25, 0.5, 0.75, 1].forEach((f) => out.push(Math.round(top + dist * f))));
      const max = document.documentElement.scrollHeight - innerHeight;
      for (let y = innerHeight; y < max; y += innerHeight) out.push(y);
      out.push(max);
      return [...new Set(out)].sort((a, b) => a - b);
    });
    const found = [];
    for (const y of ys) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
      await sleep(motion === 'reduce' ? 300 : 1300);
      const hits = await page.evaluate(() => {
        const res = new Map();
        for (let x = 12; x < innerWidth; x += 24) for (let y = 12; y < innerHeight; y += 24) {
          const e = document.elementFromPoint(x, y), a = e?.closest('a, button, input, [role="button"]');
          if (!a || a.closest('.ba')) continue; // the before/after range is a transparent overlay on purpose
          let o = 1, vis = getComputedStyle(a).visibility;
          for (let p = a; p && p !== document.documentElement; p = p.parentElement) o *= +getComputedStyle(p).opacity;
          if (o < 0.1 || vis === 'hidden') { const k = __qa.sel(a); res.set(k, (res.get(k) || 0) + 1); }
        }
        return [...res].map(([el, n]) => ({ el, areaPx: n * 576 }));
      });
      if (hits.length) { found.push({ y: await page.evaluate(() => Math.round(scrollY)), hits }); if (found.length <= 4) await shot(page, `ghost-${vp}-${motion}-y${y}`); }
    }
    out[`${vp}-${motion}`] = found;
    await E.close();
  }
  return out;
}

/* ---- reduced motion, small screens: every composited frame around the loader removal ---- */
async function reducedFlash() {
  const out = {};
  for (const vp of ['phone', 'tablet']) {
    const E = await open(vp, 'reduce');
    const { page, cdp } = E;
    const frames = [];
    cdp.on('Page.screencastFrame', (f) => { frames.push({ at: Date.now(), data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 400, maxHeight: 900, everyNthFrame: 1 });
    await page.goto(srv.url + o.path);
    await ready(page); await sleep(2500);
    await cdp.send('Page.stopScreencast');
    const t = await page.evaluate(() => ({ done: __qa.log.find((e) => e.type === 'loader:done')?.t, origin: performance.timeOrigin }));
    const doneWall = t.origin + t.done;
    const near = frames.filter((f) => f.at >= doneWall - 150 && f.at <= doneWall + 1600);
    near.forEach((f, i) => writeFileSync(join(OUT, `flash-${vp}-${String(i).padStart(2, '0')}-${Math.round(f.at - doneWall)}ms.jpg`), Buffer.from(f.data, 'base64')));
    out[vp] = { framesSaved: near.length, offsetsMs: near.map((f) => Math.round(f.at - doneWall)) };
    await E.close();
  }
  return out;
}

/* ---- testimonials card stack (PUBLIC_SHOW_REVIEWS=1 build): is every card fully readable at some scroll position? ---- */
async function cardStack() {
  const out = {};
  for (const [vp, motion] of [['desktop', 'no-preference'], ['laptop', 'no-preference'], ['tablet', 'no-preference'], ['phone', 'no-preference'], ['phone-small', 'no-preference'], ['phone-small', 'reduce']]) {
    const E = await open(vp, motion);
    const { page } = E;
    await page.goto(srv.url + o.path);
    await ready(page); await sleep(1500);
    const range = await page.evaluate(() => { const s = document.querySelector('#reviews'); if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.top + scrollY - innerHeight), Math.round(r.bottom + scrollY)]; });
    if (!range) { out[`${vp}-${motion}`] = 'no #reviews section in this build'; await E.close(); continue; }
    const best = {}; let shots = 0;
    for (let y = range[0]; y <= range[1]; y += 40) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
      await sleep(motion === 'reduce' ? 60 : 160);
      const s = await page.evaluate(() => {
        const nav = document.querySelector('.nav').getBoundingClientRect().bottom;
        const cards = [...document.querySelectorAll('.stack-card')];
        return cards.map((c, i) => {
          // share of this card's text lines that are on screen, below the nav and not covered by a later card or a floating button
          const ps = [...c.querySelectorAll('blockquote p, figcaption strong')];
          let seen = 0, total = 0;
          for (const p of ps) for (const r of p.getClientRects()) {
            total++;
            const cx = r.left + Math.min(40, r.width / 2), cy = r.top + r.height / 2;
            if (cy < nav || cy > innerHeight) continue;
            const top = document.elementFromPoint(cx, cy);
            if (top && c.contains(top)) seen++;
          }
          const cs = getComputedStyle(c);
          return { i, seen, total, op: +getComputedStyle(c.querySelector('blockquote')).opacity, scale: +new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform).a.toFixed(3), top: Math.round(c.getBoundingClientRect().top), h: Math.round(c.getBoundingClientRect().height) };
        });
      });
      s.forEach((c) => { const f = c.total ? c.seen / c.total : 0; if (!best[c.i] || f > best[c.i].frac) best[c.i] = { frac: +f.toFixed(2), y, op: c.op, scale: c.scale, h: c.h }; });
      if (shots < 8 && y % 200 === range[0] % 200) { shots++; await shot(page, `stack-${vp}-${motion}-${shots}-y${y}`); }
    }
    out[`${vp}-${motion}`] = { vh: E.h, cards: best };
    await E.close();
  }
  return out;
}

const PROBES = { 'card-stack': cardStack, 'reduced-flash': reducedFlash, 'ghost-clicks': ghostClicks, 'reduced-hero': reducedHero, focus, 'net-loader': netLoader, 'scroll-during-loader': scrollDuringLoader, 'intro-scroll': introScroll };
try {
  for (const name of o.probe.split(',')) {
    const t = Date.now();
    try { results[name] = await PROBES[name](); } catch (e) { results[name] = { crashed: String(e.stack || e).split('\n').slice(0, 3).join(' | ') }; }
    console.log(`${name} ${((Date.now() - t) / 1000).toFixed(0)} s`);
    writeFileSync(join(OUT, 'probe.json'), JSON.stringify(results, null, 1));
  }
} finally { await browser.close(); srv.stop(); }
console.log(`-> ${join(OUT, 'probe.json')}`);
