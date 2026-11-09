/**
 * Starts seeded from the scan bodies seen in the jaw (multistart.ts). A wall sample of a cylinder of radius
 * r, moved by r against its normal, lands on the cylinder's axis, so in a cell histogram of moved samples
 * the axes are the peaks. The parts' wall radius is the radius whose moved samples pile up the most,
 * refined to the wall's distance from each part's fitted axis; with it come each part's axis and the jaw's
 * scanned bodies of that radius. A pair of sites and a pair of scanned bodies at the same distance and axis
 * angle give a closed-form rigid fit (kabsch on the top end and the axis of each body); the fits that put
 * most sites on a scanned body, refitted on all of them, are the seeds. Winding-agnostic: samples move both
 * ways along their normals. Nothing of that radius in the jaw -> none.
 */
import { eigenSymmetric } from '../core/linalg';
import { fromAxisAngle, transformDirection, transformPoint } from '../core/mat4';
import { kabsch } from '../core/rigid';
import { sampleSurface } from '../core/sampling';
import type { AssemblyPart, Mat4, Vec3 } from '../core/types';
import { add, distance, dot, scale } from '../core/vec3';
import type { IcpTarget } from './icp';

/** Wall radius search (mm) and the histogram cell (mm). */
const RADIUS = { minMm: 1, maxMm: 5, coarseMm: 0.2, fineMm: 0.05 };
const CELL_MM = 0.4;
/** Peaks: cells holding at least minFraction of the fullest cell (and minCount samples). */
const PEAK = { minCount: 6, minFraction: 0.3, denseFraction: 0.25, apartMm: 1.5 };
/** Line fit: samples within seedMm of the peak, then within nearMm of the line, along it up to alongMm, normal across it. */
const LINE = { seedMm: 1.2, nearMm: [0.4, 0.25], alongMm: 10, maxNormalDot: 0.3, minSiteSupport: 0.2, minJawSupport: 30 };
/** Pairing: distances and axis angles must agree within these; a site is on a scanned body within inlier*. */
const MATCH = { distanceMm: 1.5, angleRad: (8 * Math.PI) / 180, inlierMm: 1.5, inlierRad: (10 * Math.PI) / 180, leverMm: 4, maxSites: 10, maxSeeds: 6 };
/** Cells are binned in this fixed turned frame, so an axis along x, y or z never runs on cell edges. */
const GRID = fromAxisAngle([1, 2, 3], 0.7);
const SAMPLES_PER_PART = 300;
const JAW_SAMPLES = 40_000;
const KEY_OFFSET = 2 ** 16, KEY_SPAN = 2 ** 17; // 3 × 17 bits < 2^53: exact integer keys

/** Integer key of a grid cell (|index| < 2^16 - 1). */
const cellKey = (ix: number, iy: number, iz: number): number => ((ix + KEY_OFFSET) * KEY_SPAN + (iy + KEY_OFFSET)) * KEY_SPAN + (iz + KEY_OFFSET);
const cellOf = (key: number): Vec3 => {
  const rest = Math.floor(key / KEY_SPAN);
  return [Math.floor(rest / KEY_SPAN) - KEY_OFFSET, (rest % KEY_SPAN) - KEY_OFFSET, (key % KEY_SPAN) - KEY_OFFSET];
};
const inGrid = (ix: number, iy: number, iz: number): boolean => Math.abs(ix) < KEY_OFFSET - 1 && Math.abs(iy) < KEY_OFFSET - 1 && Math.abs(iz) < KEY_OFFSET - 1;

interface Cloud {
  p: Float64Array;
  n: Float64Array;
  count: number;
}

interface AxisLine {
  /** On the axis, mid-wall. */
  point: Vec3;
  dir: Vec3;
  /** Wall extent along dir from point (mm). */
  lo: number;
  hi: number;
  /** Wall samples on it, and their mean distance from it. */
  support: number;
  radius: number;
}

/** Every sample moved by r against its normal (first half) and along it (second half). */
function moved(c: Cloud, r: number): Float64Array {
  const out = new Float64Array(6 * c.count);
  for (let i = 0; i < 3 * c.count; i++) {
    out[i] = c.p[i]! - r * c.n[i]!;
    out[i + 3 * c.count] = c.p[i]! + r * c.n[i]!;
  }
  return out;
}

