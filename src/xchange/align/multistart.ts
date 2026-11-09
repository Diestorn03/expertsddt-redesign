/**
 * Automatic capture -> jaw alignment: global multi-start search, coarse ICP, finalists, fine ICP and
 * untrimmed polish of each, exact metrics and status. The jaw never moves.
 *
 * Starts: the capture pose as is; poses seeded from the scan bodies seen in the jaw (seeds.ts); then for
 * the identity and the 24 proper PCA axis matchings both the centroid match and a translation voted by
 * normal-compatible point pairs (a Hough vote: it finds the scan bodies inside a much larger jaw even when
 * the centroids do not correspond, e.g. 1-2 implants). An implant set rarely shares the jaw's in-plane
 * axes (15-35° apart on real cases), so unless a seed already puts the sites on scanned bodies, the 8
 * matchings that put the parts' normal axis on the jaw's also turn by 15°-75° about it (voted
 * translation). Sizes come from the parts' box in their PCA frame: the search does not depend on how the
 * capture arrives.
 *
 * Finalists: the best CLOSE_FINALISTS coarse fits even when they are close to each other (a near pose can
 * hide the better optimum), then distinct ones. Each gets the fine ICP and the untrimmed polish of icp.ts
 * (the 80 % trim can hold a biased fixed point); poseScore picks the best. Another finalist ending
 * farther than the tolerance from it and scoring within the ambiguity bound flags 'ambiguousAlternative'.
 *
 * Errors: everything from icp.ts / metrics.ts, MATRIX_INVALID / MATRIX_NOT_RIGID (initial),
 * ALIGNMENT_FAILED (reason 'noPairs': no start ever found 6 correspondences), CANCELLED.
 */
import { XchangeError } from '../core/errors';
import { fromAxisAngle, identity, multiply, rotationAngleBetween, transformDirection, transformPoint, validateRigid } from '../core/mat4';
import type { SurfaceSamples } from '../core/sampling';
import type { AlignmentFlag, AlignmentResult, AssemblyPart, Mat4, Vec3 } from '../core/types';
import { distance, dot } from '../core/vec3';
import { cappedRms, checkParts, icp, MIN_PAIRS, polish, poseScore, prefixSamples, refineLocal, sampleParts, type IcpOptions, type IcpResult, type IcpTarget } from './icp';
import { alignSettings, finishResult, icpFlags, isSymmetric, measureFit, pointPca, statusOf, surfacePca, type Pca, type QualityThresholds } from './metrics';
import { seededStarts } from './seeds';

export { DEFAULT_QUALITY, type QualityThresholds } from './metrics';

export type AlignStage = 'prepare' | 'coarse' | 'fine' | 'metrics';

export interface AlignOptions extends IcpOptions {
  seed?: number; // 1
  sourceSamples?: number; // 2500
  toleranceMm?: number; // 0.1, the coverage tolerance
  quality?: Partial<QualityThresholds>;
  onProgress?: (stage: AlignStage, fraction: number) => void;
}

/** Two poses are distinct when they differ by more than this at the source centroid (finalists). */
const DISTINCT_POSE = { angleRad: (5 * Math.PI) / 180, distanceMm: 0.25 };

/** Coarse ICP: every start runs `screenIterations`, the best `kept` continue for `iterations` more. */
const COARSE = { samples: 300, screenIterations: 4, kept: 12, iterations: 8, minNormalDot: 0.2, diagonalFraction: 0.3 };
const MAX_FINALISTS = 5;
/** The first finalists may be close to each other (not distinct), as long as no sample of one is within the tolerance of the other. */
const CLOSE_FINALISTS = 3;
/** Only coarse fits scoring within ratio × best + slack are refined (a rival must end within the ambiguity bound anyway). */
const FINALIST_SCORE = { ratio: 3, slackMm: 0.05 };
/** Translation vote: source/target samples used, normal agreement, cell size (mm), cells inspected, grid cap (8 MB). */
const VOTE = { sourcePoints: 150, targetPoints: 3000, minNormalDot: 0.9, minCellMm: 1.5, cellFraction: 0.05, topCells: 8, maxCells: 2_000_000 };
/**
 * Turns about the jaw's normal axis added to each PCA matching that puts the parts' normal axis on it (the
 * quarter turns are matchings), unless a seed puts at least max(seededSites, parts - 1) sites on scanned bodies.
 */
