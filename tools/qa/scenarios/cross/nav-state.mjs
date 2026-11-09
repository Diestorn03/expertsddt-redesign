// Navigation state across ClientRouter swaps: anchors from scrolled pages, Back/Forward scroll restore, bfcache,
// the burger after a client-side navigation, and the scroll position when a desktop window crosses the 1180 px breakpoint.
// usage: node scenarios/cross/nav-state.mjs [--out cross-nav-state] [--only anchor,history,burger,breakpoint]
import { parseArgs } from 'node:util';
import { serve, launch, context, out, ready, settle, pageLoads, afterNav, scrollBy, scrollUntil, sleep } from './lib.mjs';

const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'cross-nav-state' }, only: { type: 'string', default: 'anchor,history,burger,breakpoint' } } });
const want = new Set(o.only.split(','));
const { R, save, issue, shot } = out(o.out);
const server = await serve();
const browser = await launch();
const U = (p) => server.url + p;

const about = (page) => page.evaluate(() => {
  const a = document.querySelector('#about'), h = a?.querySelector('h2');
  return { path: location.pathname + location.hash, y: Math.round(scrollY), aboutTop: a ? Math.round(a.getBoundingClientRect().top) : null, headTop: h ? Math.round(h.getBoundingClientRect().top) : null, navH: Math.round(document.querySelector('.nav').getBoundingClientRect().height), pins: __qa.pins().map((p) => `${p.id}:${p.dist}`), vh: innerHeight };
});
async function openMenu(page) {
  await page.click('.burger'); await sleep(900);
  return page.evaluate(() => { const m = document.querySelector('.menu'); return { open: !!m && m.classList.contains('is-open') && getComputedStyle(m).visibility === 'visible', expanded: document.querySelector('.burger').getAttribute('aria-expanded'), htmlClass: document.documentElement.className, htmlOverflow: getComputedStyle(document.documentElement).overflow }; });
}
async function clickAndWait(page, sel, extra = 2200) { const n0 = await pageLoads(page); await page.click(sel); await afterNav(page, n0, extra); await settle(page); }
async function fresh(vp, path, motion) {
  const env = await context(browser, vp, motion);
  const page = await env.ctx.newPage();
  page.on('pageerror', (e) => issue('fail', `${vp} ${path}`, `page error: ${String(e.message || e).slice(0, 160)}`));
  await page.goto(U(path)); await ready(page);
  return { env, page };
}

/* ---------- anchors from other pages ---------- */
if (want.has('anchor')) {
  const A = (R.results.anchor = {});
  const judge = (label, s) => {
    A[label] = s; save();
    if (s.aboutTop == null || s.aboutTop < -4 || s.aboutTop > s.vh * 0.4) issue('fail', `anchor ${label}`, `lands at y=${s.y} with #about ${s.aboutTop}px from the viewport top (pins ${s.pins.join(', ') || 'none'})`, { shot: s.shot });
    else if (s.headTop < s.navH) issue('warn', `anchor ${label}`, `#about at the top but its heading (${s.headTop}px) is under the ${s.navH}px nav`, { shot: s.shot });
  };
  for (const [vp, from, scrolled, link] of [
    ['desktop', '/services/', 0, '.nav__links a[href="/#about"]'],
    ['desktop', '/services/', 1500, '.nav__links a[href="/#about"]'],
    ['desktop', '/es/services/', 1500, '.nav__links a[href="/es/#about"]'],
    ['phone', '/services/', 0, 'menu'],
    ['phone', '/services/', 1500, 'menu'],
  ]) {
    const { env, page } = await fresh(vp, from);
    if (scrolled) await scrollUntil(page, env, (y) => y >= scrolled);
    const leftAt = await page.evaluate(() => Math.round(scrollY));
    if (link === 'menu') { await openMenu(page); await clickAndWait(page, `.menu a[href="/#about"]`); } else await clickAndWait(page, link);
    await sleep(800);
    const s = await about(page);
    s.leftAt = leftAt;
    s.shot = await shot(page, `anchor-${vp}-${from.replace(/\//g, '')}-from-y${leftAt}`);
    judge(`${vp} ${from} y=${leftAt} -> About`, s);
    await env.ctx.close();
  }
  // same-page link on the home page (intra-page hash: native fragment jump, no swap)
  for (const startY of [0, 6000]) {
    const { env, page } = await fresh('desktop', '/');
    if (startY) await scrollUntil(page, env, (y) => y >= startY);
    await page.click('.nav__links a[href="/#about"]'); await sleep(1500); await settle(page);
    const s = await about(page); s.shot = await shot(page, `anchor-home-intra-from-y${startY}`);
    judge(`desktop / y=${startY} -> About (same page)`, s);
    await env.ctx.close();
  }
}

