import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { hashPassword, verifyPassword, totp, verifyTotp, sign, verify, createThrottle, newTotpSecret } from '../lib/auth.mjs';
import { sniff, inspectZip, safeJoin, placeFile, parseBackup } from '../lib/files.mjs';
import { createPanel, configFromEnv, message, MESSAGES, toResponse } from '../lib/panel.mjs';
import * as fmt from '../lib/format.mjs';
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
const MB = 1048576;
const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 5000) { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('timed out waiting'); await sleep(20); } }
const mp4 = (brand = 'isom') => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(64)]);
const lib = (n) => new Blob([makeZip(Array.from({ length: n }, (_, i) => ({ name: `lib/part${i}.stl`, data: Buffer.from('solid x') })))]);
/** The signed notice (edp_flash) set by a response, decoded: what the page will show. */
const notice = (setCookies) => { const c = [].concat(setCookies).find((x) => x.startsWith('edp_flash=') && !/Max-Age=0/.test(x)); return c ? verify(c.split(';')[0].slice(10), SECRET) : null; };
/** A multipart body written by hand, as a browser sends it: parts are [name, value, filename?]. */
const multipart = (B, parts) => Buffer.concat([...parts.flatMap(([n, v, file]) => [Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${n}"${file === undefined ? '' : `; filename="${file}"\r\nContent-Type: application/octet-stream`}\r\n\r\n`), Buffer.from(v), Buffer.from('\r\n')]), Buffer.from(`--${B}--\r\n`)]);
const ZIP_ENGLISH = /not a valid|end record|zip64 archives|not supported|too many files|corrupt central|unsafe paths|uncompressed size/i; // the old inspectZip reasons
const ENGLISH = new RegExp(`${ZIP_ENGLISH.source}|\\b(the|is|file|files|invalid|error|failed|too)\\b`, 'i');

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
    for (const [type, buf] of Object.entries(cases)) { const p = join(dir, `file.txt`); await writeFile(p, buf); assert.equal((await sniff(p)).type, type); }
    await writeFile(join(dir, 'x'), Buffer.from('<?php echo 1; ?>')); assert.equal((await sniff(join(dir, 'x'))).type, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('sniff also returns the ftyp brand: an iPhone MOV and a HEIC photo are not MP4 videos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brand-'));
  try {
    const w = async (buf) => { const p = join(dir, 'f'); await writeFile(p, buf); return sniff(p); };
    assert.deepEqual(await w(mp4('isom')), { type: 'mp4', brand: 'isom' });
    assert.deepEqual(await w(mp4('qt  ')), { type: 'mp4', brand: 'qt  ' });
    assert.deepEqual(await w(mp4('heic')), { type: 'heif', brand: 'heic' });
    assert.deepEqual(await w(await png(4, 4)), { type: 'png', brand: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('inspectZip explains each refusal with a code, never with English text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zipcode-'));
  const w = async (n, buf, opt) => { const p = join(dir, n); await writeFile(p, buf); return inspectZip(p, opt); };
  try {
    const zip64 = makeZip([{ name: 'a', data: Buffer.from('1') }]); zip64.writeUInt16LE(0xffff, zip64.length - 12); // EOCD: total entries = 0xffff
    const corrupt = makeZip([{ name: 'a', data: Buffer.from('1') }]); corrupt.writeUInt32LE(0xfffff, corrupt.length - 6); // central directory offset past the end
    const cases = [
      [await w('junk.zip', Buffer.from('not a zip at all')), { ok: false, code: 'no_eocd' }],
      [await w('z64.zip', zip64), { ok: false, code: 'zip64' }],
      [await w('bad.zip', corrupt), { ok: false, code: 'corrupt' }],
      [await w('evil.zip', makeZip([{ name: 'ok.txt', data: Buffer.from('x') }, { name: '../evil.txt', data: Buffer.from('x') }])), { ok: false, code: 'unsafe_path', detail: '../evil.txt' }],
      [await w('many.zip', makeZip([{ name: 'a', data: Buffer.from('1') }, { name: 'b', data: Buffer.from('2') }]), { maxEntries: 1 }), { ok: false, code: 'too_many', detail: 2 }],
      [await w('bomb.zip', makeZip([{ name: 'a', data: Buffer.alloc(2000) }]), { maxUncompressed: 1000 }), { ok: false, code: 'too_big' }],
    ];
    for (const [got, want] of cases) assert.deepEqual(got, want);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('placeFile keeps only the 10 most recent backups of each file name, and backup names carry their time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keep-'));
  try {
    const site = join(dir, 'site'), backups = join(dir, 'backups');
    for (let i = 0; i < 13; i++) {
      for (const name of ['team.webp', 'poster.webp']) { const src = join(dir, `src-${name}`); await writeFile(src, `${name} v${i}`); await placeFile(src, join(site, name), backups); }
      await sleep(3); // backup names have millisecond resolution
    }
    const left = await readdir(backups);
    for (const name of ['team.webp', 'poster.webp']) {
      const mine = left.filter((f) => parseBackup(f)?.name === name).sort();
      assert.equal(mine.length, 10, name);
      assert.equal(await readFile(join(backups, mine.at(-1)), 'utf8'), `${name} v11`); // the newest copy is the version before the live one
      assert.equal(await readFile(join(backups, mine[0]), 'utf8'), `${name} v2`); // v0 and v1 were dropped
    }
    assert.deepEqual(parseBackup('2026-11-07T19-40-10-123Z__team.webp'), { ts: Date.parse('2026-11-07T19:40:10.123Z'), name: 'team.webp' });
    for (const bad of ['team.webp', '../2026-11-07T19-40-10-123Z__team.webp', '2026-11-07T19:40:10.123Z__team.webp']) assert.equal(parseBackup(bad), null, bad);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('formats: sizes, Florida dates and times, data dates in UTC, relative time, history days and «lugares»', () => {
  assert.equal(fmt.size(105 * 1024 + 300), '105 KB'); assert.equal(fmt.size(24872754), '23.7 MB'); assert.equal(fmt.size(MB), '1.0 MB');
  assert.equal(fmt.size(10), '1 KB'); assert.equal(fmt.size(0), '0 KB');
  const t = Date.parse('2026-11-07T19:40:10.123Z'); // Saturday, 2:40 p.m. in Florida (EST)
  assert.equal(fmt.dateTime(t), '7 nov 2026, 2:40 p.m.'); assert.equal(fmt.date(t), '7 nov 2026'); assert.equal(fmt.time(t), '2:40 p.m.');
  assert.equal(fmt.isoDay(Date.parse('2026-11-07T03:00:00Z')), '2026-11-06'); // still the 6th in Florida
  // a data date is a calendar day: formatted in UTC it stays the 6th, in New York time it would slip to the 5th
  assert.equal(fmt.dataDate('2026-11-06'), '6 de noviembre de 2026'); assert.equal(fmt.dataDate('2026-11-06', 'short'), '6 nov 2026');
  assert.equal(new Intl.DateTimeFormat('es-US', { timeZone: 'America/New_York', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.parse('2026-11-06')), '5 de noviembre de 2026');
  assert.equal(fmt.dataDate('nonsense'), '');
  assert.equal(fmt.publicLine({ version: 'v10', dataDate: '2026-11-06', bytes: 24872754 }), 'Versión v10 · actualizada el 6 de noviembre de 2026 · 24 MB');
  assert.equal(fmt.files(1), '1 archivo'); assert.equal(fmt.files(35), '35 archivos');
  assert.equal(fmt.relative(t - 30_000, t), 'hace un momento'); assert.equal(fmt.relative(t - 5 * 60_000, t), 'hace 5 minutos');
  assert.equal(fmt.relative(t - 2 * 3600_000, t), 'hace 2 horas'); assert.equal(fmt.relative(t - 26 * 3600_000, t), 'ayer'); assert.equal(fmt.relative(t - 4 * 86400_000, t), 'hace 4 días');
  assert.equal(fmt.day(t, t), 'Hoy · sábado 7 de noviembre'); assert.equal(fmt.day(t - 86400_000, t), 'Ayer · viernes 6 de noviembre');
  assert.equal(fmt.day(t - 2 * 86400_000, t), 'Jueves 5 de noviembre de 2026');
  assert.equal(fmt.places([{ page: 'Inicio', section: 'pilar «Soporte y contacto»' }, { page: 'Servicios', section: '«Visitas de consultoría y soporte»' }]),
    'Inicio (pilar «Soporte y contacto») y en Servicios («Visitas de consultoría y soporte»)');
  assert.equal(fmt.places([{ page: 'Cursos' }, { page: 'Inicio', section: 'portada' }, { page: 'Tienda' }]), 'Cursos, en Inicio (portada) y en Tienda');
  assert.equal(fmt.places([{ page: 'Tienda' }]), 'Tienda'); assert.equal(fmt.places([]), '');
});

test('server messages are the Spanish ones of DESIGN §7.13 and every error ends with «Nada cambió en la web.»', () => {
  const keys = ['csrf', 'no_file', 'unknown_slot', 'too_big', 'img_type', 'img_format', 'img_small', 'img_unreadable', 'video_type', 'video_mov', 'video_big', 'poster', 'no_poster', 'pdf',
    'lib_meta', 'lib_file', 'lib_not_zip', 'zip_no_eocd', 'zip_64', 'zip_many', 'zip_corrupt', 'zip_unsafe', 'zip_big', 'lib_dup', 'lib_unknown', 'restore_unknown',
    'ok_image', 'ok_video', 'ok_pdf', 'ok_publish', 'warn_publish', 'ok_activate', 'ok_restore', 'logout', 'expired', 'expired_upload', 'login_401', 'login_429'];
  assert.deepEqual(Object.keys(MESSAGES).sort(), keys.slice().sort());
  const all = { max: 13, formato: 'WebP', w: 640, min: 800, x: '18.3', motivo: 'la foto mide 300 px de ancho.', n: 11, ruta: '../x', v: 'v11', anterior: 'v10', m: 35, titulo: 'Foto del equipo' };
  for (const k of keys) {
    const m = message(k, all), words = `${m.title} ${m.text}`;
    assert.equal(m.key, k); assert.ok(['ok', 'warn', 'err', 'info'].includes(m.type), k);
    if (m.type === 'err') assert.match(m.text, /[.?!)] Nada cambió en la web\.$/, k);
    assert.doesNotMatch(words, ENGLISH, k); assert.doesNotMatch(words, /\{\w+\}/, k);
  }
  assert.equal(message('lib_dup', { v: 'v10', n: 11 }).text, 'La versión v10 ya existe. Usa un número nuevo, por ejemplo 11. Nada cambió en la web.');
  assert.equal(message('warn_publish', { v: 'v11', n: 3, anterior: 'v10', m: 35 }).title, 'Publicada, pero revísala: la v11 tiene 3 archivos y la v10 tenía 35.');
  assert.equal(message('expired_upload').text, 'Entra de nuevo y vuelve a elegirlo. Nada cambió en la web.'); // info: no second suffix
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
const flash = async () => { const r = await call('/'); const h = await r.text(); return h.match(/data-flash="(ok|err|warn|info)"/)?.slice(1) ?? null; };
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
  assert.equal((await sniff(p)).type, 'webp');
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
  assert.equal((await sniff(join(dirs.site, 'video', 'clinic-scan.mp4'))).type, 'mp4');
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

const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const post = (path, fields) => { const b = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x); return call(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b }); };

test('with X-Panel-Xhr the upload routes answer 200 {to} plus the notice cookie, instead of a 303', async () => {
  const t = await csrf(), xhr = { 'X-Panel-Xhr': '1' };
  const ok = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(1000, 700)]) }) });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { to: '/#slot-hero-laptop' });
  assert.ok(ok.headers.getSetCookie().some((c) => c.startsWith('edp_flash=')));
  const n = notice(ok.headers.getSetCookie());
  assert.equal(n.key, 'ok_image'); assert.equal(n.slot, 'hero-laptop'); assert.equal(n.undo.action, '/restore'); assert.equal(n.undo.label, 'Deshacer');
  const bad = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob(['not an image']) }) });
  assert.equal(bad.status, 200); assert.deepEqual(await bad.json(), { to: '/#slot-hero-laptop' }); assert.equal(notice(bad.headers.getSetCookie()).key, 'img_type');
  const lib = await call('/upload/libraries', { method: 'POST', headers: xhr, body: form({ _csrf: t, version: 'x', dataDate: '2026-11-07', file: new Blob(['zip?']) }) });
  assert.equal(lib.status, 200); assert.deepEqual(await lib.json(), { to: '/#librerias' });
  const forged = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: 'forged', slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.equal(forged.status, 403); assert.deepEqual(await forged.json(), { to: '/' }); assert.equal(notice(forged.headers.getSetCookie()).key, 'csrf');
  assert.equal((await call('/upload/slot', { method: 'POST', body: form({ _csrf: 'forged', slot: 'hero-laptop', file: new Blob(['x']) }) })).status, 403); // a plain form gets the 403 page
  assert.equal((await flash())?.[0], 'err'); // the page shows the last notice, then forgets it
  assert.equal(await flash(), null);
});

