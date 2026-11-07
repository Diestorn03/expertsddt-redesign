// Content panel: login (password + TOTP), replace site images/videos/PDF, publish versioned library zips. No client-side JS.
import http from 'node:http';
import { readFile, writeFile, appendFile, mkdir, stat, readdir, unlink, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, extname } from 'node:path';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';
import { verifyPassword, verifyTotp, sign, verify, csrfFor, createThrottle } from './lib/auth.mjs';
import { sniff, imageSize, inspectZip, sha256File, safeJoin, placeFile } from './lib/files.mjs';
import { loginPage, dashboard, historyPage } from './lib/ui.mjs';

let sharp = null;
try { sharp = (await import('sharp')).default; sharp.cache(false); } catch { /* optional: without it only files already in the right format are accepted */ }

const MB = 1024 * 1024;
const eq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function createApp(cfg) {
  const { secret, siteRoot, dataDir, siteUrl } = cfg;
  if (!secret || secret.length < 32) throw new Error('PANEL_SECRET must be at least 32 characters');
  const slotsFile = JSON.parse(await readFile(cfg.slotsPath ?? new URL('./slots.json', import.meta.url), 'utf8'));
  const slots = [
    ...slotsFile.images.map((s) => ({ ...s, kind: 'image' })),
    ...slotsFile.videos.map((s) => ({ ...s, kind: 'video' })),
    ...slotsFile.documents.map((s) => ({ ...s, kind: 'document' })),
  ];
  const now = cfg.now ?? (() => Date.now());
  const sessionMs = 8 * 3600_000;
  const byEmail = createThrottle({ max: 8, now }), byIp = createThrottle({ max: 20, now });
  await mkdir(join(dataDir, 'tmp'), { recursive: true });
  await mkdir(join(dataDir, 'backups'), { recursive: true });

  const audit = (user, action, detail = '', ip = '') => appendFile(join(dataDir, 'audit.jsonl'), JSON.stringify({ ts: new Date(now()).toISOString(), user, action, detail, ip }) + '\n');
  const users = async () => { try { return JSON.parse(await readFile(join(dataDir, 'users.json'), 'utf8')); } catch { return []; } };
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
  const ipOf = (req) => (cfg.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
  const cookie = (name, val, maxAge) => `${name}=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cfg.cookieSecure === false ? '' : '; Secure'}`;

  function headers(res) {
    res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self' ${siteUrl} data:; media-src ${siteUrl}; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (cfg.cookieSecure !== false) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  const send = (res, code, html, extra = {}) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...extra }); res.end(html); };
  const redirect = (res, to, extra = {}) => { res.writeHead(303, { Location: to, ...extra }); res.end(); };
  const flashCookie = (type, text) => cookie('edp_flash', sign({ type, text, exp: now() + 60_000 }, secret), 60);

  async function session(req) {
    const s = verify(cookies(req).edp_sid, secret, now());
    if (!s) return null;
    const u = (await users()).find((x) => x.email === s.uid);
    return u && (u.tokenVersion ?? 0) === s.tv ? { ...s, user: u } : null;
  }

  function readForm(req, limit = 8192) {
    return new Promise((res, rej) => {
      let n = 0; const parts = [];
      req.on('data', (c) => { n += c.length; if (n > limit) { rej(new Error('body too large')); req.destroy(); } else parts.push(c); });
      req.on('end', () => res(Object.fromEntries(new URLSearchParams(Buffer.concat(parts).toString()))));
      req.on('error', rej);
    });
  }

  // ---------- uploads ----------
  function receive(req, { maxFile, maxFiles, names, csrf }) {
    return new Promise((resolve, reject) => {
      const fields = {}, files = {}, pending = []; let csrfOk = false, tooBig = null;
      const bb = Busboy({ headers: req.headers, limits: { files: maxFiles, fields: 10, parts: 20, fileSize: maxFile } });
      bb.on('field', (n, v) => { fields[n] = v; if (n === '_csrf') csrfOk = eq(v, csrf); });
      bb.on('file', (name, stream) => {
        if (!csrfOk || !names.includes(name)) return stream.resume(); // csrf must come first in the form; unknown parts are drained
        const tmp = join(dataDir, 'tmp', randomBytes(12).toString('hex'));
        const ws = createWriteStream(tmp); stream.pipe(ws);
        stream.on('limit', () => { tooBig = name; });
        files[name] = tmp; pending.push(finished(ws));
      });
      bb.on('error', reject);
      bb.on('close', async () => { try { await Promise.all(pending); } catch (e) { return reject(e); } resolve({ fields, files, csrfOk, tooBig }); });
      req.pipe(bb);
    });
  }
  const cleanup = (...paths) => Promise.all(paths.filter(Boolean).map((p) => unlink(p).catch(() => {})));

  /** Validates (and, with sharp, re-encodes) an uploaded image so it matches the slot's file type. Returns {ok, path|reason}. */
  async function prepareImage(tmp, destPath, { minWidth = 0, maxWidth = 2400 }) {
    const want = extname(destPath).slice(1).toLowerCase().replace('jpeg', 'jpg');
    const type = await sniff(tmp);
    if (!['webp', 'png', 'jpg'].includes(type)) return { ok: false, reason: 'El archivo no es una imagen WebP, PNG o JPG válida.' };
    if (!sharp) {
      if (type !== want) return { ok: false, reason: `Este espacio necesita una imagen ${want.toUpperCase()}.` };
      const d = await imageSize(tmp, type);
      if (!d || d.width < minWidth) return { ok: false, reason: `La imagen debe medir al menos ${minWidth} px de ancho.` };
      return { ok: true, path: tmp, ...d };
    }
    try {
      const img = sharp(tmp, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
      const meta = await sharp(tmp, { limitInputPixels: 40_000_000 }).metadata();
      if (meta.width < minWidth) return { ok: false, reason: `La imagen debe medir al menos ${minWidth} px de ancho (la suya mide ${meta.width}).` };
      const out = `${tmp}.out`;
      const pipe = img.resize({ width: maxWidth, withoutEnlargement: true });
      await (want === 'webp' ? pipe.webp({ quality: 82 }) : pipe.jpeg({ quality: 85, mozjpeg: true })).toFile(out);
      await unlink(tmp).catch(() => {});
      return { ok: true, path: out };
    } catch { return { ok: false, reason: 'No se pudo leer la imagen: el archivo está dañado o es demasiado grande.' }; }
  }

  async function handleSlotUpload(req, res, s) {
    const r = await receive(req, { maxFile: 13 * MB, maxFiles: 2, names: ['file', 'poster'], csrf: csrfFor(s, secret) });
    const tmps = Object.values(r.files);
    try {
      if (!r.csrfOk) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'La sesión caducó. Vuelve a intentarlo.') });
      const slot = slots.find((x) => x.id === r.fields.slot);
      if (!slot || !r.files.file) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'Falta el archivo o el espacio no existe.') });
      if (r.tooBig) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'El archivo es demasiado grande.') });
      let placed = r.files.file, poster = null;
      const dest = safeJoin(siteRoot, slot.path);
      if (slot.kind === 'image') {
        const p = await prepareImage(r.files.file, dest, slot);
        if (!p.ok) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', p.reason) });
        placed = p.path; tmps.push(p.path);
      } else if (slot.kind === 'video') {
        if ((await sniff(r.files.file)) !== 'mp4') return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'El archivo no es un video MP4 válido.') });
        if ((await stat(r.files.file)).size > slot.maxBytes) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', `El video supera el límite de ${Math.round(slot.maxBytes / MB)} MB.`) });
        if (r.files.poster) {
          if (!slot.poster) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'Este video no usa imagen de portada.') });
          const pp = await prepareImage(r.files.poster, safeJoin(siteRoot, slot.poster), { minWidth: 320, maxWidth: slotsFile.posterSize.maxWidth });
          if (!pp.ok) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', `Portada: ${pp.reason}`) });
          poster = pp.path; tmps.push(pp.path);
        }
      } else if ((await sniff(r.files.file)) !== 'pdf' || (await stat(r.files.file)).size > slot.maxBytes) {
        return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'Sube un PDF válido de menos de 10 MB.') });
      }
      const backupDir = join(dataDir, 'backups', slot.id);
      await placeFile(placed, dest, backupDir);
      if (poster) await placeFile(poster, safeJoin(siteRoot, slot.poster), backupDir);
      await audit(s.uid, 'replace', `${slot.path}${poster ? ' + portada' : ''}`, ipOf(req));
      return redirect(res, '/', { 'Set-Cookie': flashCookie('ok', `Listo: se actualizó «${slot.label}».`) });
    } finally { await cleanup(...tmps); }
  }

  const libDir = () => safeJoin(siteRoot, 'downloads/libraries');
  const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
  async function writeJsonAtomic(p, obj) { const t = `${p}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(t, JSON.stringify(obj, null, 2) + '\n'); await rename(t, p); }

  async function handleLibraryUpload(req, res, s) {
    const r = await receive(req, { maxFile: 300 * MB, maxFiles: 1, names: ['file'], csrf: csrfFor(s, secret) });
    const tmps = Object.values(r.files);
    const fail = (m) => redirect(res, '/', { 'Set-Cookie': flashCookie('err', m) });
    try {
      if (!r.csrfOk) return fail('La sesión caducó. Vuelve a intentarlo.');
      const version = `v${String(r.fields.version || '').replace(/^v/i, '')}`;
      if (!/^v\d{1,3}$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(r.fields.dataDate || '')) return fail('Revisa la versión (solo números) y la fecha.');
      if (r.tooBig || !r.files.file) return fail('Falta el archivo o supera los 300 MB.');
      if ((await sniff(r.files.file)) !== 'zip') return fail('El archivo no es un .zip válido.');
      const z = await inspectZip(r.files.file);
      if (!z.ok) return fail(`El zip no es seguro o está dañado: ${z.reason}.`);
      const file = `exocad-implant-libraries-${version}-${r.fields.dataDate}.zip`;
      const dir = libDir(); await mkdir(dir, { recursive: true });
      const index = await readJson(join(dir, 'versions.json'), []);
      if (index.some((v) => v.version === version)) return fail(`La versión ${version} ya existe. Usa un número nuevo.`);
      const entry = { version, dataDate: r.fields.dataDate, file, bytes: (await stat(r.files.file)).size, sha256: await sha256File(r.files.file), files: z.entries };
      await placeFile(r.files.file, join(dir, file), join(dataDir, 'backups', 'libraries'));
      index.push(entry); await writeJsonAtomic(join(dir, 'versions.json'), index);
      await writeJsonAtomic(join(dir, 'latest.json'), entry);
      await audit(s.uid, 'library_publish', `${version} (${entry.files} archivos, ${entry.bytes} bytes)`, ipOf(req));
      return redirect(res, '/', { 'Set-Cookie': flashCookie('ok', `Listo: la versión ${version} ya está publicada.`) });
    } finally { await cleanup(...tmps); }
  }

  async function dashboardData() {
    const items = [];
    for (const sl of slots) {
      let st = null; try { st = await stat(safeJoin(siteRoot, sl.path)); } catch { /* not uploaded yet */ }
      items.push({ ...sl, size: st?.size ?? 0, mtime: st ? Math.round(st.mtimeMs) : 0 });
    }
    const dir = libDir();
    return { items, libs: { latest: await readJson(join(dir, 'latest.json'), null), versions: (await readJson(join(dir, 'versions.json'), [])).slice().reverse() } };
  }

  async function handle(req, res) {
    headers(res);
    try {
      const url = new URL(req.url, 'http://panel'); const ip = ipOf(req);
      const post = req.method === 'POST';
      if (post) { // same-origin only (SameSite=Strict cookies + CSRF token are the other two layers)
        const o = req.headers.origin;
        if (o && (() => { try { return new URL(o).host !== req.headers.host; } catch { return true; } })()) return send(res, 403, 'Forbidden');
      }
      const flashIn = (() => { const f = verify(cookies(req).edp_flash, secret, now()); return f ? { type: f.type, text: f.text } : null; })();
      const clearFlash = flashIn ? { 'Set-Cookie': cookie('edp_flash', '', 0) } : {};

      if (req.method === 'GET' && url.pathname === '/login') return send(res, 200, loginPage(flashIn?.text), clearFlash);
      if (post && url.pathname === '/login') {
        const f = await readForm(req); const email = String(f.email || '').toLowerCase().trim();
        if (byEmail.blocked(email) || byIp.blocked(ip)) { await audit(email, 'login_blocked', '', ip); return send(res, 429, loginPage('Demasiados intentos. Espera 15 minutos.')); }
        const u = (await users()).find((x) => x.email === email);
        const pwOk = await verifyPassword(String(f.password || ''), u?.hash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'); // same work when the user does not exist
        const totpOk = u ? verifyTotp(u.totp, f.code) : false;
        if (!u || !pwOk || !totpOk) { byEmail.fail(email); byIp.fail(ip); await audit(email, 'login_failed', '', ip); return send(res, 401, loginPage('Credenciales inválidas.')); }
        byEmail.ok(email);
        const tok = sign({ sid: randomBytes(12).toString('hex'), uid: u.email, tv: u.tokenVersion ?? 0, exp: now() + sessionMs }, secret);
        await audit(u.email, 'login', '', ip);
        return redirect(res, '/', { 'Set-Cookie': cookie('edp_sid', tok, sessionMs / 1000) });
      }

      const s = await session(req);
      if (!s) return redirect(res, '/login');
      const csrf = csrfFor(s, secret);

      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, dashboard({ user: s.uid, csrf, flash: flashIn, siteUrl, ...(await dashboardData()) }), clearFlash);
      if (req.method === 'GET' && url.pathname === '/history') {
        const lines = (await readFile(join(dataDir, 'audit.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).slice(-200).reverse().map((l) => JSON.parse(l));
        return send(res, 200, historyPage({ user: s.uid, csrf, rows: lines }));
      }
      if (post && url.pathname === '/upload/slot') return await handleSlotUpload(req, res, s);
      if (post && url.pathname === '/upload/libraries') return await handleLibraryUpload(req, res, s);
      if (post && url.pathname === '/libraries/activate') {
        const f = await readForm(req); if (!eq(String(f._csrf || ''), csrf)) return send(res, 403, 'Forbidden');
        const dir = libDir(); const entry = (await readJson(join(dir, 'versions.json'), [])).find((v) => v.file === f.file);
        if (!entry) return redirect(res, '/', { 'Set-Cookie': flashCookie('err', 'Esa versión no existe.') });
        await writeJsonAtomic(join(dir, 'latest.json'), entry); await audit(s.uid, 'library_activate', entry.version, ip);
        return redirect(res, '/', { 'Set-Cookie': flashCookie('ok', `La versión ${entry.version} volvió a ser la activa.`) });
      }
      if (post && url.pathname === '/logout') {
        const f = await readForm(req); if (!eq(String(f._csrf || ''), csrf)) return send(res, 403, 'Forbidden');
        await audit(s.uid, 'logout', '', ip); return redirect(res, '/login', { 'Set-Cookie': cookie('edp_sid', '', 0) });
      }
      return send(res, 404, 'No encontrado');
    } catch (e) {
      console.error('panel error:', e?.message);
      if (!res.headersSent) send(res, 500, 'Error interno');
    }
  }
  return { handle, audit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const app = await createApp({
    secret: env.PANEL_SECRET, siteRoot: env.SITE_ROOT, dataDir: env.DATA_DIR, siteUrl: env.SITE_URL || 'https://expertsddt.com',
    cookieSecure: env.COOKIE_SECURE !== '0', trustProxy: env.TRUST_PROXY !== '0',
  });
  http.createServer(app.handle).listen(Number(env.PORT) || 3000, () => console.log('panel listening'));
}
