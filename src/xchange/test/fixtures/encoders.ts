/**
 * Minimal mesh-file encoders for tests (binary STL lives in core/stl-writer.ts).
 * Numbers are written with String(float32 value), which parses back to the identical float32.
 */
import { computeFaceNormals } from '../../core/mesh';
import type { TriMesh } from '../../core/types';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export function encodeAsciiSTL(mesh: TriMesh, solidName = 'fixture'): Uint8Array {
  const p = mesh.positions, idx = mesh.indices, n = computeFaceNormals(mesh);
  const lines = [`solid ${solidName}`];
  for (let t = 0; t < idx.length / 3; t++) {
    lines.push(`  facet normal ${n[3 * t]} ${n[3 * t + 1]} ${n[3 * t + 2]}`, '    outer loop');
    for (let k = 0; k < 3; k++) {
      const v = 3 * idx[3 * t + k]!;
      lines.push(`      vertex ${p[v]} ${p[v + 1]} ${p[v + 2]}`);
    }
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${solidName}`);
  return encode(lines.join('\n') + '\n');
}

export type PlyEncoding = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

/** PLY with float x/y/z, optional uchar red/green/blue, and `list uchar int vertex_indices` faces. */
export function encodePLY(mesh: TriMesh, encoding: PlyEncoding = 'binary_little_endian', options: { colors?: boolean } = {}): Uint8Array {
  const wantColors = options.colors ?? Boolean(mesh.colors);
  if (wantColors && !mesh.colors) throw new Error('encodePLY: mesh has no colors');
  const colors = wantColors ? mesh.colors : undefined;
  const p = mesh.positions, idx = mesh.indices;
  const vertexCount = p.length / 3, faceCount = idx.length / 3;
  const header = [
    'ply',
    `format ${encoding} 1.0`,
    'comment synthetic test fixture',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    ...(colors ? ['property uchar red', 'property uchar green', 'property uchar blue'] : []),
    `element face ${faceCount}`,
    'property list uchar int vertex_indices',
    'end_header',
  ].join('\n') + '\n';

  if (encoding === 'ascii') {
    const lines: string[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const rgb = colors ? ` ${colors[3 * v]} ${colors[3 * v + 1]} ${colors[3 * v + 2]}` : '';
      lines.push(`${p[3 * v]} ${p[3 * v + 1]} ${p[3 * v + 2]}${rgb}`);
    }
    for (let f = 0; f < faceCount; f++) lines.push(`3 ${idx[3 * f]} ${idx[3 * f + 1]} ${idx[3 * f + 2]}`);
    return encode(header + lines.join('\n') + '\n');
  }

  const little = encoding === 'binary_little_endian';
  const head = encode(header);
  const out = new Uint8Array(head.length + vertexCount * (colors ? 15 : 12) + faceCount * 13);
  out.set(head);
  const view = new DataView(out.buffer);
  let o = head.length;
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++, o += 4) view.setFloat32(o, p[3 * v + k]!, little);
    if (colors) for (let k = 0; k < 3; k++) out[o++] = colors[3 * v + k]!;
  }
  for (let f = 0; f < faceCount; f++) {
    out[o++] = 3;
    for (let k = 0; k < 3; k++, o += 4) view.setInt32(o, idx[3 * f + k]!, little);
  }
  return out;
}

/** Wavefront OBJ with `v x y z` and 1-based `f a b c` lines. */
export function encodeOBJ(mesh: TriMesh): Uint8Array {
  const p = mesh.positions, idx = mesh.indices;
  const lines = ['# synthetic test fixture'];
  for (let v = 0; v < p.length; v += 3) lines.push(`v ${p[v]} ${p[v + 1]} ${p[v + 2]}`);
  for (let f = 0; f < idx.length; f += 3) lines.push(`f ${idx[f]! + 1} ${idx[f + 1]! + 1} ${idx[f + 2]! + 1}`);
  return encode(lines.join('\n') + '\n');
}
