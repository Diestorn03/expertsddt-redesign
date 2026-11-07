/**
 * Trimmed point-to-plane ICP of assembly surface samples against jaw surface samples.
 *
 * Errors: INVALID_ARGUMENT (details.reason 'shape' | 'nonFinite' | 'indexRange' | 'tooManyTriangles' |
 * 'tooManyParts' | 'siteId' | 'samples' | an option name), INSUFFICIENT_DATA (reason 'noParts' | 'noTriangles'),
 * CANCELLED, DEGENERATE_GEOMETRY (reason 'zeroArea', from core sampling).
 */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { multiply, rotationAngleBetween, transformPoint } from '../core/mat4';
import { checkMesh, countTriangles, surfaceArea } from '../core/mesh';
import { kabsch, solvePointToPlane } from '../core/rigid';
import { createRng, sampleSurface, type SurfaceSamples } from '../core/sampling';
import type { AssemblyPart, Mat4, TriMesh, Vec3 } from '../core/types';
import { distance } from '../core/vec3';
import { buildKdTree, buildTriangleTree, closestOnSurface, nearest, type KdTree, type TriangleTree } from './kdtree';

export interface IcpTarget {
  /** Jaw surface samples, xyz. */
  points: Float64Array;
  /** Unit face normal per sample. */
  normals: Float64Array;
  tree: KdTree;
  /** Exact triangle index of the jaw surface (metrics, deviation map). Addition to CONTRACTS.md. */
  surface: TriangleTree;
}

export interface IcpOptions {
  maxIterations?: number; // 60
  trimFraction?: number; // 0.8: keep the closest 80 % of pairs
  maxCorrespondenceMm?: number; // 1.0
  minNormalDot?: number; // 0.35, on |cos|; pairs must also face the way most pairs face (winding-agnostic)
  convergenceMm?: number; // 1e-5
  convergenceRad?: number; // 1e-5
  onIteration?: (iteration: number, rmsMm: number) => void;
  /** Checked every iteration; true -> throw XchangeError('CANCELLED'). */
  shouldCancel?: () => boolean;
}

export interface IcpResult {
  transform: Mat4;
  /** Point-to-plane RMS of the kept pairs in the last iteration (Infinity when there were too few pairs). */
  rmsMm: number;
  pairs: number;
  iterations: number;
  converged: boolean;
}

export const MIN_PAIRS = 6;
/** Target samples: one per TARGET_SPACING_MM² of jaw surface, clamped. */
const TARGET_SPACING_MM = 0.15;
const TARGET_SAMPLES = { min: 20_000, max: 120_000 };
/** A point-to-plane step that turns more than this is outside its linearisation: use point-to-point. */
const MAX_PLANE_STEP_RAD = 0.25;
/** Robust polish: pairs whose |point-to-plane residual| exceeds max(floorMm, sigmas × mad × median) are dropped. */
const ROBUST = { sigmas: 3, mad: 1.4826, floorMm: 0.05 };
/** Local refinement (landmarks, previous pose) first runs this wider, shorter pass. */
const LOCAL_COARSE = { iterations: 20, minDistanceMm: 3, normalDot: 0.2 };
const PART_MAX_TRIANGLES = LIMITS.capture.maxTriangles;
const PARTS_MAX_TRIANGLES = LIMITS.jaw.maxTriangles;

type IcpSettings = Required<Omit<IcpOptions, 'onIteration' | 'shouldCancel'>> & Pick<IcpOptions, 'onIteration' | 'shouldCancel'>;

/** `value ?? fallback`, which must pass `ok`; else INVALID_ARGUMENT with reason `name`. */
export function option(value: number | undefined, fallback: number, name: string, ok: (v: number) => boolean): number {
  const v = value ?? fallback;
  if (!(typeof v === 'number' && ok(v))) throw new XchangeError('INVALID_ARGUMENT', { reason: name });
  return v;
}