const SWEEP = { stepRad: (15 * Math.PI) / 180, steps: 5, seededSites: 3 };
const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;

interface Finalist {
  fit: IcpResult;
  score: number;
}

function distinct(a: Mat4, b: Mat4, centre: Vec3): boolean {
  return rotationAngleBetween(a, b) > DISTINCT_POSE.angleRad || distance(transformPoint(a, centre), transformPoint(b, centre)) > DISTINCT_POSE.distanceMm;
}

/** Largest displacement of any sample between two poses (mm). */
function farthest(a: Mat4, b: Mat4, points: Float64Array): number {
  let max = 0;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const p: Vec3 = [points[i]!, points[i + 1]!, points[i + 2]!];
    max = Math.max(max, distance(transformPoint(a, p), transformPoint(b, p)));
  }
  return max;
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

/** Diagonal of the points' box in the frame of `axes` (the parts' PCA: the same however the capture is turned). */
function diagonal(points: Float64Array, axes: Pca['axes']): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = dot([points[i]!, points[i + 1]!, points[i + 2]!], axes[k]!);
      lo[k] = Math.min(lo[k]!, v);
      hi[k] = Math.max(hi[k]!, v);
    }
  }
  return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/** Counts of the translation vote: cells of `cell` mm over every move of the centred source (radius `reach`) into the target box. */
interface VoteGrid {
  cell: number;
  origin: Vec3;
  dims: [number, number, number];
  counts: Int32Array;
}

function voteGrid(target: IcpTarget, targetPoints: number, reach: number, cell: number): VoteGrid {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < targetPoints; j++) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, target.points[3 * j + k]!);
      hi[k] = Math.max(hi[k]!, target.points[3 * j + k]!);
    }
  }
  const span = [0, 1, 2].map((k) => hi[k]! - lo[k]! + 2 * reach);
  const cellsAt = (size: number): number => span.reduce((n, x) => n * (Math.floor(x / size) + 2), 1);
  // A jaw far larger than a mouth (other units, a whole skull): coarser cells instead of a huge grid.
  const size = cellsAt(cell) > VOTE.maxCells ? cell * Math.cbrt(cellsAt(cell) / VOTE.maxCells) : cell;
  const dims = span.map((x) => Math.floor(x / size) + 2) as [number, number, number];
  return { cell: size, origin: [lo[0] - reach, lo[1] - reach, lo[2] - reach], dims, counts: new Int32Array(dims[0] * dims[1] * dims[2]) };
}

/**
 * Translation of the centred, rotated source (rp, rn) that most target samples agree with: every pair
 * with parallel normals votes for q - p in the grid; the densest 3×3×3 block of the fullest cells wins.
 * ponytail: O(sourcePoints × targetPoints) per rotation (≈ 0.5 M dot products); a feature index if starts grow.
 */
