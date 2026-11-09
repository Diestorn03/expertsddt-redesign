/**
 * Global search and finish on the situations of Fernando's real cases, rebuilt synthetically: an implant set
 * whose principal axes turn 15-35° away from the jaw's, bodies half under the gum, scanned bodies that sit a
 * little off the photogrammetry layout, a near rival. The HEAD engine before align-robust failed each of them.
 */
import { describe, expect, it } from 'vitest';
import { fromAxisAngle, fromTranslation, multiply, transformDirection } from '../core/mat4';
import { mergeMeshes, transformMesh } from '../core/mesh';
import { createRng } from '../core/sampling';
import type { AssemblyPart, Mat4 } from '../core/types';
import { dot } from '../core/vec3';
import { addNoise, makeSyntheticCase, placeBodies, type SyntheticCaseOptions } from '../test/fixtures';
import { buildIcpTarget, poseScore, sampleParts, type IcpTarget } from './icp';
import { pointPca, surfacePca } from './metrics';
import { multiStartAlign } from './multistart';
import { poseError, visibleAbove } from './test-utils';

/** Angle (°) between the set's main axis, placed by the truth, and the jaw's: what the 24 PCA matchings get wrong. */
function axesApartDeg(parts: readonly AssemblyPart[], captureToJaw: Mat4, target: IcpTarget): number {
  const set = transformDirection(captureToJaw, surfacePca(parts.map((p) => p.mesh)).axes[0]);
  return (Math.acos(Math.min(1, Math.abs(dot(set, pointPca(target.points).axes[0])))) * 180) / Math.PI;
}

/** Five implants over part of the arch, bodies 2.5 mm under the gum, 10 µm noise on the jaw. */
function oneSided(seed: number, extra: Partial<SyntheticCaseOptions> = {}) {
  const c = makeSyntheticCase({ seed, implants: 5, maxAngleRad: Math.PI, span: [0.2, 0.7], flat: false, ...extra });
  const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, placeBodies(c.frames, visibleAbove(c.body, 2.5))]), c.captureToJaw), 0.01, seed + 9);
  return { c, target: buildIcpTarget(jaw) };
}

describe('multiStartAlign: a set whose principal axes differ 15-35° from the jaw\'s', () => {
  it('round scan bodies half under the gum: found from any start (seeded from the scanned bodies)', { timeout: 30_000 }, () => {
    for (const seed of [1, 3, 6]) { // HEAD before align-robust: turned 165-180°, status failed
      const { c, target } = oneSided(seed);
      const apart = axesApartDeg(c.parts, c.captureToJaw, target);
      expect(apart).toBeGreaterThan(15);
      expect(apart).toBeLessThan(35);
      const r = multiStartAlign(c.parts, target);
      const e = poseError(r.transform, c.captureToJaw, c.frames);
      expect({ seed, mm: e.mm < 0.05, deg: e.deg < 0.2 }).toEqual({ seed, mm: true, deg: true });
      expect(r.status).toBe('weak'); // buried samples count in the metrics
      expect(r.flags).toEqual(['visualCheckRequired']);
    }
  });

  it('prism bodies with no round wall (no seeds): the turns about the jaw\'s normal find them', { timeout: 30_000 }, () => {
    for (const seed of [1, 5, 6]) { // HEAD before align-robust: 6-27 mm off, status failed
      const { c, target } = oneSided(seed, { bodyOptions: { segments: 5 } });
      const apart = axesApartDeg(c.parts, c.captureToJaw, target);
      expect(apart).toBeGreaterThan(15);
      expect(apart).toBeLessThan(35);
      const e = poseError(multiStartAlign(c.parts, target).transform, c.captureToJaw, c.frames);
      expect({ seed, mm: e.mm < 0.05, deg: e.deg < 0.2 }).toEqual({ seed, mm: true, deg: true });
    }
  });
});

describe('multiStartAlign: finish and finalists', () => {
  it('scanned bodies a little off the photogrammetry layout: the result scores at least as well as the true pose', () => {
    // Each scanned body tilted 1.5° and shifted 0.1 mm, as intraoral vs photogrammetry differ. HEAD before
    // align-robust stopped at a fixed point of the trimmed ICP that its own poseScore rates worse than the truth.
    const c = makeSyntheticCase({ seed: 4, implants: 4, maxAngleRad: Math.PI });
    const rng = createRng(4 * 31);
    const scanned = c.frames.map((f) => {
      const a = rng() * 2 * Math.PI, b = rng() * 2 * Math.PI;
      const off = multiply(fromTranslation([0.1 * Math.cos(b), 0.1 * Math.sin(b), 0]), fromAxisAngle([Math.cos(a), Math.sin(a), 0], (1.5 * Math.PI) / 180));
      return transformMesh(c.body, multiply(f, off));
    });
    const target = buildIcpTarget(addNoise(transformMesh(mergeMeshes([c.archMesh, ...scanned]), c.captureToJaw), 0.01, 4));
    const r = multiStartAlign(c.parts, target);
    const samples = sampleParts(c.parts, 2500, 1);
    expect(poseScore(samples, target.surface, r.transform, 0.1)).toBeLessThan(poseScore(samples, target.surface, c.captureToJaw, 0.1));
    expect(poseError(r.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.15);
  });

  it('a near rival (the bodies scanned twice, the copy turned 4.5°: not distinct) ends as a finalist and flags the result', () => {
    const c = makeSyntheticCase({ seed: 2, implants: 4, maxAngleRad: Math.PI });
    const turn = fromAxisAngle([0, 0, 1], (4.5 * Math.PI) / 180, surfacePca(c.parts.map((p) => p.mesh)).centroid);
    const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, c.captureMesh, transformMesh(c.captureMesh, turn)]), c.captureToJaw), 0.005, 2);
    const copy = multiply(c.captureToJaw, turn);
    // The previous pose on the copy, a strict 'good' so the global search runs too and finds the original.
    const r = multiStartAlign(c.parts, buildIcpTarget(jaw), { initial: copy, quality: { goodRmsMm: 0.001 } });
    expect(r.flags).toContain('ambiguousAlternative');
    expect(r.status).toBe('ambiguous');
    expect(Math.min(poseError(r.transform, c.captureToJaw, c.frames).mm, poseError(r.transform, copy, c.frames).mm)).toBeLessThan(0.02);
  });
});
