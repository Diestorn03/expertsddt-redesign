// one-off: trace the cold first load of the home page (desktop) and list what the renderer main thread does
// before the first paint and during the loader wipe
import { serve, launch, context, sleep } from '../lib.mjs';
import { writeFileSync } from 'node:fs';
const vp = process.argv[2] || 'desktop';
const server = await serve();
const browser = await launch();
const env = await context(browser, vp);
const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
await page.goto(server.url + '/robots.txt');
const events = [];
cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'loading', 'blink.user_timing', 'v8.execute', 'disabled-by-default-v8.compile', 'blink', 'cc', 'gpu', 'viz', 'benchmark'] } });
await page.goto(server.url + '/', { waitUntil: 'commit' });
await page.waitForFunction(() => window.__qa && __qa.log.some((e) => e.type === 'loader:removed'), null, { timeout: 15000, polling: 50 });
await sleep(600);
const log = await page.evaluate(() => ({ origin: performance.timeOrigin, log: __qa.log.map(({ boxes, ...e }) => e), fp: performance.getEntriesByName('first-paint')[0]?.startTime, nav: performance.getEntriesByType('navigation')[0].toJSON() }));
await cdp.send('Tracing.end');
await done;
writeFileSync(`out/cross-probes/trace-${vp}.json`, JSON.stringify({ traceEvents: events }));
// main thread of the page renderer
const nav = events.find((e) => e.name === 'navigationStart' && e.args?.data?.documentLoaderURL?.startsWith(server.url + '/') && !e.args.data.documentLoaderURL.includes('robots'));
const pid = nav?.pid, t0 = nav?.ts;
const main = events.find((e) => e.pid === pid && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
const tid = main?.tid;
const rel = (ts) => Math.round((ts - t0) / 1000);
const fp = events.find((e) => e.pid === pid && e.name === 'firstPaint');
console.log('first paint (trace)', fp && rel(fp.ts), 'perf FP', Math.round(log.fp), 'DCL', Math.round(log.nav.domContentLoadedEventEnd), 'load', Math.round(log.nav.loadEventEnd));
console.log('page log', JSON.stringify(log.log.filter((e) => !/^loader:(frame)$/.test(e.type))));
const tasks = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur > 20000);
for (const t of tasks) {
  const kids = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && e !== t && e.dur > 4000 && !/RunTask/.test(e.name));
  const top = kids.sort((a, b) => b.dur - a.dur).slice(0, 8).map((k) => `${k.name}${k.args?.data?.url ? ' ' + k.args.data.url.split('/').pop() : ''}${k.args?.data?.functionName ? ' ' + k.args.data.functionName : ''}${k.args?.beginData?.stackTrace?.[0]?.functionName ? ' <' + k.args.beginData.stackTrace[0].functionName + '>' : ''} ${Math.round(k.dur / 1000)}ms`);
  console.log(`task @${rel(t.ts)}ms ${Math.round(t.dur / 1000)}ms: ${top.join(' | ')}`);
}
await browser.close(); server.stop(); process.exit(0);
