/**
 * Adversarial checks of core/mat4 and core/rigid. Tests named "BUG:" fail on purpose until the
 * production code is fixed (see the review findings); the others document attacks that hold.
 */
import { describe, expect, it } from 'vitest';
import {
  fromAxisAngle,
  fromQuaternion,
  fromRowMajor,
  fromTranslation,
  identity,
  inverseRigid,
  maxAbsDiff,
  multiply,
  rotationAngleBetween,
  toQuaternion,
  transformPoint,
  validateRigid,
} from '../../core/mat4';
import { kabsch, solvePointToPlane } from '../../core/rigid';
import { sampleSurface } from '../../core/sampling';
import type { Mat4, Vec3 } from '../../core/types';
import { distance } from '../../core/vec3';
import { makeScanBody, randomRigid } from '../fixtures';

const moved = (m: Mat4, points: ArrayLike<number>): Float64Array => {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) out.set(transformPoint(m, [points[i]!, points[i + 1]!, points[i + 2]!]), i);
  return out;
};
const det3 = (m: Mat4): number =>
  m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);

describe('core/rigid solvePointToPlane', () => {
  it('BUG: a converged step (rotation 1e-14..1e-12 rad) returns a matrix instead of throwing DEGENERATE_GEOMETRY', () => {
    const dst = sampleSurface(makeScanBody(), 300, 3);
    for (const angle of [1e-14, 2e-13, 5e-13]) {
      const truth = fromAxisAngle([0.3, 0.5, 0.8], angle, [0.1, 0.2, 3]);
      const src = moved(inverseRigid(truth), dst.points);
      let step: Mat4 | null = null;
      expect(() => (step = solvePointToPlane(src, dst.points, dst.normals))).not.toThrow();
      expect(step).not.toBeNull();
      expect(maxAbsDiff(step!, truth)).toBeLessThan(1e-9);
    }
  });
});

describe('core/mat4 validateRigid + multiply', () => {
  it('BUG: the product of two accepted rigid matrices is rigid and equals applying them in turn', () => {
    const site = identity();
    site[12] = 9e-5; // bottom row within RIGID_TOLERANCE (1e-4): accepted, kept as is
    expect(() => validateRigid(site)).not.toThrow();
    const assembly = fromTranslation([100, -40, 25]);
    const product = multiply(assembly, validateRigid(site));
    const p: Vec3 = [2.5, 0, 6.6];
    // transformPoint / transformMesh / inverseRigid ignore row 3, multiply() does not: ~25 µm apart here.
    expect(distance(transformPoint(product, p), transformPoint(assembly, transformPoint(site, p)))).toBeLessThan(1e-9);
    expect(() => validateRigid(product)).not.toThrow();
  });

  it('refuses left-handed, scaled, transposed (column-major) and out-of-range matrices', () => {
    const r = randomRigid(3, Math.PI, 30);
    const mirrored = Float64Array.from(r);
    for (const i of [0, 4, 8]) mirrored[i] = -mirrored[i]!; // X axis flipped: det -1
    const reason = (m: ArrayLike<number>): unknown => {
      try {
        validateRigid(m);
        return 'accepted';
      } catch (error) {
        return (error as { details?: { reason?: string } }).details?.reason;
      }
    };
    expect(reason(mirrored)).toBe('reflection');
    const scaled = (s: number): Mat4 => Float64Array.from(r, (v, i) => (i % 4 < 3 && i < 12 ? v * s : v));
    expect(reason(scaled(1.001))).toBe('notOrthonormal'); // 0.1 % scale
    expect(reason(scaled(10))).toBe('notOrthonormal'); // cm -> mm written into the rotation
    expect(reason(scaled(0.1))).toBe('notOrthonormal');
    const transposed = new Float64Array(16);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) transposed[a * 4 + b] = r[b * 4 + a]!;
    expect(reason(transposed)).toBe('lastRow'); // column-major read as row-major: the translation lands in row 3
    expect(reason(fromRowMajor([1, 0, 0, 1.5e5, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))).toBe('translationRange');
  });

  it('quaternions and angles stay exact at 0 and 180 degrees about any axis', () => {
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, -1], [0, 1, 1], [1, 1, 1], [-2, 0.5, 3]];
    for (const axis of axes) {
      for (const angle of [1e-9, Math.PI / 2, Math.PI - 1e-9, Math.PI]) {
        const m = fromAxisAngle(axis, angle, [3, -4, 5]);
        const back = fromQuaternion(toQuaternion(m), [m[3]!, m[7]!, m[11]!]);
        expect(maxAbsDiff(back, m)).toBeLessThan(1e-12);
        expect(Math.abs(rotationAngleBetween(identity(), m) - angle)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('core/rigid kabsch under hostile point sets', () => {
  const cloud: Vec3[] = [[0, 0, 0], [12, 0, 1], [3, 9, -2], [-5, 4, 7], [8, -6, 3]];
  const flat = (points: readonly Vec3[]): Float64Array => Float64Array.from(points.flat());

  it('exact 180° turns, 3 points', () => {
    const src = flat(cloud.slice(0, 3));
    for (const axis of [[0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 1, 0], [1, 1, 1]] as Vec3[]) {
      const truth = fromAxisAngle(axis, Math.PI, [3, 4, 5]);
      expect(maxAbsDiff(kabsch(src, moved(truth, src)), truth)).toBeLessThan(1e-9);
    }
  });

  it('never returns a reflection for a mirrored set, and keeps precision 90 km from the origin', () => {
    const src = flat(cloud);
    const mirror = src.map((v, i) => (i % 3 === 0 ? -v : v));
    const fit = kabsch(src, mirror);
    expect(det3(fit)).toBeCloseTo(1, 12);
    expect(() => validateRigid(fit, 1e-9)).not.toThrow();

    const far = src.map((v) => v + 9e4);
    const truth = randomRigid(5, Math.PI, 10);
    const found = kabsch(far, moved(truth, far));
    expect(maxAbsDiff(found, truth)).toBeLessThan(1e-6);
    expect(rotationAngleBetween(found, truth)).toBeLessThan(1e-11);
  });
});
