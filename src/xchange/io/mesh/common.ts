/**
 * Internals shared by the STL, PLY and OBJ readers: size checks, a byte tokenizer (no file-sized
 * string, no array of numbers), strict decimal parsing, the triangle sink (drops triangles with a
 * repeated vertex, triangulates polygons) and the final assembly.
 *
 * Error details thrown here: FILE_EMPTY; FILE_TOO_LARGE {limitBytes, bytes}; TEXT_ENCODING {reason: 'nul'};
 * NUMBER_INVALID / COORDINATE_OUT_OF_RANGE {...caller details}; TOO_MANY_TRIANGLES {limit};
 * MESH_EMPTY {dropped}.
 */
import { XchangeError, type ErrorDetails, type XchangeWarning } from '../../core/errors';
import { MAX_ABS_COORDINATE_MM, PARSE_LIMITS } from '../../core/limits';
import type { MeshFormat, TriMesh } from '../../core/types';
import type { MeshParseLimits, ParsedMesh } from './index';

export function checkSize(bytes: Uint8Array, limits: MeshParseLimits): void {
  if (bytes.byteLength === 0) throw new XchangeError('FILE_EMPTY');
  if (bytes.byteLength > limits.maxBytes) {
    throw new XchangeError('FILE_TOO_LARGE', { limitBytes: limits.maxBytes, bytes: bytes.byteLength });
  }
}

/** Callers test `!(Math.abs(v) <= MAX_ABS_COORDINATE_MM)` (also true for NaN) and throw this. */
export function coordinateError(value: number, details: ErrorDetails): XchangeError {
  return Number.isFinite(value)
    ? new XchangeError('COORDINATE_OUT_OF_RANGE', { ...details, limitMm: MAX_ABS_COORDINATE_MM })
    : new XchangeError('NUMBER_INVALID', details);
}

export const nulError = (): XchangeError => new XchangeError('TEXT_ENCODING', { reason: 'nul' });

export const ascii = (word: string): Uint8Array => new TextEncoder().encode(word);

function latin1(b: Uint8Array, s: number, e: number): string {
  let out = '';
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i]!);
  return out;
}

const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];

/**
 * Strict decimal `[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?` in b[s, e); NaN when malformed (also for
 * "nan", "inf", "1,5", hex). Up to 15 significant digits and |exponent| <= 22 the value equals
 * Number(): one correctly rounded operation on exact doubles (Clinger's fast path).
 * ponytail: 16-40 digits (full-precision exporters) accumulate in a double, a few ulps off, so the
 * float32 the meshes store is exact except within ~1e-15 of a float32 rounding midpoint (then 1 ulp,
 * nanometres); a correctly rounded parser (Eisel-Lemire) only if float64 output is ever needed.
 */
export function parseDecimal(b: Uint8Array, s: number, e: number): number {
  let i = s;
  let neg = false;
  if (i < e && (b[i] === 0x2d || b[i] === 0x2b)) neg = b[i++] === 0x2d;
  let mant = 0, sig = 0, scale = 0, digits = 0, d = 0;
  while (i < e && (d = b[i]! - 0x30) >= 0 && d <= 9) {
    digits++;
    i++;
    if (mant === 0 && d === 0) continue; // leading zero
    mant = mant * 10 + d;
    sig++;
  }
  if (i < e && b[i] === 0x2e) {
    i++;
    while (i < e && (d = b[i]! - 0x30) >= 0 && d <= 9) {
      digits++;
      i++;
      scale--;
      if (mant === 0 && d === 0) continue;
      mant = mant * 10 + d;
      sig++;
    }
  }
  if (digits === 0) return NaN;
  if (i < e && (b[i] === 0x65 || b[i] === 0x45)) {
    i++;
    let eneg = false;
    if (i < e && (b[i] === 0x2d || b[i] === 0x2b)) eneg = b[i++] === 0x2d;
    let ex = 0, ed = 0;
    while (i < e && (d = b[i]! - 0x30) >= 0 && d <= 9) {
      if (ex < 1e6) ex = ex * 10 + d;
      ed++;
      i++;
    }
    if (ed === 0) return NaN;
    scale += eneg ? -ex : ex;
  }
  if (i !== e) return NaN;
  let v: number;
  if (mant === 0) v = 0;
  else if (sig > 40 || scale > 22 || scale < -22) return Number(latin1(b, s, e)); // token already validated
  else v = scale >= 0 ? mant * POW10[scale]! : mant / POW10[-scale]!;
  return neg ? -v : v;
}

