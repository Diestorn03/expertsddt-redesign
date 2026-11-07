/**
 * Triangle BVH for exact closest-point queries (fits, metrics) and ray picking (viewer).
 * Median split on the longest centroid axis, leaves of at most 8 triangles, typed arrays only.
 * Errors: MESH_EMPTY (no triangles), INVALID_ARGUMENT reason 'ray', plus checkMesh's.
 */
import { XchangeError } from '../core/errors';
import { checkMesh, closestPointOnTriangle } from '../core/mesh';
import type { TriMesh, Vec3 } from '../core/types';

const LEAF_SIZE = 8;

export interface Bvh {
  readonly mesh: TriMesh;
  /** 6 floats per node: min x, y, z then max x, y, z. */
  readonly nodeBounds: Float32Array;
  /** Leaf: first position in `order`. Inner node: index of its left child (the right child follows it). */
  readonly nodeStart: Uint32Array;
  /** Leaf: triangle count (> 0). Inner node: 0. */
  readonly nodeCount: Uint32Array;
  /** Triangle indices grouped by leaf. */
  readonly order: Uint32Array;
}

export interface SurfaceHit {
  triangle: number;
  point: Vec3;
  distanceMm: number;
}

export function buildBvh(mesh: TriMesh): Bvh {
  checkMesh(mesh);
  const p = mesh.positions, idx = mesh.indices;
  const triangles = idx.length / 3;
  if (triangles === 0) throw new XchangeError('MESH_EMPTY');
  const triBounds = new Float32Array(6 * triangles);
  const centroids = new Float64Array(3 * triangles);
  for (let t = 0; t < triangles; t++) {
    const a = 3 * idx[3 * t]!, b = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
    for (let k = 0; k < 3; k++) {
      const va = p[a + k]!, vb = p[b + k]!, vc = p[c + k]!;
      triBounds[6 * t + k] = Math.min(va, vb, vc);
      triBounds[6 * t + 3 + k] = Math.max(va, vb, vc);
      centroids[3 * t + k] = (va + vb + vc) / 3;
    }
  }
  const order = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) order[t] = t;
  // Halving splits of > LEAF_SIZE triangles leave >= LEAF_SIZE / 2 per leaf: at most triangles / 4 leaves.
  const maxNodes = 2 * Math.ceil(triangles / (LEAF_SIZE / 2)) + 1;
  const nodeBounds = new Float32Array(6 * maxNodes);
  const nodeStart = new Uint32Array(maxNodes);
  const nodeCount = new Uint32Array(maxNodes);
  let nodes = 1;
  let seed = 0x2545f491;
  const stack: number[] = [0, 0, triangles]; // node, start, end
  while (stack.length > 0) {
    const end = stack.pop()!, start = stack.pop()!, node = stack.pop()!;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity, cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i]!, o = 6 * t;
      minX = Math.min(minX, triBounds[o]!); minY = Math.min(minY, triBounds[o + 1]!); minZ = Math.min(minZ, triBounds[o + 2]!);
      maxX = Math.max(maxX, triBounds[o + 3]!); maxY = Math.max(maxY, triBounds[o + 4]!); maxZ = Math.max(maxZ, triBounds[o + 5]!);
      const cx = centroids[3 * t]!, cy = centroids[3 * t + 1]!, cz = centroids[3 * t + 2]!;
      cMinX = Math.min(cMinX, cx); cMinY = Math.min(cMinY, cy); cMinZ = Math.min(cMinZ, cz);
      cMaxX = Math.max(cMaxX, cx); cMaxY = Math.max(cMaxY, cy); cMaxZ = Math.max(cMaxZ, cz);
    }
    const o = 6 * node;
    nodeBounds[o] = minX; nodeBounds[o + 1] = minY; nodeBounds[o + 2] = minZ;
    nodeBounds[o + 3] = maxX; nodeBounds[o + 4] = maxY; nodeBounds[o + 5] = maxZ;
    if (end - start <= LEAF_SIZE) {
      nodeStart[node] = start;
      nodeCount[node] = end - start;
      continue;
    }
    const ex = cMaxX - cMinX, ey = cMaxY - cMinY, ez = cMaxZ - cMinZ;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (start + end) >>> 1;
    seed = selectNth(order, centroids, axis, start, end, mid, seed);
    const left = nodes;
    nodes += 2;
    nodeStart[node] = left;
    nodeCount[node] = 0;
    stack.push(left, start, mid, left + 1, mid, end);
  }
  return { mesh, nodeBounds, nodeStart, nodeCount, order };
}