test('a session that is not valid any more goes to /login with a notice (401 JSON for XHR, a special one mid-upload)', async () => {
  const stale = { Cookie: 'edp_sid=bad.token' };
  const page = await fetch(base + '/', { redirect: 'manual', headers: stale });
  assert.equal(page.status, 303); assert.equal(page.headers.get('location'), '/login');
  assert.ok(page.headers.getSetCookie().some((c) => /^edp_sid=;.*Max-Age=0/.test(c)));
  const n = notice(page.headers.getSetCookie()); assert.equal(n.key, 'expired'); assert.equal(n.type, 'info');
  const up = await fetch(base + '/upload/slot', { method: 'POST', redirect: 'manual', headers: { ...stale, 'X-Panel-Xhr': '1' }, body: form({ slot: 'team', file: new Blob(['x']) }) });
  assert.equal(up.status, 401); assert.deepEqual(await up.json(), { to: '/login' });
  const cookie = up.headers.getSetCookie().find((c) => c.startsWith('edp_flash=')).split(';')[0];
  assert.equal(verify(cookie.slice(10), SECRET).key, 'expired_upload');
  const shown = await fetch(base + '/login', { headers: { Cookie: cookie } });
  assert.match(await shown.text(), /data-flash="info"[^>]*>Tu sesión terminó mientras subías el archivo\./);
  assert.ok(shown.headers.getSetCookie().some((c) => /^edp_flash=;.*Max-Age=0/.test(c))); // shown once
  const none = await fetch(base + '/', { redirect: 'manual' }); // never logged in: no notice
  assert.equal(notice(none.headers.getSetCookie()), null);
});

