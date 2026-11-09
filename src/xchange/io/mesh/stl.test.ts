import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { fromTranslation } from '../../core/mat4';
import { transformMesh } from '../../core/mesh';
import { writeBinarySTL } from '../../core/stl-writer';
import type { TriMesh } from '../../core/types';
import { makeScanBody } from '../../test/fixtures';
import { encodeAsciiSTL } from '../../test/fixtures/encoders';
import { parseSTL } from './stl';
import { encode, expectError, soup } from './test-helpers';

const CAPTURE = LIMITS.capture;
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** ASCII STL from corner triples written verbatim (tokens as given). */
function asciiStl(triangles: string[][]): Uint8Array {
  const facets = triangles.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${v}`).join('\n')}\nendloop\nendfacet\n`);
  return encode(`solid t\n${facets.join('')}endsolid t\n`);
}

/** n × n quads on a wavy sheet (0.05 mm pitch): 2n² triangles, (n+1)² distinct vertices. */
function grid(n: number): TriMesh {
  const row = n + 1;
  const positions = new Float32Array(3 * row * row);
  for (let i = 0, o = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++, o += 3) {
      positions[o] = 0.05 * i;
      positions[o + 1] = 0.05 * j;
      positions[o + 2] = Math.sin(0.1 * i) * Math.cos(0.13 * j);
    }
  }
  const indices = new Uint32Array(6 * n * n);
  for (let i = 0, o = 0; i < n; i++) {
    for (let j = 0; j < n; j++, o += 6) {
      const a = i * row + j;
      indices[o] = a;
      indices[o + 1] = a + 1;
      indices[o + 2] = a + row + 1;
      indices[o + 3] = a;
      indices[o + 4] = a + row + 1;
      indices[o + 5] = a + row;
    }
  }
  return { positions, indices };
}