/**
 * Reorders order[lo, hi) so that position k holds the element of rank k by centroid[axis]
 * (smaller keys before it, larger after). Random pivot + 3-way partition: expected O(n),
 * also with many equal keys. Returns the next xorshift state.
 */
function selectNth(order: Uint32Array, keys: Float64Array, axis: number, lo: number, hi: number, k: number, seed: number): number {
  const key = (i: number): number => keys[3 * order[i]! + axis]!;
  const swap = (i: number, j: number): void => {
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  };
  while (hi - lo > 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const pivot = key(lo + ((seed >>> 0) % (hi - lo)));
    let lt = lo, i = lo, gt = hi;
    while (i < gt) {
      const v = key(i);
      if (v < pivot) swap(lt++, i++);
      else if (v > pivot) swap(i, --gt);
      else i++;
    }
    if (k < lt) hi = lt;
    else if (k >= gt) lo = gt;
    else break;
  }
  return seed;
}

// Traversal scratch (single-threaded; the tree depth stays far below 128 for any allowed mesh).
const stackNode = new Int32Array(256);
const stackDist = new Float64Array(256);
const triScratch = new Float64Array(3);
const hitScratch = new Float64Array(4);

function boxDistance2(b: Float32Array, node: number, x: number, y: number, z: number): number {
  const o = 6 * node;
  const dx = Math.max(b[o]! - x, 0, x - b[o + 3]!);
  const dy = Math.max(b[o + 1]! - y, 0, y - b[o + 4]!);
  const dz = Math.max(b[o + 2]! - z, 0, z - b[o + 5]!);
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Allocation-free closest point for hot loops: writes the point to out[0..2] and its SQUARED
 * distance to out[3]; returns the triangle, or -1 when no surface point is within sqrt(maxDistance2).
 */
export function nearestOnSurface(bvh: Bvh, x: number, y: number, z: number, maxDistance2: number, out: Float64Array): number {
  const { nodeBounds: b, nodeStart, nodeCount, order } = bvh;
  const { positions, indices } = bvh.mesh;
  let best2 = maxDistance2, found = -1;
  const d0 = boxDistance2(b, 0, x, y, z);
  if (d0 > best2) return -1;
  stackNode[0] = 0;
  stackDist[0] = d0;
  let sp = 1;
  while (sp > 0) {
    sp--;
    if (stackDist[sp]! > best2) continue;
    const node = stackNode[sp]!;
    const count = nodeCount[node]!;
    if (count > 0) {
      const from = nodeStart[node]!;
      for (let i = from; i < from + count; i++) {
        const t = order[i]!;
        const d2 = closestPointOnTriangle(positions, indices, t, x, y, z, triScratch);
        if (d2 < best2 || (found < 0 && d2 <= best2)) {
          best2 = d2;
          found = t;
          out[0] = triScratch[0]!;
          out[1] = triScratch[1]!;
          out[2] = triScratch[2]!;
        }
      }
      continue;
    }
    const left = nodeStart[node]!;
    sp = pushChildren(left, boxDistance2(b, left, x, y, z), boxDistance2(b, left + 1, x, y, z), best2, sp);
  }
  if (found >= 0) out[3] = best2;
  return found;
}

/** Pushes the farther child first (so the nearer is searched first), skipping keys above `limit`. Returns the new stack size. */
function pushChildren(left: number, keyLeft: number, keyRight: number, limit: number, sp: number): number {
  const nearFirst = keyLeft <= keyRight;
  const farNode = nearFirst ? left + 1 : left, farKey = nearFirst ? keyRight : keyLeft;
  const nearNode = nearFirst ? left : left + 1, nearKey = nearFirst ? keyLeft : keyRight;
  if (farKey <= limit) {
    stackNode[sp] = farNode;
    stackDist[sp++] = farKey;
  }
  if (nearKey <= limit) {
    stackNode[sp] = nearNode;
    stackDist[sp++] = nearKey;
  }
  return sp;
}

/** Exact closest point on the surface; null if farther than maxDistanceMm. */
export function closestPoint(bvh: Bvh, p: Readonly<Vec3>, maxDistanceMm = Infinity): SurfaceHit | null {
  const triangle = nearestOnSurface(bvh, p[0], p[1], p[2], maxDistanceMm * maxDistanceMm, hitScratch);
  if (triangle < 0) return null;
  return { triangle, point: [hitScratch[0]!, hitScratch[1]!, hitScratch[2]!], distanceMm: Math.sqrt(hitScratch[3]!) };
}

/** Entry distance of the ray into the node's box, clipped to [0, tMax]; Infinity on a miss. */
function rayBoxEntry(b: Float32Array, node: number, o: Readonly<Vec3>, inv: Readonly<Vec3>, tMax: number): number {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    const lo = b[6 * node + k]!, hi = b[6 * node + 3 + k]!, ok = o[k]!, ik = inv[k]!;
    if (Number.isFinite(ik)) {
      const a = (lo - ok) * ik, c = (hi - ok) * ik;
      t0 = Math.max(t0, Math.min(a, c));
      t1 = Math.min(t1, Math.max(a, c));
      if (t0 > t1) return Infinity;
    } else if (ok < lo || ok > hi) {
      return Infinity; // parallel to this slab and outside it
    }
  }
  return t0;
}

