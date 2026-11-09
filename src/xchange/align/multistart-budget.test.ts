import { describe, expect, it } from 'vitest';
import { countTriangles } from '../core/mesh';
import { makeSyntheticCase } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { multiStartAlign } from './multistart';
import { poseError } from './test-utils';

describe('performance budget (spec 7.5)', () => {
  it('4 implants on a ~50 k-triangle jaw align in < 10 s, jaw indexing included', () => {
    const c = makeSyntheticCase({ seed: 41, implants: 4, noiseSigmaMm: 0.01, maxAngleRad: Math.PI, archOptions: { segmentsAlong: 400, segmentsAcross: 58 } });
    expect(countTriangles(c.jaw)).toBeGreaterThan(48_000);
    const start = performance.now();
    const result = multiStartAlign(c.parts, buildIcpTarget(c.jaw));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10_000);
    expect(result.status).toBe('good');
    expect(poseError(result.transform, c.captureToJaw, c.frames).mm).toBeLessThan(0.02);
  }, 20_000);
});
