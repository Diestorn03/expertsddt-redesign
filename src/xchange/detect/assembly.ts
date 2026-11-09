/**
 * Replacement STLs that hold several bodies already placed at the implant positions (spec 4.1.7).
 * Such an assembly is used once, in its original coordinates, never repeated at every implant.
 *
 * Errors: INVALID_ARGUMENT reason 'toleranceMm' | 'samples' | 'seed' | 'sites' (duplicate site ids) |
 * 'radialToleranceMm' | 'endpointToleranceMm' | 'axisToleranceRad'; MATRIX_INVALID / MATRIX_NOT_RIGID (site
 * matrices); plus describeComponents' (MESH_EMPTY, TOO_MANY_COMPONENTS reason 'shells', malformed mesh).
 */
import { XchangeError } from '../core/errors';
import { inverseRigid, validateRigid } from '../core/mat4';
import { computeBounds, mergeMeshes, surfaceArea, transformMesh } from '../core/mesh';
import { sampleSurface } from '../core/sampling';
import type { ImplantSite, TriMesh, Vec3 } from '../core/types';
import { distance, dot, sub } from '../core/vec3';
import { buildBvh, nearestOnSurface, type Bvh } from '../geometry/bvh';
import { pcaOfSurface } from '../geometry/pca';
import { bodyMeshes, describeComponents, diagonal, siteCost, type MeshComponent } from './sites';

export type AssemblyPlan =
  /** One body (possibly several shells of one part) in the implant frame: place it at every site as usual. */
  | { kind: 'single' }
  /** Every body has the same shape and sits at its site: `mesh` is that body in the implant frame (a normal library geometry). */
  | { kind: 'normalized'; mesh: TriMesh; maxDeviationMm: number }
  /**
   * Different bodies: each site gets its own body in its implant frame, so site.matrix · mesh reproduces the file's
   * coordinates. `atSites` false: one body per site, but they are not at the sites (another coordinate system, most
   * likely): the UI does not apply it and offers to use only one of the two files.
   */
  | { kind: 'fixed'; meshBySite: Record<string, TriMesh>; atSites: boolean }
  /** Bodies laid out like an assembly, but not one per site. */
  | { kind: 'countMismatch'; bodies: number; sites: number };

export interface AssemblyOptions {
  /** Congruence tolerance for 'normalized', default 0.03 mm. */
  toleranceMm?: number;
  /** Surface samples per body and direction for the congruence check, default 500. */
  samples?: number;
  seed?: number;
}

/** A body whose centroid is this close (siteCost) to a distinct site counts as placed there. */
const AT_SITE_COST_MM = 5;

/**
 * Decides how a replacement mesh is used (spec 4.1.7). Positioned assembly = at least two bodies
 * (non-fragment shells, each with the inner pieces that sit in it) that are either spread out
 * (centroids span more than 1.5 × the largest body diagonal, the prototype's rule) or each sit at a
 * distinct site (catches two neighbouring implants, which the spread rule misses). Inner pieces and
 * fragments travel with their body, so no geometry is ever dropped.
 */
export function planAssembly(mesh: TriMesh, sites: readonly ImplantSite[], options: AssemblyOptions = {}): AssemblyPlan {
  const tolerance = options.toleranceMm ?? 0.03;
  const samples = options.samples ?? 500;
  const seed = options.seed ?? 1;
  if (!(tolerance > 0 && tolerance <= 0.1)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'toleranceMm' });
  if (!Number.isInteger(samples) || samples < 24 || samples > 20_000) throw new XchangeError('INVALID_ARGUMENT', { reason: 'samples' });
  if (!Number.isSafeInteger(seed)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'seed' });
  if (new Set(sites.map((s) => s.id)).size !== sites.length) throw new XchangeError('INVALID_ARGUMENT', { reason: 'sites' });

  const components = describeComponents(mesh);
  const bodies = components.filter((c) => !c.fragment);
  if (bodies.length < 2) return { kind: 'single' };
  let largest = 0;
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    largest = Math.max(largest, diagonal(b.bounds));
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, b.centroid[k]!);
      hi[k] = Math.max(hi[k]!, b.centroid[k]!);
    }
  }
  const spread = diagonal({ min: lo, max: hi });
  const n = bodies.length;
  let siteOfBody: Int32Array | null = null;
  let atSites = false;
  if (n === sites.length) {
    const inverses = sites.map((s) => inverseRigid(validateRigid(s.matrix)));
    const cost = new Float64Array(n * n);
    bodies.forEach((b, i) => inverses.forEach((inv, j) => (cost[i * n + j] = siteCost(inv, b.centroid))));
    siteOfBody = assign(cost, n);
    atSites = bodies.every((_, i) => cost[i * n + siteOfBody![i]!]! <= AT_SITE_COST_MM);
  }
  if (!(spread > 1.5 * largest) && !atSites) return { kind: 'single' };
  if (!siteOfBody) return { kind: 'countMismatch', bodies: n, sites: sites.length };

  const parts = bodyMeshes(components);
  const local: TriMesh[] = new Array<TriMesh>(n);
  bodies.forEach((_, i) => {
    const site = siteOfBody![i]!;
    const group = parts[i]!;
    local[site] = transformMesh(group.length === 1 ? group[0]! : mergeMeshes(group), inverseRigid(sites[site]!.matrix));
  });
  const deviation = atSites ? congruence(local, tolerance, samples, seed) : null;
  if (deviation !== null) return { kind: 'normalized', mesh: local[0]!, maxDeviationMm: deviation };
  return { kind: 'fixed', meshBySite: Object.fromEntries(sites.map((s, i) => [s.id, local[i]!])), atSites };
}

