// Motion QA harness for the Experts DDT site: loading screen, scroll animations and edge cases in the installed Chrome.
// What every check means and how to read the output: README.md. Output: out/<run>/report.json, summary.md, screenshots.
import { parseArgs } from 'node:util';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VIEWPORTS = { desktop: [1440, 900], laptop: [1280, 720], tablet: [768, 1024], 'tablet-land': [1024, 768], phone: [390, 844], 'phone-small': [375, 667] };
const EDGE = ['reload', 'router', 'history', 'bfcache', 'anchor', 'resize', 'theme', 'visibility', 'fling', 'zoom'];
const LOADER_SHOTS = [0, 100, 300, 600, 1000, 1500, 2000, 2600];
const BREAKPOINT = 1180; // motion.js: stacked layout, no pins, no background video up to this width

const { values: o } = parseArgs({
  options: {
    pages: { type: 'string', default: '/' },
    viewports: { type: 'string', default: 'desktop,phone' },
    motion: { type: 'string', default: 'no-preference' },
    cpu: { type: 'string', default: '1' },
    scenarios: { type: 'string', default: 'all' },
    out: { type: 'string' },
    reviews: { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    net: { type: 'string', default: '' },
    selftest: { type: 'boolean', default: false },
  },
});
const SCEN = new Set(o.scenarios.split(',').flatMap((s) => (s === 'all' ? ['loader', 'sweep', 'pins', 'keys', ...EDGE] : s === 'edge' ? EDGE : [s.trim()])));
const want = (s) => SCEN.has(s);

/* ---------------- small utils ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (p) => p.replace(/^\/|\/$/g, '').replace(/[/#?]+/g, '-') || 'home';
const sig = (page) => page.evaluate(() => __qa.signature());
const settle = (page) => page.evaluate(() => __qa.settle());
const toY = (page, y) => page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
const issue = (env, sev, check, msg, extra = {}) => env.R.issues.push({ sev, check, at: env.R.current, msg, ...extra });
// Git Bash (MSYS) rewrites an argument that starts with / into a Windows path (/services/ -> C:/Program Files/Git/services/): undo it
let msysRoot;
function unMsys(p) {
  if (!/^[A-Za-z]:[\\/]/.test(p)) return p;
  msysRoot ??= (() => { try { return execFileSync('cygpath', ['-m', '/'], { encoding: 'utf8' }).trim().replace(/\/?$/, '/'); } catch { return ''; } })();
  const q = p.replace(/\\/g, '/');
  if (msysRoot && q.toLowerCase().startsWith(msysRoot.toLowerCase())) return q.slice(msysRoot.length - 1);
  throw new Error(`--pages got a Windows path (${p}): the shell rewrote a leading slash. Use bare names (services,es/services) or MSYS_NO_PATHCONV=1`);
}
// Playwright turns the back/forward cache off by default; visitors have it, so the bfcache scenario needs it on
const launch = () => chromium.launch({ executablePath: CHROME, headless: !o.headed, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
const NET = { slow4g: { latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 }, fast4g: { latency: 60, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 } }; // = scenarios/cross/loader-net.mjs

async function shot(env, name) {
  const file = join(env.dir, `${name}.jpg`);
  // page.screenshot() re-applies Playwright's own viewport metrics: under an emulated browser zoom it would undo the zoom mid-shot
  if (env.zoomed) await env.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }).then(({ data }) => writeFileSync(file, Buffer.from(data, 'base64'))).catch(() => {});
  else await env.page.screenshot({ path: file, type: 'jpeg', quality: 70, scale: 'css' }).catch(() => {});
  return relative(env.runDir, file).replace(/\\/g, '/');
}

/* ---------------- build + serve ---------------- */
function build(dir, reviews) {
  console.log(`build (reviews ${reviews ? 'on' : 'off'}) -> ${dir}`);
  const r = spawnSync('npm', ['run', 'build', '--', '--outDir', `"${dir}"`], { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, PUBLIC_SHOW_REVIEWS: reviews ? '1' : '' } });
  if (r.status !== 0) throw new Error('npm run build failed');
}
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function serve(dir) {
  const port = await freePort();
  // = npx astro preview --host 127.0.0.1 --port <port>, started through node so the process can be stopped on Windows
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--outDir', dir, '--ignore-lock'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (b) => (log += b));
  child.stderr.on('data', (b) => (log += b));
  process.on('exit', () => child.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150 && child.exitCode == null; i++) {
    try { if ((await fetch(`${url}/`)).ok) return { url, stop: () => child.kill() }; } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error(`astro preview did not start:\n${log}`);
}
function gitInfo() {
  const g = (...a) => { try { return execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim(); } catch { return '?'; } };
  // dirty = uncommitted site changes (the harness under tools/ is not part of the site)
  return { branch: g('rev-parse', '--abbrev-ref', 'HEAD'), commit: g('rev-parse', '--short', 'HEAD'), dirty: g('status', '--porcelain', '--', '.', ':(exclude)tools') !== '' };
}

/* ---------------- CDP helpers ---------------- */
// ScrollTrigger and Lenis are bundled as ES modules (nothing on window): find their classes on the heap once per document
async function libs(cdp) {
  const { result: fp } = await cdp.send('Runtime.evaluate', { expression: 'Function.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: fp.objectId, objectGroup: 'qa' });
  await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: `function () {
    const lib = window.__qaLib = window.__qaLib || {};
    for (const f of this) try {
      if (!lib.ScrollTrigger && typeof f.getAll === 'function' && typeof f.batch === 'function' && typeof f.scrollerProxy === 'function') lib.ScrollTrigger = f;
      else if (!lib.Lenis && f.prototype && typeof f.prototype.scrollTo === 'function' && typeof f.prototype.hasNestedScroll === 'function') lib.Lenis = f;
    } catch {}
  }` });
  let lenisInstances = null;
  const { result: lp } = await cdp.send('Runtime.evaluate', { expression: 'window.__qaLib.Lenis && window.__qaLib.Lenis.prototype' });
  if (lp.objectId) {
    const { objects: inst } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: lp.objectId, objectGroup: 'qa' });
    lenisInstances = (await cdp.send('Runtime.callFunctionOn', { objectId: inst.objectId, returnByValue: true, functionDeclaration: 'function () { return this.length; }' })).result.value;
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'qa' });
  const st = await cdp.send('Runtime.evaluate', { expression: 'window.__qaLib.ScrollTrigger ? window.__qaLib.ScrollTrigger.getAll().length : null', returnByValue: true });
  return { scrollTriggers: st.result.value, lenisInstances };
}
// window, document and the header controls the ClientRouter keeps across pages (handlers stacked there once leaked)
async function listeners(cdp) {
  const out = {};
  for (const target of ['window', 'document', '.nav__book', '.burger', '.nav .theme-toggle']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: target.startsWith('.') ? `document.querySelector(${JSON.stringify(target)})` : target });
    if (!result.objectId) continue;
    const { listeners: list } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    list.forEach((l) => { out[`${target}:${l.type}`] = (out[`${target}:${l.type}`] || 0) + 1; });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  return out;
}
// live DOM after garbage collection: pages left behind by the router stay in memory as detached nodes
async function domCounters(cdp) {
  await cdp.send('HeapProfiler.enable').catch(() => {});
  for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); await sleep(150); }
  return cdp.send('Memory.getDOMCounters').catch(() => null);
}
// records every composited frame while fn runs (timestamps are wall clock ms, comparable with performance.timeOrigin)
async function film(env, fn) {
  const frames = [];
  const on = (f) => { frames.push({ ts: f.metadata.timestamp ? f.metadata.timestamp * 1000 : null, at: Date.now(), data: f.data }); env.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
  env.cdp.on('Page.screencastFrame', on);
  await env.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: Math.min(env.w, 960), maxHeight: Math.min(env.h, 960) });
  try { await fn(); } finally { await env.cdp.send('Page.stopScreencast').catch(() => {}); env.cdp.off('Page.screencastFrame', on); }
  // the first frame after startScreencast can carry a stale timestamp: fall back to arrival time minus the usual latency
  const lat = frames.filter((f) => f.ts).map((f) => f.at - f.ts).sort((a, b) => a - b), med = lat[Math.floor(lat.length / 2)] ?? 0;
  frames.forEach((f) => { if (f.ts == null || f.at - f.ts > med + 150) f.ts = f.at - med; });
  return frames;
}
// share of near-black pixels per frame (a black flash = a video/layer painting #000 before its content)
const luma = (apage, list) => apage.evaluate(async (list) => {
  const out = [];
  for (const b64 of list) {
    const img = new Image(); img.src = `data:image/jpeg;base64,${b64}`; await img.decode();
    const c = new OffscreenCanvas(64, Math.max(1, Math.round((64 * img.height) / img.width))), g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data; let black = 0;
    for (let i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] < 8) black++;
    out.push(+(black / (d.length / 4)).toFixed(3));
  }
  return out;
}, list);
async function blackFrames(env, frames, name, origin = 0) {
  const step = Math.ceil(frames.length / 70) || 1, sample = frames.filter((_, i) => i % step === 0);
  const b = await luma(env.apage, sample.map((f) => f.data));
  const bad = sample.map((f, i) => ({ t: Math.round(f.ts - origin), black: b[i], data: f.data })).filter((f) => f.black > 0.25);
  if (!bad.length) return [];
  const worst = bad.reduce((a, c) => (c.black > a.black ? c : a));
  const file = join(env.dir, `${name}-black-${worst.t}ms.jpg`);
  writeFileSync(file, Buffer.from(worst.data, 'base64'));
  return bad.map(({ t, black }) => ({ t, black, shot: relative(env.runDir, file).replace(/\\/g, '/') }));
}
async function filmstrip(env, cells, name) {
  const portrait = env.h > env.w, w = portrait ? 128 : 280;
  await env.apage.setContent(`<body style="margin:0;padding:6px;background:#15171c;font:12px/1.3 system-ui;color:#dfe3ea;display:flex;flex-wrap:wrap;gap:6px">${cells.map((c) => `<figure style="margin:0;width:${w}px">${c.data ? `<img style="width:100%;display:block" src="data:image/jpeg;base64,${c.data}">` : `<div style="height:${Math.round((w * env.h) / env.w)}px;display:grid;place-items:center;background:#2a2e36">no frame yet</div>`}<figcaption style="padding:3px 2px">${c.label}</figcaption></figure>`).join('')}</body>`);
  const file = join(env.dir, `${name}-filmstrip.jpg`);
  await env.apage.screenshot({ path: file, fullPage: true, type: 'jpeg', quality: 80 });
  return relative(env.runDir, file).replace(/\\/g, '/');
}

