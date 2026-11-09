import { describe, expect, it } from 'vitest';
import { fromAxisAngle, fromTranslation, multiply } from '../core/mat4';
import { makeSyntheticCase } from '../test/fixtures';
import { buildIcpTarget, checkParts, icp, refineLocal, sampleParts } from './icp';
import { poseError } from './test-utils';

const c = makeSyntheticCase({ implants: 3, seed: 11, maxAngleRad: 0.8 });
const target = buildIcpTarget(c.jaw);
const samples = sampleParts(c.parts, 1500, 1);
/** The truth, disturbed by 2° and 0.4 mm. */
const nearTruth = multiply(fromTranslation([0.3, -0.2, 0.2]), multiply(c.captureToJaw, fromAxisAngle([1, 2, 0.5], 0.035, [0, 25, 5])));

describe('icp', () => {
  it('converges from a nearby pose to the exact transform', () => {
    const iterations: number[] = [];
    const r = icp(samples, target, nearTruth, { onIteration: (i) => void iterations.push(i) });
    const e = poseError(r.transform, c.captureToJaw, c.frames);
    expect(r.converged).toBe(true);
    expect(e.mm).toBeLessThan(0.002);
    expect(e.deg).toBeLessThan(0.005);
    expect(r.rmsMm).toBeLessThan(0.01); // against tangent planes of the samples, not the exact surface
    expect(r.pairs).toBeGreaterThan(0.75 * 1500);
    expect(iterations).toEqual(Array.from({ length: r.iterations }, (_, i) => i + 1));
  });

  it('refineLocal recovers from a few millimetres off', () => {
    const off = multiply(fromTranslation([1.5, 1, -0.8]), multiply(c.captureToJaw, fromAxisAngle([0, 0, 1], 0.06, [0, 25, 5])));
    expect(poseError(refineLocal(samples, target, off).transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.002);
  });

  it('reports too few pairs instead of throwing, and cancels on request', () => {
    const far = icp(samples, target, fromTranslation([500, 0, 0]));
    expect(far).toMatchObject({ pairs: 0, iterations: 0, converged: false, rmsMm: Infinity });
    let calls = 0;
    expect(() => icp(samples, target, nearTruth, { shouldCancel: () => ++calls > 2 })).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
    expect(calls).toBe(3);
  });

  it('validates options, meshes and parts', () => {
    for (const bad of [{ maxIterations: 0 }, { trimFraction: 0.1 }, { maxCorrespondenceMm: -1 }, { minNormalDot: 2 }, { convergenceMm: Number.NaN }]) {
      const reason = Object.keys(bad)[0];
      expect(() => icp(samples, target, nearTruth, bad)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', details: { reason } }));
    }
    const body = c.parts[0]!.mesh;
    expect(() => checkParts([])).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_DATA' }));
    expect(() => checkParts([{ siteId: '', mesh: body }])).toThrow(expect.objectContaining({ details: { reason: 'siteId' } }));
    expect(() => checkParts(Array.from({ length: 129 }, (_, i) => ({ siteId: `s${i}`, mesh: body })))).toThrow(expect.objectContaining({ details: { reason: 'tooManyParts', limit: 128 } }));
    const broken = { positions: body.positions, indices: Uint32Array.of(0, 1, 1e6) };
    expect(() => buildIcpTarget(broken)).toThrow(expect.objectContaining({ details: { reason: 'indexRange' } }));
    expect(() => buildIcpTarget({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_DATA' }));
    // @ts-expect-error a mesh posted with plain arrays is refused, not trusted
    expect(() => buildIcpTarget({ positions: [0, 0, 0], indices: [0, 0, 0] })).toThrow(expect.objectContaining({ details: { reason: 'shape' } }));
  });
});
