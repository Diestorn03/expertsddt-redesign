// Inner-page scenarios the shared harness (qa.mjs) does not cover. Same Chrome, same probes (inpage.js), same QA build.
//   dialog   /exocad-libraries/ download dialog: open/close (Esc, x, backdrop), focus, scroll lock (wheel/touch), Lenis after close, submit
//   router   inner -> inner ClientRouter hops (nav links / burger menu / footer / language link): menu opens, entrances run, nothing stuck
//   anchors  in-page links (/services/ .jump, /courses/ #catalog) clicked at the top AND after scrolling a little: where they land
//   prevent  /contact/ form has data-lenis-prevent: wheel over it vs elsewhere (smooth vs native steps)
//   videos   autoplaying loops with prefers-reduced-motion
//   resize   [data-split="lines"] headings after a width change that does not cross 1180 px (rotation / window resize)
// node scenarios/inner/inner.mjs --out inner-custom [--only dialog,router] [--viewports desktop,phone] [--motion no-preference,reduce] [--lang en,es]
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const QA = join(HERE, '..', '..');
const ROOT = join(QA, '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VP = { desktop: [1440, 900], laptop: [1280, 720], tablet: [768, 1024], 'tablet-land': [1024, 768], phone: [390, 844], 'phone-small': [375, 667] };
const { values: o } = parseArgs({ options: {
  out: { type: 'string', default: 'inner-custom' }, only: { type: 'string', default: 'dialog,router,anchors,prevent,videos,resize' },
  viewports: { type: 'string', default: 'desktop,phone' }, motion: { type: 'string', default: 'no-preference,reduce' }, lang: { type: 'string', default: 'en' },
} });
const ONLY = new Set(o.only.split(','));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runDir = join(QA, 'out', o.out);
mkdirSync(runDir, { recursive: true });
const issues = [], results = {};
const issue = (env, sev, scen, msg, shotPath) => { issues.push({ sev, combo: env.id, scen, msg, shot: shotPath }); console.log(`    ${sev.toUpperCase()} ${scen}: ${msg}`); };

/* ---------- server (same as qa.mjs: astro preview of the QA build) ---------- */
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function serve(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/astro/bin/astro.mjs'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--outDir', dir, '--ignore-lock'], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => child.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${url}/`)).ok) return { url, stop: () => child.kill() }; } catch {} await sleep(200); }
  child.kill(); throw new Error('astro preview did not start');
}

/* ---------- helpers ---------- */
async function shot(env, name) {
  const file = join(env.dir, `${name}.jpg`);
  await env.page.screenshot({ path: file, type: 'jpeg', quality: 70, scale: 'css' }).catch(() => {});
  return relative(runDir, file).replace(/\\/g, '/');
}
async function ready(page, extra = 1600) {
  await page.waitForFunction(() => window.__qa && document.readyState === 'complete' && !document.getElementById('loader'), null, { timeout: 20000, polling: 100 });
  await sleep(extra);
}
const settle = (page) => page.evaluate(() => __qa.settle());
const Y = (page) => page.evaluate(() => Math.round(scrollY));
async function wheel(page, x, y, n, dy = 100, gap = 80) { await page.mouse.move(x, y); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap); } }
async function swipe(env, x, y0, y1, ms = 260) {
  const steps = Math.max(4, Math.round(ms / 16));
  await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }] }); }
  await env.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}
const tapOrClick = (env, sel) => (env.touch ? env.page.tap(sel) : env.page.click(sel));
// ScrollTrigger + Lenis live in ES modules: find them on the heap (same trick as qa.mjs)
async function libs(cdp) {
  const { result: fp } = await cdp.send('Runtime.evaluate', { expression: 'Function.prototype' });
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: fp.objectId, objectGroup: 'qa' });
  await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: `function () { const lib = window.__qaLib = window.__qaLib || {}; for (const f of this) try {
    if (!lib.ScrollTrigger && typeof f.getAll === 'function' && typeof f.batch === 'function' && typeof f.scrollerProxy === 'function') lib.ScrollTrigger = f;
    else if (!lib.Lenis && f.prototype && typeof f.prototype.scrollTo === 'function' && typeof f.prototype.hasNestedScroll === 'function') lib.Lenis = f; } catch {} }` });
  let lenis = null;
  const { result: lp } = await cdp.send('Runtime.evaluate', { expression: 'window.__qaLib.Lenis && window.__qaLib.Lenis.prototype' });
  if (lp.objectId) {
    const { objects: inst } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: lp.objectId, objectGroup: 'qa' });
    // expose the instance so scenarios can read its internal state (read-only)
    lenis = (await cdp.send('Runtime.callFunctionOn', { objectId: inst.objectId, returnByValue: true, functionDeclaration: 'function () { window.__qaLenis = this[0]; return this.length; }' })).result.value;
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'qa' });
  const st = await cdp.send('Runtime.evaluate', { expression: 'window.__qaLib.ScrollTrigger ? window.__qaLib.ScrollTrigger.getAll().length : null', returnByValue: true });
  return { scrollTriggers: st.result.value, lenis };
}
// composited frames while fn runs, then share of near-black pixels per sampled frame
async function film(env, fn) {
  const frames = [];
  const on = (f) => { frames.push({ at: Date.now(), data: f.data }); env.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); };
  env.cdp.on('Page.screencastFrame', on);
  await env.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: Math.min(env.w, 720), maxHeight: Math.min(env.h, 720) });
  try { await fn(); } finally { await env.cdp.send('Page.stopScreencast').catch(() => {}); env.cdp.off('Page.screencastFrame', on); }
  return frames;
}
async function blackFrames(env, frames, name) {
  const step = Math.ceil(frames.length / 60) || 1, sample = frames.filter((_, i) => i % step === 0);
  const b = await env.apage.evaluate(async (list) => {
    const out = [];
    for (const b64 of list) {
      const img = new Image(); img.src = `data:image/jpeg;base64,${b64}`; await img.decode();
      const c = new OffscreenCanvas(48, Math.max(1, Math.round((48 * img.height) / img.width))), g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data; let k = 0;
      for (let i = 0; i < d.length; i += 4) if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] < 8) k++;
      out.push(+(k / (d.length / 4)).toFixed(3));
    }
    return out;
  }, sample.map((f) => f.data));
  const bad = sample.map((f, i) => ({ f, black: b[i] })).filter((x) => x.black > 0.25);
  if (!bad.length) return null;
  const w = bad.reduce((a, c) => (c.black > a.black ? c : a));
  const file = join(env.dir, `${name}-black.jpg`);
  writeFileSync(file, Buffer.from(w.f.data, 'base64'));
  return { n: bad.length, worst: w.black, shot: relative(runDir, file).replace(/\\/g, '/') };
}
// per-frame scrollY trace recorded by inpage.js since t (performance.now based)
const trace = (page, t) => page.evaluate((t) => { const out = []; for (let i = 0; i < __qa.ft.length; i++) if (__qa.ft[i] >= t) out.push(Math.round(__qa.fy[i])); return out; }, t);

/* ---------- scenarios ---------- */
const S = {};

S.dialog = async (env, path) => {
  const { page } = env, r = { path };
  await page.route('**/downloads/libraries/latest.json', (q) => q.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9-qa', dataDate: '2026-11-01', file: 'qa-fixture.zip', bytes: 44040192 }) }));
  await page.route('**/downloads/libraries/qa-fixture.zip', (q) => q.fulfill({ contentType: 'application/zip', body: 'PK\u0005\u0006' + '\0'.repeat(18) }));
  const downloads = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.goto(env.base + path);
  await ready(page);
  await libs(env.cdp);
  const st = () => page.evaluate(() => {
    const d = document.getElementById('lib-dialog'), b = d.getBoundingClientRect(), a = document.activeElement;
    return { y: Math.round(scrollY), open: d.open, rect: [b.x, b.y, b.width, b.height].map(Math.round), vw: innerWidth, vh: innerHeight, innerScroll: d.scrollHeight > d.clientHeight + 1,
      html: document.documentElement.className, lenisStopped: window.__qaLenis ? window.__qaLenis.isStopped : null, overscroll: getComputedStyle(d).overscrollBehaviorY, overflow: getComputedStyle(d).overflowY,
      focus: a ? (a.name || a.getAttribute('data-lib-open') !== null && 'opener' || a.className || a.tagName) : null, version: document.querySelector('[data-lib-version]')?.textContent || '' };
  });
  r.before = await st();
  if (!r.before.version) issue(env, 'warn', 'dialog', 'the version line under the button stayed empty although the manifest answered (fetch at page-load?)');
  // 1) open, wheel / swipe over the dialog and over the backdrop: the page behind must not move
  await tapOrClick(env, '[data-lib-open]');
  await sleep(500);
  r.open = await st();
  r.openShot = await shot(env, 'dialog-open');
  if (!r.open.open) { issue(env, 'fail', 'dialog', 'the dialog did not open', r.openShot); return r; }
  if (r.open.focus !== 'name') issue(env, 'warn', 'dialog', `focus is on ${r.open.focus} after opening, not the name field`, r.openShot);
  const [dx, dy, dw, dh] = r.open.rect;
  if (dx < 0 || dy < 0 || dx + dw > r.open.vw || dy + dh > r.open.vh) issue(env, 'warn', 'dialog', `the dialog does not fit the screen (${r.open.rect.join(',')} in ${r.open.vw}x${r.open.vh}, inner scroll ${r.open.innerScroll})`, r.openShot);
  const cx = Math.round(dx + dw / 2), cy = Math.round(dy + Math.min(dh * 0.35, 120)); // on the dialog's text, not an input
  const bx = Math.max(4, Math.round(dx / 2)), by = Math.round(r.open.vh * 0.85); // backdrop (left margin, low)
  if (!env.touch) {
    await wheel(page, cx, cy, 6); await settle(page); r.afterDialogWheel = await Y(page);
    await wheel(page, bx, by, 6); await settle(page); r.afterBackdropWheel = await Y(page);
    await page.keyboard.press('PageDown'); await sleep(400); await settle(page); r.afterPageDown = await Y(page);
  } else {
    await swipe(env, cx, cy + 80, cy - 40); await settle(page); r.afterDialogWheel = await Y(page);
    await swipe(env, bx, by, by - 300); await settle(page); r.afterBackdropWheel = await Y(page);
  }
  r.scrolledShot = await shot(env, 'dialog-after-wheel');
  const seq = [['over the dialog', r.open.y, r.afterDialogWheel], ['over the backdrop', r.afterDialogWheel, r.afterBackdropWheel], ['PageDown in the name field', r.afterBackdropWheel, r.afterPageDown]];
  const moved = seq.filter(([, a, b]) => b != null && Math.abs(b - a) > 2);
  if (moved.length) issue(env, 'warn', 'dialog', `the page behind the open dialog scrolls (${env.touch ? 'swipe' : 'wheel'} ${moved.map(([k, a, b]) => `${k}: y ${a} -> ${b}`).join(', ')}); html="${r.open.html}", dialog overflow ${r.open.overflow}/overscroll ${r.open.overscroll}, Lenis stopped ${r.open.lenisStopped}`, r.scrolledShot);
  // 2) Esc closes, focus back on the opener, page scrolls again
  await page.keyboard.press('Escape');
  await sleep(300);
  r.esc = await st();
  if (r.esc.open) issue(env, 'fail', 'dialog', 'Escape did not close the dialog');
  if (r.esc.focus !== 'opener') issue(env, 'warn', 'dialog', `focus after Escape is on ${r.esc.focus}, not the button that opened it`);
  const y0 = await Y(page);
  if (!env.touch) await wheel(page, 8, Math.round(env.h / 2), 4); else await swipe(env, Math.round(env.w * 0.3), env.h * 0.8, env.h * 0.4);
  await settle(page);
  r.scrollAfterClose = (await Y(page)) - y0;
  if (r.scrollAfterClose < 50 && y0 < (await page.evaluate(() => __qa.maxScroll())) - 60) issue(env, 'fail', 'dialog', `after closing the dialog the page does not scroll (moved ${r.scrollAfterClose}px), html="${(await st()).html}"`);
  await page.evaluate(() => scrollTo(0, 0)); await settle(page); await sleep(300);
  // 3) close button and backdrop click
  await tapOrClick(env, '[data-lib-open]'); await sleep(400);
  await tapOrClick(env, '[data-lib-close]'); await sleep(300);
  r.closeBtn = (await st()).open === false;
  await tapOrClick(env, '[data-lib-open]'); await sleep(400);
  if (env.touch) await page.touchscreen.tap(bx, by); else await page.mouse.click(bx, by);
  await sleep(300);
  r.backdrop = (await st()).open === false;
  if (!r.closeBtn) issue(env, 'fail', 'dialog', 'the x button did not close the dialog');
  if (!r.backdrop) issue(env, 'warn', 'dialog', 'a click on the backdrop did not close the dialog');
  if (!r.backdrop) { await page.keyboard.press('Escape'); await sleep(300); }
  // 4) submit with test data: success note, download, dialog stays coherent
  await tapOrClick(env, '[data-lib-open]'); await sleep(400);
  await page.fill('#lib-dialog input[name=name]', 'QA Test');
  await page.fill('#lib-dialog input[name=email]', 'qa@example.test');
  const before = (await st()).rect;
  await page.click('#lib-dialog button[type=submit]');
  await sleep(1200);
  r.submit = { ...(await st()), note: await page.evaluate(() => { const n = document.querySelector('.lib-note'); return { cls: n.className, text: n.textContent.trim().slice(0, 80) }; }), downloads: [...downloads] };
  r.submitShot = await shot(env, 'dialog-submitted');
  if (!/is-ok/.test(r.submit.note.cls)) issue(env, 'warn', 'dialog', `submit did not reach the success state: "${r.submit.note.text}" (${r.submit.note.cls})`, r.submitShot);
  if (Math.abs(before[1] - r.submit.rect[1]) > 30) issue(env, 'warn', 'dialog', `the dialog jumped ${r.submit.rect[1] - before[1]}px vertically when the note changed`, r.submitShot);
  await page.keyboard.press('Escape'); await sleep(300);
  // 5) reopen after a submit: idle note restored, form empty
  await tapOrClick(env, '[data-lib-open]'); await sleep(400);
  r.reopen = await page.evaluate(() => ({ note: document.querySelector('.lib-note').className, name: document.querySelector('#lib-dialog input[name=name]').value }));
  await page.keyboard.press('Escape'); await sleep(300);
  if (r.reopen.note !== 'lib-note' || r.reopen.name) issue(env, 'warn', 'dialog', `reopened dialog not reset (note ${r.reopen.note}, name "${r.reopen.name}")`);
  return r;
};

// one ClientRouter hop, filmed; then the state of the new page
async function hop(env, act, name) {
  const { page } = env;
  const n0 = await page.evaluate(() => __qa.log.filter((e) => e.type === 'astro:page-load').length);
  let info = {};
  const frames = await film(env, async () => {
    info = (await act()) || {};
    await page.waitForFunction((n) => __qa.log.filter((e) => e.type === 'astro:page-load').length > n, n0, { timeout: 10000, polling: 50 });
    await sleep(1500);
  });
  await settle(page);
  const s = await page.evaluate(() => {
    const nav = document.querySelector('.nav'), lang = nav.querySelector('.nav__lang'), alt = document.querySelector(`link[rel="alternate"][hreflang="${lang?.getAttribute('hreflang')}"]`);
    const cur = [...nav.querySelectorAll('.nav__links a[aria-current="page"]')].map((a) => a.getAttribute('href'));
    return { path: location.pathname, y: Math.round(scrollY), hidden: __qa.hiddenInView(), html: document.documentElement.className, navClass: nav.className, menus: document.querySelectorAll('#menu').length,
      current: cur, langHref: lang?.getAttribute('href'), langWant: alt ? new URL(alt.href).pathname : null, title: document.title };
  });
  const black = await blackFrames(env, frames, name);
  const res = { name, ...info, ...s, frames: frames.length, black, shot: await shot(env, name) };
  if (info.menuOpened === false) issue(env, 'fail', 'router', `${name}: tapping the burger on ${info.from} did not open the mobile menu (${info.stale})`, info.staleShot);
  if (s.hidden.length) issue(env, 'fail', 'router', `${name}: ${s.hidden.length} element(s) still hidden in view 1.5 s after the navigation: ${s.hidden.slice(0, 4).map((h) => `${h.el} [${h.reason}]`).join(' | ')}`, res.shot);
  if (black) issue(env, 'warn', 'router', `${name}: ${black.n} black frame(s) during the transition (worst ${Math.round(black.worst * 100)}%)`, black.shot);
  if (s.y > 2 && info.via !== 'back') issue(env, 'warn', 'router', `${name}: the new page starts at y=${s.y}, not at the top`, res.shot); // Back restores the old position
  if (/lenis-stopped/.test(s.html)) issue(env, 'fail', 'router', `${name}: scroll is still locked (lenis-stopped) on the new page`, res.shot);
  if (s.langWant && s.langHref !== s.langWant) issue(env, 'warn', 'router', `${name}: language link points to ${s.langHref}, expected ${s.langWant}`);
  return res;
}
async function navTo(env, href, from) {
  const { page } = env;
  if (!env.touch && env.w > 1180) {
    const sel = `.nav__links a[href="${href}"]`;
    if (await page.$(sel)) { await page.click(sel); return { via: 'nav link', from }; }
    await page.evaluate((h) => document.querySelector(`footer a[href="${h}"]`).click(), href); return { via: 'footer link', from };
  }
  await page.tap('.burger').catch(() => page.click('.burger'));
  await sleep(900);
  const m = await page.evaluate(() => { const m = document.querySelector('.menu'); return { open: !!m && m.classList.contains('is-open') && getComputedStyle(m).visibility === 'visible', burger: document.querySelector('.burger').getAttribute('aria-expanded'), html: document.documentElement.className, nav: document.querySelector('.nav').className }; });
  if (m.open) { await page.tap(`.menu a[href="${href}"]`); return { via: 'mobile menu', from, menuOpened: true }; }
  const staleShot = await shot(env, `router-burger-dead-on-${from.replace(/\//g, '_')}`);
  const stale = `burger aria-expanded=${m.burger}, nav "${m.nav}", html "${m.html}", menu not visible`;
  await page.tap('.burger').catch(() => {});
  await sleep(500);
  await page.evaluate((h) => document.querySelector(`footer a[href="${h}"]`)?.click(), href);
  return { via: 'footer link (menu did not open)', from, menuOpened: false, stale, staleShot };
}
S.router = async (env, lang) => {
  const { page } = env, p = (x) => (lang === 'es' ? `/es${x}` : x);
  await page.goto(env.base + p('/services/'));
  await ready(page);
  await page.evaluate(() => __qa.watch());
  const before = await libs(env.cdp);
  const hops = [];
  for (const [to, from] of [[p('/courses/'), p('/services/')], [p('/store/'), p('/courses/')], [p('/exocad-libraries/'), p('/store/')], [p('/contact/'), p('/exocad-libraries/')]]) hops.push(await hop(env, () => navTo(env, to, from), `router-to-${to.replace(/\//g, '_')}`));
  // footer legal link after scrolling to the bottom of /contact/
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page); await sleep(600);
  hops.push(await hop(env, async () => { await page.evaluate((h) => document.querySelector(`footer a[href="${h}"]`).click(), p('/privacy-policy/')); return { via: 'footer link', from: p('/contact/') }; }, 'router-footer-legal'));
  hops.push(await hop(env, () => page.goBack({ waitUntil: 'commit' }).then(() => ({ via: 'back' })), 'router-back-1'));
  hops.push(await hop(env, () => page.goBack({ waitUntil: 'commit' }).then(() => ({ via: 'back' })), 'router-back-2'));
  const after = await libs(env.cdp);
  // a fresh load of the page we ended on: same number of ScrollTriggers
  const endPath = hops.at(-1).path;
  const fresh = await env.ctx.newPage(); const fcdp = await env.ctx.newCDPSession(fresh);
  await fresh.goto(env.base + endPath); await ready(fresh, 1200);
  const ref = await libs(fcdp); await fresh.close();
  if (after.scrollTriggers !== ref.scrollTriggers) issue(env, 'fail', 'router', `ScrollTriggers on ${endPath}: ${after.scrollTriggers} after 7 navigations vs ${ref.scrollTriggers} on a fresh load`);
  if (!env.reduced && after.lenis !== 1) issue(env, 'fail', 'router', `Lenis instances after the navigations: ${after.lenis}`);
  // the page we came back to must scroll to its end with every reveal done
  const max = await page.evaluate(() => __qa.maxScroll());
  for (let i = 0; i < 60 && (await Y(page)) < max - 2; i++) { if (env.touch) await swipe(env, Math.round(env.w * 0.3), env.h * 0.85, env.h * 0.3, 120); else { await page.mouse.move(8, env.h / 2); await page.mouse.wheel(0, 400); await sleep(60); } }
  await settle(page); await sleep(1700);
  const stuck = await page.evaluate(() => __qa.stuck.filter((s) => s.revealedAfterMs == null));
  stuck.forEach((s) => issue(env, 'fail', 'router', `stuck reveal after client-side navigation on ${s.path}: ${s.el} (${s.reason}) for ${s.inViewMs} ms`));
  return { before, after, ref, hops: hops.map(({ name, via, path, y, menuOpened, black, hidden, shot: sh, current, langHref, langWant }) => ({ name, via, path, y, menuOpened, black, hidden: hidden.length, shot: sh, current, langHref, langWant })) };
};

// in-page links: Astro's router (document click listener, registered first) jumps natively; motion.js then calls lenis.scrollTo
S.anchors = async (env) => {
  const { page } = env, out = [];
  const cases = [['/services/', '.jump a:nth-child(3)'], ['/courses/', '.courses-hero .btn[href="#catalog"]']];
  for (const [path, sel] of cases) for (const pre of [0, 160]) {
    await page.goto(env.base + path); await ready(page); await libs(env.cdp);
    if (pre) { if (env.touch) await swipe(env, Math.round(env.w * 0.3), env.h * 0.6, env.h * 0.6 - pre, 200); else await wheel(page, 8, env.h / 2, 2, pre / 2, 80); await settle(page); await sleep(400); }
    const y0 = await Y(page);
    const href = await page.$eval(sel, (a) => a.getAttribute('href'));
    const t = await page.evaluate(() => performance.now());
    if (env.touch) await page.tap(sel); else await page.click(sel);
    await sleep(2200); await settle(page);
    const tr = await trace(page, t);
    const end = await page.evaluate((h) => { const s = document.querySelector(h), hd = s.querySelector('h2, h3'); return { y: Math.round(scrollY), top: Math.round(s.getBoundingClientRect().top), head: hd ? Math.round(hd.getBoundingClientRect().top) : null, nav: Math.round(document.querySelector('.nav').getBoundingClientRect().height), hash: location.hash }; }, href);
    const peak = Math.max(...tr), r = { path, href, from: y0, ...end, peak, frames: tr.length, trace: tr.filter((_, i) => i % 3 === 0).slice(0, 40) };
    r.shot = await shot(env, `anchor${path.replace(/\//g, '_')}from-${y0}`);
    const want = await page.evaluate((h) => Math.round(document.querySelector(h).getBoundingClientRect().top + scrollY) - 70, href);
    if (Math.abs(end.top) > 120 && !(end.y >= (await page.evaluate(() => __qa.maxScroll())) - 2)) issue(env, 'fail', 'anchors', `${path} ${href} clicked at y=${y0}: ends at y=${end.y} with the section ${end.top}px from the top (expected y~${want})${peak - end.y > 200 ? `; it first jumped to y=${peak} and was pulled back` : ''}`, r.shot);
    else if (end.head != null && end.head < end.nav - 2) issue(env, 'warn', 'anchors', `${path} ${href}: heading under the nav (${end.head}px < ${end.nav}px)`, r.shot);
    out.push(r);
  }
  return out;
};

// wheel with the pointer over a data-lenis-prevent area vs elsewhere: per-frame scroll steps
S.prevent = async (env) => {
  if (env.touch || env.reduced) return { skipped: 'wheel + Lenis only' };
  const { page } = env, out = {};
  await page.goto(env.base + '/contact/'); await ready(page); await libs(env.cdp);
  const form = await page.$eval('#contact-form', (f) => { const r = f.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  const book = await page.$eval('.booking', (f) => { const r = f.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height].map(Math.round); });
  for (const [k, box] of [['booking card', book], ['contact form', form]]) {
    await page.evaluate((y) => scrollTo(0, y), Math.max(0, box[1] - 200)); await sleep(300); await settle(page); await sleep(300);
    const y0 = await Y(page), t = await page.evaluate(() => performance.now());
    await wheel(page, box[0] + box[2] / 2, 300, 3, 100, 120); await sleep(900); await settle(page);
    const tr = await trace(page, t), steps = tr.slice(1).map((v, i) => v - tr[i]).filter((d) => d !== 0);
    out[k] = { from: y0, to: tr.at(-1), movingFrames: steps.length, maxStep: Math.max(...steps.map(Math.abs)), steps: steps.slice(0, 30) };
  }
  // mixed: start a smooth wheel over the booking card, continue over the form while Lenis is still animating
  await page.evaluate((y) => scrollTo(0, y), Math.max(0, book[1] - 100)); await sleep(300); await settle(page);
  const t = await page.evaluate(() => performance.now());
  await wheel(page, book[0] + book[2] / 2, 400, 2, 100, 60);
  await wheel(page, form[0] + form[2] / 2, 400, 3, 100, 60);
  await sleep(900); await settle(page);
  const tr = await trace(page, t), back = tr.slice(1).map((v, i) => v - tr[i]).filter((d) => d < -1);
  out.mixed = { from: tr[0], to: tr.at(-1), reversals: back.length, worstReversal: back.length ? Math.min(...back) : 0, frames: tr.length };
  // the empty message box itself: a scroll container the page must still scroll through (data-lenis-prevent on it got
  // overscroll-behavior: contain from lenis.css, and the wheel there moved nothing)
  await page.evaluate(() => { const t = document.querySelector('#contact-form textarea'); scrollTo(0, t.getBoundingClientRect().top + scrollY - 300); }); await sleep(300); await settle(page); await sleep(300);
  const ta = await page.$eval('#contact-form textarea', (t) => { const r = t.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2].map(Math.round); });
  const ty0 = await Y(page);
  await wheel(page, ta[0], ta[1], 3, 100, 120); await sleep(900); await settle(page);
  out.textarea = { from: ty0, to: await Y(page) };
  if (out.textarea.to - ty0 < 50) issue(env, 'fail', 'prevent', `wheel with the pointer on the empty message box does not scroll the page (y ${ty0} -> ${out.textarea.to}): the textarea's data-lenis-prevent gets overscroll-behavior: contain from lenis.css`, await shot(env, 'prevent-textarea'));
  const a = out['booking card'], b = out['contact form'];
  if (b.maxStep > a.maxStep * 2.5 && b.movingFrames < a.movingFrames / 2) issue(env, 'warn', 'prevent', `wheel over the contact form scrolls natively (${b.movingFrames} frames, steps up to ${b.maxStep}px) while the rest of the page is smoothed by Lenis (${a.movingFrames} frames, max ${a.maxStep}px): data-lenis-prevent on the whole form`);
  if (out.mixed.reversals) issue(env, 'warn', 'prevent', `moving the wheel from the booking card onto the form mid-scroll makes the page step backwards ${out.mixed.reversals} time(s) (worst ${out.mixed.worstReversal}px): Lenis' smooth scroll and the native scroll fight`);
  return out;
};

S.videos = async (env) => {
  const { page } = env, out = [];
  for (const path of ['/services/', '/courses/']) {
    await page.goto(env.base + path); await ready(page);
    const vids = await page.$$eval('main video', (vs) => vs.map((v, i) => ({ i, top: Math.round(v.getBoundingClientRect().top + scrollY) })));
    for (const v of vids) {
      await page.evaluate((y) => scrollTo(0, Math.max(0, y - 200)), v.top); await sleep(1500);
      const s = await page.evaluate((i) => { const v = document.querySelectorAll('main video')[i]; return { paused: v.paused, t: +v.currentTime.toFixed(2), loop: v.loop, src: v.currentSrc.split('/').pop() }; }, v.i);
      out.push({ path, ...s });
    }
  }
  const playing = out.filter((v) => !v.paused && v.t > 0.2);
  if (env.reduced && playing.length) issue(env, 'warn', 'videos', `${playing.length} looping video(s) autoplay with prefers-reduced-motion: ${playing.map((v) => `${v.path} ${v.src}`).join(', ')}`);
  return out;
};

// width change that does not cross the 1180 px breakpoint: nothing reboots, SplitText lines keep the old breaks
S.resize = async (env) => {
  const { page } = env, out = [];
  const sizes = env.touch ? [[env.h, env.w], [env.w, env.h]] : [[1100, 800], [800, 800], [1100, 800]];
  for (const path of ['/services/', '/store/']) {
    if (env.touch) await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] }); else await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(env.base + path); await ready(page);
    // scroll through once so every split heading has revealed
    await page.evaluate(async () => { for (let y = 0; y < __qa.maxScroll(); y += innerHeight / 2) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); });
    await sleep(1500);
    const steps = env.touch ? [sizes[1]] : sizes.slice(1);
    for (const [w, h] of steps) {
      await page.setViewportSize({ width: w, height: h }); await sleep(1500);
      const s = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('[data-split="lines"]').forEach((el) => {
          const box = el.getBoundingClientRect();
          el.querySelectorAll('.split-line').forEach((ln) => { const r = ln.getBoundingClientRect(); if (r.right > box.right + 2 || ln.scrollWidth > ln.clientWidth + 2) bad.push({ el: __qa.sel(el), line: ln.textContent.trim().slice(0, 30), right: Math.round(r.right), box: Math.round(box.right), sw: ln.scrollWidth, cw: ln.clientWidth }); });
          // lines that now wrap inside their mask: uneven ragged breaks
          el.querySelectorAll('.split-line').forEach((ln) => { const lh = parseFloat(getComputedStyle(ln).lineHeight) || 0; if (lh && ln.getBoundingClientRect().height > lh * 1.6) bad.push({ el: __qa.sel(el), line: ln.textContent.trim().slice(0, 30), wraps: Math.round(ln.getBoundingClientRect().height / lh) }); });
        });
        return { size: `${innerWidth}x${innerHeight}`, bad, overflow: __qa.overflow() };
      });
      const first = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-split="lines"]')].find(() => true); if (!e) return null; e.scrollIntoView({ block: 'center' }); return __qa.sel(e); });
      await sleep(400);
      s.shot = await shot(env, `resize${path.replace(/\//g, '_')}${w}x${h}`);
      s.first = first;
      out.push({ path, ...s });
      if (s.bad.length) issue(env, 'warn', 'resize', `${path} at ${s.size} after loading at another width: ${s.bad.length} split line(s) no longer fit (${s.bad.slice(0, 3).map((b) => `${b.el} "${b.line}" ${b.wraps ? `wraps x${b.wraps}` : `right ${b.right}>${b.box}`}`).join(' | ')})`, s.shot);
      if (s.overflow.canScrollX) issue(env, 'fail', 'resize', `${path} at ${s.size}: the page scrolls sideways`, s.shot);
    }
  }
  await page.setViewportSize({ width: env.w, height: env.h });
  return out;
};

