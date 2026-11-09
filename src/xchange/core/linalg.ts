/** Tiny dense linear algebra for 3x3..6x6 problems (PCA, Horn fit, point-to-plane ICP). */
import { XchangeError } from './errors';

export interface Eigen {
  /** Eigenvalues, descending. */
  values: Float64Array;
  /** Eigenvectors as COLUMNS of a row-major n×n matrix: vector k = (v[0*n+k], v[1*n+k], ...). */
  vectors: Float64Array;
}

/** Cyclic Jacobi eigen-decomposition of a symmetric n×n row-major matrix. */
export function eigenSymmetric(input: ArrayLike<number>, n: number): Eigen {
  if (!Number.isInteger(n) || n < 1 || input.length !== n * n) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  const a = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i * n + j] = (input[i * n + j]! + input[j * n + i]!) / 2;
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  let norm = 0;
  for (let i = 0; i < n * n; i++) norm += a[i]! * a[i]!;
  if (!Number.isFinite(norm)) throw new XchangeError('INVALID_ARGUMENT', { reason: 'nonFinite' });

  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q]! * a[p * n + q]!;
    if (off <= 1e-30 * norm) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]!;
        if (apq === 0) continue;
        const theta = (a[q * n + q]! - a[p * n + p]!) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!, akq = a[k * n + q]!;
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!, aqk = a[q * n + k]!;
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p]!, vkq = v[k * n + q]!;
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j * n + j]! - a[i * n + i]!);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  order.forEach((src, dst) => {
    values[dst] = a[src * n + src]!;
    for (let k = 0; k < n; k++) vectors[k * n + dst] = v[k * n + src]!;
  });
  return { values, vectors };
}

/**
 * Solves A·x = b (A n×n row-major) by Gaussian elimination with partial pivoting.
 * Returns null when A is singular relative to its largest entry.
 */
export function solveLinear(a: ArrayLike<number>, b: ArrayLike<number>, n: number, pivotTolerance = 1e-12): Float64Array | null {
  if (a.length !== n * n || b.length !== n) throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  const m = Float64Array.from(a);
  const x = Float64Array.from(b);
  let scale = 0;
  for (let i = 0; i < n * n; i++) scale = Math.max(scale, Math.abs(m[i]!));
  if (!(scale > 0) || !Number.isFinite(scale)) return null;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r * n + col]!) > Math.abs(m[pivot * n + col]!)) pivot = r;
    if (!(Math.abs(m[pivot * n + col]!) > pivotTolerance * scale)) return null;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const tmp = m[col * n + k]!;
        m[col * n + k] = m[pivot * n + k]!;
        m[pivot * n + k] = tmp;
      }
      const tmp = x[col]!;
      x[col] = x[pivot]!;
      x[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col]! / m[col * n + col]!;
      if (f === 0) continue;
      for (let k = col; k < n; k++) m[r * n + k] = m[r * n + k]! - f * m[col * n + k]!;
      x[r] = x[r]! - f * x[col]!;
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]!;
    for (let k = r + 1; k < n; k++) s -= m[r * n + k]! * x[k]!;
    x[r] = s / m[r * n + r]!;
  }
  return x;
}
