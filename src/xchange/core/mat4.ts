/**
 * 4x4 row-major rigid transforms (see core/types.ts): m[r * 4 + c], p' = M·[p; 1].
 * three.js note: Matrix4.set(...) takes row-major arguments, Matrix4.elements is column-major.
 */
import { XchangeError } from './errors';
import { MAX_ABS_COORDINATE_MM, RIGID_TOLERANCE } from './limits';
import type { Mat4, Vec3 } from './types';
import { normalize } from './vec3';

type V = Readonly<Vec3>;

/** Unit quaternion, w first. */
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function checkSixteen(values: ArrayLike<number>): void {
  if (values.length !== 16) throw new XchangeError('MATRIX_INVALID', { reason: 'length' });
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(values[i])) throw new XchangeError('MATRIX_INVALID', { reason: 'nonFinite' });
  }
}

/** Copy of 16 numbers given row by row. Throws MATRIX_INVALID. Does not check rigidity. */
export function fromRowMajor(values: ArrayLike<number>): Mat4 {
  checkSixteen(values);
  return Float64Array.from(values);
}

/** From 16 numbers given column by column (e.g. three.js Matrix4.elements). */
export function fromColumnMajor(values: ArrayLike<number>): Mat4 {
  checkSixteen(values);
  const m = new Float64Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = values[c * 4 + r]!;
  return m;
}

/** Plain row-major array, for JSON. */
export function toRowMajorArray(m: Mat4): number[] {
  return Array.from(m);
}

/** Frame whose columns are the given axes and origin (no validation: call validateRigid). */
export function fromAxes(x: V, y: V, z: V, origin: V): Mat4 {
  return Float64Array.of(
    x[0], y[0], z[0], origin[0],
    x[1], y[1], z[1], origin[1],
    x[2], y[2], z[2], origin[2],
    0, 0, 0, 1,
  );
}

/** Column c: 0/1/2 = X/Y/Z axis, 3 = origin. */
export function getColumn(m: Mat4, c: 0 | 1 | 2 | 3): Vec3 {
  return [m[c]!, m[4 + c]!, m[8 + c]!];
}

export function fromTranslation(t: V): Mat4 {
  const m = identity();
  m[3] = t[0];
  m[7] = t[1];
  m[11] = t[2];
  return m;
}

/** Rotation part of `rotation` with translation `translation`. */
export function compose(translation: V, rotation: Mat4): Mat4 {
  const m = Float64Array.from(rotation);
  m[3] = translation[0];
  m[7] = translation[1];
  m[11] = translation[2];
  m[12] = m[13] = m[14] = 0;
  m[15] = 1;
  return m;
}

/** a·b: applies b first, then a. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]! + a[r * 4 + 3]! * b[12 + c]!;
    }
  }
  return out;
}

/** Inverse of a rigid transform: [Rᵀ, -Rᵀt]. */
export function inverseRigid(m: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 4 + c] = m[c * 4 + r]!;
  const tx = m[3]!, ty = m[7]!, tz = m[11]!;
  for (let r = 0; r < 3; r++) out[r * 4 + 3] = -(out[r * 4]! * tx + out[r * 4 + 1]! * ty + out[r * 4 + 2]! * tz);
  out[15] = 1;
  return out;
}

/**
 * Accepts only rigid transforms; never repairs or normalises. Throws MATRIX_INVALID (not 16 finite
 * numbers) or MATRIX_NOT_RIGID with reason 'translationRange' | 'lastRow' | 'notOrthonormal' | 'reflection'.
 */
