/**
 * Implant sites from a capture mesh (spec 4.1): split it into shells, fit a reference body whose
 * implant frame is known (origin = connection, +Z = axis, +X = index) to every shell, and report
 * how far each fit can be trusted. A centroid alone is never a datum (spec 4.1.5).
 *
 * Errors: INVALID_ARGUMENT reason 'samples' | 'maxRmsMm' | 'minCoverage' | 'seed' | 'source' (options), 'tolerance',
 * 'shape' | 'index' (malformed mesh); MESH_EMPTY; TOO_MANY_COMPONENTS {limit, count} (reason 'shells' for the
 * hard cap on all shells); REFERENCE_NO_MATCH reason 'zeroArea'; MATRIX_INVALID / MATRIX_NOT_RIGID (link input).
 * Warnings: COMPONENT_FRAGMENTS, SITE_INDEX_AMBIGUOUS, SITE_PROVISIONAL, each {count}.
 */
import { XchangeError, type XchangeWarning } from '../core/errors';
import { LIMITS } from '../core/limits';
import {
  compose,
  fromAxes,
  fromAxisAngle,
  fromQuaternion,
  fromTranslation,
  getColumn,
  inverseRigid,
  multiply,
  rotationAngleBetween,
  toQuaternion,
  transformDirection,
  transformPoint,
  validateRigid,
} from '../core/mat4';
import { checkMesh, computeBounds, surfaceArea } from '../core/mesh';
import { createRng, sampleSurface } from '../core/sampling';
import type { Bounds, ImplantSite, Mat4, MeshFormat, ReferenceBody, TriMesh, Vec3 } from '../core/types';
import { add, cross, distance, dot, normalize, scale, sub } from '../core/vec3';
import { buildBvh } from '../geometry/bvh';
import { connectedComponents, extractComponents } from '../geometry/components';
import { pcaOfSurface, type Pca } from '../geometry/pca';
import { weld } from '../geometry/weld';
import { icp, measure, poseDifference, surfaceTarget, type FitStats, type IcpSettings, type SurfaceTarget } from './fit';

export interface MeshComponent {
  index: number;
  /** The shell. For a body with inner pieces, its outer shell: the surface that is fitted, linked and aligned. */
  mesh: TriMesh;
  areaMm2: number;
  bounds: Bounds;
  /** Area-weighted surface centroid (bounding-box centre for a zero-area shell). */
  centroid: Vec3;
  /** area < 0.5 % of the largest AND diagonal < 20 % of the largest (spec 4.1.2): kept, flagged. */
  fragment: boolean;
  /** Shells that sit inside this one (coaxial, within its box), such as the insert of a cap: one body with it, never counted, fitted or linked alone. */
  inner: TriMesh[];
}

/** Hard cap on all shells (fragments included), checked before any per-shell allocation. */
const MAX_SHELLS = 10_000; // ponytail: fixed cap against noise clouds; move to LIMITS if real captures need more

/**
 * weld + connectedComponents + extractComponents, fragments flagged, inner pieces folded into the body they sit in
 * (renumbered: index = position in the list, in order of the lowest triangle index); no limit on non-fragment shells.
 */
export function describeComponents(mesh: TriMesh, weldToleranceMm = 1e-5): MeshComponent[] {
  const welded = weld(mesh, weldToleranceMm);
  if (welded.indices.length === 0) throw new XchangeError('MESH_EMPTY');
  const labels = connectedComponents(welded);
  if (labels.count > MAX_SHELLS) throw new XchangeError('TOO_MANY_COMPONENTS', { limit: MAX_SHELLS, count: labels.count, reason: 'shells' });
  const components = extractComponents(welded, labels).map((part, index): MeshComponent => {
    const bounds = computeBounds(part);
    const { area, centroid } = surfaceCentroid(part, bounds);
    return { index, mesh: part, areaMm2: area, bounds, centroid, fragment: false, inner: [] };
  });
  let largestArea = 0, largestDiagonal = 0;
  for (const c of components) {
    largestArea = Math.max(largestArea, c.areaMm2);
    largestDiagonal = Math.max(largestDiagonal, diagonal(c.bounds));
  }
  for (const c of components) c.fragment = c.areaMm2 < 0.005 * largestArea && diagonal(c.bounds) < 0.2 * largestDiagonal;
  const outer = outerShells(components);
  const kept = components.filter((c, i) => {
    if (outer[i]! < 0) return true;
    components[outer[i]!]!.inner.push(c.mesh);
    return false;
  });
  kept.forEach((c, i) => (c.index = i));
  return kept;
}