test('a failed login is shown again with the email kept and the reason', async () => {
  const r = await login({ code: '000000' }); const h = await r.text();
  assert.equal(r.status, 401); assert.match(h, /value="adela@example\.com"/); assert.match(h, /data-flash="err"[^>]*>Credenciales inválidas\./);
});

test('a code typed with a space («123 456») logs in', async () => {
  const c = totp(totpSecret); const r = await login({ code: `${c.slice(0, 3)} ${c.slice(3)}` });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/'); assert.equal((await call('/')).status, 200);
});

test('an upload cancelled halfway leaves DATA_DIR/tmp empty and the site untouched', { timeout: 15_000 }, async () => {
  const t = await csrf(), tmp = join(dirs.data, 'tmp'), B = 'cancel-boundary', ac = new AbortController();
  const body = new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`--${B}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${t}\r\n--${B}\r\nContent-Disposition: form-data; name="slot"\r\n\r\nteam\r\n--${B}\r\nContent-Disposition: form-data; name="file"; filename="team.png"\r\nContent-Type: image/png\r\n\r\n`));
    c.enqueue(new Uint8Array(256 * 1024)); // ...and the rest never comes
  } });
  const sent = fetch(base + '/upload/slot', { method: 'POST', body, duplex: 'half', signal: ac.signal, headers: { 'Content-Type': `multipart/form-data; boundary=${B}`, Cookie: cookieHeader() } }).catch(() => null);
  await until(async () => (await readdir(tmp)).length > 0); // the server is writing it
  ac.abort(); await sent;
  await until(async () => (await readdir(tmp)).length === 0);
  await assert.rejects(stat(join(dirs.site, 'img', 'team.webp')));
});

