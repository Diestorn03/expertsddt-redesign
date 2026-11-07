/**
 * Automatic capture -> jaw alignment: global multi-start search, coarse ICP, up to 5 distinct finalists,
 * fine ICP, robust polish of the best, exact metrics and status. The jaw never moves.
 *
 * Starts: the capture pose as is, then for the identity and the 24 proper PCA axis matchings both the
 * centroid match and a translation voted by normal-compatible point pairs (a Hough vote: it finds the
 * scan bodies inside a much larger jaw even when the centroids do not correspond, e.g. 1-2 implants).
 *
 * Errors: everything from icp.ts / metrics.ts, MATRIX_INVALID / MATRIX_NOT_RIGID (initial),
 * ALIGNMENT_FAILED (reason 'noPairs': no start ever found 6 correspondences), CANCELLED.
 */
import { XchangeError } from '../core/errors';
import { identity, rotationAngleBetween, transformDirection, transformPoint, validateRigid } from '../core/mat4';
import type { SurfaceSamples } from '../core/sampling';
import type { AlignmentFlag, AlignmentResult, AssemblyPart, Mat4, Vec3 } from '../core/types';
import { distance } from '../core/vec3';
import { cappedRms, checkParts, icp, MIN_PAIRS, polish, poseScore, prefixSamples, refineLocal, sampleParts, type IcpOptions, type IcpResult, type IcpTarget } from './icp';
import { alignSettings, finishResult, icpFlags, isSymmetric, measureFit, pointPca, surfacePca, type Pca, type QualityThresholds } from './metrics';

export { DEFAULT_QUALITY, type QualityThresholds } from './metrics';

export type AlignStage = 'prepare' | 'coarse' | 'fine' | 'metrics';

export interface AlignOptions extends IcpOptions {
  seed?: number; // 1
  sourceSamples?: number; // 2500
  toleranceMm?: number; // 0.1, the coverage tolerance
  quality?: Partial<QualityThresholds>;
  onProgress?: (stage: AlignStage, fraction: number) => void;
}

/** Two poses are distinct when they differ by more than this at the source centroid (finalists, ambiguity). */
const DISTINCT_POSE = { angleRad: (5 * Math.PI) / 180, distanceMm: 0.25 };

/** Coarse ICP: every start runs `screenIterations`, the best `kept` continue for `iterations` more. */
const COARSE = { samples: 300, screenIterations: 4, kept: 12, iterations: 8, minNormalDot: 0.2, diagonalFraction: 0.3 };
const MAX_FINALISTS = 5;
/** Only coarse fits scoring within ratio × best + slack are refined (a rival must end within the ambiguity bound anyway). */
const FINALIST_SCORE = { ratio: 3, slackMm: 0.05 };
/** Translation vote: source/target samples used, normal agreement, cell size (mm), cells inspected. */
const VOTE = { sourcePoints: 150, targetPoints: 3000, minNormalDot: 0.9, minCellMm: 1.5, cellFraction: 0.05, topCells: 8 };
const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;
const KEY_OFFSET = 2 ** 16, KEY_SPAN = 2 ** 17; // 3 × 17 bits < 2^53: exact integer keys

interface Finalist {
  fit: IcpResult;
  score: number;
}

function distinct(a: Mat4, b: Mat4, centre: Vec3): boolean {
  return rotationAngleBetween(a, b) > DISTINCT_POSE.angleRad || distance(transformPoint(a, centre), transformPoint(b, centre)) > DISTINCT_POSE.distanceMm;
}

/** Rotation `r` about the source centroid `cs`, moving it onto `at`. */
function placed(r: Mat4, cs: Vec3, at: Readonly<Vec3>): Mat4 {
  const m = Float64Array.from(r);
  const rc = transformDirection(r, cs);
  m[3] = at[0] - rc[0];
  m[7] = at[1] - rc[1];
  m[11] = at[2] - rc[2];
  return m;
}

/** The 24 proper rotations taking source PCA axis k onto ± target axis perm[k]. */
function pcaRotations(s: Pca['axes'], t: Pca['axes']): Mat4[] {
  const out: Mat4[] = [];
  for (const perm of PERMUTATIONS) {
    for (let signs = 0; signs < 8; signs++) {
      const m = identity();
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          let v = 0;
          for (let k = 0; k < 3; k++) v += (signs & (1 << k) ? -1 : 1) * t[perm[k]!]![r]! * s[k]![c]!;
          m[r * 4 + c] = v;
        }
      }
      const det = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) + m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!);
      if (det > 0) out.push(m);
    }
  }
  return out;
}

function diagonal(points: Float64Array): number {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    x0 = Math.min(x0, points[i]!);
    x1 = Math.max(x1, points[i]!);
    y0 = Math.min(y0, points[i + 1]!);
    y1 = Math.max(y1, points[i + 1]!);
    z0 = Math.min(z0, points[i + 2]!);
    z1 = Math.max(z1, points[i + 2]!);
  }
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