/* ---------------- real input ---------------- */
const SPEED = { realistic: { wheel: [100, 80], touch: [0.45, 260, 220] }, fast: { wheel: [400, 16], touch: [0.7, 70, 20] }, fling: { wheel: [1200, 8], touch: [0.85, 35, 0] } };
async function gesture(env, dirn, speed) {
  if (!env.touch) { const [d, gap] = SPEED[speed].wheel; await env.page.mouse.wheel(0, dirn * d); return sleep(gap); }
  // a finger swipe: native touch scrolling, like a phone (Lenis leaves touch to the browser)
  const [f, ms, gap] = SPEED[speed].touch, vh = env.page.viewportSize().height, x = Math.round(env.page.viewportSize().width * 0.3);
  const y0 = dirn > 0 ? vh * 0.9 : vh * 0.1, dy = f * vh, steps = Math.max(4, Math.round(ms / 16));
  await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 - (dirn * dy * i) / steps }] }); }
  await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return sleep(gap);
}
// scroll with real input to the end (dirn 1), the top (-1) or until until(scrollY); a scroll that stops moving is reported
async function travel(env, dirn, speed, until) {
  const { page } = env;
  // to a target on touch, never fast: one fast swipe flings the page thousands of px past it (a phone ends at the footer)
  if (until && env.touch && speed === 'fast') speed = 'realistic';
  if (!env.touch) await page.mouse.move(4, page.viewportSize().height / 2); // page margin: no hover effects under the pointer
  const t0 = Date.now();
  let last = -1, moved = Date.now();
  while (Date.now() - t0 < 120000) {
    const [y, max] = await page.evaluate(() => [scrollY, __qa.maxScroll()]);
    if (until ? until(y) : dirn > 0 ? y >= max - 2 : y <= 0) break;
    if (Math.abs(y - last) > 0.5) { last = y; moved = Date.now(); } else if (Date.now() - moved > 3000) return { blockedAt: Math.round(y) };
    await gesture(env, dirn, speed);
  }
  return settle(page);
}
async function measured(env, fn) {
  const a = await env.page.evaluate(() => performance.now());
  const out = await fn();
  return { ...out, ...(await env.page.evaluate((a) => { const b = performance.now(); return { frames: __qa.frameStats(a, b), longTasks: __qa.tasks.filter((t) => t.t >= a && t.t <= b).length, loafs: __qa.loafs.filter((t) => t.t >= a && t.t <= b && (t.block > 50 || t.d > 100)).sort((x, y) => y.d - x.d).slice(0, 4) }; }, a)) };
}
async function waitReady(page, extra = 1600) {
  await page.waitForFunction(() => window.__qa && document.readyState === 'complete' && !document.getElementById('loader'), null, { timeout: 20000, polling: 100 });
  await sleep(extra); // hero intro and first reveals finish
  await page.evaluate(() => __qa.watch());
}
async function load(env, path) {
  await harvest(env);
  await env.page.goto(env.base + path);
  await waitReady(env.page);
}
// stuck reveals live in the page: collect them before the document goes away
async function harvest(env) {
  const s = await env.page.evaluate(() => (window.__qa ? __qa.stuck : [])).catch(() => []);
  s.forEach(({ since, ...x }) => { if (!env.stuck.some((y) => y.el === x.el && y.path === x.path)) env.stuck.push(x); });
}
function stuckIssues(env) {
  env.stuck.forEach((s) => issue(env, s.revealedAfterMs == null ? 'fail' : 'warn', 'stuck', s.revealedAfterMs == null
    ? `stuck reveal on ${s.path}: ${s.el} still hidden (${s.reason}) after ${s.inViewMs} ms in view (${s.where}, y=${s.y})`
    : `late reveal on ${s.path}: ${s.el} hidden (${s.reason}) for ${s.revealedAfterMs} ms while in view (y=${s.y})`));
}

/* ---------------- comparisons ---------------- */
function sigDiff(a, b) {
  if (!a || !b) return ['state missing'];
  const d = [];
  const near = (k, x, y, tol) => { if ((x ?? null) === (y ?? null)) return; if (x == null || y == null || Math.abs(x - y) > tol) d.push(`${k} ${x} -> ${y}`); };
  if (a.path !== b.path) d.push(`path ${a.path} -> ${b.path}`);
  near('scrollY', a.y, b.y, 2);
  near('page height', a.h, b.h, 3);
  ['navSolid', 'theme'].forEach((k) => a[k] !== b[k] && d.push(`${k} ${a[k]} -> ${b[k]}`));
  const pa = Object.fromEntries(a.pins), pb = Object.fromEntries(b.pins);
  new Set([...Object.keys(pa), ...Object.keys(pb)]).forEach((k) => near(`pin ${k} spacer`, pa[k], pb[k], 3));
  if (a.hero && b.hero) {
    if (a.hero.video && b.hero.video && a.hero.video.src !== b.hero.video.src) d.push(`hero video source ${a.hero.video.src ? 'loaded' : 'none'} -> ${b.hero.video.src ? 'loaded' : 'none'}`);
    near('hero copy opacity', a.hero.copy, b.hero.copy, 0.05);
    near('portal opacity', a.hero.portalHead, b.hero.portalHead, 0.05);
    near('hero intro elements hidden', a.hero.introHidden, b.hero.introHidden, 0);
    if (a.hero.laptop && b.hero.laptop) { near('laptop x', a.hero.laptop.x, b.hero.laptop.x, 4); near('laptop y', a.hero.laptop.y, b.hero.laptop.y, 4); near('laptop scale', a.hero.laptop.s, b.hero.laptop.s, 0.01); }
  }
  if (a.pillars && b.pillars) {
    if (a.pillars.static !== b.pillars.static) d.push(`pillars static ${a.pillars.static} -> ${b.pillars.static}`);
    near('pillars track x', a.pillars.trackX, b.pillars.trackX, 4);
  }
  if (b.hiddenInView > a.hiddenInView) d.push(`hidden elements in view ${a.hiddenInView} -> ${b.hiddenInView}`);
  return d;
}
function pinStatic(p) {
  const out = [];
  if (p.dist <= 0) out.push('pin has no scroll distance');
  if (p.st && Math.abs(p.dist - (p.st.end - p.st.start)) > 3) out.push(`pin spacing ${p.dist}px but its scroll distance is ${p.st.end - p.st.start}px`);
  if (p.nextTop != null && Math.abs(p.nextTop - (p.top + p.spacerH)) > 2) out.push(`next section (${p.next}) starts at ${p.nextTop}px but the pin spacer ends at ${p.top + p.spacerH}px`);
  return out;
}
function pinDynamic(p, S, end) {
  const out = [];
  ['start', 'mid', 'endIn'].forEach((k) => { const r = S[k].pin?.rect; if (r && Math.abs(r.y) > 2) out.push(`not held at the top at ${k} (y=${S[k].y}): scene top ${r.y}px`); });
  const a = S.after.pin;
  if (a?.rect && a.nextTop != null) { const gap = a.rect.y + a.rect.h - a.nextTop; if (Math.abs(gap) > 2) out.push(`${gap > 0 ? 'overlaps' : 'leaves a gap before'} the next section by ${Math.abs(gap)}px right after the pin`); }
  if (a?.rect && Math.abs(a.rect.y + (S.after.y - end)) > 10) out.push(`jumps on release: scene top ${a.rect.y}px at y=${S.after.y} (expected ${end - S.after.y}px)`);
  const b = S.before.pin;
  if (b?.rect && Math.abs(b.rect.y - (p.top - S.before.y)) > 10) out.push(`jumps before the pin: scene top ${b.rect.y}px, expected ${p.top - S.before.y}px`);
  if (p.id === 'hero') {
    const h0 = S.before.hero, h1 = S.endIn.hero;
    if (h0 && (h0.copy < 0.95 || h0.introHidden || h0.portalHead > 0.05)) out.push(`start state: hero copy ${h0.copy}, intro elements hidden ${h0.introHidden}, portal ${h0.portalHead}`);
    if (h1) {
      if (h1.portalHead < 0.95 || Math.min(...h1.features) < 0.95 || h1.portalCta < 0.95) out.push(`end state: portal not fully shown (head ${h1.portalHead}, features ${h1.features.join('/')}, cta ${h1.portalCta})`);
      if (h1.copy > 0.05) out.push(`end state: hero copy still visible (${h1.copy})`);
      if (h1.laptop && (Math.abs(h1.laptop.s - 1) > 0.01 || Math.abs(h1.laptop.x) > 4 || Math.abs(h1.laptop.y) > 4)) out.push(`end state: laptop not at rest ${JSON.stringify(h1.laptop)}`);
      if (h1.laptopCut) out.push(`end state: laptop cut by the screen edge ${JSON.stringify(h1.laptopRect)}`);
      if (h1.portalLaptopOverlapPx > 0) out.push(`end state: portal copy overlaps the laptop (${h1.portalLaptopOverlapPx} px²)`);
    }
  }
  if (p.id === 'pillars') {
    const s0 = S.start.pillars, s1 = S.endIn.pillars, s2 = S.after.pillars, vw = S.endIn.vw;
    if (s0 && Math.abs(s0.trackX) > 4) out.push(`track already moved when the pin starts (x=${s0.trackX})`);
    if (s1 && Math.abs(s1.lastRight - vw) > 4) out.push(`track does not reach its end: last panel right edge ${s1.lastRight}px, viewport ${vw}px`);
    if (s1?.bar != null && s1.bar < 0.98) out.push(`progress bar at ${s1.bar} at the end`);
    if (s1 && s1.count !== String(s1.n - 1).padStart(2, '0')) out.push(`counter shows ${s1.count} at the end`);
    if (s2 && Math.abs(s2.lastRight - vw) > 4) out.push(`track moves after the pin ends (last panel right ${s2.lastRight}px)`);
  }
  return out;
}

