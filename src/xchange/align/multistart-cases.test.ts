import { describe, expect, it } from 'vitest';
import { fromAxisAngle, fromRowMajor, identity, multiply } from '../core/mat4';
import { mergeMeshes, transformMesh } from '../core/mesh';
import { addNoise, makeSyntheticCase, placeBodies } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { multiStartAlign, type AlignStage } from './multistart';
import { poseError, visibleAbove } from './test-utils';

describe('multiStartAlign: noise, symmetry, starts and failures', () => {
  it('10 µm jaw noise: RMS < 30 µm and status good', () => {
    const c = makeSyntheticCase({ seed: 31, implants: 5, noiseSigmaMm: 0.01, maxAngleRad: Math.PI });
    const result = multiStartAlign(c.parts, buildIcpTarget(c.jaw));
    expect(result.rmsMm).toBeLessThan(0.03);
    expect(result.status).toBe('good');
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
  });

  it('bodies cut 2.5 mm up in the scan still align within 20 µm (robust rejection); the band the scan misses counts against the fit', () => {
    const c = makeSyntheticCase({ seed: 36, implants: 4, maxAngleRad: Math.PI });
    const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, placeBodies(c.frames, visibleAbove(c.body, 2.5))]), c.captureToJaw), 0.01, 9);
    const result = multiStartAlign(c.parts, buildIcpTarget(jaw));
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
    // The metrics leave out only what lies under the ridge (~1 mm): the band from the ridge up to the cut faces a scan
    // with nothing there, as a sulcus the scanner missed, and counts as misses (before: every buried sample did).
    expect(result.visible).toBeGreaterThan(0.75);
    expect(result.visible).toBeLessThan(0.9);
    expect(result.coverage).toBeGreaterThan(0.6);
    expect(result.coverage).toBeLessThan(0.75);
    expect(['acceptable', 'weak']).toContain(result.status);
  });

  it('one round body: position found, status ambiguous (rotation about its axis is unknown)', () => {
    const c = makeSyntheticCase({ seed: 32, implants: 1, flat: false, maxAngleRad: Math.PI });
    const result = multiStartAlign(c.parts, buildIcpTarget(c.jaw));
    expect(result.status).toBe('ambiguous');
    expect(result.flags).toContain('symmetricSource');
    expect(result.coverage).toBe(1);
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
  });

  it('with a good initial pose refines locally only; with a bad one falls back to the global search', () => {
    const c = makeSyntheticCase({ seed: 33, implants: 3, maxAngleRad: 2.5 });
    const target = buildIcpTarget(c.jaw);
    const stages = new Set<AlignStage>();
    const nudged = multiply(c.captureToJaw, fromAxisAngle([0, 0, 1], 0.02, [0, 25, 5]));
    const local = multiStartAlign(c.parts, target, { initial: nudged, onProgress: (stage) => void stages.add(stage) });
    expect(local.status).toBe('good');
    expect(stages.has('coarse')).toBe(false);
    expect(poseError(local.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);

    const fallback = multiStartAlign(c.parts, target, { initial: identity() });
    expect(fallback.status).toBe('good');
    expect(poseError(fallback.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
  });

  it('a jaw without the scan bodies fails without throwing and keeps the last attempt', () => {
    const c = makeSyntheticCase({ seed: 34, implants: 3 });
    const gumOnly = transformMesh(c.archMesh, c.captureToJaw);
    const result = multiStartAlign(c.parts, buildIcpTarget(gumOnly));
    expect(result.status).toBe('failed');
    expect(result.coverage).toBeLessThan(0.4);
    expect(result.transform).toHaveLength(16);
  });

  it('reports progress in stage order, honours quality overrides, cancels and validates', () => {
    const c = makeSyntheticCase({ seed: 35, implants: 2, noiseSigmaMm: 0.01 });
    const target = buildIcpTarget(c.jaw);
    const seen: Array<[AlignStage, number]> = [];
    const strict = multiStartAlign(c.parts, target, { quality: { goodRmsMm: 0.001 }, onProgress: (s, f) => void seen.push([s, f]) });
    expect(strict.status).toBe('acceptable'); // rms ≈ 7 µm: not good under a 1 µm threshold
    const order = ['prepare', 'coarse', 'fine', 'metrics'];
    expect([...new Set(seen.map(([s]) => s))]).toEqual(order);
    expect(seen.every(([, f]) => f >= 0 && f <= 1)).toBe(true);
    expect(seen.map(([s]) => order.indexOf(s))).toEqual(seen.map(([s]) => order.indexOf(s)).sort((a, b) => a - b));

    let calls = 0;
    expect(() => multiStartAlign(c.parts, target, { shouldCancel: () => ++calls > 5 })).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
    expect(() => multiStartAlign([], target)).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_DATA' }));
    expect(() => multiStartAlign(c.parts, target, { sourceSamples: 10 })).toThrow(expect.objectContaining({ details: { reason: 'sourceSamples' } }));
    expect(() => multiStartAlign(c.parts, target, { quality: { goodCoverage: 2 } })).toThrow(expect.objectContaining({ details: { reason: 'quality' } }));
    const sheared = fromRowMajor([1, 0.2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(() => multiStartAlign(c.parts, target, { initial: sheared })).toThrow(expect.objectContaining({ code: 'MATRIX_NOT_RIGID' }));
  });
});