/* ---------- Back / Forward ---------- */
if (want.has('history')) {
  const H = (R.results.history = {});
  // a) inner pages: restore works only when the page being left was at y=0 (Lenis target 0 makes the after-swap scrollTo(0) a no-op)
  for (const scrollSecond of [false, true]) {
    const { env, page } = await fresh('desktop', '/services/');
    await scrollUntil(page, env, (y) => y >= 1500);
    const leftAt = await page.evaluate(() => Math.round(scrollY));
    await clickAndWait(page, '.nav__links a[href="/courses/"]');
    if (scrollSecond) await scrollBy(page, env, 600);
    const second = await page.evaluate(() => Math.round(scrollY));
    const n0 = await pageLoads(page); await page.goBack({ waitUntil: 'commit' }); await afterNav(page, n0, 1500); await settle(page);
    const back = await page.evaluate(() => ({ path: location.pathname, y: Math.round(scrollY) }));
    const k = `services y=${leftAt} -> courses (scrolled to ${second}) -> Back`;
    H[k] = { leftAt, second, back, shot: await shot(page, `history-services-back-${scrollSecond ? 'after-scrolling' : 'unscrolled'}`) };
    if (Math.abs(back.y - leftAt) > 50) issue(scrollSecond ? 'fail' : 'warn', `history ${k}`, `Back lands at y=${back.y}, the visitor left /services/ at y=${leftAt}`, { shot: H[k].shot });
    await env.ctx.close();
  }
  // b) home with pins: leave mid-page, do not scroll the next page, Back: Astro restores y before the pin spacers exist
  {
    const { env, page } = await fresh('desktop', '/');
    await scrollUntil(page, env, (y) => y >= 6000);
    await sleep(1000);
    const left = await page.evaluate(() => ({ y: Math.round(scrollY), section: [...document.querySelectorAll('main > section, main > .pin-spacer > section')].find((s) => { const r = s.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom > innerHeight / 2; })?.id }));
    const leftShot = await shot(page, 'history-home-left');
    await clickAndWait(page, '.nav__links a[href="/services/"]');
    const n0 = await pageLoads(page); await page.goBack({ waitUntil: 'commit' }); await afterNav(page, n0, 2000); await settle(page);
    const back = await page.evaluate(() => ({ y: Math.round(scrollY), section: [...document.querySelectorAll('main > section, main > .pin-spacer > section')].find((s) => { const r = s.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom > innerHeight / 2; })?.id, hidden: __qa.hiddenInView(), pins: __qa.pins().map((p) => `${p.id}:${p.top}+${p.dist}`), heroCopy: __qa.hero()?.copy, pillars: __qa.pillars() }));
    H['home mid-page -> services (top) -> Back'] = { left, leftShot, back, shot: await shot(page, 'history-home-back-unscrolled') };
    if (back.section !== left.section || Math.abs(back.y - left.y) > 50) issue('fail', 'history home -> services -> Back', `left / at y=${left.y} (#${left.section}), Back shows y=${back.y} (#${back.section})`, { shot: H['home mid-page -> services (top) -> Back'].shot });
    if (back.hidden.length) issue('fail', 'history home Back', `hidden in view after Back: ${back.hidden.slice(0, 4).map((h) => `${h.el} ${h.reason}`).join(' | ')}`);
    await env.ctx.close();
  }
  // c) bfcache: full navigation away (another document) and Back
  {
    const env = await context(browser, 'desktop');
    await env.ctx.addInitScript(() => addEventListener('pageshow', (e) => { (window.__ps = window.__ps || []).push(e.persisted); }));
    const page = await env.ctx.newPage();
    await page.goto(U('/')); await ready(page);
    await scrollUntil(page, env, (y) => y >= 6000); await sleep(800);
    const leftAt = await page.evaluate(() => Math.round(scrollY));
    await page.goto(U('/robots.txt'));
    await page.goBack({ waitUntil: 'commit' }); await sleep(2500); // a bfcache restore fires pageshow, never 'load'
    const back = await page.evaluate(() => ({ persisted: (window.__ps || []).includes(true), y: Math.round(scrollY), loader: !!document.getElementById('loader'), hidden: __qa.hiddenInView(), pins: __qa.pins().length, videoPaused: __qa.hero()?.video?.paused }));
    H['bfcache'] = { leftAt, back, shot: await shot(page, 'history-bfcache-back') };
    if (back.persisted && Math.abs(back.y - leftAt) > 50) issue('fail', 'history bfcache', `restored from bfcache at y=${back.y}, left at ${leftAt}`);
    if (!back.persisted) issue('info', 'history bfcache', `Back after a full navigation reloaded the page (not restored from bfcache): y=${back.y}, loader ${back.loader}`);
    if (back.hidden.length) issue('fail', 'history bfcache', `hidden in view: ${back.hidden.slice(0, 4).map((h) => h.el).join(' | ')}`);
    await env.ctx.close();
  }
}

