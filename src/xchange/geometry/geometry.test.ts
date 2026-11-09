import { describe, expect, it } from 'vitest';
import { transformDirection, transformPoint } from '../core/mat4';
import { closestPointOnTriangle, countTriangles, mergeMeshes, surfaceArea, transformMesh } from '../core/mesh';
import { createRng, sampleSurface } from '../core/sampling';
import type { TriMesh, Vec3 } from '../core/types';
import { cross, dot, sub } from '../core/vec3';
import { addNoise, makeArch, makeFrames, makeScanBody, placeBodies, randomRigid } from '../test/fixtures';
import { buildBvh, closestPoint, raycast } from './bvh';
import { connectedComponents, extractComponents } from './components';
import { pcaOfPoints, pcaOfSurface } from './pca';
import { weld } from './weld';

/** Triangle soup: every triangle gets its own three vertices (like an STL without merging). */
function unweld(mesh: TriMesh): TriMesh {
  const t = countTriangles(mesh);
  const positions = new Float32Array(9 * t);
  for (let i = 0; i < 3 * t; i++) positions.set(mesh.positions.subarray(3 * mesh.indices[i]!, 3 * mesh.indices[i]! + 3), 3 * i);
  return { positions, indices: Uint32Array.from({ length: 3 * t }, (_, i) => i) };
}

