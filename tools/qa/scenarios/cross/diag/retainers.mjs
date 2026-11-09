// one-off diagnosis: which objects keep the DOM of previous pages alive after ClientRouter navigations
import { serve, launch, context, ready, pageLoads, afterNav, sleep } from '../lib.mjs';
import { writeFileSync } from 'node:fs';

const server = await serve();
const browser = await launch();
const env = await context(browser, process.argv[2] || 'desktop');
const page = await env.ctx.newPage(), cdp = await env.ctx.newCDPSession(page);
await page.goto(server.url + '/'); await ready(page);
const hop = async (to) => { const n0 = await pageLoads(page); await page.evaluate((to) => (document.querySelector(`.nav__links a[href="${to}"]`) || document.querySelector(`footer a[href="${to}"]`)).click(), to); await afterNav(page, n0, 1500); };
for (const to of ['/services/', '/courses/', '/services/', '/courses/', '/']) await hop(to);
await cdp.send('HeapProfiler.enable');
for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(200); }
const dom = await cdp.send('Memory.getDOMCounters');
console.log('DOM counters', JSON.stringify(dom));
let chunks = [];
cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
const snap = JSON.parse(chunks.join('')); chunks = null;
const m = snap.snapshot.meta, NF = m.node_fields, EF = m.edge_fields, nf = NF.length, ef = EF.length;
const nodes = snap.nodes, edges = snap.edges, strings = snap.strings;
const nTypes = m.node_types[0], eTypes = m.edge_types[0];
const iType = NF.indexOf('type'), iName = NF.indexOf('name'), iEC = NF.indexOf('edge_count'), iDet = NF.indexOf('detachedness'), iId = NF.indexOf('id');
const eType = EF.indexOf('type'), eName = EF.indexOf('name_or_index'), eTo = EF.indexOf('to_node');
const N = nodes.length / nf;
const firstEdge = new Uint32Array(N + 1);
for (let i = 0, e = 0; i < N; i++) { firstEdge[i] = e; e += nodes[i * nf + iEC] * ef; firstEdge[i + 1] = e; }
const name = (i) => strings[nodes[i * nf + iName]];
const type = (i) => nTypes[nodes[i * nf + iType]];
// BFS from the root over strong edges, recording the parent edge
const parent = new Int32Array(N).fill(-1), pEdge = new Int32Array(N).fill(-1), seen = new Uint8Array(N);
const q = [0]; seen[0] = 1;
for (let h = 0; h < q.length; h++) {
  const i = q[h];
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += ef) {
    const t = eTypes[edges[e + eType]];
    if (t === 'weak' || t === 'shortcut') continue;
    const to = edges[e + eTo] / nf;
    if (!seen[to]) { seen[to] = 1; parent[to] = i; pEdge[to] = e; q.push(to); }
  }
}
const edgeName = (e) => { const t = eTypes[edges[e + eType]], n = edges[e + eName]; return t === 'element' || t === 'hidden' ? `[${n}]` : strings[n]; };
const detached = [];
for (let i = 0; i < N; i++) if (iDet >= 0 && nodes[i * nf + iDet] === 2 && seen[i]) detached.push(i);
const byName = {};
detached.forEach((i) => { const k = name(i).split(' ')[0]; byName[k] = (byName[k] || 0) + 1; });
console.log('detached (reachable) nodes:', detached.length, JSON.stringify(Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 12)));
// retaining paths of a few detached elements: walk parents to the root, print the first non-DOM holder
const paths = {};
for (const i of detached.filter((i) => /^<(body|section|video|nav)/.test(name(i))).slice(0, 400)) {
  const path = [];
  for (let j = i, k = 0; j > 0 && k < 40; j = parent[j], k++) path.push(`${name(j).slice(0, 60)}(${type(j)}) <-${edgeName(pEdge[j])}-`);
  // collapse the DOM part of the chain: keep from the first non-detached object
  const sig = path.slice(0, 16).join(' ');
  paths[sig] = (paths[sig] || 0) + 1;
}
const top = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 8);
top.forEach(([p, n]) => console.log(`\n${n}x ${p}`));
writeFileSync(process.argv[3] || 'out/cross-probes/retainers.txt', top.map(([p, n]) => `${n}x ${p}`).join('\n\n'));
await browser.close(); server.stop(); process.exit(0);