export function validateRigid(m: ArrayLike<number>, tolerance: number = RIGID_TOLERANCE): Mat4 {
  checkSixteen(m);
  if (!(tolerance > 0 && tolerance <= 0.01)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'tolerance' });
  const e = (i: number): number => m[i]!;
  if (Math.abs(e(3)) > MAX_ABS_COORDINATE_MM || Math.abs(e(7)) > MAX_ABS_COORDINATE_MM || Math.abs(e(11)) > MAX_ABS_COORDINATE_MM) {
    throw new XchangeError('MATRIX_NOT_RIGID', { reason: 'translationRange' });
  }
  if (Math.abs(e(12)) > tolerance || Math.abs(e(13)) > tolerance || Math.abs(e(14)) > tolerance || Math.abs(e(15) - 1) > tolerance) {
    throw new XchangeError('MATRIX_NOT_RIGID', { reason: 'lastRow' });
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a; b < 3; b++) {
      const product = e(a) * e(b) + e(4 + a) * e(4 + b) + e(8 + a) * e(8 + b);
      if (Math.abs(product - (a === b ? 1 : 0)) > tolerance) {
        throw new XchangeError('MATRIX_NOT_RIGID', { reason: 'notOrthonormal' });
      }
    }
  }
  const det =
    e(0) * (e(5) * e(10) - e(6) * e(9)) - e(1) * (e(4) * e(10) - e(6) * e(8)) + e(2) * (e(4) * e(9) - e(5) * e(8));
  if (Math.abs(det - 1) > 3 * tolerance) {
    throw new XchangeError('MATRIX_NOT_RIGID', { reason: det < 0 ? 'reflection' : 'notOrthonormal' });
  }
  return m instanceof Float64Array ? m : Float64Array.from(m);
}

/** Rotation by angleRad (right-hand rule) about `axis` through `pivot` (default origin). */
export function fromAxisAngle(axis: V, angleRad: number, pivot?: V): Mat4 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angleRad), s = Math.sin(angleRad), k = 1 - c;
  const m = Float64Array.of(
    c + x * x * k, x * y * k - z * s, x * z * k + y * s, 0,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s, 0,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k, 0,
    0, 0, 0, 1,
  );
  if (pivot) {
    const [px, py, pz] = pivot;
    m[3] = px - (m[0]! * px + m[1]! * py + m[2]! * pz);
    m[7] = py - (m[4]! * px + m[5]! * py + m[6]! * pz);
    m[11] = pz - (m[8]! * px + m[9]! * py + m[10]! * pz);
  }
  return m;
}

/** Rotation from a quaternion (normalised here) plus optional translation. */
export function fromQuaternion(q: Quat, translation: V = [0, 0, 0]): Mat4 {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  if (!(n > 1e-12)) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'zeroQuaternion' });
  const w = q.w / n, x = q.x / n, y = q.y / n, z = q.z / n;
  return Float64Array.of(
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), translation[0],
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), translation[1],
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), translation[2],
    0, 0, 0, 1,
  );
}

/** Unit quaternion of the rotation part (Shepperd), canonical w >= 0. */
export function toQuaternion(m: Mat4): Quat {
  const m00 = m[0]!, m01 = m[1]!, m02 = m[2]!, m10 = m[4]!, m11 = m[5]!, m12 = m[6]!, m20 = m[8]!, m21 = m[9]!, m22 = m[10]!;
  const trace = m00 + m11 + m22;
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4;
  }
  const n = Math.hypot(w, x, y, z) * (w < 0 ? -1 : 1);
  return { w: w / n, x: x / n, y: y / n, z: z / n };
}

export function transformPoint(m: Mat4, p: V): Vec3 {
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}

/** Rotation only (no translation). */
export function transformDirection(m: Mat4, d: V): Vec3 {
  return [
    m[0]! * d[0] + m[1]! * d[1] + m[2]! * d[2],
    m[4]! * d[0] + m[5]! * d[1] + m[6]! * d[2],
    m[8]! * d[0] + m[9]! * d[1] + m[10]! * d[2],
  ];
}

/** Angle (rad, 0..π) of the rotation taking a's orientation to b's. Precise for tiny angles. */
export function rotationAngleBetween(a: Mat4, b: Mat4): number {
  // R = aᵀ·b ; θ = atan2(|axis vector|, trace - 1)
  const r = (i: number, j: number): number => a[i]! * b[j]! + a[4 + i]! * b[4 + j]! + a[8 + i]! * b[8 + j]!;
  const trace = r(0, 0) + r(1, 1) + r(2, 2);
  const vx = r(2, 1) - r(1, 2), vy = r(0, 2) - r(2, 0), vz = r(1, 0) - r(0, 1);
  return Math.atan2(Math.hypot(vx, vy, vz), trace - 1);
}

/** Largest absolute element difference (e.g. "same matrix within 1e-7"). */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < 16; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}