/** Strict `[+-]?\d+` in b[s, e); NaN when malformed. Beyond 2^53 the value is approximate (always out of range). */
export function parseInteger(b: Uint8Array, s: number, e: number): number {
  let i = s;
  let neg = false;
  if (i < e && (b[i] === 0x2d || b[i] === 0x2b)) neg = b[i++] === 0x2d;
  if (i === e) return NaN;
  let v = 0;
  for (; i < e; i++) {
    const d = b[i]! - 0x30;
    if (d < 0 || d > 9) return NaN;
    v = v * 10 + d;
  }
  return neg ? -v : v;
}

/**
 * Whitespace tokenizer over bytes. The current token is bytes[start, end). NUL anywhere it looks
 * throws TEXT_ENCODING; other bytes, UTF-8 included, are opaque (only ignored text such as names and
 * comments may hold them, so they are never decoded).
 */
export class Cursor {
  readonly bytes: Uint8Array;
  readonly limit: number;
  pos: number;
  line: number;
  start = 0;
  end = 0;

  constructor(bytes: Uint8Array, from = 0, limit = bytes.length, line = 1) {
    this.bytes = bytes;
    this.limit = limit;
    // UTF-8 BOM at the start of a text file.
    this.pos = from === 0 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : from;
    this.line = line;
  }

  /** Next token, crossing newlines. False at the limit. */
  next(): boolean {
    const b = this.bytes, lim = this.limit;
    let p = this.pos;
    for (; p < lim; p++) {
      const c = b[p]!;
      if (c === 0x0a) this.line++;
      else if (c !== 0x20 && (c < 0x09 || c > 0x0d)) break;
    }
    this.pos = p;
    if (p >= lim) return false;
    this.start = p;
    this.end = this.pos = this.scan(p, false);
    return true;
  }

  /**
   * Next token of the current record (OBJ): `\` before a newline continues the record, `#` starts a
   * comment. False at the end of the record; the newline is not consumed (call skipLine()).
   */
  nextInLine(): boolean {
    const b = this.bytes, lim = this.limit;
    let p = this.pos;
    while (p < lim) {
      const c = b[p]!;
      const q = c === 0x5c ? this.continuation(p + 1) : -1;
      if (c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0b || c === 0x0c) p++;
      else if (q >= 0) {
        p = q;
        this.line++;
      } else if (c === 0x0a || c === 0x23) break;
      else {
        this.start = p;
        this.end = this.pos = this.scan(p, true);
        return true;
      }
    }
    this.pos = p;
    return false;
  }

  /** Skips past the next newline. */
  skipLine(): void {
    const b = this.bytes, lim = this.limit;
    let p = this.pos;
    while (p < lim) {
      const c = b[p++]!;
      if (c === 0x0a) {
        this.line++;
        break;
      }
      if (c === 0) throw nulError();
    }
    this.pos = p;
  }

  /** Case-insensitive match of the current token against a lower-case ASCII word. */
  is(word: Uint8Array): boolean {
    const n = word.length, b = this.bytes, s = this.start;
    if (this.end - s !== n) return false;
    for (let i = 0; i < n; i++) if ((b[s + i]! | 0x20) !== word[i]) return false;
    return true;
  }

  number(): number {
    return parseDecimal(this.bytes, this.start, this.end);
  }

  integer(): number {
    return parseInteger(this.bytes, this.start, this.end);
  }

