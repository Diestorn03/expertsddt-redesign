import { describe, expect, it } from 'vitest';
import { fromTranslation, multiply } from '../core/mat4';
import { countTriangles, mergeMeshes, transformMesh } from '../core/mesh';
import { createRng } from '../core/sampling';
import type { ImplantSite, Mat4, TriMesh } from '../core/types';
import { makeFrames, makeRevolutionBody, makeScanBody, placeBodies } from '../test/fixtures';
import { speck } from '../test/fixtures/detect';
import { assign, planAssembly, verifyAssemblyLayout } from './assembly';

const body = makeScanBody();

function toSites(frames: readonly Mat4[]): ImplantSite[] {
  return frames.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'demo', flags: {} }));
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  return worst;
}

describe('planAssembly', () => {
  it('keeps one body, or one part made of nested shells, as a normal library geometry', () => {
    const sites = toSites(makeFrames(2, 'lower', 3));
    expect(planAssembly(body, sites)).toEqual({ kind: 'single' });
    const nested = mergeMeshes([body, makeScanBody({ radius: 1, height: 3, flat: false })]);
    expect(planAssembly(nested, sites)).toEqual({ kind: 'single' });
  });

  it('normalizes identical bodies placed at the sites to one body in the implant frame', () => {
    const frames = makeFrames(4, 'lower', 5);
    const plan = planAssembly(placeBodies(frames, body), toSites(frames));
    if (plan.kind !== 'normalized') throw new Error(plan.kind);
    expect(maxDiff(plan.mesh.positions, body.positions)).toBeLessThan(1e-4);
    expect(Array.from(plan.mesh.indices)).toEqual(Array.from(body.indices));
    expect(plan.maxDeviationMm).toBeLessThan(1e-4);
  });

  it('normalizes through the two-way surface check when the bodies are tessellated differently', () => {
    const frames = makeFrames(4, 'upper', 6);
    const fine = makeScanBody({ segments: 96, heightSegments: 8 });
    const plan = planAssembly(mergeMeshes(frames.map((f, i) => transformMesh(i % 2 ? fine : body, f))), toSites(frames));
    if (plan.kind !== 'normalized') throw new Error(plan.kind);
    expect(plan.maxDeviationMm).toBeGreaterThan(1e-4);
    expect(plan.maxDeviationMm).toBeLessThan(0.03);
  });

  it('keeps different bodies fixed: every site frame reproduces the original coordinates', () => {
    const frames = makeFrames(4, 'lower', 8);
    const tall = makeScanBody({ height: 8 });
    const bodies = frames.map((f, i) => transformMesh(i % 2 ? tall : body, f));
    const order = [2, 0, 3, 1];
    const sites = toSites(order.map((k) => frames[k]!));
    const plan = planAssembly(mergeMeshes(bodies), sites);
    if (plan.kind !== 'fixed') throw new Error(plan.kind);
    sites.forEach((site, j) => {
      const placed = transformMesh(plan.meshBySite[site.id]!, site.matrix);
      expect(maxDiff(placed.positions, bodies[order[j]!]!.positions)).toBeLessThan(1e-4);
    });
  });

  it('keeps a fragment with its nearest body instead of dropping it', () => {
    const frames = makeFrames(3, 'lower', 4);
    const tall = makeScanBody({ height: 8 });
    const bodies = frames.map((f, i) => transformMesh(i === 1 ? tall : body, f));
    const loose = transformMesh(speck, multiply(frames[1]!, fromTranslation([0, 0, 8.5])));
    const plan = planAssembly(mergeMeshes([...bodies, loose]), toSites(frames));
    if (plan.kind !== 'fixed') throw new Error(plan.kind);
    expect(countTriangles(plan.meshBySite['site-2']!)).toBe(countTriangles(tall) + countTriangles(speck));
    expect(countTriangles(plan.meshBySite['site-1']!)).toBe(countTriangles(body));
  });

  it('recognises two neighbouring implants that the spread rule alone misses', () => {
    const frames = [fromTranslation([10, 20, 0]), fromTranslation([18, 20, 0])]; // 8 mm apart, bodies ~9.7 mm across
    const mesh = placeBodies(frames, body);
    expect(planAssembly(mesh, toSites(frames)).kind).toBe('normalized');
    // Same pair, but the case's implants are elsewhere: nothing says it is an assembly.
    expect(planAssembly(mesh, toSites(frames.map((f) => multiply(fromTranslation([60, 0, 0]), f)))).kind).toBe('single');
  });

  it('reports spread-out bodies that are not one per site', () => {
    const frames = makeFrames(4, 'lower', 2);
    expect(planAssembly(placeBodies(frames, body), toSites(frames.slice(0, 3)))).toEqual({ kind: 'countMismatch', bodies: 4, sites: 3 });
  });

  it('rejects bad options and duplicate site ids', () => {
    const sites = toSites(makeFrames(2));
    for (const options of [{ toleranceMm: 0 }, { toleranceMm: 0.5 }, { samples: 3 }, { seed: 1.5 }]) {
      expect(() => planAssembly(body, sites, options)).toThrow(/INVALID_ARGUMENT/);
    }
    expect(() => planAssembly(body, [sites[0]!, sites[0]!])).toThrow(/sites/);
  });
});

