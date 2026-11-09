/** Small Vec3 helpers for setup code. Hot loops should use scalars over typed arrays instead. */
import { XchangeError } from './errors';
import type { Vec3 } from './types';

type V = Readonly<Vec3>;

export const add = (a: V, b: V): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: V): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Unit vector; throws DEGENERATE_GEOMETRY for a (near) zero vector. */
export function normalize(a: V): Vec3 {
  const len = length(a);
  if (!(len > 1e-12)) throw new XchangeError('DEGENERATE_GEOMETRY', { reason: 'zeroVector' });
  return [a[0] / len, a[1] / len, a[2] / len];
}
