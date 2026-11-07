import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { hashPassword, verifyPassword, totp, verifyTotp, sign, verify, createThrottle, newTotpSecret } from '../lib/auth.mjs';
import { sniff, inspectZip, safeJoin } from '../lib/files.mjs';
import { createApp } from '../server.mjs';

// ---------- helpers ----------
function makeZip(entries) { // store-only zip writer, enough for fixtures
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, n, data); central.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#0b7a43' } }).png().toBuffer();
const SECRET = 'x'.repeat(40);
sharp.cache(false); // do not keep files open (Windows cannot delete them)

// ---------- pure units ----------
test('password hashing accepts the right password only and enforces length', async () => {
  const h = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong password!!', h), false);
  await assert.rejects(hashPassword('short'));
});

test('TOTP matches the RFC 6238 test vector and tolerates one step of drift', () => {
  const rfc = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890"
  assert.equal(totp(rfc, 59_000), '287082');
  assert.equal(verifyTotp(rfc, '287082', 59_000 + 30_000), true);
  assert.equal(verifyTotp(rfc, '287082', 59_000 + 90_000), false);
  assert.equal(verifyTotp(rfc, 'abcdef'), false);
});

test('signed tokens detect tampering and expiry', () => {
  const t = sign({ a: 1, exp: 2000 }, SECRET);
  assert.deepEqual(verify(t, SECRET, 1000), { a: 1, exp: 2000 });
  assert.equal(verify(t, SECRET, 3000), null);
  assert.equal(verify(t.replace(/.$/, 'A'), SECRET, 1000), null);
  assert.equal(verify(t, 'y'.repeat(40), 1000), null);
});

test('login throttle locks after repeated failures and recovers', () => {
  let t = 0; const th = createThrottle({ max: 3, lockMs: 1000, now: () => t });
  th.fail('k'); th.fail('k'); assert.equal(th.blocked('k'), false);
  th.fail('k'); assert.equal(th.blocked('k'), true);
  t = 1500; assert.equal(th.blocked('k'), false);
});

test('safeJoin refuses anything that can leave the site root', () => {
  assert.ok(safeJoin('/srv/site', 'img/a.webp').endsWith('a.webp'));
  for (const bad of ['../etc/passwd', 'img/../../x', '/abs', 'a\\b', '', 'img/%2e%2e/x']) assert.throws(() => safeJoin('/srv/site', bad), bad);
});

