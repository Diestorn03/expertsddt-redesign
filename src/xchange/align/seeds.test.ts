import { describe, expect, it } from 'vitest';
import { mergeMeshes, transformMesh } from '../core/mesh';
import { sampleSurface } from '../core/sampling';
import type { TriMesh } from '../core/types';
import { addNoise, makeScanBody, makeSyntheticCase, placeBodies } from '../test/fixtures';
import { buildIcpTarget } from './icp';
import { seededStarts, wallRadius } from './seeds';
import { poseError, visibleAbove } from './test-utils';

const cloud = (mesh: TriMesh, seed = 1) => {
  const s = sampleSurface(mesh, 300, seed);
  return { p: s.points, n: s.normals, count: s.triangles.length };
};

describe('seeds: starts from the scan bodies seen in the jaw', () => {
  it('reads the wall radius of the parts, whatever their winding', () => {
    expect(wallRadius([cloud(makeScanBody())])).toBeCloseTo(2.5, 1);
    expect(wallRadius([cloud(makeScanBody({ radius: 3.45, height: 11 }))])).toBeCloseTo(3.45, 1);
    const inside = makeScanBody({ radius: 1.8 });
    const flipped: TriMesh = { positions: inside.positions, indices: inside.indices.map((v, i, a) => (i % 3 === 1 ? a[i + 1]! : i % 3 === 2 ? a[i - 1]! : v)) };
    expect(wallRadius([cloud(flipped)])).toBeCloseTo(1.8, 1);
  });

  it('puts every site on its scanned body: round bodies 2.5 mm under the gum, 10 µm noise, half the jaw wound the other way', () => {
    const c = makeSyntheticCase({ seed: 51, implants: 5, maxAngleRad: Math.PI, flat: false, span: [0.2, 0.7] });
    const jaw = addNoise(transformMesh(mergeMeshes([c.archMesh, placeBodies(c.frames, visibleAbove(c.body, 2.5))]), c.captureToJaw), 0.01, 3);
    const indices = jaw.indices.slice();
    for (let t = 0; t < indices.length; t += 6) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!];
    const seeds = seededStarts(c.parts, buildIcpTarget({ positions: jaw.positions, indices }), 1);
    expect(seeds[0]!.matched).toBe(5);
    const e = poseError(seeds[0]!.transform, c.captureToJaw, c.frames);
    expect(e.mm).toBeLessThan(0.5);
    expect(e.deg).toBeLessThan(1);
  });

  it('no seeds for a single part, for parts with no round wall, or for a jaw without the scan bodies', () => {
    const c = makeSyntheticCase({ seed: 52, implants: 4 });
    expect(seededStarts(c.parts.slice(0, 1), buildIcpTarget(c.jaw), 1)).toEqual([]);
    const prisms = makeSyntheticCase({ seed: 52, implants: 4, flat: false, bodyOptions: { segments: 5 } });
    expect(seededStarts(prisms.parts, buildIcpTarget(prisms.jaw), 1)).toEqual([]);
    const gumOnly = seededStarts(c.parts, buildIcpTarget(transformMesh(c.archMesh, c.captureToJaw)), 1);
    expect(gumOnly.every((s) => s.matched < 3)).toBe(true);
  });
});