/* ---------------- loader ---------------- */
// one first load (or reload) until the loader is gone: the page's own timeline, observers and final layout boxes
async function loadOnce(env, go) {
  const { page } = env;
  await go();
  await page.waitForFunction(() => window.__qa && __qa.log.some((e) => e.type === 'loader:removed'), null, { timeout: 15000, polling: 50 }).catch(() => {});
  await sleep(1200);
  return page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0], p = (k) => performance.getEntriesByName(k)[0]?.startTime ?? null; return { origin: performance.timeOrigin, log: __qa.log, shifts: __qa.shifts, tasks: __qa.tasks, loafs: __qa.loafs, boxes: __qa.boxes(), names: __qa.boxNames(), fp: p('first-paint'), fcp: p('first-contentful-paint'), dcl: n?.domContentLoadedEventEnd, load: n?.loadEventEnd }; });
}
// two passes: the measured one runs without the screencast (filming slowed the main thread: /contact/ wipe frames 7 ms ->
// 70-83 ms), then `again` repeats the load filmed, for the filmstrip and black frames only (its timings are not judged)
async function loader(env, name, go, again = go) {
  const { page } = env;
  const d = await loadOnce(env, go);
  const at = (t, log = d.log) => log.find((e) => e.type === `loader:${t}`) || null;
  const done = at('done'), first = at('frame'), start = at('start') || at('run'), end = at('end'), removed = at('removed');
  const movedBetween = (a, b) => Object.keys(a).filter((k) => k !== 'doc' && b[k] && a[k].some((v, i) => Math.abs(v - b[k][i]) > 1)).map((k) => `${d.names[k] || k} [${a[k]}] -> [${b[k]}]`);
  const r0 = (n) => (n == null ? null : Math.round(n));
  const res = { firstPaint: r0(d.fp), fcp: r0(d.fcp), doneAt: done?.t ?? null, wipeStartAt: start?.t ?? null, wipeEndAt: end?.t ?? null, removedAt: removed?.t ?? null, domContentLoaded: r0(d.dcl), load: r0(d.load), fontsAtDone: done?.fonts ?? null, heroImgAtDone: done?.img ?? null };
  if (done) {
    const a = start?.t ?? done.t, b = end?.t ?? a + 700;
    res.loaderVisibleMs = d.fp != null ? Math.round(a - d.fp) : null; // painted loader on screen before the wipe begins
    res.wipeFrames = await page.evaluate(([a, b]) => __qa.frameStats(a, b), [a, b + 34]);
    res.wipeDelay = start ? start.t - done.t : null;
    res.moved = movedBetween((first || done).boxes, d.boxes); // visible jump after the reveal
    res.settlingAtDone = first ? movedBetween(done.boxes, first.boxes) : []; // layout not final when ScrollTrigger.refresh() ran
    res.longTasksDuringWipe = d.tasks.filter((t) => t.t + t.d >= done.t && t.t <= b);
    res.longFramesDuringWipe = d.loafs.filter((l) => l.t + l.d >= done.t && l.t <= b).slice(0, 4);
  }
  const cls = (from) => +d.shifts.filter((s) => !s.input && s.t >= from).reduce((n, s) => n + s.v, 0).toFixed(4);
  res.cls = cls(0);
  res.clsAfterReveal = done ? cls(done.t - 20) : null;
  res.shiftsAfterReveal = done ? d.shifts.filter((s) => !s.input && s.t >= done.t - 20).slice(0, 5) : [];
  // pass 2, filmed: what was on screen at each moment = the last composited frame at or before T (that load's own clock)
  await harvest(env);
  let f2;
  const frames = await film(env, async () => { f2 = await loadOnce(env, again); });
  const fDone = at('done', f2.log), fStart = at('start', f2.log) || at('run', f2.log), fEnd = at('end', f2.log), fRemoved = at('removed', f2.log);
  const rel = frames.map((f) => ({ t: Math.round(f.ts - f2.origin), data: f.data, ts: f.ts }));
  const cells = LOADER_SHOTS.map((T) => {
    let f = null;
    for (const x of rel) if (x.t <= T) f = x;
    const wipeEnd = fEnd?.t ?? fRemoved?.t ?? (fStart ? fStart.t + 700 : null);
    const phase = !f ? 'previous screen' : f2.fp != null && f.t < f2.fp - 20 ? 'previous page' : fDone && T < (fStart?.t ?? fDone.t) ? 'loader' : fStart && T < wipeEnd ? 'wipe' : 'page';
    if (f) writeFileSync(join(env.dir, `${name}-${String(T).padStart(4, '0')}ms.jpg`), Buffer.from(f.data, 'base64'));
    return { data: f?.data, label: `${T} ms · ${phase}` };
  });
  res.filmstrip = await filmstrip(env, cells, name);
  if (fStart && fEnd) res.compositedFramesDuringWipe = rel.filter((f) => f.t >= fStart.t && f.t <= fEnd.t).length;
  res.blackFrames = await blackFrames(env, rel.filter((f) => f.t >= (f2.fcp ?? 0) - 20 && f.t <= (fRemoved?.t ?? 3000) + 1200), name, f2.origin);

  const I = (sev, msg) => issue(env, sev, 'loader', msg, { shot: res.filmstrip });
  if (!done) I('fail', 'loader:done never fired: the page stayed behind the loading screen');
  else {
    if (done.t > 2600) I('warn', `the loading screen covered the page for ${done.t} ms`);
    if (done.fonts !== 'loaded') I('warn', `fonts were "${done.fonts}" when the loader lifted: text can reflow after the reveal`);
    if (done.img && !(done.img.complete && done.img.w)) I('warn', 'hero image not decoded when the loader lifted');
    // a short opacity fade is fine with reduced motion (no movement); a clip-path wipe or a transform is not
    if (env.reduced && start && start.prop !== 'opacity') I('fail', `the loader exit moves with prefers-reduced-motion (${start.prop || 'transition'})`);
    if (!env.reduced && !start) I('warn', 'no clip-path wipe on the loader (instant cut)');
    if (res.wipeDelay > 120) I('warn', `the wipe started ${res.wipeDelay} ms after is-done (main thread busy at the reveal)`);
    if (res.loaderVisibleMs != null && res.loaderVisibleMs < 0) I('warn', `the loading screen never showed whole: the first paint (${res.firstPaint} ms) came ${-res.loaderVisibleMs} ms after its exit started (${start?.t ?? done.t} ms)`);
    else if (res.loaderVisibleMs != null && res.loaderVisibleMs < 300) I('warn', `the loading screen is on screen only ${res.loaderVisibleMs} ms before it wipes away (first paint ${res.firstPaint} ms, wipe ${start?.t ?? done.t} ms): it reads as a flash`);
    const f = res.wipeFrames, lf = res.longFramesDuringWipe?.[0];
    const cut = start && !end && removed ? '; the loader was removed before its transitionend (the last frames of the wipe never painted)' : '';
    // rAF frames of the main thread: the clip-path itself is composited, but the hero intro and JS animations that start under it stutter
    if (!env.reduced && f && (f.dropped > 4 || f.max > 50 || cut)) I('warn', `main thread janked under the wipe (intro/JS animations stutter): worst frame ${f.max} ms, ${f.dropped} dropped (p95 ${f.p95} ms)${lf ? `; longest frame ${lf.d} ms: ${lf.scripts.join(', ') || 'style/layout/paint'}` : ''}${cut}`);
    if (res.moved.length) I('fail', `content moved after the reveal (not laid out behind the loader): ${res.moved.slice(0, 3).join(' | ')}`);
    if (res.settlingAtDone.length) I('warn', `layout was still changing when the loader lifted and ScrollTrigger refreshed (trigger positions measured on a stale layout): ${res.settlingAtDone.slice(0, 3).join(' | ')}`);
    if (res.clsAfterReveal > 0.01) I('fail', `layout shift after the reveal, CLS ${res.clsAfterReveal}: ${res.shiftsAfterReveal.map((s) => s.src.map((x) => x.el).join(', ')).join(' | ')}`);
  }
  if (res.cls > 0.1) I('warn', `CLS during load ${res.cls}`);
  if (res.blackFrames.length) issue(env, 'warn', 'loader', `black frame(s) at ${res.blackFrames.map((b) => `${b.t} ms (${Math.round(b.black * 100)}% black)`).join(', ')}`, { shot: res.blackFrames[0].shot });
  return res;
}

/* ---------------- per-page scenarios ---------------- */
// invisible controls that take the click meant for a visible one = FAIL; over blank space (an entrance not played yet,
// e.g. a CTA in the bottom 14 % of the first screen) = WARN. Once per element, severity and combination.
async function ghostIssues(env, where, shotPath) {
  const g = await env.page.evaluate(() => ({ y: Math.round(scrollY), hits: __qa.ghosts() }));
  env.ghostSeen ??= new Set();
  for (const h of g.hits) {
    const key = `${h.el}|${!!h.over}`, to = h.href ? ` -> ${h.href}` : '';
    if (env.ghostSeen.has(key)) continue;
    env.ghostSeen.add(key);
    const s = { shot: shotPath || (await shot(env, `ghost-y${g.y}`)) };
    if (h.over) issue(env, 'fail', 'ghost', `${where} (y=${g.y}): invisible ${h.el}${to} takes the clicks aimed at the visible ${h.over} (${h.areaPx} px²)`, s);
    else issue(env, 'warn', 'ghost', `${where} (y=${g.y}): invisible ${h.el}${to} takes clicks on ${h.areaPx} px² of blank screen (an entrance that has not played yet)`, s);
  }
  return g.hits;
}
async function rules(env, path, res) {
  const st = (res.rules = await env.page.evaluate(() => ({ pins: __qa.pins().map((p) => p.id), lenis: document.documentElement.classList.contains('lenis'), video: __qa.hero()?.video ?? null, hidden: __qa.hiddenAll(), introActivity: matchMedia('(prefers-reduced-motion: reduce)').matches ? __qa.activity.stop() : [] })));
  st.ghostsAtTop = await ghostIssues(env, 'top of the page after load');
  if (st.introActivity.length) issue(env, 'fail', 'reduced', `JavaScript animated ${st.introActivity.length} element(s) during the first load with reduced motion (an intro or entrance played): ${st.introActivity.slice(0, 6).map((a) => `${a.el} (${a.writes} writes)`).join(' | ')}`);
  const small = env.w <= BREAKPOINT;
  if ((small || env.reduced) && st.pins.length) issue(env, 'fail', 'rules', `${st.pins.length} pinned scene(s) (${st.pins}) on a ${env.reduced ? 'reduced-motion' : 'small-screen'} layout`);
  if (!small && !env.reduced && path === '/' && st.pins.length < 2) issue(env, 'fail', 'rules', `expected the hero and pillars pins on desktop, found: ${st.pins.join(', ') || 'none'}`);
  if (env.reduced && st.lenis) issue(env, 'fail', 'rules', 'smooth scroll (Lenis) is active with prefers-reduced-motion');
  if (small && st.video && st.video.display !== 'none') issue(env, 'fail', 'rules', 'hero background video is displayed on a small screen');
  if (small && env.media.some((u) => /smile-design\.mp4/.test(u))) issue(env, 'warn', 'rules', 'hero background video was requested on a small screen (bandwidth, never shown)');
  if (env.reduced && st.hidden.length) issue(env, 'fail', 'reduced', `${st.hidden.length} element(s) are hidden or displaced until scrolled to (reduced motion must show everything in place): ${st.hidden.slice(0, 6).map((h) => `${h.el} [${h.reason}]`).join(' | ')}`);
}