/* ---------- runner ---------- */
const server = await serve(join(QA, 'out', '.dist-default'));
console.log(`serving at ${server.url}`);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const apage = await (await browser.newContext({ viewport: { width: 800, height: 400 } })).newPage();
try {
  for (const vp of o.viewports.split(',')) for (const motion of o.motion.split(',')) {
    const [w, h] = VP[vp], touch = /^(tablet|phone)/.test(vp), reduced = motion === 'reduce';
    const id = `${vp}-${w}x${h}-${reduced ? 'reduced' : 'motion'}`;
    console.log(`\n${id}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, reducedMotion: motion, acceptDownloads: true });
    await ctx.addInitScript({ path: join(QA, 'inpage.js') });
    results[id] = {};
    for (const name of ['dialog', 'router', 'anchors', 'prevent', 'videos', 'resize'].filter((n) => ONLY.has(n))) {
      for (const lang of name === 'dialog' || name === 'router' ? o.lang.split(',') : ['en']) {
        const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), dir = join(runDir, id, `${name}-${lang}`);
        mkdirSync(dir, { recursive: true });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
        const env = { id, w, h, touch, reduced, page, cdp, ctx, apage, dir, base: server.url };
        const t = Date.now();
        try {
          results[id][`${name}-${lang}`] = await S[name](env, name === 'dialog' ? (lang === 'es' ? '/es/exocad-libraries/' : '/exocad-libraries/') : lang);
        } catch (e) { issue(env, 'fail', 'harness', `${name}: scenario crashed: ${String(e.message || e).split('\n')[0]}`); }
        if (errors.length) results[id][`${name}-${lang}-errors`] = [...new Set(errors)];
        console.log(`    ${name}-${lang} ${((Date.now() - t) / 1000).toFixed(0)} s`);
        await page.close();
        writeFileSync(join(runDir, 'inner.json'), JSON.stringify({ issues, results }, null, 1));
      }
    }
    await ctx.close();
  }
} finally {
  writeFileSync(join(runDir, 'inner.json'), JSON.stringify({ issues, results }, null, 1));
  writeFileSync(join(runDir, 'summary.md'), [`# inner scenarios · ${o.out}`, '', ...issues.map((i) => `- **${i.sev.toUpperCase()}** \`${i.combo}\` [${i.scen}] ${i.msg}${i.shot ? ` ([shot](${i.shot}))` : ''}`)].join('\n'));
  await browser.close().catch(() => {});
  server.stop();
}
console.log(`\n${issues.filter((i) => i.sev === 'fail').length} FAIL, ${issues.filter((i) => i.sev === 'warn').length} WARN -> ${join(runDir, 'summary.md')}`);
process.exit(issues.some((i) => i.sev === 'fail') ? 1 : 0);
