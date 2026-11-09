// one-off: same reduced-motion load with and without micro-transitions (injected '* { transition: none !important }')
import { serve, launch, context, ready, libs, sleep } from '../lib.mjs';
const server = await serve();
const browser = await launch();
for (const noTransitions of [false, true]) {
  const env = await context(browser, 'desktop', 'reduce');
  if (noTransitions) await env.ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*, *::before, *::after { transition: none !important; }'; document.head.append(s); }));
  const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
  await page.goto(server.url + '/'); await ready(page, 2500);
  await libs(cdp);
  const r = await page.evaluate(() => {
    const ST = window.__qaLib.ScrollTrigger, h = document.querySelector('#services h2');
    const st = ST.getAll().find((s) => s.trigger === h);
    const before = Math.round(st.start); ST.refresh(); const after = Math.round(ST.getAll().find((s) => s.trigger === h).start);
    return { servicesHeadingTriggerStart: before, afterManualRefresh: after };
  });
  console.log(noTransitions ? 'reduced + no micro-transitions' : 'reduced as shipped      ', JSON.stringify(r));
  await env.ctx.close();
}
await browser.close(); server.stop(); process.exit(0);
