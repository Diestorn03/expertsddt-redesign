import { describe, expect, it } from 'vitest';
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { compose, fromAxisAngle, fromTranslation, identity, inverseRigid, maxAbsDiff, multiply } from '../core/mat4';
import { countTriangles } from '../core/mesh';
import { createRng } from '../core/sampling';
import { writeBinarySTL } from '../core/stl-writer';
import type { AlignmentResult, ExportRequest, Mat4, ReplacementGeometry, Vec3 } from '../core/types';
import { makeRevolutionBody, makeScanBody, makeSyntheticCase, randomRigid } from '../test/fixtures';
import { encodePLY } from '../test/fixtures/encoders';
import { buildBundle, safeFilename } from './bundle';
import { placeReplacements } from './placement';
import { crc32, entryViews, zipStore, zipStoreSize } from './zip';

// ---------- independent helpers (nothing here reuses the code under test) ----------

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const hex = (n: number): string => n.toString(16).padStart(8, '0');
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Bit-by-bit CRC-32, independent of the table version under test. */
function referenceCrc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  crc: number;
  data: Uint8Array;
}

/** Tiny ZIP reader: checks every header field the writer promises, CRCs, and that no byte is unaccounted for. */
function readZip(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);
  const end = zip.length - 22;
  expect(u32(end)).toBe(0x06054b50);
  const count = u16(end + 10), centralSize = u32(end + 12), centralStart = u32(end + 16);
  expect([u16(end + 4), u16(end + 6), u16(end + 8), u16(end + 20)]).toEqual([0, 0, count, 0]); // one disk, no comment
  expect(centralStart + centralSize).toBe(end);
  const entries: ZipEntry[] = [];
  let c = centralStart, nextLocal = 0;
  for (let i = 0; i < count; i++) {
    expect(u32(c)).toBe(0x02014b50);
    // made by 2.0, needs 2.0, UTF-8 flag, stored, 00:00, 1980-01-01
    expect([u16(c + 4), u16(c + 6), u16(c + 8), u16(c + 10), u16(c + 12), u16(c + 14)]).toEqual([20, 20, 0x0800, 0, 0, 0x21]);
    const crc = u32(c + 16), size = u32(c + 20), nameLength = u16(c + 28);
    expect(u32(c + 24)).toBe(size);
    expect([u16(c + 30), u16(c + 32), u16(c + 34), u16(c + 36), u32(c + 38)]).toEqual([0, 0, 0, 0, 0]);
    const local = u32(c + 42);
    expect(local).toBe(nextLocal); // contiguous, in central-directory order
    expect(u32(local)).toBe(0x04034b50);
    expect(same(zip.subarray(local + 4, local + 30), zip.subarray(c + 6, c + 32))).toBe(true); // same fields as central
    const name = zip.subarray(c + 46, c + 46 + nameLength);
    expect(same(zip.subarray(local + 30, local + 30 + nameLength), name)).toBe(true);
    const data = zip.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    expect(referenceCrc(data)).toBe(crc);
    entries.push({ name: new TextDecoder('utf-8', { fatal: true }).decode(name), crc, data });
    nextLocal = local + 30 + nameLength + size;
    c += 46 + nameLength;
  }
  expect(nextLocal).toBe(centralStart);
  expect(c).toBe(end);
  return entries;
}

/** Vertices of a binary STL, 9 floats per triangle. */
function stlVertices(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  expect(bytes.length).toBe(84 + 50 * count);
  const out = new Float32Array(9 * count);
  for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) out[9 * t + k] = view.getFloat32(84 + 50 * t + 12 + 4 * k, true);
  return out;
}

/** p' = m·p in float64, written out (independent of core/mat4). */
const apply = (m: Mat4, p: Readonly<Vec3>): Vec3 => {
  const row = (r: number): number => m[4 * r]! * p[0] + m[4 * r + 1]! * p[1] + m[4 * r + 2]! * p[2] + m[4 * r + 3]!;
  return [row(0), row(1), row(2)];
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function thrown(fn: () => unknown): XchangeError {
  try {
    fn();
  } catch (error) {
    if (error instanceof XchangeError) return error;
    throw error;
  }
  throw new Error('expected an XchangeError');
}

/** Stand-in that answers only `.length`: reading data from it (or copying it) fails the test. */
function lengthOnly<T>(length: number): T {
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'length') return length;
        throw new Error(`length-only stub: read ${String(key)}`);
      },
    },
  ) as unknown as T;
}