/** Cell key of every moved point (-1 off the grid) and the count of every cell. */
function histogram(m: Float64Array): { keys: Float64Array; counts: Map<number, number> } {
  const keys = new Float64Array(m.length / 3), counts = new Map<number, number>();
  const g = GRID;
  for (let i = 0; i < keys.length; i++) {
    const x = m[3 * i]!, y = m[3 * i + 1]!, z = m[3 * i + 2]!;
    const ix = Math.floor((g[0]! * x + g[1]! * y + g[2]! * z) / CELL_MM);
    const iy = Math.floor((g[4]! * x + g[5]! * y + g[6]! * z) / CELL_MM);
    const iz = Math.floor((g[8]! * x + g[9]! * y + g[10]! * z) / CELL_MM);
    const key = inGrid(ix, iy, iz) ? cellKey(ix, iy, iz) : -1;
    keys[i] = key;
    if (key >= 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { keys, counts };
}

/** Σ count·(count-1) over the cells of the moved samples: how often they share a cell. */
function pileUp(clouds: readonly Cloud[], r: number): number {
  let pairs = 0;
  for (const c of clouds) for (const n of histogram(moved(c, r)).counts.values()) pairs += n * (n - 1);
  return pairs;
}

/**
 * The parts' wall radius: the radius whose moved samples pile up the most (coarse steps, then fine
 * around the best), then the median over the parts of the wall samples' mean distance from the part's
 * axis (the pile-up only brackets it within about a cell). Null when no part has a wall around an axis.
 */
export function wallRadius(clouds: readonly Cloud[]): number | null {
  let best = 0, radius: number | null = null;
  const consider = (r: number): void => {
    const pairs = pileUp(clouds, r);
    if (pairs > best) (best = pairs), (radius = r);
  };
  for (let r = RADIUS.minMm; r <= RADIUS.maxMm + 1e-9; r += RADIUS.coarseMm) consider(r);
  const coarse: number | null = radius;
  if (coarse === null) return null;
  for (let r = coarse - RADIUS.coarseMm + RADIUS.fineMm; r < coarse + RADIUS.coarseMm - 1e-9; r += RADIUS.fineMm) consider(r);
  const r0: number = radius ?? coarse;
  const radii = clouds.flatMap((c) => axisLines(c, r0, 1).map((l) => l.radius)).sort((a, b) => a - b);
  return radii.length ? radii[radii.length >> 1]! : null;
}

/** Mean of the selected moved points and the direction their normals are all across (least eigenvalue). */
function axisOf(sel: readonly number[], m: Float64Array, c: Cloud): { point: Vec3; dir: Vec3 } {
  const s = new Float64Array(9);
  const point: Vec3 = [0, 0, 0];
  for (const i of sel) {
    const j = 3 * (i % c.count);
    for (let a = 0; a < 3; a++) {
      point[a] = point[a]! + m[3 * i + a]! / sel.length;
      for (let b = 0; b < 3; b++) s[3 * a + b] = s[3 * a + b]! + c.n[j + a]! * c.n[j + b]!;
    }
  }
  const v = eigenSymmetric(s, 3).vectors;
  return { point, dir: [v[2]!, v[5]!, v[8]!] };
}

/** Line through the moved points `dense` around `at`: seed sphere, then two passes closer to the line. */
function fitLine(m: Float64Array, c: Cloud, dense: readonly number[], at: Vec3): AxisLine | null {
  let sel = dense.filter((i) => Math.hypot(m[3 * i]! - at[0], m[3 * i + 1]! - at[1], m[3 * i + 2]! - at[2]) <= LINE.seedMm);
  if (sel.length < PEAK.minCount) return null;
  let axis = axisOf(sel, m, c);
  for (const near of LINE.nearMm) {
    const { point: o, dir: d } = axis;
    sel = [];
    for (const i of dense) {
      const j = 3 * (i % c.count);
      if (Math.abs(c.n[j]! * d[0] + c.n[j + 1]! * d[1] + c.n[j + 2]! * d[2]) > LINE.maxNormalDot) continue;
      const x = m[3 * i]! - o[0], y = m[3 * i + 1]! - o[1], z = m[3 * i + 2]! - o[2];
      const a = x * d[0] + y * d[1] + z * d[2];
      if (Math.abs(a) <= LINE.alongMm && x * x + y * y + z * z - a * a <= near * near) sel.push(i);
    }
    if (sel.length < PEAK.minCount) return null;
    axis = axisOf(sel, m, c);
  }
  // Wall extent of the last selection from the refitted point (2nd-98th percentile against outliers), and its radius.
  const { point, dir } = axis;
  const s = sel.map((i) => (m[3 * i]! - point[0]) * dir[0] + (m[3 * i + 1]! - point[1]) * dir[1] + (m[3 * i + 2]! - point[2]) * dir[2]).sort((a, b) => a - b);
  let radius = 0;
  for (const i of sel) {
    const j = 3 * (i % c.count);
    const x = c.p[j]! - point[0], y = c.p[j + 1]! - point[1], z = c.p[j + 2]! - point[2];
    const a = x * dir[0] + y * dir[1] + z * dir[2];
    radius += Math.sqrt(Math.max(0, x * x + y * y + z * z - a * a)) / sel.length;
  }
  return { point, dir, lo: s[Math.floor(0.02 * (s.length - 1))]!, hi: s[Math.ceil(0.98 * (s.length - 1))]!, support: sel.length, radius };
}

/** q lies on l: within apartMm of its axis, along its wall extent widened by apartMm. */
function onLine(l: AxisLine, q: Vec3): boolean {
  const x = q[0] - l.point[0], y = q[1] - l.point[1], z = q[2] - l.point[2];
  const a = x * l.dir[0] + y * l.dir[1] + z * l.dir[2];
  return a >= l.lo - PEAK.apartMm && a <= l.hi + PEAK.apartMm && x * x + y * y + z * z - a * a <= PEAK.apartMm * PEAK.apartMm;
}

/** The axes of the cylinders of radius r in a cloud, fullest first. */
function axisLines(c: Cloud, r: number, maxLines: number): AxisLine[] {
  const m = moved(c, r);
  const { keys, counts } = histogram(m);
  let top = 0;
  for (const n of counts.values()) top = Math.max(top, n);
  const floor = Math.max(PEAK.minCount, PEAK.minFraction * top);
  const peaks = [...counts].filter(([, n]) => n >= floor).sort((a, b) => b[1] - a[1]);
  // Only points in well-filled cells can belong to an axis: the line fits scan these.
  const denseMin = Math.max(2, PEAK.denseFraction * floor);
  const dense: number[] = [];
  for (let i = 0; i < keys.length; i++) if ((counts.get(keys[i]!) ?? 0) >= denseMin) dense.push(i);
  const lines: AxisLine[] = [], tried: Vec3[] = [];
  for (const [key] of peaks) {
    if (lines.length >= maxLines) break;
    const [ix, iy, iz] = cellOf(key);
    const u = (ix + 0.5) * CELL_MM, v = (iy + 0.5) * CELL_MM, w = (iz + 0.5) * CELL_MM;
    const at: Vec3 = [GRID[0]! * u + GRID[4]! * v + GRID[8]! * w, GRID[1]! * u + GRID[5]! * v + GRID[9]! * w, GRID[2]! * u + GRID[6]! * v + GRID[10]! * w];
    if (lines.some((l) => onLine(l, at)) || tried.some((t) => distance(t, at) < PEAK.apartMm)) continue;
    tried.push(at);
    const line = fitLine(m, c, dense, at);
    if (line && !lines.some((l) => onLine(l, line.point))) lines.push(line);
  }
  return lines;
}

/** Same sense for every line: along their dominant direction. */
function oriented(lines: readonly AxisLine[]): AxisLine[] {
  const s = new Float64Array(9);
  for (const l of lines) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) s[3 * a + b] = s[3 * a + b]! + l.dir[a]! * l.dir[b]!;
  const v = eigenSymmetric(s, 3).vectors;
  const main: Vec3 = [v[0]!, v[3]!, v[6]!];
  return lines.map((l) => (dot(l.dir, main) >= 0 ? l : { ...l, dir: scale(l.dir, -1), lo: -l.hi, hi: -l.lo }));
}

const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** Flat [top, top - lever·dir] per body, for kabsch. */
function anchors(tops: readonly Vec3[], dirs: readonly Vec3[], idx: readonly number[]): number[] {
  return idx.flatMap((i) => [...tops[i]!, ...add(tops[i]!, scale(dirs[i]!, -MATCH.leverMm))]);
}

export interface Seed {
  transform: Mat4;
  /** Sites put on a scanned body. */
  matched: number;
}

/**
 * Up to MATCH.maxSeeds capture -> jaw poses that put the parts' axes on scanned bodies of the same radius,
 * most sites matched first. [] for fewer than 2 parts or 2 scanned bodies.
 */
export function seededStarts(parts: readonly AssemblyPart[], target: IcpTarget, seed: number): Seed[] {
  if (parts.length < 2) return [];
  const clouds: Cloud[] = parts.slice(0, MATCH.maxSites).map((part, k) => {
    const s = sampleSurface(part.mesh, SAMPLES_PER_PART, seed + k);
    return { p: s.points, n: s.normals, count: s.triangles.length };
  });
  const r = wallRadius(clouds);
  if (r === null) return [];
  const sites = oriented(clouds.flatMap((c) => axisLines(c, r, 1).filter((l) => l.support >= LINE.minSiteSupport * c.count)));
  if (sites.length < 2) return [];
  // A prefix of the jaw samples is an unbiased subsample (sampleSurface shuffles): plenty for the scanned walls.
  const n = Math.min(JAW_SAMPLES, target.points.length / 3);
  const jawCloud: Cloud = { p: target.points.subarray(0, 3 * n), n: target.normals.subarray(0, 3 * n), count: n };
  const jaw = oriented(axisLines(jawCloud, r, 3 * sites.length + 4).filter((l) => l.support >= LINE.minJawSupport));
  if (jaw.length < 2) return [];

  const fits = new Map<string, Seed & { rms: number }>();
  const top = (l: AxisLine, sign: number): Vec3 => add(l.point, scale(l.dir, sign > 0 ? l.hi : l.lo));
  for (const ss of [1, -1]) {
    const st = sites.map((l) => top(l, ss)), sd = sites.map((l) => scale(l.dir, ss));
    for (const sj of [1, -1]) {
      const jt = jaw.map((l) => top(l, sj)), jd = jaw.map((l) => scale(l.dir, sj));
      /** Greedy: each site on the nearest unused scanned body within the inlier bounds. */
      const pairsOf = (t: Mat4): Array<[number, number]> => {
        const used = new Set<number>(), out: Array<[number, number]> = [];
        st.forEach((p, i) => {
          const q = transformPoint(t, p), d = transformDirection(t, sd[i]!);
          let best = -1, bestD = MATCH.inlierMm;
          jt.forEach((u, k) => {
            const dk = distance(q, u);
            if (!used.has(k) && dk <= bestD && angle(d, jd[k]!) <= MATCH.inlierRad) (best = k), (bestD = dk);
          });
          if (best >= 0) used.add(best), out.push([i, best]);
        });
        return out;
      };
      for (let a = 0; a < st.length; a++) {
        for (let b = a + 1; b < st.length; b++) {
          const ds = distance(st[a]!, st[b]!), as = angle(sd[a]!, sd[b]!);
          for (let i = 0; i < jt.length; i++) {
            for (let j = 0; j < jt.length; j++) {
              if (i === j || Math.abs(distance(jt[i]!, jt[j]!) - ds) > MATCH.distanceMm || Math.abs(angle(jd[i]!, jd[j]!) - as) > MATCH.angleRad) continue;
              const pairs = pairsOf(kabsch(anchors(st, sd, [a, b]), anchors(jt, jd, [i, j])));
              if (pairs.length < 2) continue;
              const key = `${ss}${sj}:${pairs.map((p) => p.join('-')).join(',')}`;
              if (fits.has(key)) continue;
              const src = anchors(st, sd, pairs.map((p) => p[0])), dst = anchors(jt, jd, pairs.map((p) => p[1]));
              const t = kabsch(src, dst);
              let e2 = 0;
              for (let k = 0; k < src.length; k += 3) e2 += distance(transformPoint(t, [src[k]!, src[k + 1]!, src[k + 2]!]), [dst[k]!, dst[k + 1]!, dst[k + 2]!]) ** 2;
              fits.set(key, { transform: t, matched: pairs.length, rms: Math.sqrt((3 * e2) / src.length) });
            }
          }
        }
      }
    }
  }
  return [...fits.values()].sort((x, y) => y.matched - x.matched || x.rms - y.rms).slice(0, MATCH.maxSeeds).map(({ transform, matched }) => ({ transform, matched }));
}
