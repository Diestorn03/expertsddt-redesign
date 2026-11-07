// Operations checks: the built server behind a TLS reverse proxy (Host, X-Forwarded-*, Origin, Secure cookies) and what
// anonymous traffic can do to memory and to DATA_DIR/audit.jsonl. Not part of `npm test`. Run after `npm run build`:
//   node --test --test-concurrency=1 test/ops/proxy.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDirs, removeDirs, addUser, start, client, rssDuring, sleep, MB, SECRET, EMAIL, PASS } from './harness.mjs';
import { totp } from '../../lib/auth.mjs';

let dirs, secret, srv;
const env = () => ({ PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com' });
before(async () => { dirs = await tempDirs(); secret = await addUser(dirs.data); srv = await start({ rss: true, env: env() }); });
after(async () => { await srv.stop(); await removeDirs(dirs); });

const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
after(() => agent.destroy());
/** A request with any Host header, the way a proxy forwards it. */
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((res, rej) => {
  const r = http.request(srv.base + path, { method, agent, setHost: !headers.Host, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, (x) => {
    let b = ''; x.setEncoding('utf8'); x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b }));
  });
  r.on('error', rej); r.end(body);
});
const loginBody = (over = {}) => new URLSearchParams({ email: EMAIL, password: PASS, code: totp(secret), ...over }).toString();
const ORIGIN = 'https://admin.expertsddt.com';
const auditLines = async () => (await readFile(join(dirs.data, 'audit.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function fullPass(h) {
  const r = await raw('/login', { method: 'POST', headers: { ...h, Origin: ORIGIN }, body: loginBody() });
  assert.equal(r.status, 303, `login: ${r.status}`);
  const sid = r.headers['set-cookie'].find((c) => c.startsWith('__Host-edp_sid=')); // Secure on: the prefixed name
  assert.match(sid, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure/);
  const cookie = sid.split(';')[0];
  const home = await raw('/', { headers: { ...h, Cookie: cookie } });
  assert.equal(home.status, 200); assert.equal(home.headers['strict-transport-security'], 'max-age=31536000');
  const forged = await raw('/restore', { method: 'POST', headers: { ...h, Origin: ORIGIN, Cookie: cookie }, body: '_csrf=forged&slot=team&file=x' });
  assert.equal(forged.status, 403); assert.match(forged.body, /No pudimos confirmar la acción/);
  assert.equal((await raw('/no-such-page', { headers: { ...h, Cookie: cookie } })).status, 404);
}

test('proxy keeps Host and sends X-Forwarded-Proto: login, pages, branded 403/404, Secure cookie and HSTS work', () => fullPass({ Host: 'admin.expertsddt.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' }));
test('proxy rewrites Host but sends X-Forwarded-Host: everything works too', () => fullPass({ Host: `127.0.0.1:${srv.port}`, 'X-Forwarded-Host': 'admin.expertsddt.com', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '198.51.100.1' }));
test('proxy rewrites Host and sends no X-Forwarded-Host: the browser\'s own Origin (https://admin.expertsddt.com) is still accepted', () => fullPass({ Host: `127.0.0.1:${srv.port}`, 'X-Forwarded-Proto': 'https' }));

test('a client-supplied X-Forwarded-For (the proxy appends the real address) cannot dodge the 20-per-IP lock', async () => {
  const statuses = [];
  for (let i = 0; i < 24; i++) statuses.push((await raw('/login', { method: 'POST', headers: { 'X-Forwarded-For': `10.66.0.${i}, 198.51.100.77` }, body: loginBody({ email: `spray${i}@example.com`, password: 'guess' }) })).status);
  assert.ok(statuses.slice(20).every((s) => s === 429), `same real client, 24 different emails: ${statuses.join(',')}`);
});

test('the IP written to the history is the address the proxy saw, not text chosen by the client', async () => {
  await raw('/login', { method: 'POST', headers: { 'X-Forwarded-For': 'Fernando desde la oficina, 198.51.100.78' }, body: loginBody({ email: 'who@example.com', password: 'guess' }) });
  assert.equal((await auditLines()).at(-1).ip, '198.51.100.78');
});

test('anonymous requests against a locked account do not keep appending to audit.jsonl', async () => {
  const body = loginBody({ email: `${'a'.repeat(240)}@example.com`, password: 'x' });
  for (let i = 0; i < 9; i++) await raw('/login', { method: 'POST', body }); // locks this email
  const file = join(dirs.data, 'audit.jsonl'), s0 = (await stat(file)).size, t0 = Date.now();
  let n = 0;
  await Promise.all(Array.from({ length: 16 }, async () => { while (n < 1000) { n++; await raw('/login', { method: 'POST', headers: { 'X-Forwarded-For': 'z'.repeat(7000) }, body }); } }));
  const grown = (await stat(file)).size - s0, secs = (Date.now() - t0) / 1000;
  assert.ok(grown < 64 * 1024, `1000 anonymous 429 answers in ${secs.toFixed(1)} s appended ${(grown / MB).toFixed(1)} MB (= ${(grown / MB / secs * 3600 / 1024).toFixed(1)} GB per hour from one client)`);
});

test('anonymous failed logins do not leave kilobytes behind in memory each (login throttle maps)', { timeout: 120_000 }, async () => {
  const s2 = await start({ rss: true, nodeArgs: ['--expose-gc'], env: { ...env(), RSS_PROBE_GC: '1' } });
  try {
    const heap = async () => { await sleep(700); return Number((await readFile(s2.rssFile, 'utf8')).trim().split('\n').at(-1).split(' ')[2]); };
    const post = (i) => fetch(`${s2.base}/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': `${i}${'x'.repeat(7000)}` }, body: new URLSearchParams({ email: `${i}@example.com`, password: 'x', code: '000000' }) });
    for (let i = 0; i < 30; i++) await post(-1 - i);
    const h0 = await heap(); const N = 400; let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => { while (next < N) await post(next++); }));
    const per = ((await heap()) - h0) / N;
    assert.ok(per < 1024, `${(per / 1024).toFixed(1)} KB of heap kept per anonymous attempt, never released`);
  } finally { await s2.stop(); }
});

async function bigAudit(mb) {
  const file = join(dirs.data, 'audit.jsonl'); await rm(file, { force: true });
  const line = Buffer.from(JSON.stringify({ ts: '2026-11-01T12:00:00.000Z', user: `${'a'.repeat(240)}@example.com`, action: 'login_blocked', detail: '', ip: '198.51.100.9' }) + '\n');
  const fh = await open(file, 'w'), chunk = Buffer.concat(Array(Math.floor(4 * MB / line.length)).fill(line));
  for (let n = 0; n < mb * MB; n += chunk.length) await fh.write(chunk);
  await fh.write(Buffer.from(JSON.stringify({ ts: new Date().toISOString(), user: EMAIL, action: 'replace', detail: 'img/team.webp', ip: '1.2.3.4', slot: 'team' }) + '\n'));
  await fh.close();
}

test('a 300 MB audit.jsonl (a few minutes of the traffic above) does not make each page view cost a gigabyte of RAM', { timeout: 180_000 }, async () => {
  await bigAudit(300);
  const c = client(srv, secret); await c.login();
  const m = await rssDuring(srv, async () => { const t = Date.now(); const r = await c.call('/'); await r.text(); return { status: r.status, ms: Date.now() - t }; });
  assert.ok(m.growth < 256 * MB, `GET / took ${m.result.ms} ms and RSS went ${(m.idle / MB).toFixed(0)} -> ${(m.peak / MB).toFixed(0)} MB`);
});

test('with a 600 MB audit.jsonl the history still shows the latest changes (no silent empty page)', { timeout: 180_000 }, async () => {
  await bigAudit(600);
  const c = client(srv, secret); await c.login();
  const h = await (await c.call('/history?tipo=cambios')).text(), home = await (await c.call('/')).text();
  assert.ok(/cambió la foto/.test(h) && !/Sin cambios todavía/.test(home), `history lists the change: ${/cambió la foto/.test(h)}; home says «Sin cambios todavía»: ${/Sin cambios todavía/.test(home)}`);
});
