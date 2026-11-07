/**
 * Spatial indexes over typed arrays (no object per node):
 * - KdTree over points: nearest jaw sample for ICP correspondences.
 * - TriangleTree over triangles: exact closest point on the jaw surface (metrics, deviation map).
 * Both split at the median item centre along the widest axis and prune with each node's bounding
 * box, so every query is exact. Queries reuse a per-tree scratch stack: they are synchronous and
 * never nested, which is all a worker does.
 *
 * Errors: INVALID_ARGUMENT, details.reason 'shape' | 'nonFinite' | 'indexRange'.
 */
import { XchangeError } from '../core/errors';
import { closestPointOnTriangle } from '../core/mesh';
import type { TriMesh } from '../core/types';

const LEAF_SIZE = 8;
/** Deeper than any tree below 2^60 items (depth ≈ log2(count / LEAF_SIZE) + 1). */
const STACK_SIZE = 64;

interface Nodes {
  /** Item per slot; node k covers the slots [start[k], end[k]). */
  readonly order: Uint32Array;
  /** minX, minY, minZ, maxX, maxY, maxZ of everything below each node. */
  readonly box: Float64Array;
  readonly start: Uint32Array;
  readonly end: Uint32Array;
  /** Right child, or -1 for a leaf. The left child is always node + 1. */
  readonly right: Int32Array;
  readonly stackNode: Int32Array;
  readonly stackDist: Float64Array;
}

export interface KdTree extends Nodes {
  readonly points: Float64Array | Float32Array;
  /** The points copied in slot order, for cache-friendly leaf scans. */
  readonly slotPoints: Float64Array;
}

export interface TriangleTree extends Nodes {
  readonly mesh: TriMesh;
}

function countNodes(n: number, memo: Map<number, number>): number {
  if (n <= LEAF_SIZE) return 1;
  let count = memo.get(n);
  if (count === undefined) {
    const half = n >>> 1;
    count = 1 + countNodes(half, memo) + countNodes(n - half, memo);
    memo.set(n, count);
  }
  return count;
}