test('the image for social networks is always saved at 1200×630', async () => {
  const r = await call('/upload/slot', { method: 'POST', body: form({ _csrf: await csrf(), slot: 'og', file: new Blob([await png(1300, 1300)]) }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#slot-og');
  const m = await sharp(await readFile(join(dirs.site, 'og.jpg'))).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1200, 630]);
});

test('an iPhone MOV (ftyp «qt  ») is refused with its own message; a blank poster input does not block a video', async () => {
  const t = await csrf(), dest = join(dirs.site, 'video', 'scan-ui.mp4');
  const mov = await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'v-scan-ui', file: new Blob([mp4('qt  ')]) }) });
  assert.equal(mov.status, 303); assert.equal(mov.headers.get('location'), '/#slot-v-scan-ui');
  const n = notice(mov.headers.getSetCookie()); assert.equal(n.key, 'video_mov'); assert.equal(n.slot, 'v-scan-ui');
  await assert.rejects(stat(dest));
  const B = 'browser-form'; // browsers always send the optional poster input, with filename="" when nothing was chosen
  const r = await call('/upload/slot', { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${B}` },
    body: multipart(B, [['_csrf', t], ['slot', 'v-scan-ui'], ['file', mp4(), 'scan.mp4'], ['poster', '', '']]) });
  assert.equal(notice(r.headers.getSetCookie()).key, 'ok_video');
  assert.deepEqual(await readFile(dest), mp4());
});

test('restore swaps in a listed copy, keeps the current file as a new copy, logs it and can be undone; nothing else is accepted', async () => {
  const t = await csrf(), dir = join(dirs.data, 'backups', 'hero-laptop'), live = join(dirs.site, 'img', 'portal-laptop.webp');
  const before = await readdir(dir), oldest = before.slice().sort()[0], current = await readFile(live);
  const r = await post('/restore', { _csrf: t, slot: 'hero-laptop', file: oldest });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#slot-hero-laptop');
  assert.deepEqual(await readFile(live), await readFile(join(dir, oldest)));
  assert.equal((await sharp(await readFile(live)).metadata()).width, 900); // the original 900 px file is back
  const created = (await readdir(dir)).filter((f) => !before.includes(f));
  assert.equal(created.length, 1); assert.deepEqual(await readFile(join(dir, created[0])), current);
  const lastLine = JSON.parse((await readFile(join(dirs.data, 'audit.jsonl'), 'utf8')).trim().split('\n').at(-1));
  assert.equal(lastLine.action, 'restore'); assert.equal(lastLine.slot, 'hero-laptop'); assert.deepEqual(lastLine.files, [oldest]);
  const n = notice(r.headers.getSetCookie());
  assert.equal(n.key, 'ok_restore'); assert.equal(n.title, 'Listo: volviste a una versión anterior de «Laptop del Doctor Portal».');
  assert.deepEqual(n.undo, { action: '/restore', fields: { slot: 'hero-laptop', file: created }, label: 'Deshacer' });
  // refused: a name that is not in that folder, paths, another slot's copy, a stray file with the wrong name
  await mkdir(join(dirs.data, 'backups', 'team'), { recursive: true });
  const teamCopy = '2026-01-01T00-00-00-000Z__team.webp', stray = '2026-01-01T00-00-00-000Z__users.json';
  await writeFile(join(dirs.data, 'backups', 'team', teamCopy), 'team'); await writeFile(join(dir, stray), '[]');
  const restored = await readFile(live);
  for (const [slot, file] of [['hero-laptop', '2026-01-02T00-00-00-000Z__portal-laptop.webp'], ['hero-laptop', `../team/${teamCopy}`], ['hero-laptop', teamCopy],
    ['hero-laptop', '../../users.json'], ['team', created[0]], ['hero-laptop', stray], ['hero-laptop', [oldest, created[0]]], ['hero-laptop', []]]) {
    const x = await post('/restore', { _csrf: t, slot, file });
    assert.equal(x.status, 303, `${slot} ${file}`); assert.equal(notice(x.headers.getSetCookie()).key, 'restore_unknown', `${slot} ${file}`);
    assert.deepEqual(await readFile(live), restored, `${slot} ${file}`);
  }
  assert.equal((await post('/restore', { _csrf: 'forged', slot: 'hero-laptop', file: oldest })).status, 403);
  await post(n.undo.action, { _csrf: t, ...n.undo.fields }); // «Deshacer»
  assert.deepEqual(await readFile(live), current);
  await flash();
});

test('zip problems are explained in Spanish only, with the version and date kept for the form', async () => {
  const t = await csrf();
  const zip64 = makeZip([{ name: 'a', data: Buffer.from('1') }]); zip64.writeUInt16LE(0xffff, zip64.length - 12);
  for (const [buf, key] of [[zip64, 'zip_64'], [makeZip([{ name: '../evil.php', data: Buffer.from('x') }]), 'zip_unsafe']]) {
    const r = await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '90', dataDate: '2026-11-01', file: new Blob([buf]) }) });
    assert.equal(r.headers.get('location'), '/#librerias');
    const n = notice(r.headers.getSetCookie());
    assert.equal(n.key, key); assert.equal(n.type, 'err'); assert.equal(n.slot, 'libraries'); assert.deepEqual(n.keep, { version: '90', dataDate: '2026-11-01' });
    assert.doesNotMatch(`${n.title} ${n.text}`, ENGLISH); assert.match(n.text, /Nada cambió en la web\.$/);
    const page = await (await call('/')).text();
    assert.match(page, /data-flash="err"/); assert.doesNotMatch(page, ZIP_ENGLISH);
  }
});

test('the first publish without versions.json keeps the active version listed; a much smaller zip is flagged and undone in one click', async () => {
  const t = await csrf(), dir = join(dirs.site, 'downloads', 'libraries');
  await rm(join(dir, 'versions.json')); // today's hosting: latest.json (v10 here) and no versions.json
  const r = await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: 'v12', dataDate: '2026-11-07', file: lib(5) }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#librerias'); assert.equal(notice(r.headers.getSetCookie()).key, 'ok_publish');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'versions.json'), 'utf8')).map((v) => v.version), ['v10', 'v12']);
  assert.match(await (await call('/')).text(), /v10/);
  const publishLine = JSON.parse((await readFile(join(dirs.data, 'audit.jsonl'), 'utf8')).trim().split('\n').at(-1));
  assert.match(publishLine.detail, /^v12 · 5 archivos · \d+ KB$/); assert.equal(publishLine.version, 'v12'); assert.equal(publishLine.files, 5);
  const small = await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '13', dataDate: '2026-11-07', file: lib(2) }) });
  const n = notice(small.headers.getSetCookie());
  assert.equal(n.key, 'warn_publish'); assert.equal(n.type, 'warn'); assert.equal(n.title, 'Publicada, pero revísala: la v13 tiene 2 archivos y la v12 tenía 5.');
  assert.deepEqual(n.undo, { action: '/libraries/activate', fields: { file: 'exocad-implant-libraries-v12-2026-11-07.zip' }, label: 'Volver a la v12' });
  const back = await post(n.undo.action, { _csrf: t, ...n.undo.fields });
  assert.equal(back.headers.get('location'), '/#librerias');
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v12');
  const ok = notice(back.headers.getSetCookie());
  assert.deepEqual([ok.key, ok.title, ok.text, ok.undo.label], ['ok_activate', 'Listo: la versión v12 vuelve a estar en la web.', 'La v13 sigue guardada.', 'Volver a la v13']);
  const dup = notice((await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '12', dataDate: '2026-11-07', file: lib(5) }) })).headers.getSetCookie());
  assert.equal(dup.text, 'La versión v12 ya existe. Usa un número nuevo, por ejemplo 14. Nada cambió en la web.');
  await flash();
});

test('logout ends the session; repeated failed logins lock the account', async () => {
  const t = await csrf();
  await call('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: t }) });
  assert.equal((await call('/')).status, 303);
  let last; for (let i = 0; i < 9; i++) last = await login({ code: '000000' });
  assert.equal(last.status, 429);
  assert.equal((await login()).status, 429); // even the right credentials wait out the lock
});

// ---------- the core, called the way the Astro endpoints call it: request.headers, request.body (a Web stream), request.signal ----------
const web = (path, body, extra = {}) => { const r = new Request(`http://panel.test${path}`, { method: 'POST', body }); return { headers: r.headers, body: r.body, signal: r.signal, ip: '203.0.113.9', ...extra }; };
const fields = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) v instanceof Blob ? f.append(k, v, 'upload.bin') : f.append(k, String(v)); return f; };
async function corePanel(cfg = {}) {
  const d = { site: await mkdtemp(join(tmpdir(), 'core-site-')), data: await mkdtemp(join(tmpdir(), 'core-data-')) };
  const secret = newTotpSecret(), now = cfg.now ?? Date.now;
  await writeFile(join(d.data, 'users.json'), JSON.stringify([{ email: 'david@example.com', name: 'David Vargas', hash: await hashPassword(PASS), totp: secret, tokenVersion: 0 }]));
  const panel = await createPanel({ secret: SECRET, siteRoot: d.site, dataDir: d.data, siteUrl: 'https://expertsddt.com', cookieSecure: false, ...cfg });
  const res = await panel.login(web('/login', new URLSearchParams({ email: 'david@example.com', password: PASS, code: totp(secret, now()) })));
  const cookie = res.setCookies[0].split(';')[0];
  const g = await panel.guard({ method: 'GET', path: '/', headers: new Headers({ cookie }) });
  return { panel, d, cookie, session: g.session, csrf: g.csrf, close: () => Promise.all([rm(d.site, { recursive: true, force: true }), rm(d.data, { recursive: true, force: true })]) };
}

