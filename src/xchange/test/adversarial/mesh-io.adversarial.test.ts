/**
 * Adversarial tests for io/mesh. A hostile file must be refused with an XchangeError or parsed in time
 * linear in its size, with memory bounded by the limits. Tests named "BUG:" fail on purpose until the
 * production code is fixed (review findings); the others document attacks that hold. Time budgets are
 * 10x or more above what a linear parser needs on these inputs. All data is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { XchangeError } from '../../core/errors';
import { writeBinarySTL } from '../../core/stl-writer';
import type { MeshFormat, MeshPurpose, TriMesh } from '../../core/types';
import { parseMesh } from '../../io/mesh/index';
import { makeScanBody } from '../fixtures';
import { encodeAsciiSTL, encodeOBJ, encodePLY } from '../fixtures/encoders';
import { utf16 } from '../fixtures/positions';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Wall time and outcome ('ok' or the XchangeError code) of fn; any other exception fails the test. */
function run(fn: () => unknown): { ms: number; outcome: string } {
  const started = performance.now();
  let outcome = 'ok';
  try {
    fn();
  } catch (error) {
    if (!(error instanceof XchangeError)) throw error;
    outcome = error.code;
  }
  return { ms: performance.now() - started, outcome };
}

const TRIANGLE_PLY_HEADER = [
  'element vertex 3',
  'property float x',
  'property float y',
  'property float z',
  'element face 1',
  'property list uchar int vertex_indices',
];

describe('io/mesh: work bounded by the bytes actually present', () => {
  it('BUG: PLY elements without properties cost nothing, whatever count they declare', () => {
    // 50 empty elements x 5 M records in a 1.4 KB header: 250 M loop iterations today (~0.7 s; a 64 KB
    // header holds ~3 400 of them, ~45 s of frozen tab). They occupy no bytes, so they must be skipped.
    const empty = Array.from({ length: 50 }, (_, i) => `element e${i} 5000000`);
    const header = (format: string): string => ['ply', `format ${format} 1.0`, ...TRIANGLE_PLY_HEADER, ...empty, 'end_header', ''].join('\n');
    const ascii = enc(`${header('ascii')}0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n`);
    const head = enc(header('binary_little_endian'));
    const binary = new Uint8Array(head.length + 36 + 13);
    binary.set(head);
    const view = new DataView(binary.buffer);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, k) => view.setFloat32(head.length + 4 * k, v, true));
    binary.set([3, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], head.length + 36);
    for (const bytes of [ascii, binary]) {
      const { ms, outcome } = run(() => parseMesh(bytes, 'capture'));
      expect(['ok', 'MESH_MALFORMED']).toContain(outcome); // skipping or refusing empty elements are both fine
      expect(ms).toBeLessThan(100);
    }
  });

  it('BUG: one overlong number token is refused or parsed in linear time, without building a string char by char', () => {
    // A 3 M-digit coordinate costs ~0.4 s and >80 MB of heap today (parseDecimal's slow path concatenates
    // one character at a time); measured 4.6 s and +708 MB for 30 M digits, so a single token in a 150 MB
    // jaw runs to tens of seconds and gigabytes before NUMBER_INVALID / COORDINATE_OUT_OF_RANGE.
    const token = `0.${'1'.repeat(3_000_000)}`;
    const files: Array<[MeshFormat, Uint8Array]> = [
      ['stl', enc(`solid a\nfacet normal 0 0 0\nouter loop\nvertex ${token} 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n`)],
      ['ply', enc(['ply', 'format ascii 1.0', ...TRIANGLE_PLY_HEADER, 'end_header', `${token} 0 0`, '1 0 0', '0 1 0', '3 0 1 2', ''].join('\n'))],
      ['obj', enc(`v ${token} 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`)],
    ];
    for (const [hint, bytes] of files) {
      const { ms, outcome } = run(() => parseMesh(bytes, 'capture', hint));
      expect(['ok', 'NUMBER_INVALID', 'MESH_MALFORMED'], hint).toContain(outcome); // OBJ: lineTooLong is fine
      expect(ms, hint).toBeLessThan(100);
    }
  });

  it('BUG: STL vertex indexing stays fast on corners crafted to collide in its hash table (HashDoS)', () => {
    // 8 000 triangles (400 KB): ~0.5 s today, quadratic in the corner count (16 k triangles: 1.5 s; a 50 MB
    // capture: hours). The crafted corners target the current unseeded hash; the fix must seed it per parse.
    const { ms, outcome } = run(() => parseMesh(collidingBinarySTL(8000), 'capture'));
    expect(outcome).toBe('ok');
    expect(ms).toBeLessThan(100);
  });
});