test('zip inspection accepts normal archives and rejects path tricks, bombs and junk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zip-'));
  const w = async (n, buf) => { const p = join(dir, n); await writeFile(p, buf); return p; };
  try {
    assert.deepEqual(await inspectZip(await w('ok.zip', makeZip([{ name: 'lib/a.stl', data: Buffer.from('solid') }]))), { ok: true, entries: 1, uncompressed: 5 });
    assert.equal((await inspectZip(await w('bad1.zip', makeZip([{ name: '../evil.txt', data: Buffer.from('x') }])))).ok, false);
    assert.equal((await inspectZip(await w('bad2.zip', makeZip([{ name: 'C:/x.txt', data: Buffer.from('x') }])))).ok, false);
    assert.equal((await inspectZip(await w('big.zip', makeZip([{ name: 'a', data: Buffer.alloc(2000) }])), { maxUncompressed: 1000 })).ok, false);
    assert.equal((await inspectZip(await w('many.zip', makeZip([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }])), { maxEntries: 1 })).ok, false);
    assert.equal((await inspectZip(await w('junk.zip', Buffer.from('not a zip at all')))).ok, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sniff identifies real types, ignoring names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sniff-'));
  try {
    const cases = { webp: await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer(), png: await png(4, 4), jpg: await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer(), pdf: Buffer.from('%PDF-1.7\n'), zip: makeZip([{ name: 'a', data: Buffer.from('1') }]), mp4: Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]) };
    for (const [type, buf] of Object.entries(cases)) { const p = join(dir, `file.txt`); await writeFile(p, buf); assert.equal(await sniff(p), type); }
    await writeFile(join(dir, 'x'), Buffer.from('<?php echo 1; ?>')); assert.equal(await sniff(join(dir, 'x')), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------- the running panel ----------
let srv, base, dirs, totpSecret;
const PASS = 'a-long-test-password';
before(async () => {
  dirs = { site: await mkdtemp(join(tmpdir(), 'site-')), data: await mkdtemp(join(tmpdir(), 'data-')) };
  totpSecret = newTotpSecret();
  await writeFile(join(dirs.data, 'users.json'), JSON.stringify([{ email: 'adela@example.com', name: 'Adela', hash: await hashPassword(PASS), totp: totpSecret, tokenVersion: 0 }]));
  await mkdir(join(dirs.site, 'img'), { recursive: true });
  await writeFile(join(dirs.site, 'img', 'portal-laptop.webp'), await sharp({ create: { width: 900, height: 600, channels: 3, background: '#123456' } }).webp().toBuffer());
  const app = await createApp({ secret: SECRET, siteRoot: dirs.site, dataDir: dirs.data, siteUrl: 'https://expertsddt.com', cookieSecure: false });
  srv = http.createServer(app.handle); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { srv.close(); await rm(dirs.site, { recursive: true, force: true }); await rm(dirs.data, { recursive: true, force: true }); });

const jar = {};
const call = async (path, opt = {}) => {
  const r = await fetch(base + path, { redirect: 'manual', ...opt, headers: { ...(opt.headers || {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of r.headers.getSetCookie()) { const [kv, ...attrs] = c.split('; '); const i = kv.indexOf('='); if (/Max-Age=0/i.test(attrs.join(';'))) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return r;
};
const login = (over = {}) => call('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'adela@example.com', password: PASS, code: totp(totpSecret), ...over }) });
const csrf = async () => (await (await call('/')).text()).match(/name="_csrf" value="([^"]+)"/)[1];
const flash = async () => { const r = await call('/'); const h = await r.text(); return h.match(/class="flash (ok|err)">([^<]*)</)?.slice(1) ?? null; };
const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v instanceof Blob ? v : String(v), ...(v instanceof Blob ? [v.name || 'upload.bin'] : [])); return f; };

test('every response carries hardened headers and the panel ships no script', async () => {
  const r = await call('/login'); const h = await r.text();
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /script-src/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(h, /<script/i);
});

test('anonymous users are sent to the login page', async () => {
  const r = await call('/'); assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/login');
});

test('login needs the right password AND the current 6-digit code', async () => {
  assert.equal((await login({ code: '000000' })).status, 401);
  assert.equal((await login({ password: 'wrong-wrong-wrong' })).status, 401);
  assert.equal((await login({ email: 'nobody@example.com' })).status, 401);
  const ok = await login(); assert.equal(ok.status, 303); assert.ok(jar.edp_sid);
  assert.equal((await call('/')).status, 200);
});

test('uploads without the CSRF token are refused and change nothing', async () => {
  const before = await readFile(join(dirs.site, 'img', 'portal-laptop.webp'));
  await call('/upload/slot', { method: 'POST', body: form({ slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.deepEqual(await readFile(join(dirs.site, 'img', 'portal-laptop.webp')), before);
  await call('/upload/slot', { method: 'POST', body: form({ _csrf: 'forged', slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.deepEqual(await readFile(join(dirs.site, 'img', 'portal-laptop.webp')), before);
});

test('browsers send their own origin on form posts: it must be accepted, while null and foreign origins are not', async () => {
  const f = (origin) => call('/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.c&password=x&code=000000' });
  assert.notEqual((await f(base)).status, 403); // reaches the credential check (401), not the origin check
  assert.equal((await f('null')).status, 403);
  assert.equal((await f('https://evil.example')).status, 403);
  assert.equal((await call('/login')).headers.get('referrer-policy'), 'same-origin');
});

test('a foreign Origin is rejected', async () => {
  const r = await call('/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=x' });
  assert.equal(r.status, 403);
});

test('replacing an image converts it to the slot type, keeps a backup and logs it', async () => {
  const t = await csrf();
  const r = await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(1000, 700)]) }) });
  assert.equal(r.status, 303);
  const p = join(dirs.site, 'img', 'portal-laptop.webp');
  assert.equal(await sniff(p), 'webp');
  assert.equal((await sharp(await readFile(p)).metadata()).width, 1000);
  assert.equal((await readdir(join(dirs.data, 'backups', 'hero-laptop'))).length, 1);
  assert.match(await readFile(join(dirs.data, 'audit.jsonl'), 'utf8'), /"action":"replace".*portal-laptop/);
  assert.deepEqual((await flash())?.[0], 'ok');
});

test('fake images, tiny images and unknown slots are refused', async () => {
  const t = await csrf(); const p = join(dirs.site, 'img', 'portal-laptop.webp'); const keep = await readFile(p);
  for (const [fields, why] of [
    [{ _csrf: t, slot: 'hero-laptop', file: new Blob(['<?php system($_GET[0]); ?>']) }, 'php disguised as image'],
    [{ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(100, 80)]) }, 'too small'],
    [{ _csrf: t, slot: '../../etc/passwd', file: new Blob([await png(900, 600)]) }, 'unknown slot'],
  ]) {
    const r = await call('/upload/slot', { method: 'POST', body: form(fields) }); assert.equal(r.status, 303, why);
    assert.deepEqual(await readFile(p), keep, why);
    assert.equal((await flash())?.[0], 'err', why);
  }
});

test('video slots accept only real MP4 files', async () => {
  const t = await csrf();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]);
  await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'v-clinic-scan', file: new Blob([mp4]) }) });
  assert.equal(await sniff(join(dirs.site, 'video', 'clinic-scan.mp4')), 'mp4');
  await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'v-scan-ui', file: new Blob(['not a video']) }) });
  await assert.rejects(stat(join(dirs.site, 'video', 'scan-ui.mp4')));
});

