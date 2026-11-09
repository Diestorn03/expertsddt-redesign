// Loading screen on a real-world connection (throttled network, cold cache): how long it covers the page compared with
// first paint / DOMContentLoaded / window load, what the hero video costs while the loader is up (run again with the
// video request blocked), and a Back from another document with the back/forward cache enabled (Playwright disables it).
// usage: node scenarios/cross/loader-net.mjs [--out cross-loader-net] [--viewports desktop,phone] [--profiles slow4g,fast4g]
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { serve, launch, context, out, ready, settle, scrollUntil, sleep } from './lib.mjs';

const { values: o } = parseArgs({ options: { out: { type: 'string', default: 'cross-loader-net' }, viewports: { type: 'string', default: 'desktop,phone' }, profiles: { type: 'string', default: 'slow4g,fast4g' }, pages: { type: 'string', default: '/' }, skip: { type: 'string', default: '' } } });
const NET = { slow4g: { latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 }, fast4g: { latency: 60, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 } };
const { R, save, issue, shot } = out(o.out);
const server = await serve();
const browser = await launch();

async function coldLoad(vp, profile, path, blockVideo) {
  const env = await context(browser, vp);
  const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
  if (blockVideo) await page.route(/\/video\/smile-design\.mp4/, (r) => r.abort());
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET[profile] });
  const bytes = {}, urls = {};
  cdp.on('Network.requestWillBeSent', (e) => { urls[e.requestId] = e.request.url.replace(server.url, ''); });
  cdp.on('Network.dataReceived', (e) => { const u = urls[e.requestId]; if (u) bytes[u] = (bytes[u] || 0) + e.dataLength; });
  let atLoad = null;
  page.on('load', () => { atLoad = Object.entries(bytes).filter(([, b]) => b > 20000).map(([u, b]) => `${u} ${Math.round(b / 1024)} KB`); });
  await page.goto(server.url + '/robots.txt');
  await page.goto(server.url + path, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__qa && __qa.log.some((e) => e.type === 'loader:removed'), null, { timeout: 90000, polling: 100 }).catch(() => {});
  await sleep(800);
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0], ev = (t) => __qa.log.find((e) => e.type === t)?.t ?? null;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
    return { responseEnd: Math.round(n.responseEnd), fcp: fcp && Math.round(fcp), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventStart), pageLoad: ev('astro:page-load'), loaderDone: ev('loader:done'), wipeStart: ev('loader:start') ?? ev('loader:run'), loaderRemoved: ev('loader:removed') };
  });
  m.coverMs = m.wipeStart != null && m.fcp != null ? m.wipeStart - m.fcp : null; // painted loader on screen before the wipe
  m.bigTransfersAtLoad = atLoad;
  m.videoKB = Math.round((bytes['/video/smile-design.mp4'] || 0) / 1024);
  m.shot = await shot(page, `${vp}-${profile}-${path.replace(/\//g, '') || 'home'}${blockVideo ? '-novideo' : ''}`);
  await env.ctx.close();
  return m;
}

if (!o.skip.includes('net')) for (const vp of o.viewports.split(',')) for (const profile of o.profiles.split(',')) for (const path of o.pages.split(',')) {
  const k = `${vp} ${profile} ${path}`;
  const a = await coldLoad(vp, profile, path, false);
  const b = path === '/' ? await coldLoad(vp, profile, path, true) : null;
  R.results[k] = { withVideo: a, heroVideoBlocked: b };
  save();
  console.log(k, JSON.stringify(a), b ? `| no video: done ${b.loaderDone} load ${b.load}` : '');
  if (a.loaderDone - (a.fcp ?? 0) > 2500) issue('warn', `loader ${k}`, `the loading screen covers the page ${a.loaderDone - a.fcp} ms after its first paint (FCP ${a.fcp} ms, DOMContentLoaded ${a.dcl} ms, window load ${a.load} ms, astro:page-load ${a.pageLoad} ms, lifted ${a.loaderDone} ms): the "max 2 s" timer only starts at window load`, { shot: a.shot });
  if (b && a.loaderDone - b.loaderDone > 800) issue('warn', `loader ${k}`, `the hero background video (${a.videoKB} KB fetched${vp === 'phone' ? ', never shown on this layout' : ''}) delays the reveal: loader lifts at ${a.loaderDone} ms with it, ${b.loaderDone} ms with the request blocked`);
}

/* ---------- bfcache: Back from another document, cache enabled ---------- */
if (!o.skip.includes('bfcache')) {
  const b2 = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  for (const vp of ['desktop', 'phone']) {
    const env = await context(b2, vp);
    await env.ctx.addInitScript(() => addEventListener('pageshow', (e) => { (window.__ps = window.__ps || []).push(e.persisted); }));
    const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
    await cdp.send('Page.enable');
    const notRestored = [];
    cdp.on('Page.backForwardCacheNotUsed', (e) => notRestored.push(...e.notRestoredExplanations.map((x) => `${x.type}:${x.reason}`)));
    await page.goto(server.url + '/'); await ready(page);
    await scrollUntil(page, env, (y) => y >= 6000); await sleep(1000);
    const left = await page.evaluate(() => ({ y: Math.round(scrollY), sig: __qa.signature() }));
    await page.goto(server.url + '/robots.txt'); await sleep(800);
    await page.goBack({ waitUntil: 'commit' }); await sleep(2500);
    const back = await page.evaluate(() => ({ persisted: (window.__ps || []).includes(true), y: Math.round(scrollY), loader: !!document.getElementById('loader'), hidden: __qa.hiddenInView(), sig: __qa.signature() }));
    // does the restored page still scroll and animate?
    await scrollUntil(page, env, (y) => y >= back.y + env.h * 2);
    const after = await page.evaluate(() => ({ y: Math.round(scrollY), hidden: __qa.hiddenInView() }));
    const s = await shot(page, `bfcache-${vp}-after-back`);
    R.results[`bfcache ${vp}`] = { left: left.y, back, after, notRestored, shot: s };
    save();
    if (!back.persisted) issue('info', `bfcache ${vp}`, `Back after leaving for another document did not use the back/forward cache: ${notRestored.join(', ') || 'no reason reported'}`);
    else if (Math.abs(back.y - left.y) > 50 || back.hidden.length || after.hidden.length) issue('fail', `bfcache ${vp}`, `restored from the bfcache at y=${back.y} (left at ${left.y}); hidden in view: ${[...back.hidden, ...after.hidden].map((h) => h.el).slice(0, 4).join(' | ') || 'none'}`, { shot: s });
    await env.ctx.close();
  }
  await b2.close();
}
R.finished = new Date().toISOString(); save();
await browser.close(); server.stop();
console.log(`${R.issues.filter((i) => i.sev === 'fail').length} FAIL, ${R.issues.filter((i) => i.sev === 'warn').length} WARN`);
process.exit(0);
