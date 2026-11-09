import { describe, expect, it } from 'vitest';
import { fromAxisAngle, fromRowMajor, fromTranslation, getColumn, multiply, transformDirection, transformPoint } from '../core/mat4';
import { createRng, gaussian, sampleSurface } from '../core/sampling';
import type { Vec3 } from '../core/types';
import { add, normalize, scale } from '../core/vec3';
import type { FitMetrics } from './metrics';
import { makeRevolutionBody, makeScanBody, makeSyntheticCase } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { DEFAULT_QUALITY, isSymmetric, measureFit, measureManualPose, resolveQuality, statusOf, surfacePca } from './metrics';
import { bruteDistance2, buriedJaw, flipWinding } from './test-utils';

const c = makeSyntheticCase({ seed: 71, implants: 2, archOptions: { segmentsAlong: 32, segmentsAcross: 4 } });
const target = buildIcpTarget(c.jaw);

describe('measureFit', () => {
  it('is zero at the true pose and reports every site', () => {
    const m = measureFit(c.parts, target, c.captureToJaw, { samplesPerSite: 120 });
    expect(m.rmsMm).toBeLessThan(1e-4);
    expect(m.coverage).toBe(1);
    expect(m.perSite).toEqual(c.sites.map((s) => expect.objectContaining({ siteId: s.id, samples: 120, coverage: 1 })));
  });

  it('matches brute-force point-to-surface distances on a shifted pose', () => {
    const shifted = multiply(fromTranslation([0.06, -0.03, 0.04]), c.captureToJaw);
    const per = 60, tolerance = 0.05;
    const m = measureFit(c.parts, target, shifted, { samplesPerSite: per, toleranceMm: tolerance, seed: 5 });
    const all: number[] = [];
    c.parts.forEach((part, k) => {
      const p = sampleSurface(part.mesh, per, 5 + k).points;
      for (let i = 0; i < per; i++) {
        const q = transformPoint(shifted, [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!]);
        all.push(Math.sqrt(bruteDistance2(c.jaw, q[0], q[1], q[2])));
      }
    });
    all.sort((a, b) => a - b);
    expect(m.rmsMm).toBeCloseTo(Math.sqrt(all.reduce((s, d) => s + d * d, 0) / all.length), 6);
    expect(m.p95Mm).toBeCloseTo(all[Math.ceil(0.95 * all.length) - 1]!, 6);
    expect(m.coverage).toBe(all.filter((d) => d <= tolerance).length / all.length);
    expect(m.rmsMm).toBeGreaterThan(0.01);
  });

  it('validates its inputs', () => {
    expect(() => measureFit(c.parts, target, c.captureToJaw, { toleranceMm: 0 })).toThrow(expect.objectContaining({ details: { reason: 'toleranceMm' } }));
    expect(() => measureFit(c.parts, target, c.captureToJaw, { samplesPerSite: 0.5 })).toThrow(expect.objectContaining({ details: { reason: 'samplesPerSite' } }));
    expect(() => measureFit(c.parts, target, new Float64Array(16))).toThrow(expect.objectContaining({ code: 'MATRIX_NOT_RIGID' }));
  });
});