describe('io/mesh: contract details under hostile input', () => {
  it('BUG: ASCII STL: a coordinate that rounds to float32 -0 is the same vertex as 0 (+0 = -0)', () => {
    // -1e-46 is below the smallest float32 subnormal: it is stored as -0, today after the -0 fold.
    const facet = (...corners: string[]): string[] => ['facet normal 0 0 0', 'outer loop', ...corners.map((c) => `vertex ${c}`), 'endloop', 'endfacet'];
    const stl = enc(
      ['solid t', ...facet('0 0 0', '1 0 0', '0 1 0'), ...facet('-1e-46 0 0', '1 0 0', '0 0 1'), ...facet('0 0 0', '-1e-46 0 0', '0 0 1'), 'endsolid t', ''].join('\n'),
    );
    const { mesh, warnings } = parseMesh(stl, 'capture');
    expect(Array.from(mesh.positions).some((v) => Object.is(v, -0))).toBe(false);
    expect(mesh.positions.length / 3).toBe(4); // (0, 0, 0) once
    expect(mesh.indices.length / 3).toBe(2); // the third facet has two identical corners
    expect(warnings).toContainEqual({ code: 'MESH_DEGENERATE_TRIANGLES_DROPPED', details: { count: 1 } });
  });

  it('BUG: a UTF-16 ASCII STL is reported as a text encoding problem, not as a binary size error', () => {
    // Windows PowerShell 5 redirection writes UTF-16 LE with a BOM. Today: TOO_MANY_TRIANGLES or MESH_TRUNCATED,
    // whichever the text at bytes 80..83 gives when read as a binary STL triangle count.
    const text = new TextDecoder().decode(encodeAsciiSTL(makeScanBody({ segments: 8, heightSegments: 1 })));
    for (const purpose of ['capture', 'jaw'] as const satisfies readonly MeshPurpose[]) {
      expect(run(() => parseMesh(utf16(text, true), purpose, 'stl')).outcome, purpose).toBe('TEXT_ENCODING');
    }
  });
});

describe('io/mesh: robustness regressions', () => {
  const small = makeScanBody({ segments: 4, heightSegments: 1 });
  const colored: TriMesh = { ...small, colors: Uint8Array.from(small.positions, (_, i) => (i * 37) & 255) };
  const sources: Array<[string, Uint8Array, MeshFormat]> = [
    ['binary STL', writeBinarySTL(small), 'stl'],
    ['ASCII STL', encodeAsciiSTL(small), 'stl'],
    ['PLY ascii', encodePLY(colored, 'ascii'), 'ply'],
    ['PLY LE', encodePLY(colored, 'binary_little_endian'), 'ply'],
    ['PLY BE', encodePLY(small, 'binary_big_endian'), 'ply'],
    ['OBJ', encodeOBJ(small), 'obj'],
  ];

  it('every truncation and a 0x00 / 0xFF overwrite at every 4th byte give a mesh or an XchangeError', () => {
    // run() rethrows anything that is not an XchangeError (a RangeError from a DataView read, say).
    for (const [, source, hint] of sources) {
      for (let length = 0; length < source.length; length++) run(() => parseMesh(source.subarray(0, length), 'capture', hint));
      for (let at = 0; at < source.length; at += 4) {
        for (const value of [0x00, 0xff]) {
          const bytes = source.slice();
          bytes[at] = value;
          run(() => parseMesh(bytes, 'capture', hint));
        }
      }
    }
  });

  it('a file inside a larger buffer (non-zero byteOffset) parses exactly like a fresh copy and is not aliased', () => {
    for (const [name, source] of sources) {
      const host = new Uint8Array(source.length + 64).fill(0xff);
      host.set(source, 32);
      const view = host.subarray(32, 32 + source.length);
      const a = parseMesh(view, 'capture').mesh, b = parseMesh(source.slice(), 'capture').mesh;
      expect(Array.from(a.positions), name).toEqual(Array.from(b.positions));
      expect(Array.from(a.indices), name).toEqual(Array.from(b.indices));
      expect(a.positions.buffer, name).not.toBe(host.buffer);
      expect(a.indices.buffer, name).not.toBe(host.buffer);
    }
  });
});

/**
 * Binary STL whose 3·triangles corners are distinct (x, 0, 0) points that all land in ONE bucket of
 * io/mesh/stl.ts indexSoup's table: with y = z = 0 its hash is h = imul(x, 0x9e3779b1); h ^= h >>> 15;
 * h &= mask, and both steps are invertible, so x is solved from the wanted bucket.
 */
function collidingBinarySTL(triangles: number): Uint8Array {
  const corners = 3 * triangles;
  let size = 1024;
  while (size < corners + Math.ceil(corners / 3)) size *= 2; // same table size as indexSoup
  const bits = Math.log2(size);
  let inverse = 0x9e3779b1; // multiplicative inverse mod 2^32 (Newton)
  for (let i = 0; i < 5; i++) inverse = Math.imul(inverse, 2 - Math.imul(0x9e3779b1, inverse));
  const maxBits = new Uint32Array(Float32Array.of(1e5).buffer)[0]!; // |coordinate| <= MAX_ABS_COORDINATE_MM
  const out = new Uint8Array(84 + 50 * triangles);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles, true);
  let made = 0;
  for (let j = 1; made < corners; j++) {
    const o = ((j << bits) | 77) >>> 0; // same low bits = same bucket
    const w = (o ^ (o >>> 15) ^ (o >>> 30)) >>> 0; // undo h ^= h >>> 15
    const x = Math.imul(w, inverse) >>> 0; // undo the multiply
    if ((x & 0x7fffffff) > maxBits || x === 0x80000000) continue; // out of range, or -0 (folded to +0)
    const t = Math.floor(made / 3), k = made % 3;
    view.setUint32(84 + 50 * t + 12 + 12 * k, x, true);
    made++;
  }
  return out;
}
