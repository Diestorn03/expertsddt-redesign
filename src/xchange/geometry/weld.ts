/**
 * Tolerance weld: shells are found on welded vertices (spec 4.1.2).
 * Errors: INVALID_ARGUMENT reason 'tolerance', plus checkMesh's 'shape' | 'index'.
 */
import { XchangeError } from '../core/errors';
import type { TriMesh } from '../core/types';
import { checkMesh } from './check';

/**
 * Merges every vertex into the closest earlier kept vertex within toleranceMm (grid hash with
 * cells of 2·tolerance, so the 8 cells around a point cover its whole neighbourhood). Kept
 * vertices stay in first-use order with the first vertex's position and color; triangles that
 * lose a corner are dropped and the rest keep their order.
 */
export function weld(mesh: TriMesh, toleranceMm = 1e-5): TriMesh {
  if (!(toleranceMm > 0) || !Number.isFinite(toleranceMm)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'tolerance' });
  const vertexCount = checkMesh(mesh);
  const p = mesh.positions;
  const cell = 2 * toleranceMm;
  const tolerance2 = toleranceMm * toleranceMm;
  let size = 16;
  while (size < 2 * vertexCount) size *= 2;
  const mask = size - 1;
  const heads = new Int32Array(size).fill(-1);
  const next = new Int32Array(vertexCount);
  const keptVertex = new Uint32Array(vertexCount);
  const remap = new Uint32Array(vertexCount);
  let kept = 0;

  for (let v = 0; v < vertexCount; v++) {
    const x = p[3 * v]!, y = p[3 * v + 1]!, z = p[3 * v + 2]!;
    const fx = x / cell, fy = y / cell, fz = z / cell;
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    // Within a cell of 2·tolerance only the neighbour on the near side can hold a match.
    const sx = fx - cx < 0.5 ? -1 : 1, sy = fy - cy < 0.5 ? -1 : 1, sz = fz - cz < 0.5 ? -1 : 1;
    let best = -1, bestD2 = tolerance2;
    for (let corner = 0; corner < 8; corner++) {
      const h = cellHash(cx + (corner & 1 ? sx : 0), cy + (corner & 2 ? sy : 0), cz + (corner & 4 ? sz : 0)) & mask;
      for (let r = heads[h]!; r >= 0; r = next[r]!) {
        const q = 3 * keptVertex[r]!;
        const dx = p[q]! - x, dy = p[q + 1]! - y, dz = p[q + 2]! - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2 || (d2 === bestD2 && (best < 0 || r < best))) {
          best = r;
          bestD2 = d2;
        }
      }
    }
    if (best >= 0) {
      remap[v] = best;
      continue;
    }
    const h = cellHash(cx, cy, cz) & mask;
    keptVertex[kept] = v;
    remap[v] = kept;
    next[kept] = heads[h]!;
    heads[h] = kept;
    kept++;
  }

  const positions = new Float32Array(3 * kept);
  const colors = mesh.colors ? new Uint8Array(3 * kept) : undefined;
  for (let r = 0; r < kept; r++) {
    const s = 3 * keptVertex[r]!;
    positions[3 * r] = p[s]!;
    positions[3 * r + 1] = p[s + 1]!;
    positions[3 * r + 2] = p[s + 2]!;
    if (colors) {
      colors[3 * r] = mesh.colors![s]!;
      colors[3 * r + 1] = mesh.colors![s + 1]!;
      colors[3 * r + 2] = mesh.colors![s + 2]!;
    }
  }
  const src = mesh.indices;
  const out = new Uint32Array(src.length);
  let n = 0;
  for (let t = 0; t + 2 < src.length; t += 3) {
    const a = remap[src[t]!]!, b = remap[src[t + 1]!]!, c = remap[src[t + 2]!]!;
    if (a === b || b === c || a === c) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = c;
  }
  const indices = n === out.length ? out : out.slice(0, n);
  return colors ? { positions, indices, colors } : { positions, indices };
}

/** Integer cell -> hash. `| 0` is exact modulo 2^32 for any cell index below 2^53. */
function cellHash(x: number, y: number, z: number): number {
  return Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f);
}
