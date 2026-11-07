/**
 * Principal axes of point sets and of triangle surfaces.
 * Errors: INVALID_ARGUMENT reason 'shape' | 'weight'; INSUFFICIENT_DATA {required, count} or reason 'zeroWeight';
 * DEGENERATE_GEOMETRY reason 'zeroArea'; plus checkMesh's.
 */
import { XchangeError } from '../core/errors';
import { eigenSymmetric } from '../core/linalg';
import type { TriMesh, Vec3 } from '../core/types';
import { cross } from '../core/vec3';
import { checkMesh } from './check';

export interface Pca {
  centroid: Vec3;
  /** Unit axes, descending variance, right-handed: axes[2] = axes[0] × axes[1]. */
  axes: [Vec3, Vec3, Vec3];
  variances: Vec3;
}

/** Weighted PCA of xyz points (flat array). */
export function pcaOfPoints(points: ArrayLike<number>, weights?: ArrayLike<number>): Pca {
  const n = points.length / 3;
  if (!Number.isInteger(n) || (weights && weights.length !== n)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  if (n < 1) throw new XchangeError('INSUFFICIENT_DATA', { required: 1, count: 0 });
  const w = (i: number): number => {
    if (!weights) return 1;
    const value = weights[i]!;
    if (!(value >= 0) || !Number.isFinite(value)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'weight' });
    return value;
  };
  let total = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const wi = w(i);
    total += wi;
    cx += wi * points[3 * i]!;
    cy += wi * points[3 * i + 1]!;
    cz += wi * points[3 * i + 2]!;
  }
  if (!(total > 0)) throw new XchangeError('INSUFFICIENT_DATA', { reason: 'zeroWeight' });
  cx /= total;
  cy /= total;
  cz /= total;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const wi = w(i);
    const dx = points[3 * i]! - cx, dy = points[3 * i + 1]! - cy, dz = points[3 * i + 2]! - cz;
    xx += wi * dx * dx; xy += wi * dx * dy; xz += wi * dx * dz;
    yy += wi * dy * dy; yz += wi * dy * dz; zz += wi * dz * dz;
  }
  return fromCovariance([cx, cy, cz], [xx, xy, xz, yy, yz, zz], total);
}

/**
 * Exact area-weighted covariance of the surface (not of the vertices), so the result does not
 * depend on the tessellation: ∫ x·xᵀ dA over a triangle = A/12·(Σ vᵢvᵢᵀ + s·sᵀ), s = Σ vᵢ.
 */
export function pcaOfSurface(mesh: TriMesh): Pca {
  checkMesh(mesh);
  const p = mesh.positions, idx = mesh.indices;
  const triangles = idx.length / 3;
  let area = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < triangles; t++) {
    const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
    const A = triangleArea(p, a, b, c);
    area += A;
    cx += (A * (p[a]! + p[b]! + p[c]!)) / 3;
    cy += (A * (p[a + 1]! + p[b + 1]! + p[c + 1]!)) / 3;
    cz += (A * (p[a + 2]! + p[b + 2]! + p[c + 2]!)) / 3;
  }
  if (!(area > 0) || !Number.isFinite(area)) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'zeroArea' });
  cx /= area;
  cy /= area;
  cz /= area;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let t = 0; t < triangles; t++) {
    const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
    const A = triangleArea(p, a, b, c) / 12;
    const ax = p[a]! - cx, ay = p[a + 1]! - cy, az = p[a + 2]! - cz;
    const bx = p[b]! - cx, by = p[b + 1]! - cy, bz = p[b + 2]! - cz;
    const qx = p[c]! - cx, qy = p[c + 1]! - cy, qz = p[c + 2]! - cz;
    const sx = ax + bx + qx, sy = ay + by + qy, sz = az + bz + qz;
    xx += A * (ax * ax + bx * bx + qx * qx + sx * sx);
    xy += A * (ax * ay + bx * by + qx * qy + sx * sy);
    xz += A * (ax * az + bx * bz + qx * qz + sx * sz);
    yy += A * (ay * ay + by * by + qy * qy + sy * sy);
    yz += A * (ay * az + by * bz + qy * qz + sy * sz);
    zz += A * (az * az + bz * bz + qz * qz + sz * sz);
  }
  return fromCovariance([cx, cy, cz], [xx, xy, xz, yy, yz, zz], area);
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** m = [xx, xy, xz, yy, yz, zz], summed with total weight `total`. */
function fromCovariance(centroid: Vec3, m: readonly number[], total: number): Pca {
  const [xx, xy, xz, yy, yz, zz] = m.map((v) => v / total) as [number, number, number, number, number, number];
  const { values, vectors } = eigenSymmetric([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
  const axis = (k: number): Vec3 => [vectors[k]!, vectors[3 + k]!, vectors[6 + k]!];
  const a0 = axis(0), a1 = axis(1);
  return {
    centroid,
    axes: [a0, a1, cross(a0, a1)],
    variances: [Math.max(0, values[0]!), Math.max(0, values[1]!), Math.max(0, values[2]!)],
  };
}
