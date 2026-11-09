/**
 * Adversarial alignment cases: symmetric sources, partial / cluttered jaws, wrong units, hostile
 * landmark clicks. Tests named "BUG:" fail on purpose until the production code is fixed (see the
 * review findings); the others document attacks that hold.
 */
import { describe, expect, it } from 'vitest';
import { fromAxes, fromAxisAngle, fromTranslation, maxAbsDiff, multiply, transformPoint } from '../../core/mat4';
import { mergeMeshes, transformMesh } from '../../core/mesh';
import type { AssemblyPart, LandmarkPair, Mat4, TriMesh, Vec3 } from '../../core/types';
import { distance } from '../../core/vec3';
import { buildIcpTarget } from '../../align/icp';
import { landmarkAlign } from '../../align/landmarks';
import { multiStartAlign } from '../../align/multistart';
import { poseError } from '../../align/test-utils';
import { addNoise, makeArch, makeFrames, makeRevolutionBody, makeSyntheticCase, placeBodies, randomRigid } from '../fixtures';

/** Two identical round bodies with parallel axes: the source is invariant under a 180° turn about the vertical axis between them. */
function parallelRoundPair(seed: number, noiseMm: number) {
  const body = makeRevolutionBody();
  const frames: Mat4[] = [fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [-8, 36, 4]), fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [8, 36, 4])];
  const parts: AssemblyPart[] = frames.map((f, i) => ({ siteId: `site-${i + 1}`, mesh: transformMesh(body, f) }));
  const truth = randomRigid(seed, Math.PI, 15);
  const moved = transformMesh(mergeMeshes([makeArch('lower'), ...parts.map((p) => p.mesh)]), truth);
  return { parts, target: buildIcpTarget(noiseMm > 0 ? addNoise(moved, noiseMm, seed + 9) : moved) };
}

describe('multiStartAlign: exactly symmetric sources', () => {
  it('BUG: two identical parallel round bodies (exact 180° swap) are reported good, not ambiguous, when residuals are ~0', { timeout: 20_000 }, () => {
    // Noise-free (e.g. capture and jaw cut from the same scan) and 0.5 µm noise: the swapped pose fits exactly as well.
    for (const [seed, noise] of [[1, 0], [2, 0.0005]] as const) {
      const { parts, target } = parallelRoundPair(seed, noise);
      const result = multiStartAlign(parts, target);
      expect({ seed, status: result.status, flagged: result.flags.includes('ambiguousAlternative') }).toEqual({ seed, status: 'ambiguous', flagged: true });
    }
  });

  it('the same pair on a 10 µm-noise jaw is flagged ambiguous', { timeout: 20_000 }, () => {
    const { parts, target } = parallelRoundPair(1, 0.01);
    const result = multiStartAlign(parts, target);
    expect(result.status).toBe('ambiguous');
    expect(result.flags).toContain('ambiguousAlternative');
  });
});

describe('multiStartAlign: hostile jaws and units', () => {
  const c = makeSyntheticCase({ seed: 71, implants: 4, maxAngleRad: Math.PI });

  it('a jaw scan holding only 2 of the 4 scan bodies: right pose, reported weak (not good)', { timeout: 20_000 }, () => {
    const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, c.parts[0]!.mesh, c.parts[1]!.mesh]), c.captureToJaw), 0.005, 1);
    const result = multiStartAlign(c.parts, buildIcpTarget(jaw));
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
    expect(result.status).toBe('weak');
  });

  it('round decoy bodies in the jaw and half its triangles wound the other way: still good', { timeout: 20_000 }, () => {
    const decoys = placeBodies(makeFrames(3, 'lower', 121).map((f) => multiply(fromTranslation([0, -6, 0]), f)), makeRevolutionBody());
    const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, c.captureMesh, decoys]), c.captureToJaw), 0.005, 2);
    const idx = jaw.indices.slice();
    for (let t = 0; t < idx.length; t += 6) [idx[t + 1], idx[t + 2]] = [idx[t + 2]!, idx[t + 1]!];
    const result = multiStartAlign(c.parts, buildIcpTarget({ positions: jaw.positions, indices: idx }));
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
    expect(result.status).toBe('good');
  });

  it('a capture in centimetres against a jaw in millimetres is never good or acceptable', { timeout: 20_000 }, () => {
    const cm: AssemblyPart[] = c.parts.map((p) => ({ siteId: p.siteId, mesh: { positions: Float32Array.from(p.mesh.positions, (v) => v / 10), indices: p.mesh.indices } as TriMesh }));
    const result = multiStartAlign(cm, buildIcpTarget(c.jaw));
    expect(['good', 'acceptable']).not.toContain(result.status);
  });
});

describe('landmarkAlign: hostile clicks', () => {
  const truth = multiply(fromTranslation([5e4, -3e4, 2e4]), fromAxisAngle([1, 1, 0], Math.PI)); // 180° flip, ~60 km away
  const pair = (p: Vec3): LandmarkPair => ({ source: p, target: transformPoint(truth, p) });

  it('a 180° flip far from the origin: exact with 3 nearly collinear clicks (2 % sideways) and with 3 on a line + 1 off it', () => {
    for (const points of [
      [[0, 0, 0], [10, 0.3, 0], [20, 0, 0.1]],
      [[0, 0, 0], [10, 0, 0], [20, 0, 0], [10, 8, 3]],
    ] as Vec3[][]) {
      const fit = landmarkAlign(points.map(pair));
      expect(fit.mode).toBe('full');
      expect(maxAbsDiff(fit.transform, truth)).toBeLessThan(1e-6);
    }
  });

  it('collinear and reversed clicks still land every click on its target (roll free)', () => {
    const line: Vec3[] = [[0, 0, 0], [7, 1, 0.5], [14, 2, 1]];
    for (const pairs of [line.map(pair), line.map(pair).reverse(), [pair([30, 4, 2]), pair([0, 0, 0])]]) {
      const fit = landmarkAlign(pairs);
      expect(fit.mode).toBe('axis');
      for (const p of pairs) expect(distance(transformPoint(fit.transform, p.source), p.target)).toBeLessThan(1e-6);
    }
  });
});
