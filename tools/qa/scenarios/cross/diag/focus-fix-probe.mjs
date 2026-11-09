// one-off: find-in-page (window.find) also shifts the pillars; does overflow: clip stop focus/find from scrolling it?
import { serve, launch, context, ready, sleep } from '../lib.mjs';
const server = await serve();
const browser = await launch();
for (const clip of [false, true]) {
  const env = await context(browser, 'desktop');
  if (clip) await env.ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#pillars { overflow: clip !important; }'; document.head.append(s); }));
  const page = await env.ctx.newPage();
  await page.goto(server.url + '/'); await ready(page);
  const found = await page.evaluate(() => window.find('Contact support'));
  await sleep(1200);
  const afterFind = await page.evaluate(() => ({ y: Math.round(scrollY), sl: document.querySelector('#pillars').scrollLeft }));
  await page.evaluate(() => { getSelection().removeAllRanges(); scrollTo(0, 0); }); await sleep(800);
  // focus the last pillar CTA directly (what Tab does)
  await page.evaluate(() => [...document.querySelectorAll('#pillars .pillar .btn')].at(-1).focus());
  await sleep(1200);
  const afterFocus = await page.evaluate(() => ({ y: Math.round(scrollY), sl: document.querySelector('#pillars').scrollLeft }));
  console.log(clip ? '#pillars overflow: clip' : 'as shipped (overflow: hidden)', JSON.stringify({ found, afterFind, afterFocus }));
  await env.ctx.close();
}
await browser.close(); server.stop(); process.exit(0);