const CREATED = '2026-11-07T12:00:00.000Z';

function caseRequest(withJaw: boolean) {
  const c = makeSyntheticCase({ implants: 3, seed: 5 });
  const cap: ReplacementGeometry = {
    id: 'geo-cap',
    name: 'Cap 5 mm',
    mesh: makeRevolutionBody({ radius: 2, height: 5, segments: 16, heightSegments: 1 }),
  };
  const post: ReplacementGeometry = { id: 'geo-post', name: 'Post', mesh: makeScanBody({ segments: 12, heightSegments: 1 }) };
  const alignment: AlignmentResult = {
    transform: Float64Array.from(c.captureToJaw),
    method: 'auto',
    rmsMm: 0.012,
    p95Mm: 0.02,
    coverage: 0.99,
    visible: 0.9,
    toleranceMm: 0.1,
    perSite: c.sites.map((s) => ({ siteId: s.id, rmsMm: 0.011, coverage: 0.98, visible: 0.9, samples: 400 })),
    status: 'good',
    flags: ['visualCheckRequired'],
  };
  // A PLY original: exporting it byte for byte proves it is never re-encoded.
  const originalBytes = encodePLY(c.jaw, 'binary_little_endian');
  const request: ExportRequest = {
    arch: 'lower',
    captureFormat: 'demo',
    sites: c.sites,
    geometryBySite: { 'site-1': cap, 'site-2': post, 'site-3': cap },
    assemblyTransform: withJaw ? c.captureToJaw : identity(),
    ...(withJaw ? { jaw: { mesh: c.jaw, originalBytes, format: 'ply' as const }, alignment } : {}),
    createdAt: CREATED,
    appVersion: '0.1.0',
  };
  return { c, cap, post, request };
}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const entry = (entries: readonly ZipEntry[], name: string): Uint8Array => entries.find((e) => e.name === name)!.data;

// ---------- zip.ts ----------

describe('crc32', () => {
  it('matches the standard check values and continues across chunks', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    const rng = createRng(3);
    const data = Uint8Array.from({ length: 4096 }, () => Math.floor(rng() * 256));
    expect(crc32(data)).toBe(referenceCrc(data));
    expect(crc32(data.subarray(1000), crc32(data.subarray(0, 1000)))).toBe(crc32(data));
  });
});

describe('zipStore', () => {
  it('writes an archive an independent reader accepts, field by field', () => {
    const rng = createRng(11);
    const files = [
      { name: 'a.txt', bytes: ascii('hello') },
      { name: 'ñandú ü.bin', bytes: Uint8Array.from({ length: 1000 }, () => Math.floor(rng() * 256)) },
      { name: 'empty.bin', bytes: new Uint8Array(0) },
    ];
    const zip = zipStore(files);
    expect(zip.length).toBe(zipStoreSize(files.map((f) => ({ name: f.name, size: f.bytes.length }))));
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((e, i) => expect(same(e.data, files[i]!.bytes)).toBe(true));
    entryViews(zip, files).forEach((v, i) => {
      expect(v.bytes.buffer).toBe(zip.buffer);
      expect(same(v.bytes, files[i]!.bytes)).toBe(true);
    });
    expect(Array.from(zipStore([]))).toEqual([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);
    expect(readZip(zipStore([]))).toEqual([]);
  });

  it('refuses unsafe, oversized and duplicate names (index of the bad entry)', () => {
    const none = new Uint8Array(0);
    const bad = ['', 'a/b', 'a\\b', 'c:x', '..', 'a..b', 'tab\tname', 'del\u007f', 'x.', 'x ', 'CON', 'con.txt', 'lpt9.stl',
      'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'x'.repeat(256), 'é'.repeat(128), '\ud800x'];
    for (const name of bad) {
      expect(thrown(() => zipStore([{ name: 'ok.txt', bytes: none }, { name, bytes: none }]))).toMatchObject({
        code: 'EXPORT_NAME_INVALID',
        details: { index: 1 },
      });
    }
    for (const [first, second] of [['A.txt', 'a.TXT'], ['caf\u00e9.txt', 'cafe\u0301.txt']] as const) {
      expect(thrown(() => zipStore([{ name: first, bytes: none }, { name: second, bytes: none }]))).toMatchObject({
        code: 'EXPORT_NAME_INVALID',
        details: { index: 1 },
      });
    }
    expect(() => zipStore([{ name: 'x'.repeat(255), bytes: none }, { name: 'é'.repeat(127), bytes: none }])).not.toThrow();
  });

  it('refuses an oversize archive or too many entries before allocating', () => {
    const max = LIMITS.bundle.maxBytes;
    expect(thrown(() => zipStore([{ name: 'big.bin', bytes: lengthOnly<Uint8Array>(max) }]))).toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      details: { limitBytes: max, bytes: max + 30 + 46 + 2 * 7 + 22 },
    });
    const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, size: 0 }));
    expect(zipStoreSize(names(0xfffe))).toBeGreaterThan(0);
    expect(thrown(() => zipStoreSize(names(0xffff)))).toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      details: { reason: 'entries', limit: 0xfffe, count: 0xffff },
    });
  });
});

