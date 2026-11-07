/**
 * STL reader. Binary when the size is exactly 84 + 50·n bytes, whatever the header says ("solid"
 * too); otherwise ASCII, one or several `solid` blocks, keywords case-insensitive. File normals and
 * attribute bytes are ignored. Output is indexed: bit-identical corners share a vertex (+0 = -0, no
 * tolerance; geometry/weld does tolerances).
 *
 * Error details: TOO_MANY_TRIANGLES {limit, count?}; MESH_TRUNCATED {bytes, expectedBytes} (binary) or
 * {line} (ASCII); MESH_MALFORMED {format: 'stl', reason, line}, reason one of expectedSolid,
 * expectedFacet, expectedNormal, expectedOuter, expectedLoop, expectedVertex, expectedEndloop,
 * expectedEndfacet; NUMBER_INVALID / COORDINATE_OUT_OF_RANGE {triangle} (binary) or {line} (ASCII).
 */
import { XchangeError, type XchangeWarning } from '../../core/errors';
import { MAX_ABS_COORDINATE_MM } from '../../core/limits';
import { ascii, checkSize, coordinateError, Cursor, finish } from './common';
import type { MeshParseLimits, ParsedMesh } from './index';

const SOLID = ascii('solid');
const ENDSOLID = ascii('endsolid');
const FACET = ascii('facet');
const NORMAL = ascii('normal');
const OUTER = ascii('outer');
const LOOP = ascii('loop');
const VERTEX = ascii('vertex');
const ENDLOOP = ascii('endloop');
const ENDFACET = ascii('endfacet');

/** 21 tokens of `facet normal a b c outer loop 3×(vertex x y z) endloop endfacet`, 65 chars, 21 separators. */
const MIN_FACET_BYTES = 86;

/** Float32 bit pattern of MAX_ABS_COORDINATE_MM: |v| <= max iff (bits & 0x7fffffff) <= this (NaN/Inf are above). */
const MAX_BITS = new Uint32Array(Float32Array.of(MAX_ABS_COORDINATE_MM).buffer)[0]!;

const declaredCount = (b: Uint8Array): number => (b[80]! | (b[81]! << 8) | (b[82]! << 16) | (b[83]! << 24)) >>> 0;

export function isBinarySTL(bytes: Uint8Array): boolean {
  return bytes.length >= 84 && 84 + 50 * declaredCount(bytes) === bytes.length;
}

/** First token `solid`, and `facet` starts the next line. */
export function looksAsciiSTL(bytes: Uint8Array, windowBytes: number): boolean {
  try {
    const cur = new Cursor(bytes, 0, windowBytes);
    if (!cur.next() || !cur.is(SOLID)) return false;
    cur.skipLine();
    return cur.next() && cur.is(FACET);
  } catch {
    return false; // NUL: not text
  }
}

export function parseSTL(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh {
  checkSize(bytes, limits);
  if (isBinarySTL(bytes)) return parseBinary(bytes, declaredCount(bytes), limits);
  // A truncated binary file whose header says "solid" still has NUL bytes near the start.
  const head = bytes.subarray(0, 1024);
  if (!head.includes(0)) {
    const cur = new Cursor(head);
    if (cur.next() && cur.is(SOLID)) return parseAscii(bytes, limits);
  }
  const count = bytes.length >= 84 ? declaredCount(bytes) : 0;
  if (count > limits.maxTriangles) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: limits.maxTriangles, count });
  throw new XchangeError('MESH_TRUNCATED', { bytes: bytes.length, expectedBytes: 84 + 50 * count });
}

function parseBinary(bytes: Uint8Array, count: number, limits: MeshParseLimits): ParsedMesh {
  if (count > limits.maxTriangles) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: limits.maxTriangles, count });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const soup = new Uint32Array(9 * count); // corner bit patterns, later compacted into the vertices
  for (let t = 0, k = 0; t < count; t++) {
    const o = 96 + 50 * t; // 84-byte prefix + 12-byte file normal
    for (let j = 0; j < 36; j += 4, k++) {
      const u = view.getUint32(o + j, true);
      if ((u & 0x7fffffff) > MAX_BITS) throw coordinateError(view.getFloat32(o + j, true), { triangle: t });
      soup[k] = u === 0x80000000 ? 0 : u; // -0 -> +0
    }
  }
  return indexSoup(soup, count, []);
}

