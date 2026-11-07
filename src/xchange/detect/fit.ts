/**
 * Rigid fit of surface samples onto a reference surface (exact closest points through a BVH).
 * ponytail: second ICP next to align/icp (k-d tree); unify at integration (CONTRACTS.md "Known duplication").
 */
import { isXchangeError } from '../core/errors';
import { multiply, rotationAngleBetween } from '../core/mat4';
import { computeFaceNormals } from '../core/mesh';
import { kabsch, solvePointToPlane } from '../core/rigid';
import type { Mat4, TriMesh } from '../core/types';
import { buildBvh, nearestOnSurface, type Bvh } from '../geometry/bvh';

export interface SurfaceTarget {
  bvh: Bvh;
  /** Unit normal per triangle of bvh.mesh. */
  normals: Float32Array;
}

export function surfaceTarget(mesh: TriMesh): SurfaceTarget {
  return { bvh: buildBvh(mesh), normals: computeFaceNormals(mesh) };
}

export interface FitStats {
  rmsMm: number;
  p95Mm: number;
  /** Fraction (0-1) of the samples within the tolerance. */
  coverage: number;
}

const hit = new Float64Array(4);

/**
 * Untrimmed distances of the first `count` samples, mapped by `transform`, to the surface.
 * Distances above capMm count as capMm: Infinity gives exact statistics, a finite cap keeps
 * the ranking of bad poses cheap and robust.
 */
export function measure(samples: Float64Array, count: number, bvh: Bvh, transform: Mat4, toleranceMm: number, capMm = Infinity): FitStats {
  const d = new Float64Array(count);
  const cap2 = capMm * capMm;
  const m = transform;
  let sum2 = 0, within = 0;
  for (let i = 0; i < count; i++) {
    const x = samples[3 * i]!, y = samples[3 * i + 1]!, z = samples[3 * i + 2]!;
    const qx = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
    const qy = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
    const qz = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
    const d2 = nearestOnSurface(bvh, qx, qy, qz, cap2, hit) < 0 ? cap2 : hit[3]!;
    d[i] = Math.sqrt(d2);
    sum2 += d2;
    if (d[i]! <= toleranceMm) within++;
  }
  d.sort();
  return { rmsMm: Math.sqrt(sum2 / count), p95Mm: d[Math.max(0, Math.ceil(0.95 * count) - 1)]!, coverage: within / count };
}

export interface IcpSettings {
  iterations: number;
  /** Pairs farther than this are ignored in the first iteration; then the limit follows max(floorMm, 3·rms). */
  startThresholdMm: number;
  floorMm: number;
  /** A point-to-plane step larger than this falls back to a point-to-point (kabsch) step. */
  maxStepRad: number;
  maxStepMm: number;
}

export interface IcpOutcome {
  transform: Mat4;
  converged: boolean;
}

/**
 * Point-to-plane ICP that moves the samples onto the target, starting from `initial`.
 * Converged = the samples barely move, or three iterations in a row found no new residual
 * minimum (a free direction, such as the clocking of a round body, keeps "moving" on noise
 * without improving anything).
 */