/**
 * Largest deviation between local[0] and every other body (all in their implant frames), or
 * null as soon as one differs by more than `tolerance`: bounding boxes, then the same vertices
 * in the same order, else area within 2 % and sampled surface distances in both directions.
 */
function congruence(local: readonly TriMesh[], tolerance: number, samples: number, seed: number): number | null {
  const base = local[0]!;
  const baseBounds = computeBounds(base);
  const baseArea = surfaceArea(base);
  let baseBvh: Bvh | null = null;
  let baseSamples: Float64Array | null = null;
  let worst = 0;
  for (let i = 1; i < local.length; i++) {
    const body = local[i]!;
    const b = computeBounds(body);
    for (let k = 0; k < 3; k++) {
      if (Math.abs(b.min[k]! - baseBounds.min[k]!) > tolerance || Math.abs(b.max[k]! - baseBounds.max[k]!) > tolerance) return null;
    }
    const ordered = sameTopology(body, base) ? maxVertexDistance(body, base) : Infinity;
    if (ordered <= tolerance) {
      worst = Math.max(worst, ordered);
      continue;
    }
    if (!(Math.abs(surfaceArea(body) / baseArea - 1) <= 0.02)) return null;
    baseBvh ??= buildBvh(base);
    baseSamples ??= sampleSurface(base, samples, seed).points;
    const there = maxSurfaceDistance(baseSamples, buildBvh(body), tolerance);
    const back = maxSurfaceDistance(sampleSurface(body, samples, seed + i).points, baseBvh, tolerance);
    if (there === null || back === null) return null;
    worst = Math.max(worst, there, back);
  }
  return worst;
}

function sameTopology(a: TriMesh, b: TriMesh): boolean {
  if (a.positions.length !== b.positions.length || a.indices.length !== b.indices.length) return false;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] !== b.indices[i]) return false;
  return true;
}

function maxVertexDistance(a: TriMesh, b: TriMesh): number {
  let worst = 0;
  for (let i = 0; i < a.positions.length; i += 3) {
    worst = Math.max(worst, Math.hypot(a.positions[i]! - b.positions[i]!, a.positions[i + 1]! - b.positions[i + 1]!, a.positions[i + 2]! - b.positions[i + 2]!));
  }
  return worst;
}

const scratch = new Float64Array(4);

/** Largest point-to-surface distance, or null as soon as one point is farther than `limit`. */
function maxSurfaceDistance(points: Float64Array, bvh: Bvh, limit: number): number | null {
  let worst2 = 0;
  for (let i = 0; i < points.length; i += 3) {
    if (nearestOnSurface(bvh, points[i]!, points[i + 1]!, points[i + 2]!, limit * limit, scratch) < 0) return null;
    worst2 = Math.max(worst2, scratch[3]!);
  }
  return Math.sqrt(worst2);
}

/** Minimum-cost perfect matching of a square cost matrix (row -> column), O(n³) Hungarian method with potentials. */
export function assign(cost: Float64Array, n: number): Int32Array {
  if (cost.length !== n * n) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const rowOfColumn = new Int32Array(n + 1); // 1-based rows; 0 = free
  const previous = new Int32Array(n + 1);
  for (let row = 1; row <= n; row++) {
    rowOfColumn[0] = row;
    let column = 0;
    const slack = new Float64Array(n + 1).fill(Infinity);
    const visited = new Uint8Array(n + 1);
    do {
      visited[column] = 1;
      const r = rowOfColumn[column]!;
      let delta = Infinity, next = 0;
      for (let c = 1; c <= n; c++) {
        if (visited[c]) continue;
        const reduced = cost[(r - 1) * n + (c - 1)]! - u[r]! - v[c]!;
        if (reduced < slack[c]!) {
          slack[c] = reduced;
          previous[c] = column;
        }
        if (slack[c]! < delta) {
          delta = slack[c]!;
          next = c;
        }
      }
      for (let c = 0; c <= n; c++) {
        if (visited[c]) {
          u[rowOfColumn[c]!] = u[rowOfColumn[c]!]! + delta;
          v[c] = v[c]! - delta;
        } else {
          slack[c] = slack[c]! - delta;
        }
      }
      column = next;
    } while (rowOfColumn[column] !== 0);
    do {
      const before = previous[column]!;
      rowOfColumn[column] = rowOfColumn[before]!;
      column = before;
    } while (column !== 0);
  }
  const columnOfRow = new Int32Array(n);
  for (let c = 1; c <= n; c++) columnOfRow[rowOfColumn[c]! - 1] = c - 1;
  return columnOfRow;
}

