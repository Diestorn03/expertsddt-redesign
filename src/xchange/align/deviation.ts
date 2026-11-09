/**
 * Deviation map for the colour overlay: unsigned distance (µm) from every vertex of a mesh to a surface; for the UI,
 * partDeviations also marks what the jaw scan cannot see (NaN), as the fit metrics leave it out.
 *
 * Errors: INVALID_ARGUMENT (reason 'maxUm', plus checkMesh reasons), MATRIX_INVALID / MATRIX_NOT_RIGID.
 */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { identity, validateRigid } from '../core/mat4';
import { computeVertexNormals } from '../core/mesh';
import type { AssemblyPart, Mat4, TriMesh } from '../core/types';
import { checkUsableMesh } from './icp';
import { buildTriangleTree, closestOnSurface, type TriangleTree } from './kdtree';
import { DEFAULT_TOLERANCE_MM, jawDistances } from './metrics';

/** Values are exact up to this and clamped to it (the colour ramp itself saturates at 100 µm in the viewer). */
export const DEFAULT_MAX_UM = 1000;

/** µm per vertex of `mesh` (after `transform`) to the surface indexed by `surface`, clamped to maxUm. */
export function deviationToSurface(mesh: TriMesh, surface: TriangleTree, transform: Mat4 = identity(), maxUm = DEFAULT_MAX_UM): Float32Array<ArrayBuffer> {
  if (!(maxUm > 0)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'maxUm' });
  const t = validateRigid(transform);
  const p = mesh.positions, n = p.length / 3, maxMm = maxUm / 1000;
  const m0 = t[0]!, m1 = t[1]!, m2 = t[2]!, m3 = t[3]!, m4 = t[4]!, m5 = t[5]!;
  const m6 = t[6]!, m7 = t[7]!, m8 = t[8]!, m9 = t[9]!, m10 = t[10]!, m11 = t[11]!;
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = p[3 * v]!, y = p[3 * v + 1]!, z = p[3 * v + 2]!;
    const d2 = closestOnSurface(surface, m0 * x + m1 * y + m2 * z + m3, m4 * x + m5 * y + m6 * z + m7, m8 * x + m9 * y + m10 * z + m11, maxMm);
    out[v] = Math.min(maxUm, Math.sqrt(d2) * 1000);
  }
  return out;
}

/**
 * Unsigned distance in µm from every vertex of meshA (after transformA) to the SURFACE of meshB.
 * Exact (closest point on the triangles) up to options.maxUm (default 1000 µm), clamped there.
 */
export function deviationMap(meshA: TriMesh, meshB: TriMesh, transformA?: Mat4, options: { maxUm?: number } = {}): Float32Array<ArrayBuffer> {
  checkUsableMesh(meshA, LIMITS.jaw.maxTriangles);
  checkUsableMesh(meshB, LIMITS.jaw.maxTriangles);
  return deviationToSurface(meshA, buildTriangleTree(meshB), transformA, options.maxUm);
}

/**
 * How far the colour map looks for the scan (mm). A vertex farther from every scanned triangle is not judged: it reads
 * maxUm, far off. Deeper than what Fernando's scan bodies hide under the gum (3.3 mm at most), and the search stays
 * short while the set is dragged in from far away (the CSV's capture frame arrives 43-91 mm from the jaw).
 */
export const JUDGED_WITHIN_MM = 5;

/**
 * The colour map of the parts (UI): µm per vertex of each part (after `transform`) to the jaw, clamped to maxUm, and
 * NaN where the scan cannot see the vertex (hidden behind the scanned surface, as measureFit leaves it out), so the map
 * colours what the quality label measures, within JUDGED_WITHIN_MM of the scan.
 */
export function partDeviations(parts: readonly AssemblyPart[], surface: TriangleTree, transform: Mat4 = identity(), toleranceMm = DEFAULT_TOLERANCE_MM, maxUm = DEFAULT_MAX_UM): Float32Array<ArrayBuffer>[] {
  if (!(maxUm > 0)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'maxUm' });
  const t = validateRigid(transform);
  const clouds = parts.map((p) => ({ points: p.mesh.positions, normals: computeVertexNormals(p.mesh) }));
  const probes = jawDistances(clouds, surface, t, toleranceMm, Math.max(JUDGED_WITHIN_MM, maxUm / 1000));
  return probes.map(({ mm, hidden }) => Float32Array.from(mm, (d, i) => (hidden[i] ? Number.NaN : Math.min(maxUm, d * 1000))));
}
