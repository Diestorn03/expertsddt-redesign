/** Helpers shared by the align/*.test.ts files only (never imported by application code). */
import { getColumn, rotationAngleBetween, transformPoint } from '../core/mat4';
import { closestPointOnTriangle, countTriangles, mergeMeshes, transformMesh } from '../core/mesh';
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

/** Flat disc (implant frame) at height zMm, normal +Z: a gum line, crossing the body as well. */
export function gumDisc(zMm: number, radiusMm = 6, segments = 32): TriMesh {
  const positions = new Float32Array(3 * (segments + 1)), indices: number[] = [];
  positions[2] = zMm;
  for (let j = 0; j < segments; j++) {
    const a = (2 * Math.PI * j) / segments;
    positions.set([radiusMm * Math.cos(a), radiusMm * Math.sin(a), zMm], 3 * (j + 1));
    indices.push(0, j + 1, ((j + 1) % segments) + 1);
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/**
 * Jaw scan of a synthetic case whose bodies sit depthMm deep in the gum: per body a gum disc just under depthMm and
 * the body above depthMm (cut exactly there when depthMm is a ring height of the body), moved by captureToJaw.
 */
export function buriedJaw(c: { frames: readonly Mat4[]; body: TriMesh; captureToJaw: Mat4 }, depthMm: number): TriMesh {
  const scan = c.frames.flatMap((f) => [transformMesh(gumDisc(depthMm - 0.05), f), transformMesh(visibleAbove(c.body, depthMm), f)]);
  return transformMesh(mergeMeshes(scan), c.captureToJaw);
}

/** The same surface wound the other way. */
export const flipWinding = (m: TriMesh): TriMesh => ({ positions: m.positions, indices: Uint32Array.from(m.indices, (_, i) => m.indices[i - (i % 3) + [0, 2, 1][i % 3]!]!) });
