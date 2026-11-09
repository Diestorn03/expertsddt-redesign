import { describe, expect, it } from 'vitest';
import { fromTranslation, inverseRigid, multiply } from '../core/mat4';
import { transformMesh } from '../core/mesh';
import { addNoise, makeScanBody, makeSyntheticCase, randomRigid } from '../test/fixtures';
import { deviationMap, JUDGED_WITHIN_MM, partDeviations } from './deviation';
import { buildTriangleTree } from './kdtree';
import { bruteDistance2, buriedJaw, flipWinding } from './test-utils';

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

describe('partDeviations (the colour map)', () => {
  it('leaves what lies under the gum uncoloured (NaN) and gives the rest its distance, whatever the windings', () => {
    const sc = makeSyntheticCase({ seed: 73, implants: 3, bodyOptions: { heightSegments: 12 } }); // rings every 0.5 mm
    const jaw = buriedJaw(sc, 2);
    const maps = partDeviations(sc.parts, buildTriangleTree(jaw), sc.captureToJaw);
    const flipped = partDeviations(sc.parts.map((p) => ({ ...p, mesh: flipWinding(p.mesh) })), buildTriangleTree(flipWinding(jaw)), sc.captureToJaw);
    sc.parts.forEach((part, k) => {
      const z = transformMesh(part.mesh, inverseRigid(sc.frames[k]!)).positions; // implant frame: height above the connection
      let hidden = 0;
      for (let v = 0; v < maps[k]!.length; v++) {
        const h = z[3 * v + 2]!;
        if (h < 1.6) expect(maps[k]![v]).toBeNaN(); // 0.35 mm or more under the gum line
        if (h > 1.99) expect(maps[k]![v]).toBeLessThan(1);
        if (Number.isNaN(maps[k]![v])) hidden++;
        expect(Number.isNaN(flipped[k]![v])).toBe(Number.isNaN(maps[k]![v]));
      }
      expect(hidden).toBeGreaterThan(0);
    });
    const off = partDeviations(sc.parts, buildTriangleTree(jaw), fromTranslation([0, 0, 0.2]));
    expect(off.every((m) => m.every((um) => Number.isNaN(um) || (um >= 0 && um <= 1000)))).toBe(true);
    expect(() => partDeviations(sc.parts, buildTriangleTree(jaw), sc.captureToJaw, 0.1, 0)).toThrow(expect.objectContaining({ details: { reason: 'maxUm' } }));
  });

  it(`looks for the scan within ${JUDGED_WITHIN_MM} mm only: farther, a vertex is not judged and reads maxUm (a set dragged in from far away)`, () => {
    const sc = makeSyntheticCase({ seed: 73, implants: 3, bodyOptions: { heightSegments: 12 } });
    const tree = buildTriangleTree(buriedJaw(sc, 2));
    const far = partDeviations(sc.parts, tree, multiply(fromTranslation([0, 0, 200]), sc.captureToJaw));
    expect(far.every((m) => m.every((um) => um === 1000))).toBe(true);
    expect(JUDGED_WITHIN_MM).toBeGreaterThan(3.3); // deeper than Fernando's scan bodies sit in the gum: those stay grey
  });
});