const BARY_EPS = 1e-9; // closes cracks between triangles that share an edge

/** Nearest hit along the ray (direction need not be unit); both faces count. */
export function raycast(bvh: Bvh, origin: Readonly<Vec3>, direction: Readonly<Vec3>, maxDistanceMm = Infinity): SurfaceHit | null {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(len > 0) || !Number.isFinite(len) || !origin.every(Number.isFinite) || !(maxDistanceMm >= 0)) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'ray' });
  }
  const d: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len];
  const inv: Vec3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  const { nodeBounds: b, nodeStart, nodeCount, order } = bvh;
  const { positions: p, indices: idx } = bvh.mesh;
  let bestT = maxDistanceMm, found = -1;
  const t0 = rayBoxEntry(b, 0, origin, inv, bestT);
  if (t0 === Infinity) return null;
  stackNode[0] = 0;
  stackDist[0] = t0;
  let sp = 1;
  while (sp > 0) {
    sp--;
    if (stackDist[sp]! > bestT) continue;
    const node = stackNode[sp]!;
    const count = nodeCount[node]!;
    if (count > 0) {
      const from = nodeStart[node]!;
      for (let i = from; i < from + count; i++) {
        const t = order[i]!;
        const a = 3 * idx[3 * t]!, bb = 3 * idx[3 * t + 1]!, c = 3 * idx[3 * t + 2]!;
        // Möller-Trumbore, two-sided.
        const e1x = p[bb]! - p[a]!, e1y = p[bb + 1]! - p[a + 1]!, e1z = p[bb + 2]! - p[a + 2]!;
        const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det === 0 || !Number.isFinite(det)) continue;
        const invDet = 1 / det;
        const sx = origin[0] - p[a]!, sy = origin[1] - p[a + 1]!, sz = origin[2] - p[a + 2]!;
        const u = (sx * px + sy * py + sz * pz) * invDet;
        if (u < -BARY_EPS || u > 1 + BARY_EPS) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * invDet;
        if (v < -BARY_EPS || u + v > 1 + BARY_EPS) continue;
        const hitT = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (hitT >= 0 && (hitT < bestT || (found < 0 && hitT <= bestT))) {
          bestT = hitT;
          found = t;
        }
      }
      continue;
    }
    const left = nodeStart[node]!;
    // A miss is Infinity: the finite limit keeps it off the stack even while bestT is still Infinity.
    const limit = Math.min(bestT, Number.MAX_VALUE);
    sp = pushChildren(left, rayBoxEntry(b, left, origin, inv, bestT), rayBoxEntry(b, left + 1, origin, inv, bestT), limit, sp);
  }
  if (found < 0) return null;
  return { triangle: found, point: [origin[0] + bestT * d[0], origin[1] + bestT * d[1], origin[2] + bestT * d[2]], distanceMm: bestT };
}