/** Each triangle split into four (same surface, different tessellation). */
function subdivide(mesh: TriMesh): TriMesh {
  const p = Array.from(mesh.positions);
  const indices: number[] = [];
  const mid = (a: number, b: number): number => {
    p.push((p[3 * a]! + p[3 * b]!) / 2, (p[3 * a + 1]! + p[3 * b + 1]!) / 2, (p[3 * a + 2]! + p[3 * b + 2]!) / 2);
    return p.length / 3 - 1;
  };
  for (let t = 0; t < countTriangles(mesh); t++) {
    const [a, b, c] = [mesh.indices[3 * t]!, mesh.indices[3 * t + 1]!, mesh.indices[3 * t + 2]!];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { positions: Float32Array.from(p), indices: Uint32Array.from(indices) };
}

function bruteClosest(mesh: TriMesh, q: Vec3): number {
  let best = Infinity;
  for (let t = 0; t < countTriangles(mesh); t++) best = Math.min(best, closestPointOnTriangle(mesh.positions, mesh.indices, t, q[0], q[1], q[2]));
  return Math.sqrt(best);
}

/** Ray-plane intersection plus same-side tests: independent of the Möller-Trumbore code under test. */
function bruteRay(mesh: TriMesh, o: Vec3, dir: Vec3): number {
  const v = (i: number): Vec3 => [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
  let best = Infinity;
  for (let t = 0; t < countTriangles(mesh); t++) {
    const [a, b, c] = [v(mesh.indices[3 * t]!), v(mesh.indices[3 * t + 1]!), v(mesh.indices[3 * t + 2]!)];
    const n = cross(sub(b, a), sub(c, a));
    const denom = dot(n, dir);
    if (Math.abs(denom) < 1e-15) continue;
    const s = dot(n, sub(a, o)) / denom;
    if (s < 0) continue;
    const x: Vec3 = [o[0] + s * dir[0], o[1] + s * dir[1], o[2] + s * dir[2]];
    const inside = [[a, b], [b, c], [c, a]].every(([p, q]) => dot(cross(sub(q!, p!), sub(x, p!)), n) >= -1e-12);
    if (inside) best = Math.min(best, s);
  }
  return best;
}

describe('weld', () => {
  it('merges a split (soup) mesh back to its shared vertices and one shell', () => {
    const body = makeScanBody({ segments: 24 });
    const soup = unweld(body);
    expect(connectedComponents(soup).count).toBe(countTriangles(body));
    const welded = weld(soup);
    expect(welded.positions.length).toBe(body.positions.length);
    expect(countTriangles(welded)).toBe(countTriangles(body));
    expect(connectedComponents(welded).count).toBe(1);
    expect(surfaceArea(welded)).toBeCloseTo(surfaceArea(body), 9);
  });

  it('merges jittered copies within tolerance, keeps the first position and color, drops collapsed triangles', () => {
    const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0.004, 0, 0, 1, 0.003, 0.002, 5, 5, 5);
    const indices = Uint32Array.of(0, 1, 2, 3, 4, 2, 0, 3, 5);
    const colors = Uint8Array.of(10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40, 50, 50, 50, 60, 60, 60);
    const out = weld({ positions, indices, colors }, 0.005);
    expect(Array.from(out.positions)).toEqual(Array.from(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5)));
    expect(Array.from(out.colors!)).toEqual([10, 10, 10, 20, 20, 20, 30, 30, 30, 60, 60, 60]);
    // Triangle 2 (0, 3, 5) lost a corner (3 -> 0) and is dropped; triangle 1 became a copy of 0.
    expect(Array.from(out.indices)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(weld({ positions, indices }, 0.001).positions.length).toBe(positions.length);
  });

  it('finds neighbours across cell borders and far from the origin', () => {
    // Tolerance 0.02 mm -> cells of 0.04 mm; 1000.04 is a cell border. Pairs straddle it on every axis.
    const b = 1000.04;
    const positions = Float32Array.of(b - 0.003, -b - 0.003, b - 0.003, b + 0.003, -b + 0.003, b + 0.003, b + 0.03, -b, b);
    const out = weld({ positions, indices: Uint32Array.of(0, 1, 2) }, 0.02);
    expect(out.positions.length).toBe(6); // 0 and 1 merged (0.0104 apart), 2 kept (0.033 away)
    expect(out.indices.length).toBe(0);
  });

  it('stays linear on vertices crafted to share one bucket of an unseeded grid hash (HashDoS)', () => {
    // Cells k·2^16 apart on every axis: any hash imul(x, a) ^ imul(y, b) ^ imul(z, c) sends all 32 768 of them
    // to bucket 0 of the 2^16 table, and every lookup walked one long chain (quadratic: ~3 s). Seeded: ~15 ms.
    const tol = 1e-5, n = 32, step = 2 ** 16;
    const positions = new Float32Array(3 * n ** 3);
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) positions.set([i, j, k].map((c) => (c * step + 0.5) * 2 * tol), 3 * v++);
    const start = performance.now();
    const out = weld({ positions, indices: new Uint32Array(0) }, tol);
    expect(performance.now() - start).toBeLessThan(500);
    expect(out.positions.length).toBe(positions.length); // nothing within tolerance: every vertex kept
  });

  it('rejects a bad tolerance and broken meshes', () => {
    const mesh = makeScanBody({ segments: 8 });
    for (const tol of [0, -1, Number.NaN, Infinity]) expect(() => weld(mesh, tol)).toThrow(/INVALID_ARGUMENT/);
    expect(() => weld({ positions: new Float32Array(9), indices: Uint32Array.of(0, 1, 3) })).toThrow(/index/);
    expect(() => weld({ positions: new Float32Array(8), indices: new Uint32Array(0) })).toThrow(/shape/);
  });
});