describe('assign (Hungarian)', () => {
  function bruteForce(cost: Float64Array, n: number): number {
    let best = Infinity;
    const permute = (row: number, used: number, total: number): void => {
      if (row === n) {
        best = Math.min(best, total);
        return;
      }
      for (let c = 0; c < n; c++) if (!(used & (1 << c))) permute(row + 1, used | (1 << c), total + cost[row * n + c]!);
    };
    permute(0, 0, 0);
    return best;
  }

  it('finds a minimum-cost permutation (ties included)', () => {
    const rng = createRng(4);
    for (let trial = 0; trial < 60; trial++) {
      const n = 1 + (trial % 6);
      const cost = Float64Array.from({ length: n * n }, () => Math.round(rng() * 20));
      const result = assign(cost, n);
      expect(new Set(result).size).toBe(n);
      expect(Array.from(result).reduce((sum, c, row) => sum + cost[row * n + c]!, 0)).toBe(bruteForce(cost, n));
    }
    expect(() => assign(new Float64Array(3), 2)).toThrow(/shape/);
  });
});

describe('verifyAssemblyLayout', () => {
  const frames = makeFrames(4, 'lower', 12);
  const capture = placeBodies(frames, makeRevolutionBody());
  const cap = makeScanBody({ height: 2, chamfer: 0.3, flat: false }); // flat cap: its axis is the SHORT one
  const cube: TriMesh = {
    positions: Float32Array.of(-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -2, -2, 4, 2, -2, 4, 2, 2, 4, -2, 2, 4),
    indices: Uint32Array.of(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7),
  };

  it('accepts other bodies on the same axes and connections, in any order', () => {
    const order = [2, 0, 3, 1];
    const check = verifyAssemblyLayout(capture, placeBodies(order.map((k) => frames[k]!), cap));
    expect(check.compatible).toBe(true);
    expect(check.reason).toBe('ok');
    expect(check.matches.map((m) => [m.captureComponent, m.assemblyComponent])).toEqual([[0, 1], [1, 3], [2, 0], [3, 2]]);
    for (const m of check.matches) {
      expect(m.radialOffsetMm).toBeLessThan(1e-3);
      expect(m.endpointOffsetMm).toBeLessThan(1e-3);
      expect(m.axisAngleRad).toBeLessThan(1e-4);
    }
  });

  it('rejects a body moved sideways, a different count and bodies without a clear axis', () => {
    const moved = frames.map((f, i) => (i === 2 ? multiply(f, fromTranslation([0.6, 0, 0])) : f));
    const offset = verifyAssemblyLayout(capture, placeBodies(moved, cap));
    expect(offset).toMatchObject({ compatible: false, reason: 'offsets' });
    expect(offset.matches.filter((m) => !m.compatible).map((m) => m.captureComponent)).toEqual([2]);
    expect(offset.matches[2]!.radialOffsetMm).toBeCloseTo(0.6, 3);
    expect(verifyAssemblyLayout(capture, placeBodies(frames.slice(0, 3), cap))).toEqual({ compatible: false, reason: 'count', matches: [] });
    expect(verifyAssemblyLayout(capture, placeBodies(frames, cube))).toEqual({ compatible: false, reason: 'noAxis', matches: [] });
    expect(() => verifyAssemblyLayout(capture, capture, { radialToleranceMm: 2 })).toThrow(/INVALID_ARGUMENT/);
  });
});
