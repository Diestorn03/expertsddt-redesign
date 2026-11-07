import { describe, expect, it } from 'vitest';
import { fromTranslation, maxAbsDiff, transformDirection, transformPoint } from '../core/mat4';
import { createRng, gaussian } from '../core/sampling';
import type { ImplantSite, LandmarkPair, Mat4, Vec3 } from '../core/types';
import { cross, length, normalize, sub } from '../core/vec3';
import { makeFrames, makeSyntheticCase, randomRigid } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { alignFromLandmarks, guidePoint, landmarkAlign, orderSitesAlongArch } from './landmarks';
import { poseError } from './test-utils';

const truth = randomRigid(51, Math.PI, 20);
const pairOf = (p: Vec3): LandmarkPair => ({ source: p, target: transformPoint(truth, p) });
const sitesOf = (frames: readonly Mat4[]): ImplantSite[] => frames.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'demo', flags: {} }));

describe('landmarkAlign', () => {
  it('1 pair: translation only, orientation kept', () => {
    const fit = landmarkAlign([pairOf([3, 4, 5])]);
    expect(fit.mode).toBe('translation');
    expect(maxAbsDiff(fit.transform, fromTranslation(sub(transformPoint(truth, [3, 4, 5]), [3, 4, 5])))).toBeLessThan(1e-12);
    expect(fit.rmsMm).toBe(0);
  });

  it('2 pairs or collinear points: the line is aligned, the roll stays free', () => {
    for (const points of [[[0, 0, 0], [30, 4, 2]], [[0, 0, 0], [10, 2, 1], [20, 4, 2], [30, 6, 3]]] as Vec3[][]) {
      const fit = landmarkAlign(points.map(pairOf));
      expect(fit.mode).toBe('axis');
      expect(fit.rmsMm).toBeLessThan(1e-9);
      for (const p of points) expect(length(sub(transformPoint(fit.transform, p), transformPoint(truth, p)))).toBeLessThan(1e-9);
      // Minimal rotation: a direction perpendicular to both line directions is not turned.
      const u = normalize(sub(points[1]!, points[0]!)), v = normalize(transformDirection(truth, u));
      const w = normalize(cross(u, v));
      expect(length(sub(transformDirection(fit.transform, w), w))).toBeLessThan(1e-9);
    }
  });

  it('3 and 4 non-collinear pairs: the full rigid transform', () => {
    const points: Vec3[] = [[0, 0, 0], [30, 5, 2], [12, 28, -3], [-8, 15, 6]];
    for (const n of [3, 4]) {
      const fit = landmarkAlign(points.slice(0, n).map(pairOf));
      expect(fit.mode).toBe('full');
      expect(maxAbsDiff(fit.transform, truth)).toBeLessThan(1e-9);
    }
    const rng = createRng(4);
    const noisy = points.map((p) => ({ source: p, target: transformPoint(truth, p).map((v) => v + 0.2 * gaussian(rng)) as Vec3 }));
    expect(landmarkAlign(noisy).rmsMm).toBeGreaterThan(0.05);
  });

  it('rejects empty, non-finite and coincident clicks', () => {
    expect(() => landmarkAlign([])).toThrow(expect.objectContaining({ code: 'LANDMARKS_INVALID', details: { reason: 'none' } }));
    expect(() => landmarkAlign([{ source: [0, 0, Number.NaN], target: [0, 0, 0] }])).toThrow(expect.objectContaining({ details: { reason: 'nonFinite' } }));
    // @ts-expect-error a malformed pair from the UI is refused, not trusted
    expect(() => landmarkAlign([{ source: [0, 0], target: [0, 0, 0] }])).toThrow(expect.objectContaining({ details: { reason: 'nonFinite' } }));
    expect(() => landmarkAlign([pairOf([1, 1, 1]), pairOf([1, 1, 1])])).toThrow(expect.objectContaining({ details: { reason: 'coincident' } }));
    expect(() => landmarkAlign([pairOf([1, 1, 1]), { source: [5, 5, 5], target: transformPoint(truth, [1, 1, 1]) }])).toThrow(
      expect.objectContaining({ details: { reason: 'coincident' } }),
    );
  });
});

