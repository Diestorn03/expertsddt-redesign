/** Test helpers for detect/ (synthetic only). */
import { expect } from 'vitest';
import { fromTranslation, getColumn, rotationAngleBetween, validateRigid } from '../../core/mat4';
import { mergeMeshes, transformMesh } from '../../core/mesh';
import type { Mat4, TriMesh } from '../../core/types';
import { distance, dot } from '../../core/vec3';
import type { RecoverResult } from '../../detect/sites';
import { makeRevolutionBody } from './index';

/** A tiny closed tetrahedron (a noise shell, 0.05 mm). */
export const speck: TriMesh = {
  positions: Float32Array.of(0, 0, 0, 0.05, 0, 0, 0, 0.05, 0, 0, 0, 0.05),
  indices: Uint32Array.of(0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2),
};

/** Same vertices, without the triangles that use `vertex` (e.g. a body with an open base). */
export function withoutTrianglesAt(mesh: TriMesh, vertex: number): TriMesh {
  const kept: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
    if (!tri.includes(vertex)) kept.push(...tri);
  }
  return { positions: mesh.positions, indices: Uint32Array.from(kept) };
}

/** Every site i must sit on component i and match frames[i] (origin mm; axis and, optionally, full rotation in rad). */
export function expectFrames(result: RecoverResult, frames: readonly Mat4[], originMm: number, angleRad: number, checkClocking = true): void {
  expect(result.sites).toHaveLength(frames.length);
  result.sites.forEach((site, i) => {
    const truth = frames[i]!;
    expect(site.componentIndex).toBe(i);
    expect(distance(getColumn(site.matrix, 3), getColumn(truth, 3))).toBeLessThan(originMm);
    expect(Math.acos(Math.min(1, dot(getColumn(site.matrix, 2), getColumn(truth, 2))))).toBeLessThan(angleRad);
    if (checkClocking) expect(rotationAngleBetween(site.matrix, truth)).toBeLessThan(angleRad);
    expect(() => validateRigid(site.matrix, 1e-9)).not.toThrow();
  });
}

/**
 * A round cap with an insert inside, the way some positions STLs carry each scan body (synthetic): an open-base
 * cap (r 2.5, h 6.6, top chamfer) plus, on its axis, a flange flush with the wall that pokes 0.05 mm below the base
 * and a shaft (r 1.25) on it. The flange and the shaft share one vertex, so the insert is one shell.
 */
export function capWithInsert(): { cap: TriMesh; insert: TriMesh; body: TriMesh } {
  const closed = makeRevolutionBody();
  const cap = withoutTrianglesAt(closed, closed.positions.length / 3 - 2); // no bottom disk: open base
  const flange = transformMesh(makeRevolutionBody({ height: 0.4, chamfer: 0 }), fromTranslation([0, 0, -0.05]));
  const shaft = transformMesh(makeRevolutionBody({ radius: 1.25, height: 4.65, chamfer: 0.3 }), fromTranslation([0, 0, 0.35]));
  const insert = mergeMeshes([flange, shaft]);
  return { cap, insert, body: mergeMeshes([cap, insert]) };
}
