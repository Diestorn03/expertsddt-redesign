import { describe, expect, it } from 'vitest';
import { makeSyntheticCase } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { DEFAULT_QUALITY, multiStartAlign } from './multistart';
import { poseError } from './test-utils';

describe('multiStartAlign: recovers random rigid transforms (spec 7.5)', () => {
  // Rotations up to 180° about a random axis, translations up to 15 mm, flat (indexed) bodies, no noise.
  it.each([
    { seed: 21, implants: 4 },
    { seed: 22, implants: 2 },
    { seed: 23, implants: 6 },
  ])('seed $seed, $implants implants: within 20 µm and 0.05°', ({ seed, implants }) => {
    const c = makeSyntheticCase({ seed, implants, maxAngleRad: Math.PI });
    const result = multiStartAlign(c.parts, buildIcpTarget(c.jaw));
    const e = poseError(result.transform, c.captureToJaw, c.frames);
    expect(e.mm).toBeLessThan(0.02);
    expect(e.deg).toBeLessThan(0.05);
    expect(result).toMatchObject({ method: 'auto', status: 'good', flags: ['visualCheckRequired'], toleranceMm: 0.1, coverage: 1 });
    expect(result.rmsMm).toBeLessThan(0.002);
    expect(result.perSite.map((s) => s.siteId)).toEqual(c.sites.map((s) => s.id));
    expect(result.perSite.every((s) => s.coverage === 1 && s.samples === 400)).toBe(true);
  });

  it('keeps the thresholds in one place', () => {
    expect(DEFAULT_QUALITY).toEqual({
      goodRmsMm: 0.05,
      goodCoverage: 0.95,
      acceptableRmsMm: 0.1,
      acceptableCoverage: 0.8,
      ambiguityRatio: 1.1,
      ambiguitySlackMm: 0.005,
      usableCoverage: 0.4,
      symmetryTolerance: 0.01,
    });
    expect(Object.isFrozen(DEFAULT_QUALITY)).toBe(true);
  });
});
