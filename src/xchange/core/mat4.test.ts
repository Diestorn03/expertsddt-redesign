import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { randomRigid } from '../test/fixtures';
import { XchangeError } from './errors';
import * as M from './mat4';

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof XchangeError ? `${e.code}:${e.details.reason ?? ''}` : 'other';
  }
  return 'accepted';
};

describe('mat4', () => {
  it('is row-major: translation in m[3], m[7], m[11] and p\' = M·[p;1]', () => {
    const m = M.fromRowMajor([0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 30, 0, 0, 0, 1]); // 90° about Z, then translate
    expect(M.transformPoint(m, [1, 0, 0])).toEqual([10, 21, 30]);
    expect(M.transformDirection(m, [1, 0, 0])).toEqual([0, 1, 0]);
    expect(M.getColumn(m, 3)).toEqual([10, 20, 30]);
    expect(M.getColumn(m, 0)).toEqual([0, 1, 0]);
  });

  it('multiply(a, b) applies b first', () => {
    const rot = M.fromAxisAngle([0, 0, 1], Math.PI / 2);
    const move = M.fromTranslation([1, 0, 0]);
    const p = M.transformPoint(M.multiply(rot, move), [0, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 12);
    expect(p[1]).toBeCloseTo(1, 12);
  });

  it('inverseRigid undoes random rigid transforms', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const m = randomRigid(seed, Math.PI, 50);
      expect(M.maxAbsDiff(M.multiply(M.inverseRigid(m), m), M.identity())).toBeLessThan(1e-12);
      expect(M.maxAbsDiff(M.multiply(m, M.inverseRigid(m)), M.identity())).toBeLessThan(1e-12);
    }
  });

  it('validateRigid accepts rigid matrices, including scanner values rounded to 6 decimals', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rounded = Array.from(randomRigid(seed), (v) => Math.round(v * 1e6) / 1e6);
      expect(reasonOf(() => M.validateRigid(rounded))).toBe('accepted');
    }
    const m = randomRigid(3);
    expect(M.validateRigid(m)).toBe(m); // same object, never repaired
    expect(M.validateRigid(Array.from(m))).toBeInstanceOf(Float64Array);
  });

  it('validateRigid rejects scale, shear, reflection, bad last row, NaN and huge translations', () => {
    const base = Array.from(M.identity());
    const variant = (patch: Record<number, number>): number[] => base.map((v, i) => patch[i] ?? v);
    expect(reasonOf(() => M.validateRigid(variant({ 0: 1.01 })))).toBe('MATRIX_NOT_RIGID:notOrthonormal');
    expect(reasonOf(() => M.validateRigid(variant({ 1: 0.05 })))).toBe('MATRIX_NOT_RIGID:notOrthonormal');
    expect(reasonOf(() => M.validateRigid(variant({ 0: -1 })))).toBe('MATRIX_NOT_RIGID:reflection');
    expect(reasonOf(() => M.validateRigid(variant({ 12: 0.5 })))).toBe('MATRIX_NOT_RIGID:lastRow');
    expect(reasonOf(() => M.validateRigid(variant({ 15: 2 })))).toBe('MATRIX_NOT_RIGID:lastRow');
    expect(reasonOf(() => M.validateRigid(variant({ 3: 1e6 })))).toBe('MATRIX_NOT_RIGID:translationRange');
    expect(reasonOf(() => M.validateRigid(variant({ 5: Number.NaN })))).toBe('MATRIX_INVALID:nonFinite');
    expect(reasonOf(() => M.validateRigid(base.slice(0, 12)))).toBe('MATRIX_INVALID:length');
    expect(reasonOf(() => M.validateRigid(base, 0))).toBe('INVALID_ARGUMENT:tolerance');
    // A 1e-3 shear passes a loose tolerance but not the default one.
    expect(reasonOf(() => M.validateRigid(variant({ 1: 1e-3 })))).toBe('MATRIX_NOT_RIGID:notOrthonormal');
    expect(reasonOf(() => M.validateRigid(variant({ 1: 1e-3 }), 5e-3))).toBe('accepted');
  });

  it('quaternions round-trip, including 180° turns', () => {
    const cases = [M.identity(), M.fromAxisAngle([1, 0, 0], Math.PI), M.fromAxisAngle([0, 1, 1], Math.PI), M.fromAxisAngle([1, 2, 3], 3.1)];
    for (let seed = 1; seed <= 20; seed++) cases.push(randomRigid(seed));
    for (const m of cases) {
      const q = M.toQuaternion(m);
      expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 12);
      expect(q.w).toBeGreaterThanOrEqual(0);
      const back = M.compose(M.getColumn(m, 3), M.fromQuaternion(q));
      expect(M.maxAbsDiff(back, m)).toBeLessThan(1e-12);
    }
  });

  it('fromAxisAngle follows the right-hand rule and keeps the pivot fixed', () => {
    const m = M.fromAxisAngle([0, 0, 2], Math.PI / 2, [5, 5, 1]);
    const pivot = M.transformPoint(m, [5, 5, 1]);
    pivot.forEach((v, i) => expect(v).toBeCloseTo([5, 5, 1][i]!, 12));
    const p = M.transformPoint(m, [6, 5, 1]);
    expect(p[0]).toBeCloseTo(5, 12);
    expect(p[1]).toBeCloseTo(6, 12);
    expect(() => M.fromAxisAngle([0, 0, 0], 1)).toThrow(XchangeError);
  });

  it('rotationAngleBetween is precise for tiny and large angles and ignores translation', () => {
    const a = randomRigid(11);
    for (const angle of [1e-9, 1e-6, 0.01, 1, 3.1]) {
      const b = M.multiply(a, M.fromAxisAngle([0.3, -1, 2], angle, [4, 5, 6]));
      expect(Math.abs(M.rotationAngleBetween(a, b) - angle) / angle).toBeLessThan(1e-6);
    }
    expect(M.rotationAngleBetween(a, a)).toBe(0);
  });

  it('matches three.js: Matrix4.set takes row-major, elements are column-major', () => {
    const m = randomRigid(5);
    const three = new Matrix4().set(...(Array.from(m) as Parameters<Matrix4['set']>));
    expect(M.maxAbsDiff(M.fromColumnMajor(three.elements), m)).toBeLessThan(1e-12);
    const inv = new Matrix4().copy(three).invert();
    expect(M.maxAbsDiff(M.fromColumnMajor(inv.elements), M.inverseRigid(m))).toBeLessThan(1e-9);
  });

  it('compose and fromAxes build frames column by column', () => {
    const rot = M.fromAxisAngle([0, 0, 1], Math.PI / 2);
    const m = M.compose([1, 2, 3], rot);
    expect(M.getColumn(m, 3)).toEqual([1, 2, 3]);
    expect(M.maxAbsDiff(M.fromAxes(M.getColumn(m, 0), M.getColumn(m, 1), M.getColumn(m, 2), [1, 2, 3]), m)).toBe(0);
    expect(M.toRowMajorArray(m)).toHaveLength(16);
    expect(() => M.fromRowMajor([1, 2, 3])).toThrow(XchangeError);
  });
});