describe('connected components', () => {
  it('numbers shells by their lowest triangle and extracts compact meshes', () => {
    const body = makeScanBody({ segments: 16 });
    const frames = makeFrames(3, 'lower');
    const merged = placeBodies(frames, body);
    const labels = connectedComponents(merged);
    expect(labels.count).toBe(3);
    const T = countTriangles(body);
    for (let t = 0; t < 3 * T; t++) expect(labels.triangleComponent[t]).toBe(Math.floor(t / T));
    const parts = extractComponents(merged, labels);
    parts.forEach((part, i) => {
      expect(Array.from(part.positions)).toEqual(Array.from(transformMesh(body, frames[i]!).positions));
      expect(Array.from(part.indices)).toEqual(Array.from(body.indices));
    });
  });

  it('labels interleaved triangles by first appearance and keeps colors', () => {
    const a = makeScanBody({ segments: 8, heightSegments: 1 });
    const b = transformMesh(a, randomRigid(3, 1, 30));
    const merged = mergeMeshes([a, b]);
    const T = countTriangles(a);
    // Interleave: b's first triangle comes first.
    const indices = new Uint32Array(merged.indices.length);
    for (let t = 0; t < T; t++) {
      indices.set(merged.indices.subarray(3 * (T + t), 3 * (T + t) + 3), 6 * t);
      indices.set(merged.indices.subarray(3 * t, 3 * t + 3), 6 * t + 3);
    }
    const colors = new Uint8Array(merged.positions.length).map((_, i) => (i < a.positions.length ? 1 : 2));
    const mesh = { positions: merged.positions, indices, colors };
    const labels = connectedComponents(mesh);
    expect(labels.count).toBe(2);
    expect(labels.triangleComponent[0]).toBe(0);
    expect(labels.triangleComponent[1]).toBe(1);
    const [first, second] = extractComponents(mesh, labels);
    expect(first!.colors!.every((c) => c === 2)).toBe(true);
    expect(second!.colors!.every((c) => c === 1)).toBe(true);
    expect(surfaceArea(first!)).toBeCloseTo(surfaceArea(a), 4); // float32 after a rigid move
  });

  it('rejects labels that do not fit the mesh', () => {
    const mesh = makeScanBody({ segments: 8 });
    const labels = connectedComponents(mesh);
    expect(() => extractComponents(mesh, { count: 1, triangleComponent: new Uint32Array(3) })).toThrow(/labels/);
    expect(() => extractComponents(mesh, { ...labels, count: 0 })).toThrow(/labels/);
  });
});

describe('pca', () => {
  it('recovers the axes of an anisotropic point cloud, right-handed and sorted', () => {
    const rng = createRng(5);
    const r = randomRigid(11);
    const pts: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const local: Vec3 = [(rng() - 0.5) * 9, (rng() - 0.5) * 4, (rng() - 0.5) * 1];
      pts.push(...transformPoint(r, local));
    }
    const pca = pcaOfPoints(pts);
    const expected = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => transformDirection(r, e as Vec3));
    pca.axes.forEach((axis, k) => expect(Math.abs(dot(axis, expected[k]!))).toBeGreaterThan(0.999));
    expect(dot(cross(pca.axes[0], pca.axes[1]), pca.axes[2])).toBeCloseTo(1, 12);
    expect(pca.variances[0]).toBeCloseTo(81 / 12, 0);
    expect(pca.variances[2]).toBeCloseTo(1 / 12, 1);
    // Weights: zero weight on everything but two points collapses to their segment.
    const w = new Float64Array(4000);
    w[0] = w[1] = 1;
    const two = pcaOfPoints(pts, w);
    expect(two.variances[1]).toBeLessThan(1e-12);
  });

  it('surface PCA is exact: independent of tessellation and consistent with dense sampling', () => {
    const body = transformMesh(makeScanBody(), randomRigid(2));
    const a = pcaOfSurface(body);
    const b = pcaOfSurface(subdivide(body));
    for (let k = 0; k < 3; k++) {
      expect(a.centroid[k]).toBeCloseTo(b.centroid[k]!, 5);
      expect(a.variances[k]).toBeCloseTo(b.variances[k]!, 5);
    }
    expect(Math.abs(dot(a.axes[0], b.axes[0]))).toBeGreaterThan(1 - 1e-9);
    const dense = pcaOfPoints(sampleSurface(body, 40000, 3).points);
    for (let k = 0; k < 3; k++) expect(Math.abs(dense.variances[k]! / a.variances[k]! - 1)).toBeLessThan(0.02);
    expect(Math.abs(dot(dense.axes[0], a.axes[0]))).toBeGreaterThan(0.999);
  });

  it('rejects empty and degenerate input', () => {
    expect(() => pcaOfPoints([])).toThrow(/INSUFFICIENT_DATA/);
    expect(() => pcaOfPoints([1, 2])).toThrow(/shape/);
    expect(() => pcaOfPoints([1, 2, 3], [-1])).toThrow(/weight/);
    expect(() => pcaOfSurface({ positions: new Float32Array(9), indices: Uint32Array.of(0, 1, 2) })).toThrow(/zeroArea/);
  });
});