function voteTranslation(rp: Float64Array, rn: Float64Array, target: IcpTarget, targetPoints: number, grid: VoteGrid): Vec3 | null {
  const { cell, counts } = grid;
  const [ox, oy, oz] = grid.origin, [, ny, nz] = grid.dims;
  const tp = target.points, tn = target.normals;
  const ns = rp.length / 3, limit = VOTE.minNormalDot;
  counts.fill(0);
  for (let j = 0; j < targetPoints; j++) {
    const qx = tp[3 * j]! - ox, qy = tp[3 * j + 1]! - oy, qz = tp[3 * j + 2]! - oz;
    const mx = tn[3 * j]!, my = tn[3 * j + 1]!, mz = tn[3 * j + 2]!;
    for (let i = 0; i < ns; i++) {
      const dot = rn[3 * i]! * mx + rn[3 * i + 1]! * my + rn[3 * i + 2]! * mz;
      if (dot < limit && dot > -limit) continue;
      const ix = Math.floor((qx - rp[3 * i]!) / cell), iy = Math.floor((qy - rp[3 * i + 1]!) / cell), iz = Math.floor((qz - rp[3 * i + 2]!) / cell);
      counts[(ix * ny + iy) * nz + iz]!++;
    }
  }
  const top: Array<[number, number]> = []; // [count, cell index], descending
  for (let c = 0; c < counts.length; c++) {
    const count = counts[c]!;
    if (count === 0 || (top.length === VOTE.topCells && count <= top[top.length - 1]![0])) continue;
    let at = top.findIndex(([n]) => count > n);
    if (at < 0) at = top.length;
    top.splice(at, 0, [count, c]);
    if (top.length > VOTE.topCells) top.pop();
  }
  let best: Vec3 | null = null, bestSum = 0;
  for (const [, c] of top) {
    const ix = Math.floor(c / (ny * nz)), iy = Math.floor(c / nz) % ny, iz = c % nz;
    let sum = 0, sx = 0, sy = 0, sz = 0;
    for (let x = Math.max(0, ix - 1); x <= Math.min(grid.dims[0] - 1, ix + 1); x++) {
      for (let y = Math.max(0, iy - 1); y <= Math.min(ny - 1, iy + 1); y++) {
        for (let z = Math.max(0, iz - 1); z <= Math.min(nz - 1, iz + 1); z++) {
          const n = counts[(x * ny + y) * nz + z]!;
          sum += n;
          sx += n * (x + 0.5);
          sy += n * (y + 0.5);
          sz += n * (z + 0.5);
        }
      }
    }
    if (sum > bestSum) {
      bestSum = sum;
      best = [ox + (sx / sum) * cell, oy + (sy / sum) * cell, oz + (sz / sum) * cell];
    }
  }
  return best;
}

function globalStarts(parts: readonly AssemblyPart[], samples: SurfaceSamples, source: Pca, target: IcpTarget, seed: number, cancel?: () => boolean): Mat4[] {
  const cs = source.centroid;
  const jaw = pointPca(target.points);
  const normal = jaw.axes[2];
  const matchings = pcaRotations(source.axes, jaw.axes);
  const seeds = seededStarts(parts, target, seed);
  // Seeds that put (nearly) every site on a scanned body already cover the in-plane turn; else sweep it.
  const seeded = seeds.some((s) => s.matched >= Math.max(SWEEP.seededSites, parts.length - 1));
  const turns = seeded
    ? []
    : matchings
        .filter((r) => Math.abs(dot(transformDirection(r, source.axes[2]), normal)) > 0.5)
        .flatMap((r) => Array.from({ length: SWEEP.steps }, (_, k) => multiply(fromAxisAngle(normal, (k + 1) * SWEEP.stepRad), r)));
  const nv = Math.min(VOTE.sourcePoints, samples.triangles.length), nt = Math.min(VOTE.targetPoints, target.points.length / 3);
  let reach = 0;
  for (let i = 0; i < nv; i++) reach = Math.max(reach, distance([samples.points[3 * i]!, samples.points[3 * i + 1]!, samples.points[3 * i + 2]!], cs));
  const grid = voteGrid(target, nt, reach, Math.max(VOTE.minCellMm, VOTE.cellFraction * diagonal(samples.points, source.axes)));
  const rp = new Float64Array(3 * nv), rn = new Float64Array(3 * nv);
  const starts: Mat4[] = [identity(), ...seeds.map((s) => s.transform)];
  const rotations = [identity(), ...matchings];
  for (const r of [...rotations, ...turns]) {
    if (cancel?.()) throw new XchangeError('CANCELLED');
    // The turns only get the voted translation: an implant set's centroid is seldom the jaw's.
    if (rotations.includes(r)) starts.push(placed(r, cs, jaw.centroid));
    for (let i = 0; i < nv; i++) {
      const p = transformDirection(r, [samples.points[3 * i]! - cs[0], samples.points[3 * i + 1]! - cs[1], samples.points[3 * i + 2]! - cs[2]]);
      const n = transformDirection(r, [samples.normals[3 * i]!, samples.normals[3 * i + 1]!, samples.normals[3 * i + 2]!]);
      rp.set(p, 3 * i);
      rn.set(n, 3 * i);
    }
    const t = voteTranslation(rp, rn, target, nt, grid);
    if (t) starts.push(placed(r, cs, t));
  }
  return starts;
}

