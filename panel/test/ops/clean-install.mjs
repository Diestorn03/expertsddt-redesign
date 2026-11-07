// Deployability check: copies panel/ WITHOUT node_modules and WITHOUT the parent repo, runs `npm ci --omit=dev`,
// starts the already-built dist/server/entry.mjs from the copy under Node's permission model (reads only the copy,
// SITE_ROOT and DATA_DIR; writes only SITE_ROOT and DATA_DIR) and runs one pass of every route, plus cli.mjs.
// Any read outside those folders (a baked absolute path, ../src, ../public) shows up as ERR_ACCESS_DENIED.
//   npm run build && node test/ops/clean-install.mjs        (KEEP=1 keeps the copy; OPS_TMP picks the folder)
import { execFileSync } from 'node:child_process';
import { cp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PANEL, SECRET, tempDirs, removeDirs, addUser, start, client, flashOf, bigZip, MB } from './harness.mjs';
import { makeZip } from '../helpers.mjs';

const dirs = await tempDirs();
const app = join(dirs.root, 'app', 'panel');
const skip = new Set(['node_modules', '.astro']);
await cp(PANEL, app, { recursive: true, filter: (src) => !src.slice(PANEL.length).split(/[\\/]/).some((p) => skip.has(p)) });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log(execFileSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').at(-1));

const allow = (flag, p) => `--allow-fs-${flag}=${join(p, '*')}`;
const nodeArgs = ['--permission', '--allow-addons', allow('read', app), allow('read', dirs.site), allow('read', dirs.data), allow('write', dirs.site), allow('write', dirs.data)];
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message.split('\n')[0]}`]); } };
let srv;
try {
  // cli.mjs from the copy, under the same restrictions
  const cliOut = execFileSync(process.execPath, ['--permission', allow('read', app), allow('read', dirs.data), allow('write', dirs.data), 'cli.mjs', 'add-user', 'cli@example.com', 'Cli'], { cwd: app, env: { ...process.env, DATA_DIR: dirs.data }, encoding: 'utf8' });
  await check('cli.mjs add-user works from the deployed folder', async () => assert.match(cliOut, /TOTP secret: [A-Z2-7]{32}/));
  const secret = await addUser(dirs.data); // replaces users.json with the test user
  await mkdir(join(dirs.site, 'img'), { recursive: true });
  await writeFile(join(dirs.site, 'img', 'team.webp'), await sharp({ create: { width: 1000, height: 750, channels: 3, background: '#335577' } }).webp().toBuffer());
  srv = await start({ cwd: app, nodeArgs, env: { PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com', COOKIE_SECURE: '0' } });
  const c = client(srv, secret);
  const png = (w, h, bg) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
  const upload = async (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); f.append('file', new Blob([file.data]), file.name); const r = await c.call(file.path, { method: 'POST', body: f }); return { r, n: flashOf(r.headers.getSetCookie()) }; };
  const urlencoded = (path, fields) => { const b = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x); return c.call(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b }); };

  let loginHtml = '';
  await check('GET /login', async () => { const r = await c.call('/login'); loginHtml = await r.text(); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy')); });
  await check('static assets (theme-init, CSS, JS, fonts, logo)', async () => {
    const urls = ['/theme-init.js', ...[...loginHtml.matchAll(/(?:href|src)="(\/_astro\/[^"]+)"/g)].map((m) => m[1])];
    for (const u of new Set(urls)) assert.equal((await fetch(srv.base + u)).status, 200, u);
  });
  await check('POST /login', async () => assert.equal((await c.login()).status, 303));
  let t;
  await check('GET / (content page)', async () => { const r = await c.call('/'); const h = await r.text(); assert.equal(r.status, 200); t = h.match(/name="_csrf" value="([^"]+)"/)[1]; });
  await check('replace an image (sharp re-encodes it to WebP)', async () => {
    const { n } = await upload({ _csrf: t, slot: 'team' }, { path: '/upload/slot', name: 'team.png', data: await png(1200, 900, '#aa3311') });
    assert.equal(n?.key, 'ok_image');
    assert.equal((await sharp(join(dirs.site, 'img', 'team.webp')).metadata()).format, 'webp');
  });
  await check('publish two library versions and roll back', async () => {
    for (const v of ['11', '12']) assert.equal((await upload({ _csrf: t, version: v, dataDate: '2026-11-06' }, { path: '/upload/libraries', name: 'lib.zip', data: makeZip([{ name: `lib/v${v}.stl`, data: Buffer.from('solid x') }]) })).n?.key, 'ok_publish');
    const r = await urlencoded('/libraries/activate', { _csrf: t, file: 'exocad-implant-libraries-v11-2026-11-06.zip' });
    assert.equal(flashOf(r.headers.getSetCookie())?.key, 'ok_activate');
  });
  await check('streamed 60 MB library upload', async () => {
    const r = await c.upload('/upload/libraries', { _csrf: t, version: '13', dataDate: '2026-11-06' }, { name: 'file', filename: 'big.zip', ...bigZip(60 * MB) });
    assert.equal(flashOf(r.setCookies)?.key, 'ok_publish');
  });
  await check('restore a previous copy', async () => {
    const backup = (await import('node:fs/promises')).readdir(join(dirs.data, 'backups', 'team'));
    const r = await urlencoded('/restore', { _csrf: t, slot: 'team', file: (await backup)[0] });
    assert.equal(flashOf(r.headers.getSetCookie())?.key, 'ok_restore');
  });
  await check('GET /history', async () => assert.equal((await c.call('/history?tipo=todo')).status, 200));
  await check('GET unknown page -> branded 404', async () => assert.equal((await c.call('/no-such-page')).status, 404));
  await check('POST /logout', async () => { const t2 = await c.csrf(); assert.equal((await urlencoded('/logout', { _csrf: t2 })).status, 303); });
} finally {
  await srv?.stop();
  const denied = [...new Set((srv?.log() ?? '').split('\n').filter((l) => /ERR_ACCESS_DENIED|resource: /.test(l)).map((l) => l.trim()))];
  results.push([denied.length ? 'FAIL' : 'ok', `no access outside the deployed folder, SITE_ROOT and DATA_DIR${denied.length ? `:\n    ${denied.slice(0, 10).join('\n    ')}` : ''}`]);
  for (const [s, n] of results) console.log(`${s.padEnd(4)} ${n}`);
  if (process.env.KEEP) console.log('kept:', dirs.root); else await removeDirs(dirs);
  if (results.some(([s]) => s === 'FAIL')) { console.log(srv?.log().split('\n').slice(-30).join('\n')); process.exitCode = 1; }
}
