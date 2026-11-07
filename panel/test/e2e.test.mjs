// End-to-end: the built Astro server (dist/server/entry.mjs, from `npm test` = astro build + node --test) with a temporary
// SITE_ROOT and DATA_DIR and one test user. Every request goes through the real middleware, pages and endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hashPassword, totp, verify, newTotpSecret } from '../lib/auth.mjs';
import { sniff } from '../lib/files.mjs';
import { makeZip, png, SECRET, enc, until, mp4, lib, notice, multipart, ZIP_ENGLISH, ENGLISH } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PASS = 'a-long-test-password';
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

let child, base, dirs, totpSecret, log = '';
before(async () => {
  dirs = { site: await mkdtemp(join(tmpdir(), 'site-')), data: await mkdtemp(join(tmpdir(), 'data-')) };
  totpSecret = newTotpSecret();
  await writeFile(join(dirs.data, 'users.json'), JSON.stringify([{ email: 'adela@example.com', name: 'Adela', hash: await hashPassword(PASS), totp: totpSecret, tokenVersion: 0 }]));
  await mkdir(join(dirs.site, 'img'), { recursive: true });
  await writeFile(join(dirs.site, 'img', 'portal-laptop.webp'), await sharp({ create: { width: 900, height: 600, channels: 3, background: '#123456' } }).webp().toBuffer());
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_SECRET: SECRET, SITE_ROOT: dirs.site, DATA_DIR: dirs.data, SITE_URL: 'https://expertsddt.com', COOKIE_SECURE: '0' },
  });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  await until(async () => { try { return (await fetch(`${base}/login`)).status === 200; } catch { return false; } }, 20_000).catch((e) => { throw new Error(`server did not start: ${e.message}\n${log}`); });
});
after(async () => {
  if (process.env.E2E_LOG) console.log(log);
  child?.kill();
  if (child && child.exitCode === null) await new Promise((r) => child.once('exit', r));
  await rm(dirs.site, { recursive: true, force: true }); await rm(dirs.data, { recursive: true, force: true });
});