export interface LayoutOptions {
  /** Centroid distance across the body axis, default 0.25 mm. */
  radialToleranceMm?: number;
  /** Closest pair of axis end points, default 0.30 mm. */
  endpointToleranceMm?: number;
  /** Angle between the body axes, default 5°. */
  axisToleranceRad?: number;
}

export interface LayoutMatch {
  captureComponent: number;
  assemblyComponent: number;
  radialOffsetMm: number;
  endpointOffsetMm: number;
  axisAngleRad: number;
  compatible: boolean;
}

export interface LayoutCheck {
  compatible: boolean;
  reason: 'ok' | 'count' | 'noAxis' | 'offsets';
  /** Capture body -> assembly body (minimum-cost assignment), in capture component order. */
  matches: LayoutMatch[];
}

interface Layout {
  index: number;
  centroid: Vec3;
  /** Unsigned body axis. */
  axis: Vec3;
  ends: [Vec3, Vec3];
}

/**
 * Compares the bodies of a capture mesh and of a positioned assembly IN THEIR CURRENT
 * COORDINATES: per pair, the angle between the body axes, the centroid offset across the axis
 * and the closest axis end points. Evidence that both files share one coordinate frame; it
 * moves nothing and does not prove that both come from the same acquisition.
 */
export function verifyAssemblyLayout(captureMesh: TriMesh, assemblyMesh: TriMesh, options: LayoutOptions = {}): LayoutCheck {
  const radialTol = options.radialToleranceMm ?? 0.25;
  const endpointTol = options.endpointToleranceMm ?? 0.3;
  const axisTol = options.axisToleranceRad ?? (5 * Math.PI) / 180;
  if (!(radialTol > 0 && radialTol <= 1)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'radialToleranceMm' });
  if (!(endpointTol > 0 && endpointTol <= 1)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'endpointToleranceMm' });
  if (!(axisTol > 0 && axisTol <= (15 * Math.PI) / 180)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'axisToleranceRad' });
  const capture = describeComponents(captureMesh).filter((c) => !c.fragment);
  const assembly = describeComponents(assemblyMesh).filter((c) => !c.fragment);
  const n = capture.length;
  if (n < 2 || n !== assembly.length) return { compatible: false, reason: 'count', matches: [] };
  const a = capture.map(layoutOf), b = assembly.map(layoutOf);
  if (a.some((x) => !x) || b.some((x) => !x)) return { compatible: false, reason: 'noAxis', matches: [] };

  const evidence = (p: Layout, q: Layout): Omit<LayoutMatch, 'captureComponent' | 'assemblyComponent'> => {
    const cos = Math.min(1, Math.abs(dot(p.axis, q.axis)));
    const delta = sub(q.centroid, p.centroid);
    const along = dot(delta, p.axis);
    const radial = Math.hypot(delta[0] - along * p.axis[0], delta[1] - along * p.axis[1], delta[2] - along * p.axis[2]);
    let endpoint = Infinity;
    for (const e of p.ends) for (const f of q.ends) endpoint = Math.min(endpoint, distance(e, f));
    const axisAngle = Math.acos(cos);
    return { radialOffsetMm: radial, endpointOffsetMm: endpoint, axisAngleRad: axisAngle, compatible: axisAngle <= axisTol && radial <= radialTol && endpoint <= endpointTol };
  };
  const cost = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const e = evidence(a[i]!, b[j]!);
      cost[i * n + j] = e.radialOffsetMm ** 2 + e.endpointOffsetMm ** 2 + 100 * (1 - Math.cos(e.axisAngleRad));
    }
  }
  const match = assign(cost, n);
  const matches = a.map((p, i): LayoutMatch => {
    const q = b[match[i]!]!;
    return { captureComponent: p!.index, assemblyComponent: q.index, ...evidence(p!, q) };
  });
  const compatible = matches.every((m) => m.compatible);
  return { compatible, reason: compatible ? 'ok' : 'offsets', matches };
}

/**
 * A body's geometrically distinguished, UNSIGNED axis: the long axis of an elongated body, or the
 * short axis of a flat cap; null when the shape has no clear axis. A layout feature, never a datum.
 */
function layoutOf(c: MeshComponent): Layout | null {
  if (!(c.areaMm2 > 0)) return null;
  const pca = pcaOfSurface(c.mesh);
  const [l0, l1, l2] = pca.variances;
  const axis = l0 >= 1.35 * l1 ? pca.axes[0] : l0 - l1 <= 0.12 * l0 && l1 >= 1.35 * l2 ? pca.axes[2] : null;
  if (!axis) return null;
  const p = c.mesh.positions;
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const t = (p[i]! - pca.centroid[0]) * axis[0] + (p[i + 1]! - pca.centroid[1]) * axis[1] + (p[i + 2]! - pca.centroid[2]) * axis[2];
    low = Math.min(low, t);
    high = Math.max(high, t);
  }
  const at = (t: number): Vec3 => [pca.centroid[0] + t * axis[0], pca.centroid[1] + t * axis[1], pca.centroid[2] + t * axis[2]];
  return { index: c.index, centroid: pca.centroid, axis, ends: [at(low), at(high)] };
}
