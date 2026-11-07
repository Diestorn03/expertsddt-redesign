/**
 * Stored ZIP writer (method 0): CRC-32, UTF-8 names (flag 0x0800), fixed DOS date 1980-01-01 00:00,
 * no extra fields, no comments, no data descriptors, no ZIP64. Names and the total size are checked
 * before anything is allocated.
 *
 * Throws:
 * - EXPORT_NAME_INVALID {index}: empty, > 255 UTF-8 bytes, `/ \ : * ? " < > |`, control character or
 *   lone surrogate, `..`, trailing dot or space, Windows device name (CON, COM1.txt...), or a
 *   duplicate ignoring case and Unicode normalisation. Every accepted name extracts as a plain file
 *   on Windows, macOS and Linux.
 * - EXPORT_TOO_LARGE {limitBytes, bytes} above LIMITS.bundle.maxBytes, or {reason: 'entries', limit, count}.
 * - INVALID_ARGUMENT {reason: 'fallback'} from safeFilename when neither label nor fallback leaves a name.
 */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';

export interface BundleFile {
  name: string;
  bytes: Uint8Array;
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_RECORD = 22;
/** 0xFFFF in the end record means "look for ZIP64", so the last unambiguous count is one less. */
const MAX_ENTRIES = 0xfffe;
const MAX_NAME_BYTES = 255;
/** Version 2.0 for "made by" (MS-DOS host, attributes all zero) and "needed to extract". */
const VERSION = 20;
const FLAG_UTF8 = 0x0800;
const DOS_DATE_1980_01_01 = (1 << 5) | 1; // year 0 (1980), month 1, day 1; the time field stays 0

const FORBIDDEN_CHARACTER = /[\/\\:*?"<>|\p{Cc}\p{Cs}]/u;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const utf8 = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-32 (IEEE, as in ZIP and PNG). Pass a previous result as `crc` to continue over another chunk. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  // ponytail: byte-wise table, ~440 MB/s on the dev PC; slice-by-8 is ~1.6x faster if export time matters.
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * Validates names and counts and returns the exact byte size zipStore will produce for entries of
 * these data sizes. Allocates nothing large: callers use it to refuse a bundle before building it.
 */
export function zipStoreSize(entries: readonly { name: string; size: number }[]): number {
  if (entries.length > MAX_ENTRIES) {
    throw new XchangeError('EXPORT_TOO_LARGE', { reason: 'entries', limit: MAX_ENTRIES, count: entries.length });
  }
  const seen = new Set<string>();
  let total = END_RECORD;
  entries.forEach(({ name, size }, index) => {
    const nameBytes = utf8.encode(name).length;
    const key = name.normalize('NFC').toLowerCase();
    if (
      nameBytes === 0 ||
      nameBytes > MAX_NAME_BYTES ||
      FORBIDDEN_CHARACTER.test(name) ||
      name.includes('..') ||
      /[. ]$/.test(name) ||
      WINDOWS_DEVICE_NAME.test(name) ||
      seen.has(key)
    ) {
      throw new XchangeError('EXPORT_NAME_INVALID', { index });
    }
    seen.add(key);
    total += LOCAL_HEADER + CENTRAL_HEADER + 2 * nameBytes + size;
  });
  if (total > LIMITS.bundle.maxBytes) {
    throw new XchangeError('EXPORT_TOO_LARGE', { limitBytes: LIMITS.bundle.maxBytes, bytes: total });
  }
  return total;
}

/** The fields local and central headers share, from "version needed" to "extra field length" (26 bytes). */
function writeSharedFields(view: DataView, at: number, crc: number, size: number, nameLength: number): void {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 2, FLAG_UTF8, true);
  // at + 4: method 0 (stored); at + 6: time 00:00. Both stay zero.
  view.setUint16(at + 8, DOS_DATE_1980_01_01, true);
  view.setUint32(at + 10, crc, true);
  view.setUint32(at + 14, size, true); // compressed size
  view.setUint32(at + 18, size, true); // uncompressed size
  view.setUint16(at + 22, nameLength, true);
  // at + 24: extra field length 0.
}

/** Stored (method 0) ZIP of `files` in order. */
export function zipStore(files: readonly BundleFile[]): Uint8Array {
  const out = new Uint8Array(zipStoreSize(files.map((f) => ({ name: f.name, size: f.bytes.length }))));
  const view = new DataView(out.buffer);
  let o = 0;
  const records = files.map(({ name, bytes }) => {
    const record = { name: utf8.encode(name), crc: crc32(bytes), size: bytes.length, offset: o };
    view.setUint32(o, 0x04034b50, true);
    writeSharedFields(view, o + 4, record.crc, record.size, record.name.length);
    out.set(record.name, o + LOCAL_HEADER);
    out.set(bytes, o + LOCAL_HEADER + record.name.length);
    o += LOCAL_HEADER + record.name.length + bytes.length;
    return record;
  });
  const centralStart = o;
  for (const r of records) {
    view.setUint32(o, 0x02014b50, true);
    view.setUint16(o + 4, VERSION, true);
    writeSharedFields(view, o + 6, r.crc, r.size, r.name.length);
    // o + 32..41: comment length, disk number, internal and external attributes, all zero.
    view.setUint32(o + 42, r.offset, true);
    out.set(r.name, o + CENTRAL_HEADER);
    o += CENTRAL_HEADER + r.name.length;
  }
  view.setUint32(o, 0x06054b50, true);
  // o + 4, o + 6: disk numbers 0.
  view.setUint16(o + 8, records.length, true);
  view.setUint16(o + 10, records.length, true);
  view.setUint32(o + 12, o - centralStart, true);
  view.setUint32(o + 16, centralStart, true);
  // o + 20: comment length 0.
  return out;
}

/** Views into `zip` = zipStore(files) over each entry's stored bytes, in order (no copy). */
export function entryViews(zip: Uint8Array, files: readonly BundleFile[]): BundleFile[] {
  let o = 0;
  return files.map(({ name, bytes }) => {
    const start = o + LOCAL_HEADER + utf8.encode(name).length;
    o = start + bytes.length;
    return { name, bytes: zip.subarray(start, o) };
  });
}

/**
 * Entry-name part from a label: NFKD, diacritics removed, runs outside [A-Za-z0-9._-] -> '_', dot runs
 * collapsed, trimmed of [._-], <= 64 chars, Windows device names prefixed '_'. Empty -> the same
 * treatment of `fallback`.
 */
export function safeFilename(label: string, fallback: string): string {
  const clean = (text: string): string =>
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+/, '')
      .slice(0, 64)
      .replace(/[._-]+$/, '');
  const name = clean(label) || clean(fallback);
  if (!name) throw new XchangeError('INVALID_ARGUMENT', { reason: 'fallback' });
  // Checked after truncation: 'CON_-_-...X' cut at 64 chars would otherwise come back as 'CON'.
  return WINDOWS_DEVICE_NAME.test(name) ? `_${name.slice(0, 63)}`.replace(/[._-]+$/, '') : name;
}
