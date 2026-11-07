import { describe, expect, it } from 'vitest';
import { transformMesh } from '../core/mesh';
import { createRng } from '../core/sampling';
import { addNoise, makeArch, makeScanBody, randomRigid } from '../test/fixtures';
import { buildKdTree, buildTriangleTree, closestOnSurface, nearest } from './kdtree';
import { bruteDistance2 } from './test-utils';

describe('k-d tree', () => {
  it('finds the same nearest distance as brute force, with duplicates and float32 input', () => {
    const rng = createRng(3);
    const n = 3000;
    const points = new Float32Array(3 * n);
    for (let i = 0; i < 3 * n; i++) points[i] = (rng() - 0.5) * 40;
    points.copyWithin(0, 300, 600); // 100 duplicated points
    for (let i = 600; i < 900; i += 3) points[i] = 5; // many equal x values
    const tree = buildKdTree(points);
    for (let q = 0; q < 300; q++) {
      const x = (rng() - 0.5) * 50, y = (rng() - 0.5) * 50, z = (rng() - 0.5) * 50;
      let best = Infinity;
      for (let i = 0; i < n; i++) best = Math.min(best, (points[3 * i]! - x) ** 2 + (points[3 * i + 1]! - y) ** 2 + (points[3 * i + 2]! - z) ** 2);
      const j = nearest(tree, x, y, z);
      expect((points[3 * j]! - x) ** 2 + (points[3 * j + 1]! - y) ** 2 + (points[3 * j + 2]! - z) ** 2).toBe(best);
    }
  });

  it('honours maxDistanceMm (inclusive) and handles empty and tiny trees', () => {
    const tree = buildKdTree(Float64Array.of(0, 0, 0, 10, 0, 0));
    expect(nearest(tree, 1, 0, 0)).toBe(0);
    expect(nearest(tree, 9, 0, 0, 1)).toBe(1);
    expect(nearest(tree, 3, 4, 0, 5)).toBe(0); // exactly at the limit
    expect(nearest(tree, 5, 5, 0, 1)).toBe(-1);
    expect(nearest(buildKdTree(new Float64Array(0)), 0, 0, 0)).toBe(-1);
    expect(() => buildKdTree(new Float64Array(4))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => buildKdTree(Float64Array.of(0, NaN, 0))).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', details: { reason: 'nonFinite' } }));
  });
});

describe('triangle tree', () => {
  it('gives the exact closest-point distance of brute force', () => {
    const mesh = transformMesh(addNoise(makeScanBody({ segments: 24 }), 0.05, 2), randomRigid(4));
    const arch = makeArch('upper', { segmentsAlong: 24, segmentsAcross: 4 });
    const rng = createRng(8);
    for (const surface of [mesh, arch]) {
      const tree = buildTriangleTree(surface);
      const out = new Float64Array(4);
      for (let q = 0; q < 200; q++) {
        const x = (rng() - 0.5) * 60, y = (rng() - 0.5) * 60 + 20, z = (rng() - 0.5) * 30;
        const d2 = closestOnSurface(tree, x, y, z, Infinity, out);
        expect(Math.sqrt(d2)).toBeCloseTo(Math.sqrt(bruteDistance2(surface, x, y, z)), 9);
        expect(Math.hypot(out[0]! - x, out[1]! - y, out[2]! - z)).toBeCloseTo(Math.sqrt(d2), 9);
        expect(Number.isInteger(out[3])).toBe(true);
      }
    }
  });

  it('returns Infinity beyond maxDistanceMm and rejects bad indices', () => {
    const body = makeScanBody();
    const tree = buildTriangleTree(body);
    expect(closestOnSurface(tree, 0, 0, 20, 1)).toBe(Infinity);
    expect(closestOnSurface(tree, 0, 0, 7.6, 1.5)).toBeCloseTo(1, 6); // top cap at float32(6.6)
    expect(() => buildTriangleTree({ positions: new Float32Array(9), indices: Uint32Array.of(0, 1, 3) })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', details: { reason: 'indexRange' } }),
    );
  });
});