/**
 * Each body's meshes as the file holds them: its outer shell first, the pieces inside it, then the fragments nearest to
 * it, so no geometry is ever dropped (planAssembly, "No exchange"). One list per non-fragment component, in order.
 */
export function bodyMeshes(components: readonly MeshComponent[]): TriMesh[][] {
  const bodies = components.filter((c) => !c.fragment);
  const parts = bodies.map((b) => [b.mesh, ...b.inner]);
  for (const f of components) if (f.fragment) parts[nearestBody(f, bodies)]!.push(f.mesh);
  return parts;
}

function nearestBody(fragment: MeshComponent, bodies: readonly MeshComponent[]): number {
  let best = 0;
  bodies.forEach((b, i) => {
    if (distance(b.centroid, fragment.centroid) < distance(bodies[best]!.centroid, fragment.centroid)) best = i;
  });
  return best;
}

/** The inner piece's box may stick out of the outer shell's, and its centroid sit off that shell's axis, by this fraction of the outer shell's diagonal. */
const NESTED_TOLERANCE = 0.02; // ponytail: real inserts sit within 1 µm of the cap's axis and 0.1 mm of its box; loosen only for scanned inner shells
/** Above this many non-fragment shells the pair test is skipped (noise; a capture is refused at 64 bodies anyway). */
const NESTED_MAX_SHELLS = 1024;

interface ShellFrame {
  centroid: Vec3;
  /** Principal axes of the surface; `axis` is the one whose variance stands apart (a cap's own axis). */
  axes: [Vec3, Vec3, Vec3];
  axis: Vec3;
  /** Extent of the shell's vertices along each principal axis: [lo0, hi0, lo1, hi1, lo2, hi2]. */
  extent: Float64Array;
}

/** lo/hi of the vertices of `mesh` along three axes through `origin`. */
function extentAlong(mesh: TriMesh, origin: Readonly<Vec3>, axes: readonly Vec3[]): Float64Array {
  const out = Float64Array.of(Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity);
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]! - origin[0], y = p[i + 1]! - origin[1], z = p[i + 2]! - origin[2];
    for (let k = 0; k < 3; k++) {
      const a = axes[k]!, t = x * a[0] + y * a[1] + z * a[2];
      if (t < out[2 * k]!) out[2 * k] = t;
      if (t > out[2 * k + 1]!) out[2 * k + 1] = t;
    }
  }
  return out;
}

/**
 * Smallest circle around the points (xs[i], ys[i]): centre and radius. Welzl's incremental algorithm on a shuffled order
 * (fixed seed), expected O(n); points within 50 ppm of the radius count as on it (float32 vertices of a round wall).
 */
function enclosingCircle(xs: Float64Array, ys: Float64Array): [number, number, number] {
  const n = xs.length, order = Uint32Array.from({ length: n }, (_, i) => i), rng = createRng(1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)), t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  let cx = 0, cy = 0, r2 = -1;
  const out = (k: number): boolean => (xs[k]! - cx) ** 2 + (ys[k]! - cy) ** 2 > r2 * (1 + 1e-4) + 1e-12;
  const diameter = (i: number, j: number): void => {
    cx = (xs[i]! + xs[j]!) / 2; cy = (ys[i]! + ys[j]!) / 2;
    r2 = (xs[i]! - cx) ** 2 + (ys[i]! - cy) ** 2;
  };
  for (let a = 0; a < n; a++) {
    const i = order[a]!;
    if (!out(i)) continue;
    cx = xs[i]!; cy = ys[i]!; r2 = 0;
    for (let b = 0; b < a; b++) {
      const j = order[b]!;
      if (!out(j)) continue;
      diameter(i, j);
      for (let c = 0; c < b; c++) {
        const k = order[c]!;
        if (!out(k)) continue;
        const ux = xs[j]! - xs[i]!, uy = ys[j]! - ys[i]!, vx = xs[k]! - xs[i]!, vy = ys[k]! - ys[i]!;
        const det = 2 * (ux * vy - uy * vx), u2 = ux * ux + uy * uy, v2 = vx * vx + vy * vy;
        if (Math.abs(det) <= 1e-12 * (u2 + v2)) { // in a line: the two farthest apart span it
          const w2 = (xs[k]! - xs[j]!) ** 2 + (ys[k]! - ys[j]!) ** 2;
          if (u2 >= v2 && u2 >= w2) diameter(i, j); else if (v2 >= w2) diameter(i, k); else diameter(j, k);
          continue;
        }
        const ox = (vy * u2 - uy * v2) / det, oy = (ux * v2 - vx * u2) / det;
        cx = xs[i]! + ox; cy = ys[i]! + oy; r2 = ox * ox + oy * oy;
      }
    }
  }
  return [cx, cy, Math.sqrt(Math.max(0, r2))];
}

