// File validation and safe placement. Nothing here trusts a client-supplied name or content type.
import { open, rename, mkdir, copyFile, stat, unlink, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, basename, join, resolve, sep } from 'node:path';

const HEIF = /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/; // ISO-BMFF images: an iPhone photo is not a video

/**
 * Real type from the first bytes: { type: 'webp'|'png'|'jpg'|'mp4'|'heif'|'pdf'|'zip'|null, brand }.
 * brand is the ftyp major brand (bytes 8-12) of ISO-BMFF files, e.g. 'isom', or 'qt  ' for an iPhone MOV; null otherwise.
 */
export async function sniff(path) {
  const fh = await open(path, 'r');
  try {
    const b = Buffer.alloc(16); await fh.read(b, 0, 16, 0);
    const is = (type) => ({ type, brand: null });
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return is('webp');
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return is('png');
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return is('jpg');
    if (b.toString('latin1', 4, 8) === 'ftyp') { const brand = b.toString('latin1', 8, 12); return { type: HEIF.test(brand) ? 'heif' : 'mp4', brand }; }
    if (b.toString('latin1', 0, 5) === '%PDF-') return is('pdf');
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return is('zip');
    return is(null);
  } finally { await fh.close(); }
}

/** { width, height } of a webp/png/jpg, or null if the header is not understood. */
export async function imageSize(path, type) {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(65536); const { bytesRead } = await fh.read(head, 0, head.length, 0); const b = head.subarray(0, bytesRead);
    if (type === 'png') return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
    if (type === 'webp') {
      const kind = b.toString('latin1', 12, 16);
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L' && b[20] === 0x2f) { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
      return null;
    }
    if (type === 'jpg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
    return null;
  } finally { await fh.close(); }
}

/**
 * Reads a zip's central directory without extracting it. Limits protect against zip bombs and path tricks.
 * Returns { ok: true, entries, uncompressed } or { ok: false, code, detail? } with code 'no_eocd' | 'zip64' | 'too_many' (detail = entries)
 * | 'corrupt' | 'unsafe_path' (detail = the first bad name) | 'too_big'. The words shown to people live in panel.mjs, in Spanish.
 */
export async function inspectZip(path, { maxEntries = 5000, maxUncompressed = 1024 ** 3 } = {}) {
  const size = (await stat(path)).size;
  const fh = await open(path, 'r');
  try {
    const tailLen = Math.min(size, 65557); const tail = Buffer.alloc(tailLen); await fh.read(tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0 || eocd + 22 > tail.length) return { ok: false, code: 'no_eocd' };
    const entries = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, code: 'zip64' };
    if (entries > maxEntries) return { ok: false, code: 'too_many', detail: entries };
    if (cdSize > 4 * 1024 * 1024 || cdOffset + cdSize > size) return { ok: false, code: 'corrupt' };
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdOffset);
    let p = 0, total = 0, files = 0; const unsafe = [];
    for (let n = 0; n < entries; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) return { ok: false, code: 'corrupt' };
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      if (csize === 0xffffffff || usize === 0xffffffff || cd.readUInt32LE(p + 42) === 0xffffffff) return { ok: false, code: 'zip64' }; // per-entry zip64
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      total += usize; if (!name.endsWith('/')) files++;
      if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /^[A-Za-z]:/.test(name)) unsafe.push(name);
      p += 46 + nlen + xlen + clen;
    }
    if (unsafe.length) return { ok: false, code: 'unsafe_path', detail: unsafe[0] };
    if (total > maxUncompressed) return { ok: false, code: 'too_big' };
    return { ok: true, entries: files, uncompressed: total };
  } finally { await fh.close(); }
}

export function sha256File(path) {
  return new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}

/** Resolve a site-relative path inside root; throws on anything that could escape it. */
export function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(rel) || rel.split('/').includes('..')) throw new Error('invalid path');
  const full = resolve(root, rel);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) throw new Error('path escapes root');
  return full;
}

/** A backup name '2026-11-07T19-40-10-123Z__team.webp' → { ts (ms), name: 'team.webp' }, or null for anything else. */
export function parseBackup(file) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z__(.+)$/.exec(String(file));
  return m ? { ts: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`), name: m[6] } : null;
}

/**
 * Atomically replaces dest with the already-validated file at src, keeping the previous version in backupDir
 * and only the `keep` most recent backups of that file name.
 */
export async function placeFile(src, dest, backupDir, keep = 10) {
  await mkdir(dirname(dest), { recursive: true });
  let backup = null;
  try {
    await stat(dest);
    await mkdir(backupDir, { recursive: true });
    backup = join(backupDir, `${new Date().toISOString().replace(/[:.]/g, '-')}__${basename(dest)}`);
    await copyFile(dest, backup);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = join(dirname(dest), `.${randomBytes(8).toString('hex')}.tmp`); // dotfile: never served
  await copyFile(src, tmp);
  await rename(tmp, dest);
  await unlink(src).catch(() => {});
  if (backup) { // ponytail: a cap by count; switch to a cap by bytes if the disk gets tight
    const old = (await readdir(backupDir)).filter((f) => parseBackup(f)?.name === basename(dest)).sort().reverse().slice(keep);
    await Promise.all(old.map((f) => unlink(join(backupDir, f)).catch(() => {})));
  }
  return { backup };
}
