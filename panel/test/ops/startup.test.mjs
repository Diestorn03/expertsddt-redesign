// Operations checks: start-up, configuration and logs of the built server (dist/server/entry.mjs), the way Hostinger runs it.
// Not part of `npm test`. Run after `npm run build`:  node --test --test-concurrency=1 test/ops/
// A failing test here is a problem found by the operations review (each assertion says what an operator would expect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDirs, removeDirs, addUser, start, client, flashOf, freePort, sleep, PANEL, SECRET, PASS } from './harness.mjs';
import { totp } from '../../lib/auth.mjs';
import { png } from '../helpers.mjs';

const envOf = (dirs, extra = {}) => ({ PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com', ...extra });
const without = (env, ...keys) => Object.fromEntries(Object.entries(env).filter(([k]) => !keys.includes(k)));

test('a wrong environment stops the app at start-up with a clear message (hPanel then shows it as failed)', async () => {
  const dirs = await tempDirs();
  try {
    const cases = {
      'no PANEL_SECRET': without(envOf(dirs), 'PANEL_SECRET'),
      'PANEL_SECRET too short': envOf(dirs, { PANEL_SECRET: 'short' }),
      'no SITE_ROOT': without(envOf(dirs), 'SITE_ROOT'),
      'DATA_DIR inside SITE_ROOT': envOf(dirs, { DATA_DIR: join(dirs.site, 'data') }),
    };
    const problems = [];
    for (const [name, env] of Object.entries(cases)) {
      const srv = await start({ env, wait: false });
      const end = Date.now() + 8000;
      while (srv.proc.exitCode === null && !/listening/i.test(srv.log()) && Date.now() < end) await sleep(100);
      await sleep(500);
      const alive = srv.proc.exitCode === null;
      let status = null, csp = null;
      if (alive) { try { const r = await fetch(`${srv.base}/login`); status = r.status; csp = r.headers.get('content-security-policy'); } catch { /* not listening */ } }
      await srv.stop();
      if (alive) problems.push(`${name}: still running and answering ${status}${csp ? '' : ' without the security headers'}; log: ${srv.log().split('\n').filter(Boolean).slice(0, 2).join(' / ')}`);
    }
    assert.deepEqual(problems, []);
  } finally { await removeDirs(dirs); }
});

test('SITE_ROOT has to be the real site folder: a typo must not turn uploads into «Listo» in a folder nobody serves', async () => {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const typo = join(dirs.root, 'public_htm');
  const srv = await start({ env: envOf(dirs, { SITE_ROOT: typo, COOKIE_SECURE: '0' }) });
  try {
    const c = client(srv, secret);
    await c.login();
    const t = await c.csrf();
    const f = new FormData(); f.append('_csrf', t); f.append('slot', 'team'); f.append('file', new Blob([await png(1000, 750)]), 'team.png');
    const r = await c.call('/upload/slot', { method: 'POST', body: f });
    const n = flashOf(r.headers.getSetCookie());
    const created = await stat(join(typo, 'img', 'team.webp')).then(() => true, () => false);
    assert.ok(n?.type !== 'ok' && !created, `upload answered «${n?.title}» and wrote ${join(typo, 'img', 'team.webp')}: ${created}`);
  } finally { await srv.stop(); await removeDirs(dirs); }
});

test('without HOST the app is reachable on 127.0.0.1 (where a reverse proxy usually connects)', async () => {
  const dirs = await tempDirs();
  const port = await freePort();
  const proc = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: PANEL, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PORT: String(port), ...envOf(dirs) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  try {
    const end = Date.now() + 15_000; while (!/listening/i.test(log) && Date.now() < end) await sleep(100);
    const v4 = await fetch(`http://127.0.0.1:${port}/theme-init.js`).then((r) => r.status, (e) => e.cause?.code ?? e.message);
    const v6 = await fetch(`http://[::1]:${port}/theme-init.js`).then((r) => r.status, (e) => e.cause?.code ?? e.message);
    assert.equal(v4, 200, `127.0.0.1 -> ${v4}, [::1] -> ${v6}; log: ${log.replace(/\x1b\[[0-9;]*m/g, '').trim()}`);
  } finally { proc.kill(); await removeDirs(dirs); }
});

test('without PORT the app listens where the README says (http://localhost:8080)', async () => {
  const dirs = await tempDirs();
  const proc = spawn(process.execPath, ['dist/server/entry.mjs'], { cwd: PANEL, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, HOST: '127.0.0.1', ...envOf(dirs) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  try {
    const end = Date.now() + 15_000; while (!/listening|EADDRINUSE/i.test(log) && Date.now() < end) await sleep(100);
    assert.match(log.replace(/\x1b\[[0-9;]*m/g, ''), /listening on http:\/\/127\.0\.0\.1:8080/);
  } finally { proc.kill(); await removeDirs(dirs); }
});

test('a broken users.json is reported in the log instead of silently ending every session', async () => {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const srv = await start({ env: envOf(dirs) });
  try {
    const c = client(srv, secret);
    await c.login();
    const users = join(dirs.data, 'users.json'), saved = await readFile(users);
    await writeFile(users, saved.subarray(0, 40)); // e.g. a hand edit with a typo, or cli.mjs rewriting it (not atomic)
    const r = await c.call('/');
    await writeFile(users, saved);
    const stillIn = (await c.call('/')).status === 200;
    assert.ok(stillIn || /users\.json/i.test(srv.log()), `GET / -> ${r.status} ${r.headers.get('location')}; session kept: ${stillIn}; log mentions users.json: ${/users\.json/i.test(srv.log())}`);
  } finally { await srv.stop(); await removeDirs(dirs); }
});

test('a site folder without any of the slot files still starts and lists every slot as missing', async () => {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const srv = await start({ env: envOf(dirs) });
  try {
    const c = client(srv, secret);
    await c.login();
    const r = await c.call('/'); const h = await r.text();
    assert.equal(r.status, 200);
    const slots = JSON.parse(await readFile(join(PANEL, 'slots.json'), 'utf8'));
    for (const s of [...slots.images, ...slots.videos, ...slots.documents]) assert.ok(h.includes(`id="slot-${s.id}"`), s.id);
    assert.equal((await c.call('/history?tipo=todo')).status, 200);
  } finally { await srv.stop(); await removeDirs(dirs); }
});

// makes `import('sharp')` fail inside the server, like a prebuilt binary that did not install or load on the host
const NO_SHARP = `data:text/javascript,${encodeURIComponent(`import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, next) { if (s === "sharp") throw new Error("simulated: sharp did not load"); return next(s, c); }')}`)});`)}`;
test('if sharp cannot load on the host, the log says so at start-up (photos would go out with their EXIF/GPS)', async () => {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const srv = await start({ nodeArgs: ['--import', NO_SHARP], env: envOf(dirs, { COOKIE_SECURE: '0' }) });
  try {
    const { default: sharp } = await import('sharp');
    const c = client(srv, secret);
    await c.login(); const t = await c.csrf();
    const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#557799' } }).jpeg()
      .withExif({ IFD0: { Make: 'iPhone 15' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '25/1 46/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '80/1 11/1 0/1' } }).toBuffer();
    const f = new FormData(); f.append('_csrf', t); f.append('slot', 'og'); f.append('file', new Blob([jpg]), 'foto.jpg');
    const n = flashOf((await c.call('/upload/slot', { method: 'POST', body: f })).headers.getSetCookie());
    const meta = await sharp(await readFile(join(dirs.site, 'og.jpg'))).metadata().catch(() => null);
    assert.ok(/sharp/i.test(srv.log()), `nothing about sharp in the log; the upload answered «${n?.title}» and published og.jpg ${meta ? `${meta.width}×${meta.height} with EXIF: ${!!meta.exif}` : '(not written)'}`);
  } finally { await srv.stop(); await removeDirs(dirs); }
});

test('logs never contain the secret, passwords, TOTP, the session cookie or the CSRF token (normal use and error paths)', async () => {
  const dirs = await tempDirs();
  const secret = await addUser(dirs.data);
  const srv = await start({ env: envOf(dirs) });
  try {
    const c = client(srv, secret);
    await c.login({ password: 'Wrong-but-secret-looking-pw' });
    await c.login();
    const sid = c.jar['__Host-edp_sid'], t = await c.csrf(), code = totp(secret);
    await c.call('/upload/slot', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' }, body: 'x' }); // 500: boundary missing
    await c.call('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `email=ops%40example.com&password=${PASS}&code=${code}&pad=${'p'.repeat(9000)}` }); // 500: form too large
    await srv.stop();
    const log = srv.log();
    for (const [k, v] of Object.entries({ PANEL_SECRET: SECRET, password: PASS, 'wrong password': 'Wrong-but-secret-looking-pw', 'TOTP secret': secret, 'TOTP code': code, 'CSRF token': t, 'session cookie': sid })) assert.ok(!log.includes(v), `${k} found in the log`);
  } finally { await srv.stop(); await removeDirs(dirs); }
});
