/** Helpers shared by the align/*.test.ts files only (never imported by application code). */
import { getColumn, rotationAngleBetween, transformPoint } from '../core/mat4';
import { closestPointOnTriangle, countTriangles } from '../core/mesh';
import type { Mat4, TriMesh } from '../core/types';
import { distance } from '../core/vec3';

/** Worst implant-origin displacement (mm) and rotation difference (degrees) between two capture -> jaw poses. */
export function poseError(found: Mat4, truth: Mat4, frames: readonly Mat4[]): { mm: number; deg: number } {
  const mm = Math.max(...frames.map((f) => distance(transformPoint(found, getColumn(f, 3)), transformPoint(truth, getColumn(f, 3)))));
  return { mm, deg: (rotationAngleBetween(found, truth) * 180) / Math.PI };
}

/** The triangles of a body (implant frame) whose centroid lies above zMinMm: the part a jaw scan still sees. */
export function visibleAbove(body: TriMesh, zMinMm: number): TriMesh {
  const p = body.positions, idx = body.indices, keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const z = (p[3 * idx[t]! + 2]! + p[3 * idx[t + 1]! + 2]! + p[3 * idx[t + 2]! + 2]!) / 3;
    if (z > zMinMm) keep.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
  }
  return { positions: p, indices: Uint32Array.from(keep) };
}

/** Squared distance to the surface by testing every triangle. */
export function bruteDistance2(mesh: TriMesh, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let t = 0; t < countTriangles(mesh); t++) best = Math.min(best, closestPointOnTriangle(mesh.positions, mesh.indices, t, x, y, z));
  return best;
}
