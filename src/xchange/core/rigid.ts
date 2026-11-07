/** Rigid least-squares fits. Point sets are flat xyz arrays (length 3n). */
import { XchangeError } from './errors';
import { eigenSymmetric, solveLinear } from './linalg';
import { fromAxisAngle, fromQuaternion } from './mat4';
import type { Mat4 } from './types';

type Points = ArrayLike<number>;

function checkPairs(src: Points, dst: Points, weights: Points | undefined, minimum: number): number {
  const n = src.length / 3;
  if (!Number.isInteger(n) || dst.length !== src.length || (weights && weights.length !== n)) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  }
  if (n < minimum) throw new XchangeError('INSUFFICIENT_DATA', { required: minimum, count: n });
  return n;
}

function weightOf(weights: Points | undefined, i: number): number {
  if (!weights) return 1;
  const w = weights[i]!;
  if (!(w >= 0) || !Number.isFinite(w)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'weight' });
  return w;
}

function centroid(points: Points, weights: Points | undefined, n: number): [number, number, number] {
  let x = 0, y = 0, z = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const w = weightOf(weights, i);
    x += w * points[3 * i]!;
    y += w * points[3 * i + 1]!;
    z += w * points[3 * i + 2]!;
    total += w;
  }
  if (!(total > 0)) throw new XchangeError('INSUFFICIENT_DATA', { reason: 'zeroWeight' });
  return [x / total, y / total, z / total];
}

/**
 * Best rigid transform T minimising Σ w·|T·src_i − dst_i|² (Horn's quaternion method, so the
 * result is always a proper rotation: a mirrored point set never yields a reflection).
 * Needs n >= 3; for collinear points the roll about their line is arbitrary.
 */
export function kabsch(src: Points, dst: Points, weights?: Points): Mat4 {
  const n = checkPairs(src, dst, weights, 3);
  const cs = centroid(src, weights, n);
  const cd = centroid(dst, weights, n);
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < n; i++) {
    const w = weightOf(weights, i);
    const ax = src[3 * i]! - cs[0], ay = src[3 * i + 1]! - cs[1], az = src[3 * i + 2]! - cs[2];
    const bx = dst[3 * i]! - cd[0], by = dst[3 * i + 1]! - cd[1], bz = dst[3 * i + 2]! - cd[2];
    sxx += w * ax * bx; sxy += w * ax * by; sxz += w * ax * bz;
    syx += w * ay * bx; syy += w * ay * by; syz += w * ay * bz;
    szx += w * az * bx; szy += w * az * by; szz += w * az * bz;
  }
  const { vectors } = eigenSymmetric(
    [
      sxx + syy + szz, syz - szy, szx - sxz, sxy - syx,
      syz - szy, sxx - syy - szz, sxy + syx, szx + sxz,
      szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy,
      sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz,
    ],
    4,
  );
  // Largest eigenvalue's vector (column 0) is the quaternion (w, x, y, z).
  const m = fromQuaternion({ w: vectors[0]!, x: vectors[4]!, y: vectors[8]!, z: vectors[12]! });
  m[3] = cd[0] - (m[0]! * cs[0] + m[1]! * cs[1] + m[2]! * cs[2]);
  m[7] = cd[1] - (m[4]! * cs[0] + m[5]! * cs[1] + m[6]! * cs[2]);
  m[11] = cd[2] - (m[8]! * cs[0] + m[9]! * cs[1] + m[10]! * cs[2]);
  return m;
}

/**
 * One linearised point-to-plane step: the rigid T minimising Σ w·((T·src_i − dst_i)·n_i)²
 * for small motions, returned as an exact rotation (axis-angle) about the source centroid.
 * The caller iterates, and may reject large steps. Returns null when the system is singular
 * (e.g. every normal parallel: a plane slides freely). Needs n >= 6.
 */
export function solvePointToPlane(src: Points, dst: Points, dstNormals: Points, weights?: Points): Mat4 | null {
  const n = checkPairs(src, dst, weights, 6);
  if (dstNormals.length !== src.length) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  const [cx, cy, cz] = centroid(src, weights, n);
  const ata = new Float64Array(36);
  const atb = new Float64Array(6);
  const row = new Float64Array(6);
  for (let i = 0; i < n; i++) {
    const w = weightOf(weights, i);
    const px = src[3 * i]! - cx, py = src[3 * i + 1]! - cy, pz = src[3 * i + 2]! - cz;
    const qx = dst[3 * i]! - cx, qy = dst[3 * i + 1]! - cy, qz = dst[3 * i + 2]! - cz;
    const nx = dstNormals[3 * i]!, ny = dstNormals[3 * i + 1]!, nz = dstNormals[3 * i + 2]!;
    row[0] = py * nz - pz * ny;
    row[1] = pz * nx - px * nz;
    row[2] = px * ny - py * nx;
    row[3] = nx;
    row[4] = ny;
    row[5] = nz;
    const b = (qx - px) * nx + (qy - py) * ny + (qz - pz) * nz;
    for (let r = 0; r < 6; r++) {
      const wr = w * row[r]!;
      atb[r] = atb[r]! + wr * b;
      for (let c = r; c < 6; c++) ata[r * 6 + c] = ata[r * 6 + c]! + wr * row[c]!;
    }
  }
  for (let r = 1; r < 6; r++) for (let c = 0; c < r; c++) ata[r * 6 + c] = ata[c * 6 + r]!;
  const x = solveLinear(ata, atb, 6);
  if (!x) return null;
  const angle = Math.hypot(x[0]!, x[1]!, x[2]!);
  const m = angle > 1e-15 ? fromAxisAngle([x[0]!, x[1]!, x[2]!], angle, [cx, cy, cz]) : fromAxisAngle([0, 0, 1], 0);
  m[3] = m[3]! + x[3]!;
  m[7] = m[7]! + x[4]!;
  m[11] = m[11]! + x[5]!;
  return m;
}