const keyOf = (ix: number, iy: number, iz: number): number => ((ix + KEY_OFFSET) * KEY_SPAN + (iy + KEY_OFFSET)) * KEY_SPAN + (iz + KEY_OFFSET);

/**
 * Translation of the centred, rotated source (rp, rn) that most target samples agree with: every pair
 * with parallel normals votes for q - p in a grid of `cell` mm; the densest 3×3×3 block wins.
 * ponytail: O(sourcePoints × targetPoints) per rotation (≈ 0.5 M dot products); a feature index if starts grow.
 */
function voteTranslation(rp: Float64Array, rn: Float64Array, target: IcpTarget, cell: number): Vec3 | null {
  const counts = new Map<number, number>();
  const tp = target.points, tn = target.normals;
  const nt = Math.min(VOTE.targetPoints, tp.length / 3), ns = rp.length / 3;
  const limit = VOTE.minNormalDot;
  for (let j = 0; j < nt; j++) {
    const qx = tp[3 * j]!, qy = tp[3 * j + 1]!, qz = tp[3 * j + 2]!;
    const mx = tn[3 * j]!, my = tn[3 * j + 1]!, mz = tn[3 * j + 2]!;
    for (let i = 0; i < ns; i++) {
      const dot = rn[3 * i]! * mx + rn[3 * i + 1]! * my + rn[3 * i + 2]! * mz;
      if (dot < limit && dot > -limit) continue;
      const ix = Math.floor((qx - rp[3 * i]!) / cell), iy = Math.floor((qy - rp[3 * i + 1]!) / cell), iz = Math.floor((qz - rp[3 * i + 2]!) / cell);
      if (Math.abs(ix) >= KEY_OFFSET - 1 || Math.abs(iy) >= KEY_OFFSET - 1 || Math.abs(iz) >= KEY_OFFSET - 1) continue;
      const key = keyOf(ix, iy, iz);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top: Array<[number, number]> = []; // [count, key], descending
  for (const [key, count] of counts) {
    if (top.length === VOTE.topCells && count <= top[top.length - 1]![0]) continue;
    let at = top.findIndex(([c]) => count > c);
    if (at < 0) at = top.length;
    top.splice(at, 0, [count, key]);
    if (top.length > VOTE.topCells) top.pop();
  }
  let best: Vec3 | null = null, bestSum = 0;
  for (const [, key] of top) {
    const iz = (key % KEY_SPAN) - KEY_OFFSET;
    const rest = Math.floor(key / KEY_SPAN);
    const iy = (rest % KEY_SPAN) - KEY_OFFSET;
    const ix = Math.floor(rest / KEY_SPAN) - KEY_OFFSET;
    let sum = 0, sx = 0, sy = 0, sz = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const c = counts.get(keyOf(ix + dx, iy + dy, iz + dz)) ?? 0;
          sum += c;
          sx += c * (ix + dx + 0.5);
          sy += c * (iy + dy + 0.5);
          sz += c * (iz + dz + 0.5);
        }
      }
    }
    if (sum > bestSum) {
      bestSum = sum;
      best = [(sx / sum) * cell, (sy / sum) * cell, (sz / sum) * cell];
    }
  }
  return best;
}

function globalStarts(samples: SurfaceSamples, source: Pca, target: IcpTarget, cancel?: () => boolean): Mat4[] {
  const cs = source.centroid;
  const jaw = pointPca(target.points);
  const rotations = [identity(), ...pcaRotations(source.axes, jaw.axes)];
  const nv = Math.min(VOTE.sourcePoints, samples.triangles.length);
  const cell = Math.max(VOTE.minCellMm, VOTE.cellFraction * diagonal(samples.points));
  const rp = new Float64Array(3 * nv), rn = new Float64Array(3 * nv);
  const starts: Mat4[] = [identity()];
  for (const r of rotations) {
    if (cancel?.()) throw new XchangeError('CANCELLED');
    starts.push(placed(r, cs, jaw.centroid));
    for (let i = 0; i < nv; i++) {
      const p = transformDirection(r, [samples.points[3 * i]! - cs[0], samples.points[3 * i + 1]! - cs[1], samples.points[3 * i + 2]! - cs[2]]);
      const n = transformDirection(r, [samples.normals[3 * i]!, samples.normals[3 * i + 1]!, samples.normals[3 * i + 2]!]);
      rp.set(p, 3 * i);
      rn.set(n, 3 * i);
    }
    const t = voteTranslation(rp, rn, target, cell);
    if (t) starts.push(placed(r, cs, t));
  }
  return starts;
}

/**
 * Global search (capture pose, centroid and voted translations for the identity and 24 PCA axis
 * matchings) -> coarse ICP -> up to 5 distinct finalists -> fine ICP -> robust polish -> metrics +
 * status. With `initial`, refine locally first and search globally only if that fit is not good.
 */
