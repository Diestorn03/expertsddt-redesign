// Fixtures shared by the core and end-to-end tests.
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { verify } from '../lib/auth.mjs';
export function makeZip(entries) { // store-only zip writer, enough for fixtures
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
export const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#0b7a43' } }).png().toBuffer();
export const SECRET = 'x'.repeat(40);
sharp.cache(false); // do not keep files open (Windows cannot delete them)
export const MB = 1048576;
export const enc = new TextEncoder();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(check, ms = 5000) { const end = Date.now() + ms; while (!(await check())) { if (Date.now() > end) throw new Error('timed out waiting'); await sleep(20); } }
export const mp4 = (brand = 'isom') => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(64)]);
export const lib = (n) => new Blob([makeZip(Array.from({ length: n }, (_, i) => ({ name: `lib/part${i}.stl`, data: Buffer.from('solid x') })))]);
/** The signed notice (edp_flash) set by a response, decoded: what the page will show. */
export const notice = (setCookies) => { const c = [].concat(setCookies).find((x) => x.startsWith('edp_flash=') && !/Max-Age=0/.test(x)); return c ? verify(c.split(';')[0].slice(10), SECRET) : null; };
/** A multipart body written by hand, as a browser sends it: parts are [name, value, filename?]. */
export const multipart = (B, parts) => Buffer.concat([...parts.flatMap(([n, v, file]) => [Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${n}"${file === undefined ? '' : `; filename="${file}"\r\nContent-Type: application/octet-stream`}\r\n\r\n`), Buffer.from(v), Buffer.from('\r\n')]), Buffer.from(`--${B}--\r\n`)]);
export const ZIP_ENGLISH = /not a valid|end record|zip64 archives|not supported|too many files|corrupt central|unsafe paths|uncompressed size/i; // the old inspectZip reasons
export const ENGLISH = new RegExp(`${ZIP_ENGLISH.source}|\\b(the|is|file|files|invalid|error|failed|too)\\b`, 'i');

