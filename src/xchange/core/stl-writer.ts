/** Binary STL writer: 80-byte header, u32 count, 50 bytes per triangle, little-endian, normals recomputed. */
import { XchangeError } from './errors';
import { LIMITS } from './limits';
import type { TriMesh } from './types';

export const STL_HEADER = 'DDT Xchange | binary STL | units: mm';

/** Writes one or several meshes into a single binary STL (shells are concatenated, not merged). */
export function writeBinarySTL(meshes: TriMesh | readonly TriMesh[], header: string = STL_HEADER): Uint8Array {
  // Readers sniff "solid" to pick ASCII, so a binary header must never start with it.
  if (header.length > 80 || /[^\x20-\x7e]/.test(header) || /^\s*solid/i.test(header)) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'header' });
  }
  const list: readonly TriMesh[] = 'positions' in meshes ? [meshes] : meshes;
  let triangles = 0;
  for (const m of list) triangles += Math.floor(m.indices.length / 3);
  const bytes = 84 + 50 * triangles;
  if (bytes > LIMITS.bundle.maxBytes) {
    throw new XchangeError('EXPORT_TOO_LARGE', { limitBytes: LIMITS.bundle.maxBytes, bytes });
  }
  const out = new Uint8Array(bytes);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  const view = new DataView(out.buffer);
  view.setUint32(80, triangles, true);
  let o = 84;
  for (const mesh of list) {
    const p = mesh.positions, idx = mesh.indices;
    const count = Math.floor(idx.length / 3);
    const put = (v: number): void => {
      view.setFloat32(o, p[v]!, true);
      view.setFloat32(o + 4, p[v + 1]!, true);
      view.setFloat32(o + 8, p[v + 2]!, true);
      o += 12;
    };
    for (let t = 0; t < count; t++) {
      const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 0) {
        nx /= len;
        ny /= len;
        nz /= len;
      }
      view.setFloat32(o, nx, true);
      view.setFloat32(o + 4, ny, true);
      view.setFloat32(o + 8, nz, true);
      o += 12;
      put(a);
      put(b);
      put(c);
      o += 2; // attribute byte count stays 0
    }
  }
  return out;
}