/**
 * B inside the round outline of A, seen along `u` (unit): B's centroid on the axis through the centre of the smallest
 * circle around A's vertices, every vertex of B within that circle and within A's length along `u`, all within `tol`.
 * An index flat is a chord inside that circle, so it moves neither the axis nor the test, as it moves A's centroid.
 */
function insideRound(a: TriMesh, b: MeshComponent, u: Vec3, tol: number): boolean {
  const e1 = normalize(cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), e2 = cross(u, e1);
  const along = (m: TriMesh): { xs: Float64Array; ys: Float64Array; lo: number; hi: number } => {
    const p = m.positions, n = p.length / 3, xs = new Float64Array(n), ys = new Float64Array(n);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p[3 * i]!, y = p[3 * i + 1]!, z = p[3 * i + 2]!, t = x * u[0] + y * u[1] + z * u[2];
      xs[i] = x * e1[0] + y * e1[1] + z * e1[2];
      ys[i] = x * e2[0] + y * e2[1] + z * e2[2];
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    return { xs, ys, lo, hi };
  };
  const A = along(a), B = along(b.mesh);
  const [cx, cy, r] = enclosingCircle(A.xs, A.ys);
  if (!(Math.hypot(dot(b.centroid, e1) - cx, dot(b.centroid, e2) - cy) <= tol && B.lo >= A.lo - tol && B.hi <= A.hi + tol)) return false;
  for (let i = 0; i < B.xs.length; i++) if (Math.hypot(B.xs[i]! - cx, B.ys[i]! - cy) > r + tol) return false;
  return true;
}

/**
 * For each component, the index of the outermost non-fragment shell it sits in (-1: none). B sits in A when A is
 * the bigger one (diagonal, then the lower index for twins), B lies inside A's axis-aligned box and either B's centroid
 * lies on A's axis (the principal axis whose variance stands apart, through A's centroid) with B inside A's box in A's
 * principal frame, or B lies inside A's round outline seen along A's or B's principal axis (insideRound): a cap whose
 * index flat moves its centroid off its axis, or whose principal axes lean (an uneven part about as tall as it is wide),
 * still holds its insert. All within NESTED_TOLERANCE. A neighbouring body sticks out of the box of the body beside it,
 * and a body standing on an arch strip is far from the strip's axis and from the centre of its outline, so neither is
 * folded in.
 */