/* ---------- burger after a client-side navigation (touch layouts) ---------- */
if (want.has('burger')) {
  const B = (R.results.burger = {});
  for (const vp of ['phone', 'tablet']) {
    const { env, page } = await fresh(vp, '/');
    const first = await openMenu(page);
    await clickAndWait(page, '.menu a[href="/services/"]');
    const y0 = await page.evaluate(() => Math.round(scrollY));
    const second = await openMenu(page);
    second.shot = await shot(page, `burger-${vp}-after-nav`);
    const moved = await scrollBy(page, env, env.h * 0.9);
    const y1 = await page.evaluate(() => Math.round(scrollY));
    const stale = await page.evaluate(() => ({ menuIsOpen: document.querySelector('.menu').classList.contains('is-open') }));
    await page.click('.burger'); await sleep(900);
    const third = await page.evaluate(() => ({ expanded: document.querySelector('.burger').getAttribute('aria-expanded'), htmlClass: document.documentElement.className }));
    const y2 = (await scrollBy(page, env, env.h * 0.9)).y;
    B[vp] = { firstOpen: first, afterNavOpen: second, scrollWhileExpanded: { from: y0, to: y1 }, stale, afterSecondTap: third, scrollAfter: y2 };
    if (first.open && !second.open) issue('fail', `burger ${vp}`, `after one client-side navigation the burger shows its X (aria-expanded=${second.expanded}) but the menu does not open; <html> gets "${second.htmlClass}" (overflow ${second.htmlOverflow}) and a swipe moves the page ${y1 - y0}px`, { shot: second.shot });
    save();
    await env.ctx.close();
  }
}

/* ---------- crossing the 1180 px breakpoint mid-page (window resize / zoom) ---------- */
if (want.has('breakpoint')) {
  const K = (R.results.breakpoint = {});
  const { env, page } = await fresh('desktop', '/');
  await scrollUntil(page, env, (y) => y >= 6200); await sleep(1000);
  const where = () => page.evaluate(() => ({ y: Math.round(scrollY), section: [...document.querySelectorAll('main section')].find((s) => { const r = s.getBoundingClientRect(); return r.top <= innerHeight / 2 && r.bottom > innerHeight / 2; })?.id, w: innerWidth }));
  K.before = await where(); K.before.shot = await shot(page, 'breakpoint-0-before-1440');
  await page.setViewportSize({ width: 1100, height: 800 }); await sleep(2000); await settle(page);
  K.narrow = await where(); K.narrow.shot = await shot(page, 'breakpoint-1-at-1100');
  K.narrowHeroCopy = await page.evaluate(() => __qa.hero()?.copy);
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(2000); await settle(page);
  K.back = await where(); K.back.shot = await shot(page, 'breakpoint-2-back-1440');
  K.backState = await page.evaluate(() => ({ pillars: __qa.pillars(), video: __qa.hero()?.video, pins: __qa.pins().map((p) => `${p.id}:${p.dist}`) }));
  // look at the pillars chapter after the round trip
  const p = await page.evaluate(() => { const s = document.querySelector('#pillars').parentElement; return Math.round(s.getBoundingClientRect().top + scrollY); });
  for (const [k, f] of [['start', 0.02], ['mid', 0.5], ['end', 0.97]]) {
    const y = await page.evaluate(([p, f]) => { const sp = document.querySelector('#pillars').parentElement; return Math.round(p + (sp.offsetHeight - innerHeight) * f); }, [p, f]);
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(1300);
    K[`pillars-${k}`] = { y, state: await page.evaluate(() => __qa.pillars()), shot: await shot(page, `breakpoint-3-pillars-${k}-after-roundtrip`) };
  }
  if (K.narrow.y < K.before.y / 2) issue('fail', 'breakpoint', `resizing 1440 -> 1100 at y=${K.before.y} (#${K.before.section}) throws the visitor to y=${K.narrow.y} (#${K.narrow.section})`, { shot: K.narrow.shot });
  if (K.backState.pillars?.static) issue('fail', 'breakpoint', `back at 1440 px the pillars keep the stacked layout inside a horizontal pin (track ${K.backState.pillars.lastRight}px wide)`, { shot: K['pillars-mid'].shot });
  if (K.backState.video && !K.backState.video.src) issue('fail', 'breakpoint', 'back at 1440 px the hero background video has no source (removed at 1100 px, never restored)');
  save();
  await env.ctx.close();
}

R.finished = new Date().toISOString(); save();
await browser.close(); server.stop();
console.log(`${R.issues.filter((i) => i.sev === 'fail').length} FAIL, ${R.issues.filter((i) => i.sev === 'warn').length} WARN`);
process.exit(0);
