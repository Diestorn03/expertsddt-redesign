/**
 * Guided clicks 1-2-3-4: a rigid pose from point pairs (assembly point -> where it lies on the jaw),
 * then a local ICP refinement from that pose (no global search).
 *
 * Errors: LANDMARKS_INVALID (details.reason 'none' | 'nonFinite' | 'coincident'), plus those of
 * icp.ts / metrics.ts, DEGENERATE_GEOMETRY (empty body in guidePoint), CANCELLED.
 */
import { XchangeError } from '../core/errors';
import { solveLinear } from '../core/linalg';
import { fromAxisAngle, fromTranslation, getColumn, identity, transformDirection, transformPoint } from '../core/mat4';
import { computeBounds } from '../core/mesh';
import { kabsch } from '../core/rigid';
import type { AlignmentFlag, AlignmentResult, AssemblyPart, ImplantSite, LandmarkPair, Mat4, TriMesh, Vec3 } from '../core/types';
import { cross, dot, length, sub } from '../core/vec3';
import { checkParts, MIN_PAIRS, polish, poseScore, refineLocal, sampleParts, type IcpTarget } from './icp';
import { alignSettings, finishResult, icpFlags, pointPca, sourceFlags } from './metrics';
import type { AlignOptions } from './multistart';

export interface LandmarkFit {
  transform: Mat4;
  mode: 'translation' | 'axis' | 'full';
  rmsMm: number;
}

/** Clicks whose RMS spread is below this (mm) are one point. */
const COINCIDENT_MM = 1e-3;
/** A point set whose second spread is below this fraction of the first is a line: its roll is free. */
const COLLINEAR_RATIO = 0.01;
/** A fitted arch circle wider than this many point spreads means "straight": order by projection. */
const STRAIGHT_RADIUS_RATIO = 1e3;

const flat = (points: readonly Vec3[]): Float64Array => Float64Array.from(points.flat());

/** Smallest rotation taking unit vector a onto unit vector b. */
function minimalRotation(a: Vec3, b: Vec3): Mat4 {
  const axis = cross(a, b);
  const s = length(axis), c = dot(a, b);
  if (s > 1e-12) return fromAxisAngle(axis, Math.atan2(s, c));
  if (c > 0) return identity();
  const helper: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return fromAxisAngle(cross(a, helper), Math.PI);
}

/** 1 pair: translation. 2 pairs or collinear: minimal rotation aligning the line + translation (roll free). 3+ non-collinear: kabsch. */
export function landmarkAlign(pairs: readonly LandmarkPair[]): LandmarkFit {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new XchangeError('LANDMARKS_INVALID', { reason: 'none' });
  const finite = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!pairs.every((p) => finite(p?.source) && finite(p?.target))) throw new XchangeError('LANDMARKS_INVALID', { reason: 'nonFinite' });
  const sources = pairs.map((p) => p.source), targets = pairs.map((p) => p.target);
  if (pairs.length === 1) return { transform: fromTranslation(sub(targets[0]!, sources[0]!)), mode: 'translation', rmsMm: 0 };

  const src = flat(sources), dst = flat(targets);
  const ps = pointPca(src), pt = pointPca(dst);
  const spread = (v: number): number => Math.sqrt(v);
  if (spread(ps.variances[0]) < COINCIDENT_MM || spread(pt.variances[0]) < COINCIDENT_MM) {
    throw new XchangeError('LANDMARKS_INVALID', { reason: 'coincident' });
  }
  const line = (v: Vec3): boolean => spread(v[1]) < COLLINEAR_RATIO * spread(v[0]);
  let transform: Mat4;
  let mode: LandmarkFit['mode'];
  if (pairs.length === 2 || line(ps.variances) || line(pt.variances)) {
    const us = ps.axes[0];
    let ut = pt.axes[0];
    let agreement = 0; // orient the target line like the source line, following the pairs
    for (let i = 0; i < pairs.length; i++) agreement += dot(sub(sources[i]!, ps.centroid), us) * dot(sub(targets[i]!, pt.centroid), ut);
    if (agreement < 0) ut = [-ut[0], -ut[1], -ut[2]];
    transform = minimalRotation(us, ut);
    const rc = transformDirection(transform, ps.centroid);
    transform[3] = pt.centroid[0] - rc[0];
    transform[7] = pt.centroid[1] - rc[1];
    transform[11] = pt.centroid[2] - rc[2];
    mode = 'axis';
  } else {
    transform = kabsch(src, dst);
    mode = 'full';
  }
  let sum = 0;
  for (let i = 0; i < pairs.length; i++) {
    const p = transformPoint(transform, sources[i]!), q = targets[i]!;
    sum += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  }
  return { transform, mode, rmsMm: Math.sqrt(sum / pairs.length) };
}