test('the core sends strict headers: CSP as a header with script-src self and nothing inline, no framing, no caching', async () => {
  const c = await corePanel();
  try {
    const h = c.panel.securityHeaders(), csp = h['Content-Security-Policy'];
    for (const part of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' https://expertsddt.com blob:", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(csp.includes(part), part);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|data:|\*/);
    assert.deepEqual([h['X-Frame-Options'], h['Cache-Control'], h['Referrer-Policy'], h['X-Content-Type-Options']], ['DENY', 'no-store', 'same-origin', 'nosniff']);
    assert.equal(h['Strict-Transport-Security'], undefined); // COOKIE_SECURE=0 in tests; on by default
    assert.equal(c.panel.securityHeaders({ csp: false })['Content-Security-Policy'], undefined); // astro dev only
    assert.match(c.cookie, /^edp_sid=/);
    const login = await c.panel.login(web('/login', new URLSearchParams({ email: 'david@example.com', password: PASS, code: '000000' })));
    assert.deepEqual([login.status, login.view, login.data.email, login.data.flash.key], [401, 'login', 'david@example.com', 'login_401']);
    const res = toResponse({ status: 200, json: { to: '/#slot-team' }, setCookies: ['a=1', 'b=2'] });
    assert.equal(res.status, 200); assert.deepEqual(await res.json(), { to: '/#slot-team' }); assert.deepEqual(res.headers.getSetCookie(), ['a=1', 'b=2']);
    assert.equal(toResponse({ status: 303, location: '/login', setCookies: [] }).headers.get('location'), '/login');
    await assert.rejects(createPanel({ secret: SECRET, siteRoot: c.d.site, dataDir: join(c.d.site, 'data') }), /outside SITE_ROOT/);
  } finally { await c.close(); }
});

test('the core guard: a logged-in /login goes home, a revoked session is sent back with a notice, logout leaves its own', async () => {
  const c = await corePanel();
  try {
    const H = (cookie, more = {}) => new Headers({ cookie, ...more });
    assert.equal((await c.panel.guard({ method: 'GET', path: '/login', headers: H(c.cookie) })).response.location, '/');
    const g = await c.panel.guard({ method: 'GET', path: '/', headers: H(c.cookie) });
    assert.equal(g.session.uid, 'david@example.com'); assert.equal(g.csrf, c.csrf); assert.deepEqual(g.setCookies, []);
    assert.equal((await c.panel.guard({ method: 'POST', path: '/restore', headers: H(c.cookie, { origin: 'null', host: 'admin.expertsddt.com' }) })).response.status, 403);
    assert.equal((await c.panel.guard({ method: 'POST', path: '/restore', headers: H(c.cookie, { origin: 'https://admin.expertsddt.com', host: 'admin.expertsddt.com' }) })).response, undefined);
    const usersFile = join(c.d.data, 'users.json'), list = JSON.parse(await readFile(usersFile, 'utf8'));
    list[0].tokenVersion = 1; await writeFile(usersFile, JSON.stringify(list)); // what `cli.mjs revoke` does
    const gone = await c.panel.guard({ method: 'GET', path: '/', headers: H(c.cookie) });
    assert.equal(gone.response.location, '/login'); assert.equal(notice(gone.response.setCookies).key, 'expired');
    list[0].tokenVersion = 0; await writeFile(usersFile, JSON.stringify(list));
    // operations refuse to run without a session even if a route forgot the middleware, and a stale token is a 403
    assert.equal((await c.panel.restore(web('/restore', new URLSearchParams({ _csrf: c.csrf, slot: 'team' })))).location, '/login');
    assert.equal((await c.panel.activate({ session: c.session, ...web('/libraries/activate', new URLSearchParams({ _csrf: 'stale' })) })).view, '403');
    const out = await c.panel.logout({ session: c.session, ...web('/logout', new URLSearchParams({ _csrf: c.csrf })) });
    assert.deepEqual([out.status, out.location], [303, '/login']);
    assert.ok(out.setCookies.some((x) => /^edp_sid=;.*Max-Age=0/.test(x)));
    const n = notice(out.setCookies); assert.deepEqual([n.type, n.key, n.title, n.text], ['info', 'logout', 'Cerraste sesión.', '¡Hasta pronto!']);
  } finally { await c.close(); }
});

test('LIB_MAX_MB caps library uploads, and its value is the one the message and the page announce', async () => {
  assert.equal(configFromEnv({}).libMaxMb, 300); assert.equal(configFromEnv({ LIB_MAX_MB: '250' }).libMaxMb, 250);
  const c = await corePanel({ libMaxMb: 1 });
  try {
    const r = await c.panel.uploadLibrary({ session: c.session, ...web('/upload/libraries', fields({ _csrf: c.csrf, version: '11', dataDate: '2026-11-07', file: new Blob([makeZip([{ name: 'lib/big.stl', data: Buffer.alloc(1.5 * MB) }])]) })) });
    assert.deepEqual([r.status, r.location], [303, '/#librerias']);
    const n = notice(r.setCookies);
    assert.equal(n.key, 'lib_file'); assert.equal(n.text, 'Falta el archivo o pesa más de 1 MB. Nada cambió en la web.'); assert.deepEqual(n.keep, { version: '11', dataDate: '2026-11-07' });
    assert.deepEqual(await readdir(join(c.d.data, 'tmp')), []);
    assert.equal((await c.panel.dashboard(c.session)).libMaxMb, 1);
  } finally { await c.close(); }
});

test('the core: a cancelled Web-stream upload answers 499 and leaves no temporary file', { timeout: 15_000 }, async () => {
  const c = await corePanel();
  try {
    const B = 'core-cancel', ac = new AbortController(), tmp = join(c.d.data, 'tmp');
    const body = new ReadableStream({ start(ctl) {
      ctl.enqueue(enc.encode(`--${B}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${c.csrf}\r\n--${B}\r\nContent-Disposition: form-data; name="file"; filename="v.zip"\r\n\r\n`));
      ctl.enqueue(new Uint8Array(64 * 1024));
    } });
    const pending = c.panel.uploadLibrary({ session: c.session, headers: new Headers({ 'content-type': `multipart/form-data; boundary=${B}` }), body, signal: ac.signal, ip: '203.0.113.9' });
    await until(async () => (await readdir(tmp)).length > 0);
    ac.abort();
    assert.equal((await pending).status, 499);
    assert.deepEqual(await readdir(tmp), []);
  } finally { await c.close(); }
});

test('the dashboard data has what the page renders: files with state and copies, the library joined with latest.json, the last change', async () => {
  const c = await corePanel();
  try {
    const site = c.d.site, libDir = join(site, 'downloads', 'libraries');
    await mkdir(join(site, 'img'), { recursive: true }); await mkdir(libDir, { recursive: true });
    await writeFile(join(site, 'img', 'team.webp'), await sharp({ create: { width: 900, height: 700, channels: 3, background: '#345' } }).webp().toBuffer());
    await writeFile(join(site, 'img', 'design-services.webp'), await sharp({ create: { width: 900, height: 700, channels: 3, background: '#345' } }).webp().toBuffer());
    await writeFile(join(libDir, 'latest.json'), JSON.stringify({ version: 'v10', dataDate: '2026-11-06', file: 'exocad-implant-libraries-v10-2026-11-06.zip', bytes: 24872754, sha256: 'ab'.repeat(32), files: 35 }));
    let d = await c.panel.dashboard(c.session);
    assert.deepEqual(d.libraries.versions.map((v) => [v.version, v.active]), [['v10', true]]); // latest.json without versions.json: still listed
    assert.deepEqual([d.libraries.existing, d.libraries.nextVersion, d.libraries.since, d.lastChange], [['v10'], 11, null, null]);
    assert.equal(d.libraries.publicLine, 'Versión v10 · actualizada el 6 de noviembre de 2026 · 24 MB');
    for (let i = 0; i < 8; i++) { // 8 PDFs: the first fills a missing slot, the next 7 each keep a copy
      const r = await c.panel.uploadSlot({ session: c.session, ...web('/upload/slot', fields({ _csrf: c.csrf, slot: 'guide-pdf', file: new Blob([`%PDF-1.7\n% ${i}`]) })) });
      assert.equal(r.location, '/#slot-guide-pdf'); await sleep(3);
    }
    const pub = await c.panel.uploadLibrary({ session: c.session, ...web('/upload/libraries', fields({ _csrf: c.csrf, version: '11', dataDate: '2026-11-07', file: lib(40) })) });
    assert.equal(notice(pub.setCookies).key, 'ok_publish');
    d = await c.panel.dashboard(c.session);
    assert.deepEqual(d.user, { email: 'david@example.com', name: 'David Vargas', initials: 'DV' });
    assert.deepEqual([d.csrf, d.canConvert, d.libMaxMb, d.siteUrl], [c.csrf, true, 300, 'https://expertsddt.com']);
    assert.deepEqual(d.counts, { image: { total: 15, missing: 13 }, video: { total: 6, missing: 6 }, document: { total: 1, missing: 0 } });
    assert.ok(d.missing.includes('Foto de Fernando') && !d.missing.includes('Foto del equipo'));
    assert.deepEqual(d.slots.map((s) => s.id).slice(0, 3), ['design-services', 'hero-laptop', 'scanner-front']); // the order of the site
    const team = d.slots.find((s) => s.id === 'team');
    assert.deepEqual([team.kind, team.group, team.missing, team.fresh, team.size > 0, team.format, team.stage, team.frame], ['image', 'paginas', false, true, true, 'WebP', 'well', '4x3']);
    assert.match(team.url, /^https:\/\/expertsddt\.com\/img\/team\.webp\?v=\d+$/); assert.equal(team.webUrl, 'https://expertsddt.com/es/#pillars');
    assert.equal(team.places, 'Inicio (pilar «Soporte y contacto») y en Servicios («Visitas de consultoría y soporte»)');
    assert.equal(d.slots.find((s) => s.id === 'v-smile-design').posterUrl.startsWith('https://expertsddt.com/img/design-services.webp?v='), true); // its thumb
    const og = d.slots.find((s) => s.id === 'og'); assert.deepEqual([og.missing, og.url, og.fresh, og.backups, og.crop, og.frame], [true, null, false, [], 'og', 'og']);
    const pdf = d.slots.find((s) => s.id === 'guide-pdf');
    assert.equal(pdf.backups.length, 6); // at most 6 on the page (10 kept on disk)
    assert.equal((await readdir(join(c.d.data, 'backups', 'guide-pdf'))).length, 7);
    assert.ok(pdf.backups.every((b, i, all) => b.role === 'file' && b.size > 0 && parseBackup(b.file).ts === b.ts && (i === 0 || all[i - 1].ts >= b.ts)));
    assert.deepEqual([d.lastChange.action, d.lastChange.title, d.lastChange.who, d.lastChange.rel], ['library_publish', 'Librerías v11', 'David Vargas', 'hace un momento']);
    const L = d.libraries;
    assert.deepEqual(L.versions.map((v) => [v.version, v.active]), [['v11', true], ['v10', false]]);
    assert.deepEqual([L.latest.version, L.existing, L.nextVersion, L.fresh, L.since.who, L.today], ['v11', ['v10', 'v11'], 12, true, 'David Vargas', fmt.isoDay(Date.now())]);
    assert.equal(L.zipUrl, 'https://expertsddt.com/downloads/libraries/exocad-implant-libraries-v11-2026-11-07.zip'); assert.equal(L.pageUrl, 'https://expertsddt.com/es/exocad-libraries/');
  } finally { await c.close(); }
});

test('the history reads as sentences in Florida time, grouped by day, filtered, with names from users.json and the IP only on failed attempts', async () => {
  const NOW = Date.parse('2026-11-07T20:00:00Z'); // Saturday 3:00 p.m. in Florida
  const c = await corePanel({ now: () => NOW });
  try {
    const L = (ts, user, action, detail = '', extra = {}) => JSON.stringify({ ts, user, action, detail, ip: '45.1.2.3', ...extra });
    await writeFile(join(c.d.data, 'audit.jsonl'), [
      L('2026-11-06T04:15:00.000Z', 'david@example.com', 'replace', 'img/smile-a-before.webp'), // older line: no slot field
      L('2026-11-06T15:00:00.000Z', 'diego@example.com', 'library_publish', 'v10 (35 archivos, 24872754 bytes)'), // older format
      L('2026-11-06T16:00:00.000Z', 'david@example.com', 'library_activate', 'v9'),
      '{"broken json', '{"ts":"not a date","user":"x","action":"login"}',
      L('2026-11-07T19:40:00.000Z', 'david@example.com', 'replace', 'video/scan-ui.mp4 + portada', { slot: 'v-scan-ui' }),
      L('2026-11-07T19:45:00.000Z', 'david@example.com', 'restore', '2026-11-07T19-40-10-123Z__team.webp', { slot: 'team', files: ['2026-11-07T19-40-10-123Z__team.webp'] }),
      L('2026-11-07T19:50:00.000Z', 'ana@gmail.com', 'login_failed'),
      L('2026-11-07T19:51:00.000Z', 'ana@gmail.com', 'login_blocked'),
      L('2026-11-07T19:55:00.000Z', 'david@example.com', 'login'),
    ].join('\n') + '\n');
    const h = await c.panel.history(c.session, 'cambios');
    assert.deepEqual([h.tipo, h.empty, h.user.name, h.csrf], ['cambios', null, 'David Vargas', c.csrf]);
    assert.deepEqual(h.groups.map((g) => g.label), ['Hoy · sábado 7 de noviembre', 'Ayer · viernes 6 de noviembre', 'Jueves 5 de noviembre de 2026']);
    assert.deepEqual(h.groups.flatMap((g) => g.items.map((i) => [i.time, i.who, i.text, i.detail, i.icon])), [
      ['2:45 p.m.', 'David Vargas', 'volvió a una versión anterior de «Foto del equipo»', 'copia del 7 nov 2026, 2:40 p.m.', 'rotate-ccw'],
      ['2:40 p.m.', 'David Vargas', 'cambió el video «Software del escáner facial» y su portada', 'video/scan-ui.mp4', 'upload'],
      ['11:00 a.m.', 'David Vargas', 'volvió a poner en la web la versión v9 de las librerías', '', 'rotate-ccw'],
      ['10:00 a.m.', 'diego@example.com', 'publicó la versión v10 de las librerías', '35 archivos · 23.7 MB', 'package'],
      ['11:15 p.m.', 'David Vargas', 'cambió la foto «Caso A · Antes»', 'img/smile-a-before.webp', 'upload'],
    ]);
    assert.ok(h.groups.every((g) => g.items.every((i) => i.ip === null && !i.warn)));
    const a = await c.panel.history(c.session, 'accesos');
    assert.deepEqual(a.groups.flatMap((g) => g.items.map((i) => [i.who, i.text, i.detail, i.ip, i.warn])), [
      ['David Vargas', 'entró al panel', '', null, false],
      [null, 'Acceso pausado 15 minutos por demasiados intentos (ana@gmail.com)', 'IP 45.1.2.3', '45.1.2.3', true],
      [null, 'Intento de acceso fallido con ana@gmail.com', 'IP 45.1.2.3', '45.1.2.3', true],
    ]);
    assert.equal((await c.panel.history(c.session, 'todo')).groups.flatMap((g) => g.items).length, 8);
    assert.equal((await c.panel.history(c.session, 'whatever')).tipo, 'cambios');
    await writeFile(join(c.d.data, 'audit.jsonl'), L('2026-11-07T19:55:00.000Z', 'david@example.com', 'login') + '\n');
    assert.equal((await c.panel.history(c.session, 'cambios')).empty, 'none');
    assert.equal((await c.panel.history(c.session, 'accesos')).empty, null);
  } finally { await c.close(); }
});
