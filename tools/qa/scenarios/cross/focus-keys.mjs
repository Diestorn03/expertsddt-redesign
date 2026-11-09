// Keyboard Tab through the home page: every focused control should be on screen and visible, and focus must not scroll
// the overflow:hidden chapters sideways (#pillars / #hero keep a scrollLeft the GSAP track does not know about).
// usage: node scenarios/cross/focus-keys.mjs [--out cross-focus] [--viewports desktop,laptop] [--tabs 70]
import { parseArgs } from 'node:util';
import { serve, launch, context, out, ready, settle, sleep } from './lib.mjs';

const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'cross-focus' }, viewports: { type: 'string', default: 'desktop,laptop' }, tabs: { type: 'string', default: '70' } } });
const { R, save, issue, shot } = out(o.out);
const server = await serve();
const browser = await launch();

for (const vp of o.viewports.split(',')) {
  const env = await context(browser, vp);
  const page = await env.ctx.newPage();
  await page.goto(server.url + '/'); await ready(page);
  const steps = (R.results[vp] = []);
  await page.mouse.move(4, env.h / 2);
  for (let i = 0; i < +o.tabs; i++) {
    await page.keyboard.press('Tab');
    await sleep(350); await settle(page, 6, 2500); await sleep(250);
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { el: 'body' };
      const r = el.getBoundingClientRect();
      let o = 1; for (let e = el; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity;
      const sl = {}; for (const s of ['#hero', '#pillars', '.pillars__track', 'main', 'body']) { const n = document.querySelector(s); if (n && n.scrollLeft) sl[s] = Math.round(n.scrollLeft); }
      if (document.scrollingElement.scrollLeft) sl.page = document.scrollingElement.scrollLeft;
      return { el: __qa.sel(el), inPillars: !!el.closest('#pillars'), inHero: !!el.closest('#hero'), y: Math.round(scrollY), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        onScreen: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth, opacity: +o.toFixed(2), scrollLeft: sl, pillars: __qa.pillars() };
    });
    s.i = i + 1; steps.push(s);
    if (s.el === 'body' || /footer/.test(s.el)) break;
    const hidden = !s.onScreen || s.opacity < 0.1;
    if (hidden || Object.keys(s.scrollLeft || {}).length) s.shot = await shot(page, `${vp}-tab-${String(i + 1).padStart(2, '0')}`);
  }
  save();
  // the before/after range input is transparent by design: its figure shows the focus ring
  const invisible = steps.filter((s) => s.el !== 'body' && !/input\.ba__range/.test(s.el) && (!s.onScreen || s.opacity < 0.1));
  if (invisible.length) issue('fail', `${vp} keyboard focus`, `${invisible.length} focus stop(s) land on controls the visitor cannot see: ${invisible.slice(0, 6).map((s) => `${s.el} (${s.onScreen ? `opacity ${s.opacity}` : `off screen at ${s.rect.x},${s.rect.y}`}, y=${s.y})`).join(' | ')}`, { shot: invisible[0].shot });
  const shifted = steps.filter((s) => Object.keys(s.scrollLeft || {}).length);
  if (shifted.length) issue('fail', `${vp} keyboard focus`, `focus scrolled an overflow:hidden chapter sideways: ${shifted.slice(0, 4).map((s) => `${s.el} -> ${JSON.stringify(s.scrollLeft)}`).join(' | ')}`, { shot: shifted[0].shot });
  // after tabbing away, scroll through the pillars chapter again with the wheel: is the track still aligned?
  const p = await page.evaluate(() => { const sp = document.querySelector('#pillars')?.parentElement; return sp ? { top: Math.round(sp.getBoundingClientRect().top + scrollY), h: sp.offsetHeight } : null; });
  if (p) {
    for (const f of [0.05, 0.5, 0.95]) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.round(p.top + (p.h - env.h) * f)); await sleep(1300);
      const st = await page.evaluate(() => ({ y: Math.round(scrollY), sl: document.querySelector('#pillars').scrollLeft, pillars: __qa.pillars() }));
      st.shot = await shot(page, `${vp}-pillars-after-tabbing-${Math.round(f * 100)}`);
      (R.results[`${vp}-after`] ||= []).push(st);
    }
    save();
    const bad = R.results[`${vp}-after`].filter((s) => s.sl);
    if (bad.length) issue('fail', `${vp} keyboard focus`, `after tabbing through, #pillars keeps scrollLeft=${bad[0].sl}px: the horizontal chapter is shifted for mouse users too`, { shot: bad[0].shot });
  }
  await env.ctx.close();
}
R.finished = new Date().toISOString(); save();
await browser.close(); server.stop();
console.log(`${R.issues.filter((i) => i.sev === 'fail').length} FAIL, ${R.issues.filter((i) => i.sev === 'warn').length} WARN`);
process.exit(0);
