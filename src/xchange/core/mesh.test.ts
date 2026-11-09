import { describe, expect, it } from 'vitest';
import { makeScanBody, randomRigid } from '../test/fixtures';
import { XchangeError } from './errors';
import { fromAxisAngle, transformPoint } from './mat4';
import {
  closestPointOnTriangle,
  computeBounds,
  computeFaceNormals,
  computeVertexNormals,
  countTriangles,
  mergeMeshes,
  surfaceArea,
  transformMesh,
} from './mesh';
import { createRng, gaussian, sampleSurface } from './sampling';
import { STL_HEADER, writeBinarySTL } from './stl-writer';
import type { TriMesh } from './types';

/** Unit cube [0,1]^3, outward-facing triangles. */
function cube(size = 1): TriMesh {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v) => v * size));
  const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { positions, indices };
}

describe('mesh', () => {
  it('computes bounds, area and outward normals', () => {
    const m = cube(2);
    expect(countTriangles(m)).toBe(12);
    expect(computeBounds(m)).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
    expect(surfaceArea(m)).toBeCloseTo(24, 12);
    const faces = computeFaceNormals(m);
    expect(Array.from(faces.subarray(0, 3))).toEqual([0, 0, -1]); // bottom faces -Z
    // Corner (1,1,1) touches 2 triangles of the +X face, 1 of +Y, 2 of +Z: area-weighted (2,1,2)/3.
    const vertex = computeVertexNormals(m);
    [2 / 3, 1 / 3, 2 / 3].forEach((v, i) => expect(vertex[18 + i]).toBeCloseTo(v, 6));
    expect(() => computeBounds({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toThrow(XchangeError);
  });

  it('transformMesh copies every array and preserves area', () => {
    const m = { ...cube(), colors: new Uint8Array(24).fill(7) };
    const t = randomRigid(3);
    const moved = transformMesh(m, t);
    expect(moved.indices).not.toBe(m.indices);
    expect(moved.colors).not.toBe(m.colors);
    expect(Array.from(moved.colors!)).toEqual(Array.from(m.colors));
    expect(surfaceArea(moved)).toBeCloseTo(6, 5);
    const p = transformPoint(t, [1, 1, 1]);
    for (let i = 0; i < 3; i++) expect(moved.positions[18 + i]).toBeCloseTo(p[i]!, 4);
  });

  it('mergeMeshes offsets indices and keeps colors only when every mesh has them', () => {
    const a = cube(), b = { ...cube(), colors: new Uint8Array(24) };
    const merged = mergeMeshes([a, b]);
    expect(merged.positions.length).toBe(48);
    expect(merged.indices[36]).toBe(a.indices[0]! + 8);
    expect(merged.colors).toBeUndefined();
    expect(mergeMeshes([b, b]).colors?.length).toBe(48);
    expect(mergeMeshes([]).indices.length).toBe(0);
  });

  it('closestPointOnTriangle agrees with an independent reference on random queries', () => {
    const rng = createRng(12);
    const out = new Float64Array(3);
    for (let i = 0; i < 2000; i++) {
      const tri = Float32Array.from({ length: 9 }, () => rng() * 4 - 2);
      const p: [number, number, number] = [rng() * 6 - 3, rng() * 6 - 3, rng() * 6 - 3];
      const d2 = closestPointOnTriangle(tri, Uint32Array.of(0, 1, 2), 0, p[0], p[1], p[2], out);
      expect(d2).toBeCloseTo(referenceDistance2(tri, p), 9);
      expect((out[0]! - p[0]) ** 2 + (out[1]! - p[1]) ** 2 + (out[2]! - p[2]) ** 2).toBeCloseTo(d2, 9);
    }
  });

  it('closestPointOnTriangle handles degenerate triangles', () => {
    const line = Float32Array.of(0, 0, 0, 2, 0, 0, 1, 0, 0);
    expect(closestPointOnTriangle(line, Uint32Array.of(0, 1, 2), 0, 1, 1, 0)).toBeCloseTo(1, 12);
    const dot = Float32Array.of(1, 1, 1, 1, 1, 1, 1, 1, 1);
    expect(closestPointOnTriangle(dot, Uint32Array.of(0, 1, 2), 0, 1, 1, 3)).toBeCloseTo(4, 12);
  });
});

/** Reference: plane projection when inside, else the best of the three edges. */
function referenceDistance2(t: Float32Array, p: [number, number, number]): number {
  const v = (i: number): [number, number, number] => [t[3 * i]!, t[3 * i + 1]!, t[3 * i + 2]!];
  const [a, b, c] = [v(0), v(1), v(2)];
  const sub = (x: number[], y: number[]): [number, number, number] => [x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!];
  const dotp = (x: number[], y: number[]): number => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  const crossp = (x: number[], y: number[]): [number, number, number] => [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  const segment = (s: number[], e: number[]): number => {
    const u = sub(e, s);
    const k = Math.min(1, Math.max(0, dotp(sub(p, s), u) / dotp(u, u)));
    const q = [s[0]! + k * u[0], s[1]! + k * u[1], s[2]! + k * u[2]];
    return dotp(sub(p, q), sub(p, q));
  };
  let best = Math.min(segment(a, b), segment(b, c), segment(c, a));
  const n = crossp(sub(b, a), sub(c, a));
  const nn = dotp(n, n);
  const dist = dotp(sub(p, a), n) / nn;
  const q = [p[0] - dist * n[0], p[1] - dist * n[1], p[2] - dist * n[2]];
  const inside = [crossp(sub(b, a), sub(q, a)), crossp(sub(c, b), sub(q, b)), crossp(sub(a, c), sub(q, c))].every((e) => dotp(e, n) >= 0);
  if (inside) best = Math.min(best, dist * dist * nn);
  return best;
}

describe('sampling', () => {
  it('createRng is deterministic and gaussian is standard normal', () => {
    const a = createRng(42), b = createRng(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
    const g = createRng(1);
    const xs = Array.from({ length: 20000 }, () => gaussian(g));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it('sampleSurface is deterministic, on the surface and proportional to area', () => {
    // Two triangles in z = 0 with areas 1 : 3, plus a zero-area one that must never be hit.
    const mesh: TriMesh = {
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 2, 0, 10, 0, 0, 13, 0, 0, 10, 2, 0, 5, 5, 0),
      indices: Uint32Array.of(0, 1, 2, 6, 6, 6, 3, 4, 5),
    };
    const s = sampleSurface(mesh, 4000, 9);
    expect(Array.from(sampleSurface(mesh, 4000, 9).points)).toEqual(Array.from(s.points));
    let big = 0;
    for (let i = 0; i < 4000; i++) {
      expect(s.points[3 * i + 2]).toBe(0);
      expect(s.normals[3 * i + 2]).toBe(1);
      expect(s.triangles[i]).not.toBe(1);
      if (s.triangles[i] === 2) {
        big++;
        expect(s.points[3 * i]!).toBeGreaterThanOrEqual(10);
      }
    }
    expect(big).toBe(3000); // stratified: exact proportions
    let prefixBig = 0;
    for (let i = 0; i < 400; i++) if (s.triangles[i] === 2) prefixBig++;
    expect(prefixBig).toBeGreaterThan(250); // shuffled: a prefix is still representative
    expect(prefixBig).toBeLessThan(350);
    expect(() => sampleSurface({ positions: new Float32Array(9), indices: Uint32Array.of(0, 1, 2) }, 10)).toThrow(XchangeError);
  });

  it('samples of a scan body lie on it', () => {
    const body = makeScanBody({ flat: false, chamfer: 0 });
    const s = sampleSurface(body, 500, 2);
    for (let i = 0; i < 500; i++) {
      const r = Math.hypot(s.points[3 * i]!, s.points[3 * i + 1]!);
      const z = s.points[3 * i + 2]!;
      const onCap = Math.abs(z) < 1e-6 || Math.abs(z - 6.6) < 1e-6;
      expect(onCap || Math.abs(r - 2.5) < 0.03).toBe(true); // chord sag of a 48-gon is ~5 µm·r
    }
  });
});

describe('writeBinarySTL', () => {
  it('writes the header, count, recomputed normals and vertices', () => {
    const m = transformMesh(cube(), fromAxisAngle([0, 0, 1], 0.3));
    const bytes = writeBinarySTL(m);
    expect(bytes.length).toBe(84 + 50 * 12);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.subarray(0, STL_HEADER.length))).toBe(STL_HEADER);
    expect(view.getUint32(80, true)).toBe(12);
    const normals = computeFaceNormals(m);
    for (let t = 0; t < 12; t++) {
      const o = 84 + 50 * t;
      for (let k = 0; k < 3; k++) expect(view.getFloat32(o + 4 * k, true)).toBeCloseTo(normals[3 * t + k]!, 6);
      for (let c = 0; c < 3; c++) {
        const v = m.indices[3 * t + c]!;
        for (let k = 0; k < 3; k++) expect(view.getFloat32(o + 12 + 12 * c + 4 * k, true)).toBe(m.positions[3 * v + k]);
      }
      expect(view.getUint16(o + 48, true)).toBe(0);
    }
  });

  it('concatenates several meshes and refuses an ASCII-looking header', () => {
    const bytes = writeBinarySTL([cube(), cube(2)]);
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(24);
    expect(() => writeBinarySTL(cube(), 'solid trick')).toThrow(XchangeError);
    expect(() => writeBinarySTL(cube(), 'x'.repeat(81))).toThrow(XchangeError);
  });
});