function outerShells(components: readonly MeshComponent[]): Int32Array {
  const parent = new Int32Array(components.length).fill(-1);
  const bodies = components.filter((c) => !c.fragment);
  if (bodies.length < 2 || bodies.length > NESTED_MAX_SHELLS) return parent;
  const size = new Map(bodies.map((c) => [c, diagonal(c.bounds)]));
  const frames = new Map<MeshComponent, ShellFrame>();
  const frameOf = (c: MeshComponent): ShellFrame => {
    let f = frames.get(c);
    if (!f) {
      const { centroid, axes, variances: [l0, l1, l2] } = pcaOfSurface(c.mesh);
      f = { centroid, axes, axis: l0 - l1 > l1 - l2 ? axes[0] : axes[2], extent: extentAlong(c.mesh, centroid, axes) };
      frames.set(c, f);
    }
    return f;
  };
  for (const b of bodies) {
    let best: MeshComponent | null = null;
    for (const a of bodies) {
      const da = size.get(a)!, db = size.get(b)!;
      if (a === b || db > da || (db === da && a.index > b.index) || (best && size.get(best)! >= da)) continue;
      const tol = NESTED_TOLERANCE * da;
      let inside = true;
      for (let k = 0; k < 3 && inside; k++) inside = b.bounds.min[k]! >= a.bounds.min[k]! - tol && b.bounds.max[k]! <= a.bounds.max[k]! + tol;
      if (!inside) continue;
      const f = frameOf(a);
      const d = sub(b.centroid, f.centroid);
      if (distance(d, scale(f.axis, dot(d, f.axis))) <= tol) {
        const e = extentAlong(b.mesh, f.centroid, f.axes);
        for (let k = 0; k < 3 && inside; k++) inside = e[2 * k]! >= f.extent[2 * k]! - tol && e[2 * k + 1]! <= f.extent[2 * k + 1]! + tol;
      } else inside = false;
      if (inside || [f.axis, frameOf(b).axis].some((u) => insideRound(a.mesh, b, u, tol))) best = a;
    }
    if (best) parent[b.index] = best.index;
  }
  // An inner piece of an inner piece belongs to the outermost shell (diagonals only grow along a chain: no cycles).
  for (let i = 0; i < parent.length; i++) {
    let root = parent[i]!;
    while (root >= 0 && parent[root]! >= 0) root = parent[root]!;
    parent[i] = root;
  }
  return parent;
}

/** Order = lowest triangle index, so body i of placeBodies is component i. */
export function splitComponents(captureMesh: TriMesh, options: { weldToleranceMm?: number } = {}): MeshComponent[] {
  const components = describeComponents(captureMesh, options.weldToleranceMm);
  const bodies = components.filter((c) => !c.fragment).length;
  const limit = LIMITS.capture.maxComponents;
  if (bodies > limit) throw new XchangeError('TOO_MANY_COMPONENTS', { limit, count: bodies });
  return components;
}

export function diagonal(b: Bounds): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

