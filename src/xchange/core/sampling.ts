/** Seeded randomness and area-weighted surface sampling (deterministic for a given seed). */
import { XchangeError } from './errors';
import type { TriMesh } from './types';

/** Uniform [0, 1). */
export type Rng = () => number;

/** mulberry32: small, fast, good enough for sampling and test noise. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Secret per-call seed for hash tables keyed by file content, so crafted coordinates cannot pile into
 * one bucket (HashDoS). It never changes a result (callers number entries by first use, not by hash),
 * so outputs stay deterministic; this is the one place randomness does not go through createRng.
 */
export function hashSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** Seeded hash of three 32-bit words (murmur3-style mixing: every input bit reaches the low bits). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x ^ seed, 0xcc9e2d51);
  h = Math.imul(h ^ (h >>> 15) ^ y, 0x1b873593);
  h = Math.imul(h ^ (h >>> 13) ^ z, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Standard normal deviate (Box-Muller). */
export function gaussian(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface SurfaceSamples {
  /** xyz per sample. */
  points: Float64Array;
  /** Unit face normal per sample. */
  normals: Float64Array;
  /** Source triangle per sample (use it to attribute samples to parts of a merged mesh). */
  triangles: Uint32Array;
}

/**
 * `count` points spread over the surface proportionally to area (stratified along the area CDF,
 * then shuffled, so any prefix is still an unbiased subsample). Zero-area triangles are never hit.
 */
export function sampleSurface(mesh: TriMesh, count: number, seed = 1): SurfaceSamples {
  if (!Number.isInteger(count) || count < 1) throw new XchangeError('INVALID_ARGUMENT', { reason: 'count' });
  const p = mesh.positions, idx = mesh.indices;
  const triangleCount = Math.floor(idx.length / 3);
  const cumulative = new Float64Array(triangleCount);
  const normals = new Float64Array(3 * triangleCount);
  let total = 0;
  for (let t = 0; t < triangleCount; t++) {
    const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      normals[3 * t] = nx / len;
      normals[3 * t + 1] = ny / len;
      normals[3 * t + 2] = nz / len;
    }
    total += len / 2;
    cumulative[t] = total;
  }
  if (!(total > 0) || !Number.isFinite(total)) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'zeroArea' });

  const rng = createRng(seed);
  const out: SurfaceSamples = {
    points: new Float64Array(3 * count),
    normals: new Float64Array(3 * count),
    triangles: new Uint32Array(count),
  };
  let t = 0;
  for (let i = 0; i < count; i++) {
    const target = ((i + rng()) / count) * total;
    while (t < triangleCount - 1 && cumulative[t]! <= target) t++;
    const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
    const r1 = Math.sqrt(rng()), r2 = rng();
    const wa = 1 - r1, wb = r1 * (1 - r2), wc = r1 * r2;
    for (let k = 0; k < 3; k++) {
      out.points[3 * i + k] = wa * p[a + k]! + wb * p[b + k]! + wc * p[c + k]!;
      out.normals[3 * i + k] = normals[3 * t + k]!;
    }
    out.triangles[i] = t;
  }
  // Fisher-Yates so prefixes stay spatially uniform.
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tri = out.triangles[i]!;
    out.triangles[i] = out.triangles[j]!;
    out.triangles[j] = tri;
    swap3(out.points, i, j);
    swap3(out.normals, i, j);
  }
  return out;
}

function swap3(a: Float64Array, i: number, j: number): void {
  for (let k = 0; k < 3; k++) {
    const tmp = a[3 * i + k]!;
    a[3 * i + k] = a[3 * j + k]!;
    a[3 * j + k] = tmp;
  }
}
