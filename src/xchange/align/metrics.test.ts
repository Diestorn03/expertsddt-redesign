import { describe, expect, it } from 'vitest';
import { fromRowMajor, fromTranslation, multiply, transformPoint } from '../core/mat4';
import { sampleSurface } from '../core/sampling';
import type { FitMetrics } from './metrics';
import { makeRevolutionBody, makeScanBody, makeSyntheticCase } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { DEFAULT_QUALITY, isSymmetric, measureFit, measureManualPose, resolveQuality, statusOf, surfacePca } from './metrics';
import { bruteDistance2 } from './test-utils';

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
    const m = (rmsMm: number, coverage: number): FitMetrics => ({ rmsMm, p95Mm: rmsMm, coverage, perSite: [] });
    expect(statusOf(m(0.01, 0.3), [], q)).toBe('failed');
    expect(statusOf(m(0.01, 1), ['ambiguousAlternative'], q)).toBe('ambiguous');
    expect(statusOf(m(0.01, 1), ['symmetricSource'], q)).toBe('ambiguous');
    expect(statusOf(m(0.05, 0.95), [], q)).toBe('good');
    expect(statusOf(m(0.08, 0.9), [], q)).toBe('acceptable');
    expect(statusOf(m(0.2, 0.9), [], q)).toBe('weak');
    expect(statusOf(m(0.08, 0.9), [], resolveQuality({ goodRmsMm: 0.1, goodCoverage: 0.85 }))).toBe('good');
    expect(() => resolveQuality({ ambiguityRatio: 0.5 })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
  });

  it('flags rotationally symmetric sources from the exact surface PCA', () => {
    const tolerance = DEFAULT_QUALITY.symmetryTolerance;
    expect(isSymmetric(surfacePca([makeRevolutionBody()]).variances, tolerance)).toBe(true);
    expect(isSymmetric(surfacePca([makeScanBody()]).variances, tolerance)).toBe(false);
    expect(isSymmetric(surfacePca(c.parts.map((p) => p.mesh)).variances, tolerance)).toBe(false);
  });
});