async function sweep(env, path, S0) {
  const { page } = env, res = {};
  res.topShot = await shot(env, 'sweep-00-top');
  if (env.reduced) await page.evaluate(() => __qa.activity.start());
  // 1) realistic round trip: down to the footer and back up, frame times measured
  res.realisticDown = await measured(env, () => travel(env, 1, 'realistic'));
  await sleep(1600);
  res.footerReached = await page.evaluate(() => { const f = document.querySelector('footer'); return !!f && f.getBoundingClientRect().top < innerHeight && scrollY >= __qa.maxScroll() - 2; });
  res.bottomShot = await shot(env, 'sweep-zz-bottom');
  res.realisticUp = await measured(env, () => travel(env, -1, 'realistic'));
  await sleep(1500);
  res.backToTop = sigDiff(S0, await sig(page));
  if (env.reduced) res.activity = await page.evaluate(() => __qa.activity.stop());
  // 2) fast round trip
  res.fastDown = await measured(env, () => travel(env, 1, 'fast'));
  await sleep(1600);
  res.fastUp = await measured(env, () => travel(env, -1, 'fast'));
  await sleep(1500);
  res.backToTopFast = sigDiff(S0, await sig(page));
  res.backShot = await shot(env, 'sweep-zz-back-at-top');
  // 3) stops at every viewport height and every [data-scene]: screenshot + layout detectors
  const targets = await page.evaluate(() => {
    const vh = innerHeight, max = __qa.maxScroll(), ys = __qa.scenes().map((s) => Math.min(s.top, max));
    for (let y = vh; y < max; y += vh) ys.push(y);
    ys.push(max);
    const out = [];
    ys.map(Math.round).sort((a, b) => a - b).forEach((y) => { if (y > 0 && (!out.length || y - out[out.length - 1] > vh * 0.2)) out.push(y); });
    return out;
  });
  res.stops = [];
  for (const [i, t] of targets.entries()) {
    const mv = await travel(env, 1, 'realistic', (y) => y >= t - 4);
    await sleep(1600);
    const s = await page.evaluate(() => ({ y: Math.round(scrollY), atEnd: scrollY >= __qa.maxScroll() - 2, pinned: __qa.pinnedNow(), overflow: __qa.overflow(), fixed: __qa.fixedOverlap() }));
    s.shot = await shot(env, `sweep-${String(i + 1).padStart(2, '0')}-y${s.y}`);
    s.ghosts = await ghostIssues(env, 'sweep stop', s.shot);
    res.stops.push(s);
    if (mv.blockedAt != null || s.atEnd) break;
  }

  // issues
  for (const k of ['realisticDown', 'realisticUp', 'fastDown', 'fastUp']) {
    const p = res[k];
    if (p.blockedAt != null) issue(env, 'fail', 'sweep', `${k}: scrolling stopped moving at y=${p.blockedAt} before the ${k.endsWith('Up') ? 'top' : 'end'}`);
    const f = p.frames, slow = k.startsWith('fast') ? 34 : 25;
    if (f && (f.p95 > slow || f.max > 100)) issue(env, 'warn', 'frames', `${k}: p95 frame ${f.p95} ms, worst ${f.max} ms, ${f.dropped} dropped of ${f.frames} (repeat to confirm: timings are noisy here)`);
    p.loafs?.slice(0, 1).forEach((l) => issue(env, 'warn', 'frames', `${k}: a ${l.d} ms main-thread frame (scripts blocking ${l.block} ms): ${l.scripts.join(', ') || 'style/layout/paint'}`));
  }
  if (!res.footerReached) issue(env, 'fail', 'sweep', 'the footer was not reached with the wheel/touch sweep', { shot: res.bottomShot });
  if (res.backToTop.length) issue(env, 'fail', 'sweep', `back at the top after the footer, the page differs from its first state: ${res.backToTop.join('; ')}`, { shot: res.backShot });
  if (res.backToTopFast.length) issue(env, 'fail', 'sweep', `after a fast round trip the top differs from its first state: ${res.backToTopFast.join('; ')}`, { shot: res.backShot });
  if (res.activity?.length) issue(env, 'fail', 'reduced', `JavaScript animates ${res.activity.length} element(s) while scrolling with reduced motion: ${res.activity.slice(0, 6).map((a) => `${a.el} (${a.writes} writes)`).join(' | ')}`);
  const once = new Map();
  for (const s of res.stops) {
    if (s.overflow.canScrollX) once.set('x', ['fail', `the page scrolls sideways (scrollWidth ${s.overflow.scrollWidth} > ${s.overflow.innerWidth})`, s]);
    s.overflow.cut.forEach((c) => once.has(`cut${c.el}`) || once.set(`cut${c.el}`, ['warn', `cut by the screen edge: ${c.el} (${c.left}..${c.right}px of ${s.overflow.innerWidth})`, s]));
    // content the user cannot scroll out from under fixed UI: inside a pinned scene (any fixed UI), at the page end (bottom floats only)
    s.fixed.filter((f) => s.pinned || (s.atEnd && f.under !== 'nav')).forEach((f) => once.has(`fx${f.el}`) || once.set(`fx${f.el}`, ['warn', `${f.under} covers ${Math.round(f.frac * 100)}% of ${f.el} ${s.pinned ? 'inside a pinned scene' : 'at the page end'} (y=${s.y})`, s]));
  }
  once.forEach(([sev, msg, s]) => issue(env, sev, 'layout', msg, { shot: s.shot }));
  return res;
}

async function pins(env) {
  const { page } = env, list = await page.evaluate(() => __qa.pins()), out = [];
  for (const p of list) {
    const start = p.st ? p.st.start : p.top, end = p.st ? p.st.end : p.top + p.dist;
    const r = { ...p, problems: pinStatic(p), states: {} };
    const at = { before: Math.max(0, start - 40), start: start + 1, mid: Math.round((start + end) / 2), endIn: end - 1, after: end + 1, after40: end + 40 };
    for (const [k, y] of Object.entries(at)) {
      await toY(page, y);
      await sleep(env.slow(900)); // scrub catch-up
      r.states[k] = await page.evaluate((id) => ({ y: Math.round(scrollY), vw: innerWidth, pin: __qa.pinNow(id), hero: id === 'hero' ? __qa.hero() : null, pillars: id === 'pillars' ? __qa.pillars() : null }), p.id);
      const name = { before: 'start', mid: 'mid', endIn: 'end' }[k];
      if (name) r.states[k].shot = await shot(env, `pin-${p.id}-${name}`);
      r.states[k].ghosts = await ghostIssues(env, `pin ${p.id} ${k}`, r.states[k].shot);
    }
    r.problems.push(...pinDynamic(p, r.states, end));
    r.problems.forEach((m) => issue(env, 'fail', 'pins', `${p.id}: ${m}`, { shot: r.states.endIn.shot }));
    out.push(r);
  }
  await toY(page, 0);
  await sleep(1200);
  return out;
}

async function keys(env, S0) {
  const { page } = env, k = { ys: [] };
  await toY(page, 0);
  await settle(page);
  await sleep(1200);
  await page.evaluate(() => document.activeElement?.blur?.());
  let y = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Space' : 'PageDown');
    const s = await page.evaluate(() => __qa.settle(6, 3000)), max = await page.evaluate(() => __qa.maxScroll());
    if (s.y - y < 20 && s.y < max - 2) { k.blockedAt = s.y; break; }
    y = s.y; k.ys.push(y);
    if (y >= max - 2) break;
  }
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('End');
  const e = await page.evaluate(() => __qa.settle(8, 4000));
  k.endReached = e.y >= (await page.evaluate(() => __qa.maxScroll())) - 2;
  await sleep(1200);
  k.endShot = await shot(env, 'keys-end');
  await page.keyboard.press('Home');
  await page.evaluate(() => __qa.settle(8, 4000));
  await sleep(1500);
  k.homeDiff = sigDiff(S0, await sig(page));
  k.homeShot = await shot(env, 'keys-home');
  // Tab through every control from the top: each focused one on screen and visible, no overflow:hidden chapter scrolled by it
  await page.evaluate(() => document.activeElement?.blur?.());
  k.tab = { focused: 0, problems: [] };
  const bad = (f) => !f.exempt && (!f.onScreen || f.opacity < 0.05 || f.scrolled.length > 0);
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press('Tab');
    await page.evaluate(() => __qa.settle(6, 2000));
    let f = await page.evaluate(() => { const w = (window.__qaTabbed ??= new WeakSet()), el = document.activeElement; if (!el || el === document.body || w.has(el)) return null; w.add(el); return __qa.focusState(); });
    if (!f) break; // focus left the page or came round again
    k.tab.focused++;
    if (bad(f)) { await sleep(700); f = (await page.evaluate(() => __qa.focusState())) || f; } // an entrance may still be playing in
    if (bad(f) && k.tab.problems.length < 6) k.tab.problems.push({ ...f, shot: await shot(env, `keys-tab-${String(i).padStart(3, '0')}`) });
  }
  k.tab.problems.forEach((f) => issue(env, 'fail', 'keys', `Tab: focus on ${f.el} at y=${f.y} is ${[!f.onScreen && 'off screen', f.opacity < 0.05 && `invisible (opacity ${f.opacity})`, ...f.scrolled].filter(Boolean).join(', ')}`, { shot: f.shot }));
  if (k.blockedAt != null) issue(env, 'fail', 'keys', `PageDown/Space stopped scrolling at y=${k.blockedAt}`);
  if (!k.endReached) issue(env, 'fail', 'keys', 'End did not reach the end of the page', { shot: k.endShot });
  if (k.homeDiff.length) issue(env, 'fail', 'keys', `after End then Home the top differs from its first state: ${k.homeDiff.join('; ')}`, { shot: k.homeShot });
  return k;
}

async function runPage(ctx, base, path) {
  const env = await openEnv(ctx, base, slug(path)), res = (env.R.pages[path] = {}), S = slug(path);
  try {
    await guard(env.R, `${S}/load`, async () => {
      if (want('loader')) {
        // warm the tab on the same origin first (cache stays cold): renderer start-up of a fresh headless tab is not what a visitor
        // waits for. Then about:blank, so tearing the previous document down (195 ms) never lands in the measured first frames.
        await env.page.goto(`${env.base}/robots.txt`);
        res.loader = await loader(env, 'loader', async () => { await env.page.goto('about:blank'); await env.page.goto(env.base + path, { waitUntil: 'commit' }); });
        await waitReady(env.page, 400);
      }
      else await load(env, path);
      await rules(env, path, res);
      res.libs = await libs(env.cdp);
      res.start = await sig(env.page);
    });
    if (!res.start) return;
    if (want('sweep')) await guard(env.R, `${S}/sweep`, async () => { res.sweep = await sweep(env, path, res.start); });
    if (want('pins')) await guard(env.R, `${S}/pins`, async () => { res.pins = await pins(env); });
    if (want('keys') && !env.touch) await guard(env.R, `${S}/keys`, async () => { res.keys = await keys(env, res.start); });
    await harvest(env);
    res.stuck = env.stuck;
    env.R.current = S;
    stuckIssues(env);
  } finally { await env.page.close(); }
}

/* ---------------- edge-case scenarios (home-centred) ---------------- */
// the page as it stands must be coherent: layout mode for this width, pins holding/releasing cleanly, no sideways scroll, nothing hidden in view
async function consistency(page) {
  return page.evaluate((bp) => {
    const out = [], pins = __qa.pins(), pil = __qa.pillars(), desktop = innerWidth > bp && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (desktop && pil?.static) out.push(`the pillars are stuck in the stacked layout at ${innerWidth}px (no horizontal track)`);
    if (desktop && document.querySelector('#hero') && !pins.some((p) => p.id === 'hero')) out.push(`hero pin missing at ${innerWidth}px`);
    if (!desktop && pins.length) out.push(`${pins.length} pinned scene(s) (${pins.map((p) => p.id)}) on the stacked layout at ${innerWidth}px`);
    if (!desktop && pil && !pil.static) out.push(`pillars keep the horizontal track on the stacked layout at ${innerWidth}px`);
    for (const p of pins) {
      const n = __qa.pinNow(p.id), start = p.st ? p.st.start : p.top, end = p.st ? p.st.end : p.top + p.dist;
      if (p.st && Math.abs(p.dist - (end - start)) > 3) out.push(`${p.id}: pin spacing ${p.dist}px but scroll distance ${end - start}px`);
      if (scrollY > start + 1 && scrollY < end - 1 && Math.abs(n.rect.y) > 2) out.push(`${p.id}: pinned scene at ${n.rect.y}px instead of 0`);
      if (n.nextTop != null && scrollY >= end) { const g = n.rect.y + n.rect.h - n.nextTop; if (Math.abs(g) > 2) out.push(`${p.id}: ${g > 0 ? 'overlaps' : 'gap before'} the next section by ${Math.abs(g)}px`); }
    }
    const o = __qa.overflow();
    if (o.canScrollX) out.push(`page scrolls sideways (scrollWidth ${o.scrollWidth} > ${o.innerWidth})`);
    __qa.hiddenInView().forEach((h) => out.push(`hidden in view: ${h.el} (${h.reason})`));
    return out;
  }, BREAKPOINT);
}
const report = (env, check, problems, shotPath, prefix = '') => problems.forEach((p) => issue(env, 'fail', check, `${prefix}${p}`, { shot: shotPath }));