function surfaceCentroid(mesh: TriMesh, bounds: Bounds): { area: number; centroid: Vec3 } {
  const p = mesh.positions, idx = mesh.indices;
  let area = 0, x = 0, y = 0, z = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    area += A;
    x += (A * (p[a]! + p[b]! + p[c]!)) / 3;
    y += (A * (p[a + 1]! + p[b + 1]! + p[c + 1]!)) / 3;
    z += (A * (p[a + 2]! + p[b + 2]! + p[c + 2]!)) / 3;
  }
  if (area > 0) return { area, centroid: [x / area, y / area, z / area] };
  const { min, max } = bounds;
  return { area: 0, centroid: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

export interface RecoverOptions {
  seed?: number;
  /** Samples per component, default 400. */
  samples?: number;
  /** Reliable fit, default 0.03 mm. */
  maxRmsMm?: number;
  /** Fraction of samples within maxRmsMm, default 0.98. */
  minCoverage?: number;
  /** site.source, default 'stl'. */
  source?: MeshFormat;
}

export type FitStatus = 'reliable' | 'provisional' | 'unresolved';

/** Fit diagnostics of one non-fragment component (shown per implant; not part of ImplantSite). */
export interface ComponentFit {
  componentIndex: number;
  status: FitStatus;
  /** Untrimmed residual of the shell's samples to the fitted reference surface. Infinity: no fit attempted (size mismatch). */
  rmsMm: number;
  p95Mm: number;
  /** Fraction of the shell's samples within maxRmsMm of the reference. */
  coverage: number;
  /** Fraction of the reference's samples within maxRmsMm of the shell (low: partial scan or a different body). */
  referenceCoverage: number;
  converged: boolean;
  /** Poses rotated about the fitted +Z by more than 5° fit as well: the clocking (+X) is arbitrary. */
  indexAmbiguous: boolean;
  /** A pose with a different origin or axis fits as well: the datum itself is uncertain. */
  datumAmbiguous: boolean;
}

export interface RecoverResult {
  /** One per reliably or provisionally fitted component, in component order. */
  sites: ImplantSite[];
  /** Component indices without a usable fit (the UI asks for a matching reference). */
  unresolved: number[];
  components: MeshComponent[];
  /** One per non-fragment component, in component order. */
  fits: ComponentFit[];
  warnings: XchangeWarning[];
}

const COARSE_SAMPLES = 32;
const COARSE_ITERATIONS = 3;
const FINALISTS = 4;
const FINE_ITERATIONS = 30;
const PROBE_ITERATIONS = 10;
const CLOCKING_STEP_RAD = Math.PI / 12;
const CLOCKING_REFINES = 3;
const INDEX_AMBIGUITY_RAD = (5 * Math.PI) / 180;
const SAME_AXIS_RAD = (2 * Math.PI) / 180;
const SHIFT_PROBE_MM = 0.5;
const REFERENCE_SAMPLES = 400;
/** ponytail: heuristic until Fernando's real captures (spec P5); below it the shell may only touch part of the reference. */
const MIN_REFERENCE_COVERAGE = 0.5;

interface Reference {
  target: SurfaceTarget;
  area: number;
  diagonal: number;
  pca: Pca;
  /** Highest z of the reference (implant frame): its top, which a scan always captures. */
  top: number;
  /** Surface samples in the implant frame. */
  samples: Float64Array;
}

interface Candidate {
  /** capture -> implant frame (the inverse of the site matrix). */
  u: Mat4;
  stats: FitStats;
  converged: boolean;
}

interface Settings {
  samples: number;
  maxRmsMm: number;
  minCoverage: number;
  seed: number;
}

/** Fits `reference` (implant frame) to every non-fragment component: PCA starts + ICP on the reference BVH. */
export function recoverSitesFromMesh(captureMesh: TriMesh, reference: ReferenceBody, options: RecoverOptions = {}): RecoverResult {
  const settings = resolveOptions(options);
  const source = options.source ?? 'stl';
  checkMesh(reference.mesh);
  const area = surfaceArea(reference.mesh);
  if (!(area > 0) || !Number.isFinite(area)) throw new XchangeError('REFERENCE_NO_MATCH', { reason: 'zeroArea' });
  const components = splitComponents(captureMesh);
  const pca = pcaOfSurface(reference.mesh);
  const bounds = computeBounds(reference.mesh);
  const ref: Reference = {
    target: surfaceTarget(reference.mesh),
    area,
    diagonal: diagonal(bounds),
    pca,
    top: bounds.max[2],
    samples: sampleSurface(reference.mesh, REFERENCE_SAMPLES, settings.seed).points,
  };

  const sites: ImplantSite[] = [];
  const unresolved: number[] = [];
  const fits: ComponentFit[] = [];
  for (const component of components) {
    if (component.fragment) continue;
    const { fit, pose } = fitComponent(component, ref, settings);
    fits.push(fit);
    if (fit.status === 'unresolved' || !pose) {
      unresolved.push(component.index);
      continue;
    }
    const flags: ImplantSite['flags'] = {};
    if (fit.indexAmbiguous) flags.indexAmbiguous = true;
    if (fit.status === 'provisional') flags.provisional = true;
    const n = sites.length + 1;
    sites.push({ id: `site-${n}`, label: `Implant ${n}`, matrix: pose, source, flags, componentIndex: component.index });
  }

  const warnings: XchangeWarning[] = [];
  const fragments = components.filter((c) => c.fragment).length;
  if (fragments) warnings.push({ code: 'COMPONENT_FRAGMENTS', details: { count: fragments } });
  const ambiguous = sites.filter((s) => s.flags.indexAmbiguous).length;
  if (ambiguous) warnings.push({ code: 'SITE_INDEX_AMBIGUOUS', details: { count: ambiguous } });
  const provisional = sites.filter((s) => s.flags.provisional).length;
  if (provisional) warnings.push({ code: 'SITE_PROVISIONAL', details: { count: provisional } });
  return { sites, unresolved, components, fits, warnings };
}

function resolveOptions(o: RecoverOptions): Settings {
  const settings = { samples: o.samples ?? 400, maxRmsMm: o.maxRmsMm ?? 0.03, minCoverage: o.minCoverage ?? 0.98, seed: o.seed ?? 1 };
  if (!Number.isInteger(settings.samples) || settings.samples < 24 || settings.samples > 20_000) throw new XchangeError('INVALID_ARGUMENT', { reason: 'samples' });
  if (!(settings.maxRmsMm > 0 && settings.maxRmsMm <= 1)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'maxRmsMm' });
  if (!(settings.minCoverage >= 0 && settings.minCoverage <= 1)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'minCoverage' });
  if (!Number.isSafeInteger(settings.seed)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'seed' });
  if (o.source !== undefined && !(['stl', 'ply', 'obj'] as const).includes(o.source)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'source' });
  return settings;
}