  /** The current token as a string (short keywords only). */
  text(): string {
    return latin1(this.bytes, this.start, this.end);
  }

  private scan(p: number, lineMode: boolean): number {
    const b = this.bytes, lim = this.limit;
    for (; p < lim; p++) {
      const c = b[p]!;
      if (c <= 0x20) {
        if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) break;
        if (c === 0) throw nulError();
      } else if (lineMode && c === 0x5c && this.continuation(p + 1) >= 0) break;
    }
    return p;
  }

  /** Index just after the newline that starts at q (\n or \r\n, or the limit), else -1. */
  private continuation(q: number): number {
    const b = this.bytes;
    if (q >= this.limit) return this.limit;
    if (b[q] === 0x0a) return q + 1;
    return b[q] === 0x0d && b[q + 1] === 0x0a && q + 1 < this.limit ? q + 2 : -1;
  }
}

/** Copy into a typed array of the same kind with room for `needed` elements (doubling, at most `cap`). */
export function grow<T extends Float32Array | Uint32Array | Uint8Array>(array: T, needed: number, cap = Infinity): T {
  const size = Math.max(needed, Math.min(cap, Math.max(1024, 2 * array.length)));
  const out = new (array.constructor as new (length: number) => T)(size);
  out.set(array);
  return out;
}

const MAX_CORNERS = PARSE_LIMITS.maxPolygonCorners;

/**
 * Collects triangles: drops (and counts) those with a repeated vertex index, enforces maxTriangles
 * (dropped ones included, like an STL's declared count) and triangulates polygons: fan when convex,
 * ear clipping in the polygon's best-fit plane otherwise, so no face is flipped.
 */
export class TriangleSink {
  indices: Uint32Array;
  count = 0;
  dropped = 0;
  private emitted = 0;
  private readonly maxTriangles: number;
  private readonly x = new Float64Array(MAX_CORNERS);
  private readonly y = new Float64Array(MAX_CORNERS);
  private readonly prev = new Int32Array(MAX_CORNERS);
  private readonly next = new Int32Array(MAX_CORNERS);

  constructor(expected: number, maxTriangles: number) {
    this.maxTriangles = maxTriangles;
    this.indices = new Uint32Array(3 * Math.max(64, Math.min(expected, maxTriangles)));
  }

