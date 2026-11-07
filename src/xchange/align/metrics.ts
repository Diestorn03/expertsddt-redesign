/**
 * Fit metrics on the exact jaw surface, quality status and the shared option handling of align/.
 *
 * Errors: INVALID_ARGUMENT (details.reason 'toleranceMm' | 'samplesPerSite' | 'seed' | 'sourceSamples' |
 * 'quality', plus the checks of icp.ts), MATRIX_INVALID / MATRIX_NOT_RIGID (transform), CANCELLED.
 */
import { XchangeError } from '../core/errors';
import { eigenSymmetric } from '../core/linalg';
import { validateRigid } from '../core/mat4';
import { sampleSurface } from '../core/sampling';
import type { AlignmentFlag, AlignmentMethod, AlignmentResult, AlignmentStatus, AssemblyPart, Mat4, SiteFit, TriMesh, Vec3 } from '../core/types';
import { cross } from '../core/vec3';
import { checkParts, icpSettings, option as checked, type IcpResult, type IcpTarget } from './icp';
import { closestOnSurface } from './kdtree';
import type { AlignOptions } from './multistart';

/**
 * Status thresholds. Heuristics pending clinical validation by Fernando (spec P5): change them here
 * (or per call through AlignOptions.quality), nowhere else.
 */
export interface QualityThresholds {
  goodRmsMm: number;
  goodCoverage: number;
  acceptableRmsMm: number;
  acceptableCoverage: number;
  /** A distinct pose (> 5° or > 0.25 mm at the source centroid) scoring within this ratio of the best -> 'ambiguous'. */
  ambiguityRatio: number;
  /** ... or within the best score plus this (mm): near-zero residuals make any ratio too tight (as the prototype, 0.05·tol). */
  ambiguitySlackMm: number;
  /** Below this coverage nothing usable was found -> 'failed' (addition to the contract). */
  usableCoverage: number;
  /** Two adjacent source PCA variances closer than this fraction -> 'symmetricSource' (addition to the contract). */
  symmetryTolerance: number;
}

export const DEFAULT_QUALITY: QualityThresholds = Object.freeze({
  goodRmsMm: 0.05,
  goodCoverage: 0.95,
  acceptableRmsMm: 0.1,
  acceptableCoverage: 0.8,
  ambiguityRatio: 1.1,
  ambiguitySlackMm: 0.005,
  usableCoverage: 0.4,
  symmetryTolerance: 0.01,
});

export const DEFAULT_TOLERANCE_MM = 0.1;
const DEFAULT_SAMPLES_PER_SITE = 400;
/** The final ICP kept pairs for less than this fraction of the samples it could keep -> 'fewCorrespondences'. */
const FEW_PAIRS_FRACTION = 0.5;

export interface FitMetrics {
  rmsMm: number;
  p95Mm: number;
  coverage: number;
  perSite: SiteFit[];
}

export interface AlignSettings {
  seed: number;
  sourceSamples: number;
  toleranceMm: number;
  quality: QualityThresholds;
  icp: ReturnType<typeof icpSettings>;
}

const isTolerance = (v: number): boolean => v > 0 && v <= 10;
const isSeed = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

export function resolveQuality(partial: Partial<QualityThresholds> = {}): QualityThresholds {
  const q = { ...DEFAULT_QUALITY, ...partial };
  const fraction = (v: number): boolean => v >= 0 && v <= 1;
  const ok =
    q.goodRmsMm > 0 && q.acceptableRmsMm > 0 && Number.isFinite(q.goodRmsMm) && Number.isFinite(q.acceptableRmsMm) &&
    fraction(q.goodCoverage) && fraction(q.acceptableCoverage) && fraction(q.usableCoverage) &&
    q.ambiguityRatio >= 1 && Number.isFinite(q.ambiguityRatio) && q.ambiguitySlackMm >= 0 && Number.isFinite(q.ambiguitySlackMm) &&
    q.symmetryTolerance >= 0 && q.symmetryTolerance < 1;
  if (!ok) throw new XchangeError('INVALID_ARGUMENT', { reason: 'quality' });
  return q;
}

export function alignSettings(options: AlignOptions = {}): AlignSettings {
  return {
    seed: checked(options.seed, 1, 'seed', isSeed),
    sourceSamples: checked(options.sourceSamples, 2500, 'sourceSamples', (v) => Number.isInteger(v) && v >= 30 && v <= 20_000),
    toleranceMm: checked(options.toleranceMm, DEFAULT_TOLERANCE_MM, 'toleranceMm', isTolerance),
    quality: resolveQuality(options.quality),
    icp: icpSettings(options),
  };
}