function fitComponent(component: MeshComponent, ref: Reference, o: Settings): { fit: ComponentFit; pose: Mat4 | null } {
  const noFit: ComponentFit = {
    componentIndex: component.index,
    status: 'unresolved',
    rmsMm: Infinity,
    p95Mm: Infinity,
    coverage: 0,
    referenceCoverage: 0,
    converged: false,
    indexAmbiguous: false,
    datumAmbiguous: false,
  };
  // A shell much bigger than the reference (an arch, a fused bridge) cannot be that body.
  if (!(component.areaMm2 > 0) || diagonal(component.bounds) > 1.5 * ref.diagonal || component.areaMm2 > 2 * ref.area) {
    return { fit: noFit, pose: null };
  }
  const n = o.samples;
  const samples = sampleSurface(component.mesh, n, o.seed + component.index).points;
  const tol = o.maxRmsMm;
  const fine: IcpSettings = { iterations: FINE_ITERATIONS, startThresholdMm: 0.1 * ref.diagonal, floorMm: 2 * tol, maxStepRad: 0.3, maxStepMm: 0.1 * ref.diagonal };
  const refine = (u0: Mat4, iterations: number): Candidate => {
    const r = icp(samples, n, ref.target, u0, { ...fine, iterations });
    return { u: r.transform, stats: measure(samples, n, ref.target.bvh, r.transform, tol), converged: r.converged };
  };
  const margin = (c: Candidate): number => Math.max(0.1 * tol, 0.1 * c.stats.rmsMm);
  const fitsAsWell = (c: Candidate, best: Candidate): boolean => c.stats.rmsMm <= best.stats.rmsMm + margin(best);
  const byRms = (a: Candidate, b: Candidate): number => a.stats.rmsMm - b.stats.rmsMm;

  // 1. Global search: coarse ICP from every start, then fine ICP from the best distinct ones.
  const coarseN = Math.min(COARSE_SAMPLES, n);
  const coarse: IcpSettings = { iterations: COARSE_ITERATIONS, startThresholdMm: 0.5 * ref.diagonal, floorMm: 2 * tol, maxStepRad: 0.5, maxStepMm: 0.25 * ref.diagonal };
  const ranked = startPoses(component, ref).map((u0) => {
    const u = icp(samples, coarseN, ref.target, u0, coarse).transform;
    return { u, score: measure(samples, coarseN, ref.target.bvh, u, tol, 0.1 * ref.diagonal).rmsMm };
  });
  ranked.sort((a, b) => a.score - b.score);
  const finalists: Mat4[] = [];
  for (const { u } of ranked) {
    if (finalists.length >= FINALISTS) break;
    const distinct = finalists.every((f) => {
      const [angle, move] = poseDifference(inverseRigid(f), inverseRigid(u), ref.pca.centroid);
      return angle > (10 * Math.PI) / 180 || move > 0.5;
    });
    if (distinct) finalists.push(u);
  }
  const candidates = finalists.map((u) => refine(u, FINE_ITERATIONS));
  let best = candidates.reduce((a, b) => (byRms(b, a) < 0 ? b : a));

  // 2. Probes around the best pose (moves in the implant frame): top/bottom flips about the
  // reference centroid (refined: a near-symmetric body may have to slide into place), then axial
  // shifts and clockings about the implant axis, measured raw (an exact symmetry fits as well
  // right there) with only the promising ones refined.
  const probe = (around: Candidate): Candidate[] => {
    const raw = (moves: Mat4[]): Candidate[] =>
      moves.map((move) => {
        const u = multiply(move, around.u);
        return { u, stats: measure(samples, n, ref.target.bvh, u, tol), converged: around.converged };
      });
    const refinePromising = (group: Candidate[], budget: number): Candidate[] =>
      group.some((c) => fitsAsWell(c, around))
        ? []
        : group.filter((c) => c.stats.rmsMm <= 3 * tol).sort(byRms).slice(0, budget).map((c) => refine(c.u, PROBE_ITERATIONS));
    const flips = ([[1, 0, 0], [0, 1, 0]] as Vec3[]).map((axis) => refine(multiply(fromAxisAngle(axis, Math.PI, ref.pca.centroid), around.u), PROBE_ITERATIONS));
    const shifts = raw([SHIFT_PROBE_MM, -SHIFT_PROBE_MM].map((shift) => fromTranslation([0, 0, -shift])));
    const clockings: Mat4[] = [];
    for (let k = 1; k * CLOCKING_STEP_RAD < 2 * Math.PI - 1e-9; k++) clockings.push(fromAxisAngle([0, 0, 1], -k * CLOCKING_STEP_RAD));
    const clocked = raw(clockings);
    return [...flips, ...shifts, ...refinePromising(shifts, 1), ...clocked, ...refinePromising(clocked, CLOCKING_REFINES)];
  };
  candidates.push(...probe(best));
  // A probe that clearly beats the search result becomes the best pose; probe once more around it.
  const improved = candidates.filter((c) => c.stats.rmsMm < best.stats.rmsMm - margin(best)).sort(byRms)[0];
  if (improved) {
    best = improved;
    candidates.push(...probe(best));
  }

  // 3. Ambiguity: compare every pose that fits as well with the best one.
  const pose = inverseRigid(best.u);
  let indexAmbiguous = false, datumAmbiguous = false;
  for (const c of candidates) {
    if (c === best || !fitsAsWell(c, best)) continue;
    const other = inverseRigid(c.u);
    const originMoved = distance(getColumn(other, 3), getColumn(pose, 3));
    const axisAngle = Math.acos(Math.min(1, Math.max(-1, dot(getColumn(other, 2), getColumn(pose, 2)))));
    if (originMoved <= tol && axisAngle <= SAME_AXIS_RAD) {
      if (rotationAngleBetween(other, pose) > INDEX_AMBIGUITY_RAD) indexAmbiguous = true;
    } else {
      datumAmbiguous = true;
    }
  }

  // 4. The other direction: how much of the reference the shell covers at this pose.
  const referenceCoverage = measure(ref.samples, ref.samples.length / 3, buildBvh(component.mesh), pose, tol).coverage;
  const s = best.stats;
  const reliable =
    best.converged && s.rmsMm <= tol && s.coverage >= o.minCoverage && s.p95Mm <= 2 * tol && !datumAmbiguous && referenceCoverage >= MIN_REFERENCE_COVERAGE;
  const status: FitStatus = reliable ? 'reliable' : s.rmsMm <= 3 * tol ? 'provisional' : 'unresolved';
  const usable = status !== 'unresolved'; // ambiguity says nothing about a pose that does not fit
  const fit: ComponentFit = {
    componentIndex: component.index,
    status,
    rmsMm: s.rmsMm,
    p95Mm: s.p95Mm,
    coverage: s.coverage,
    referenceCoverage,
    converged: best.converged,
    indexAmbiguous: usable && indexAmbiguous,
    datumAmbiguous: usable && datumAmbiguous,
  };
  // Re-orthonormalise through the quaternion (ICP composes many steps), then the usual gate.
  const clean = validateRigid(fromQuaternion(toQuaternion(pose), [pose[3]!, pose[7]!, pose[11]!]));
  return { fit, pose: clean };
}