/** Reorders order[lo..hi] (inclusive) so slot k holds the k-th smallest centre on `axis` (Hoare quickselect). */
function select(order: Uint32Array, lo: number, hi: number, k: number, centres: Float64Array | Float32Array, axis: number): void {
  while (hi > lo) {
    const a = centres[3 * order[lo]! + axis]!;
    const b = centres[3 * order[(lo + hi) >>> 1]! + axis]!;
    const c = centres[3 * order[hi]! + axis]!;
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = lo, j = hi;
    while (i <= j) {
      while (centres[3 * order[i]! + axis]! < pivot) i++;
      while (centres[3 * order[j]! + axis]! > pivot) j--;
      if (i <= j) {
        const t = order[i]!;
        order[i] = order[j]!;
        order[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/** Shared builder. With `mesh`, items are its triangles and leaf boxes enclose their vertices. */
function buildNodes(centres: Float64Array | Float32Array, count: number, mesh: TriMesh | null): Nodes {
  const nodeCount = countNodes(count, new Map());
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const box = new Float64Array(6 * nodeCount);
  const start = new Uint32Array(nodeCount);
  const end = new Uint32Array(nodeCount);
  const right = new Int32Array(nodeCount);
  let next = 0;

  const leafBox = (node: number, lo: number, hi: number): void => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const grow = (src: Float64Array | Float32Array, o: number): void => {
      const x = src[o]!, y = src[o + 1]!, z = src[o + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    };
    for (let s = lo; s < hi; s++) {
      const item = order[s]!;
      if (mesh) for (let k = 0; k < 3; k++) grow(mesh.positions, 3 * mesh.indices[3 * item + k]!);
      else grow(centres, 3 * item);
    }
    box.set([x0, y0, z0, x1, y1, z1], 6 * node);
  };

  const build = (lo: number, hi: number): number => {
    const node = next++;
    start[node] = lo;
    end[node] = hi;
    if (hi - lo <= LEAF_SIZE) {
      right[node] = -1;
      leafBox(node, lo, hi);
      return node;
    }
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let s = lo; s < hi; s++) {
      const o = 3 * order[s]!;
      const x = centres[o]!, y = centres[o + 1]!, z = centres[o + 2]!;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (lo + hi) >>> 1;
    select(order, lo, hi - 1, mid, centres, axis);
    const left = build(lo, mid);
    const r = build(mid, hi);
    right[node] = r;
    for (let k = 0; k < 3; k++) {
      box[6 * node + k] = Math.min(box[6 * left + k]!, box[6 * r + k]!);
      box[6 * node + 3 + k] = Math.max(box[6 * left + 3 + k]!, box[6 * r + 3 + k]!);
    }
    return node;
  };

  build(0, count);
  return { order, box, start, end, right, stackNode: new Int32Array(STACK_SIZE), stackDist: new Float64Array(STACK_SIZE) };
}

function boxDistance2(box: Float64Array, node: number, x: number, y: number, z: number): number {
  const o = 6 * node;
  let d = 0;
  let t = box[o]! - x;
  if (t > 0) d += t * t;
  else if ((t = x - box[o + 3]!) > 0) d += t * t;
  t = box[o + 1]! - y;
  if (t > 0) d += t * t;
  else if ((t = y - box[o + 4]!) > 0) d += t * t;
  t = box[o + 2]! - z;
  if (t > 0) d += t * t;
  else if ((t = z - box[o + 5]!) > 0) d += t * t;
  return d;
}

/** Pushes the children of `node` nearer-last (so the nearer one is visited first). Returns the new stack top. */
function pushChildren(tree: Nodes, node: number, top: number, best: number, x: number, y: number, z: number): number {
  const l = node + 1, r = tree.right[node]!;
  const dl = boxDistance2(tree.box, l, x, y, z), dr = boxDistance2(tree.box, r, x, y, z);
  const { stackNode, stackDist } = tree;
  const leftFirst = dl <= dr;
  const far = leftFirst ? r : l, dFar = leftFirst ? dr : dl;
  const near = leftFirst ? l : r, dNear = leftFirst ? dl : dr;
  if (dFar <= best) {
    stackNode[top] = far;
    stackDist[top++] = dFar;
  }
  if (dNear <= best) {
    stackNode[top] = near;
    stackDist[top++] = dNear;
  }
  return top;
}

function checkFinite(values: ArrayLike<number>): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new XchangeError('INVALID_ARGUMENT', { reason: 'nonFinite' });
  }
}

export function buildKdTree(points: Float64Array | Float32Array): KdTree {
  if (points.length % 3 !== 0) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  checkFinite(points);
  const count = points.length / 3;
  const nodes = buildNodes(points, count, null);
  const slotPoints = new Float64Array(points.length);
  for (let s = 0; s < count; s++) {
    const o = 3 * nodes.order[s]!;
    slotPoints[3 * s] = points[o]!;
    slotPoints[3 * s + 1] = points[o + 1]!;
    slotPoints[3 * s + 2] = points[o + 2]!;
  }
  return { ...nodes, points, slotPoints };
}

/** Index of the nearest point, or -1 if none within maxDistanceMm (inclusive). */
export function nearest(tree: KdTree, x: number, y: number, z: number, maxDistanceMm = Infinity): number {
  let best = maxDistanceMm * maxDistanceMm;
  let found = -1;
  const d0 = boxDistance2(tree.box, 0, x, y, z);
  if (!(d0 <= best)) return -1;
  const { stackNode, stackDist, right, start, end, slotPoints } = tree;
  let top = 0;
  stackNode[top] = 0;
  stackDist[top++] = d0;
  while (top > 0) {
    top--;
    if (stackDist[top]! > best) continue;
    const node = stackNode[top]!;
    if (right[node]! >= 0) {
      top = pushChildren(tree, node, top, best, x, y, z);
      continue;
    }
    for (let s = start[node]!, e = end[node]!; s < e; s++) {
      const dx = slotPoints[3 * s]! - x, dy = slotPoints[3 * s + 1]! - y, dz = slotPoints[3 * s + 2]! - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best || (found < 0 && d <= best)) {
        best = d;
        found = s;
      }
    }
  }
  return found < 0 ? -1 : tree.order[found]!;
}

export function buildTriangleTree(mesh: TriMesh): TriangleTree {
  const { positions, indices } = mesh;
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  checkFinite(positions);
  const vertexCount = positions.length / 3;
  const count = indices.length / 3;
  // ponytail: float32 centroids only steer the median split; boxes use the exact vertices.
  const centres = new Float32Array(3 * count);
  for (let t = 0; t < count; t++) {
    const a = indices[3 * t]!, b = indices[3 * t + 1]!, c = indices[3 * t + 2]!;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) throw new XchangeError('INVALID_ARGUMENT', { reason: 'indexRange' });
    for (let k = 0; k < 3; k++) centres[3 * t + k] = (positions[3 * a + k]! + positions[3 * b + k]! + positions[3 * c + k]!) / 3;
  }
  return { ...buildNodes(centres, count, mesh), mesh };
}

const hitScratch = new Float64Array(3);

/**
 * Squared distance from (x, y, z) to the closest point of the surface (exact), or Infinity when
 * nothing lies within maxDistanceMm. `out` (length >= 4), if given, receives the point and the triangle.
 */
export function closestOnSurface(tree: TriangleTree, x: number, y: number, z: number, maxDistanceMm = Infinity, out?: Float64Array): number {
  let best = maxDistanceMm * maxDistanceMm;
  let found = -1;
  const d0 = boxDistance2(tree.box, 0, x, y, z);
  if (!(d0 <= best)) return Infinity;
  const { stackNode, stackDist, right, start, end, order } = tree;
  const { positions, indices } = tree.mesh;
  let top = 0;
  stackNode[top] = 0;
  stackDist[top++] = d0;
  while (top > 0) {
    top--;
    if (stackDist[top]! > best) continue;
    const node = stackNode[top]!;
    if (right[node]! >= 0) {
      top = pushChildren(tree, node, top, best, x, y, z);
      continue;
    }
    for (let s = start[node]!, e = end[node]!; s < e; s++) {
      const tri = order[s]!;
      const d = closestPointOnTriangle(positions, indices, tri, x, y, z, hitScratch);
      if (d < best || (found < 0 && d <= best)) {
        best = d;
        found = tri;
        if (out) {
          out[0] = hitScratch[0]!;
          out[1] = hitScratch[1]!;
          out[2] = hitScratch[2]!;
          out[3] = tri;
        }
      }
    }
  }
  return found < 0 ? Infinity : best;
}