export interface Pca {
  centroid: Vec3;
  /** Unit axes by descending variance, right-handed. */
  axes: [Vec3, Vec3, Vec3];
  variances: Vec3;
}

/** m = [weight, Σx, Σy, Σz, Σxx, Σxy, Σxz, Σyy, Σyz, Σzz] relative to `origin`. */
function pcaFromMoments(m: Float64Array, origin: Vec3): Pca {
  const w = m[0]!;
  if (!(w > 0)) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'zeroArea' });
  const mx = m[1]! / w, my = m[2]! / w, mz = m[3]! / w;
  const xx = m[4]! / w - mx * mx, xy = m[5]! / w - mx * my, xz = m[6]! / w - mx * mz;
  const yy = m[7]! / w - my * my, yz = m[8]! / w - my * mz, zz = m[9]! / w - mz * mz;
  const { values, vectors: v } = eigenSymmetric([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
  const a0: Vec3 = [v[0]!, v[3]!, v[6]!];
  const a1: Vec3 = [v[1]!, v[4]!, v[7]!];
  return {
    centroid: [origin[0] + mx, origin[1] + my, origin[2] + mz],
    axes: [a0, a1, cross(a0, a1)],
    variances: [Math.max(0, values[0]!), Math.max(0, values[1]!), Math.max(0, values[2]!)],
  };
}

/** Exact area-weighted PCA of the surfaces (second moments of every triangle, not of samples). */
export function surfacePca(meshes: readonly TriMesh[]): Pca {
  const first = meshes[0]?.positions;
  const origin: Vec3 = first && first.length >= 3 ? [first[0]!, first[1]!, first[2]!] : [0, 0, 0];
  const m = new Float64Array(10);
  for (const mesh of meshes) {
    const p = mesh.positions, idx = mesh.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
      const ax = p[a]! - origin[0], ay = p[a + 1]! - origin[1], az = p[a + 2]! - origin[2];
      const bx = p[b]! - origin[0], by = p[b + 1]! - origin[1], bz = p[b + 2]! - origin[2];
      const cx = p[c]! - origin[0], cy = p[c + 1]! - origin[1], cz = p[c + 2]! - origin[2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (!(area > 0)) continue;
      const sx = ax + bx + cx, sy = ay + by + cy, sz = az + bz + cz;
      const k = area / 12; // ∫ p pᵀ dA = A/12 · (a aᵀ + b bᵀ + c cᵀ + s sᵀ), s = a + b + c
      m[0] = m[0]! + area;
      m[1] = m[1]! + (area * sx) / 3;
      m[2] = m[2]! + (area * sy) / 3;
      m[3] = m[3]! + (area * sz) / 3;
      m[4] = m[4]! + k * (ax * ax + bx * bx + cx * cx + sx * sx);
      m[5] = m[5]! + k * (ax * ay + bx * by + cx * cy + sx * sy);
      m[6] = m[6]! + k * (ax * az + bx * bz + cx * cz + sx * sz);
      m[7] = m[7]! + k * (ay * ay + by * by + cy * cy + sy * sy);
      m[8] = m[8]! + k * (ay * az + by * bz + cy * cz + sy * sz);
      m[9] = m[9]! + k * (az * az + bz * bz + cz * cz + sz * sz);
    }
  }
  return pcaFromMoments(m, origin);
}

/** PCA of equally weighted points (xyz flat). */
export function pointPca(points: ArrayLike<number>): Pca {
  const origin: Vec3 = points.length >= 3 ? [points[0]!, points[1]!, points[2]!] : [0, 0, 0];
  const m = new Float64Array(10);
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i]! - origin[0], y = points[i + 1]! - origin[1], z = points[i + 2]! - origin[2];
    m[0] = m[0]! + 1;
    m[1] = m[1]! + x;
    m[2] = m[2]! + y;
    m[3] = m[3]! + z;
    m[4] = m[4]! + x * x;
    m[5] = m[5]! + x * y;
    m[6] = m[6]! + x * z;
    m[7] = m[7]! + y * y;
    m[8] = m[8]! + y * z;
    m[9] = m[9]! + z * z;
  }
  return pcaFromMoments(m, origin);
}

/** Two adjacent variances within `tolerance`: the surface may turn about an axis without changing (e.g. one round body). */
export function isSymmetric(variances: Vec3, tolerance: number): boolean {
  const [a, b, c] = variances;
  return a - b <= tolerance * a || b - c <= tolerance * b;
}

export function sourceFlags(parts: readonly AssemblyPart[], quality: QualityThresholds): AlignmentFlag[] {
  return isSymmetric(surfacePca(parts.map((p) => p.mesh)).variances, quality.symmetryTolerance) ? ['symmetricSource'] : [];
}