/** Guided point of a site: top centre of the body (bbox centre in X/Y, max Z, implant frame) in capture coordinates. */
export function guidePoint(site: ImplantSite, bodyInImplantFrame: TriMesh): Vec3 {
  const { min, max } = computeBounds(bodyInImplantFrame);
  return transformPoint(site.matrix, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]]);
}

/** Kåsa circle fit in the plane: centre, or null when the points are (numerically) on a line. */
function circleCentre(points: ReadonlyArray<readonly [number, number]>): [number, number] | null {
  const a = new Float64Array(9), b = new Float64Array(3);
  for (const [x, y] of points) {
    const row = [x, y, 1], rhs = -(x * x + y * y);
    for (let r = 0; r < 3; r++) {
      b[r] = b[r]! + row[r]! * rhs;
      for (let c = 0; c < 3; c++) a[3 * r + c] = a[3 * r + c]! + row[r]! * row[c]!;
    }
  }
  const s = solveLinear(a, b, 3);
  return s ? [-s[0]! / 2, -s[1]! / 2] : null;
}

/**
 * Order for the guided clicks 1-2-3-4: from one end of the arch to the other. The site origins are
 * sorted by angle around their best-fit circle in the arch plane and cut at the widest gap (the arch
 * opening), or by projection when they lie on a line. Starts at the end with the smaller capture X
 * (then Y, Z); ties keep the input order. Deterministic.
 */
export function orderSitesAlongArch(sites: readonly ImplantSite[]): ImplantSite[] {
  const n = sites.length;
  if (n <= 1) return [...sites];
  const origins = sites.map((s) => getColumn(s.matrix, 3));
  const pca = pointPca(flat(origins));
  const size = Math.sqrt(pca.variances[0]);
  if (!(size > COINCIDENT_MM)) return [...sites];
  const plane = origins.map((o): [number, number] => {
    const d = sub(o, pca.centroid);
    return [dot(d, pca.axes[0]), dot(d, pca.axes[1])];
  });
  const index = sites.map((_, i) => i);
  const centre = n >= 3 ? circleCentre(plane) : null;
  let order: number[];
  if (centre && Math.hypot(centre[0], centre[1]) < STRAIGHT_RADIUS_RATIO * size) {
    const angle = plane.map(([x, y]) => Math.atan2(y - centre[1], x - centre[0]));
    const sorted = index.sort((i, j) => angle[i]! - angle[j]! || i - j);
    let cut = 0, widest = -1;
    for (let k = 0; k < n; k++) {
      const from = angle[sorted[k]!]!, to = angle[sorted[(k + 1) % n]!]!;
      const gap = k === n - 1 ? to + 2 * Math.PI - from : to - from;
      if (gap > widest) {
        widest = gap;
        cut = (k + 1) % n;
      }
    }
    order = [...sorted.slice(cut), ...sorted.slice(0, cut)];
  } else {
    order = index.sort((i, j) => plane[i]![0] - plane[j]![0] || i - j);
  }
  const a = origins[order[0]!]!, z = origins[order[n - 1]!]!;
  const k = [0, 1, 2].find((c) => Math.abs(a[c]! - z[c]!) > 1e-9);
  if (k !== undefined && a[k]! > z[k]!) order.reverse();
  return order.map((i) => sites[i]!);
}

/** landmarkAlign, then local ICP refinement from that pose (no global search), then metrics. method 'landmarks'. */
export function alignFromLandmarks(
  parts: readonly AssemblyPart[],
  target: IcpTarget,
  pairs: readonly LandmarkPair[],
  options: AlignOptions = {},
): AlignmentResult {
  const fit = landmarkAlign(pairs);
  const settings = alignSettings(options);
  checkParts(parts);
  const progress = options.onProgress;
  const fine = settings.icp;
  progress?.('prepare', 0);
  const samples = sampleParts(parts, settings.sourceSamples, settings.seed);
  progress?.('prepare', 1);
  const refined = refineLocal(samples, target, fit.transform, {
    ...fine,
    onIteration: (iteration, rms) => {
      fine.onIteration?.(iteration, rms);
      progress?.('fine', Math.min(1, iteration / fine.maxIterations));
    },
  });
  const polished = refined.pairs >= MIN_PAIRS ? polish(samples, target, refined, fine, settings.toleranceMm) : null;
  progress?.('fine', 1);
  const applied = polished !== null && polished.score <= poseScore(samples, target.surface, fit.transform, settings.toleranceMm);
  const flags: AlignmentFlag[] = sourceFlags(parts, settings.quality);
  if (fit.mode === 'axis') flags.push('landmarkAxisFree'); // the clicks never fix the roll; the surface may or may not
  if (fit.mode === 'translation' && !applied) flags.push('landmarkTranslationOnly');
  if (applied) flags.push(...icpFlags(polished.fit, samples.triangles.length, fine.trimFraction));
  progress?.('metrics', 0);
  const result = finishResult(parts, target, applied ? polished.fit.transform : fit.transform, 'landmarks', flags, settings);
  progress?.('metrics', 1);
  return result;
}
