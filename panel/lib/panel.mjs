// Content panel core, framework-agnostic: config, slots, sessions, uploads, restore, libraries, audit log and the data the pages render.
// Operations take plain inputs (a headers object or Headers, a Web ReadableStream or Node stream body, an AbortSignal, the client ip)
// and return plain results { status, location?, json?, view?, data?, setCookies[] } that the thin Astro endpoints in src/pages send.
import { readFile, writeFile, appendFile, mkdir, stat, readdir, unlink, rename, copyFile, open } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { join, extname, basename, dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { once } from 'node:events';
import Busboy from 'busboy';
import { verifyPassword, verifyTotp, sign, verify, csrfFor, createThrottle } from './auth.mjs';
import { sniff, imageSize, inspectZip, sha256File, safeJoin, placeFile, parseBackup } from './files.mjs';
import * as fmt from './format.mjs';

let sharp = null, sharpError = null;
try { sharp = (await import('sharp')).default; sharp.cache(false); } catch (e) { sharpError = e; /* optional: without it only files already in the right format are accepted */ }

const MB = 1024 * 1024;
const IMG_MAX = 13 * MB; // images and posters; videos and the PDF have smaller limits in slots.json
const SESSION_MS = 8 * 3600_000;
const FRESH_MS = 10 * 60_000;
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'; // same scrypt work when the user does not exist
const FORMAT = { webp: 'WebP', jpg: 'JPG', png: 'PNG', mp4: 'MP4', pdf: 'PDF' };
const CHANGES = ['replace', 'restore', 'library_publish', 'library_activate'];
const ACCESS = ['login', 'logout', 'login_failed', 'login_blocked'];
const FILTERS = { cambios: (a) => CHANGES.includes(a), accesos: (a) => ACCESS.includes(a), todo: () => true };
const ZIP_KEYS = { no_eocd: 'zip_no_eocd', zip64: 'zip_64', too_many: 'zip_many', corrupt: 'zip_corrupt', unsafe_path: 'zip_unsafe', too_big: 'zip_big' };
const OLD_PUBLISH = /^(v\d+) \((\d+) archivos, (\d+) bytes\)$/; // audit lines written before this version

const eq = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && timingSafeEqual(x, y); };
const plain = (h) => (typeof h?.get === 'function' ? Object.fromEntries(h) : h || {}); // Headers or Node's lowercase object
const isXhr = (h) => h['x-panel-xhr'] === '1';
const parseCookies = (s) => Object.fromEntries(String(s || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
const lowerFirst = (s) => s && s[0].toLowerCase() + s.slice(1);
const num = (v) => Number(String(v ?? '').replace(/^v/i, '')) || 0;
const nextFree = (list) => list.reduce((m, v) => Math.max(m, num(v.version)), 0) + 1;
const isDay = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(t) && new Date(t).toISOString().startsWith(d); }; // NaN, never a RangeError
const initials = (name) => {
  const w = String(name || '').split('@')[0].trim().split(/[\s._-]+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toLocaleUpperCase('es');
};
const displayName = (u) => (u?.name && !String(u.name).includes('@') ? String(u.name) : '');

// ---------- §7.13: server messages, key → [type, title, text] ----------
const SEE_IT = 'Si todavía ves la anterior, recarga la página de la web (Ctrl + F5 en la computadora; en el celular, desliza hacia abajo). Algunos navegadores tardan hasta un día.';
export const MESSAGES = {
  csrf: ['err', 'No se pudo completar', 'La página estaba desactualizada (¿entraste en otra pestaña?). Recárgala y vuelve a intentarlo.'],
  no_file: ['err', 'No se pudo cambiar el archivo', 'No llegó ningún archivo. Elígelo y vuelve a intentarlo.'],
  unknown_slot: ['err', 'No se pudo cambiar el archivo', 'Ese archivo ya no está en la lista. Recarga la página.'],
  too_big: ['err', 'No se pudo cambiar el archivo', 'El archivo pesa más de {max} MB.'],
  img_type: ['err', 'No se pudo cambiar la foto', 'El archivo no es una foto PNG, JPG o WebP válida.'],
  img_format: ['err', 'No se pudo cambiar la foto', 'Este espacio solo acepta imágenes {formato}.'],
  img_small: ['err', 'No se pudo cambiar la foto', 'La foto mide {w} px de ancho y aquí se necesitan al menos {min} px.'],
  img_unreadable: ['err', 'No se pudo cambiar la foto', 'No pudimos leer la foto: está dañada o es demasiado grande.'],
  video_type: ['err', 'No se pudo cambiar el video', 'El archivo no es un video MP4 válido.'],
  video_mov: ['err', 'No se pudo cambiar el video', 'Es un MOV del iPhone. Expórtalo como MP4 y vuelve a intentarlo.'],
  video_big: ['err', 'No se pudo cambiar el video', 'El video pesa {x} MB y el máximo es 12 MB.'],
  poster: ['err', 'No se pudo cambiar el video', 'Portada: {motivo}'],
  no_poster: ['err', 'No se pudo cambiar el video', 'Este video no usa imagen de portada.'],
  pdf: ['err', 'No se pudo cambiar la guía', 'Sube un PDF válido de hasta 10 MB.'],
  lib_meta: ['err', 'No se pudo publicar la versión', 'Revisa el número de versión (solo números, por ejemplo 11) y la fecha.'],
  lib_file: ['err', 'No se pudo publicar la versión', 'Falta el archivo o pesa más de {max} MB.'],
  lib_not_zip: ['err', 'No se pudo publicar la versión', 'El archivo no es un .zip.'],
  zip_no_eocd: ['err', 'No se pudo publicar la versión', 'El .zip está incompleto o no es un .zip de verdad. ¿Se cortó la descarga? Vuelve a descargarlo o a comprimirlo.'],
  zip_64: ['err', 'No se pudo publicar la versión', 'El .zip está en un formato especial (ZIP64) que no aceptamos. Comprime la carpeta de nuevo con Windows: clic derecho › Enviar a › Carpeta comprimida (en zip).'],
  zip_many: ['err', 'No se pudo publicar la versión', 'El .zip tiene {n} archivos y el máximo es 5000.'],
  zip_corrupt: ['err', 'No se pudo publicar la versión', 'El .zip está dañado. Vuelve a comprimirlo.'],
  zip_unsafe: ['err', 'No se pudo publicar la versión', 'El .zip contiene rutas de carpeta no permitidas ({ruta}).'],
  zip_big: ['err', 'No se pudo publicar la versión', 'Descomprimido ocuparía más de 1 GB.'],
  lib_dup: ['err', 'No se pudo publicar la versión', 'La versión {v} ya existe. Usa un número nuevo, por ejemplo {n}.'],
  lib_unknown: ['err', 'No se pudo activar la versión', 'Esa versión ya no existe. Recarga la página.'],
  restore_unknown: ['err', 'No se pudo volver a esa versión', 'Esa copia ya no existe. Recarga la página.'],
  ok_image: ['ok', 'Listo: la foto nueva ya está en la web.', SEE_IT],
  ok_video: ['ok', 'Listo: el video nuevo ya está en la web.', SEE_IT],
  ok_pdf: ['ok', 'Listo: la guía nueva ya está en la web.', 'Quien la descargue desde ahora recibe este PDF.'],
  ok_publish: ['ok', 'Listo: la versión {v} ya está en la web.', 'Quien descargue las librerías desde ahora recibe la {v} ({n} archivos).'],
  warn_publish: ['warn', 'Publicada, pero revísala: la {v} tiene {n} archivos y la {anterior} tenía {m}.', '¿Elegiste el .zip correcto? Si no, vuelve a la {anterior} con un clic.'],
  ok_activate: ['ok', 'Listo: la versión {v} vuelve a estar en la web.', 'La {anterior} sigue guardada.'],
  ok_restore: ['ok', 'Listo: volviste a una versión anterior de «{titulo}».', 'La que estaba quedó guardada en «Versiones anteriores».'],
  logout: ['info', 'Cerraste sesión.', '¡Hasta pronto!'],
  expired: ['info', 'Tu sesión terminó.', 'Por seguridad, las sesiones duran 8 horas. Vuelve a entrar.'],
  expired_upload: ['info', 'Tu sesión terminó mientras subías el archivo.', 'Entra de nuevo y vuelve a elegirlo. Nada cambió en la web.'],
  login_401: ['err', 'Credenciales inválidas.', 'Revisa el correo, la contraseña y el código. Si el código cambió mientras lo escribías, usa el nuevo.'],
  login_429: ['warn', 'Acceso pausado por seguridad.', 'Hubo demasiados intentos fallidos. Espera 15 minutos y vuelve a intentarlo.'],
};
const fill = (s, p = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
/** { type, key, title, text } for a §7.13 key; errors end with «Nada cambió en la web.» (not the login one: nothing could change before signing in). */
export function message(key, params = {}) {
  const [type, title, text] = MESSAGES[key];
  return { type, key, title: fill(title, params), text: fill(text, params) + (type === 'err' && key !== 'login_401' ? ' Nada cambió en la web.' : '') };
}

/** A request the client got wrong (unparseable or oversized body): answered with a 4xx, never the 500 page. */
const clientFault = (why, code = 'bad_request') => Object.assign(new Error(why), { code });

/** Reads a small urlencoded form (login, logout, activate, restore) from a Web or Node stream, without formData(). */
async function readForm(body, limit = 8192) {
  const parts = []; let n = 0;
  if (body) for await (const c of body) { n += c.length; if (n > limit) throw clientFault('form too large'); parts.push(Buffer.from(c)); }
  return new URLSearchParams(Buffer.concat(parts).toString());
}
/** readForm, or null for a body the client got wrong (the caller answers 403/400). */
const formOrNull = (body) => readForm(body).catch((e) => { if (e.code === 'bad_request') return null; throw e; });

/** Sends a result that has no view: a redirect, a JSON answer or an empty status (e.g. 499). */
export function toResponse(r, headers = {}) {
  const h = new Headers(headers);
  for (const c of r.setCookies ?? []) h.append('Set-Cookie', c);
  if (r.location) h.set('Location', r.location);
  if (r.json) h.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(r.json ? JSON.stringify(r.json) : null, { status: r.status, headers: h });
}

export function configFromEnv(env = process.env) {
  return {
    secret: env.PANEL_SECRET, siteRoot: env.SITE_ROOT, dataDir: env.DATA_DIR, siteUrl: env.SITE_URL || 'https://expertsddt.com', panelUrl: env.PANEL_URL || 'https://admin.expertsddt.com',
    cookieSecure: env.COOKIE_SECURE !== '0', trustProxy: env.TRUST_PROXY === '1', libMaxMb: env.LIB_MAX_MB ? Number(env.LIB_MAX_MB) : 300,
  };
}
/** An http(s) URL reduced to its origin (no path, no trailing slash), or an error that names the variable. */
const originOf = (v, name) => {
  let u; try { u = new URL(v); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) throw new Error(`${name} must be a full http(s) URL such as https://expertsddt.com (got ${JSON.stringify(v)})`);
  return u.origin;
};
const AUDIT_MAX = 5 * 1024 * 1024, AUDIT_TAIL = 2 * 1024 * 1024; // rotate at 5 MB into audit.jsonl.1; pages read the last 2 MB
const isLoopback = (a) => /^(127\.|::1$|::ffff:127\.)/.test(a);

/**
 * cfg: { secret, siteRoot, dataDir, siteUrl?, panelUrl?, cookieSecure?, trustProxy?, libMaxMb?, now?, slots? | slotsPath? }.
 * Pass `slots` (the parsed slots.json) when this file is bundled (Astro/Vite), because import.meta.url then points into dist/.
 * Throws on a bad configuration, so a server can refuse to start before it listens.
 */
export async function createPanel(cfg) {
  const { secret, siteRoot, dataDir } = cfg;
  const siteUrl = originOf(cfg.siteUrl || 'https://expertsddt.com', 'SITE_URL');
  const panelOrigin = originOf(cfg.panelUrl || 'https://admin.expertsddt.com', 'PANEL_URL');
  const libMaxMb = cfg.libMaxMb ?? 300;
  if (!(libMaxMb > 0)) throw new Error(`LIB_MAX_MB must be a number of megabytes such as 300 (got ${JSON.stringify(cfg.libMaxMb)})`);
  if (!secret || secret.length < 32) throw new Error('PANEL_SECRET must be at least 32 characters');
  if (!siteRoot || !dataDir) throw new Error('SITE_ROOT and DATA_DIR are required');
  const [site, data] = [resolve(siteRoot), resolve(dataDir)];
  if (data === site || data.startsWith(site + sep)) throw new Error('DATA_DIR must be outside SITE_ROOT: it holds the users, the backups and the audit log');
  const siteExists = () => stat(site).then((s) => s.isDirectory(), () => false);
  if (!(await siteExists())) console.error(`panel: SITE_ROOT ${site} does not exist; uploads are refused until it does (is the path right?)`);
  if (!sharp) console.warn(`panel: sharp could not be loaded (${sharpError?.message}); photos are NOT re-encoded, so their metadata (EXIF, GPS) is kept, and only files already in each slot's format are accepted`);
  const slotsFile = cfg.slots ?? JSON.parse(await readFile(cfg.slotsPath ?? new URL('../slots.json', import.meta.url), 'utf8'));
  const slots = [
    ...slotsFile.images.map((s) => ({ ...s, kind: 'image' })),
    ...slotsFile.videos.map((s) => ({ ...s, kind: 'video' })),
    ...slotsFile.documents.map((s) => ({ ...s, kind: 'document' })),
  ];
  const posterMaxWidth = slotsFile.posterSize?.maxWidth ?? 1280;
  const now = cfg.now ?? (() => Date.now());
  const byEmail = createThrottle({ max: 8, now }), byIp = createThrottle({ max: 20, now });
  await mkdir(join(dataDir, 'tmp'), { recursive: true });
  await mkdir(join(dataDir, 'backups'), { recursive: true });
  // start-up sweep: uploads and copies cut by a crash, restart or redeploy leave partial files behind
  const sweep = async (dir, re) => { for (const f of await readdir(dir).catch(() => [])) if (re.test(f)) await unlink(join(dir, f)).catch(() => {}); };
  await sweep(join(dataDir, 'tmp'), /./);
  const placedDirs = slots.flatMap((s) => [s.path, s.poster]).filter(Boolean).map((p) => dirname(p));
  for (const d of new Set([...placedDirs, 'downloads/libraries'])) await sweep(join(site, d), /^\.[0-9a-f]{16}\.tmp$|\.json\.[0-9a-f]{12}\.tmp$/);

  // ---------- storage ----------
  const auditFile = join(dataDir, 'audit.jsonl');
  const cap = (v, n) => String(v ?? '').slice(0, n);
  let auditQueue = Promise.resolve(); // one append (and rotation check) at a time
  const audit = (user, action, detail = '', ip = '', extra = {}) => (auditQueue = auditQueue.catch(() => {}).then(async () => {
    await appendFile(auditFile, JSON.stringify({ ts: new Date(now()).toISOString(), user: cap(user, 254), action, detail: cap(detail, 500), ip: cap(ip, 45), ...extra }) + '\n');
    if ((await stat(auditFile).catch(() => null))?.size > AUDIT_MAX) await rename(auditFile, `${auditFile}.1`).catch(() => {}); // one old file is kept
  }));
  async function tail(file, max) { // the last `max` bytes, from the first whole line
    let fh;
    try { fh = await open(file, 'r'); } catch (e) { if (e.code !== 'ENOENT') console.error(`panel: cannot read ${file}:`, e.message); return ''; }
    try {
      const { size } = await fh.stat(), len = Math.min(size, max), b = Buffer.alloc(len);
      await fh.read(b, 0, len, size - len);
      const s = b.toString('utf8');
      return len < size ? s.slice(s.indexOf('\n') + 1) : s;
    } finally { await fh.close(); }
  }
  const readAudit = async () => {
    const cur = await tail(auditFile, AUDIT_TAIL), left = AUDIT_TAIL - Buffer.byteLength(cur);
    const old = left > 4096 ? await tail(`${auditFile}.1`, left) : '';
    return `${old}\n${cur}`.split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l?.action && !Number.isNaN(Date.parse(l.ts)));
  };
  let lastUsers = [];
  const users = async () => { // a broken users.json is logged and the last good copy kept, not every session ended in silence
    try { return (lastUsers = JSON.parse(await readFile(join(dataDir, 'users.json'), 'utf8'))); } catch (e) {
      if (e.code === 'ENOENT') return (lastUsers = []);
      console.error(`panel: ${join(dataDir, 'users.json')} cannot be read (${e.message}); using the last good copy`);
      return lastUsers;
    }
  };
  const nameOf = (list) => (email) => displayName(list.find((u) => u.email === email)) || String(email || '');
  const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };
  async function writeJsonAtomic(p, obj) { const t = `${p}.${randomBytes(6).toString('hex')}.tmp`; await writeFile(t, JSON.stringify(obj, null, 2) + '\n'); await rename(t, p); }
  const cleanup = (...paths) => Promise.all(paths.filter(Boolean).map((p) => unlink(p).catch(() => {})));
  const libDir = () => safeJoin(siteRoot, 'downloads/libraries');
  let libQueue = Promise.resolve();
  const libLock = (fn) => { const run = libQueue.then(fn, fn); libQueue = run.catch(() => {}); return run; }; // one instance only (README)
  const requireSite = async () => { if (!(await siteExists())) throw new Error(`SITE_ROOT ${site} does not exist: nothing was written`); }; // never mkdir a typo
  async function readVersions(dir, latest) { // versions.json joined with latest.json: the active version can never drop off the list
    const list = await readJson(join(dir, 'versions.json'), null);
    const out = Array.isArray(list) ? list : [];
    if (latest?.version && latest.file && !out.some((v) => v.file === latest.file)) out.push(latest);
    return out;
  }
  const roleOf = (slot, name) => (name === basename(slot.path) ? 'file' : slot.poster && name === basename(slot.poster) ? 'poster' : null);
  const slotOfLine = (l) => slots.find((s) => s.id === l.slot) ?? slots.find((s) => s.path === String(l.detail || '').replace(/ \+ portada$/, ''));
  const versionOf = (l) => l.version ?? (l.action === 'library_publish' ? OLD_PUBLISH.exec(l.detail)?.[1] : l.detail);

  // ---------- cookies, flash notices, session ----------
  const cookieOf = (name, val, maxAge) => `${name}=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${cfg.cookieSecure === false ? '' : '; Secure'}`;
  // __Host-: browsers refuse a copy with a Domain or another Path, so no sibling host under expertsddt.com can shadow the session.
  // The prefix requires Secure, so a COOKIE_SECURE=0 local run keeps the plain name.
  const SID = cfg.cookieSecure === false ? 'edp_sid' : '__Host-edp_sid';
  const clear = (name) => cookieOf(name, '', 0);
  const flashCookie = (f) => cookieOf('edp_flash', sign({ ...f, exp: now() + 60_000 }, secret), 60);
  const note = (key, params, extra) => ({ ...message(key, params), ...extra }); // + slot, undo {action, fields, label}, keep {version, dataDate}
  const readFlash = (c) => { const f = verify(c.edp_flash, secret, now()); if (!f) return null; const { exp, ...rest } = f; return rest; };
  async function readSession(c) {
    const s = verify(c[SID], secret, now());
    if (!s) return null;
    const u = (await users()).find((x) => x.email === s.uid);
    return u && (u.tokenVersion ?? 0) === s.tv ? { ...s, user: u } : null;
  }
  // A missing Origin is accepted (SameSite=Strict + CSRF still apply); 'null' and foreign origins are not. The expected origin is
  // PANEL_URL (what the browser sees behind the proxy, whatever Host the proxy sends) or the request's own Host, never X-Forwarded-Host.
  function sameOrigin(h) {
    if (!h.origin) return true;
    try { const o = new URL(h.origin); return o.origin === panelOrigin || o.host === h.host; } catch { return false; }
  }
  const done = (h, to, flash) => { const setCookies = flash ? [flashCookie(flash)] : []; return isXhr(h) ? { status: 200, json: { to }, setCookies } : { status: 303, location: to, setCookies }; };
  const forbidden = (h) => (isXhr(h) ? { status: 403, json: { to: '/' }, setCookies: [flashCookie(message('csrf'))] } : { status: 403, view: '403', setCookies: [] });
  const unauth = (h) => (isXhr(h) ? { status: 401, json: { to: '/login' }, setCookies: [] } : { status: 303, location: '/login', setCookies: [] });
  /** Maps what a client caused (abort, unparseable or oversized body) to an answer; anything else is a real fault and is rethrown. */
  const clientError = (e, signal, h, tooLarge) => {
    if (signal?.aborted || e?.message === 'aborted') return { status: 499, setCookies: [] };
    if (e?.code === 'too_large' && tooLarge) return tooLarge();
    if (e?.code === 'bad_request' || e?.code === 'too_large') return forbidden(h); // the CSRF token could not be read either
    throw e;
  };
  const authed = (fn) => (io = {}) => { const h = plain(io.headers); return io.session ? fn({ ...io, h }) : unauth(h); };

  /** Runs before every route (the middleware): origin check on POST, flash, session, expiry notice. */
  async function guard({ method = 'GET', path = '/', headers } = {}) {
    const h = plain(headers), c = parseCookies(h.cookie);
    if (method === 'POST' && !sameOrigin(h)) return { response: forbidden(h) };
    const flash = readFlash(c);
    const session = await readSession(c);
    if (!session && path !== '/login') {
      const setCookies = [clear(SID)];
      if (c[SID]) setCookies.push(flashCookie(message(method === 'POST' && path.startsWith('/upload/') ? 'expired_upload' : 'expired')));
      return { response: isXhr(h) ? { status: 401, json: { to: '/login' }, setCookies } : { status: 303, location: '/login', setCookies } };
    }
    if (session && path === '/login' && method === 'GET') return { response: { status: 303, location: '/', setCookies: [] } };
    return { session, csrf: session ? csrfFor(session, secret) : null, flash, setCookies: flash && method === 'GET' ? [clear('edp_flash')] : [] };
  }

  // ---------- uploads (§9.4): streamed to DATA_DIR/tmp, never buffered; tmps belongs to the caller so its finally always cleans ----------
  function receive(body, h, signal, { maxFile, maxFiles, names, csrf, tmps }) {
    return new Promise((resolve, reject) => {
      const fields = {}, files = {}, writers = [];
      let csrfOk = false, tooBig = null, settled = false, bb;
      // no unparseable content type or missing boundary reaches the 500 page
      if (!/^multipart\/form-data\b/i.test(h['content-type'] || '')) return reject(clientFault('not multipart')); // busboy would also take urlencoded
      try { bb = Busboy({ headers: h, limits: { files: maxFiles, fields: 10, parts: 20, fileSize: maxFile } }); } catch (e) { return reject(clientFault(e.message)); }
      const src = typeof body?.getReader === 'function' ? Readable.fromWeb(body) : body;
      // An over-limit file is drained so the browser gets the notice instead of «connection reset» (the body has no cap in
      // astro.config.mjs, so LIB_MAX_MB is read at run time); past twice the allowance the body is cut.
      const maxBody = 2 * maxFile * maxFiles + MB;
      let seen = 0;
      src?.on?.('data', (c) => { seen += c.length; if (seen > maxBody) fail(clientFault('body too large', 'too_large')); });
      const fail = (e) => {
        if (settled) return; settled = true;
        src?.destroy?.(); bb.destroy();
        for (const w of writers) w.destroy();
        Promise.all(writers.map((w) => (w.closed ? null : once(w, 'close').catch(() => {})))).then(() => reject(e)); // closed before unlink (Windows)
      };
      if (signal?.aborted) return fail(new Error('aborted'));
      signal?.addEventListener('abort', () => fail(new Error('aborted')), { once: true }); // «Cancelar subida» or a closed tab
      src?.on('error', fail); bb.on('error', (e) => fail(clientFault(e.message))); // a malformed multipart body
      bb.on('field', (n, v) => { fields[n] = v; if (n === '_csrf') csrfOk = eq(v, csrf); });
      bb.on('file', (name, stream, info) => {
        stream.on('error', fail);
        // the token must come first; unknown parts and empty ones (an optional input left blank) are drained
        if (!csrfOk || !names.includes(name) || !info?.filename) return stream.resume();
        const tmp = join(dataDir, 'tmp', randomBytes(12).toString('hex'));
        tmps.push(tmp);
        const ws = createWriteStream(tmp); writers.push(ws); ws.on('error', fail);
        stream.on('limit', () => { tooBig = name; }); // keep draining: cutting the body makes browsers show «connection reset» instead of the notice
        stream.pipe(ws);
        files[name] = tmp;
      });
      bb.on('close', async () => {
        if (settled) return;
        try { await Promise.all(writers.map((w) => finished(w))); } catch (e) { return fail(e); }
        if (!settled) { settled = true; resolve({ fields, files, csrfOk, tooBig }); }
      });
      if (src) src.pipe(bb); else bb.end();
    });
  }

  /** Validates (and, with sharp, re-encodes and strips metadata from) an uploaded image so it matches the slot's file type. */
  async function prepareImage(tmp, dest, { minWidth = 0, maxWidth = 2400, crop } = {}, tmps) {
    const want = extname(dest).slice(1).toLowerCase().replace('jpeg', 'jpg');
    const { type } = await sniff(tmp);
    if (!['webp', 'png', 'jpg'].includes(type)) return { ok: false, key: 'img_type' };
    if (!sharp) {
      if (type !== want) return { ok: false, key: 'img_format', params: { formato: FORMAT[want] } };
      const d = await imageSize(tmp, type);
      if (!d) return { ok: false, key: 'img_unreadable' };
      if (d.width < minWidth) return { ok: false, key: 'img_small', params: { w: d.width, min: minWidth } };
      return { ok: true, path: tmp };
    }
    try {
      const meta = await sharp(tmp, { limitInputPixels: 40_000_000 }).metadata();
      if (meta.width < minWidth) return { ok: false, key: 'img_small', params: { w: meta.width, min: minWidth } };
      const img = sharp(tmp, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
      const pipe = crop === 'og' ? img.resize(1200, 630, { fit: 'cover', position: 'centre' }) : img.resize({ width: maxWidth, withoutEnlargement: true });
      const out = `${tmp}.out`; tmps.push(out);
      await (want === 'webp' ? pipe.webp({ quality: 82 }) : pipe.jpeg({ quality: 85, mozjpeg: true })).toFile(out);
      return { ok: true, path: out };
    } catch { return { ok: false, key: 'img_unreadable' }; }
  }

  // ---------- operations (POST) ----------
  const blockedLogged = new Map(); // throttle key → the lock already written to the log: one login_blocked line per lock, not per request
  async function login({ body, ip = '' } = {}) {
    const f = await formOrNull(body);
    if (!f) return { status: 400, view: 'login', data: { email: '', flash: message('login_401') }, setCookies: [] };
    const email = String(f.get('email') || '').toLowerCase().trim().slice(0, 254);
    const again = (status, key) => ({ status, view: 'login', data: { email, flash: message(key) }, setCookies: [] });
    if (byEmail.blocked(email) || byIp.blocked(ip)) {
      const [key, until] = byIp.blocked(ip) ? [`ip ${ip}`, byIp.until(ip)] : [`email ${email}`, byEmail.until(email)];
      if (blockedLogged.get(key) !== until) {
        if (blockedLogged.size > 1000) for (const [k, u] of blockedLogged) if (u <= now()) blockedLogged.delete(k);
        blockedLogged.set(key, until);
        await audit(email, 'login_blocked', '', ip);
      }
      return again(429, 'login_429');
    }
    const u = (await users()).find((x) => x.email === email);
    const pwOk = await verifyPassword(String(f.get('password') || ''), u?.hash ?? DUMMY_HASH);
    const totpOk = u ? verifyTotp(u.totp, String(f.get('code') || '').replace(/\s+/g, ''), now()) : false; // «123 456» works
    if (!u || !pwOk || !totpOk) { byEmail.fail(email); byIp.fail(ip); await audit(email, 'login_failed', '', ip); return again(401, 'login_401'); }
    byEmail.ok(email);
    const tok = sign({ sid: randomBytes(12).toString('hex'), uid: u.email, tv: u.tokenVersion ?? 0, exp: now() + SESSION_MS }, secret);
    await audit(u.email, 'login', '', ip);
    return { status: 303, location: '/', setCookies: [cookieOf(SID, tok, SESSION_MS / 1000)] };
  }

  const logout = authed(async ({ session, h, body, ip = '' }) => {
    const f = await formOrNull(body);
    if (!f || !eq(f.get('_csrf'), csrfFor(session, secret))) return forbidden(h);
    await audit(session.uid, 'logout', '', ip);
    return { status: 303, location: '/login', setCookies: [clear(SID), flashCookie(message('logout'))] };
  });

  const uploadSlot = authed(async ({ session, h, body, signal, ip = '' }) => {
    const tmps = [];
    try {
      const r = await receive(body, h, signal, { maxFile: IMG_MAX, maxFiles: 2, names: ['file', 'poster'], csrf: csrfFor(session, secret), tmps });
      if (!r.csrfOk) return forbidden(h);
      const slot = slots.find((x) => x.id === r.fields.slot);
      if (!slot) return done(h, '/', note('unknown_slot'));
      const to = `/#slot-${slot.id}`;
      const fail = (key, params) => done(h, to, note(key, params, { slot: slot.id }));
      if (!r.files.file) return fail('no_file');
      if (r.tooBig) return fail('too_big', { max: Math.round((r.tooBig === 'file' && slot.kind !== 'image' ? slot.maxBytes : IMG_MAX) / MB) });
      const dest = safeJoin(siteRoot, slot.path);
      let placed = r.files.file, poster = null;
      if (slot.kind === 'image') {
        const p = await prepareImage(r.files.file, dest, slot, tmps);
        if (!p.ok) return fail(p.key, p.params);
        placed = p.path;
      } else if (slot.kind === 'video') {
        const { type, brand } = await sniff(r.files.file);
        if (type === 'mp4' && brand === 'qt  ') return fail('video_mov');
        if (type !== 'mp4') return fail('video_type');
        const bytes = (await stat(r.files.file)).size;
        if (bytes > slot.maxBytes) return fail('video_big', { x: (bytes / MB).toFixed(1) });
        if (r.files.poster) {
          if (!slot.poster) return fail('no_poster');
          const pp = await prepareImage(r.files.poster, safeJoin(siteRoot, slot.poster), { minWidth: 320, maxWidth: posterMaxWidth }, tmps);
          if (!pp.ok) return fail('poster', { motivo: lowerFirst(fill(MESSAGES[pp.key][2], pp.params)) });
          poster = pp.path;
        }
      } else if ((await sniff(r.files.file)).type !== 'pdf' || (await stat(r.files.file)).size > slot.maxBytes) return fail('pdf');
      await requireSite();
      const backupDir = join(dataDir, 'backups', slot.id), created = [];
      const a = await placeFile(placed, dest, backupDir); if (a.backup) created.push(basename(a.backup));
      if (poster) { const b = await placeFile(poster, safeJoin(siteRoot, slot.poster), backupDir); if (b.backup) created.push(basename(b.backup)); }
      await audit(session.uid, 'replace', `${slot.path}${poster ? ' + portada' : ''}`, ip, { slot: slot.id });
      const ok = note(slot.kind === 'image' ? 'ok_image' : slot.kind === 'video' ? 'ok_video' : 'ok_pdf', {}, {
        slot: slot.id, undo: created.length ? { action: '/restore', fields: { slot: slot.id, file: created }, label: 'Deshacer' } : undefined,
      });
      if (poster) ok.title = 'Listo: el video y su portada ya están en la web.';
      return done(h, to, ok);
    } catch (e) { return clientError(e, signal, h); } finally { await cleanup(...tmps); }
  });

  const uploadLibrary = authed(async ({ session, h, body, signal, ip = '' }) => {
    const tmps = [];
    try {
      const r = await receive(body, h, signal, { maxFile: libMaxMb * MB, maxFiles: 1, names: ['file'], csrf: csrfFor(session, secret), tmps });
      if (!r.csrfOk) return forbidden(h);
      const raw = String(r.fields.version ?? '').trim(), dataDate = String(r.fields.dataDate ?? '').trim();
      const keep = { version: raw.slice(0, 8), dataDate: dataDate.slice(0, 10) }; // refilled after an error (WCAG 3.3.7)
      const fail = (key, params) => done(h, '/#librerias', note(key, params, { slot: 'libraries', keep }));
      const version = `v${raw.replace(/^v/i, '')}`;
      if (!/^v\d{1,3}$/.test(version) || !isDay(dataDate)) return fail('lib_meta');
      if (r.tooBig || !r.files.file) return fail('lib_file', { max: libMaxMb });
      if ((await sniff(r.files.file)).type !== 'zip') return fail('lib_not_zip');
      const z = await inspectZip(r.files.file);
      if (!z.ok) return fail(ZIP_KEYS[z.code], { n: z.detail, ruta: String(z.detail ?? '').slice(0, 80) });
      const bytes = (await stat(r.files.file)).size, sha256 = await sha256File(r.files.file);
      await requireSite();
      return await libLock(async () => { // latest.json + versions.json are read, checked and written by one publish or activation at a time
        const dir = libDir(); await mkdir(dir, { recursive: true });
        const prev = await readJson(join(dir, 'latest.json'), null);
        const index = await readVersions(dir, prev); // seeds versions.json from latest.json the first time
        if (index.some((v) => v.version === version)) return fail('lib_dup', { v: version, n: nextFree(index) });
        const file = `exocad-implant-libraries-${version}-${dataDate}.zip`;
        const entry = { version, dataDate, file, bytes, sha256, files: z.entries };
        await placeFile(r.files.file, join(dir, file), join(dataDir, 'backups', 'libraries'));
        index.push(entry);
        await writeJsonAtomic(join(dir, 'versions.json'), index);
        await writeJsonAtomic(join(dir, 'latest.json'), entry);
        await audit(session.uid, 'library_publish', `${version} · ${fmt.files(entry.files)} · ${fmt.size(entry.bytes)}`, ip, { version, files: entry.files, bytes: entry.bytes });
        const back = prev?.version && prev.file !== file ? prev : null;
        const extra = { slot: 'libraries', undo: back ? { action: '/libraries/activate', fields: { file: back.file }, label: `Volver a la ${back.version}` } : undefined };
        return done(h, '/#librerias', back?.files > 0 && entry.files < back.files / 2
          ? note('warn_publish', { v: version, n: entry.files, anterior: back.version, m: back.files }, extra)
          : note('ok_publish', { v: version, n: entry.files }, extra));
      });
    } catch (e) {
      return clientError(e, signal, h, () => done(h, '/#librerias', note('lib_file', { max: libMaxMb }, { slot: 'libraries' })));
    } finally { await cleanup(...tmps); }
  });

  const activate = authed(async ({ session, h, body, ip = '' }) => {
    const f = await formOrNull(body);
    if (!f || !eq(f.get('_csrf'), csrfFor(session, secret))) return forbidden(h);
    return libLock(() => activateIn(libDir(), f.get('file'), session, h, ip));
  });
  async function activateIn(dir, wanted, session, h, ip) {
    const prev = await readJson(join(dir, 'latest.json'), null);
    const entry = (await readVersions(dir, prev)).find((v) => v.file === wanted);
    if (!entry) return done(h, '/#librerias', note('lib_unknown', {}, { slot: 'libraries' }));
    await writeJsonAtomic(join(dir, 'latest.json'), entry);
    await audit(session.uid, 'library_activate', entry.version, ip, { version: entry.version });
    const back = prev?.version && prev.file !== entry.file ? prev : null;
    const ok = note('ok_activate', { v: entry.version, anterior: back?.version }, {
      slot: 'libraries', undo: back ? { action: '/libraries/activate', fields: { file: back.file }, label: `Volver a la ${back.version}` } : undefined,
    });
    if (!back) ok.text = '';
    return done(h, '/#librerias', ok);
  }

  const restore = authed(async ({ session, h, body, ip = '' }) => {
    const f = await formOrNull(body);
    if (!f || !eq(f.get('_csrf'), csrfFor(session, secret))) return forbidden(h);
    const slot = slots.find((s) => s.id === f.get('slot'));
    if (!slot) return done(h, '/', note('unknown_slot'));
    const to = `/#slot-${slot.id}`, dir = join(dataDir, 'backups', slot.id);
    // only names readdir() returned, and only copies of this slot's own file or poster: no paths, no other slot's files
    const names = await readdir(dir).catch(() => []);
    const picks = f.getAll('file').map((file) => ({ file, role: names.includes(file) ? roleOf(slot, parseBackup(file)?.name) : null }));
    if (!picks.length || picks.some((p) => !p.role) || new Set(picks.map((p) => p.role)).size !== picks.length) {
      return done(h, to, note('restore_unknown', {}, { slot: slot.id }));
    }
    const tmps = [], created = [];
    await requireSite();
    try {
      for (const p of picks) { // the copy goes through tmp + placeFile, so what is live now becomes a new copy (restoring can be undone)
        const tmp = join(dataDir, 'tmp', randomBytes(12).toString('hex')); tmps.push(tmp);
        await copyFile(join(dir, p.file), tmp);
        const { backup } = await placeFile(tmp, safeJoin(siteRoot, p.role === 'poster' ? slot.poster : slot.path), dir);
        if (backup) created.push(basename(backup));
      }
    } finally { await cleanup(...tmps); }
    await audit(session.uid, 'restore', picks.map((p) => p.file).join(' + '), ip, { slot: slot.id, files: picks.map((p) => p.file) });
    return done(h, to, note('ok_restore', { titulo: slot.label }, {
      slot: slot.id, undo: created.length ? { action: '/restore', fields: { slot: slot.id, file: created }, label: 'Deshacer' } : undefined,
    }));
  });

  // ---------- page data (GET) ----------
  const userOf = (session) => { const name = displayName(session.user); return { email: session.uid, name, initials: initials(name || session.uid) }; };
  const fileInfo = async (rel) => { try { const st = await stat(safeJoin(siteRoot, rel)); return { size: st.size, mtime: Math.round(st.mtimeMs) }; } catch { return null; } };
  const urlOf = (rel, info) => (info ? `${siteUrl}/${rel}?v=${info.mtime}` : null);
  async function backupsOf(slot) { // the 6 most recent copies, newest first
    const dir = join(dataDir, 'backups', slot.id);
    const list = (await readdir(dir).catch(() => [])).map((file) => ({ file, ...parseBackup(file) }))
      .filter((b) => b.ts && roleOf(slot, b.name)).sort((a, b) => b.ts - a.ts).slice(0, 6);
    return Promise.all(list.map(async (b) => ({ file: b.file, ts: b.ts, role: roleOf(slot, b.name), size: (await stat(join(dir, b.file)).catch(() => ({ size: 0 }))).size })));
  }
  const titleOf = (l) => (l.action.startsWith('library_') ? `Librerías ${versionOf(l) ?? ''}`.trim() : slotOfLine(l)?.label ?? String(l.detail || ''));

  /** §9.5.14: everything the «Contenido» page renders. */
  async function dashboard(session) {
    if (!session) throw new Error('dashboard needs a session');
    const t = now(), lines = await readAudit(), nameFor = nameOf(await users());
    const items = await Promise.all(slots.map(async (s) => {
      const cur = await fileInfo(s.path), pst = s.poster ? await fileInfo(s.poster) : null, thumb = s.thumb ? await fileInfo(s.thumb) : null;
      return {
        ...s, format: FORMAT[extname(s.path).slice(1).toLowerCase()] ?? '',
        url: urlOf(s.path, cur), posterUrl: s.poster ? urlOf(s.poster, pst) : s.thumb ? urlOf(s.thumb, thumb) : null,
        size: cur?.size ?? 0, mtime: cur?.mtime ?? 0, missing: !cur, fresh: !!cur && t - cur.mtime < FRESH_MS,
        places: fmt.places(s.where), webUrl: s.where?.length ? `${siteUrl}${s.where[0].url}` : null,
        backups: await backupsOf(s),
      };
    }));
    const counts = Object.fromEntries(['image', 'video', 'document'].map((k) => {
      const of = items.filter((i) => i.kind === k); return [k, { total: of.length, missing: of.filter((i) => i.missing).length }];
    }));
    const dir = libDir(), latestPath = join(dir, 'latest.json');
    const latest = await readJson(latestPath, null);
    const list = await readVersions(dir, latest);
    const latestStat = latest ? await stat(latestPath).catch(() => null) : null;
    const since = latest && lines.findLast((l) => (l.action === 'library_publish' || l.action === 'library_activate') && versionOf(l) === latest.version);
    const last = lines.findLast((l) => CHANGES.includes(l.action));
    return {
      user: userOf(session), csrf: csrfFor(session, secret), siteUrl, canConvert: !!sharp, libMaxMb,
      slots: items, counts, missing: items.filter((i) => i.missing).map((i) => i.label),
      lastChange: last ? { action: last.action, title: titleOf(last), who: nameFor(last.user), ts: Date.parse(last.ts), rel: fmt.relative(Date.parse(last.ts), t) } : null,
      libraries: {
        latest, publicLine: latest ? fmt.publicLine(latest) : null, fresh: !!latestStat && t - latestStat.mtimeMs < FRESH_MS,
        since: since ? { ts: Date.parse(since.ts), who: nameFor(since.user) } : null,
        versions: list.slice().sort((a, b) => num(b.version) - num(a.version)).map((v) => ({ ...v, active: v.file === latest?.file })),
        existing: list.map((v) => v.version), nextVersion: nextFree(list), today: fmt.isoDay(t),
        pageUrl: `${siteUrl}/es/exocad-libraries/`, zipUrl: latest ? `${siteUrl}/downloads/libraries/${latest.file}` : null,
      },
    };
  }

  /** §9.5.15: the last 200 events, filtered by tipo (cambios | accesos | todo), grouped by Florida day, newest first. */
  async function history(session, tipo) {
    if (!session) throw new Error('history needs a session');
    const t = now(), nameFor = nameOf(await users());
    tipo = Object.hasOwn(FILTERS, tipo) ? tipo : 'cambios';
    const groups = [];
    for (const l of (await readAudit()).slice(-200).reverse().filter((x) => FILTERS[tipo](x.action))) {
      const ts = Date.parse(l.ts), day = fmt.isoDay(ts);
      if (groups.at(-1)?.day !== day) groups.push({ day, label: fmt.day(ts, t), items: [] });
      groups.at(-1).items.push(eventOf(l, ts, nameFor));
    }
    return { user: userOf(session), csrf: csrfFor(session, secret), tipo, groups, empty: groups.length ? null : tipo === 'cambios' ? 'none' : 'filter' };
  }

  function eventOf(l, ts, nameFor) {
    const who = nameFor(l.user), e = { ts, time: fmt.time(ts), action: l.action, who, initials: initials(who), icon: 'clock', text: l.action, detail: '', ip: null, warn: false };
    const s = slotOfLine(l);
    switch (l.action) {
      case 'replace': {
        const poster = / \+ portada$/.test(l.detail || '');
        const text = !s ? 'cambió un archivo' : s.kind === 'image' ? `cambió la foto «${s.label}»`
          : s.kind === 'video' ? `cambió el video «${s.label}»${poster ? ' y su portada' : ''}` : 'cambió la guía de servicios y tarifas';
        return { ...e, icon: 'upload', text, detail: String(l.detail || '').replace(/ \+ portada$/, '') };
      }
      case 'restore': {
        const copy = parseBackup(l.files?.[0] ?? String(l.detail || '').split(' + ')[0]);
        return { ...e, icon: 'rotate-ccw', text: `volvió a una versión anterior de «${s?.label ?? ''}»`, detail: copy ? `copia del ${fmt.dateTime(copy.ts)}` : '' };
      }
      case 'library_publish': {
        const old = OLD_PUBLISH.exec(l.detail || '');
        const files = l.files ?? Number(old?.[2]), bytes = l.bytes ?? Number(old?.[3]);
        return { ...e, icon: 'package', text: `publicó la versión ${versionOf(l)} de las librerías`, detail: Number.isFinite(files) && Number.isFinite(bytes) ? `${fmt.files(files)} · ${fmt.size(bytes)}` : '' };
      }
      case 'library_activate': return { ...e, icon: 'rotate-ccw', text: `volvió a poner en la web la versión ${versionOf(l)} de las librerías` };
      case 'login': return { ...e, icon: 'log-in', text: 'entró al panel' };
      case 'logout': return { ...e, icon: 'log-out', text: 'salió del panel' };
      case 'login_failed':
      case 'login_blocked': return {
        ...e, who: null, initials: null, icon: 'alert-triangle', warn: true, ip: l.ip || '', detail: `IP ${l.ip || ''}`,
        text: l.action === 'login_failed' ? `Intento de acceso fallido con ${l.user}` : `Acceso pausado 15 minutos por demasiados intentos (${l.user})`,
      };
      default: return e;
    }
  }

  // ---------- headers ----------
  const CSP = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' ${siteUrl} blob:; media-src ${siteUrl}; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`;
  /** Hardened headers for every non-static response. The CSP is a header (never a meta tag); leave it out only in `astro dev`. */
  const securityHeaders = ({ csp = true } = {}) => ({
    ...(csp ? { 'Content-Security-Policy': CSP } : {}),
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', // 'no-referrer' makes browsers send Origin: null
    'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Robots-Tag': 'noindex, nofollow',
    ...(cfg.cookieSecure === false ? {} : { 'Strict-Transport-Security': 'max-age=31536000' }),
  });
  /**
   * The client address for the throttle and the log: the socket address, unless that socket is a proxy (loopback always,
   * any address with TRUST_PROXY=1); then the LAST X-Forwarded-For entry, the one the proxy itself appended (the entries
   * before it are whatever the client sent). Only a real IP is ever returned.
   */
  const clientIp = (headers, remote = '') => {
    const peer = isIP(String(remote)) ? String(remote) : '';
    if (cfg.trustProxy || isLoopback(peer)) {
      const last = String(plain(headers)['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).at(-1);
      if (last && isIP(last)) return last;
    }
    return peer;
  };

  return {
    config: { siteUrl, panelOrigin, libMaxMb, cookieSecure: cfg.cookieSecure !== false }, slots, canConvert: !!sharp,
    securityHeaders, clientIp, guard, login, logout, uploadSlot, uploadLibrary, activate, restore, dashboard, history, audit,
  };
}
