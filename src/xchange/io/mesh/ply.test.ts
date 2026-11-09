import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../core/limits';
import { fromAxisAngle, transformDirection, transformPoint } from '../../core/mat4';
import type { TriMesh, Vec3 } from '../../core/types';
import { makeScanBody } from '../../test/fixtures';
import { encodePLY, type PlyEncoding } from '../../test/fixtures/encoders';
import { parsePLY } from './ply';
import { encode, expectError, triangleAreasAlong } from './test-helpers';

const CAPTURE = LIMITS.capture;
const TRI_FACE = 'property list uchar int vertex_indices';

/** ASCII PLY with float x/y/z (plus `extra` vertex properties) and one face list. */
function asciiPly(vertexRows: string[], faceRows: string[], options: { vertexProps?: string[]; faceProps?: string[]; tail?: string } = {}): Uint8Array {
  const { vertexProps = ['property float x', 'property float y', 'property float z'], faceProps = [TRI_FACE], tail = '' } = options;
  const lines = ['ply', 'format ascii 1.0', `element vertex ${vertexRows.length}`, ...vertexProps, `element face ${faceRows.length}`, ...faceProps, 'end_header'];
  return encode([...lines, ...vertexRows, ...faceRows].join('\n') + '\n' + tail);
}

/** Binary writer for hand-made PLY bodies. */
function writer(little: boolean) {
  const out: number[] = [];
  const view = new DataView(new ArrayBuffer(8));
  const put = (n: number): void => {
    for (let i = 0; i < n; i++) out.push(view.getUint8(i));
  };
  const w = {
    text: (s: string) => (out.push(...encode(s)), w),
    i8: (v: number) => (view.setInt8(0, v), put(1), w),
    u8: (v: number) => (view.setUint8(0, v), put(1), w),
    u16: (v: number) => (view.setUint16(0, v, little), put(2), w),
    i32: (v: number) => (view.setInt32(0, v, little), put(4), w),
    u32: (v: number) => (view.setUint32(0, v, little), put(4), w),
    f32: (v: number) => (view.setFloat32(0, v, little), put(4), w),
    f64: (v: number) => (view.setFloat64(0, v, little), put(8), w),
    done: () => Uint8Array.from(out),
  };
  return w;
}

function withColors(mesh: TriMesh): TriMesh {
  const colors = new Uint8Array(mesh.positions.length);
  for (let i = 0; i < colors.length; i++) colors[i] = (i * 37 + 11) & 255;
  return { ...mesh, colors };
}

/** L-shaped hexagon (area 7) listed from (4,1), where a fan from the first corner would flip a triangle. */
const L_SHAPE: Vec3[] = [[4, 1, 0], [1, 1, 0], [1, 4, 0], [0, 4, 0], [0, 0, 0], [4, 0, 0]];