describe('measureFit: only the part of the bodies the scan sees', () => {
  // Four bodies 2 mm deep in the gum (Fernando's scan bodies show 3.3-6.6 mm of their 6.6): the scan holds a gum line
  // around each body and the body above it, nothing below.
  const sc = makeSyntheticCase({ seed: 73, implants: 4, bodyOptions: { heightSegments: 12 } });
  const gum = buriedJaw(sc, 2);
  const tg = buildIcpTarget(gum);
  const exact = measureFit(sc.parts, tg, sc.captureToJaw);
  const mean = (vs: Vec3[]): Vec3 => scale(vs.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / vs.length);
  const centre = transformPoint(sc.captureToJaw, mean(sc.frames.map((f) => getColumn(f, 3))));
  const up = normalize(transformDirection(sc.captureToJaw, mean(sc.frames.map((f) => getColumn(f, 2)))));

  it('leaves out what lies under the gum: the exact pose is good, where the whole-body metric read weak', () => {
    expect(exact.coverage).toBeGreaterThan(0.95); // the 0.3 mm under the gum line still count, a little off
    expect(exact.rmsMm).toBeLessThan(0.05);
    expect(exact.visible).toBeGreaterThan(DEFAULT_QUALITY.minVisible);
    expect(exact.visible).toBeLessThan(0.75);
    expect(exact.perSite.every((s) => s.coverage > 0.95 && s.visible > DEFAULT_QUALITY.minVisible && s.visible < 0.75)).toBe(true);
    expect(statusOf(exact, [], DEFAULT_QUALITY)).toBe('good');
    expect(exact.coverage * exact.visible).toBeLessThan(0.8); // the share of every sample within the tolerance: weak before
  });

  it('a pose 2 mm and 3° off fails in any direction, and so do the bodies pushed 2 mm out of the gum or into it', () => {
    const rng = createRng(73);
    const dir = (): Vec3 => normalize([gaussian(rng), gaussian(rng), gaussian(rng)]);
    for (let k = 0; k < 6; k++) {
      const off = multiply(fromTranslation(scale(dir(), 2)), fromAxisAngle(dir(), (3 * Math.PI) / 180, centre));
      expect(statusOf(measureFit(sc.parts, tg, multiply(off, sc.captureToJaw)), [], DEFAULT_QUALITY)).toBe('failed');
    }
    for (const mm of [2, -2]) { // out: the tops float where the scan shows nothing; in: they sink under the scanned tops
      expect(statusOf(measureFit(sc.parts, tg, multiply(fromTranslation(scale(up, mm)), sc.captureToJaw)), [], DEFAULT_QUALITY)).toBe('failed');
    }
  });

  it('does not depend on the winding of the jaw scan or of the parts', () => {
    const flippedJaw = measureFit(sc.parts, buildIcpTarget(flipWinding(gum)), sc.captureToJaw);
    expect([flippedJaw.visible, flippedJaw.coverage]).toEqual([exact.visible, exact.coverage]);
    expect(flippedJaw.rmsMm).toBeCloseTo(exact.rmsMm, 9);
    const flippedParts = measureFit(sc.parts.map((p) => ({ ...p, mesh: flipWinding(p.mesh) })), tg, sc.captureToJaw);
    expect(flippedParts.coverage).toBeGreaterThan(0.95);
    expect(flippedParts.visible).toBeCloseTo(exact.visible, 1);
  });
});

describe('measureManualPose and status', () => {
  it('measures a hand-placed pose as manual', () => {
    const good = measureManualPose(c.parts, target, c.captureToJaw);
    expect(good).toMatchObject({ method: 'manual', status: 'good', flags: ['visualCheckRequired', 'manualPose'] });
    const off = measureManualPose(c.parts, target, multiply(fromTranslation([3, 0, 0]), c.captureToJaw));
    expect(off.status).toBe('failed');
    expect(() => measureManualPose(c.parts, target, fromRowMajor([2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))).toThrow(
      expect.objectContaining({ code: 'MATRIX_NOT_RIGID' }),
    );
    const round = makeSyntheticCase({ seed: 72, implants: 1, flat: false });
    const result = measureManualPose(round.parts, buildIcpTarget(round.jaw), round.captureToJaw);
    expect(result.flags).toContain('symmetricSource');
    expect(result.status).toBe('ambiguous');
  });

  it('applies failed > ambiguous > good > acceptable > weak with the configured thresholds', () => {
    const q = DEFAULT_QUALITY;
    const m = (rmsMm: number, coverage: number, visible = 0.8): FitMetrics => ({ rmsMm, p95Mm: rmsMm, coverage, visible, perSite: [] });
    expect(statusOf(m(0.01, 0.44), [], q)).toBe('failed');
    expect(statusOf(m(0.01, 1), ['ambiguousAlternative'], q)).toBe('ambiguous');
    expect(statusOf(m(0.01, 1), ['symmetricSource'], q)).toBe('ambiguous');
    expect(statusOf(m(0.11, 0.75), [], q)).toBe('good');
    expect(statusOf(m(0.12, 0.9), [], q)).toBe('acceptable');
    expect(statusOf(m(0.16, 0.5), [], q)).toBe('acceptable');
    expect(statusOf(m(0.17, 0.9), [], q)).toBe('weak');
    expect(statusOf(m(0.05, 0.49), [], q)).toBe('weak');
    expect(statusOf(m(0.01, 1, 0.54), [], q)).toBe('weak'); // too little of the bodies in the scan to trust it
    expect(statusOf(m(0.12, 0.9), [], resolveQuality({ goodRmsMm: 0.15, goodCoverage: 0.85 }))).toBe('good');
    expect(() => resolveQuality({ minVisible: 1.5 })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
    expect(() => resolveQuality({ siteUsableCoverage: -0.1 })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
    expect(() => resolveQuality({ ambiguityRatio: 0.5 })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
    expect(() => resolveQuality({ ambiguitySlackMm: -0.001 })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
  });

  it('flags rotationally symmetric sources from the exact surface PCA', () => {
    const tolerance = DEFAULT_QUALITY.symmetryTolerance;
    expect(isSymmetric(surfacePca([makeRevolutionBody()]).variances, tolerance)).toBe(true);
    expect(isSymmetric(surfacePca([makeScanBody()]).variances, tolerance)).toBe(false);
    expect(isSymmetric(surfacePca(c.parts.map((p) => p.mesh)).variances, tolerance)).toBe(false);
  });
});