// ---------- helpers ----------
const jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const call = async (path, opt = {}) => {
  const r = await fetch(base + path, { redirect: 'manual', ...opt, headers: { ...(opt.headers || {}), Cookie: cookieHeader() } });
  for (const c of r.headers.getSetCookie()) { const [kv, ...attrs] = c.split('; '); const i = kv.indexOf('='); if (/Max-Age=0/i.test(attrs.join(';'))) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return r;
};
const login = (over = {}) => call('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: 'adela@example.com', password: PASS, code: totp(totpSecret), ...over }) });
const csrf = async () => (await (await call('/')).text()).match(/name="_csrf" value="([^"]+)"/)[1];
const flash = async () => { const r = await call('/'); const h = await r.text(); return h.match(/data-flash="(ok|err|warn|info)"/)?.slice(1) ?? null; };
const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v instanceof Blob ? v : String(v), ...(v instanceof Blob ? [v.name || 'upload.bin'] : [])); return f; };
const post = (path, fields) => { const b = new URLSearchParams(); for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) b.append(k, x); return call(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b }); };
const card = (html, id) => { const i = html.indexOf(`id="slot-${id}"`); assert.ok(i > 0, `card ${id}`); return html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)[1];
/** The strict CSP sent as a header, and nothing in the HTML that it would have to allow inline (DESIGN §9.9). */
function assertHardened(r, html, where) {
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, `${where}: CSP header`);
  for (const part of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(part), `${where}: ${part}`);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, where);
  assert.deepEqual([r.headers.get('x-frame-options'), r.headers.get('cache-control'), r.headers.get('referrer-policy'), r.headers.get('x-content-type-options')], ['DENY', 'no-store', 'same-origin', 'nosniff'], where);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', where);
  if (html === undefined) return;
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${where}: inline <script>`);
  assert.doesNotMatch(html, /<style/i, `${where}: <style>`);
  assert.doesNotMatch(html, /\sstyle=/i, `${where}: style=`);
  assert.doesNotMatch(html, /\son[a-z]+=/i, `${where}: on*= handler`);
  assert.doesNotMatch(html, /[→↗↓ⓘ✓▾]/, `${where}: text glyph instead of an SVG icon`);
  for (const src of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) assert.match(src[1], /^\/(_astro\/|theme-init\.js$)/, `${where}: script from ${src[1]}`);
}

// ---------- security, login, session (the old suite, now through Astro) ----------
test('every response carries hardened headers: CSP header with script-src self and no unsafe-inline, nothing inline in the HTML', async () => {
  const r = await call('/login'); const h = await r.text();
  assert.equal(r.status, 200);
  assertHardened(r, h, '/login');
  assert.equal(r.headers.get('strict-transport-security'), null); // COOKIE_SECURE=0 in tests; on by default
  assert.match(h, /<script src="\/theme-init\.js"><\/script>/); // the only is:inline script, external
  assert.match(h, /<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/); // the one client bundle
  assert.match(h, /<link rel="stylesheet" href="\/_astro\/[^"]+\.css">/);
  const js = await fetch(base + '/theme-init.js'); assert.equal(js.status, 200); assert.match(await js.text(), /localStorage/);
});

test('anonymous users are sent to the login page', async () => {
  const r = await call('/'); assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/login');
  assertHardened(r, undefined, 'redirect');
  assert.equal((await call('/history')).headers.get('location'), '/login');
});

test('login needs the right password AND the current 6-digit code (plain form posts, no JS)', async () => {
  assert.equal((await login({ code: '000000' })).status, 401);
  assert.equal((await login({ password: 'wrong-wrong-wrong' })).status, 401);
  assert.equal((await login({ email: 'nobody@example.com' })).status, 401);
  const ok = await login(); assert.equal(ok.status, 303); assert.equal(ok.headers.get('location'), '/'); assert.ok(jar.edp_sid);
  assert.match(ok.headers.getSetCookie().find((c) => c.startsWith('edp_sid=')), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800/);
  const home = await call('/'); assert.equal(home.status, 200);
  assertHardened(home, await home.text(), '/');
  assert.equal((await call('/login')).headers.get('location'), '/'); // already in
});

test('uploads without the CSRF token are refused and change nothing', async () => {
  const before = await readFile(join(dirs.site, 'img', 'portal-laptop.webp'));
  const r = await call('/upload/slot', { method: 'POST', body: form({ slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.equal(r.status, 403);
  assert.deepEqual(await readFile(join(dirs.site, 'img', 'portal-laptop.webp')), before);
  const forged = await call('/upload/slot', { method: 'POST', body: form({ _csrf: 'forged', slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.equal(forged.status, 403);
  const page = await forged.text();
  assert.match(page, /No pudimos confirmar la acción/); assertHardened(forged, page, '403 page');
  assert.deepEqual(await readFile(join(dirs.site, 'img', 'portal-laptop.webp')), before);
  for (const path of ['/restore', '/libraries/activate', '/logout']) assert.equal((await post(path, { _csrf: 'forged', slot: 'team', file: 'x' })).status, 403, path);
});

test('browsers send their own origin on form posts: it must be accepted, while null and foreign origins are not', async () => {
  const f = (origin) => call('/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.c&password=x&code=000000' });
  assert.notEqual((await f(base)).status, 403); // reaches the credential check (401), not the origin check
  assert.equal((await f('null')).status, 403);
  const foreign = await f('https://evil.example'); assert.equal(foreign.status, 403);
  assertHardened(foreign, await foreign.text(), 'origin 403');
  assert.equal((await call('/login')).headers.get('referrer-policy'), 'same-origin');
});

test('a foreign Origin is rejected', async () => {
  const r = await call('/logout', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: '_csrf=x' });
  assert.equal(r.status, 403);
  const t = await csrf(); // a foreign origin is refused even with a valid token and session
  const x = await call('/upload/slot', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(900, 600)]) }) });
  assert.equal(x.status, 403); assert.ok(jar.edp_sid);
});

// ---------- replacing files ----------
test('replacing an image converts it to the slot type, keeps a backup and logs it; the page shows the result inside that card', async () => {
  const t = await csrf();
  const r = await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(1000, 700)]) }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#slot-hero-laptop');
  const p = join(dirs.site, 'img', 'portal-laptop.webp');
  assert.equal((await sniff(p)).type, 'webp');
  assert.equal((await sharp(await readFile(p)).metadata()).width, 1000);
  assert.equal((await readdir(join(dirs.data, 'backups', 'hero-laptop'))).length, 1);
  assert.match(await readFile(join(dirs.data, 'audit.jsonl'), 'utf8'), /"action":"replace".*portal-laptop/);
  const page = await call('/'), html = await page.text();
  assert.match(html, /data-flash="ok"/);
  assert.equal(titleOf(html), 'Listo: la foto nueva ya está en la web. · Contenido · Panel Experts DDT');
  const c = card(html, 'hero-laptop');
  assert.match(c, /data-flash="ok"[^>]*id="resultado"[^>]*tabindex="-1"[^>]*autofocus/); // focus lands on the notice after the redirect
  assert.match(c, /Recién actualizado/); assert.match(c, /class="card slot slot--image is-fresh is-flash"/);
  assert.match(c, /<form method="post" action="\/restore"[^>]*data-confirm[\s\S]*name="_csrf"[\s\S]*name="slot" value="hero-laptop"[\s\S]*Deshacer/);
  assert.match(c, /src="https:\/\/expertsddt\.com\/img\/portal-laptop\.webp\?v=\d+"/);
  assert.equal((html.match(/data-flash=/g) ?? []).length, 1); // one notice, in its card
  assert.equal(await flash(), null); // shown once
});

test('fake images, tiny images and unknown slots are refused; an error opens only that card, with the reason under its drop zone', async () => {
  const t = await csrf(); const p = join(dirs.site, 'img', 'portal-laptop.webp'); const keep = await readFile(p);
  for (const [fields, why] of [
    [{ _csrf: t, slot: 'hero-laptop', file: new Blob(['<?php system($_GET[0]); ?>']) }, 'php disguised as image'],
    [{ _csrf: t, slot: '../../etc/passwd', file: new Blob([await png(900, 600)]) }, 'unknown slot'],
    [{ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(100, 80)]) }, 'too small'],
  ]) {
    const r = await call('/upload/slot', { method: 'POST', body: form(fields) }); assert.equal(r.status, 303, why);
    assert.deepEqual(await readFile(p), keep, why);
    if (why === 'too small') break; // look at the page for this one
    assert.equal((await flash())?.[0], 'err', why);
  }
  const html = await (await call('/')).text();
  assert.equal(titleOf(html), 'Error: No se pudo cambiar la foto · Contenido · Panel Experts DDT');
  assert.equal((html.match(/<details class="slot__more" open/g) ?? []).length, 1);
  const c = card(html, 'hero-laptop');
  assert.match(c, /<details class="slot__more" open/); assert.match(c, /data-flash="err"/);
  assert.match(c, /class="drop is-invalid"/); assert.match(c, /aria-invalid="true"/);
  assert.match(c, /La foto mide 100 px de ancho y aquí se necesitan al menos 800 px\. Nada cambió en la web\./);
});

test('video slots accept only real MP4 files', async () => {
  const t = await csrf();
  await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'v-clinic-scan', file: new Blob([mp4()]) }) });
  assert.equal((await sniff(join(dirs.site, 'video', 'clinic-scan.mp4'))).type, 'mp4');
  await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'v-scan-ui', file: new Blob(['not a video']) }) });
  await assert.rejects(stat(join(dirs.site, 'video', 'scan-ui.mp4')));
  await flash();
});

test('the services PDF is replaced by a plain form post, and refused when it is not a PDF', async () => {
  const t = await csrf(), dest = join(dirs.site, 'downloads', 'services-and-fees-experts-ddt.pdf');
  const r = await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'guide-pdf', file: new Blob(['%PDF-1.7\n% v1']) }) });
  assert.deepEqual([r.status, r.headers.get('location'), notice(r.headers.getSetCookie()).key], [303, '/#slot-guide-pdf', 'ok_pdf']);
  assert.equal(await readFile(dest, 'utf8'), '%PDF-1.7\n% v1');
  const html = await (await call('/')).text(), c = card(html, 'guide-pdf');
  assert.match(c, /data-flash="ok"/); assert.match(c, /Listo:<\/b> la guía nueva ya está en la web\./);
  assert.match(c, /Ojo:<\/b> junto al botón, la web dice/); // the fixed note about the hand-written date on the site
  const bad = await call('/upload/slot', { method: 'POST', body: form({ _csrf: t, slot: 'guide-pdf', file: new Blob(['GIF89a']) }) });
  assert.equal(notice(bad.headers.getSetCookie()).key, 'pdf');
  assert.equal(await readFile(dest, 'utf8'), '%PDF-1.7\n% v1');
  await flash();
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
  // the last error keeps what was typed (WCAG 3.3.7) and its notice sits at the top of 01
  const html = await (await call('/')).text();
  assert.match(html, /name="version"[^>]*value="..\/1"/);
  assert.ok(html.indexOf('data-flash="err"') > html.indexOf('id="librerias"') && html.indexOf('data-flash="err"') < html.indexOf('class="libs"'));
  // roll back to v10
  const back = await post('/libraries/activate', { _csrf: t, file: 'exocad-implant-libraries-v10-2026-11-06.zip' });
  assert.deepEqual([back.status, back.headers.get('location')], [303, '/#librerias']);
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v10');
  const after = await (await call('/')).text();
  assert.match(after, /<li class="ver is-active">\s*<b class="ver__v">v10<\/b>[\s\S]*?Activa/);
  assert.match(after, /<form method="post" action="\/libraries\/activate"[^>]*data-confirm-title="¿Volver a la versión v11\?"[\s\S]*?Activar la v11/);
  assert.match(after, /Así la ven los doctores: «Versión v10 · actualizada el 6 de noviembre de 2026 · 0 MB»/);
});

test('with X-Panel-Xhr the upload routes answer 200 {to} plus the notice cookie, instead of a 303 (image, video, PDF, library)', async () => {
  const t = await csrf(), xhr = { 'X-Panel-Xhr': '1' };
  const ok = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob([await png(1000, 700)]) }) });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { to: '/#slot-hero-laptop' });
  assert.ok(ok.headers.getSetCookie().some((c) => c.startsWith('edp_flash=')));
  const n = notice(ok.headers.getSetCookie());
  assert.equal(n.key, 'ok_image'); assert.equal(n.slot, 'hero-laptop'); assert.equal(n.undo.action, '/restore'); assert.equal(n.undo.label, 'Deshacer');
  const bad = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'hero-laptop', file: new Blob(['not an image']) }) });
  assert.equal(bad.status, 200); assert.deepEqual(await bad.json(), { to: '/#slot-hero-laptop' }); assert.equal(notice(bad.headers.getSetCookie()).key, 'img_type');
  const video = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'v-smile-preview', file: new Blob([mp4()]) }) });
  assert.equal(video.status, 200); assert.deepEqual(await video.json(), { to: '/#slot-v-smile-preview' }); assert.equal(notice(video.headers.getSetCookie()).key, 'ok_video');
  assert.deepEqual(await readFile(join(dirs.site, 'video', 'smile-preview.mp4')), mp4());
  const pdf = await call('/upload/slot', { method: 'POST', headers: xhr, body: form({ _csrf: t, slot: 'guide-pdf', file: new Blob(['%PDF-1.7\n% v2']) }) });
  assert.equal(pdf.status, 200); assert.deepEqual(await pdf.json(), { to: '/#slot-guide-pdf' });
  const pn = notice(pdf.headers.getSetCookie()); assert.equal(pn.key, 'ok_pdf'); assert.equal(pn.undo.fields.file.length, 1);
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
  const shownExpired = await (await fetch(base + '/login', { headers: { Cookie: page.headers.getSetCookie().find((c) => c.startsWith('edp_flash=')).split(';')[0] } })).text();
  assert.match(shownExpired, /data-flash="info"[\s\S]*?Tu sesión terminó\.[\s\S]*?Por seguridad, las sesiones duran 8 horas\. Vuelve a entrar\./);
  assert.equal(titleOf(shownExpired), 'Tu sesión terminó. · Iniciar sesión · Panel Experts DDT');
  const up = await fetch(base + '/upload/slot', { method: 'POST', redirect: 'manual', headers: { ...stale, 'X-Panel-Xhr': '1' }, body: form({ slot: 'team', file: new Blob(['x']) }) });
  assert.equal(up.status, 401); assert.deepEqual(await up.json(), { to: '/login' });
  const cookie = up.headers.getSetCookie().find((c) => c.startsWith('edp_flash=')).split(';')[0];
  assert.equal(verify(cookie.slice(10), SECRET).key, 'expired_upload');
  const shown = await fetch(base + '/login', { headers: { Cookie: cookie } });
  assert.match(await shown.text(), /data-flash="info"[\s\S]*?Tu sesión terminó mientras subías el archivo\./);
  assert.ok(shown.headers.getSetCookie().some((c) => /^edp_flash=;.*Max-Age=0/.test(c))); // shown once
  const none = await fetch(base + '/', { redirect: 'manual' }); // never logged in: no notice
  assert.equal(notice(none.headers.getSetCookie()), null);
});

test('a failed login is shown again with the email kept, the reason, and the focus on the password', async () => {
  const r = await login({ code: '000000' }); const h = await r.text();
  assert.equal(r.status, 401); assert.match(h, /value="adela@example\.com"/);
  assert.match(h, /data-flash="err"[\s\S]*?Credenciales inválidas\./);
  assert.equal(titleOf(h), 'Error: Credenciales inválidas. · Iniciar sesión · Panel Experts DDT');
  assert.match(h, /<input[^>]*type="password"[^>]*autofocus[^>]*aria-describedby="password-e login-alert"/);
  assert.doesNotMatch(h, /maxlength/); assert.match(h, /autocomplete="one-time-code"/);
  assertHardened(r, h, 'login 401');
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
  assert.equal((await call('/')).status, 200); // the server is fine afterwards
});

test('the image for social networks is always saved at 1200×630', async () => {
  const r = await call('/upload/slot', { method: 'POST', body: form({ _csrf: await csrf(), slot: 'og', file: new Blob([await png(1300, 1300)]) }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#slot-og');
  const m = await sharp(await readFile(join(dirs.site, 'og.jpg'))).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1200, 630]);
  await flash();
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
  const html = await (await call('/')).text(), c = card(html, 'v-scan-ui');
  assert.match(c, /<video src="https:\/\/expertsddt\.com\/video\/scan-ui\.mp4\?v=\d+"[^>]*controls[^>]*preload="none"[^>]*muted/);
  assert.match(c, /name="poster"/); assert.match(c, /Portada <span class="opt">\(opcional\)<\/span>/);
});

test('restore swaps in a listed copy, keeps the current file as a new copy, logs it and can be undone; nothing else is accepted', async () => {
  const t = await csrf(), dir = join(dirs.data, 'backups', 'hero-laptop'), live = join(dirs.site, 'img', 'portal-laptop.webp');
  const before = await readdir(dir), oldest = before.slice().sort()[0], current = await readFile(live);
  const page = await (await call('/')).text();
  assert.match(card(page, 'hero-laptop'), /Versiones anteriores \(\d\)[\s\S]*?Estuvo en la web hasta el[\s\S]*?Volver a esta/);
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
    assert.match(page, /name="version"[^>]*value="90"/); assert.match(page, /name="dataDate"[^>]*value="2026-11-01"/);
    assert.match(page, /Vuelve a elegir el archivo \.zip\./); // §7.4: a file was chosen and refused, and the page comes back without it
  }
});

test('the first publish without versions.json keeps the active version listed; a much smaller zip is flagged and undone in one click', async () => {
  const t = await csrf(), dir = join(dirs.site, 'downloads', 'libraries');
  await rm(join(dir, 'versions.json')); // today's hosting: latest.json (v10 here) and no versions.json
  const seeded = await (await call('/')).text();
  assert.match(seeded, /<li class="ver is-active">\s*<b class="ver__v">v10<\/b>/); assert.doesNotMatch(seeded, /ver__v">v11/);
  const r = await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: 'v12', dataDate: '2026-11-07', file: lib(5) }) });
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/#librerias'); assert.equal(notice(r.headers.getSetCookie()).key, 'ok_publish');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'versions.json'), 'utf8')).map((v) => v.version), ['v10', 'v12']);
  const html = await (await call('/')).text();
  assert.match(html, /v10/);
  assert.match(html, /Listo:<\/b> la versión v12 ya está en la web\.[\s\S]*?Ver página pública[\s\S]*?Volver a la v10/);
  assert.match(html, /class="vcard on-navy is-fresh"[\s\S]*?Publicada hace un momento/);
  const publishLine = JSON.parse((await readFile(join(dirs.data, 'audit.jsonl'), 'utf8')).trim().split('\n').at(-1));
  assert.match(publishLine.detail, /^v12 · 5 archivos · \d+ KB$/); assert.equal(publishLine.version, 'v12'); assert.equal(publishLine.files, 5);
  const small = await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '13', dataDate: '2026-11-07', file: lib(2) }) });
  const n = notice(small.headers.getSetCookie());
  assert.equal(n.key, 'warn_publish'); assert.equal(n.type, 'warn'); assert.equal(n.title, 'Publicada, pero revísala: la v13 tiene 2 archivos y la v12 tenía 5.');
  assert.deepEqual(n.undo, { action: '/libraries/activate', fields: { file: 'exocad-implant-libraries-v12-2026-11-07.zip' }, label: 'Volver a la v12' });
  assert.match(await (await call('/')).text(), /data-flash="warn"[\s\S]*?Publicada, pero revísala:<\/b> la v13 tiene 2 archivos/);
  const back = await post(n.undo.action, { _csrf: t, ...n.undo.fields });
  assert.equal(back.headers.get('location'), '/#librerias');
  assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).version, 'v12');
  const ok = notice(back.headers.getSetCookie());
  assert.deepEqual([ok.key, ok.title, ok.text, ok.undo.label], ['ok_activate', 'Listo: la versión v12 vuelve a estar en la web.', 'La v13 sigue guardada.', 'Volver a la v13']);
  const dup = notice((await call('/upload/libraries', { method: 'POST', body: form({ _csrf: t, version: '12', dataDate: '2026-11-07', file: lib(5) }) })).headers.getSetCookie());
  assert.equal(dup.text, 'La versión v12 ya existe. Usa un número nuevo, por ejemplo 14. Nada cambió en la web.');
  await flash();
});

// ---------- pages ----------
test('the history page reads as sentences, filtered on the server, with the IP only for failed attempts', async () => {
  const r = await call('/history'); const h = await r.text();
  assert.equal(r.status, 200); assertHardened(r, h, '/history');
  assert.equal(titleOf(h), 'Historial · Panel Experts DDT');
  assert.match(h, /<a href="\/history" aria-current="page">Historial<\/a>/);
  assert.match(h, /<a href="\/history\?tipo=cambios" aria-current="page">Cambios en la web<\/a>/);
  assert.match(h, /Hoy · /); assert.match(h, /<b>Adela<\/b> cambió la foto «Laptop del Doctor Portal»/);
  assert.match(h, /<b>Adela<\/b> volvió a una versión anterior de «Laptop del Doctor Portal»/);
  assert.match(h, /<b>Adela<\/b> publicó la versión v12 de las librerías/);
  assert.doesNotMatch(h, /IP \d/); assert.doesNotMatch(h, /entró al panel/);
  const a = await (await call('/history?tipo=accesos')).text();
  assertHardened(r, a, '/history?tipo=accesos');
  assert.match(a, /<a href="\/history\?tipo=accesos" aria-current="page">Accesos<\/a>/);
  assert.match(a, /<li class="is-warn">[\s\S]*?Intento de acceso fallido con nobody@example\.com[\s\S]*?IP 127\.0\.0\.1/);
  assert.match(a, /<b>Adela<\/b> entró al panel/); assert.doesNotMatch(a, /cambió la foto/);
  assert.match(await (await call('/history?tipo=todo')).text(), /cambió la foto[\s\S]*entró al panel|entró al panel[\s\S]*cambió la foto/);
  assert.match(await (await call('/history?tipo=<script>')).text(), /tipo=cambios" aria-current="page"/); // unknown filter = cambios
  assert.match(h, /Se muestran los últimos 200 eventos\./);
});

test('the content page: band, sections 01–04 in order, every card, «Bueno saber», and nothing inline', async () => {
  const r = await call('/'); const h = await r.text();
  assertHardened(r, h, '/');
  assert.match(h, /<html lang="es">/); assert.equal((h.match(/<h1/g) ?? []).length, 1);
  assert.match(h, /Hola, <span class="accent">Adela<\/span>\./);
  const order = ['id="librerias"', 'id="documentos"', 'id="imagenes"', 'id="videos"', 'id="bueno-saber"'].map((s) => h.indexOf(s));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'section order');
  assert.equal((h.match(/<article class="card slot /g) ?? []).length, 22);
  assert.match(h, /<a class="skip" href="#main">Saltar al contenido<\/a>/); assert.match(h, /<main id="main" tabindex="-1">/);
  assert.match(h, /aria-label="Secciones del panel"/); assert.match(h, /<aside class="glass glance" aria-label="Resumen">/);
  assert.match(h, /<b class="is-warn">\d+ faltan<\/b>/); // most images are missing in this temp site
  assert.match(h, /Archivos en la web<\/dt><dd>[\s\S]*?\d+ de 22 · faltan \d+/);
  const team = card(h, 'team');
  assert.match(team, /is-missing/); assert.match(team, /Falta en la web/); assert.match(team, /Subir foto/); assert.match(team, /btn--primary/);
  assert.match(team, /Al publicar, esta foto aparecerá en Inicio \(pilar «Soporte y contacto»\) y en Servicios \(«Visitas de consultoría y soporte»\)\./);
  assert.match(team, /<form method="post" action="\/upload\/slot" enctype="multipart\/form-data" data-upload[^>]*>\s*<input type="hidden" name="_csrf"/); // the token is the first field
  assert.match(team, /accept="image\/png,image\/jpeg,image\/webp" required/);
  assert.match(card(h, 'scanner-front'), /stage--navy/); assert.match(card(h, 'og'), /r-og/);
  assert.match(h, /Las fotos y precios de los productos de la tienda \(shop\.expertsddt\.com\) se cambian en Shopify\./);
  assert.match(h, /Solo \.zip · hasta 300 MB/); // LIB_MAX_MB, not hard-coded
  assert.match(h, /<form method="post" action="\/logout"><input type="hidden" name="_csrf"/);
  assert.doesNotMatch(h, /<details[^>]*\sname=/); // never an exclusive accordion
});

test('unknown pages get the branded 404 and an internal error the branded 500, both with the hardened headers', async () => {
  const r = await call('/no-such-page'); const h = await r.text();
  assert.equal(r.status, 404); assertHardened(r, h, '404');
  assert.match(h, /Error 404/); assert.match(h, /Esta página no existe/); assert.match(h, /href="\/"[^>]*>Volver al panel/);
  const anon = await fetch(base + '/no-such-page', { redirect: 'manual' }); // without a session nothing is revealed
  assert.deepEqual([anon.status, anon.headers.get('location')], [303, '/login']);
  const usersFile = join(dirs.data, 'users.json'), saved = await readFile(usersFile);
  await writeFile(usersFile, '{}'); // a broken users.json makes the session lookup throw
  try {
    const e = await call('/'); const eh = await e.text();
    assert.equal(e.status, 500); assertHardened(e, eh, '500');
    assert.match(eh, /Error 500/); assert.match(eh, /Algo salió mal de nuestro lado/); assert.match(eh, /revisa en el panel si el cambio se aplicó/);
  } finally { await writeFile(usersFile, saved); }
  assert.equal((await call('/')).status, 200);
});

test('logout ends the session with its notice; repeated failed logins lock the account', async () => {
  const t = await csrf();
  const out = await call('/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: t }) });
  assert.deepEqual([out.status, out.headers.get('location')], [303, '/login']);
  assert.match(await (await call('/login')).text(), /data-flash="info"[\s\S]*?Cerraste sesión\.[\s\S]*?¡Hasta pronto!/);
  assert.equal((await call('/')).status, 303);
  let last; for (let i = 0; i < 9; i++) last = await login({ code: '000000' });
  assert.equal(last.status, 429);
  const h = await last.text();
  assert.match(h, /data-flash="warn"[^>]*id="login-alert"[^>]*tabindex="-1"[^>]*autofocus[\s\S]*?Acceso pausado por seguridad\./);
  assert.equal((await login()).status, 429); // even the right credentials wait out the lock
});