export function multiStartAlign(parts: readonly AssemblyPart[], target: IcpTarget, options: AlignOptions & { initial?: Mat4 } = {}): AlignmentResult {
  const settings = alignSettings(options);
  checkParts(parts);
  const { quality, icp: fine } = settings;
  const progress = options.onProgress;
  const cap = fine.maxCorrespondenceMm;
  progress?.('prepare', 0);
  const samples = sampleParts(parts, settings.sourceSamples, settings.seed);
  const count = samples.triangles.length;
  const pca = surfacePca(parts.map((p) => p.mesh));
  const symmetric = isSymmetric(pca.variances, quality.symmetryTolerance);
  const finalists: Finalist[] = [];

  if (options.initial) {
    const local = refineLocal(samples, target, validateRigid(options.initial), fine);
    progress?.('fine', 1);
    if (local.pairs >= MIN_PAIRS) {
      const polished = polish(samples, target, local, fine, settings.toleranceMm);
      const { transform } = polished.fit;
      const metrics = measureFit(parts, target, transform, { toleranceMm: settings.toleranceMm, seed: settings.seed });
      if (metrics.rmsMm <= quality.goodRmsMm && metrics.coverage >= quality.goodCoverage) {
        const flags: AlignmentFlag[] = [...(symmetric ? (['symmetricSource'] as const) : []), ...icpFlags(polished.fit, count, fine.trimFraction)];
        progress?.('metrics', 1);
        return finishResult(parts, target, transform, 'auto', flags, settings, metrics);
      }
      finalists.push(polished);
    }
  }

  const starts = globalStarts(samples, pca, target, fine.shouldCancel);
  progress?.('prepare', 1);
  const coarseSamples = prefixSamples(samples, COARSE.samples);
  const coarseOptions: IcpOptions = {
    ...fine,
    maxCorrespondenceMm: Math.min(100, Math.max(2 * cap, COARSE.diagonalFraction * diagonal(samples.points))),
    minNormalDot: Math.min(fine.minNormalDot, COARSE.minNormalDot),
    onIteration: undefined,
  };
  const steps = starts.length + COARSE.kept;
  const run = (from: Mat4, maxIterations: number, step: number): { transform: Mat4; score: number } | null => {
    const r = icp(coarseSamples, target, from, { ...coarseOptions, maxIterations });
    progress?.('coarse', step / steps);
    return r.pairs >= MIN_PAIRS ? { transform: r.transform, score: cappedRms(coarseSamples, target.surface, r.transform, cap) } : null;
  };
  const byScore = (a: { score: number }, b: { score: number }): number => a.score - b.score;
  const screened = starts.flatMap((start, i) => run(start, COARSE.screenIterations, i + 1) ?? []).sort(byScore);
  const coarse = screened.slice(0, COARSE.kept).flatMap((c, i) => run(c.transform, COARSE.iterations, starts.length + i + 1) ?? []).sort(byScore);
  const worthRefining = FINALIST_SCORE.ratio * (coarse[0]?.score ?? 0) + FINALIST_SCORE.slackMm;
  const picked: Mat4[] = [];
  for (const c of coarse) {
    if (picked.length >= MAX_FINALISTS || c.score > worthRefining) break;
    if (picked.every((p) => distinct(p, c.transform, pca.centroid))) picked.push(c.transform);
  }

  picked.forEach((start, i) => {
    const r = icp(samples, target, start, {
      ...fine,
      onIteration: (iteration, rms) => {
        fine.onIteration?.(iteration, rms);
        progress?.('fine', (i + iteration / fine.maxIterations) / picked.length);
      },
    });
    if (r.pairs >= MIN_PAIRS) finalists.push({ fit: r, score: poseScore(samples, target.surface, r.transform, settings.toleranceMm) });
  });
  finalists.sort((a, b) => a.score - b.score);
  const first = finalists[0];
  if (!first) throw new XchangeError('ALIGNMENT_FAILED', { reason: 'noPairs' });
  const best = polish(samples, target, first.fit, fine, settings.toleranceMm);
  progress?.('fine', 1);

  const flags: AlignmentFlag[] = symmetric ? ['symmetricSource'] : [];
  const at = best.fit.transform;
  const rivalScore = Math.max(quality.ambiguityRatio * best.score, best.score + quality.ambiguitySlackMm);
  const rival = finalists.some((f) => f !== first && f.score <= rivalScore && distinct(f.fit.transform, at, pca.centroid));
  if (rival) flags.push('ambiguousAlternative');
  flags.push(...icpFlags(best.fit, count, fine.trimFraction));
  progress?.('metrics', 0);
  const result = finishResult(parts, target, at, 'auto', flags, settings);
  progress?.('metrics', 1);
  return result;
}