export function icp(samples: Float64Array, count: number, target: SurfaceTarget, initial: Mat4, s: IcpSettings): IcpOutcome {
  const src = new Float64Array(3 * count), dst = new Float64Array(3 * count), nrm = new Float64Array(3 * count);
  const normals = target.normals;
  // Centroid and RMS radius of the samples: rigid motion keeps the radius, so step sizes are comparable.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += samples[3 * i]!;
    cy += samples[3 * i + 1]!;
    cz += samples[3 * i + 2]!;
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let r2 = 0;
  for (let i = 0; i < count; i++) r2 += (samples[3 * i]! - cx) ** 2 + (samples[3 * i + 1]! - cy) ** 2 + (samples[3 * i + 2]! - cz) ** 2;
  const radius = Math.sqrt(r2 / count);

  let m = initial;
  let threshold = s.startThresholdMm;
  let lowest = Infinity, stale = 0;
  for (let iteration = 0; iteration < s.iterations; iteration++) {
    const limit2 = threshold * threshold;
    let n = 0, sum2 = 0;
    for (let i = 0; i < count; i++) {
      const x = samples[3 * i]!, y = samples[3 * i + 1]!, z = samples[3 * i + 2]!;
      const qx = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!;
      const qy = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!;
      const qz = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
      const tri = nearestOnSurface(target.bvh, qx, qy, qz, limit2, hit);
      if (tri < 0) continue;
      src[3 * n] = qx;
      src[3 * n + 1] = qy;
      src[3 * n + 2] = qz;
      dst[3 * n] = hit[0]!;
      dst[3 * n + 1] = hit[1]!;
      dst[3 * n + 2] = hit[2]!;
      nrm[3 * n] = normals[3 * tri]!;
      nrm[3 * n + 1] = normals[3 * tri + 1]!;
      nrm[3 * n + 2] = normals[3 * tri + 2]!;
      sum2 += hit[3]!;
      n++;
    }
    if (n < 6) return { transform: m, converged: false };
    const a = src.subarray(0, 3 * n), b = dst.subarray(0, 3 * n);
    // Displacement of the (moved) sample centroid and rotation angle: the step's size in mm.
    const px = m[0]! * cx + m[1]! * cy + m[2]! * cz + m[3]!;
    const py = m[4]! * cx + m[5]! * cy + m[6]! * cz + m[7]!;
    const pz = m[8]! * cx + m[9]! * cy + m[10]! * cz + m[11]!;
    const size = (step: Mat4): [number, number] => {
      const dx = step[0]! * px + step[1]! * py + step[2]! * pz + step[3]! - px;
      const dy = step[4]! * px + step[5]! * py + step[6]! * pz + step[7]! - py;
      const dz = step[8]! * px + step[9]! * py + step[10]! * pz + step[11]! - pz;
      return [Math.hypot(dx, dy, dz), Math.atan2(Math.hypot(step[9]! - step[6]!, step[2]! - step[8]!, step[4]! - step[1]!), step[0]! + step[5]! + step[10]! - 1)];
    };
    let step = pointToPlaneStep(a, b, nrm.subarray(0, 3 * n));
    if (step) {
      const [moveMm, angle] = size(step);
      if (moveMm > s.maxStepMm || angle > s.maxStepRad) step = null;
    }
    step ??= kabsch(a, b);
    m = multiply(step, m);
    const [moveMm, angle] = size(step);
    if (moveMm + angle * radius < 1e-7) return { transform: m, converged: true };
    const ms = sum2 / n;
    if (ms < lowest * (1 - 1e-4) - 1e-14) {
      lowest = ms;
      stale = 0;
    } else if (++stale >= 3) {
      return { transform: m, converged: true };
    }
    threshold = Math.max(s.floorMm, 3 * Math.sqrt(ms));
  }
  return { transform: m, converged: false };
}

/**
 * core/rigid.solvePointToPlane throws DEGENERATE_GEOMETRY when the solved rotation lies between
 * 1e-15 and 1e-12 rad (fromAxisAngle refuses to normalise that tiny axis). Near convergence that
 * happens; treat it like a singular system (kabsch takes the step). Reported for a core fix.
 */
function pointToPlaneStep(src: Float64Array, dst: Float64Array, normals: Float64Array): Mat4 | null {
  try {
    return solvePointToPlane(src, dst, normals);
  } catch (error) {
    if (isXchangeError(error) && error.code === 'DEGENERATE_GEOMETRY') return null;
    throw error;
  }
}

/** Pose distance used to tell candidate fits apart: rotation (rad) and motion of a point (mm). */
export function poseDifference(a: Mat4, b: Mat4, point: readonly [number, number, number]): [number, number] {
  const ax = a[0]! * point[0] + a[1]! * point[1] + a[2]! * point[2] + a[3]!;
  const ay = a[4]! * point[0] + a[5]! * point[1] + a[6]! * point[2] + a[7]!;
  const az = a[8]! * point[0] + a[9]! * point[1] + a[10]! * point[2] + a[11]!;
  const bx = b[0]! * point[0] + b[1]! * point[1] + b[2]! * point[2] + b[3]!;
  const by = b[4]! * point[0] + b[5]! * point[1] + b[6]! * point[2] + b[7]!;
  const bz = b[8]! * point[0] + b[9]! * point[1] + b[10]! * point[2] + b[11]!;
  return [rotationAngleBetween(a, b), Math.hypot(ax - bx, ay - by, az - bz)];
}