// one client-side navigation, filmed: black frames, loader on a soft navigation, final state
async function hop(env, act, name) {
  const { page } = env;
  const [n0, lf0] = await page.evaluate(() => [__qa.log.filter((e) => e.type === 'astro:page-load').length, __qa.loaderAfterNav]);
  let info = {};
  const t0 = Date.now();
  const frames = await film(env, async () => {
    info = (await act()) || {};
    await page.waitForFunction((n) => __qa.log.filter((e) => e.type === 'astro:page-load').length > n, n0, { timeout: 10000, polling: 50 });
    await sleep(700);
  });
  await settle(page);
  await sleep(1300);
  const st = await page.evaluate((lf0) => ({ path: location.pathname + location.hash, y: Math.round(scrollY), loaderFrames: __qa.loaderAfterNav - lf0 }), lf0);
  const res = { ...info, ...st, ms: Date.now() - t0, black: await blackFrames(env, frames, name), shot: await shot(env, name) };
  if (st.loaderFrames) issue(env, 'fail', 'router', `${name}: the loading screen painted during a client-side navigation (${st.loaderFrames} frames)`);
  if (res.black.length) issue(env, 'warn', 'router', `${name}: black frame(s) during the transition`, { shot: res.black[0].shot });
  if (info.menuOpened === false) issue(env, 'fail', 'router', `${name}: the mobile menu did not open (burger toggles a stale menu after a client-side navigation?)`);
  return res;
}
async function navTo(env, to) {
  const { page } = env;
  // the layout decides, not the pointer: an iPad Pro in landscape (touch, 1194 px) has the desktop nav and no burger
  if (env.w > BREAKPOINT) { await page.click(`.nav__links a[href="${to}"]`); return { via: 'nav link' }; }
  await page.click('.burger');
  await sleep(900);
  const menuOpened = await page.evaluate(() => { const m = document.querySelector('.menu'); return !!m && m.classList.contains('is-open') && getComputedStyle(m).visibility === 'visible'; });
  if (menuOpened) { await page.click(`.menu a[href="${to}"]`); return { via: 'mobile menu', menuOpened }; }
  await page.click('.burger').catch(() => {}); // close what did open, then still navigate through a footer link (also a ClientRouter link)
  await page.evaluate((to) => document.querySelector(`footer a[href="${to}"]`)?.click(), to);
  return { via: 'footer link (menu did not open)', menuOpened };
}