describe('safeFilename', () => {
  it('keeps safe labels and neutralises hostile ones', () => {
    expect(safeFilename('AXO1', 'f')).toBe('AXO1');
    expect(safeFilename('Implant 1', 'f')).toBe('Implant_1');
    expect(safeFilename('../x', 'f')).toBe('x');
    expect(safeFilename('ä/ö', 'f')).toBe('a_o');
    expect(safeFilename('ＡＢＣ①', 'f')).toBe('ABC1'); // NFKD folds full-width letters and circled digits
    expect(safeFilename('CON', 'f')).toBe('_CON');
    expect(safeFilename('con.txt', 'f')).toBe('_con.txt');
    expect(safeFilename('Lpt9', 'f')).toBe('_Lpt9');
    expect(safeFilename('CONSOLE', 'f')).toBe('CONSOLE');
    expect(safeFilename(`CON_${'-'.repeat(70)}X`, 'f')).toBe('_CON'); // truncation cannot bring a device name back
    expect(safeFilename('a'.repeat(100), 'f')).toBe('a'.repeat(64));
    for (const empty of ['', '...', '上颌', ' /\\ ']) expect(safeFilename(empty, 'implant_3')).toBe('implant_3');
    expect(thrown(() => safeFilename('', '//'))).toMatchObject({ code: 'INVALID_ARGUMENT', details: { reason: 'fallback' } });
  });
});

// ---------- placement.ts ----------

describe('placeReplacements', () => {
  const triangle: ReplacementGeometry = {
    id: 'tri',
    name: 'Triangle',
    mesh: { positions: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), indices: Uint32Array.of(0, 1, 2) },
  };
  const site = (matrix: Mat4, id = 'site-1') => ({ id, label: id, matrix, source: 'demo' as const, flags: {} });

  it('applies assembly · site to the geometry: analytic case', () => {
    // site: 90° about X, then +5 Y: (x, y, z) -> (x, 5 - z, y). assembly: 90° about Z, then +10 X: (x, y, z) -> (10 - y, x, z).
    const siteMatrix = compose([0, 5, 0], fromAxisAngle([1, 0, 0], Math.PI / 2));
    const assembly = compose([10, 0, 0], fromAxisAngle([0, 0, 1], Math.PI / 2));
    const [placed] = placeReplacements([site(siteMatrix)], { 'site-1': triangle }, assembly);
    const expected = [5, 1, 0, 5, 0, 1, 6, 0, 0]; // (x, y, z) -> (5 + z, x, y)
    placed!.mesh.positions.forEach((v, i) => expect(Math.abs(v - expected[i]!)).toBeLessThan(1e-12));
    expect(placed).toMatchObject({ siteId: 'site-1', label: 'site-1', geometryId: 'tri', geometryName: 'Triangle' });
    expect(maxAbsDiff(placed!.matrix, multiply(assembly, siteMatrix))).toBe(0);
    expect(Array.from(triangle.mesh.positions)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]); // input untouched
    expect(placed!.mesh.indices.buffer).not.toBe(triangle.mesh.indices.buffer);
  });

  it('rounds to float32 once, from float64 (random rigid motions)', () => {
    const body: ReplacementGeometry = { id: 'b', name: 'Body', mesh: makeScanBody({ segments: 16, heightSegments: 2 }) };
    for (let seed = 1; seed <= 5; seed++) {
      const assembly = randomRigid(seed, Math.PI, 30), siteMatrix = randomRigid(seed + 10, Math.PI, 30);
      const [placed] = placeReplacements([site(siteMatrix)], { 'site-1': body }, assembly);
      const p = body.mesh.positions, out = placed!.mesh.positions;
      for (let v = 0; v < p.length; v += 3) {
        const e = apply(assembly, apply(siteMatrix, [p[v]!, p[v + 1]!, p[v + 2]!]));
        // A single correct rounding is within half a float32 ulp (relative 2^-24); two would not be.
        for (let k = 0; k < 3; k++) expect(Math.abs(out[v + k]! - e[k]!)).toBeLessThanOrEqual(Math.abs(e[k]!) * 2 ** -24 + 1e-13);
      }
    }
  });

  it('reports the failing site index', () => {
    const geometries = { 'site-1': triangle, 'site-2': triangle, 'site-3': triangle };
    const ok = identity();
    expect(thrown(() => placeReplacements([site(ok), site(ok, 'site-9')], geometries, ok))).toMatchObject({
      code: 'EXPORT_GEOMETRY_MISSING',
      details: { site: 1 },
    });
    expect(thrown(() => placeReplacements([site(ok, 'constructor')], {}, ok))).toMatchObject({
      code: 'EXPORT_GEOMETRY_MISSING',
      details: { site: 0 },
    });
    const scaled = identity();
    scaled[0] = 2;
    expect(thrown(() => placeReplacements([site(ok)], geometries, scaled))).toMatchObject({ code: 'MATRIX_NOT_RIGID' });
    expect(thrown(() => placeReplacements([site(ok)], geometries, scaled)).details).not.toHaveProperty('site');
    const nan = identity();
    nan[3] = Number.NaN;
    const mirror = identity();
    mirror[0] = -1;
    expect(thrown(() => placeReplacements([site(ok), site(nan, 'site-2')], geometries, ok))).toMatchObject({
      code: 'MATRIX_INVALID',
      details: { site: 1 },
    });
    expect(thrown(() => placeReplacements([site(ok), site(ok, 'site-2'), site(mirror, 'site-3')], geometries, ok))).toMatchObject({
      code: 'MATRIX_NOT_RIGID',
      details: { reason: 'reflection', site: 2 },
    });
  });
});