function parseAscii(bytes: Uint8Array, limits: MeshParseLimits): ParsedMesh {
  const cur = new Cursor(bytes);
  // Never more facets than the bytes can hold: one allocation, no growth.
  const capacity = Math.min(limits.maxTriangles, Math.floor(bytes.length / MIN_FACET_BYTES) + 1);
  const soup = new Float32Array(9 * capacity);
  const truncated = (): XchangeError => new XchangeError('MESH_TRUNCATED', { line: cur.line });
  const malformed = (reason: string): XchangeError => new XchangeError('MESH_MALFORMED', { format: 'stl', reason, line: cur.line });
  const expect = (word: Uint8Array, reason: string): void => {
    if (!cur.next()) throw truncated();
    if (!cur.is(word)) throw malformed(reason);
  };

  let t = 0, solids = 0;
  if (!cur.next() || !cur.is(SOLID)) throw malformed('expectedSolid');
  for (;;) {
    solids++;
    cur.skipLine(); // solid name
    for (;;) {
      if (!cur.next()) throw truncated();
      if (cur.is(ENDSOLID)) break;
      if (!cur.is(FACET)) throw malformed('expectedFacet');
      expect(NORMAL, 'expectedNormal');
      // File normals are ignored unparsed: exporters write "nan" for degenerate facets.
      for (let k = 0; k < 3; k++) if (!cur.next()) throw truncated();
      expect(OUTER, 'expectedOuter');
      expect(LOOP, 'expectedLoop');
      if (t === capacity) throw new XchangeError('TOO_MANY_TRIANGLES', { limit: limits.maxTriangles });
      for (let k = 9 * t, end = k + 9; k < end; k += 3) {
        expect(VERTEX, 'expectedVertex');
        for (let j = 0; j < 3; j++) {
          if (!cur.next()) throw truncated();
          const v = cur.number();
          if (!(Math.abs(v) <= MAX_ABS_COORDINATE_MM)) throw coordinateError(v, { line: cur.line });
          soup[k + j] = v === 0 ? 0 : v; // -0 -> +0
        }
      }
      expect(ENDLOOP, 'expectedEndloop');
      expect(ENDFACET, 'expectedEndfacet');
      t++;
    }
    cur.skipLine(); // endsolid name
    if (!cur.next()) break;
    if (!cur.is(SOLID)) throw malformed('expectedSolid');
  }
  const warnings: XchangeWarning[] = solids > 1 ? [{ code: 'STL_MULTIPLE_SOLIDS', details: { count: solids } }] : [];
  return indexSoup(new Uint32Array(soup.buffer, 0, 9 * t), t, warnings);
}

/**
 * Indexes a triangle soup of float32 bit patterns (9 per triangle, -0 already folded): bit-identical
 * corners share a vertex; triangles with two equal corners are dropped. Vertex v is written to
 * soup[3v..3v+2], never past the corner being read, so the soup becomes the vertex buffer in place.
 */
function indexSoup(soup: Uint32Array, count: number, warnings: XchangeWarning[]): ParsedMesh {
  const corners = 3 * count;
  // ponytail: open-addressing table sized for "no corner shared" (load <= 3/4): 4-8 bytes per corner.
  let size = 1024;
  while (size < corners + Math.ceil(corners / 3)) size *= 2;
  const mask = size - 1;
  const table = new Int32Array(size); // vertex + 1, 0 = empty
  const indices = new Uint32Array(corners);
  let vertices = 0, kept = 0, dropped = 0;
  for (let t = 0; t < count; t++) {
    const s = 9 * t;
    const ax = soup[s]!, ay = soup[s + 1]!, az = soup[s + 2]!;
    const bx = soup[s + 3]!, by = soup[s + 4]!, bz = soup[s + 5]!;
    const cx = soup[s + 6]!, cy = soup[s + 7]!, cz = soup[s + 8]!;
    if ((ax === bx && ay === by && az === bz) || (ax === cx && ay === cy && az === cz) || (bx === cx && by === cy && bz === cz)) {
      dropped++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const p = s + 3 * k;
      const x = soup[p]!, y = soup[p + 1]!, z = soup[p + 2]!;
      let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d)) >>> 0;
      h = (h ^ (h >>> 15)) & mask;
      let id: number;
      for (;;) {
        const e = table[h]!;
        if (e === 0) {
          id = vertices++;
          table[h] = id + 1;
          const q = 3 * id;
          soup[q] = x;
          soup[q + 1] = y;
          soup[q + 2] = z;
          break;
        }
        const q = 3 * (e - 1);
        if (soup[q] === x && soup[q + 1] === y && soup[q + 2] === z) {
          id = e - 1;
          break;
        }
        h = (h + 1) & mask;
      }
      indices[3 * kept + k] = id;
    }
    kept++;
  }
  const positions = new Float32Array(soup.buffer.slice(soup.byteOffset, soup.byteOffset + 12 * vertices));
  return finish('stl', positions, kept === count ? indices : indices.slice(0, 3 * kept), dropped, undefined, warnings);
}
