// Shared helpers for the cross-cutting scenarios (standalone scripts, the harness in qa.mjs is not imported or changed).
// Serves the existing QA build (out/.dist-default), never builds. Each script writes out/<name>/report.json + screenshots.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const QA = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = join(QA, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VP = { desktop: [1440, 900], laptop: [1280, 720], tablet: [768, 1024], 'tablet-land': [1024, 768], phone: [390, 844] };

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
export async function serve(dir = join(QA, 'out', '.dist-default')) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--outDir', dir, '--ignore-lock'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  process.on('exit', () => child.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150 && child.exitCode == null; i++) {
    try { if ((await fetch(`${url}/`)).ok) return { url, stop: () => child.kill() }; } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error('astro preview did not start');
}
// back/forward cache on, as visitors have it (Playwright turns it off by default)
export const launch = (args = []) => chromium.launch({ executablePath: CHROME, headless: true, args, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
export async function context(browser, vp, motion = 'no-preference') {
  const [w, h] = VP[vp] || vp, touch = /^(tablet|phone)/.test(vp);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, reducedMotion: motion });
  await ctx.addInitScript({ path: join(QA, 'inpage.js') });
  return { ctx, w, h, touch };
}
export function out(name) {
  const dir = join(QA, 'out', name);
  mkdirSync(dir, { recursive: true });
  const R = { name, started: new Date().toISOString(), results: {}, issues: [] };
  const save = () => writeFileSync(join(dir, 'report.json'), JSON.stringify(R, null, 1));
  const issue = (sev, at, msg, extra = {}) => { R.issues.push({ sev, at, msg, ...extra }); console.log(`  ${sev.toUpperCase()} ${at}: ${msg}`); save(); };
  const shot = async (page, file, full = false) => { const p = join(dir, `${file}.jpg`); await page.screenshot({ path: p, type: 'jpeg', quality: 70, scale: 'css', fullPage: full }).catch(() => {}); return p; };
  return { dir, R, save, issue, shot };
}
export async function ready(page, extra = 1600) {
  await page.waitForFunction(() => window.__qa && document.readyState === 'complete' && !document.getElementById('loader'), null, { timeout: 30000, polling: 100 });
  await sleep(extra);
}
export const settle = (page, stable, timeout) => page.evaluate(([s, t]) => __qa.settle(s, t), [stable ?? 8, timeout ?? 5000]);
export const pageLoads = (page) => page.evaluate(() => __qa.log.filter((e) => e.type === 'astro:page-load').length);
export async function afterNav(page, n0, extra = 1800) {
  await page.waitForFunction((n) => __qa.log.filter((e) => e.type === 'astro:page-load').length > n, n0, { timeout: 15000, polling: 50 });
  await sleep(extra);
}
// real input: wheel on desktop, finger swipes on touch
export async function scrollBy(page, env, dy, { step = 100, gap = 80 } = {}) {
  const n = Math.max(1, Math.round(Math.abs(dy) / step)), dir = Math.sign(dy);
  if (!env.touch) { await page.mouse.move(4, env.h / 2); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir * step); await sleep(gap); } return settle(page); }
  const cdp = await page.context().newCDPSession(page), x = Math.round(env.w * 0.3);
  const swipes = Math.max(1, Math.round(Math.abs(dy) / (env.h * 0.45)));
  for (let s = 0; s < swipes; s++) {
    const y0 = dir > 0 ? env.h * 0.85 : env.h * 0.15, d = env.h * 0.45;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 16; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - (dir * d * i) / 16 }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(220);
  }
  await cdp.detach();
  return settle(page);
}
export async function scrollUntil(page, env, pred, dir = 1, max = 400) {
  for (let i = 0; i < max; i++) {
    const y = await page.evaluate(() => scrollY);
    if (pred(y)) break;
    await scrollBy(page, env, dir * (env.touch ? env.h * 0.45 : 400), { step: env.touch ? 100 : 400, gap: 30 });
  }
  return settle(page);
}
// ScrollTrigger / Lenis classes live in ES modules: find them on the heap (same trick as qa.mjs), plus GSAP's root timeline
export async function libs(cdp) {
  const { result: fp } = await cdp.send('Runtime.evaluate', { expression: 'Function.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: fp.objectId, objectGroup: 'x' });
  await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: `function () {
    const lib = window.__qaLib = window.__qaLib || {};
    for (const f of this) try {
      if (!lib.ScrollTrigger && typeof f.getAll === 'function' && typeof f.batch === 'function' && typeof f.scrollerProxy === 'function') lib.ScrollTrigger = f;
      else if (!lib.Lenis && f.prototype && typeof f.prototype.scrollTo === 'function' && typeof f.prototype.hasNestedScroll === 'function') lib.Lenis = f;
    } catch {}
  }` });
  let lenis = null;
  const { result: lp } = await cdp.send('Runtime.evaluate', { expression: 'window.__qaLib.Lenis && window.__qaLib.Lenis.prototype' });
  if (lp.objectId) {
    const { objects: inst } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: lp.objectId, objectGroup: 'x' });
    lenis = (await cdp.send('Runtime.callFunctionOn', { objectId: inst.objectId, returnByValue: true, functionDeclaration: 'function () { if (this[0]) window.__qaLenis = this[0]; return this.length; }' })).result.value;
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'x' });
  const { result } = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const ST = window.__qaLib.ScrollTrigger; if (!ST) return null;
    const all = ST.getAll();
    if (!window.__qaRoot) { const a = all.find((s) => s.animation); let t = a && a.animation; while (t && t.parent) t = t.parent; if (t) window.__qaRoot = t; }
    const root = window.__qaRoot, kids = root ? root.getChildren(true, true, true) : [];
    return { scrollTriggers: all.length, pins: all.filter((s) => s.pin).length, animations: kids.length, activeAnimations: kids.filter((k) => k.isActive && k.isActive()).length };
  })()` });
  return { ...(result.value || {}), lenisInstances: lenis };
}
export async function listeners(cdp, expr) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
  if (!result.objectId) return null;
  const { listeners: list } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  const out = {};
  list.forEach((l) => { out[l.type] = (out[l.type] || 0) + 1; });
  return out;
}
export async function memory(cdp) {
  await cdp.send('HeapProfiler.enable').catch(() => {});
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(150); }
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}));
  return { heapUsedMB: +(heap.usedSize / 1048576).toFixed(2), documents: dom.documents, nodes: dom.nodes, jsEventListeners: dom.jsEventListeners };
}
export const diffCounts = (a, b) => Object.keys({ ...a, ...b }).filter((k) => (a[k] || 0) !== (b[k] || 0)).map((k) => `${k} ${a[k] || 0}->${b[k] || 0}`);
