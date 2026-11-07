import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/sampling';
import { parseDecimal, parseInteger, TriangleSink } from './common';
import { encode, triangleAreasAlong } from './test-helpers';

const dec = (s: string): number => {
  const b = encode(s);
  return parseDecimal(b, 0, b.length);
};

describe('parseDecimal', () => {
  it('equals Number() up to 15 significant digits and gives the same float32 beyond', () => {
    const rng = createRng(3);
    const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(rng() * 10)).join('');
    const samples = ['0', '-0', '+1', '.5', '5.', '0.000123', '123.456e2', '1E5', '1e22', '1e23', '1e-22', '1e-400', '9007199254740993', '0.1', '1'.repeat(45)];
    for (let i = 0; i < 4000; i++) {
      const sign = ['', '-', '+'][Math.floor(rng() * 3)]!;
      const int = digits(Math.floor(rng() * 20));
      const frac = rng() < 0.7 ? '.' + digits(Math.floor(rng() * 20)) : '';
      const exp = rng() < 0.4 ? (rng() < 0.5 ? 'e' : 'E') + ['', '-', '+'][Math.floor(rng() * 3)] + Math.floor(rng() * 40) : '';
      if (int + frac.slice(1) !== '') samples.push(sign + int + frac + exp);
      const f = Math.fround((rng() - 0.5) * 10 ** Math.floor(rng() * 8));
      samples.push(String(f), f.toExponential(6), f.toFixed(6));
    }
    let exact = 0;
    for (const s of samples) {
      const significant = s.replace(/[eE].*$/, '').replace(/\D/g, '').replace(/^0+/, '').length;
      if (significant <= 15) {
        expect(Object.is(dec(s), Number(s)), s).toBe(true);
        exact++;
      }
      expect(Object.is(Math.fround(dec(s)), Math.fround(Number(s))), s).toBe(true);
    }
    expect(exact).toBeGreaterThan(5000);
  });

  it('returns NaN for anything that is not a plain decimal', () => {
    for (const s of ['', '+', '-', '.', 'e5', '1e', '1e+', '1.2.3', '0x10', '1,5', 'nan', 'inf', 'Infinity', '--1', '1_000', '1f', ' 1']) {
      expect(dec(s), s).toBeNaN();
    }
  });

  it('parseInteger accepts only [+-]digits', () => {
    const int = (s: string): number => parseInteger(encode(s), 0, s.length);
    expect([int('0'), int('-12'), int('+7'), int('007')]).toEqual([0, -12, 7, 7]);
    for (const s of ['', '-', '1.0', '1e3', '0x1', '1 ']) expect(int(s), s).toBeNaN();
  });
});

describe('TriangleSink.polygon', () => {
  it('ear-clips random star-shaped polygons into n-2 counter-clockwise triangles covering the area', () => {
    const rng = createRng(11);
    for (let trial = 0; trial < 300; trial++) {
      const n = 4 + Math.floor(rng() * 40);
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const theta = (2 * Math.PI * (i + 0.8 * rng())) / n;
        const r = 0.3 + 3 * rng();
        pts.push(r * Math.cos(theta), r * Math.sin(theta), 0);
      }
      const positions = Float32Array.from(pts);
      let area = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += (positions[3 * i]! * positions[3 * j + 1]! - positions[3 * j]! * positions[3 * i + 1]!) / 2;
      }
      const start = Math.floor(rng() * n); // any corner first
      const sink = new TriangleSink(n, 1e6);
      sink.polygon(Uint32Array.from({ length: n }, (_, i) => (i + start) % n), n, positions);
      const areas = triangleAreasAlong({ positions, indices: sink.result() }, [0, 0, 1]);
      expect(areas).toHaveLength(n - 2);
      for (const a of areas) expect(a).toBeGreaterThan(-1e-9);
      expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(area, 4);
    }
  });

  it('always terminates with n-2 triangles on self-intersecting outlines', () => {
    const rng = createRng(5);
    for (let trial = 0; trial < 300; trial++) {
      const n = 4 + Math.floor(rng() * 20);
      const positions = Float32Array.from({ length: 3 * n }, (_, k) => (k % 3 === 2 ? rng() * 0.01 : rng() * 10));
      const sink = new TriangleSink(n, 1e6);
      sink.polygon(Uint32Array.from({ length: n }, (_, i) => i), n, positions);
      expect(sink.count + sink.dropped).toBe(n - 2);
    }
  });
});
