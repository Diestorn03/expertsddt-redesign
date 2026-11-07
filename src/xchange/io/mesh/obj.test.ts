import { describe, expect, it } from 'vitest';
import { LIMITS, PARSE_LIMITS } from '../../core/limits';
import { makeScanBody } from '../../test/fixtures';
import { encodeOBJ } from '../../test/fixtures/encoders';
import { parseOBJ } from './obj';
import { encode, expectError, triangleAreasAlong } from './test-helpers';

const CAPTURE = LIMITS.capture;
const obj = (...lines: string[]): Uint8Array => encode(lines.join('\n') + '\n');
const TRIANGLE = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0'];

describe('parseOBJ', () => {
  it('round-trips encodeOBJ', () => {
    const body = makeScanBody();
    const { mesh, format, warnings } = parseOBJ(encodeOBJ(body), CAPTURE);
    expect(format).toBe('obj');
    expect(warnings).toEqual([]);
    expect(mesh.positions).toEqual(body.positions);
    expect(mesh.indices).toEqual(body.indices);
    expect(mesh.colors).toBeUndefined();
  });

  it('reads quads, negative indices, v/vt/vn corners and continuations; ignores everything else', () => {
    const bytes = encode(
      [
        '# exported by a scanner', 'mtllib piezas_niño.mtl', 'o cuerpo', 'g grupo 1', 's 1', 'usemtl Ã©',
        'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vn 0 0 1', 'vp 0.5',
        'f 1/1/1 2/1/1 3/1/1 4/1/1   # quad, trailing comment',
        'v 0 0 1', 'v 1 0 1', 'v 1 1 1',
        'f -3//1 -2//1 \\', '  -1//1',
        'l 1 2', 'p 3',
        'f 5/1 6/1 7/1',
      ].join('\r\n'),
    );
    const { mesh } = parseOBJ(bytes, CAPTURE);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 5, 6]);
    expect(mesh.positions.length).toBe(21);
  });

  it('triangulates a concave polygon without flipping (ear clipping)', () => {
    const L = ['v 4 1 0', 'v 1 1 0', 'v 1 4 0', 'v 0 4 0', 'v 0 0 0', 'v 4 0 0'];
    const { mesh } = parseOBJ(obj(...L, 'f 1 2 3 4 5 6'), CAPTURE);
    const areas = triangleAreasAlong(mesh, [0, 0, 1]);
    expect(areas).toHaveLength(4);
    for (const a of areas) expect(a).toBeGreaterThan(0);
    expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(7, 6);
  });

  it('reads vertex colors (6 and 7 fields) and drops them when not every vertex has one', () => {
    const six = parseOBJ(obj('v 0 0 0 1 0 0', 'v 1 0 0 0 1 0', 'v 0 1 0 0 0 0.5', 'f 1 2 3'), CAPTURE).mesh;
    expect(Array.from(six.colors!)).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 128]);
    const seven = parseOBJ(obj('v 0 0 0 1 0.2 0.4 0.6', 'v 1 0 0 1 2 -1 0', 'v 0 1 0 1 0 0 0', 'f 1 2 3'), CAPTURE).mesh;
    expect(Array.from(seven.colors!)).toEqual([51, 102, 153, 255, 0, 0, 0, 0, 0]);
    const mixed = parseOBJ(obj('v 0 0 0 1 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'), CAPTURE);
    expect(mixed.mesh.colors).toBeUndefined();
    expect(mixed.warnings).toEqual([{ code: 'MESH_COLORS_IGNORED' }]);
    expect(parseOBJ(obj('v 0 0 0 1', 'v 1 0 0 1.0', 'v 0 1 0 1e0', 'f 1 2 3'), CAPTURE).mesh.indices.length).toBe(3);
  });

  it('drops and counts degenerate faces', () => {
    const { mesh, warnings } = parseOBJ(obj(...TRIANGLE, 'f 1 2 3', 'f 1 1 2', 'f 1 2', 'f 3 3 3 3'), CAPTURE);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(warnings).toEqual([{ code: 'MESH_DEGENERATE_TRIANGLES_DROPPED', details: { count: 4 } }]);
    expectError(() => parseOBJ(obj(...TRIANGLE), CAPTURE), 'MESH_EMPTY', { dropped: 0 });
  });

  it('rejects bad records with their line number', () => {
    const malformed = (bytes: Uint8Array, reason: string, line: number): void => {
      expectError(() => parseOBJ(bytes, CAPTURE), 'MESH_MALFORMED', { format: 'obj', reason, line });
    };
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 0 1 2'), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { line: 4 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 2 4', 'v 1 1 1'), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { line: 4 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f -1 -2 -4'), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { line: 4 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 2 -0'), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE');
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 two 3'), CAPTURE), 'NUMBER_INVALID', { line: 4 });
    expectError(() => parseOBJ(obj('v 1 2 x'), CAPTURE), 'NUMBER_INVALID', { line: 1 });
    expectError(() => parseOBJ(obj('v 1 2 nan'), CAPTURE), 'NUMBER_INVALID', { line: 1 });
    expectError(() => parseOBJ(obj('v 1 2 1e6'), CAPTURE), 'COORDINATE_OUT_OF_RANGE', { line: 1 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'cstype bspline', 'surf 0 1 0 1 1 2 3'), CAPTURE), 'FORMAT_UNSUPPORTED', { reason: 'freeform', line: 4 });
    malformed(obj('v 1 2'), 'vertexFields', 1);
    malformed(obj('v 1 2 3 4 5'), 'vertexFields', 1);
    malformed(obj('v 1 2 3 1 0 0 1 9'), 'vertexFields', 1);
    malformed(obj('v 1 2 3 0.5'), 'vertexWeight', 1);
    malformed(obj(...TRIANGLE, 'f 1 2 \\', '3', 'bogus 1 2'), 'unknownRecord', 6);
    malformed(obj(...TRIANGLE, `f ${'1 2 3 '.repeat(90)}`), 'polygonCorners', 4);
    malformed(obj(...TRIANGLE, `g ${'a'.repeat(PARSE_LIMITS.maxLineChars + 10)}`, 'f 1 2 3'), 'lineTooLong', 4);
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 2 3\u0000'), CAPTURE), 'TEXT_ENCODING', { reason: 'nul' });
    // UTF-16 text (Notepad "Unicode") is full of NUL bytes.
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('v 0 0 0\n', (c) => [c.charCodeAt(0), 0]).flat()]);
    expectError(() => parseOBJ(utf16, CAPTURE), 'TEXT_ENCODING', { reason: 'nul' });
  });

  it('enforces vertex and triangle limits', () => {
    const limits = { maxBytes: 1e6, maxTriangles: 1 };
    expectError(() => parseOBJ(obj(...TRIANGLE, 'v 1 1 1', 'f 1 2 3'), limits), 'TOO_MANY_VERTICES', { limit: 3 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 2 3', 'f 3 2 1'), limits), 'TOO_MANY_TRIANGLES', { limit: 1 });
    expectError(() => parseOBJ(obj(...TRIANGLE, 'f 1 2 3'), { maxBytes: 10, maxTriangles: 1 }), 'FILE_TOO_LARGE', { limitBytes: 10 });
  });
});