export function icpFlags(result: IcpResult, samples: number, trimFraction: number): AlignmentFlag[] {
  const flags: AlignmentFlag[] = [];
  if (!result.converged) flags.push('notConverged');
  if (result.pairs < FEW_PAIRS_FRACTION * trimFraction * samples) flags.push('fewCorrespondences');
  return flags;
}

/** Point-to-surface distances of every part's samples (no trimming), exact on the jaw triangles. */
export function measureFit(
  parts: readonly AssemblyPart[],
  target: IcpTarget,
  transform: Mat4,
  options: { toleranceMm?: number; samplesPerSite?: number; seed?: number } = {},
): FitMetrics {
  checkParts(parts);
  const t = validateRigid(transform);
  const tolerance = checked(options.toleranceMm, DEFAULT_TOLERANCE_MM, 'toleranceMm', isTolerance);
  const per = checked(options.samplesPerSite, DEFAULT_SAMPLES_PER_SITE, 'samplesPerSite', (v) => Number.isInteger(v) && v >= 1 && v <= 20_000);
  const seed = checked(options.seed, 1, 'seed', isSeed);
  const m0 = t[0]!, m1 = t[1]!, m2 = t[2]!, m3 = t[3]!, m4 = t[4]!, m5 = t[5]!;
  const m6 = t[6]!, m7 = t[7]!, m8 = t[8]!, m9 = t[9]!, m10 = t[10]!, m11 = t[11]!;
  const all = new Float64Array(per * parts.length);
  let sum2 = 0, within = 0;
  const perSite = parts.map((part, k): SiteFit => {
    const p = sampleSurface(part.mesh, per, seed + k).points;
    let siteSum = 0, siteWithin = 0;
    for (let i = 0; i < per; i++) {
      const x = p[3 * i]!, y = p[3 * i + 1]!, z = p[3 * i + 2]!;
      const d = Math.sqrt(closestOnSurface(target.surface, m0 * x + m1 * y + m2 * z + m3, m4 * x + m5 * y + m6 * z + m7, m8 * x + m9 * y + m10 * z + m11));
      all[k * per + i] = d;
      siteSum += d * d;
      if (d <= tolerance) siteWithin++;
    }
    sum2 += siteSum;
    within += siteWithin;
    return { siteId: part.siteId, rmsMm: Math.sqrt(siteSum / per), coverage: siteWithin / per, samples: per };
  });
  all.sort();
  const n = all.length;
  return { rmsMm: Math.sqrt(sum2 / n), p95Mm: all[Math.max(0, Math.ceil(0.95 * n) - 1)]!, coverage: within / n, perSite };
}

export function statusOf(m: FitMetrics, flags: readonly AlignmentFlag[], q: QualityThresholds): AlignmentStatus {
  if (!(m.coverage >= q.usableCoverage)) return 'failed';
  if (flags.includes('ambiguousAlternative') || flags.includes('symmetricSource')) return 'ambiguous';
  if (m.rmsMm <= q.goodRmsMm && m.coverage >= q.goodCoverage) return 'good';
  if (m.rmsMm <= q.acceptableRmsMm && m.coverage >= q.acceptableCoverage) return 'acceptable';
  return 'weak';
}

/** Metrics + status + flags (always 'visualCheckRequired' first) for the chosen pose. */
export function finishResult(
  parts: readonly AssemblyPart[],
  target: IcpTarget,
  transform: Mat4,
  method: AlignmentMethod,
  flags: readonly AlignmentFlag[],
  settings: AlignSettings,
  metrics: FitMetrics = measureFit(parts, target, transform, { toleranceMm: settings.toleranceMm, seed: settings.seed }),
): AlignmentResult {
  const all = [...new Set<AlignmentFlag>(['visualCheckRequired', ...flags])];
  return {
    transform: Float64Array.from(transform),
    method,
    rmsMm: metrics.rmsMm,
    p95Mm: metrics.p95Mm,
    coverage: metrics.coverage,
    toleranceMm: settings.toleranceMm,
    perSite: metrics.perSite,
    status: statusOf(metrics, all, settings.quality),
    flags: all,
  };
}

/** Metrics of a pose the user placed by hand: method 'manual', flag 'manualPose'. */
export function measureManualPose(parts: readonly AssemblyPart[], target: IcpTarget, transform: Mat4, options: AlignOptions = {}): AlignmentResult {
  const settings = alignSettings(options);
  checkParts(parts);
  const t = validateRigid(transform);
  options.onProgress?.('metrics', 0);
  const result = finishResult(parts, target, t, 'manual', ['manualPose', ...sourceFlags(parts, settings.quality)], settings);
  options.onProgress?.('metrics', 1);
  return result;
}