// ---------- bundle.ts + report.ts ----------

describe('buildBundle', () => {
  it('writes the contract entries in order, readable by an independent reader, jaw bytes unchanged', async () => {
    const { c, request } = caseRequest(true);
    const jawPositions = Float32Array.from(c.jaw.positions);
    const bundle = buildBundle(request);
    expect(bundle.zipName).toBe('DDT-Xchange_lower_export.zip');
    const entries = readZip(bundle.zip);
    const names = ['combined.stl', 'replacements.stl', 'replacement_S1.stl', 'replacement_S2.stl', 'replacement_S3.stl',
      'jaw.ply', 'report.json', 'README.txt'];
    expect(entries.map((e) => e.name)).toEqual(names);
    expect(bundle.files.map((f) => f.name)).toEqual(names);
    bundle.files.forEach((f, i) => {
      expect(f.bytes.buffer).toBe(bundle.zip.buffer); // views: one copy of the data
      expect(same(f.bytes, entries[i]!.data)).toBe(true);
    });
    const jaw = request.jaw!;
    expect(await sha256(entry(entries, 'jaw.ply'))).toBe(await sha256(jaw.originalBytes));
    expect(bundle.files[5]!.bytes.buffer).not.toBe(jaw.originalBytes.buffer);
    expect(c.jaw.positions).toEqual(jawPositions); // inputs untouched
    expect(same(buildBundle(request).zip, bundle.zip)).toBe(true); // deterministic
  });

  it('combined = jaw (re-serialised) + replacements = jaw + every per-site file; vertices are T · frame · geometry', () => {
    const { c, cap, post, request } = caseRequest(true);
    const entries = readZip(buildBundle(request).zip);
    const body = (bytes: Uint8Array): Uint8Array => bytes.subarray(84);
    const perSite = ['replacement_S1.stl', 'replacement_S2.stl', 'replacement_S3.stl'].map((n) => entry(entries, n));
    expect(same(body(entry(entries, 'replacements.stl')), concat(perSite.map(body)))).toBe(true);
    expect(same(body(entry(entries, 'combined.stl')), concat([body(writeBinarySTL(c.jaw)), body(entry(entries, 'replacements.stl'))]))).toBe(true);
    expect(stlVertices(entry(entries, 'combined.stl')).length / 9).toBe(
      countTriangles(c.jaw) + 2 * countTriangles(cap.mesh) + countTriangles(post.mesh),
    );
    [cap, post, cap].forEach((geometry, s) => {
      const got = stlVertices(perSite[s]!), p = geometry.mesh.positions, idx = geometry.mesh.indices;
      expect(got.length).toBe(3 * idx.length);
      for (let i = 0; i < idx.length; i++) {
        const v = 3 * idx[i]!;
        const e = apply(c.captureToJaw, apply(c.frames[s]!, [p[v]!, p[v + 1]!, p[v + 2]!]));
        for (let k = 0; k < 3; k++) expect(Math.abs(got[3 * i + k]! - e[k]!)).toBeLessThan(1e-5);
      }
    });
  });

  it('report.json has exactly the v1 schema and describes the bundle', () => {
    const { c, request } = caseRequest(true);
    const bundle = buildBundle(request);
    const entries = readZip(bundle.zip);
    const report = JSON.parse(decode(entry(entries, 'report.json'))) as typeof bundle.report;
    expect(report).toEqual(bundle.report);
    expect(Object.keys(report)).toEqual(['schema', 'schemaVersion', 'application', 'appVersion', 'createdAt', 'units',
      'matrixConvention', 'implantFrame', 'arch', 'coordinateFrame', 'captureToOutput', 'capture', 'alignment', 'sites',
      'jaw', 'files', 'notes']);
    expect(Object.keys(report.capture)).toEqual(['format', 'siteCount']);
    expect(Object.keys(report.alignment!)).toEqual(['method', 'status', 'rmsMm', 'p95Mm', 'coverage', 'visible', 'toleranceMm', 'flags',
      'matchesExport', 'perSite']);
    expect(Object.keys(report.alignment!.perSite[0]!)).toEqual(['siteId', 'label', 'rmsMm', 'coverage', 'visible', 'samples']);
    expect(Object.keys(report.sites[0]!)).toEqual(['id', 'label', 'source', 'indexAmbiguous', 'provisional',
      'implantToCapture', 'implantToOutput', 'geometry', 'file']);
    expect(Object.keys(report.sites[0]!.geometry)).toEqual(['id', 'name']);
    expect(Object.keys(report.jaw!)).toEqual(['file', 'format', 'preservation', 'bytes', 'crc32', 'triangles']);
    expect(Object.keys(report.files[0]!)).toEqual(['name', 'bytes', 'crc32']);

    expect(report).toMatchObject({
      schema: 'ddt-xchange-report',
      schemaVersion: 1,
      application: 'DDT Xchange',
      appVersion: '0.1.0',
      createdAt: CREATED,
      units: 'mm',
      arch: 'lower',
      coordinateFrame: 'jaw',
      captureToOutput: Array.from(c.captureToJaw),
      capture: { format: 'demo', siteCount: 3 },
      alignment: { method: 'auto', status: 'good', rmsMm: 0.012, matchesExport: true, flags: ['visualCheckRequired'] },
    });
    expect(report.alignment!.perSite.map((s) => s.label)).toEqual(['S1', 'S2', 'S3']);
    expect(report.sites.map((s) => [s.id, s.label, s.file, s.geometry.id])).toEqual([
      ['site-1', 'S1', 'replacement_S1.stl', 'geo-cap'],
      ['site-2', 'S2', 'replacement_S2.stl', 'geo-post'],
      ['site-3', 'S3', 'replacement_S3.stl', 'geo-cap'],
    ]);
    report.sites.forEach((s, i) => {
      expect(s.implantToCapture).toEqual(Array.from(c.frames[i]!));
      expect(maxAbsDiff(s.implantToOutput, multiply(c.captureToJaw, c.frames[i]!))).toBeLessThan(1e-12);
    });
    const jawBytes = request.jaw!.originalBytes;
    expect(report.jaw).toEqual({ file: 'jaw.ply', format: 'ply', preservation: 'exact-original-bytes', bytes: jawBytes.length,
      crc32: hex(referenceCrc(jawBytes)), triangles: countTriangles(c.jaw) });
    expect(report.files).toEqual(entries.slice(0, 6).map((e) => ({ name: e.name, bytes: e.data.length, crc32: hex(e.crc) })));
    expect(report.notes).toHaveLength(3); // shells, visual check, not clinical: no conditional note applies
    expect(report.notes.join(' ')).toMatch(/Boolean.*visually.*not a clinical validation/);
  });

  it('sets coordinateFrame correctly: jaw, capture (also with float noise), capture-adjusted', () => {
    const withJaw = caseRequest(true).request;
    expect(buildBundle({ ...withJaw, assemblyTransform: identity(), alignment: undefined }).report.coordinateFrame).toBe('jaw');
    const noJaw = caseRequest(false).request;
    const plain = buildBundle(noJaw);
    expect(plain.report).toMatchObject({ coordinateFrame: 'capture', jaw: null, alignment: null });
    expect(plain.files.map((f) => f.name)).not.toContain('jaw.stl');
    expect(same(plain.files[0]!.bytes, plain.files[1]!.bytes)).toBe(true); // no jaw: combined = replacements
    const r = randomRigid(3);
    expect(buildBundle({ ...noJaw, assemblyTransform: multiply(r, inverseRigid(r)) }).report.coordinateFrame).toBe('capture');
    const moved = buildBundle({ ...noJaw, assemblyTransform: r });
    expect(moved.report.coordinateFrame).toBe('capture-adjusted');
    expect(moved.report.captureToOutput).toEqual(Array.from(r));
    expect(moved.report.notes.some((n) => n.includes('manual adjustment'))).toBe(true);
    expect(decode(entry(readZip(moved.zip), 'README.txt'))).toContain('Capture coordinates moved by the manual adjustment');
  });

  it('flags a pose moved after alignment, index ambiguity and provisional frames', () => {
    const { c, request } = caseRequest(true);
    const sites = request.sites.map((s, i) => (i === 1 ? { ...s, flags: { indexAmbiguous: true, provisional: true } } : s));
    const bundle = buildBundle({ ...request, sites, assemblyTransform: multiply(fromTranslation([0.05, 0, 0]), c.captureToJaw) });
    const { report } = bundle;
    expect(report.alignment!.matchesExport).toBe(false);
    expect(report.sites.map((s) => [s.indexAmbiguous, s.provisional])).toEqual([[false, false], [true, true], [false, false]]);
    expect(report.notes).toHaveLength(6);
    const readme = decode(entry(readZip(bundle.zip), 'README.txt'));
    for (const text of ['índice ambiguo', 'ambiguous index', 'es provisional', 'is provisional', 'no es la de esta alineación',
      "not this alignment's pose"]) {
      expect(readme).toContain(text);
    }
  });

  it('README.txt is Spanish then English, CRLF, with a UTF-8 BOM, and lists every file', () => {
    const bundle = buildBundle(caseRequest(true).request);
    const bytes = entry(readZip(bundle.zip), 'README.txt');
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = decode(bytes); // TextDecoder drops the BOM
    expect(text).not.toMatch(/[^\r]\n|\r[^\n]/);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.startsWith('DDT Xchange: exportación de la arcada inferior\r\n')).toBe(true);
    const english = text.indexOf('DDT Xchange: lower arch export\r\n');
    expect(english).toBeGreaterThan(text.indexOf('Privacidad'));
    for (const half of [text.slice(0, english), text.slice(english)]) {
      for (const name of ['combined.stl', 'replacements.stl', 'replacement_S1.stl', 'replacement_S3.stl', 'jaw.ply', 'report.json']) {
        expect(half).toContain(name);
      }
    }
    expect(text).toContain('RMS 0,012 mm'); // Spanish decimal comma
    expect(text).toContain('RMS 0.012 mm');
    expect(text).toContain('no es una validación clínica');
    expect(text).toContain('not a clinical or manufacturing validation');
  });

  it('never lets a name the caller attached to its objects reach the bundle', () => {
    const SECRET = 'Paciente Secreto';
    const { request } = caseRequest(true);
    // A sloppy caller in the prototype's style: file names hung on every object it passes.
    const poisoned: ExportRequest = Object.assign({}, request, {
      fileName: `${SECRET}~Upper.stl`,
      inputFiles: [`${SECRET}.csv`],
      sites: request.sites.map((s) => Object.assign({}, s, { name: SECRET, fileName: `${SECRET}.csv` })),
      geometryBySite: Object.fromEntries(
        Object.entries(request.geometryBySite).map(([id, g]) => [id, Object.assign({}, g, { fileName: `${SECRET}.stl` })]),
      ),
      jaw: Object.assign({}, request.jaw!, { name: `${SECRET}.ply`, originalFile: SECRET }),
      alignment: Object.assign({}, request.alignment!, { inputFiles: [SECRET] }),
    });
    const bundle = buildBundle(poisoned);
    expect(new TextDecoder('latin1').decode(bundle.zip)).not.toContain(SECRET); // report, README, names, data
    expect(JSON.stringify(bundle.report)).not.toContain(SECRET);
  });

  it('turns duplicate and hostile labels into safe, unique entry names', () => {
    const { c, cap, request } = caseRequest(false);
    const labels = ['../x', 'CON', 'ä/ö', 'a_o', 'A_O', 'x', '', '上颌'];
    const sites = labels.map((label, i) => ({ ...c.sites[0]!, id: `site-${i + 1}`, label, matrix: c.frames[i % 3]! }));
    const bundle = buildBundle({ ...request, sites, geometryBySite: Object.fromEntries(sites.map((s) => [s.id, cap])) });
    const expected = ['replacement_x.stl', 'replacement__CON.stl', 'replacement_a_o.stl', 'replacement_a_o_2.stl',
      'replacement_A_O_3.stl', 'replacement_x_2.stl', 'replacement_implant_7.stl', 'replacement_implant_8.stl'];
    expect(readZip(bundle.zip).map((e) => e.name)).toEqual(['combined.stl', 'replacements.stl', ...expected, 'report.json', 'README.txt']);
    expect(bundle.report.sites.map((s) => s.file)).toEqual(expected);
  });

  it('refuses an oversize bundle from counts alone, before reading or allocating mesh data', () => {
    const { request } = caseRequest(true);
    const huge: ReplacementGeometry = {
      id: 'huge',
      name: 'Huge',
      mesh: { positions: lengthOnly<Float32Array>(3 * 2_000_000), indices: lengthOnly<Uint32Array>(3 * 4_000_000) },
    };
    const error = thrown(() => buildBundle({ ...request, geometryBySite: { ...request.geometryBySite, 'site-2': huge } }));
    expect(error.code).toBe('EXPORT_TOO_LARGE');
    expect(error.details.limitBytes).toBe(LIMITS.bundle.maxBytes);
    expect(error.details.bytes).toBeGreaterThan(3 * 50 * 4_000_000); // combined + replacements + its own file
    const hugeJaw = { ...request.jaw!, originalBytes: lengthOnly<Uint8Array>(LIMITS.bundle.maxBytes) };
    expect(thrown(() => buildBundle({ ...request, jaw: hugeJaw })).code).toBe('EXPORT_TOO_LARGE');
  });

  it('validates the request', () => {
    const { request } = caseRequest(true);
    const { cap } = caseRequest(true);
    const reason = (r: ExportRequest): unknown => thrown(() => buildBundle(r)).details.reason;
    expect(thrown(() => buildBundle({ ...request, geometryBySite: { 'site-1': cap, 'site-3': cap } }))).toMatchObject({
      code: 'EXPORT_GEOMETRY_MISSING',
      details: { site: 1 },
    });
    const scaled = Float64Array.from(request.assemblyTransform);
    scaled[0] = 1.5;
    expect(thrown(() => buildBundle({ ...request, assemblyTransform: scaled })).code).toBe('MATRIX_NOT_RIGID');
    expect(reason({ ...request, arch: 'middle' as unknown as ExportRequest['arch'] })).toBe('arch');
    expect(reason({ ...request, createdAt: 'yesterday' })).toBe('createdAt');
    expect(reason({ ...request, appVersion: 'v 1 (patient X)' })).toBe('appVersion');
    expect(reason({ ...request, sites: [], geometryBySite: {} })).toBe('noSites');
    expect(reason({ ...request, sites: [request.sites[0]!, request.sites[0]!] })).toBe('duplicateSiteId');
    expect(reason({ ...request, jaw: undefined })).toBe('alignmentWithoutJaw');
    expect(reason({ ...request, jaw: { ...request.jaw!, originalBytes: new Uint8Array(0) } })).toBe('jawBytes');
    const stray = { ...request.alignment!, perSite: [{ siteId: 'site-9', rmsMm: 0, coverage: 1, visible: 1, samples: 1 }] };
    expect(thrown(() => buildBundle({ ...request, alignment: stray }))).toMatchObject({
      code: 'INVALID_ARGUMENT',
      details: { reason: 'alignmentSite', index: 0 },
    });
  });
});
