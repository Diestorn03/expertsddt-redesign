// Long session: fresh home, scroll round trip, then N client-side navigations between pages, back home and the same scroll.
// Compares GSAP/ScrollTrigger/Lenis counts, event listeners (window, document, persisted nav controls, renderer total),
// heap and DOM nodes after GC, marquee writes per frame, magnetic tweens on the persisted nav button, frame times.
// usage: node scenarios/cross/long-session.mjs [--out cross-long-session] [--viewports desktop,phone] [--cpu 1] [--hops 15]
import { parseArgs } from 'node:util';
import { serve, launch, context, out, ready, settle, pageLoads, afterNav, scrollBy, libs, listeners, memory, diffCounts, sleep } from './lib.mjs';

const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'cross-long-session' }, viewports: { type: 'string', default: 'desktop,phone' }, cpu: { type: 'string', default: '1' }, hops: { type: 'string', default: '15' } } });
const PLAN = ['/services/', '/courses/', '/store/', '/exocad-libraries/', '/contact/', '/', '/services/', '/', '/courses/', '/contact/', '/', '/store/', '/services/', '/exocad-libraries/', '/'];
const { R, save, issue, shot } = out(o.out);
const server = await serve();
const browser = await launch();

async function snapshot(page, cdp, env) {
  const l = await libs(cdp);
  const lis = {
    window: await listeners(cdp, 'window'), document: await listeners(cdp, 'document'),
    navBook: await listeners(cdp, 'document.querySelector(".nav__book")'), burger: await listeners(cdp, 'document.querySelector(".burger")'),
    navTheme: await listeners(cdp, 'document.querySelector(".nav .theme-toggle")'),
  };
  const mem = await memory(cdp);
  const state = await page.evaluate(() => ({ sig: __qa.signature(), head: document.head.children.length, bodyKids: document.body.children.length, announcers: document.querySelectorAll('.astro-route-announcer').length, video: __qa.hero()?.video }));
  return { libs: l, listeners: lis, mem, state };
}
// hold the marquee in view for 2 s: style writes on its track per rendered frame (1 = one ticker, 2+ = duplicated tickers)
async function marquee(page, env) {
  await page.evaluate(() => { const m = document.querySelector('.marquee'); if (m) scrollTo({ top: m.getBoundingClientRect().top + scrollY - innerHeight / 2, behavior: 'instant' }); });
  await settle(page); await sleep(500);
  return page.evaluate(() => new Promise((res) => {
    const t = document.querySelector('.marquee__track'); if (!t) return res(null);
    let writes = 0, frames = 0, go = true;
    const mo = new MutationObserver((ms) => { writes += ms.length; });
    mo.observe(t, { attributes: true, attributeFilter: ['style'] });
    const f = () => { frames++; if (go) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    setTimeout(() => { go = false; mo.disconnect(); res({ writes, frames, perFrame: +(writes / Math.max(1, frames)).toFixed(2) }); }, 2000);
  }));
}
// pointer over the persisted nav "Book" button: how many GSAP tweens drive it (2 = one x + one y quickTo)
async function magnetic(page, env) {
  if (env.touch) return null;
  const b = await page.evaluate(() => { const r = document.querySelector('.nav__book').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(b.x - 6, b.y - 4); await sleep(60); await page.mouse.move(b.x + 6, b.y + 3, { steps: 4 }); await sleep(120);
  const n = await page.evaluate(() => { const el = document.querySelector('.nav__book'), root = window.__qaRoot; return root ? root.getChildren(true, true, false).filter((t) => t.targets().includes(el)).length : null; });
  await page.mouse.move(4, env.h / 2); await sleep(700);
  return n;
}
async function roundTrip(page, env, label) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settle(page); await sleep(800);
  const a = await page.evaluate(() => performance.now());
  await scrollUntilEnd(page, env, 1);
  const mid = await page.evaluate(() => performance.now());
  await sleep(1200);
  const bottom = await page.evaluate(() => ({ y: Math.round(scrollY), atEnd: scrollY >= __qa.maxScroll() - 2, hidden: __qa.hiddenInView(), video: __qa.hero()?.video }));
  await shot(page, `${env.id}-${label}-bottom`);
  await scrollUntilEnd(page, env, -1);
  const b = await page.evaluate(() => performance.now());
  await sleep(1500);
  return page.evaluate(([a, mid, b]) => ({ down: __qa.frameStats(a, mid), up: __qa.frameStats(mid + 1200, b), loafs: __qa.loafs.filter((l) => l.t >= a && l.t <= b && l.d > 80).map((l) => `${l.d}ms ${l.scripts.join(',') || 'style/layout/paint'}`).slice(0, 5) }), [a, mid, b]).then((f) => ({ ...f, bottom }));
}
async function scrollUntilEnd(page, env, dir) {
  if (!env.touch) await page.mouse.move(4, env.h / 2);
  let last = -1, still = 0;
  for (let i = 0; i < 2000; i++) {
    const [y, max] = await page.evaluate(() => [scrollY, __qa.maxScroll()]);
    if (dir > 0 ? y >= max - 2 : y <= 0) break;
    if (Math.abs(y - last) < 0.5) { if (++still > 40) return { blockedAt: Math.round(y) }; } else still = 0;
    last = y;
    if (!env.touch) { await page.mouse.wheel(0, dir * 100); await sleep(80); } else await scrollBy(page, env, dir * env.h * 0.45);
  }
  return settle(page);
}
async function go(page, env, to) {
  const n0 = await pageLoads(page);
  const via = await page.evaluate((to) => {
    const vis = (a) => { const r = a.getBoundingClientRect(), cs = getComputedStyle(a); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const cands = [
      ...(to === '/' ? [...document.querySelectorAll('.nav .logo')] : []),
      ...(to === '/contact/' ? [...document.querySelectorAll('.nav__book')] : []),
      ...document.querySelectorAll(`.nav__links a[href="${to}"]`),
    ].filter(vis);
    const a = cands[0] || document.querySelector(`footer a[href="${to}"]`);
    if (!a) return null;
    a.click();
    return a.closest('footer') ? 'footer link' : a.className || 'nav link';
  }, to);
  if (!via) throw new Error(`no link to ${to} on ${await page.evaluate(() => location.pathname)}`);
  await afterNav(page, n0);
  return via;
}

for (const vp of o.viewports.split(',')) for (const cpu of o.cpu.split(',').map(Number)) {
  const env = await context(browser, vp), id = `${vp}-cpu${cpu}`;
  env.id = id;
  console.log(id);
  const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
  const res = (R.results[id] = { hops: [] });
  try {
    await page.goto(`${server.url}/`);
    await ready(page);
    await page.evaluate(() => __qa.watch());
    res.freshTop = await snapshot(page, cdp, env);
    res.freshMagnetic = await magnetic(page, env);
    res.freshTrip = await roundTrip(page, env, 'fresh');
    res.freshMarquee = await marquee(page, env);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settle(page); await sleep(1500);
    res.freshAfterTrip = await snapshot(page, cdp, env);
    save();

    const plan = PLAN.slice(0, +o.hops);
    if (plan.at(-1) !== '/') plan.push('/');
    for (const [i, to] of plan.entries()) {
      const t0 = Date.now();
      const via = await go(page, env, to);
      const st = await page.evaluate(() => ({ path: location.pathname, y: Math.round(scrollY), loaderFrames: __qa.loaderAfterNav, loaderInDom: !!document.getElementById('loader') }));
      res.hops.push({ i: i + 1, to, via, ms: Date.now() - t0, ...st });
      if (st.path !== to) issue('fail', `${id} hop ${i + 1}`, `expected ${to}, at ${st.path}`);
      // a little reading on every page: the triggers of each page get created, fired and killed
      await scrollBy(page, env, env.h * 1.2);
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settle(page); await sleep(1500);
    res.afterTop = await snapshot(page, cdp, env);
    res.afterMagnetic = await magnetic(page, env);
    res.afterTrip = await roundTrip(page, env, 'after');
    res.afterMarquee = await marquee(page, env);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settle(page); await sleep(1500);
    res.afterAfterTrip = await snapshot(page, cdp, env);
    res.stuck = await page.evaluate(() => __qa.stuck.map(({ since, ...s }) => s));
    await shot(page, `${id}-after-top`);
    res.errors = errors;

    // verdicts
    const A = res.freshAfterTrip, B = res.afterAfterTrip, at = `${id} long session`;
    if (A.libs.scrollTriggers !== B.libs.scrollTriggers) issue('fail', at, `ScrollTriggers ${A.libs.scrollTriggers} -> ${B.libs.scrollTriggers} after ${plan.length} navigations`);
    if (B.libs.lenisInstances !== A.libs.lenisInstances) issue('fail', at, `Lenis instances ${A.libs.lenisInstances} -> ${B.libs.lenisInstances}`);
    if (B.libs.animations > A.libs.animations + 4) issue('fail', at, `GSAP animations alive ${A.libs.animations} -> ${B.libs.animations} (same page, same scroll)`);
    for (const k of ['window', 'document', 'navBook', 'burger', 'navTheme']) {
      const d = diffCounts(A.listeners[k] || {}, B.listeners[k] || {});
      if (d.length) issue('warn', at, `${k} listeners changed after ${plan.length} navigations: ${d.join(', ')}`);
    }
    const g = (B.mem.heapUsedMB - A.mem.heapUsedMB) / A.mem.heapUsedMB;
    if (g > 0.3) issue('fail', at, `JS heap after GC ${A.mem.heapUsedMB} MB -> ${B.mem.heapUsedMB} MB (+${Math.round(g * 100)} %)`);
    if (B.mem.jsEventListeners > A.mem.jsEventListeners * 1.1) issue('warn', at, `renderer JS event listeners ${A.mem.jsEventListeners} -> ${B.mem.jsEventListeners}`);
    if (B.mem.nodes > A.mem.nodes * 1.3) issue('warn', at, `DOM nodes after GC ${A.mem.nodes} -> ${B.mem.nodes}`);
    if (res.afterMarquee && res.freshMarquee && res.afterMarquee.perFrame > res.freshMarquee.perFrame + 0.5) issue('fail', at, `marquee writes per frame ${res.freshMarquee.perFrame} -> ${res.afterMarquee.perFrame} (duplicated tickers)`);
    if (res.afterMagnetic != null && res.afterMagnetic > (res.freshMagnetic || 0)) issue('warn', at, `GSAP tweens driving the persisted nav Book button on hover: ${res.freshMagnetic} on a fresh load, ${res.afterMagnetic} after ${plan.length} navigations (magnetic handlers stacked on the persisted header)`);
    const loaderHops = res.hops.filter((h) => h.loaderFrames || h.loaderInDom);
    if (loaderHops.length) issue('fail', at, `loader painted/in DOM after client navigations: ${loaderHops.map((h) => h.to).join(', ')}`);
    if (res.stuck.length) issue('fail', at, `stuck reveals: ${res.stuck.slice(0, 4).map((s) => `${s.el} ${s.reason} on ${s.path}`).join(' | ')}`);
    if (errors.length) issue('fail', at, `page errors: ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    issue('fail', `${id}`, `scenario crashed: ${String(e.message || e).split('\n')[0]}`);
  } finally { save(); await env.ctx.close(); }
}
R.finished = new Date().toISOString(); save();
await browser.close(); server.stop();
console.log(`${R.issues.filter((i) => i.sev === 'fail').length} FAIL, ${R.issues.filter((i) => i.sev === 'warn').length} WARN`);
process.exit(0);
