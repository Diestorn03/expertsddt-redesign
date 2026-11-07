/** Helpers for the io/mesh tests only (never imported by runtime code). */
import { expect } from 'vitest';
import { XchangeError, type ErrorCode } from '../../core/errors';
import type { TriMesh } from '../../core/types';

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Corner coordinates triangle by triangle: what "the same triangles" means for indexed meshes. */
export function soup(mesh: TriMesh): Float32Array {
  const out = new Float32Array(3 * mesh.indices.length);
  mesh.indices.forEach((v, i) => out.set(mesh.positions.subarray(3 * v, 3 * v + 3), 3 * i));
  return out;
}

/** fn must throw an XchangeError with this code (and these details, if given). */
export function expectError(fn: () => unknown, code: ErrorCode, details?: Record<string, unknown>): XchangeError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}`).toBeInstanceOf(XchangeError);
  const error = caught as XchangeError;
  expect(error.code).toBe(code);
  if (details) expect(error.details).toMatchObject(details);
  return error;
}

/** Signed area (z of the cross product / 2) of every triangle, in the plane given by `normal`. */
export function triangleAreasAlong(mesh: TriMesh, normal: readonly [number, number, number]): number[] {
  const p = mesh.positions, idx = mesh.indices, out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t]!, b = 3 * idx[t + 1]!, c = 3 * idx[t + 2]!;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out.push((nx * normal[0] + ny * normal[1] + nz * normal[2]) / 2);
  }
  return out;
}