export function icpSettings(o: IcpOptions = {}): IcpSettings {
  const positive = (v: number): boolean => v > 0 && Number.isFinite(v);
  return {
    maxIterations: option(o.maxIterations, 60, 'maxIterations', (v) => Number.isInteger(v) && v >= 1 && v <= 200),
    trimFraction: option(o.trimFraction, 0.8, 'trimFraction', (v) => v >= 0.3 && v <= 1),
    maxCorrespondenceMm: option(o.maxCorrespondenceMm, 1, 'maxCorrespondenceMm', (v) => positive(v) && v <= 100),
    minNormalDot: option(o.minNormalDot, 0.35, 'minNormalDot', (v) => v >= 0 && v <= 1),
    convergenceMm: option(o.convergenceMm, 1e-5, 'convergenceMm', positive),
    convergenceRad: option(o.convergenceRad, 1e-5, 'convergenceRad', positive),
    onIteration: o.onIteration,
    shouldCancel: o.shouldCancel,
  };
}

/** core checkMesh (shape, limit, finiteness, index range) plus at least one triangle. */
export function checkUsableMesh(mesh: TriMesh, maxTriangles: number): void {
  checkMesh(mesh, maxTriangles);
  if (mesh.indices.length === 0) throw new XchangeError('INSUFFICIENT_DATA', { reason: 'noTriangles' });
}

export function checkParts(parts: readonly AssemblyPart[]): void {
  if (!Array.isArray(parts) || parts.length === 0) throw new XchangeError('INSUFFICIENT_DATA', { reason: 'noParts' });
  if (parts.length > LIMITS.positions.maxPositions) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'tooManyParts', limit: LIMITS.positions.maxPositions });
  }
  let total = 0;
  for (const part of parts) {
    if (typeof part?.siteId !== 'string' || !part.siteId) throw new XchangeError('INVALID_ARGUMENT', { reason: 'siteId' });
    checkUsableMesh(part.mesh, PART_MAX_TRIANGLES);
    total += countTriangles(part.mesh);
  }
  if (total > PARTS_MAX_TRIANGLES) throw new XchangeError('INVALID_ARGUMENT', { reason: 'tooManyTriangles', limit: PARTS_MAX_TRIANGLES });
}

/** Jaw samples (default one per 0.15 mm², 20 k-120 k), their k-d tree and the exact triangle tree. */
export function buildIcpTarget(jaw: TriMesh, options: { samples?: number; seed?: number } = {}): IcpTarget {
  checkUsableMesh(jaw, LIMITS.jaw.maxTriangles);
  const area = surfaceArea(jaw);
  const auto = Math.round(area / (TARGET_SPACING_MM * TARGET_SPACING_MM));
  const samples = options.samples ?? Math.min(TARGET_SAMPLES.max, Math.max(TARGET_SAMPLES.min, Number.isFinite(auto) ? auto : 0));
  if (!Number.isInteger(samples) || samples < 100 || samples > 1_000_000) throw new XchangeError('INVALID_ARGUMENT', { reason: 'samples' });
  const s = sampleSurface(jaw, samples, options.seed ?? 1);
  return { points: s.points, normals: s.normals, tree: buildKdTree(s.points), surface: buildTriangleTree(jaw) };
}

/**
 * `total` samples split equally between the parts (every implant weighs the same), shuffled so any
 * prefix is still spread over all parts. `triangles` holds the triangle index within each part.
 */
export function sampleParts(parts: readonly AssemblyPart[], total: number, seed: number): SurfaceSamples {
  const per = Math.max(1, Math.ceil(total / parts.length));
  const n = per * parts.length;
  const out: SurfaceSamples = { points: new Float64Array(3 * n), normals: new Float64Array(3 * n), triangles: new Uint32Array(n) };
  parts.forEach((part, k) => {
    const s = sampleSurface(part.mesh, per, seed + k);
    out.points.set(s.points, 3 * k * per);
    out.normals.set(s.normals, 3 * k * per);
    out.triangles.set(s.triangles, k * per);
  });
  const rng = createRng(seed ^ 0x5bd1e995);
  const { points, normals, triangles } = out;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = triangles[i]!;
    triangles[i] = triangles[j]!;
    triangles[j] = t;
    for (let k = 0; k < 3; k++) {
      const p = points[3 * i + k]!;
      points[3 * i + k] = points[3 * j + k]!;
      points[3 * j + k] = p;
      const q = normals[3 * i + k]!;
      normals[3 * i + k] = normals[3 * j + k]!;
      normals[3 * j + k] = q;
    }
  }
  return out;
}