describe('guided points and click order', () => {
  it('guidePoint is the top centre of the body in capture coordinates', () => {
    const c = makeSyntheticCase({ implants: 2, seed: 3 });
    // makeScanBody: x from -2.5 to 2 (flat at +X), y ±2.5, top at 6.6.
    const p = guidePoint(c.sites[1]!, c.body);
    const expected = transformPoint(c.frames[1]!, [-0.25, 0, 6.6]);
    expect(length(sub(p, expected))).toBeLessThan(1e-5);
  });

  it('orders sites from one end of the arch to the other, whatever the input order', () => {
    const shuffle = <T>(items: T[], seed: number): T[] => {
      const rng = createRng(seed), out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    };
    const cases = [
      makeFrames(6, 'lower'),
      makeFrames(5, 'upper', 9),
      makeFrames(8, 'lower', 3, { halfWidthMm: 12, depthMm: 40 }), // deeper than wide: projection alone would interleave the sides
      makeFrames(2, 'lower'),
    ];
    for (const frames of cases) {
      const sites = sitesOf(frames);
      const ids = sites.map((s) => s.id);
      for (const seed of [1, 2, 3]) expect(orderSitesAlongArch(shuffle(sites, seed)).map((s) => s.id)).toEqual(ids);
    }
    const line = sitesOf([0, 2, 1].map((k) => fromTranslation([0, 10 * k, 0])));
    expect(orderSitesAlongArch(line).map((s) => s.id)).toEqual(['site-1', 'site-3', 'site-2']);
    expect(orderSitesAlongArch([])).toEqual([]);
  });
});

describe('alignFromLandmarks', () => {
  it.each([
    { pairs: 1, maxAngleRad: 0.05, mode: 'translation' },
    { pairs: 2, maxAngleRad: 0.15, mode: 'axis' },
    { pairs: 3, maxAngleRad: Math.PI, mode: 'full' },
    { pairs: 4, maxAngleRad: Math.PI, mode: 'full' },
  ] as const)('$pairs click(s) with 0.2 mm click error refine to the truth', ({ pairs, maxAngleRad, mode }) => {
    const c = makeSyntheticCase({ seed: 60 + pairs, implants: 4, maxAngleRad });
    const rng = createRng(pairs);
    const chosen = [[0], [0, 3], [0, 1, 3], [0, 1, 2, 3]][pairs - 1]!;
    const clicks = chosen.map((k): LandmarkPair => {
      const source = guidePoint(c.sites[k]!, c.body);
      const target = transformPoint(c.captureToJaw, source).map((v) => v + 0.2 * gaussian(rng) / Math.sqrt(3)) as Vec3;
      return { source, target };
    });
    expect(landmarkAlign(clicks).mode).toBe(mode);
    const result = alignFromLandmarks(c.parts, buildIcpTarget(c.jaw), clicks);
    const e = poseError(result.transform, c.captureToJaw, c.frames);
    expect(e.mm).toBeLessThan(0.02);
    expect(e.deg).toBeLessThan(0.05);
    expect(result.method).toBe('landmarks');
    expect(result.status).toBe('good');
    expect(result.flags.includes('landmarkAxisFree')).toBe(mode === 'axis');
    expect(result.flags).not.toContain('landmarkTranslationOnly');
  });

  it('keeps the clicked pose when there is nothing to refine against', () => {
    const c = makeSyntheticCase({ seed: 66, implants: 2 });
    const source = guidePoint(c.sites[0]!, c.body);
    const result = alignFromLandmarks(c.parts, buildIcpTarget(c.jaw), [{ source, target: [source[0] + 500, source[1], source[2]] }]);
    expect(result.flags).toContain('landmarkTranslationOnly');
    expect(result.status).toBe('failed');
    expect(maxAbsDiff(result.transform, fromTranslation([500, 0, 0]))).toBeLessThan(1e-9);
  });
});
