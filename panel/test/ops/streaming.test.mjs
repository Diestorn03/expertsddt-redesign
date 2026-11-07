// Operations checks: big streamed uploads against the built server, memory (RSS), cancellation, crashes, concurrency, limits.
// Not part of `npm test`. Needs about 2 GB of free disk (set OPS_TMP to choose where). Run after `npm run build`:
//   node --test --test-concurrency=1 test/ops/streaming.test.mjs        (OPS_SLOW=1 adds the 5-minute slow-uplink test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDirs, removeDirs, addUser, start, client, bigZip, rssDuring, flashOf, listTmp, sleep, MB, PROXY, SECRET } from './harness.mjs';

const RSS_BUDGET = 96 * MB; // what one upload may add to the process, whatever the file size
async function withServer(fn, { env = {}, rss = true } = {}) {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const srvEnv = { PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com', ...env };
  const box = { srv: await start({ rss, env: srvEnv }), dirs, secret, env: srvEnv };
  try { return await fn(box); } finally { await box.srv.stop(); await removeDirs(dirs); }
}
const publish = (c, t, version, zip, opt) => c.upload('/upload/libraries', { _csrf: t, version, dataDate: '2026-11-06' }, { name: 'file', filename: `v${version}.zip`, ...zip }, opt);
const versions = async (dirs) => JSON.parse(await readFile(join(dirs.site, 'downloads', 'libraries', 'versions.json'), 'utf8')).map((v) => v.version);
const zipsOnDisk = async (dirs) => (await readdir(join(dirs.site, 'downloads', 'libraries'))).filter((f) => f.endsWith('.zip'));

for (const [label, headers] of [['direct', {}], ['behind a TLS proxy (X-Forwarded-Proto/Host, Origin)', PROXY]]) {
  test(`60 MB and 250 MB zips are streamed to disk, not memory (${label})`, { timeout: 300_000 }, () => withServer(async ({ srv, dirs, secret }) => {
    const c = client(srv, secret, headers);
    assert.equal((await c.login()).status, 303);
    const t = await c.csrf();
    for (const [v, size] of [['11', 60 * MB], ['12', 250 * MB]]) {
      const zip = bigZip(size);
      const m = await rssDuring(srv, () => publish(c, t, v, zip));
      assert.equal(flashOf(m.result.setCookies)?.key, 'ok_publish', `${size / MB} MB: ${m.result.status} ${m.result.error ?? ''}`);
      assert.equal((await stat(join(dirs.site, 'downloads', 'libraries', `exocad-implant-libraries-v${v}-2026-11-06.zip`))).size, zip.size);
      assert.ok(m.growth < RSS_BUDGET, `${size / MB} MB upload grew RSS by ${(m.growth / MB).toFixed(0)} MB (idle ${(m.idle / MB).toFixed(0)}, peak ${(m.peak / MB).toFixed(0)})`);
      console.log(`# ${label}: ${size / MB} MB -> RSS ${(m.idle / MB).toFixed(0)} -> ${(m.peak / MB).toFixed(0)} MB`);
    }
    assert.deepEqual(await listTmp(dirs), []);
  }));

  test(`a cancelled 250 MB upload leaves DATA_DIR/tmp empty and publishes nothing (${label})`, { timeout: 120_000 }, () => withServer(async ({ srv, dirs, secret }) => {
    const c = client(srv, secret, headers);
    await c.login(); const t = await c.csrf();
    const r = await publish(c, t, '20', bigZip(250 * MB), { abortAfter: 100 * MB, bytesPerSec: 80 * MB });
    assert.equal(r.error, 'aborted by test');
    for (let i = 0; i < 50 && (await listTmp(dirs)).length; i++) await sleep(100);
    assert.deepEqual(await listTmp(dirs), []);
    assert.deepEqual(await readdir(join(dirs.site, 'downloads', 'libraries')).catch(() => []), []);
    assert.equal((await c.call('/')).status, 200);
  }));
}

test('an upload cut by a crash or restart (deploy, OOM kill) leaves no orphan in DATA_DIR/tmp after the next start', { timeout: 120_000 }, () => withServer(async (box) => {
  const c = client(box.srv, box.secret);
  await c.login(); const t = await c.csrf();
  const sent = publish(c, t, '21', bigZip(250 * MB), { bytesPerSec: 40 * MB });
  await sleep(2500);
  const at = await listTmp(box.dirs);
  box.srv.proc.kill('SIGKILL'); await box.srv.exited; await sent;
  box.srv = await start({ rss: true, env: box.env });
  await sleep(500);
  const left = [];
  for (const f of await listTmp(box.dirs)) left.push(`${f} (${((await stat(join(box.dirs.data, 'tmp', f))).size / MB).toFixed(0)} MB)`);
  assert.ok(at.length > 0, 'the upload was being written when the process died');
  assert.deepEqual(left, [], 'partial upload still in DATA_DIR/tmp after restart');
}));

test('two 250 MB publishes at the same time: memory stays flat', { timeout: 300_000 }, () => withServer(async ({ srv, secret }) => {
  const a = client(srv, secret), b = client(srv, secret);
  await a.login(); await b.login();
  const [ta, tb] = [await a.csrf(), await b.csrf()];
  const m = await rssDuring(srv, () => Promise.all([publish(a, ta, '30', bigZip(250 * MB)), publish(b, tb, '31', bigZip(250 * MB))]));
  assert.ok(m.growth < 2 * RSS_BUDGET, `RSS grew by ${(m.growth / MB).toFixed(0)} MB`);
  console.log(`# 2 x 250 MB at once -> RSS ${(m.idle / MB).toFixed(0)} -> ${(m.peak / MB).toFixed(0)} MB; answers ${m.result.map((r) => `${r.status} ${flashOf(r.setCookies)?.key ?? ''}`).join(', ')}`);
}));

test('publishes that overlap all end up in versions.json (no lost update, no orphan zip in the web root)', { timeout: 300_000 }, () => withServer(async ({ srv, dirs, secret }) => {
  const cs = await Promise.all(Array.from({ length: 6 }, async () => { const c = client(srv, secret); await c.login(); return [c, await c.csrf()]; }));
  const rs = await Promise.all(cs.map(([c, t], i) => publish(c, t, String(40 + i), bigZip(8 * MB, 3))));
  const told = rs.map((r, i) => `v${40 + i}: ${r.status} ${flashOf(r.setCookies)?.key ?? '(no notice)'}`);
  const listed = await versions(dirs), onDisk = await zipsOnDisk(dirs);
  assert.deepEqual({ listed: listed.sort(), zips: onDisk.length }, { listed: ['v40', 'v41', 'v42', 'v43', 'v44', 'v45'], zips: 6 }, `answers: ${told.join('; ')}; files: ${(await readdir(join(dirs.site, 'downloads', 'libraries'))).join(', ')}`);
}));

test('a zip a bit over the limit (330 MB) sent without JavaScript gets the «pesa más de 300 MB» notice, not the 500 page', { timeout: 300_000 }, () => withServer(async ({ srv, dirs, secret }) => {
  const c = client(srv, secret);
  await c.login(); const t = await c.csrf();
  const r = await publish(c, t, '13', bigZip(330 * MB));
  assert.equal(flashOf(r.setCookies)?.key, 'lib_file', `status ${r.status} ${r.error ?? ''}, 500 page: ${/Error 500/.test(r.body ?? '')}; log: ${srv.log().split('\n').find((l) => /limit/i.test(l))?.trim()}`);
}, { rss: false }));

test('LIB_MAX_MB raised in hPanel without rebuilding: a zip under the announced limit is accepted or clearly refused', { timeout: 300_000 }, () => withServer(async ({ srv, secret }) => {
  const c = client(srv, secret);
  await c.login();
  const page = await (await c.call('/')).text();
  const t = page.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.match(page, /Solo \.zip · hasta 400 MB/); // what staff are told
  const r = await publish(c, t, '14', bigZip(330 * MB));
  assert.ok(['ok_publish', 'lib_file'].includes(flashOf(r.setCookies)?.key), `330 MB under an announced 400 MB: status ${r.status}, 500 page: ${/Error 500/.test(r.body ?? '')}`);
}, { env: { LIB_MAX_MB: '400' }, rss: false }));

test('a 40 MB zip over a 1 Mbit/s uplink (5.5 minutes) is received (Node closes requests after 300 s: server.requestTimeout)', { skip: !process.env.OPS_SLOW && 'set OPS_SLOW=1 (takes about 6 minutes)', timeout: 600_000 }, () => withServer(async ({ srv, dirs, secret }) => {
  const c = client(srv, secret);
  await c.login(); const t = await c.csrf();
  const t0 = Date.now();
  const r = await publish(c, t, '15', bigZip(42 * MB, 4), { bytesPerSec: 128 * 1024 });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  assert.equal(flashOf(r.setCookies)?.key, 'ok_publish', `after ${secs} s: status ${r.status} ${r.error ?? ''}, ${(r.sent / MB).toFixed(1)} MB sent; server log: ${srv.log().trim().split('\n').slice(1).join(' / ') || '(nothing)'}`);
  assert.deepEqual(await listTmp(dirs), []);
}, { rss: false }));
