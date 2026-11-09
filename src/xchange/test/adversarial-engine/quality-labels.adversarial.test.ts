/**
 * Adversarial review of the engine slices after 3d10f75 (quality-views): quality labels on the visible part of the
 * bodies. Fixed with the review findings: they now guard against regressions. Synthetic data only (test/fixtures,
 * align/test-utils).
 */
import { describe, expect, it } from 'vitest';
import { fromTranslation, getColumn, multiply, transformDirection } from '../../core/mat4';
import type { Vec3 } from '../../core/types';
import { add, normalize, scale } from '../../core/vec3';
import { buildIcpTarget } from '../../align/icp';
import { measureFit, measureManualPose } from '../../align/metrics';
import { buriedJaw } from '../../align/test-utils';
import { makeSyntheticCase } from '../fixtures';

describe('visible-part metrics: a set pushed along the implant axes into the gum', () => {
  // Scan bodies standing almost whole above the gum (0.5 mm deep: Fernando's case 4 shows 5.9-6.6 mm of 6.6).
  const sc = makeSyntheticCase({ seed: 73, implants: 4, bodyOptions: { heightSegments: 12 } });
  const target = buildIcpTarget(buriedJaw(sc, 0.5));
  const mean = (vs: Vec3[]): Vec3 => scale(vs.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / vs.length);
  const up = normalize(transformDirection(sc.captureToJaw, mean(sc.frames.map((f) => getColumn(f, 2)))));
  const sunk = (mm: number) => multiply(fromTranslation(scale(up, -mm)), sc.captureToJaw);

  it('BUG: a hand move of 0.5 mm into the gum (the adjust pad, a drag) is still labelled good, with a lower rms than 0.3 mm', () => {
    // Failure: the tops pushed more than 3 tolerances (0.3 mm) behind the scanned tops become "hidden" (metrics.ts
    // jawDistances: d > gate and not facing the scan's outside) instead of counting as misses, so the fit gets better
    // the further the set sinks. Real arches (review probe): a 0.4 mm sink reads good on 3 of 8, a 1 mm sink acceptable on 5.
    expect(measureManualPose(sc.parts, target, sc.captureToJaw).status).toBe('good'); // the true pose
    const at03 = measureFit(sc.parts, target, sunk(0.3)), at05 = measureFit(sc.parts, target, sunk(0.5));
    expect(at05.rmsMm).toBeGreaterThanOrEqual(at03.rmsMm); // farther from the truth must not fit better
    expect(measureManualPose(sc.parts, target, sunk(0.5)).status).not.toBe('good');
  });
});