  push(a: number, b: number, c: number): void {
    if (++this.emitted > this.maxTriangles) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: this.maxTriangles });
    if (a === b || b === c || a === c) {
      this.dropped++;
      return;
    }
    const o = 3 * this.count++;
    if (o + 3 > this.indices.length) this.indices = grow(this.indices, o + 3, 3 * this.maxTriangles);
    const t = this.indices;
    t[o] = a;
    t[o + 1] = b;
    t[o + 2] = c;
  }

  /**
   * Polygon corners[0..n) (vertex indices; the array is modified). n < 3 counts as one dropped face.
   * positions null (vertices not read yet) -> fan.
   */
  polygon(corners: Uint32Array, n: number, positions: Float32Array | null): void {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const v = corners[i]!;
      if (m === 0 || corners[m - 1] !== v) corners[m++] = v;
    }
    while (m > 1 && corners[m - 1] === corners[0]) m--;
    if (m < 3) return this.skip(Math.max(n - 2, 1));
    if (m < n) this.skip(n - m); // each repeated corner is one triangle less
    if (m > 3 && positions && this.project(corners, m, positions) && !this.convex(m)) return this.earClip(corners, m);
    for (let i = 1; i + 1 < m; i++) this.push(corners[0]!, corners[i]!, corners[i + 1]!);
  }

  result(): Uint32Array {
    return 3 * this.count === this.indices.length ? this.indices : this.indices.slice(0, 3 * this.count);
  }

  private skip(k: number): void {
    this.emitted += k;
    if (this.emitted > this.maxTriangles) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: this.maxTriangles });
    this.dropped += k;
  }

  /** 2D coordinates in the plane of the Newell normal, counter-clockwise. False if the polygon has no area. */
  private project(c: Uint32Array, m: number, p: Float32Array): boolean {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const a = 3 * c[j]!, b = 3 * c[i]!;
      nx += (p[a + 1]! - p[b + 1]!) * (p[a + 2]! + p[b + 2]!);
      ny += (p[a + 2]! - p[b + 2]!) * (p[a]! + p[b]!);
      nz += (p[a]! - p[b]!) * (p[a + 1]! + p[b + 1]!);
    }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (!(ax + ay + az > 0)) return false;
    // Drop the dominant axis; (y,z), (z,x), (x,y) keep the orientation of nx, ny, nz.
    let u = 0, v = 1, sign = nz;
    if (ax > az && ax >= ay) {
      u = 1;
      v = 2;
      sign = nx;
    } else if (ay > az && ay > ax) {
      u = 2;
      v = 0;
      sign = ny;
    }
    const s = sign > 0 ? 1 : -1;
    for (let i = 0; i < m; i++) {
      const o = 3 * c[i]!;
      this.x[i] = p[o + u]!;
      this.y[i] = s * p[o + v]!;
    }
    return true;
  }

  private convex(m: number): boolean {
    const x = this.x, y = this.y;
    for (let i = 0; i < m; i++) {
      const a = i === 0 ? m - 1 : i - 1, b = i === m - 1 ? 0 : i + 1;
      if ((x[i]! - x[a]!) * (y[b]! - y[i]!) - (y[i]! - y[a]!) * (x[b]! - x[i]!) < 0) return false;
    }
    return true;
  }

  private earClip(c: Uint32Array, m: number): void {
    const prev = this.prev, next = this.next;
    for (let i = 0; i < m; i++) {
      prev[i] = i === 0 ? m - 1 : i - 1;
      next[i] = i === m - 1 ? 0 : i + 1;
    }
    let left = m, i = 0, misses = 0;
    while (left > 3) {
      const a = prev[i]!, b = next[i]!;
      if (this.isEar(a, i, b)) {
        this.push(c[a]!, c[i]!, c[b]!);
        next[a] = b;
        prev[b] = a;
        left--;
        misses = 0;
        i = b;
      } else if (++misses > left) {
        break; // ponytail: self-intersecting outline, no ear left: fan the rest instead of repairing it
      } else i = b;
    }
    const first = i;
    for (let j = next[first]!; next[j] !== first; j = next[j]!) this.push(c[first]!, c[j]!, c[next[j]!]!);
  }

  /** Convex corner whose triangle holds no other remaining corner (edges inclusive). */
  private isEar(a: number, i: number, b: number): boolean {
    const x = this.x, y = this.y;
    const ax = x[a]!, ay = y[a]!, bx = x[i]!, by = y[i]!, cx = x[b]!, cy = y[b]!;
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return false;
    for (let p = this.next[b]!; p !== a; p = this.next[p]!) {
      const px = x[p]!, py = y[p]!;
      if (
        (bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0 &&
        (cx - bx) * (py - by) - (cy - by) * (px - bx) >= 0 &&
        (ax - cx) * (py - cy) - (ay - cy) * (px - cx) >= 0
      ) return false;
    }
    return true;
  }
}

/** MESH_EMPTY when no triangle survived; the dropped-triangle warning goes first. */
export function finish(
  format: MeshFormat,
  positions: Float32Array,
  indices: Uint32Array,
  dropped: number,
  colors: Uint8Array | undefined,
  warnings: XchangeWarning[] = [],
): ParsedMesh {
  if (indices.length === 0) throw new XchangeError('MESH_EMPTY', { dropped });
  if (dropped > 0) warnings.unshift({ code: 'MESH_DEGENERATE_TRIANGLES_DROPPED', details: { count: dropped } });
  const mesh: TriMesh = colors ? { positions, indices, colors } : { positions, indices };
  return { mesh, format, warnings };
}