describe('parsePLY', () => {
  const body = makeScanBody();

  for (const encoding of ['ascii', 'binary_little_endian', 'binary_big_endian'] as PlyEncoding[]) {
    for (const colors of [false, true]) {
      it(`round-trips ${encoding} ${colors ? 'with' : 'without'} colors`, () => {
        const mesh = colors ? withColors(body) : body;
        const parsed = parsePLY(encodePLY(mesh, encoding, { colors }), CAPTURE);
        expect(parsed.format).toBe('ply');
        expect(parsed.warnings).toEqual([]);
        expect(parsed.mesh.positions).toEqual(mesh.positions);
        expect(parsed.mesh.indices).toEqual(mesh.indices);
        expect(parsed.mesh.colors).toEqual(colors ? mesh.colors : undefined);
      });
    }
  }

  it('reads double/int coordinates and skips other properties, lists and elements (big-endian)', () => {
    const header = [
      'ply', 'format binary_big_endian 1.0', 'comment synthetic', 'obj_info test',
      'element vertex 4', 'property double x', 'property float64 y', 'property int z',
      'property float nx', 'property float ny', 'property float nz', 'property list uchar float texcoord', 'property uchar alpha',
      'element edge 1', 'property int vertex1', 'property int vertex2',
      'element face 2', 'property uchar flags', 'property list uint8 uint32 vertex_index', 'property list int int material',
      'end_header',
    ];
    const w = writer(false).text(header.join('\r\n') + '\r\n');
    const vertices = [[0, 0, 0], [10, 0, 0], [10, 10, 1], [0, 10, 1]] as const;
    for (const [x, y, z] of vertices) w.f64(x).f64(y).i32(z).f32(NaN).f32(NaN).f32(NaN).u8(2).f32(0.5).f32(0.25).u8(255);
    w.i32(0).i32(1);
    w.u8(7).u8(3).u32(0).u32(1).u32(2).i32(0);
    w.u8(7).u8(3).u32(0).u32(2).u32(3).i32(1).i32(42);
    const { mesh, warnings } = parsePLY(w.done(), CAPTURE);
    expect(warnings).toEqual([]);
    expect(Array.from(mesh.positions)).toEqual(vertices.flat());
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(mesh.colors).toBeUndefined();
  });

  it('skips ignored ascii values unparsed (nan normals, texcoord lists) and accepts CRLF', () => {
    const lines = [
      'ply', 'format ascii 1.0', 'element vertex 3', 'property float x', 'property float y', 'property float z', 'property float nx',
      'element face 1', TRI_FACE, 'property list uchar float texcoord', 'end_header',
      '0 0 0 nan', '1 0 0 -nan(ind)', '0 1 0 inf', '3 0 1 2 6 0 0 1 0 0 1',
    ];
    const { mesh } = parsePLY(encode(lines.join('\r\n')), CAPTURE);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });

  it('converts float and ushort colors, and ignores partial color sets with a warning', () => {
    const rows = ['0 0 0 0 0.5 1', '1 0 0 1.2 -0.1 0.2', '0 1 0 0.001 0.999 0.5'];
    const floats = ['property float x', 'property float y', 'property float z', 'property float red', 'property float green', 'property float blue'];
    const parsed = parsePLY(asciiPly(rows, ['3 0 1 2'], { vertexProps: floats }), CAPTURE);
    expect(Array.from(parsed.mesh.colors!)).toEqual([0, 128, 255, 255, 0, 51, 0, 255, 128]);

    const shorts = ['property float x', 'property float y', 'property float z', 'property ushort red', 'property ushort green', 'property ushort blue'];
    const rows16 = ['0 0 0 65535 257 0', '1 0 0 32896 0 0', '0 1 0 0 0 65535'];
    expect(Array.from(parsePLY(asciiPly(rows16, ['3 0 1 2'], { vertexProps: shorts }), CAPTURE).mesh.colors!)).toEqual([255, 1, 0, 128, 0, 0, 0, 0, 255]);

    const partial = ['property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green'];
    const p = parsePLY(asciiPly(['0 0 0 1 2', '1 0 0 1 2', '0 1 0 1 2'], ['3 0 1 2'], { vertexProps: partial }), CAPTURE);
    expect(p.mesh.colors).toBeUndefined();
    expect(p.warnings).toEqual([{ code: 'MESH_COLORS_IGNORED' }]);
  });

  it('triangulates quads without flipping and concave polygons by ear clipping, in any plane', () => {
    // Unit cube, 6 outward quads -> 12 outward triangles.
    const cube = ['0 0 0', '1 0 0', '1 1 0', '0 1 0', '0 0 1', '1 0 1', '1 1 1', '0 1 1'];
    const quads = ['4 0 3 2 1', '4 4 5 6 7', '4 0 1 5 4', '4 1 2 6 5', '4 2 3 7 6', '4 3 0 4 7'];
    const { mesh } = parsePLY(asciiPly(cube, quads), CAPTURE);
    expect(mesh.indices.length).toBe(36);
    const p = mesh.positions;
    for (let t = 0; t < 36; t += 3) {
      const [a, b, c] = [3 * mesh.indices[t]!, 3 * mesh.indices[t + 1]!, 3 * mesh.indices[t + 2]!];
      const centroid = [0, 1, 2].map((k) => (p[a + k]! + p[b + k]! + p[c + k]!) / 3 - 0.5) as Vec3;
      expect(triangleAreasAlong({ positions: p, indices: mesh.indices.subarray(t, t + 3) }, centroid)[0]).toBeGreaterThan(0);
    }

    const rotation = fromAxisAngle([0.3, -0.5, 0.8], 1.1, [2, 2, 0]);
    for (const [corners, normal] of [
      [L_SHAPE, [0, 0, 1]],
      [[...L_SHAPE].reverse(), [0, 0, -1]],
      [L_SHAPE.map((v) => transformPoint(rotation, v)), transformDirection(rotation, [0, 0, 1])],
    ] as Array<[Vec3[], Vec3]>) {
      const face = `6 ${corners.map((_, i) => i).join(' ')}`;
      const out = parsePLY(asciiPly(corners.map((v) => v.join(' ')), [face]), CAPTURE).mesh;
      const areas = triangleAreasAlong(out, normal);
      expect(areas).toHaveLength(4);
      for (const a of areas) expect(a).toBeGreaterThan(0);
      expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(7, 4);
    }
  });

  it('fans polygons when faces come before the vertices', () => {
    const header = ['ply', 'format ascii 1.0', 'element face 1', TRI_FACE, 'element vertex 4', 'property float x', 'property float y', 'property float z', 'end_header'];
    const { mesh } = parsePLY(encode([...header, '4 0 1 2 3', '0 0 0', '1 0 0', '1 1 0', '0 1 0', ''].join('\n')), CAPTURE);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('drops and counts degenerate faces', () => {
    const verts = ['0 0 0', '1 0 0', '0 1 0'];
    const { mesh, warnings } = parsePLY(asciiPly(verts, ['3 0 1 2', '3 0 0 1', '2 0 1', '0', '4 0 1 1 2']), CAPTURE);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(warnings).toEqual([{ code: 'MESH_DEGENERATE_TRIANGLES_DROPPED', details: { count: 4 } }]);
    expectError(() => parsePLY(asciiPly(verts, ['3 1 1 1']), CAPTURE), 'MESH_EMPTY', { dropped: 1 });
  });

  it('rejects bad indices, trailing data, truncation and point clouds', () => {
    const verts = ['0 0 0', '1 0 0', '0 1 0'];
    expectError(() => parsePLY(asciiPly(verts, ['3 0 1 2', '3 0 1 3']), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { face: 1 });
    expectError(() => parsePLY(asciiPly(verts, ['3 0 -1 2']), CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { face: 0 });
    expectError(() => parsePLY(asciiPly(verts, ['3 0 x 2']), CAPTURE), 'NUMBER_INVALID', { line: 13 });
    expectError(() => parsePLY(asciiPly(verts, ['3 0 1 2'], { tail: '7\n' }), CAPTURE), 'MESH_MALFORMED', { format: 'ply', reason: 'trailingData' });
    expectError(() => parsePLY(asciiPly(verts, ['3 0 1']), CAPTURE), 'MESH_TRUNCATED');
    expectError(() => parsePLY(asciiPly(verts, []), CAPTURE), 'MESH_EMPTY');
    const cloud = encode(['ply', 'format ascii 1.0', 'element vertex 1', 'property float x', 'property float y', 'property float z', 'end_header', '0 0 0', ''].join('\n'));
    expectError(() => parsePLY(cloud, CAPTURE), 'MESH_EMPTY');

    const bin = encodePLY(body, 'binary_little_endian');
    expectError(() => parsePLY(bin.subarray(0, bin.length - 1), CAPTURE), 'MESH_TRUNCATED');
    const extra = new Uint8Array(bin.length + 1);
    extra.set(bin);
    expectError(() => parsePLY(extra, CAPTURE), 'MESH_MALFORMED', { reason: 'trailingData' });
    const bad = bin.slice();
    new DataView(bad.buffer).setInt32(bad.length - 4, body.positions.length / 3, true); // last index = vertex count
    expectError(() => parsePLY(bad, CAPTURE), 'MESH_INDEX_OUT_OF_RANGE', { face: body.indices.length / 3 - 1 });
  });

  it('checks declared counts against the limits and the bytes before allocating', () => {
    const header = (vertices: number, faces: number, extra = ''): Uint8Array =>
      encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\n${extra}element face ${faces}\n${TRI_FACE}\nend_header\n`);
    expectError(() => parsePLY(header(4_000_000_000, 1), CAPTURE), 'TOO_MANY_VERTICES', { limit: 3_000_000, count: 4_000_000_000 });
    expectError(() => parsePLY(header(3, 99_999_999_999), CAPTURE), 'TOO_MANY_TRIANGLES', { limit: 1_000_000 });
    expectError(() => parsePLY(header(3, 1, 'element edge 6000000\nproperty int a\n'), CAPTURE), 'MESH_MALFORMED', { reason: 'elementCount' });
    expectError(() => parsePLY(header(1_000_000, 1_000_000), CAPTURE), 'MESH_TRUNCATED');
    expectError(() => parsePLY(header(3, 1), { maxBytes: 1e6, maxTriangles: 0 }), 'TOO_MANY_VERTICES');
  });

  it('rejects NaN and out-of-range coordinates', () => {
    const bin = encodePLY(body, 'binary_little_endian');
    const headerBytes = bin.length - 12 * (body.positions.length / 3) - 13 * (body.indices.length / 3);
    for (const [value, code] of [[NaN, 'NUMBER_INVALID'], [-Infinity, 'NUMBER_INVALID'], [3e5, 'COORDINATE_OUT_OF_RANGE']] as const) {
      const b = bin.slice();
      new DataView(b.buffer).setFloat32(headerBytes + 12 + 8, value, true); // z of vertex 1
      expectError(() => parsePLY(b, CAPTURE), code, { vertex: 1 });
    }
    expectError(() => parsePLY(asciiPly(['0 0 0', 'nan 0 0', '0 1 0'], ['3 0 1 2']), CAPTURE), 'NUMBER_INVALID', { line: 11 });
    expectError(() => parsePLY(asciiPly(['0 0 0', '1e6 0 0', '0 1 0'], ['3 0 1 2']), CAPTURE), 'COORDINATE_OUT_OF_RANGE', { line: 11 });
  });

  it('rejects malformed headers with a reason', () => {
    const malformed = (text: string, reason: string): void => {
      expectError(() => parsePLY(encode(text), CAPTURE), 'MESH_MALFORMED', { format: 'ply', reason });
    };
    const ok = ['ply', 'format ascii 1.0', 'element vertex 3', 'property float x', 'property float y', 'property float z', 'element face 1', TRI_FACE, 'end_header', '0 0 0', '1 0 0', '0 1 0', '3 0 1 2', ''];
    const edit = (i: number, line: string | null): string => ok.flatMap((l, k) => (k === i ? (line === null ? [] : [line]) : [l])).join('\n');
    malformed(edit(0, 'plyx'), 'magic');
    malformed(edit(1, 'format binary 1.0'), 'format');
    malformed(edit(1, 'format ascii 2.0'), 'format');
    malformed(edit(1, null), 'format');
    malformed(edit(2, 'element vertex three'), 'elementCount');
    malformed(edit(3, 'property float128 x'), 'propertyType');
    malformed(edit(7, 'property list float int vertex_indices'), 'propertyType');
    malformed(edit(4, 'property float x'), 'duplicateName');
    malformed(edit(6, 'element vertex 1'), 'duplicateName');
    malformed(edit(4, 'bogus line'), 'headerLine');
    malformed(edit(5, null), 'vertexProperties');
    malformed(edit(7, 'property list uchar int corners'), 'faceProperties');
    malformed(edit(7, 'property list uchar float vertex_indices'), 'faceProperties');
    malformed(['ply', 'format ascii 1.0', 'property float x', 'end_header', ''].join('\n'), 'propertyBeforeElement');
    malformed(['ply', 'format ascii 1.0', 'element face 1', TRI_FACE, 'end_header', '3 0 1 2', ''].join('\n'), 'noVertexElement');
    malformed(['ply', 'format ascii 1.0', 'comment ' + 'x'.repeat(70_000), 'end_header', ''].join('\n'), 'headerTooLong');
    expectError(() => parsePLY(encode(ok.slice(0, 5).join('\n') + '\n'), CAPTURE), 'MESH_TRUNCATED', { line: 6 });
    expectError(() => parsePLY(encode(edit(1, 'comment a\u0000b')), CAPTURE), 'TEXT_ENCODING', { reason: 'nul' });

    const countBad = ['ply', 'format ascii 1.0', 'element vertex 3', 'property float x', 'property float y', 'property float z', 'element face 1', 'property list char int vertex_indices', 'end_header'];
    malformed([...countBad, '0 0 0', '1 0 0', '0 1 0', '-1 0 1 2', ''].join('\n'), 'listCount');
    malformed([...countBad.slice(0, -2), TRI_FACE.replace('uchar', 'int'), 'end_header', '0 0 0', '1 0 0', '0 1 0', `300 ${'0 '.repeat(300)}`, ''].join('\n'), 'polygonCorners');
  });
});