test('library zips are validated, versioned, published and can be rolled back', async () => {
  const t = await csrf(); const dir = join(dirs.site, 'downloads', 'libraries');
  const good = (n) => new Blob([makeZip([{ name: `lib/part${n}.stl`, data: Buffer.from('solid x') }, { name: 'lib/config.xml', data: Buffer.from('<x/>') }])]);
  await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '10', dataDate: '2026-11-06', file: good(1) }) });
  let latest = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'));
  assert.equal(latest.version, 'v10'); assert.equal(latest.file, 'exocad-implant-libraries-v10-2026-11-06.zip'); assert.equal(latest.files, 2); assert.match(latest.sha256, /^[0-9a-f]{64}$/);
  await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '11', dataDate: '2026-11-20', file: good(2) }) });
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v11');
  // duplicate version, unsafe zip and bad metadata change nothing
  await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '11', dataDate: '2026-11-21', file: good(3) }) });
  await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '12', dataDate: '2026-11-21', file: new Blob([makeZip([{ name: '../../evil.php', data: Buffer.from('x') }])]) }) });
  await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '../1', dataDate: 'today', file: good(4) }) });
  assert.equal(JSON.parse(await readFile(join(dir, 'versions.json'), 'utf8')).length, 2);
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v11');
  // roll back to v10
  await call('/libraries/activate', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: t, file: 'exocad-implant-libraries-v10-2026-11-06.zip' }) });
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v10');
});

test('logout ends the session; repeated failed logins lock the account', async () => {
  const t = await csrf();
  await call('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: t }) });
  assert.equal((await call('/')).status, 303);
  let last; for (let i = 0; i < 9; i++) last = await login({ code: '000000' });
  assert.equal(last.status, 429);
  assert.equal((await login()).status, 429); // even the right credentials wait out the lock
});