const EDGES = {
  async reload(env) {
    const { page } = env, out = {};
    for (const where of ['mid-page', 'pinned-hero']) {
      await load(env, '/');
      const y = await page.evaluate((w) => { const h = __qa.pins().find((p) => p.id === 'hero'); return Math.round(w === 'mid-page' ? __qa.maxScroll() / 2 : h ? h.top + h.dist / 2 : innerHeight * 0.5); }, where);
      await travel(env, 1, 'fast', (yy) => yy >= y);
      await sleep(1000);
      const fromY = await page.evaluate(() => Math.round(scrollY));
      await harvest(env);
      // the filmed second pass reloads from the same place again
      const l = await loader(env, `reload-${where}`, () => page.reload({ waitUntil: 'commit' }), async () => { await travel(env, 1, 'fast', (yy) => yy >= y); await sleep(1000); await page.reload({ waitUntil: 'commit' }); });
      await waitReady(page, 400);
      const s = await sig(page), diff = sigDiff(env.ref, s);
      out[where] = { fromY, loader: l, afterY: s.y, diff, shot: await shot(env, `reload-${where}-after`) };
      if (diff.length) issue(env, 'fail', 'reload', `after a reload at ${where} (y=${fromY}) the page differs from a fresh load: ${diff.join('; ')}`, { shot: out[where].shot });
    }
    out.brief = Object.entries(out).map(([k, v]) => `${k}: y ${v.fromY} -> ${v.afterY}, loader visible ${v.loader.loaderVisibleMs ?? '-'} ms, wipe worst ${v.loader.wipeFrames?.max ?? '-'} ms, [filmstrip](${v.loader.filmstrip})`).join(' · ');
    return out;
  },

  async router(env) {
    const { page, cdp } = env;
    await load(env, '/');
    const before = { ...(await libs(cdp)), listeners: await listeners(cdp), dom: await domCounters(cdp), sig: await sig(page) };
    const hops = [];
    for (const to of ['/services/', '/courses/']) hops.push(await hop(env, () => navTo(env, to), `router-to-${slug(to)}`));
    hops.push(await hop(env, () => page.goBack({ waitUntil: 'commit' }), 'router-back-1'));
    hops.push(await hop(env, () => page.goBack({ waitUntil: 'commit' }), 'router-back-2'));
    const after = { ...(await libs(cdp)), listeners: await listeners(cdp), dom: await domCounters(cdp), sig: await sig(page) };
    const grew = Object.entries(after.listeners).filter(([k, n]) => n > (before.listeners[k] || 0)).map(([k, n]) => `${k} ${before.listeners[k] || 0}->${n}`);
    // one earlier page held by GSAP's cached body is a known, fixed residue; more than the home's own size again = pages leak
    if (before.dom && after.dom && after.dom.nodes > before.dom.nodes * 2) issue(env, 'warn', 'router', `DOM nodes after GC: ${before.dom.nodes} on the first load, ${after.dom.nodes} after 4 navigations (visited pages stay in memory)`);
    const diff = sigDiff(before.sig, after.sig);
    if (hops.at(-1).path !== '/') issue(env, 'fail', 'router', `two history steps back did not return to / (at ${hops.at(-1).path})`);
    if (before.scrollTriggers !== after.scrollTriggers) issue(env, 'fail', 'router', `ScrollTriggers: ${before.scrollTriggers} on the first load, ${after.scrollTriggers} after index -> services -> courses -> back -> back`);
    if (before.lenisInstances !== (env.reduced ? 0 : 1) || after.lenisInstances !== before.lenisInstances) issue(env, 'fail', 'router', `Lenis instances: ${before.lenisInstances} on load, ${after.lenisInstances} after the navigations`);
    if (grew.length) issue(env, 'warn', 'router', `event listeners grew after 4 navigations: ${grew.join(', ')}`);
    if (diff.length) issue(env, 'fail', 'router', `home after the round trip differs from its first load: ${diff.join('; ')}`, { shot: hops.at(-1).shot });
    if (before.sig.lenis !== after.sig.lenis) issue(env, 'info', 'router', `the <html> Lenis classes are ${after.sig.lenis ? 'back' : 'gone'} after the navigations (the view-transition swap resets <html> attributes; Lenis re-adds them on the next scroll)`);
    // the returned page must still animate end to end
    const down = await travel(env, 1, 'fast');
    await sleep(1600);
    const bottom = { problems: await consistency(page), shot: await shot(env, 'router-home-bottom') };
    await travel(env, -1, 'fast');
    await sleep(1500);
    const again = sigDiff(before.sig, await sig(page));
    if (down.blockedAt != null) issue(env, 'fail', 'router', `after the navigations the home page stops scrolling at y=${down.blockedAt}`);
    report(env, 'router', bottom.problems, bottom.shot, 'after the navigations, at the page end: ');
    if (again.length) issue(env, 'fail', 'router', `after the navigations, a scroll round trip does not return to the first state: ${again.join('; ')}`);
    const brief = `ScrollTriggers ${before.scrollTriggers} -> ${after.scrollTriggers} · Lenis ${before.lenisInstances} -> ${after.lenisInstances} · listeners grew: ${grew.join(', ') || 'none'} · DOM nodes after GC ${before.dom?.nodes ?? '-'} -> ${after.dom?.nodes ?? '-'} · via ${hops[0].via}`;
    return { brief, before, after, grew, hops, bottom, again };
  },

  async history(env) {
    const { page } = env;
    await load(env, '/');
    const refPins = await page.evaluate(() => __qa.pins());
    await travel(env, 1, 'realistic', (y) => y >= env.h * 2.5);
    await sleep(1200);
    const leftAt = await page.evaluate(() => Math.round(scrollY));
    const go = await hop(env, () => navTo(env, '/services/'), 'history-to-services');
    await travel(env, 1, 'realistic', (y) => y >= env.h);
    go.servicesY = await page.evaluate(() => Math.round(scrollY));
    const back = await hop(env, () => page.goBack({ waitUntil: 'commit' }), 'history-back');
    back.problems = await consistency(page);
    const nowPins = await page.evaluate(() => __qa.pins());
    back.pinDiff = refPins.map((p) => { const n = nowPins.find((q) => q.id === p.id); return !n ? `${p.id} pin missing` : Math.abs(n.spacerH - p.spacerH) > 3 ? `${p.id} spacer ${p.spacerH} -> ${n.spacerH}` : null; }).filter(Boolean);
    const fwd = await hop(env, () => page.goForward({ waitUntil: 'commit' }), 'history-forward');
    fwd.problems = await consistency(page);
    // Back again without scrolling the page that was just shown (restore used to work only after a scroll there)
    const back2 = await hop(env, () => page.goBack({ waitUntil: 'commit' }), 'history-back-unscrolled');
    back2.problems = await consistency(page);
    if (back.path !== '/') issue(env, 'fail', 'history', `Back did not return to / (at ${back.path})`);
    if (fwd.path !== '/services/') issue(env, 'fail', 'history', `Forward did not return to /services/ (at ${fwd.path})`);
    report(env, 'history', [...back.problems, ...back.pinDiff], back.shot, `back at / (y=${back.y}, left at y=${leftAt}): `);
    report(env, 'history', fwd.problems, fwd.shot, `forward at /services/ (y=${fwd.y}): `);
    report(env, 'history', back2.problems, back2.shot, `second Back at / (y=${back2.y}): `);
    for (const [label, b] of [['Back', back], ['Back without scrolling /services/', back2]]) if (Math.abs(b.y - leftAt) > 50) issue(env, 'fail', 'history', `${label} returns to / at y=${b.y}, the visitor had left it at y=${leftAt} (scroll position not restored)`, { shot: b.shot });
    if (Math.abs(fwd.y - go.servicesY) > 50) issue(env, 'fail', 'history', `Forward returns to /services/ at y=${fwd.y}, it was left at y=${go.servicesY}`, { shot: fwd.shot });
    return { brief: `left / at y=${leftAt}, Back -> ${back.path} y=${back.y}, Forward -> ${fwd.path} y=${fwd.y} (left at ${go.servicesY}), Back unscrolled -> y=${back2.y}`, leftAt, go, back, fwd, back2 };
  },

  // leave mid-page for another document (a full navigation, not the ClientRouter) and come Back: restored from the
  // back/forward cache, the page must be where it was left and keep scrolling and animating
  async bfcache(env) {
    const { page, cdp } = env;
    await load(env, '/');
    const target = await page.evaluate(() => Math.round(__qa.maxScroll() * 0.45));
    await travel(env, 1, 'fast', (y) => y >= target);
    await sleep(1000);
    const leftAt = await page.evaluate(() => Math.round(scrollY));
    const why = [], onNot = (e) => why.push(...e.notRestoredExplanations.map((x) => x.reason));
    await cdp.send('Page.enable');
    cdp.on('Page.backForwardCacheNotUsed', onNot);
    await harvest(env);
    await page.goto(`${env.base}/robots.txt`);
    await sleep(800);
    await page.goBack({ waitUntil: 'commit' });
    await waitReady(page, 1200);
    cdp.off('Page.backForwardCacheNotUsed', onNot);
    const back = { ...(await page.evaluate(() => ({ persisted: __qa.log.some((e) => e.type === 'pageshow' && e.persisted), y: Math.round(scrollY) }))), problems: await consistency(page), shot: await shot(env, 'bfcache-back') };
    if (!back.persisted) issue(env, 'info', 'bfcache', `Back from another document reloaded / instead of restoring it from the back/forward cache (${why.join(', ') || 'no reason reported'})`);
    else if (Math.abs(back.y - leftAt) > 50) issue(env, 'fail', 'bfcache', `restored from the back/forward cache at y=${back.y}, the visitor left at y=${leftAt}`, { shot: back.shot });
    report(env, 'bfcache', back.problems, back.shot, `after Back (${back.persisted ? 'bfcache' : 'reloaded'}, y=${back.y}): `);
    // two screens on (back up if the page ends sooner: at the end there is nothing left to scroll, not a stuck page)
    const dirn = back.y + env.h * 2 <= (await page.evaluate(() => __qa.maxScroll())) ? 1 : -1, goal = back.y + dirn * env.h * 2;
    const down = await travel(env, dirn, 'realistic', (y) => (dirn > 0 ? y >= goal : y <= goal));
    await sleep(1600);
    const later = { y: await page.evaluate(() => Math.round(scrollY)), problems: await consistency(page), shot: await shot(env, 'bfcache-scrolled') };
    if (down.blockedAt != null) issue(env, 'fail', 'bfcache', `after Back the page stops scrolling at y=${down.blockedAt}`, { shot: later.shot });
    report(env, 'bfcache', later.problems, later.shot, `scrolling on after Back (y=${later.y}): `);
    await backToStart(env, 'bfcache', later.shot);
    return { brief: `left / at y=${leftAt} for /robots.txt, Back: ${back.persisted ? 'restored from the bfcache' : `reloaded (${why.join(', ') || '?'})`} at y=${back.y}, then scrolled to y=${later.y}`, leftAt, back, later, why };
  },

  async anchor(env) {
    const { page } = env, out = {};
    // where a section landed: at the top, its heading clear of the nav (same rule for every jump)
    const where = (id) => page.evaluate((id) => { const s = document.querySelector(id), h = s?.querySelector('h2'); return { id, path: location.pathname + location.hash, y: Math.round(scrollY), top: s ? Math.round(s.getBoundingClientRect().top) : null, headTop: h ? Math.round(h.getBoundingClientRect().top) : null, navH: Math.round(document.querySelector('.nav').getBoundingClientRect().height), vh: innerHeight }; }, id);
    const judge = (label, s, sev) => {
      if (s.top == null) issue(env, 'fail', 'anchor', `${label}: ${s.id} not found (at ${s.path})`, { shot: s.shot });
      else if (s.top < -4 || s.top > s.vh * 0.4) issue(env, sev, 'anchor', `${label}: lands at y=${s.y}, ${s.id} is ${s.top}px from the top instead of at the top`, { shot: s.shot });
      else if (s.headTop != null && s.headTop < s.navH - 2) issue(env, 'warn', 'anchor', `${label}: the ${s.id} heading is under the nav (${s.headTop}px < ${s.navH}px)`, { shot: s.shot });
    };
    // 'About us' from another page, from its top and from further down (the pin spacers and Lenis must not shorten the jump)
    for (const [k, from] of [['router', 0], ['routerScrolled', 1600]]) {
      await load(env, '/services/');
      if (from) { await travel(env, 1, 'fast', (y) => y >= from); await sleep(800); }
      const fromY = await page.evaluate(() => Math.round(scrollY));
      out[k] = await hop(env, () => navTo(env, '/#about'), `anchor-from-services-y${from}`);
      Object.assign(out[k], await where('#about'), { fromY, problems: await consistency(page) });
      judge(`nav link /#about from /services/ at y=${fromY}`, out[k], 'fail');
      report(env, 'anchor', out[k].problems, out[k].shot, `after /#about from y=${fromY}: `);
    }
    await load(env, '/#about');
    out.direct = { ...(await where('#about')), problems: await consistency(page), shot: await shot(env, 'anchor-direct-load') };
    judge('direct load of /#about', out.direct, 'warn');
    report(env, 'anchor', out.direct.problems, out.direct.shot, 'direct /#about: ');
    // home -> another page's section: the pillar 02 call to action links to /services/#scanning
    await load(env, '/');
    if (await page.evaluate(() => !!document.querySelector('a[href="/services/#scanning"]'))) {
      out.cross = await hop(env, () => page.evaluate(() => document.querySelector('a[href="/services/#scanning"]').click()), 'anchor-home-to-scanning');
      Object.assign(out.cross, await where('#scanning'));
      judge('/services/#scanning from the home', out.cross, 'fail');
    }
    // in-page jump links, clicked at the top and after scrolling a little (they used to be pulled back near the top)
    for (const from of [0, 160]) {
      await load(env, '/services/');
      if (from) { await travel(env, 1, 'realistic', (y) => y >= from); await sleep(600); }
      const id = await page.evaluate(() => (document.querySelector('.jump a[href="#scanning"]') || document.querySelector('.jump a'))?.getAttribute('href'));
      if (!id) break;
      // a visitor taps a link they can see: Playwright's own scroll-into-view lands in the same frame as its click, before
      // the 'scroll' event reaches Lenis (target = stale position + rect, 400-600 px too far on touch)
      if (await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top < (document.querySelector('.nav')?.offsetHeight || 0) || r.bottom > innerHeight; }, `.jump a[href="${id}"]`)) {
        await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), `.jump a[href="${id}"]`);
        await sleep(600);
      }
      const fromY = await page.evaluate(() => Math.round(scrollY));
      await page.click(`.jump a[href="${id}"]`);
      await settle(page);
      await sleep(1200);
      const s = (out[`inPage${from}`] = { ...(await where(id)), fromY, shot: await shot(env, `anchor-in-page-y${from}`) });
      judge(`in-page link ${id} on /services/ clicked at y=${fromY}`, s, 'fail');
    }
    const b = (s) => (s ? `${s.id} at ${s.top}px (y=${s.y})` : '-');
    out.brief = `/#about from /services/ y=0: ${b(out.router)} · from y=${out.routerScrolled?.fromY}: ${b(out.routerScrolled)} · direct /#about: ${b(out.direct)} · home -> /services/#scanning: ${b(out.cross)} · .jump from y=0: ${b(out.inPage0)}, from y=${out.inPage160?.fromY}: ${b(out.inPage160)}`;
    return out;
  },

  async resize(env) {
    const { page, w, h } = env, steps = [];
    await load(env, '/');
    const y = await page.evaluate(() => { const p = __qa.pins().find((p) => p.id === 'pillars'); return Math.round(p ? p.top + p.dist / 2 : __qa.maxScroll() * 0.4); });
    await travel(env, 1, 'fast', (yy) => yy >= y);
    await sleep(1200);
    // touch: rotate and back. Desktop: another desktop size, across the 1180 breakpoint, back to the start size
    const sizes = env.touch ? [[h, w], [w, h]] : [[w === 1280 ? 1440 : 1280, w === 1280 ? 900 : 720], [1024, 768], [w, h]];
    for (const [W, H] of sizes) {
      await page.setViewportSize({ width: W, height: H });
      await sleep(env.slow(1800)); // breakpoint reboot is debounced 150 ms, ScrollTrigger refresh 200 ms
      await settle(page);
      await sleep(600);
      const s = { size: `${W}x${H}`, ...(await page.evaluate(() => ({ y: Math.round(scrollY), pins: __qa.pins().map((p) => p.id), static: __qa.pillars()?.static ?? null }))), problems: await consistency(page) };
      s.shot = await shot(env, `resize-${W}x${H}`);
      if (s.y < 100) s.problems.push(`the reader was thrown to the top (y ${y} -> ${s.y})`); // crossing 1180 px once reset the page
      report(env, 'resize', s.problems, s.shot, `${s.size}: `);
      steps.push(s);
    }
    await backToStart(env, 'resize', steps.at(-1).shot);
    return { brief: steps.map((s) => `${s.size}: y=${s.y}, pins ${s.pins.join('+') || 'none'}, ${s.problems.length} problem(s)`).join(' · '), startY: y, steps };
  },

  async theme(env) {
    const { page } = env;
    await load(env, '/');
    const target = await page.evaluate(() => __qa.maxScroll() * 0.4);
    await travel(env, 1, 'fast', (y) => y >= target);
    await sleep(1200);
    const state = () => page.evaluate(() => ({ y: Math.round(scrollY), h: document.documentElement.scrollHeight, theme: document.documentElement.dataset.theme }));
    const b = await state(), shotBefore = await shot(env, 'theme-before');
    await toggleTheme(env);
    await sleep(1000);
    await settle(page);
    const a = await state(), problems = await consistency(page), shotAfter = await shot(env, 'theme-after');
    await toggleTheme(env);
    await sleep(800);
    const restored = await state();
    if (a.theme === b.theme) issue(env, 'fail', 'theme', `the theme did not change (${a.theme})`, { shot: shotAfter });
    if (Math.abs(a.y - b.y) > 2) issue(env, 'fail', 'theme', `toggling the theme moved the page from y=${b.y} to y=${a.y}`, { shot: shotAfter });
    if (Math.abs(a.h - b.h) > 2) issue(env, 'warn', 'theme', `toggling the theme changed the page height ${b.h} -> ${a.h}`);
    if (restored.theme !== b.theme) issue(env, 'fail', 'theme', 'the second toggle did not restore the theme');
    report(env, 'theme', problems, shotAfter, 'after the theme toggle: ');
    return { brief: `${b.theme} -> ${a.theme} -> ${restored.theme} at y=${b.y} (after: y=${a.y}, height ${b.h} -> ${a.h})`, before: b, after: a, restored, problems, shotBefore, shotAfter };
  },

  async visibility(env) {
    const { page, cdp } = env;
    await load(env, '/');
    const v0 = (await page.evaluate(() => __qa.hero()))?.video;
    if (!v0 || v0.display === 'none') return { skipped: 'no visible hero video on this layout' };
    if (env.reduced) return { skipped: 'reduced motion: the hero video stays on its poster by design', paused: v0.paused };
    await page.waitForFunction(() => { const v = document.querySelector('#hero video'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 8000 }).catch(() => {});
    const playing = (await page.evaluate(() => __qa.hero())).video;
    let mode = 'simulated';
    try { // a real hidden tab: minimising the window works in headed Chrome; headless keeps the page visible
      const { targetInfo } = await cdp.send('Target.getTargetInfo');
      const b = await env.browser.newBrowserCDPSession();
      const { windowId } = await b.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
      await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      await sleep(600);
      if (await page.evaluate(() => document.hidden)) { mode = 'real (window minimised)'; await sleep(2500); }
      await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await b.detach();
    } catch {}
    if (mode === 'simulated') {
      // what Chrome does to a background tab: document hidden + the muted video paused, then visible again
      await page.evaluate(() => { const d = document; Object.defineProperty(d, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => 'hidden' }); d.querySelector('#hero video').pause(); d.dispatchEvent(new Event('visibilitychange')); });
      await sleep(2000);
      await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    }
    await sleep(1500);
    const after = (await page.evaluate(() => __qa.hero())).video;
    // the scroll scene must still respond
    await page.mouse.move(4, env.h / 2);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 100); await sleep(60); }
    await settle(page);
    await sleep(900);
    const h1 = await page.evaluate(() => __qa.hero()), s = await shot(env, 'visibility-after');
    if (!playing.playing || playing.paused) issue(env, 'warn', 'visibility', 'the hero video was not playing before the tab was hidden');
    if (after.paused) issue(env, 'fail', 'visibility', `the hero video stays paused after the tab becomes visible again (${mode})`, { shot: s });
    if (h1.pinned && h1.copy > 0.95) issue(env, 'fail', 'visibility', 'the hero scrub does not respond to the wheel after the visibility change', { shot: s });
    return { brief: `${mode}: video ${playing.paused ? 'paused' : 'playing'} -> hidden -> ${after.paused ? 'PAUSED' : 'playing'}, hero copy ${h1.copy} after the wheel`, mode, before: playing, after, copyAfterWheel: h1.copy, shot: s };
  },

  async fling(env) {
    const { page } = env;
    await load(env, '/');
    const down = await measured(env, () => travel(env, 1, 'fling'));
    await sleep(1600);
    const bottom = { ...(await page.evaluate(() => ({ y: Math.round(scrollY), atEnd: scrollY >= __qa.maxScroll() - 2 }))), problems: await consistency(page), shot: await shot(env, 'fling-bottom') };
    const up = await measured(env, () => travel(env, -1, 'fling'));
    await sleep(1500);
    const diff = sigDiff(env.ref, await sig(page)), top = await shot(env, 'fling-top');
    if (down.blockedAt != null) issue(env, 'fail', 'fling', `a very fast fling stops at y=${down.blockedAt}`);
    if (!bottom.atEnd) issue(env, 'fail', 'fling', `the fling did not reach the end (y=${bottom.y})`, { shot: bottom.shot });
    report(env, 'fling', bottom.problems, bottom.shot, 'after a fling to the end: ');
    if (diff.length) issue(env, 'fail', 'fling', `after flinging back up the top differs from a fresh load: ${diff.join('; ')}`, { shot: top });
    const f = (m) => (m.frames ? `p95 ${m.frames.p95} / worst ${m.frames.max} ms` : '-');
    return { brief: `down ${f(down)} -> y=${bottom.y}${bottom.atEnd ? ' (end)' : ''} · up ${f(up)}`, down, bottom, up, diff, top };
  },

  async zoom(env) {
    if (env.touch) return { skipped: 'browser zoom is a desktop scenario' };
    const { page, cdp, w, h } = env, steps = [];
    await load(env, '/');
    const target = await page.evaluate(() => __qa.maxScroll() * 0.4);
    await travel(env, 1, 'fast', (y) => y >= target);
    await sleep(1000);
    const step = async (zoom) => {
      await sleep(env.slow(2000));
      await settle(page);
      const s = { zoom, ...(await page.evaluate(() => ({ css: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio, y: Math.round(scrollY), pins: __qa.pins().map((p) => p.id) }))), problems: await consistency(page) };
      s.shot = await shot(env, `zoom-${zoom}`);
      report(env, 'zoom', s.problems, s.shot, `zoom ${zoom}% (${s.css} css px): `);
      steps.push(s);
    };
    // browser zoom = fewer CSS pixels + a higher device pixel ratio, applied mid-scroll
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / 1.25), height: Math.round(h / 1.25), deviceScaleFactor: 1.25, mobile: false });
    env.zoomed = true;
    await step(125);
    env.zoomed = false;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); // setViewportSize() is a no-op here: Playwright thinks the size never changed
    await step(100);
    await backToStart(env, 'zoom', steps.at(-1).shot);
    return { brief: steps.map((s) => `${s.zoom}%: ${s.css} css px @${s.dpr}x, pins ${s.pins.join('+') || 'none'}, ${s.problems.length} problem(s)`).join(' · '), steps };
  },
};
// after a resize/zoom round trip, the top of the page must look like a fresh load at the original size
async function backToStart(env, check, shotPath) {
  await toY(env.page, 0);
  await settle(env.page);
  await sleep(1500);
  const d = sigDiff(env.ref, await sig(env.page));
  if (d.length) issue(env, 'fail', check, `back at ${env.w}x${env.h}, the top differs from a fresh load: ${d.join('; ')}`, { shot: shotPath });
}
async function toggleTheme(env) {
  const { page } = env;
  if (env.w > BREAKPOINT) return page.click('.nav .theme-toggle');
  await page.click('.burger');
  await sleep(900);
  if (await page.evaluate(() => document.querySelector('.menu')?.classList.contains('is-open'))) await page.click('.menu .theme-toggle');
  else await page.evaluate(() => document.querySelector('.menu .theme-toggle')?.click());
  await sleep(300);
  await page.click('.burger');
  await sleep(900);
}

