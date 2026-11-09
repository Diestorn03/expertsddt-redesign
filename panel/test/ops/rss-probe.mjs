// Preload for the operations checks (node --import ./test/ops/rss-probe.mjs dist/server/entry.mjs): every 100 ms appends
// "ms rss heapUsed external arrayBuffers maxRSS" (bytes) to RSS_PROBE_FILE. It only measures; it changes nothing in the app.
import { appendFileSync } from 'node:fs';

const file = process.env.RSS_PROBE_FILE;
if (file) {
  setInterval(() => {
    if (process.env.RSS_PROBE_GC) globalThis.gc?.(); // with --expose-gc: heapUsed then shows what is really retained
    const m = process.memoryUsage();
    appendFileSync(file, `${Date.now()} ${m.rss} ${m.heapUsed} ${m.external} ${m.arrayBuffers} ${process.resourceUsage().maxRSS * 1024}\n`);
  }, 100).unref();
}
