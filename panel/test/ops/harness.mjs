// Shared helpers for the operations checks in test/ops (not part of `npm test`): start the built server
// (dist/server/entry.mjs) like Hostinger would, log in, and stream big multipart uploads without buffering them.
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { hashPassword, newTotpSecret, totp, verify } from '../../lib/auth.mjs';

export const PANEL = fileURLToPath(new URL('../..', import.meta.url));
export const SECRET = 'ops-check-secret-'.padEnd(48, 'x');
export const PASS = 'a-long-ops-password';
export const EMAIL = 'ops@example.com';
export const MB = 1024 * 1024;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** What a TLS proxy in front of admin.expertsddt.com adds (and what a browser sends as Origin). */
export const PROXY = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'admin.expertsddt.com', 'X-Forwarded-For': '203.0.113.7', Origin: 'https://admin.expertsddt.com' };

export const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

/** Temporary SITE_ROOT and DATA_DIR (under OPS_TMP if set: big uploads need disk space). */
export async function tempDirs() {
  const root = await mkdtemp(join(process.env.OPS_TMP || tmpdir(), 'panel-ops-'));
  const dirs = { root, site: join(root, 'site'), data: join(root, 'data') };
  await mkdir(dirs.site, { recursive: true }); await mkdir(dirs.data, { recursive: true });
  return dirs;
}
export const removeDirs = (dirs) => rm(dirs.root, { recursive: true, force: true, maxRetries: 5 });

export async function addUser(dataDir, email = EMAIL) {
  const secret = newTotpSecret();
  await writeFile(join(dataDir, 'users.json'), JSON.stringify([{ email, name: 'Ops', hash: await hashPassword(PASS), totp: secret, tokenVersion: 0 }]));
  return secret;
}

/**
 * Starts `node [nodeArgs] dist/server/entry.mjs` in `cwd` with only the given env (plus PATH/SYSTEMROOT so Windows works).
 * rss: true preloads rss-probe.mjs. Resolves once the port answers HTTP (any status), unless wait is false.
 */
export async function start({ cwd = PANEL, env = {}, nodeArgs = [], rss = false, wait = true, port } = {}) {
  port ??= await freePort();
  const rssFile = rss ? join(env.DATA_DIR ? join(env.DATA_DIR, '..') : tmpdir(), `rss-${port}.log`) : null;
  const args = [...(rss ? ['--import', pathToFileURL(join(PANEL, 'test', 'ops', 'rss-probe.mjs')).href] : []), ...nodeArgs, 'dist/server/entry.mjs'];
  const base = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP };
  const proc = spawn(process.execPath, args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...base, HOST: '127.0.0.1', PORT: String(port), ...(rssFile ? { RSS_PROBE_FILE: rssFile } : {}), ...env },
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => proc.once('exit', (code, signal) => r({ code, signal })));
  const srv = { proc, port, base: `http://127.0.0.1:${port}`, rssFile, exited, log: () => out.replace(/\x1b\[[0-9;]*m/g, '') };
  srv.stop = async () => { if (proc.exitCode === null && proc.signalCode === null) { proc.kill(); await exited; } };
  if (wait) {
    const end = Date.now() + 30_000;
    for (;;) {
      if (proc.exitCode !== null) throw new Error(`server exited (${proc.exitCode}) before listening:\n${srv.log()}`);
      try { await fetch(`${srv.base}/theme-init.js`); break; } catch { /* not yet */ }
      if (Date.now() > end) { await srv.stop(); throw new Error(`server did not start:\n${srv.log()}`); }
      await sleep(100);
    }
  }
  return srv;
}

/** Peak memory while `fn` runs, compared with the idle value just before it (bytes). */
export async function rssDuring(srv, fn) {
  const read = async () => (await readFile(srv.rssFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => l.split(' ').map(Number));
  await sleep(400);
  const t0 = Date.now(), before = (await read()).filter((s) => s[0] <= t0).slice(-3);
  const result = await fn();
  await sleep(300);
  const during = (await read()).filter((s) => s[0] >= t0);
  const idle = Math.max(...before.map((s) => s[1]));
  const peak = Math.max(...during.map((s) => s[1]));
  return { result, idle, peak, growth: peak - idle, heapPeak: Math.max(...during.map((s) => s[2])), abPeak: Math.max(...during.map((s) => s[4])), samples: during.length };
}

/** A cookie-keeping client for one user. headers are added to every request (e.g. PROXY). */
export function client(srv, totpSecret, headers = {}) {
  const jar = {};
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (setCookies) => { for (const c of setCookies) { const [kv, ...attrs] = c.split('; '); const i = kv.indexOf('='); if (/Max-Age=0/i.test(attrs.join(';'))) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); } };
  const call = async (path, opt = {}) => {
    const r = await fetch(srv.base + path, { redirect: 'manual', ...opt, headers: { ...headers, ...(opt.headers || {}), Cookie: cookie() } });
    keep(r.headers.getSetCookie());
    return r;
  };
  const c = {
    jar, call, cookie,
    login: (over = {}) => call('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: EMAIL, password: PASS, code: totp(totpSecret), ...over }) }),
    csrf: async () => (await (await call('/')).text()).match(/name="_csrf" value="([^"]+)"/)?.[1],
    /** Streams a multipart body over a raw http.request (no buffering). opt: { headers, bytesPerSec, abortAfter, onProgress } */
    upload: (path, fields, file, opt = {}) => streamMultipart(srv, path, fields, file, { ...opt, headers: { ...headers, ...(opt.headers || {}), Cookie: cookie() } }).then((r) => { keep(r.setCookies); return r; }),
  };
  return c;
}