/** The first `count` samples (views, no copy). */
export function prefixSamples(s: SurfaceSamples, count: number): SurfaceSamples {
  const n = Math.min(count, s.triangles.length);
  return { points: s.points.subarray(0, 3 * n), normals: s.normals.subarray(0, 3 * n), triangles: s.triangles.subarray(0, n) };
}

/**
 * Trimmed ICP from `initial`: point-to-plane steps, point-to-point (kabsch) when that fails or the fit is
 * still far off. `robust` also drops pairs whose point-to-plane residual exceeds ROBUST sigmas (MAD); use
 * it only to polish an already converged pose, since early on it can drop the few pairs that hold a
 * sliding direction (e.g. the caps of a round body).
 */
export function icp(source: SurfaceSamples, target: IcpTarget, initial: Mat4, options: IcpOptions = {}, robust = false): IcpResult {
  const o = icpSettings(options);
  const sp = source.points, sn = source.normals;
  const n = sp.length / 3;
  if (!Number.isInteger(n) || n < 1 || sn.length !== sp.length) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  const tp = target.points, tn = target.normals, tree = target.tree;
  const maxD = o.maxCorrespondenceMm;
  const src = new Float64Array(3 * n), dst = new Float64Array(3 * n), nrm = new Float64Array(3 * n);
  const dist2 = new Float64Array(n), residual = new Float64Array(n), sorted = new Float64Array(n), facing = new Int8Array(n);
  /** Moves pair i to slot j (j <= i). */
  const move = (i: number, j: number): void => {
    if (i === j) return;
    for (let c = 0; c < 3; c++) {
      src[3 * j + c] = src[3 * i + c]!;
      dst[3 * j + c] = dst[3 * i + c]!;
      nrm[3 * j + c] = nrm[3 * i + c]!;
    }
    dist2[j] = dist2[i]!;
    residual[j] = residual[i]!;
    facing[j] = facing[i]!;
  };

  // Poses are compared by their rotation and by where they put the samples' centroid.
  const centroid: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    centroid[0] += sp[3 * i]! / n;
    centroid[1] += sp[3 * i + 1]! / n;
    centroid[2] += sp[3 * i + 2]! / n;
  }
  const settled = (a: Mat4, b: Mat4): boolean =>
    rotationAngleBetween(a, b) < o.convergenceRad && distance(transformPoint(a, centroid), transformPoint(b, centroid)) < o.convergenceMm;

  let transform: Mat4 = Float64Array.from(initial);
  let previous: Mat4 | null = null;
  let rms = Infinity, pairs = 0, iterations = 0, converged = false;
  for (let iteration = 0; iteration < o.maxIterations; iteration++) {
    if (o.shouldCancel?.()) throw new XchangeError('CANCELLED');
    const t = transform;
    const m0 = t[0]!, m1 = t[1]!, m2 = t[2]!, m3 = t[3]!, m4 = t[4]!, m5 = t[5]!;
    const m6 = t[6]!, m7 = t[7]!, m8 = t[8]!, m9 = t[9]!, m10 = t[10]!, m11 = t[11]!;
    let m = 0, agree = 0;
    for (let i = 0; i < n; i++) {
      const x = sp[3 * i]!, y = sp[3 * i + 1]!, z = sp[3 * i + 2]!;
      const px = m0 * x + m1 * y + m2 * z + m3, py = m4 * x + m5 * y + m6 * z + m7, pz = m8 * x + m9 * y + m10 * z + m11;
      const j = nearest(tree, px, py, pz, maxD);
      if (j < 0) continue;
      const ux = sn[3 * i]!, uy = sn[3 * i + 1]!, uz = sn[3 * i + 2]!;
      const qnx = tn[3 * j]!, qny = tn[3 * j + 1]!, qnz = tn[3 * j + 2]!;
      const dot = (m0 * ux + m1 * uy + m2 * uz) * qnx + (m4 * ux + m5 * uy + m6 * uz) * qny + (m8 * ux + m9 * uy + m10 * uz) * qnz;
      if (Math.abs(dot) < o.minNormalDot) continue;
      facing[m] = dot > 0 ? 1 : -1;
      if (dot > 0) agree++;
      const qx = tp[3 * j]!, qy = tp[3 * j + 1]!, qz = tp[3 * j + 2]!;
      src[3 * m] = px;
      src[3 * m + 1] = py;
      src[3 * m + 2] = pz;
      dst[3 * m] = qx;
      dst[3 * m + 1] = qy;
      dst[3 * m + 2] = qz;
      nrm[3 * m] = qnx;
      nrm[3 * m + 1] = qny;
      nrm[3 * m + 2] = qnz;
      dist2[m] = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
      m++;
    }
    // Keep the pairs whose normals face the way most pairs do: a pair facing the other way matches the
    // back of a surface (e.g. the buried bottom of a scan body and the gum above it). Taking the majority
    // keeps files whose winding is inverted as a whole working.
    const majority = agree >= m - agree ? 1 : -1;
    let k = 0;
    for (let i = 0; i < m; i++) if (facing[i] === majority) move(i, k++);
    pairs = k;
    if (k < MIN_PAIRS) {
      rms = Infinity;
      break;
    }
    // Trim: keep the closest trimFraction of the pairs (distance to the matched sample).
    const keep = Math.max(MIN_PAIRS, Math.floor(k * o.trimFraction));
    if (keep < k) {
      const view = sorted.subarray(0, k);
      view.set(dist2.subarray(0, k));
      view.sort();
      const limit = view[keep - 1]!;
      let kept = 0;
      for (let i = 0; i < k && kept < keep; i++) if (dist2[i]! <= limit) move(i, kept++);
      k = kept;
    }
    for (let i = 0; i < k; i++) {
      residual[i] = (src[3 * i]! - dst[3 * i]!) * nrm[3 * i]! + (src[3 * i + 1]! - dst[3 * i + 1]!) * nrm[3 * i + 1]! + (src[3 * i + 2]! - dst[3 * i + 2]!) * nrm[3 * i + 2]!;
    }
    if (robust) {
      const view = sorted.subarray(0, k);
      for (let i = 0; i < k; i++) view[i] = Math.abs(residual[i]!);
      view.sort();
      const limit = Math.max(ROBUST.floorMm, ROBUST.sigmas * ROBUST.mad * view[(k - 1) >>> 1]!);
      let inliers = 0;
      for (let i = 0; i < k; i++) if (Math.abs(residual[i]!) <= limit) inliers++;
      if (inliers >= MIN_PAIRS && inliers < k) {
        let kept = 0;
        for (let i = 0; i < k; i++) if (Math.abs(residual[i]!) <= limit) move(i, kept++);
        k = kept;
      }
    }
    pairs = k;
    let plane2 = 0, euclid2 = 0;
    for (let i = 0; i < k; i++) {
      plane2 += residual[i]! * residual[i]!;
      euclid2 += dist2[i]!;
    }
    rms = Math.sqrt(plane2 / k);

    const s3 = src.subarray(0, 3 * k), d3 = dst.subarray(0, 3 * k);
    let next: Mat4 | null = null;
    if (Math.sqrt(euclid2 / k) < 0.5 * maxD) {
      const step = solvePointToPlane(s3, d3, nrm.subarray(0, 3 * k));
      if (step) {
        next = multiply(step, t);
        // A large turn or shift is outside the linearisation: take a point-to-point step instead.
        if (rotationAngleBetween(next, t) > MAX_PLANE_STEP_RAD || distance(transformPoint(next, centroid), transformPoint(t, centroid)) > maxD) next = null;
      }
    }
    transform = next ?? multiply(kabsch(s3, d3), t);
    iterations++;
    o.onIteration?.(iterations, rms);
    // Converged when the step is below both thresholds, or when the pose came back to where it was two
    // steps ago (discrete correspondences can flip between two states a few nanometres apart).
    if (settled(transform, t) || (previous && settled(transform, previous))) {
      converged = true;
      break;
    }
    previous = t;
  }
  return { transform, rmsMm: rms, pairs, iterations, converged };
}

