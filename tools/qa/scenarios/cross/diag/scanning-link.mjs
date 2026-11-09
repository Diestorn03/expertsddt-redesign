// one-off: the pillar 02 CTA links to /services/#scanning; where does the visitor land?
import { serve, launch, context, ready, settle, pageLoads, afterNav, scrollUntil, sleep } from '../lib.mjs';
const server = await serve();
const browser = await launch();
for (const vp of ['desktop', 'phone']) {
  const env = await context(browser, vp);
  const page = await env.ctx.newPage();
  await page.goto(server.url + '/'); await ready(page);
  // bring the pillar 02 CTA on screen the way a visitor does (scroll until it is visible)
  for (let i = 0; i < 120; i++) {
    const vis = await page.evaluate(() => { const a = document.querySelector('#pillars a[href="/services/#scanning"]'); const r = a.getBoundingClientRect(); let o = 1; for (let e = a; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && o > 0.9; });
    if (vis) break;
    await scrollUntil(page, env, () => true); // settle
    if (!env.touch) { await page.mouse.move(4, env.h / 2); await page.mouse.wheel(0, 120); await sleep(90); } else { await page.evaluate(() => scrollBy(0, 200)); await sleep(120); }
  }
  await sleep(1200);
  const from = await page.evaluate(() => Math.round(scrollY));
  const n0 = await pageLoads(page);
  await page.click('#pillars a[href="/services/#scanning"]');
  await afterNav(page, n0, 2000); await settle(page);
  const r = await page.evaluate(() => { const s = document.querySelector('#scanning'); return { path: location.pathname + location.hash, y: Math.round(scrollY), scanningTop: s ? Math.round(s.getBoundingClientRect().top) : null }; });
  await page.screenshot({ path: `out/cross-probes/scanning-${vp}.jpg`, type: 'jpeg', quality: 60 });
  console.log(vp, 'clicked at home y=' + from, JSON.stringify(r));
  await env.ctx.close();
}
await browser.close(); server.stop(); process.exit(0);