/**
 * A valid store-only zip of about `total` bytes, as { size, entries, chunks() }: `entries` files of incompressible data
 * (one random MiB repeated), with real CRCs. chunks() yields it in 1 MiB pieces; nothing big is ever held in memory.
 */
export function bigZip(total, entries = 25) {
  const block = randomBytes(MB), names = Array.from({ length: entries }, (_, i) => Buffer.from(`implants/part-${String(i).padStart(3, '0')}.stl`));
  const overhead = names.reduce((n, b) => n + 30 + b.length + 46 + b.length, 22);
  const len = Math.floor((total - overhead) / entries);
  let crc = 0; for (let left = len; left > 0; left -= MB) crc = crc32(left >= MB ? block : block.subarray(0, left), crc);
  const size = overhead + len * entries;
  async function* chunks() {
    const central = []; let offset = 0;
    for (const n of names) {
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(len, 18); lh.writeUInt32LE(len, 22); lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(len, 20); ch.writeUInt32LE(len, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
      central.push(ch, n); offset += 30 + n.length + len;
      yield Buffer.concat([lh, n]);
      for (let left = len; left > 0; left -= MB) yield left >= MB ? block : block.subarray(0, left);
    }
    const cd = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries, 8); end.writeUInt16LE(entries, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    yield Buffer.concat([cd, end]);
  }
  return { size, entries, chunks };
}

/** file: { name, filename, size, chunks() } (e.g. bigZip(...) plus name/filename). Resolves { status, headers, setCookies, body, sent, error }. */
export function streamMultipart(srv, path, fields, file, { headers = {}, bytesPerSec = 0, abortAfter = Infinity, onProgress } = {}) {
  const B = `----ops${randomBytes(8).toString('hex')}`;
  const head = Buffer.concat([
    ...Object.entries(fields).map(([k, v]) => Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)),
    Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
  ]);
  const tail = Buffer.from(`\r\n--${B}--\r\n`);
  const length = head.length + file.size + tail.length;
  return new Promise((resolve) => {
    let sent = 0, settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve({ sent, ...r }); } };
    const req = http.request(srv.base + path, { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': length } }, async (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (d) => { body += d; });
      res.on('error', (e) => finish({ status: res.statusCode, error: e.code || e.message, body }));
      res.on('end', () => finish({ status: res.statusCode, headers: res.headers, setCookies: [].concat(res.headers['set-cookie'] || []), body }));
    });
    req.on('error', (e) => finish({ status: null, error: e.code || e.message, setCookies: [] }));
    (async () => {
      const t0 = Date.now();
      const write = async (buf) => {
        if (sent + buf.length > abortAfter) { req.destroy(); throw new Error('aborted by test'); }
        if (!req.write(buf)) await new Promise((r) => { const go = () => { req.off('drain', go); req.off('close', go); r(); }; req.on('drain', go); req.on('close', go); });
        sent += buf.length; onProgress?.(sent, length);
        if (bytesPerSec) { const wait = (sent / bytesPerSec) * 1000 - (Date.now() - t0); if (wait > 0) await sleep(wait); }
        if (req.destroyed) throw new Error('request closed');
      };
      try {
        await write(head);
        for await (const c of file.chunks()) {
          if (!bytesPerSec) { await write(c); continue; }
          for (let i = 0; i < c.length; i += 64 * 1024) await write(c.subarray(i, i + 64 * 1024)); // small pieces keep the rate smooth
        }
        await write(tail); req.end();
      } catch (e) { if (!settled && e.message === 'aborted by test') finish({ status: null, error: 'aborted by test', setCookies: [] }); }
    })();
  });
}

export const listTmp = (dirs) => readdir(join(dirs.data, 'tmp')).catch(() => []);
/** The signed notice (edp_flash) a response set, decoded: { type, key, title, text, ... } or null. */
export const flashOf = (setCookies = []) => {
  const c = [].concat(setCookies).find((x) => x.startsWith('edp_flash=') && !/Max-Age=0/.test(x));
  return c ? verify(c.split(';')[0].slice(10), SECRET) : null;
};