/** Final poses are ranked with residuals capped at this many coverage tolerances. */
const RANK_CAP_TOLERANCES = 3;

/** sqrt(mean(min(d², cap²))): untrimmed but bounded score on the exact surface, used to rank poses. */
export function cappedRms(samples: SurfaceSamples, surface: TriangleTree, t: Mat4, capMm: number): number {
  const p = samples.points, n = p.length / 3, cap2 = capMm * capMm;
  const m0 = t[0]!, m1 = t[1]!, m2 = t[2]!, m3 = t[3]!, m4 = t[4]!, m5 = t[5]!;
  const m6 = t[6]!, m7 = t[7]!, m8 = t[8]!, m9 = t[9]!, m10 = t[10]!, m11 = t[11]!;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i]!, y = p[3 * i + 1]!, z = p[3 * i + 2]!;
    const d2 = closestOnSurface(surface, m0 * x + m1 * y + m2 * z + m3, m4 * x + m5 * y + m6 * z + m7, m8 * x + m9 * y + m10 * z + m11, capMm);
    sum += Math.min(d2, cap2);
  }
  return Math.sqrt(sum / n);
}

/**
 * Ranking score of a refined pose: cappedRms with the cap at RANK_CAP_TOLERANCES × toleranceMm, so the
 * part of a body hidden in the gum (no match for any pose) does not mask how well the visible part fits.
 */