/* ---------------- runner ---------------- */
async function guard(R, label, fn) {
  R.current = label;
  const t = Date.now();
  try { await fn(); } catch (e) {
    R.issues.push({ sev: 'fail', check: 'harness', at: label, msg: `scenario crashed: ${String(e.message || e).split('\n')[0]}` });
    console.log(`    ! ${label}: ${String(e.message || e).split('\n')[0]}`);
  }
  console.log(`    ${label} ${((Date.now() - t) / 1000).toFixed(0)} s`);
}
async function openEnv(ctx, base, label) {
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), R = base.R, media = [];
  if (base.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: base.cpu });
  if (base.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[base.net] }); }
  const at = () => R.current;
  page.on('pageerror', (e) => R.errors.push({ kind: 'pageerror', at: at(), msg: String(e.message || e).slice(0, 300) }));
  // /favicon.ico is only asked for by the robots.txt warm-up (every site page declares its icon); routing it instead would disable the HTTP cache
  page.on('console', (m) => m.type() === 'error' && !/\/favicon\.ico$/.test(m.location()?.url || '') && R.errors.push({ kind: 'console', at: at(), msg: `${m.text().slice(0, 300)}${m.location()?.url ? ` (${m.location().url})` : ''}` }));
  // ERR_ABORTED = cancelled, not missing: a video paused off-screen, or a page fetch/prefetch superseded by the next navigation
  page.on('requestfailed', (q) => R.errors.push({ kind: 'request', at: at(), msg: `${q.failure()?.errorText} ${q.url()} (${q.resourceType()})`, benign: /ERR_ABORTED/.test(q.failure()?.errorText || '') && ['media', 'fetch', 'other', 'document'].includes(q.resourceType()) }));
  page.on('response', (s) => s.status() >= 400 && R.errors.push({ kind: 'http', at: at(), msg: `${s.status()} ${s.url()}` }));
  page.on('request', (q) => q.resourceType() === 'media' && media.push(q.url()));
  const dir = join(base.comboDir, label.split('/')[0]);
  mkdirSync(dir, { recursive: true });
  return { ...base, page, cdp, media, dir, stuck: [] };
}
async function runCombo(browser, apage, url, runDir, c) {
  const R = { id: c.id, viewport: c.vp, size: [c.w, c.h], touch: c.touch, motion: c.motion, cpu: c.cpu, net: c.net || null, pages: {}, edge: {}, errors: [], issues: [], current: '' };
  const newCtx = async () => {
    const x = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.touch ? 2 : 1, isMobile: c.touch, hasTouch: c.touch, reducedMotion: c.motion });
    await x.addInitScript({ path: join(HERE, 'inpage.js') });
    return x;
  };
  const base = { ...c, R, base: url, apage, browser, runDir, comboDir: join(runDir, c.id), slow: (ms) => (c.cpu > 1 ? ms * 1.6 : ms) };
  // every page in its own context: each first visit is cold (in one shared context the second page loaded warm)
  for (const path of c.pages) { const pctx = await newCtx(); try { await runPage(pctx, base, path); } finally { await pctx.close(); } }
  const ctx = await newCtx();
  try {
    const edges = EDGE.filter(want);
    if (edges.length) {
      if (!R.pages['/']?.start) await guard(R, 'edge/reference', async () => { const env = await openEnv(ctx, base, 'edge/reference'); try { await load(env, '/'); R.pages['/'] = { start: await sig(env.page) }; } finally { await env.page.close(); } });
      base.ref = R.pages['/']?.start;
      for (const name of edges) {
        await guard(R, `edge/${name}`, async () => {
          const env = await openEnv(ctx, base, `edge/${name}`);
          try {
            R.edge[name] = await EDGES[name](env);
            await harvest(env);
            R.edge[name].stuck = env.stuck;
            stuckIssues(env);
          } finally { await env.page.close(); }
        });
      }
    }
  } finally { await ctx.close(); }
  const seen = new Map();
  R.errors.forEach((e) => { const k = `${e.kind}|${e.msg}`; if (!seen.has(k)) seen.set(k, { ...e, n: 0 }); seen.get(k).n++; });
  seen.forEach((e) => R.issues.push({ sev: e.benign ? 'info' : 'fail', check: e.kind, at: e.at, msg: `${e.msg}${e.n > 1 ? ` (x${e.n})` : ''}` }));
  delete R.current;
  return R;
}

