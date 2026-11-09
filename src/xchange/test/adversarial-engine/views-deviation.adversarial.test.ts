/**
 * Adversarial review of the engine slices after 3d10f75 (quality-views): view presets per case and the colour map of
 * the visible part. Fixed with the review findings: they now guard against regressions. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import { fromTranslation, getColumn, transformDirection } from '../../core/mat4';
import { computeVertexNormals, transformMesh } from '../../core/mesh';
import type { Vec3 } from '../../core/types';
import { dot } from '../../core/vec3';
import { deviationToSurface, partDeviations } from '../../align/deviation';
import { buildIcpTarget } from '../../align/icp';
import { flipWinding } from '../../align/test-utils';
import { archFrame, jawShape } from '../../viewer/presets';
import { makeArch, makeFrames, makeRevolutionBody, makeSyntheticCase } from '../fixtures';

const deg = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, dot(a, b) / Math.hypot(...a) / Math.hypot(...b))) * 180) / Math.PI;

describe('view presets from the jaw scan alone (the set not aligned yet: Fernando\'s CSVs arrive 43-91 mm away)', () => {
  it('BUG: a jaw scan wound the other way turns the occlusal view upside down (the metrics are winding-agnostic, the views are not)', () => {
    // Failure: presets.ts archFrame takes the occlusal side from the jaw's mean vertex normal, whose sign is the
    // file's winding; loadJaw ends on view('occlusal'), so the first look at such a scan is from inside the tissue.
    const jaw = makeArch('lower');
    const flipped = flipWinding(jaw);
    const asWound = archFrame([], jawShape(jaw.positions, computeVertexNormals(jaw)))!;
    const otherWay = archFrame([], jawShape(flipped.positions, computeVertexNormals(flipped)))!;
    expect(deg(asWound.occlusal, [0, 0, 1])).toBeLessThan(10);
    expect(deg(otherWay.occlusal, [0, 0, 1])).toBeLessThan(10);
  });
});

describe('view presets from the implants (quality-views archFrame)', () => {
  it('BUG: three or four implants on one side of the arch (molar to lateral incisor) turn the front view ~60° toward the cheek', () => {
    // Failure: presets.ts implantArch takes "anterior" across the line through the two implants farthest apart, toward
    // the others: on a one-sided set the others lie on the outer (buccal) side of that line, not in front of it. The jaw
    // outline alone gets it within 2° here (a shorter span, which implantArch leaves to the jaw, does).
    for (const arch of ['lower', 'upper'] as const) {
      const jaw = makeArch(arch); // anterior +Y
      const shape = jawShape(jaw.positions, computeVertexNormals(jaw));
      for (const n of [3, 4]) {
        const implants = makeFrames(n, arch, 5, {}, [0, 0.45]).map((m) => ({ origin: getColumn(m, 3), axis: transformDirection(m, [0, 0, 1]) }));
        const f = archFrame(implants, shape)!;
        expect(deg(f.occlusal, [0, 0, arch === 'lower' ? 1 : -1])).toBeLessThan(10);
        expect(deg(f.anterior, [0, 1, 0])).toBeLessThan(20);
      }
    }
  });
});

describe('partDeviations (the colour map, re-run 250 ms after every pose change)', () => {
  it('BUG: on a set dragged 40 mm from the jaw it is ~100x slower than the bounded map it replaced (unbounded search)', () => {
    // Failure: partDeviations calls jawDistances with maxMm = Infinity, so every vertex walks the triangle tree until it
    // finds the jaw, where deviationToSurface stopped at maxUm (1 mm). Heavy parts (an FP3 at MUA level is 119 k
    // triangles; 6 of them ~360 k vertices) take seconds of align-worker time per gesture.
    const c = makeSyntheticCase({ implants: 6, seed: 4 });
    const surface = buildIcpTarget(c.jaw).surface;
    const body = makeRevolutionBody({ segments: 200, heightSegments: 60 });
    const parts = c.sites.slice(0, 3).map((s) => ({ siteId: s.id, mesh: transformMesh(body, s.matrix) })); // 37 k vertices
    const far = fromTranslation([40, 0, 0]); // capture -> jaw: the set beside the arch, as it arrives or while dragged
    const time = (fn: () => void): number => { const t0 = performance.now(); fn(); return performance.now() - t0; };
    time(() => partDeviations(parts.slice(0, 1), surface, far)); // warm-up
    const bounded = time(() => { for (const p of parts) deviationToSurface(p.mesh, surface, far); });
    const now = time(() => partDeviations(parts, surface, far));
    expect(now).toBeLessThan(10 * bounded + 100);
  }, 60_000);
});