export function poseScore(samples: SurfaceSamples, surface: TriangleTree, t: Mat4, toleranceMm: number): number {
  return cappedRms(samples, surface, t, RANK_CAP_TOLERANCES * toleranceMm);
}

/**
 * Robust polish of a converged pose: icp in robust mode, kept only if it scores better on the exact
 * surface (poseScore). Returns the chosen fit and its score.
 */
export function polish(source: SurfaceSamples, target: IcpTarget, fit: IcpResult, options: IcpOptions, toleranceMm: number): { fit: IcpResult; score: number } {
  const before = poseScore(source, target.surface, fit.transform, toleranceMm);
  const robust = icp(source, target, fit.transform, { ...options, onIteration: undefined }, true);
  const after = robust.pairs >= MIN_PAIRS ? poseScore(source, target.surface, robust.transform, toleranceMm) : Infinity;
  return after <= before ? { fit: robust, score: after } : { fit, score: before };
}

/** Local refinement from a rough pose (clicks, previous fit): a wider coarse pass, then `options`. */
export function refineLocal(source: SurfaceSamples, target: IcpTarget, initial: Mat4, options: IcpOptions = {}): IcpResult {
  const o = icpSettings(options);
  const coarse = icp(source, target, initial, {
    ...o,
    maxIterations: Math.min(o.maxIterations, LOCAL_COARSE.iterations),
    maxCorrespondenceMm: Math.min(100, Math.max(3 * o.maxCorrespondenceMm, LOCAL_COARSE.minDistanceMm)),
    minNormalDot: Math.min(o.minNormalDot, LOCAL_COARSE.normalDot),
    onIteration: undefined,
  });
  return icp(source, target, coarse.pairs >= MIN_PAIRS ? coarse.transform : initial, o);
}