describe('parseSTL', () => {
  const body = makeScanBody();

  it('reads binary STL back to the same triangles, indexed, without aliasing the input', () => {
    const bytes = writeBinarySTL(body);
    const { mesh, format, warnings } = parseSTL(bytes, CAPTURE);
    expect(format).toBe('stl');
    expect(warnings).toEqual([]);
    expect(soup(mesh)).toEqual(soup(body));
    expect(mesh.positions.length).toBe(body.positions.length); // every shared corner merged
    expect(mesh.colors).toBeUndefined();
    expect(mesh.positions.buffer).not.toBe(bytes.buffer);
    expect(mesh.indices.buffer).not.toBe(bytes.buffer);
  });

  it('reads ASCII STL back to the same triangles', () => {
    const { mesh, warnings } = parseSTL(encodeAsciiSTL(body), CAPTURE);
    expect(warnings).toEqual([]);
    expect(soup(mesh)).toEqual(soup(body));
    expect(mesh.positions.length).toBe(body.positions.length);
  });

  it('decides binary by size even when the header starts with "solid"', () => {
    const bytes = writeBinarySTL(body);
    bytes.set(encode('solid exported by a CAD tool'.padEnd(80, ' ')));
    expect(soup(parseSTL(bytes, CAPTURE).mesh)).toEqual(soup(body));
  });

  it('accepts several solids and warns', () => {
    const a = makeScanBody({ segments: 8, heightSegments: 1 });
    const b = transformMesh(a, fromTranslation([10, 0, 0]));
    const bytes = encode(decode(encodeAsciiSTL(a, 'one')) + decode(encodeAsciiSTL(b, 'two')));
    const { mesh, warnings } = parseSTL(bytes, CAPTURE);
    expect(warnings).toEqual([{ code: 'STL_MULTIPLE_SOLIDS', details: { count: 2 } }]);
    expect(soup(mesh)).toEqual(new Float32Array([...soup(a), ...soup(b)]));
  });

  it('tolerates odd whitespace, case, a BOM, nan normals, -0 and no final newline', () => {
    const text =
      '\uFEFF  SOLID  name with spaces\r\n' +
      '\tFacet NORMAL nan -nan(ind) 1.#QNAN\r\n outer\t\tloop\n' +
      '  VERTEX 0 0 0\r\n vertex\t1.0e+00  0  0\x0b\n vertex 0 1. .0\x0c\n' +
      'endloop endfacet\n' +
      'facet normal 0 0 1 outer loop vertex -0 0 -0.0 vertex 1 0 0 vertex -.5 -1 +0 endloop endfacet\nendsolid';
    const { mesh } = parseSTL(encode(text), CAPTURE);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 1, 3]); // -0 merged with +0
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, -1, 0]);
    expect(Object.is(mesh.positions[0], 0)).toBe(true);
  });

  it('drops and counts triangles with a repeated corner, without orphan vertices', () => {
    const bytes = asciiStl([
      ['0 0 0', '1 0 0', '0 1 0'],
      ['0 0 0', '0 0 0', '1 1 1'],
      ['2 2 2', '3 3 3', '2 2 2'],
    ]);
    const { mesh, warnings } = parseSTL(bytes, CAPTURE);
    expect(warnings).toEqual([{ code: 'MESH_DEGENERATE_TRIANGLES_DROPPED', details: { count: 2 } }]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(mesh.positions.length).toBe(9);
    expectError(() => parseSTL(asciiStl([['1 1 1', '1 1 1', '2 2 2']]), CAPTURE), 'MESH_EMPTY', { dropped: 1 });
    expectError(() => parseSTL(encode('solid empty\nendsolid empty\n'), CAPTURE), 'MESH_EMPTY');
  });

  it('rejects truncated binary files and declared counts the bytes cannot hold, before allocating', () => {
    const bytes = writeBinarySTL(body);
    expectError(() => parseSTL(bytes.subarray(0, bytes.length - 1), CAPTURE), 'MESH_TRUNCATED', {
      bytes: bytes.length - 1,
      expectedBytes: bytes.length,
    });
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    expectError(() => parseSTL(extra, CAPTURE), 'MESH_TRUNCATED');
    expectError(() => parseSTL(new Uint8Array(40), CAPTURE), 'MESH_TRUNCATED');

    // 4 294 967 295 declared triangles would need ~150 GB: must fail on the count, not on an allocation.
    const tiny = new Uint8Array(84 + 50);
    const view = new DataView(tiny.buffer);
    view.setUint32(80, 0xffffffff, true);
    expectError(() => parseSTL(tiny, LIMITS.jaw), 'TOO_MANY_TRIANGLES', { limit: LIMITS.jaw.maxTriangles, count: 0xffffffff });
    view.setUint32(80, 2_000_000, true);
    expectError(() => parseSTL(tiny, LIMITS.jaw), 'MESH_TRUNCATED');
    // A consistent file above the limit.
    expectError(() => parseSTL(bytes, { maxBytes: bytes.length, maxTriangles: 10 }), 'TOO_MANY_TRIANGLES', { limit: 10, count: 576 });
    expectError(() => parseSTL(encodeAsciiSTL(body), { maxBytes: 1e9, maxTriangles: 2 }), 'TOO_MANY_TRIANGLES', { limit: 2 });
    expectError(() => parseSTL(bytes, { maxBytes: 100, maxTriangles: 10 }), 'FILE_TOO_LARGE', { limitBytes: 100 });
    expectError(() => parseSTL(new Uint8Array(0), CAPTURE), 'FILE_EMPTY');
  });

  it('rejects NaN, infinity and out-of-range coordinates; ignores bad file normals', () => {
    const at = (t: number, k: number): number => 84 + 50 * t + 12 + 4 * k;
    const cases: Array<[number, ErrorCode]> = [[NaN, 'NUMBER_INVALID'], [Infinity, 'NUMBER_INVALID'], [-2e5, 'COORDINATE_OUT_OF_RANGE']];
    for (const [value, code] of cases) {
      const bytes = writeBinarySTL(body);
      new DataView(bytes.buffer).setFloat32(at(5, 4), value, true);
      expectError(() => parseSTL(bytes, CAPTURE), code, { triangle: 5 });
    }
    const bytes = writeBinarySTL(body);
    new DataView(bytes.buffer).setFloat32(84 + 50 * 3, NaN, true); // normal of triangle 3
    expect(parseSTL(bytes, CAPTURE).mesh.indices.length).toBe(body.indices.length);

    expectError(() => parseSTL(asciiStl([['0 0 0', 'nan 0 0', '0 1 0']]), CAPTURE), 'NUMBER_INVALID', { line: 5 });
    expectError(() => parseSTL(asciiStl([['0 0 0', '1,5 0 0', '0 1 0']]), CAPTURE), 'NUMBER_INVALID', { line: 5 });
    expectError(() => parseSTL(asciiStl([['0 0 0', '1e999 0 0', '0 1 0']]), CAPTURE), 'NUMBER_INVALID');
    expectError(() => parseSTL(asciiStl([['0 0 0', '0 0 1e6', '0 1 0']]), CAPTURE), 'COORDINATE_OUT_OF_RANGE', { line: 5 });
  });

  it('reports ASCII grammar errors with the line number', () => {
    const good = decode(asciiStl([['0 0 0', '1 0 0', '0 1 0']]));
    const malformed = (text: string, reason: string, line: number): void => {
      expectError(() => parseSTL(encode(text), CAPTURE), 'MESH_MALFORMED', { format: 'stl', reason, line });
    };
    malformed(good.replace('endloop', 'endlop'), 'expectedEndloop', 7);
    malformed(good.replace('outer loop', 'outer'), 'expectedLoop', 4);
    malformed(good.replace('facet normal', 'facet'), 'expectedNormal', 2);
    malformed(good + 'garbage\n', 'expectedSolid', 10);
    malformed('solid x\nvertex 1 2 3\n', 'expectedFacet', 2);
    expectError(() => parseSTL(encode(good.slice(0, good.indexOf('endloop'))), CAPTURE), 'MESH_TRUNCATED');
    expectError(() => parseSTL(encode(good.slice(0, good.indexOf('endsolid'))), CAPTURE), 'MESH_TRUNCATED');
    // A NUL past the first KB of an ASCII file is an encoding error.
    const big = encodeAsciiSTL(body);
    big[big.length - 40] = 0;
    expectError(() => parseSTL(big, CAPTURE), 'TEXT_ENCODING', { reason: 'nul' });
  });

  it('parses a 1 M-triangle binary STL in under a second', () => {
    const n = 707; // 999 698 triangles, 501 264 vertices
    const bytes = writeBinarySTL(grid(n));
    const t0 = performance.now();
    const { mesh } = parseSTL(bytes, LIMITS.jaw);
    const ms = performance.now() - t0;
    expect(mesh.indices.length / 3).toBe(2 * n * n);
    expect(mesh.positions.length / 3).toBe((n + 1) * (n + 1));
    expect(ms).toBeLessThan(1000);
  });
});
