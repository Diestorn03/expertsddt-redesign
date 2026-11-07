import { describe, expect, it } from 'vitest';
import { fromTranslation, inverseRigid } from '../core/mat4';
import { transformMesh } from '../core/mesh';
import { addNoise, makeScanBody, randomRigid } from '../test/fixtures';
import { deviationMap } from './deviation';
import { bruteDistance2 } from './test-utils';

describe('deviationMap', () => {
  const body = makeScanBody({ segments: 32 });

  it('matches brute force within 0.5 µm below 200 µm', () => {
    const noisy = addNoise(body, 0.05, 3);
    const um = deviationMap(noisy, body);
    expect(um).toHaveLength(noisy.positions.length / 3);
    let checked = 0;
    for (let v = 0; v < um.length; v++) {
      const p = noisy.positions;
      const exact = Math.sqrt(bruteDistance2(body, p[3 * v]!, p[3 * v + 1]!, p[3 * v + 2]!)) * 1000;
      if (exact < 200) {
        expect(Math.abs(um[v]! - exact)).toBeLessThan(0.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0.9 * um.length);
    expect(Math.max(...um)).toBeGreaterThan(50);
  });

  it('applies transformA, clamps to maxUm and validates', () => {
    const m = randomRigid(5);
    const moved = transformMesh(body, inverseRigid(m));
    expect(Math.max(...deviationMap(moved, body, m))).toBeLessThan(0.5);
    const far = deviationMap(body, body, fromTranslation([10, 0, 0])); // every vertex > 1 mm from the body
    expect(far.every((v) => v === 1000)).toBe(true);
    expect(Math.max(...deviationMap(addNoise(body, 0.2, 1), body, undefined, { maxUm: 100 }))).toBe(100);
    expect(() => deviationMap(body, body, undefined, { maxUm: 0 })).toThrow(expect.objectContaining({ details: { reason: 'maxUm' } }));
    expect(() => deviationMap(body, { positions: body.positions, indices: Uint32Array.of(0, 1, 9999) })).toThrow(
      expect.objectContaining({ details: { reason: 'indexRange' } }),
    );
  });
});
