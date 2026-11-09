import { describe, expect, it } from 'vitest';
import { makeScanBody, randomRigid } from '../test/fixtures';
import { XchangeError } from './errors';
import { eigenSymmetric, solveLinear } from './linalg';
import { fromAxisAngle, identity, inverseRigid, maxAbsDiff, multiply, rotationAngleBetween, transformPoint, validateRigid } from './mat4';
import { kabsch, solvePointToPlane } from './rigid';
import { createRng, sampleSurface } from './sampling';
import type { Mat4 } from './types';

function transformPoints(m: Mat4, points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) out.set(transformPoint(m, [points[i]!, points[i + 1]!, points[i + 2]!]), i);
  return out;
}

function randomPoints(n: number, seed: number, spread = 20): Float64Array {
  const rng = createRng(seed);
  return Float64Array.from({ length: 3 * n }, () => (rng() * 2 - 1) * spread);
}

describe('linalg', () => {
  it('eigenSymmetric diagonalises symmetric matrices (descending, orthonormal vectors)', () => {
    const rng = createRng(4);
    for (const n of [3, 4, 6]) {
      const b = Float64Array.from({ length: n * n }, () => rng() - 0.5);
      const a = new Float64Array(n * n); // a = bᵀb is symmetric
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) a[i * n + j] = a[i * n + j]! + b[k * n + i]! * b[k * n + j]!;
      const { values, vectors } = eigenSymmetric(a, n);
      for (let k = 0; k < n; k++) {
        if (k > 0) expect(values[k]!).toBeLessThanOrEqual(values[k - 1]!);
        for (let i = 0; i < n; i++) {
          let av = 0;
          for (let j = 0; j < n; j++) av += a[i * n + j]! * vectors[j * n + k]!;
          expect(av).toBeCloseTo(values[k]! * vectors[i * n + k]!, 12);
        }
        for (let l = 0; l < n; l++) {
          let d = 0;
          for (let i = 0; i < n; i++) d += vectors[i * n + k]! * vectors[i * n + l]!;
          expect(d).toBeCloseTo(k === l ? 1 : 0, 12);
        }
      }
    }
  });

  it('solveLinear solves well-posed systems and reports singular ones', () => {
    const x = solveLinear([0, 2, 0, 1, 0, 0, 0, 0, 4], [4, 3, 8], 3); // needs pivoting
    expect(Array.from(x!)).toEqual([3, 2, 2]);
    expect(solveLinear([1, 2, 2, 4], [1, 2], 2)).toBeNull();
    expect(solveLinear([0, 0, 0, 0], [0, 0], 2)).toBeNull();
  });
});

describe('kabsch', () => {
  it('recovers random rigid transforms exactly from noiseless points', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const truth = randomRigid(seed, Math.PI, 40);
      const src = randomPoints(12, seed + 100);
      const fit = kabsch(src, transformPoints(truth, src));
      expect(maxAbsDiff(fit, truth)).toBeLessThan(1e-9);
      expect(() => validateRigid(fit, 1e-9)).not.toThrow();
    }
  });

  it('honours weights: zero-weight outliers are ignored', () => {
    const truth = randomRigid(7);
    const src = randomPoints(10, 8);
    const dst = transformPoints(truth, src);
    dst[0] = dst[0]! + 50; // outlier
    const weights = Float64Array.from({ length: 10 }, (_, i) => (i === 0 ? 0 : 1));
    expect(maxAbsDiff(kabsch(src, dst, weights), truth)).toBeLessThan(1e-9);
    expect(maxAbsDiff(kabsch(src, dst), truth)).toBeGreaterThan(1e-3);
  });

  it('never returns a reflection, even for a mirrored point set', () => {
    const src = randomPoints(20, 9);
    const mirrored = Float64Array.from(src, (v, i) => (i % 3 === 0 ? -v : v));
    expect(() => validateRigid(kabsch(src, mirrored), 1e-9)).not.toThrow();
  });

  it('needs at least 3 pairs', () => {
    expect(() => kabsch([0, 0, 0, 1, 0, 0], [0, 0, 0, 1, 0, 0])).toThrow(XchangeError);
    expect(() => kabsch([0, 0, 0], [0, 0, 0, 1, 1, 1])).toThrow(XchangeError);
  });
});

describe('solvePointToPlane', () => {
  it('converges to a known motion on a curved surface within a few steps', () => {
    const dst = sampleSurface(makeScanBody(), 400, 3);
    const truth = randomRigid(21, 0.15, 1); // small motion src -> dst
    let src = transformPoints(inverseRigid(truth), dst.points);
    let total = identity();
    for (let step = 0; step < 6; step++) {
      const delta = solvePointToPlane(src, dst.points, dst.normals);
      expect(delta).not.toBeNull();
      src = transformPoints(delta!, src);
      total = multiply(delta!, total);
    }
    expect(maxAbsDiff(total, truth)).toBeLessThan(1e-9);
    expect(rotationAngleBetween(total, truth)).toBeLessThan(1e-9);
  });

  it('handles a pure translation exactly, with and without weights', () => {
    const dst = sampleSurface(makeScanBody(), 200, 5);
    const truth = fromAxisAngle([0, 0, 1], 0);
    truth[3] = 0.02;
    truth[11] = -0.01;
    const src = transformPoints(inverseRigid(truth), dst.points);
    const weights = new Float64Array(200).fill(2);
    for (const w of [undefined, weights]) {
      const delta = solvePointToPlane(src, dst.points, dst.normals, w);
      expect(maxAbsDiff(delta!, truth)).toBeLessThan(1e-12);
    }
  });

  it('returns null when the problem is degenerate (a plane slides freely)', () => {
    const rng = createRng(2);
    const n = 50;
    const pts = Float64Array.from({ length: 3 * n }, (_, i) => (i % 3 === 2 ? 0 : rng() * 10));
    const normals = Float64Array.from({ length: 3 * n }, (_, i) => (i % 3 === 2 ? 1 : 0));
    expect(solvePointToPlane(pts, pts, normals)).toBeNull();
    expect(() => solvePointToPlane(pts.subarray(0, 9), pts.subarray(0, 9), normals.subarray(0, 9))).toThrow(XchangeError);
  });
});
