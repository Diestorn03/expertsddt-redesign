/** TriMesh helpers. All return new arrays; inputs are never mutated. */
import { XchangeError } from './errors';
import type { Bounds, Mat4, TriMesh } from './types';

export function countTriangles(mesh: TriMesh): number {
  return Math.floor(mesh.indices.length / 3);
}

export function computeBounds(mesh: TriMesh): Bounds {
  const p = mesh.positions;
  if (p.length < 3) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'empty' });
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Writes the (unnormalised) cross product (b-a)×(c-a) of triangle t into out[0..2]; |out| = 2·area. */
function faceCross(mesh: TriMesh, t: number, out: Float64Array): void {
  const p = mesh.positions, idx = mesh.indices;
  const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
}

/** Unit normal per triangle; (0,0,0) for a degenerate triangle. */
export function computeFaceNormals(mesh: TriMesh): Float32Array {
  const count = countTriangles(mesh);
  const out = new Float32Array(3 * count);
  const n = new Float64Array(3);
  for (let t = 0; t < count; t++) {
    faceCross(mesh, t, n);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len > 0) {
      out[3 * t] = n[0]! / len;
      out[3 * t + 1] = n[1]! / len;
      out[3 * t + 2] = n[2]! / len;
    }
  }
  return out;
}

/** Area-weighted unit normal per vertex; (0,0,0) for unreferenced vertices. */
export function computeVertexNormals(mesh: TriMesh): Float32Array {
  const acc = new Float64Array(mesh.positions.length);
  const idx = mesh.indices;
  const n = new Float64Array(3);
  const count = countTriangles(mesh);
  for (let t = 0; t < count; t++) {
    faceCross(mesh, t, n);
    for (let k = 0; k < 3; k++) {
      const v = 3 * idx[3 * t + k]!;
      acc[v] = acc[v]! + n[0]!;
      acc[v + 1] = acc[v + 1]! + n[1]!;
      acc[v + 2] = acc[v + 2]! + n[2]!;
    }
  }
  const out = new Float32Array(acc.length);
  for (let v = 0; v + 2 < acc.length; v += 3) {
    const len = Math.hypot(acc[v]!, acc[v + 1]!, acc[v + 2]!);
    if (len > 0) {
      out[v] = acc[v]! / len;
      out[v + 1] = acc[v + 1]! / len;
      out[v + 2] = acc[v + 2]! / len;
    }
  }
  return out;
}

export function surfaceArea(mesh: TriMesh): number {
  const n = new Float64Array(3);
  let area = 0;
  const count = countTriangles(mesh);
  for (let t = 0; t < count; t++) {
    faceCross(mesh, t, n);
    area += Math.hypot(n[0]!, n[1]!, n[2]!) / 2;
  }
  return area;
}

/** New mesh with positions transformed by a rigid m (computed in float64, stored float32). Indices/colors are copied. */
export function transformMesh(mesh: TriMesh, m: Mat4): TriMesh {
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!, m3 = m[3]!, m4 = m[4]!, m5 = m[5]!;
  const m6 = m[6]!, m7 = m[7]!, m8 = m[8]!, m9 = m[9]!, m10 = m[10]!, m11 = m[11]!;
  for (let i = 0; i + 2 < src.length; i += 3) {
    const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
    out[i] = m0 * x + m1 * y + m2 * z + m3;
    out[i + 1] = m4 * x + m5 * y + m6 * z + m7;
    out[i + 2] = m8 * x + m9 * y + m10 * z + m11;
  }
  const result: TriMesh = { positions: out, indices: mesh.indices.slice() };
  if (mesh.colors) result.colors = mesh.colors.slice();
  return result;
}

/** Concatenates meshes (shells stay separate; no welding). Colors survive only if every mesh has them. */
export function mergeMeshes(meshes: readonly TriMesh[]): TriMesh {
  let vertexFloats = 0, indexCount = 0;
  for (const m of meshes) {
    vertexFloats += m.positions.length;
    indexCount += m.indices.length;
  }
  if (vertexFloats / 3 > 0xffffffff) throw new XchangeError('TOO_MANY_VERTICES', { limit: 0xffffffff });
  const positions = new Float32Array(vertexFloats);
  const indices = new Uint32Array(indexCount);
  const withColors = meshes.length > 0 && meshes.every((m) => m.colors);
  const colors = withColors ? new Uint8Array(vertexFloats) : undefined;
  let vOffset = 0, iOffset = 0;
  for (const m of meshes) {
    positions.set(m.positions, vOffset);
    if (colors && m.colors) colors.set(m.colors, vOffset);
    const base = vOffset / 3;
    for (let i = 0; i < m.indices.length; i++) indices[iOffset + i] = m.indices[i]! + base;
    vOffset += m.positions.length;
    iOffset += m.indices.length;
  }
  return colors ? { positions, indices, colors } : { positions, indices };
}

function closestOnSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  out: Float64Array,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const len2 = ux * ux + uy * uy + uz * uz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / len2)) : 0;
  out[0] = ax + t * ux;
  out[1] = ay + t * uy;
  out[2] = az + t * uz;
  const dx = px - out[0], dy = py - out[1], dz = pz - out[2];
  return dx * dx + dy * dy + dz * dz;
}

const scratch = new Float64Array(3);

/**
 * Exact closest point on triangle `tri` of (positions, indices) to (px, py, pz) (Ericson,
 * Real-Time Collision Detection 5.1.5). Writes the point to out[0..2] when given and returns
 * the SQUARED distance. Degenerate triangles fall back to their edges.
 */
export function closestPointOnTriangle(
  positions: Float32Array,
  indices: Uint32Array,
  tri: number,
  px: number,
  py: number,
  pz: number,
  out: Float64Array = scratch,
): number {
  const ia = 3 * indices[3 * tri]!, ib = 3 * indices[3 * tri + 1]!, ic = 3 * indices[3 * tri + 2]!;
  const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!;
  const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!;
  const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  let qx: number, qy: number, qz: number;

  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;

  if (d1 <= 0 && d2 <= 0) {
    qx = ax; qy = ay; qz = az;
  } else if (d3 >= 0 && d4 <= d3) {
    qx = bx; qy = by; qz = bz;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz;
  } else if (d6 >= 0 && d5 <= d6) {
    qx = cx; qy = cy; qz = cz;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz;
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
  } else {
    const sum = va + vb + vc;
    if (!(sum > 0) || !Number.isFinite(sum)) {
      // Degenerate (collinear) triangle: best of its three edges.
      const e = new Float64Array(3);
      let best = closestOnSegment(px, py, pz, ax, ay, az, bx, by, bz, out);
      let d = closestOnSegment(px, py, pz, bx, by, bz, cx, cy, cz, e);
      if (d < best) { best = d; out.set(e); }
      d = closestOnSegment(px, py, pz, cx, cy, cz, ax, ay, az, e);
      if (d < best) { best = d; out.set(e); }
      return best;
    }
    const v = vb / sum, w = vc / sum;
    qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
  }
  out[0] = qx;
  out[1] = qy;
  out[2] = qz;
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  return dx * dx + dy * dy + dz * dz;
}
