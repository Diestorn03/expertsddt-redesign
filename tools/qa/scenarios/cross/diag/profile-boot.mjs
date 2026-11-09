// one-off: CPU profile of the first load (desktop): inclusive time of the motion bundle functions, mapped to source snippets
import { readFileSync } from 'node:fs';
import { serve, launch, context, sleep } from '../lib.mjs';
const vp = process.argv[2] || 'desktop', cpu = +(process.argv[3] || 1);
const server = await serve();
const browser = await launch();
const env = await context(browser, vp);
const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
await page.goto(server.url + '/robots.txt');
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.goto(server.url + '/', { waitUntil: 'commit' });
await page.waitForFunction(() => window.__qa && __qa.log.some((e) => e.type === 'loader:removed'), null, { timeout: 30000, polling: 100 });
await sleep(300);
const { profile } = await cdp.send('Profiler.stop');
const bundleName = profile.nodes.map((n) => n.callFrame.url).find((u) => /Base\.astro.*\.js$/.test(u));
const src = readFileSync('C:/Users/Diestorn/Desktop/expertsddt-sitefix/tools/qa/out/.dist-default/_astro/' + bundleName.split('/').pop(), 'utf8').split('\n');
// self time per node from samples
const dt = {}; profile.samples.forEach((id, i) => { dt[id] = (dt[id] || 0) + (profile.timeDeltas[i + 1] || 0); });
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map(); profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
const incl = {}; // inclusive time per function key, counted once per sample stack
profile.samples.forEach((id, i) => {
  const d = profile.timeDeltas[i + 1] || 0, seen = new Set();
  for (let n = id; n != null; n = parent.get(n)) {
    const f = byId.get(n).callFrame, key = `${f.functionName || '(anon)'}|${f.url.split('/').pop()}|${f.lineNumber}:${f.columnNumber}`;
    if (!seen.has(key)) { seen.add(key); incl[key] = (incl[key] || 0) + d; }
  }
});
const total = Object.values(dt).reduce((a, b) => a + b, 0);
console.log(`profile ${Math.round(total / 1000)} ms sampled (${vp}, cpu x${cpu})`);
Object.entries(incl).filter(([k]) => k.includes('Base.astro')).sort((a, b) => b[1] - a[1]).slice(0, 28).forEach(([k, v]) => {
  const [, , pos] = k.split('|'), [l, c] = pos.split(':').map(Number);
  console.log(`${String(Math.round(v / 1000)).padStart(5)} ms  ${k.split('|')[0].padEnd(12)} ${pos.padEnd(10)} ${(src[l] || '').slice(c, c + 110).replace(/\s+/g, ' ')}`);
});
// native (non-JS) heavy children: layout forced from JS shows up as "(program)"/"(garbage collector)" in V8 profiles, so list them too
['(garbage collector)', '(program)', '(idle)'].forEach((n) => { const k = Object.keys(incl).find((x) => x.startsWith(n + '|')); if (k) console.log(`${String(Math.round(incl[k] / 1000)).padStart(5)} ms  ${n}`); });
await browser.close(); server.stop(); process.exit(0);
