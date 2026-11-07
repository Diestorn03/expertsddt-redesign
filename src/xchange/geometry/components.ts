/**
 * Connected shells of an indexed mesh (spec 4.1.2). Connectivity is by shared vertex index:
 * weld first when coincident vertices may be duplicated.
 * Errors: INVALID_ARGUMENT reason 'labels', plus checkMesh's 'shape' | 'index'.
 */
import { XchangeError } from '../core/errors';
import type { TriMesh } from '../core/types';
import { checkMesh } from './check';

export interface ComponentLabels {
  count: number;
  /** Per triangle, 0..count-1; components numbered in order of their lowest triangle index. */
  triangleComponent: Uint32Array;
}

/** Triangles sharing a vertex index are connected (union-find over vertices). */
export function connectedComponents(mesh: TriMesh): ComponentLabels {
  const vertexCount = checkMesh(mesh);
  const idx = mesh.indices;
  const parent = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) parent[v] = v;
  const find = (v: number): number => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!; // path halving
      v = parent[v]!;
    }
    return v;
  };
  const triangles = idx.length / 3;
  for (let t = 0; t < triangles; t++) {
    let a = find(idx[3 * t]!);
    for (let k = 1; k < 3; k++) {
      const b = find(idx[3 * t + k]!);
      if (a === b) continue;
      // Roots always point to the smaller index, so the merged root is min(a, b).
      parent[Math.max(a, b)] = Math.min(a, b);
      a = Math.min(a, b);
    }
  }
  const label = new Int32Array(vertexCount).fill(-1);
  const triangleComponent = new Uint32Array(triangles);
  let count = 0;
  for (let t = 0; t < triangles; t++) {
    const root = find(idx[3 * t]!);
    if (label[root]! < 0) label[root] = count++;
    triangleComponent[t] = label[root]!;
  }
  return { count, triangleComponent };
}

/** One compact mesh per component (unused vertices removed, triangle order kept), in label order. */
export function extractComponents(mesh: TriMesh, labels: ComponentLabels): TriMesh[] {
  const vertexCount = checkMesh(mesh);
  const { count, triangleComponent } = labels;
  const triangles = mesh.indices.length / 3;
  if (triangleComponent.length !== triangles || !Number.isInteger(count) || count < 0) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'labels' });
  }
  // Counting sort of the triangles by component.
  const first = new Uint32Array(count + 1);
  for (let t = 0; t < triangles; t++) {
    const c = triangleComponent[t]!;
    if (c >= count) throw new XchangeError('INVALID_ARGUMENT', { reason: 'labels' });
    first[c + 1] = first[c + 1]! + 1;
  }
  for (let c = 0; c < count; c++) first[c + 1] = first[c + 1]! + first[c]!;
  const fill = first.slice(0, count);
  const order = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const c = triangleComponent[t]!;
    order[fill[c]!] = t;
    fill[c] = fill[c]! + 1;
  }

  const p = mesh.positions, idx = mesh.indices, colors = mesh.colors;
  const stamp = new Uint32Array(vertexCount); // component + 1 that owns local[v]
  const local = new Uint32Array(vertexCount);
  const vertices = new Uint32Array(Math.min(vertexCount, mesh.indices.length));
  const out: TriMesh[] = [];
  for (let c = 0; c < count; c++) {
    const from = first[c]!, to = first[c + 1]!;
    let used = 0;
    for (let i = from; i < to; i++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[3 * order[i]! + k]!;
        if (stamp[v] !== c + 1) {
          stamp[v] = c + 1;
          vertices[used++] = v;
        }
      }
    }
    // Keep the original relative vertex order (a mesh that is one component comes back unchanged).
    const kept = vertices.subarray(0, used).sort();
    for (let l = 0; l < used; l++) local[kept[l]!] = l;
    const positions = new Float32Array(3 * used);
    const indices = new Uint32Array(3 * (to - from));
    const part: TriMesh = { positions, indices };
    if (colors) part.colors = new Uint8Array(3 * used);
    for (let i = from; i < to; i++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[3 * order[i]! + k]!;
        const l = local[v]!;
        indices[3 * (i - from) + k] = l;
        positions[3 * l] = p[3 * v]!;
        positions[3 * l + 1] = p[3 * v + 1]!;
        positions[3 * l + 2] = p[3 * v + 2]!;
        if (part.colors) {
          part.colors[3 * l] = colors![3 * v]!;
          part.colors[3 * l + 1] = colors![3 * v + 1]!;
          part.colors[3 * l + 2] = colors![3 * v + 2]!;
        }
      }
    }
    out.push(part);
  }
  return out;
}