/** The 24 proper rotations that map coordinate axes onto signed coordinate axes. */
const AXIS_MATCHINGS: Mat4[] = (() => {
  const out: Mat4[] = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const perm of perms) {
    for (let signs = 0; signs < 8; signs++) {
      const m = new Float64Array(16);
      m[15] = 1;
      for (let r = 0; r < 3; r++) m[r * 4 + perm[r]!] = signs & (1 << r) ? -1 : 1;
      const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
      if (det > 0) out.push(m);
    }
  }
  return out;
})();

/**
 * Starting poses (capture -> implant frame) for these rotations: (a) implant +Z along each signed
 * principal axis of the shell, clocked every 30° (cylinder-like bodies, where two principal axes are
 * arbitrary), (b) the reference's principal frame onto the shell's in all 24 proper axis matchings
 * (bodies with three distinct principal axes). Each rotation is placed twice: reference centroid on
 * the shell centroid, and tops aligned along the candidate +Z. A scan loses the bottom of a body (under
 * the gum), never its top: then the centroids sit millimetres apart along the axis, out of ICP's reach
 * on a cylinder wall that slides freely, while the tops still match.
 */
function startPoses(component: MeshComponent, ref: Reference): Mat4[] {
  const shellPca = pcaOfSurface(component.mesh);
  const rotations: Mat4[] = [];
  for (const axis of shellPca.axes) {
    for (const sign of [1, -1]) {
      const z = scale(axis, sign);
      const p = perpendicular(z), q = cross(z, p);
      for (let k = 0; k < 12; k++) {
        const phi = (k * Math.PI) / 6;
        const x: Vec3 = [Math.cos(phi) * p[0] + Math.sin(phi) * q[0], Math.cos(phi) * p[1] + Math.sin(phi) * q[1], Math.cos(phi) * p[2] + Math.sin(phi) * q[2]];
        rotations.push(fromAxes(x, cross(z, x), z, [0, 0, 0]));
      }
    }
  }
  const shellFrame = fromAxes(...shellPca.axes, [0, 0, 0]);
  const refFrameInverse = inverseRigid(fromAxes(...ref.pca.axes, [0, 0, 0]));
  for (const s of AXIS_MATCHINGS) rotations.push(multiply(shellFrame, multiply(s, refFrameInverse)));
  const v = component.mesh.positions;
  return rotations.flatMap((r) => {
    const t = sub(component.centroid, transformDirection(r, ref.pca.centroid));
    const z = getColumn(r, 2);
    let shellTop = -Infinity;
    for (let i = 0; i < v.length; i += 3) shellTop = Math.max(shellTop, v[i]! * z[0] + v[i + 1]! * z[1] + v[i + 2]! * z[2]);
    const shift = shellTop - (dot(t, z) + ref.top); // the reference top lands at dot(t, z) + ref.top along z
    return [inverseRigid(compose(t, r)), inverseRigid(compose(add(t, scale(z, shift)), r))];
  });
}