/* ---------------- summary ---------------- */
function summary(run) {
  const L = [], all = run.combos.flatMap((c) => c.issues), n = (s) => all.filter((i) => i.sev === s).length;
  const ms = (v) => (v == null ? '-' : `${v} ms`);
  L.push(`# Motion QA · ${run.name}`, '');
  L.push(`${run.started.slice(0, 16).replace('T', ' ')} UTC · ${run.git.branch}@${run.git.commit}${run.git.dirty ? ' (uncommitted changes)' : ''} · reviews ${run.options.reviews ? 'on' : 'off'} · ${run.options.headed ? 'headed' : 'headless'} Chrome · network ${run.options.net || 'local (unthrottled)'} · scenarios: ${[...SCEN].join(', ')}`, '');
  L.push(`**${n('fail')} FAIL · ${n('warn')} WARN** in ${run.combos.length} combination(s).${run.finished ? '' : ' (run still in progress)'} Frame times are noisy on a shared 4-core PC: compare runs and repeat anything suspicious.`, '');
  for (const c of run.combos) {
    L.push(`## ${c.id}`, '', '| Where | Measurements |', '|---|---|');
    for (const [p, r] of Object.entries(c.pages)) {
      const l = r.loader;
      if (l) L.push(`| ${p} loading screen | first paint ${ms(l.firstPaint)} · is-done ${ms(l.doneAt)} · wipe ${ms(l.wipeStartAt)} to ${l.wipeEndAt != null ? ms(l.wipeEndAt) : l.wipeStartAt != null ? 'no transitionend' : '-'} (loader visible ${ms(l.loaderVisibleMs)}) · wipe frames p95 ${ms(l.wipeFrames?.p95)}, worst ${ms(l.wipeFrames?.max)}, dropped ${l.wipeFrames?.dropped ?? '-'} · CLS ${l.cls} (after reveal ${l.clsAfterReveal}) · [filmstrip](${l.filmstrip}) |`);
      for (const k of ['realisticDown', 'realisticUp', 'fastDown', 'fastUp']) {
        const f = r.sweep?.[k]?.frames;
        if (f) L.push(`| ${p} scroll ${k} | ${f.frames} frames (${f.refreshHz} Hz) · p50 ${f.p50} · p95 ${f.p95} · worst ${f.max} ms · dropped at 60 Hz ${f.dropped} · long tasks ${r.sweep[k].longTasks} |`);
      }
      if (r.sweep) L.push(`| ${p} stops | ${r.sweep.stops.length} screenshots · footer ${r.sweep.footerReached ? 'reached' : 'NOT reached'} |`);
      r.pins?.forEach((q) => L.push(`| ${p} pin #${q.id} | ${q.top}..${q.top + q.dist}px · ${q.problems.length ? `${q.problems.length} problem(s)` : 'ok'} · [start](${q.states.before.shot}) [mid](${q.states.mid.shot}) [end](${q.states.endIn.shot}) |`));
      if (r.keys) L.push(`| ${p} keyboard | PageDown/Space ${r.keys.blockedAt != null ? `blocked at ${r.keys.blockedAt}` : 'ok'} · End ${r.keys.endReached ? 'ok' : 'NOT reached'} · Tab through ${r.keys.tab?.focused ?? '-'} controls, ${r.keys.tab?.problems.length ?? '-'} problem(s) |`);
    }
    for (const [k, e] of Object.entries(c.edge)) L.push(`| edge ${k} | ${e.skipped ? `skipped: ${e.skipped}` : e.brief || 'ran'} |`);
    L.push('');
    const iss = c.issues.filter((i) => i.sev !== 'info');
    if (!iss.length) L.push('No issues.');
    iss.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'fail' ? -1 : 1)).forEach((i) => L.push(`- **${i.sev.toUpperCase()}** \`${i.at}\` [${i.check}] ${i.msg}${i.shot ? ` ([shot](${i.shot}))` : ''}`));
    const info = c.issues.filter((i) => i.sev === 'info');
    if (info.length) L.push('', `Info: ${info.map((i) => i.msg).join(' · ')}`);
    L.push('');
  }
  return L.join('\n');
}

/* ---------------- self-test of the detectors ---------------- */
async function selftest() {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, reducedMotion: 'no-preference' });
    await ctx.addInitScript({ path: join(HERE, 'inpage.js') });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(join(HERE, 'selftest.html')).href);
    // the late reveal is timed from the watcher start, not from parse: a slow load must not shrink its 1.5 s in view
    await page.evaluate(() => { __qa.watch(); __qa.activity.start(); setTimeout(() => { document.getElementById('late').style.opacity = 1; }, 2400); });
    await sleep(3300);
    const r = await page.evaluate(() => ({ stuck: __qa.stuck.filter((s) => s.revealedAfterMs == null).map((s) => s.el), late: __qa.stuck.filter((s) => s.revealedAfterMs != null).map((s) => s.el), overflow: __qa.overflow(), fixed: __qa.fixedOverlap().map((f) => f.el), pins: __qa.pins(), activity: __qa.activity.stop().map((a) => a.el), frames: __qa.frameStats(0, performance.now()), sig: __qa.signature(), ghosts: __qa.ghosts() }));
    // these move focus and layout, so they run last
    Object.assign(r, await page.evaluate(() => {
      const b = document.getElementById('bordered'), before = JSON.stringify(__qa.boxes());
      b.style.transform = 'translateY(30px)';
      const boxesStable = JSON.stringify(__qa.boxes()) === before;
      b.style.transform = '';
      document.getElementById('farlink').focus();
      const sideways = __qa.focusState();
      document.getElementById('invisfocus').focus();
      return { boxesStable, sideways, invisible: __qa.focusState() };
    }));
    const has = (list, s) => list.some((x) => x.includes(s));
    const gh = (s) => r.ghosts.find((g) => g.el.includes(s));
    const a = { path: '/', y: 0, h: 100, pins: [], hero: null, pillars: null, hiddenInView: 0 };
    const checks = [
      ['stuck reveal (opacity 0)', has(r.stuck, '#stuck')],
      ['stuck split text (parts at opacity 0)', has(r.stuck, '#split')],
      ['stuck counter (still 0)', has(r.stuck, '#count')],
      ['stuck clip-path reveal', has(r.stuck, '#clip')],
      ['visible reveal is not flagged', !has([...r.stuck, ...r.late], '#fine')],
      ['late reveal told apart from a stuck one', has(r.late, '#late') && !has(r.stuck, '#late')],
      ['sideways scroll', r.overflow.canScrollX],
      ['content cut by the screen edge', has(r.overflow.cut.map((c) => c.el), 'wide')],
      ['floating button covering a link', has(r.fixed, '#under')],
      ['pin overlapping the next section', pinStatic(r.pins[0] || { dist: 1 }).length > 0],
      ['JS animation activity', has(r.activity, '#anim')],
      ['frame clock running', !!r.frames && r.frames.frames > 30],
      ['state signature + diff', !!r.sig && sigDiff(a, { ...a, y: 50, hiddenInView: 1 }).length === 2 && sigDiff(a, a).length === 0],
      ['invisible link taking the clicks of a visible button (FAIL)', !!gh('#ghost')?.over && !gh('#under')],
      ['invisible link over blank space told apart (WARN, entrance not played)', gh('#pending')?.over === null],
      ['layout boxes unchanged by a transformed, bordered ancestor', r.boxesStable],
      ['focus scrolling an overflow:hidden box sideways', r.sideways?.scrolled.some((s) => s.includes('#clipbox'))],
      ['focus on an invisible element', r.invisible?.opacity < 0.05 && r.invisible.el.includes('#invisfocus')],
    ];
    checks.forEach(([name, ok]) => console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`));
    return checks.every(([, ok]) => ok);
  } finally { await browser.close(); }
}

/* ---------------- main ---------------- */
async function main() {
  if (o.selftest) process.exit((await selftest()) ? 0 : 1);
  const name = o.out || new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const runDir = isAbsolute(name) ? name : join(HERE, 'out', name);
  mkdirSync(runDir, { recursive: true });
  const pages = o.pages.split(',').map((p) => `/${unMsys(p.trim()).replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/'));
  // WxH is a mouse viewport, touch:WxH a touch one (an iPad Pro landscape, 1194x834, gets the pinned desktop layout on touch)
  const vps = o.viewports.split(',').map((v) => v.trim()).map((v) => { const m = /^(touch:)?(\d+)x(\d+)$/.exec(v); const [w, h] = m ? [+m[2], +m[3]] : VIEWPORTS[v] || []; if (!w) throw new Error(`unknown viewport ${v} (${Object.keys(VIEWPORTS).join(', ')}, WxH or touch:WxH)`); return { vp: v.replace(':', '-'), w, h, touch: !!m?.[1] || /^(tablet|phone)/.test(v) }; });
  if (o.net && !NET[o.net]) throw new Error(`--net must be one of ${Object.keys(NET).join(', ')}, got ${o.net}`);
  const motions = o.motion.split(',').map((m) => m.trim());
  motions.forEach((m) => { if (!['no-preference', 'reduce'].includes(m)) throw new Error(`--motion must be no-preference and/or reduce, got ${m}`); });
  const cpus = o.cpu.split(',').map(Number);
  const qaDist = join(HERE, 'out', `.dist-${o.reviews ? 'reviews' : 'default'}`);
  let dist = qaDist;
  if (!o['no-build']) build(qaDist, o.reviews);
  else if (!existsSync(qaDist)) { dist = join(ROOT, 'dist'); console.log(`--no-build: no QA build for this variant, serving ${dist}`); }
  // the libraries manifest lives on the hosting (content panel, git-ignored): give the QA build one so /exocad-libraries/
  // behaves as in production instead of logging a 404 and a console error on every run
  const manifest = join(dist, 'downloads', 'libraries', 'latest.json');
  if (dist === qaDist && !existsSync(manifest)) { mkdirSync(dirname(manifest), { recursive: true }); writeFileSync(manifest, JSON.stringify({ version: '9.9.9-qa', dataDate: '2026-11-01', file: 'qa-fixture.zip', bytes: 44040192 })); }
  const server = await serve(dist);
  console.log(`serving ${dist} at ${server.url}`);
  const run = { name, started: new Date().toISOString(), git: gitInfo(), options: { ...o, pages, dist }, combos: [] };
  const write = () => { writeFileSync(join(runDir, 'report.json'), JSON.stringify(run, null, 1)); writeFileSync(join(runDir, 'summary.md'), summary(run)); };
  const browser = await launch();
  const apage = await (await browser.newContext({ viewport: { width: 1180, height: 400 } })).newPage(); // filmstrips + frame analysis, never throttled
  try {
    for (const v of vps) for (const motion of motions) for (const cpu of cpus) {
      const c = { ...v, motion, reduced: motion === 'reduce', cpu, net: o.net, pages, id: `${v.vp}-${v.w}x${v.h}-${motion === 'reduce' ? 'reduced' : 'motion'}-cpu${cpu}${o.net ? `-${o.net}` : ''}` };
      console.log(`\n${c.id}`);
      run.combos.push(await runCombo(browser, apage, server.url, runDir, c));
      write(); // a power cut keeps every finished combination
    }
  } finally {
    run.finished = new Date().toISOString();
    write();
    await browser.close().catch(() => {});
    server.stop();
  }
  const all = run.combos.flatMap((c) => c.issues);
  console.log(`\n${all.filter((i) => i.sev === 'fail').length} FAIL, ${all.filter((i) => i.sev === 'warn').length} WARN -> ${join(runDir, 'summary.md')}`);
  process.exit(all.some((i) => i.sev === 'fail') ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