describe('bvh', () => {
  const arch = addNoise(makeArch('lower', { segmentsAlong: 40, segmentsAcross: 6 }), 0.05, 4);
  const body = transformMesh(makeScanBody(), makeFrames(1)[0]!);
  const mesh = mergeMeshes([arch, body]);
  const bvh = buildBvh(mesh);
  const rng = createRng(9);
  const randomPoint = (): Vec3 => [(rng() - 0.5) * 60, rng() * 45 - 5, (rng() - 0.5) * 20];

  it('closestPoint matches brute force, including the maximum distance cut-off', () => {
    for (let i = 0; i < 300; i++) {
      const q = randomPoint();
      const hit = closestPoint(bvh, q)!;
      const brute = bruteClosest(mesh, q);
      expect(hit.distanceMm).toBeCloseTo(brute, 9);
      expect(Math.hypot(hit.point[0] - q[0], hit.point[1] - q[1], hit.point[2] - q[2])).toBeCloseTo(brute, 9);
      expect(bruteClosest({ positions: mesh.positions, indices: mesh.indices.slice(3 * hit.triangle, 3 * hit.triangle + 3) }, q)).toBeCloseTo(brute, 9);
      expect(closestPoint(bvh, q, brute * 0.99)).toBeNull();
      expect(closestPoint(bvh, q, brute * 1.01)!.distanceMm).toBeCloseTo(brute, 9);
    }
  });

  it('raycast matches brute force for random rays, both faces, and respects maxDistance', () => {
    let hits = 0;
    const bodyVertices = body.positions.length / 3;
    for (let i = 0; i < 300; i++) {
      const o = randomPoint();
      const v = 3 * (i % bodyVertices);
      const target = i % 2 ? randomPoint() : ([body.positions[v]!, body.positions[v + 1]!, body.positions[v + 2]!] as Vec3);
      const dir = sub(target, o);
      const len = Math.hypot(...dir);
      const unit: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
      const brute = bruteRay(mesh, o, unit);
      const hit = raycast(bvh, o, dir); // not normalised on purpose
      if (brute === Infinity) {
        expect(hit).toBeNull();
        continue;
      }
      hits++;
      expect(hit!.distanceMm).toBeCloseTo(brute, 7);
      expect(raycast(bvh, o, unit, brute * 0.999)).toBeNull();
    }
    expect(hits).toBeGreaterThan(100);
    // Straight down onto the strip far from the body, and straight up from below: both faces count.
    const p = (k: number): number => (arch.positions[3 * arch.indices[0]! + k]! + arch.positions[3 * arch.indices[1]! + k]! + arch.positions[3 * arch.indices[2]! + k]!) / 3;
    const down = raycast(bvh, [p(0), p(1), 50], [0, 0, -1])!;
    const up = raycast(bvh, [p(0), p(1), -50], [0, 0, 1])!;
    expect(down.triangle).toBe(0);
    expect(up.triangle).toBe(0);
    expect(down.point[2]).toBeCloseTo(p(2), 6);
    // Axis-parallel rays (zero direction components) are handled: through the body, and far away.
    expect(raycast(bvh, [100, 38, 7], [-1, 0, 0])!.distanceMm).toBeCloseTo(bruteRay(mesh, [100, 38, 7], [-1, 0, 0]), 7);
    expect(raycast(bvh, [100, 500, 0], [-1, 0, 0])).toBeNull();
  });

  it('rejects empty meshes and bad rays; builds 1 M triangles quickly', () => {
    expect(() => buildBvh({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toThrow(/MESH_EMPTY/);
    expect(() => raycast(bvh, [0, 0, 0], [0, 0, 0])).toThrow(/ray/);
    expect(() => raycast(bvh, [0, Number.NaN, 0], [0, 0, 1])).toThrow(/ray/);
    // Single-triangle tree.
    const one = buildBvh({ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), indices: Uint32Array.of(0, 1, 2) });
    expect(closestPoint(one, [0.2, 0.2, 3])!.distanceMm).toBeCloseTo(3, 12);
    const big = makeArch('lower', { segmentsAlong: 2000, segmentsAcross: 250 }); // 1 M triangles
    const start = performance.now();
    const tree = buildBvh(big);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(closestPoint(tree, [0, 38, 20])!.distanceMm).toBeCloseTo(bruteClosest(big, [0, 38, 20]), 9);
  });
});
