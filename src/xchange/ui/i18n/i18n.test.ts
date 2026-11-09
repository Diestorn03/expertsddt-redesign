import { describe, expect, it } from 'vitest';
import { ERROR_CODES, WARNING_CODES } from '../../core/errors';
import en from './en';
import es from './es';
import { errorMessage, fmt, loc, plural, warningMessage } from './format';

type Leaf = [path: string, value: string];
const leaves = (o: unknown, p = ''): Leaf[] =>
  typeof o === 'string' ? [[p, o]] : Object.entries(o as object).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k));
const tokens = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

describe('tool copy', () => {
  const a = new Map(leaves(en)), b = new Map(leaves(es));
  it('EN and ES have the same keys', () => expect([...b.keys()]).toEqual([...a.keys()]));
  it('every string keeps its {token} set in both languages', () => {
    for (const [k, v] of a) expect(`${k}: ${tokens(b.get(k)!)}`).toBe(`${k}: ${tokens(v)}`);
  });
  it('long strings are translated (check-i18n rule)', () => {
    const same = [...a].filter(([k, v]) => v.length > 25 && b.get(k) === v && /[a-z]{4}/i.test(v.replace(/\{\w+\}/g, '')));
    expect(same.map(([k]) => k)).toEqual([]);
  });
  it('every engine code has text', () => {
    for (const code of ERROR_CODES) expect(en.errors[code].t.length).toBeGreaterThan(0);
    for (const code of WARNING_CODES) expect(es.warnings[code]).toBeTruthy();
  });
});

describe('format', () => {
  it('interpolates with locale numbers and plurals', () => {
    expect(fmt('es', '{n} triángulos', { n: 1248330 })).toBe('1.248.330 triángulos');
    expect(plural('en', en.s1.implantCount, 1)).toBe('1 implant');
    expect(plural('en', en.s1.implantCount, 4)).toBe('4 implants');
  });
  it('{loc} takes the first detail present and shows 0-based indices + 1', () => {
    expect(loc(en, 'en', { row: 3, triangle: 7 })).toBe(' (entry 3)');
    expect(loc(en, 'en', { triangle: 0 })).toBe(' (triangle 1)');
    expect(loc(en, 'en', {})).toBe('');
  });
  it('reason rows override the code row, unknown reasons fall back', () => {
    const m = errorMessage(en, 'en', { code: 'FORMAT_UNSUPPORTED', details: { reason: 'spreadsheet' } }, { file: { n: 2, total: 3 } });
    expect(m.title).toBe('File 2 of 3: Excel file.');
    expect(m.code).toBe('Code: FORMAT_UNSUPPORTED · spreadsheet');
    expect(errorMessage(en, 'en', { code: 'FORMAT_UNSUPPORTED', details: { reason: 'zzz' } }).title).toBe('Variant not supported.');
  });
  it('sizes in MB with one decimal, purpose from details', () => {
    const m = errorMessage(es, 'es', { code: 'FILE_TOO_LARGE', details: { bytes: 160 * 1048576, limitBytes: 150 * 1048576, purpose: 'jaw' } });
    expect(m.body).toContain('160,0 MB');
    expect(m.body).toContain('150,0 MB');
    expect(m.body).toContain('un escaneo de la arcada');
  });
  it('warnings render their numbers', () => {
    expect(warningMessage(en, 'en', { code: 'MESH_LARGE', details: { triangles: 2000000 } })).toContain('2,000,000');
    expect(warningMessage(en, 'en', { code: 'SITE_PROVISIONAL', details: { count: 2 } })).toMatch(/^2 positions/);
  });
});