/**
 * Global search (capture pose, scan-body seeds, centroid and voted translations for the identity, the 24
 * PCA axis matchings and, without seeds, their turns about the jaw's normal) -> coarse ICP -> finalists ->
 * fine ICP + untrimmed polish -> metrics + status. With `initial`, refine locally first and search globally
 * only if that fit is not good.
 */
export function multiStartAlign(parts: readonly AssemblyPart[], target: IcpTarget, options: AlignOptions & { initial?: Mat4 } = {}): AlignmentResult {
  const settings = alignSettings(options);
  checkParts(parts);
  const { quality, icp: fine, toleranceMm } = settings;
  const progress = options.onProgress;
  const cap = fine.maxCorrespondenceMm;
  progress?.('prepare', 0);
  const samples = sampleParts(parts, settings.sourceSamples, settings.seed);
  const count = samples.triangles.length;
  const pca = surfacePca(parts.map((p) => p.mesh));
  const symmetric = isSymmetric(pca.variances, quality.symmetryTolerance);
  const finalists: Finalist[] = [];
  /** A fine fit polished (untrimmed, kept when poseScore improves), or null without enough pairs. */
  const refine = (fit: IcpResult): Finalist | null => (fit.pairs >= MIN_PAIRS ? polish(samples, target, fit, fine, toleranceMm) : null);

  if (options.initial) {
    const local = refine(refineLocal(samples, target, validateRigid(options.initial), fine));
    progress?.('fine', 1);
    if (local) {
      const { transform } = local.fit;
      const metrics = measureFit(parts, target, transform, { toleranceMm, seed: settings.seed });
      if (statusOf(metrics, [], quality) === 'good') {
        const flags: AlignmentFlag[] = [...(symmetric ? (['symmetricSource'] as const) : []), ...icpFlags(local.fit, count, fine.trimFraction)];
        progress?.('metrics', 1);
        return finishResult(parts, target, transform, 'auto', flags, settings, metrics);
      }
      finalists.push(local);
    }
  }

  const starts = globalStarts(parts, samples, pca, target, settings.seed, fine.shouldCancel);
  progress?.('prepare', 1);
  const coarseSamples = prefixSamples(samples, COARSE.samples);
  const coarseOptions: IcpOptions = {
    ...fine,
    maxCorrespondenceMm: Math.min(100, Math.max(2 * cap, COARSE.diagonalFraction * diagonal(samples.points, pca.axes))),
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
    const apart = picked.every((p) => farthest(p, c.transform, coarseSamples.points) > toleranceMm);
    if (apart && (picked.length < CLOSE_FINALISTS || picked.every((p) => distinct(p, c.transform, pca.centroid)))) picked.push(c.transform);
  }

  picked.forEach((start, i) => {
    const r = refine(
      icp(samples, target, start, {
        ...fine,
        onIteration: (iteration, rms) => {
          fine.onIteration?.(iteration, rms);
          progress?.('fine', (i + iteration / fine.maxIterations) / picked.length);
        },
      }),
    );
    if (r) finalists.push(r);
  });
  finalists.sort(byScore);
  const best = finalists[0];
  if (!best) throw new XchangeError('ALIGNMENT_FAILED', { reason: 'noPairs' });
  progress?.('fine', 1);

  const flags: AlignmentFlag[] = symmetric ? ['symmetricSource'] : [];
  const at = best.fit.transform;
  const rivalScore = Math.max(quality.ambiguityRatio * best.score, best.score + quality.ambiguitySlackMm);
  const rival = finalists.some((f) => f !== best && f.score <= rivalScore && farthest(f.fit.transform, at, samples.points) > toleranceMm);
  if (rival) flags.push('ambiguousAlternative');
  flags.push(...icpFlags(best.fit, count, fine.trimFraction));
  progress?.('metrics', 0);
  const result = finishResult(parts, target, at, 'auto', flags, settings);
  progress?.('metrics', 1);
  return result;
}