function perpendicular(v: Readonly<Vec3>): Vec3 {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  const e: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(v, e));
}

const LINK_MAX_COST_MM = 10;
/** A centroid this far along a site's axis is not that implant's body (the tallest library parts are 19 mm). */
const SITE_MAX_HEIGHT_MM = 20;

/**
 * Distance-like cost of a point in a site's frame: off-axis distance plus a tenth of the height, plus, beyond
 * SITE_MAX_HEIGHT_MM along the axis, every millimetre in full. Without that last term a body 47 mm along the axis
 * of a position in another coordinate system cost under 10 mm and was linked to it.
 */
export function siteCost(siteInverse: Mat4, point: Readonly<Vec3>): number {
  const p = transformPoint(siteInverse, point);
  const height = Math.abs(p[2]);
  return Math.hypot(p[0], p[1]) + 0.1 * height + Math.max(0, height - SITE_MAX_HEIGHT_MM);
}

/**
 * Position file + capture mesh: gives each site the nearest unused non-fragment component
 * (siteCost of the component centroid, globally greedy, at most 10 mm). Returns new site objects;
 * unmatched sites carry no componentIndex.
 */
export function linkSitesToComponents(sites: readonly ImplantSite[], components: readonly MeshComponent[]): ImplantSite[] {
  const pairs: { site: number; component: number; cost: number }[] = [];
  sites.forEach((site, i) => {
    const inverse = inverseRigid(validateRigid(site.matrix));
    for (const c of components) {
      if (c.fragment) continue;
      const cost = siteCost(inverse, c.centroid);
      if (cost <= LINK_MAX_COST_MM) pairs.push({ site: i, component: c.index, cost });
    }
  });
  pairs.sort((a, b) => a.cost - b.cost || a.site - b.site || a.component - b.component);
  const assigned = new Map<number, number>();
  const used = new Set<number>();
  for (const pair of pairs) {
    if (assigned.has(pair.site) || used.has(pair.component)) continue;
    assigned.set(pair.site, pair.component);
    used.add(pair.component);
  }
  return sites.map((site, i) => {
    const { componentIndex: _previous, ...rest } = site;
    const copy: ImplantSite = { ...rest, matrix: site.matrix.slice(), flags: { ...site.flags } };
    const component = assigned.get(i);
    if (component !== undefined) copy.componentIndex = component;
    return copy;
  });
}
