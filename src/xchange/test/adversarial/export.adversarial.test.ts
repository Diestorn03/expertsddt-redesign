/**
 * Adversarial tests for export: whatever the request carries, the bundle must be geometrically right,
 * never hold NaN, and extract safely on Windows, macOS and Linux. Tests named "BUG:" fail on purpose until
 * the production code is fixed (review findings); the others document attacks that hold. All data is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, XchangeError } from '../../core/errors';
import { compose, fromAxisAngle, identity } from '../../core/mat4';
import { createRng } from '../../core/sampling';
import type { ExportRequest, ImplantSite, Mat4, ReplacementGeometry, TriMesh, Vec3 } from '../../core/types';
import { buildBundle } from '../../export/bundle';
import { placeReplacements } from '../../export/placement';
import { zipStore } from '../../export/zip';
import { parsePositions } from '../../io/positions/index';
import { makeFrames, makeScanBody, makeSyntheticCase } from '../fixtures';
import { encodeScanAdaptorXML } from '../fixtures/positions';

const KNOWN_CODES = new Set<string>(ERROR_CODES);

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof XchangeError)) throw error;
    expect(KNOWN_CODES.has(error.code)).toBe(true);
    return error.code;
  }
}

/** p' = m·p in float64, using only the top three rows (what a rigid transform means). */
const apply = (m: Mat4, p: Readonly<Vec3>): Vec3 => {
  const row = (r: number): number => m[4 * r]! * p[0] + m[4 * r + 1]! * p[1] + m[4 * r + 2]! * p[2] + m[4 * r + 3]!;
  return [row(0), row(1), row(2)];
};

/** Largest distance between the STL's corners and assembly · frame · geometry, corner by corner. */
function worstCornerError(stl: Uint8Array, geometry: TriMesh, frame: Mat4, assembly: Mat4): number {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const p = geometry.positions, idx = geometry.indices;
  expect(view.getUint32(80, true)).toBe(idx.length / 3);
  let worst = 0;
  for (let i = 0; i < idx.length; i++) {
    const v = 3 * idx[i]!;
    const e = apply(assembly, apply(frame, [p[v]!, p[v + 1]!, p[v + 2]!]));
    const o = 84 + 50 * Math.floor(i / 3) + 12 + 12 * (i % 3);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(view.getFloat32(o + 4 * k, true) - e[k]!));
  }
  return worst;
}

const CREATED = '2026-11-07T12:00:00Z';
const tall: ReplacementGeometry = { id: 'tall', name: 'Tall 15 mm', mesh: makeScanBody({ height: 15, segments: 16, heightSegments: 2 }) };
/** A capture -> jaw pose 60 mm away from the capture origin, as between two scanners' coordinate systems. */
const ASSEMBLY = compose([60, -25, 10], fromAxisAngle([0.2, 1, 0.3], 0.7));

describe('export: geometry', () => {
  it('BUG: a 4th row that validateRigid accepts never shears the exported replacements', () => {
    // Off by < RIGID_TOLERANCE (1e-4) per entry. multiply(assembly, site) adds translation x 4th row to the
    // rotation: ~88 um at the top of a 15 mm replacement today, with every check passing. Fixed by a rigid
    // core multiply() (math-core BUG test) or by placement composing with row 3 = 0 0 0 1.
    const frames = makeFrames(3, 'lower', 9);
    const noisy = frames.map((m) => {
      const out = Float64Array.from(m);
      out.set([3e-5, -2e-5, 9e-5, 1 + 5e-5], 12);
      return out;
    });

    // From a position file, end to end.
    let parsed: ImplantSite[] | undefined;
    try {
      parsed = parsePositions(encodeScanAdaptorXML(noisy, ['11', '12', '13'])).sites;
    } catch (error) {
      expect(error).toMatchObject({ code: 'MATRIX_NOT_RIGID' }); // refusing the file is a fix too
    }
    if (parsed) {
      const bundle = buildBundle({
        arch: 'lower',
        captureFormat: 'scanadaptor-xml',
        sites: parsed,
        geometryBySite: Object.fromEntries(parsed.map((s) => [s.id, tall])),
        assemblyTransform: ASSEMBLY,
        createdAt: CREATED,
        appVersion: '0.1.0',
      });
      parsed.forEach((site, i) => {
        const stl = bundle.files.find((f) => f.name === `replacement_${site.label}.stl`)!.bytes;
        expect(worstCornerError(stl, tall.mesh, frames[i]!, ASSEMBLY), site.label).toBeLessThan(1e-3);
      });
    }

    // From any other producer of sites (detect, align, a stored case).
    const sites: ImplantSite[] = noisy.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'demo', flags: {} }));
    let placed: ReturnType<typeof placeReplacements>;
    try {
      placed = placeReplacements(sites, Object.fromEntries(sites.map((s) => [s.id, tall])), ASSEMBLY);
    } catch (error) {
      expect(error).toMatchObject({ code: 'MATRIX_NOT_RIGID' });
      return;
    }
    placed.forEach((p, i) => {
      const expected = tall.mesh.positions, got = p.mesh.positions;
      let worst = 0;
      for (let v = 0; v < expected.length; v += 3) {
        const e = apply(ASSEMBLY, apply(frames[i]!, [expected[v]!, expected[v + 1]!, expected[v + 2]!]));
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(got[v + k]! - e[k]!));
      }
      expect(worst, p.siteId).toBeLessThan(1e-3);
    });
  });

  it('BUG: meshes with an index past the vertices or a non-finite position are refused before anything is written', () => {
    // Library geometry comes back from IndexedDB (state/): today an index past the end or a NaN position is
    // written straight into every STL as NaN corners, with report.json claiming a normal export.
    const c = makeSyntheticCase({ implants: 2, seed: 3 });
    const body = makeScanBody({ segments: 8, heightSegments: 1 });
    const badIndex: TriMesh = { positions: body.positions, indices: Uint32Array.from(body.indices, (v, i) => (i === 5 ? 999_999 : v)) };
    const nan: TriMesh = { positions: Float32Array.from(body.positions, (v, i) => (i === 4 ? Number.NaN : v)), indices: body.indices };
    const inf: TriMesh = { positions: Float32Array.from(body.positions, (v, i) => (i === 7 ? -Infinity : v)), indices: body.indices };
    const request = (mesh: TriMesh, jaw?: TriMesh): ExportRequest => ({
      arch: 'lower',
      captureFormat: 'demo',
      sites: c.sites,
      geometryBySite: { 'site-1': { id: 'ok', name: 'OK', mesh: body }, 'site-2': { id: 'g', name: 'G', mesh } },
      assemblyTransform: jaw ? c.captureToJaw : identity(),
      ...(jaw ? { jaw: { mesh: jaw, originalBytes: Uint8Array.of(1, 2, 3), format: 'stl' as const } } : {}),
      createdAt: CREATED,
      appVersion: '0.1.0',
    });
    const brokenJaw: TriMesh = { positions: c.jaw.positions, indices: Uint32Array.from(c.jaw.indices, (v, i) => (i === 0 ? c.jaw.positions.length : v)) };
    const cases: Array<[string, ExportRequest]> = [
      ['geometry index', request(badIndex)],
      ['geometry NaN', request(nan)],
      ['geometry -Infinity', request(inf)],
      ['jaw index', request(body, brokenJaw)],
    ];
    expect(cases.map(([name, r]) => [name, codeOf(() => buildBundle(r))])).toEqual(cases.map(([name]) => [name, 'INVALID_ARGUMENT']));
  });
});

describe('export: ZIP entry names', () => {
  const none = new Uint8Array(0);

  it('BUG: zipStore refuses names Windows reserves or that collide under Unicode case folding', () => {
    // zip.ts promises every accepted name extracts as a plain file on Windows, macOS and Linux.
    for (const name of ['COM\u00b9.stl', 'lpt\u00b3', 'CONIN$', 'conout$.txt']) {
      expect([name, codeOf(() => zipStore([{ name, bytes: none }]))]).toEqual([name, 'EXPORT_NAME_INVALID']);
    }
    // NTFS ($UpCase) and case-insensitive APFS both map final sigma and sigma to the same name.
    expect(codeOf(() => zipStore([{ name: '\u03c2.txt', bytes: none }, { name: '\u03c3.txt', bytes: none }]))).toBe('EXPORT_NAME_INVALID');
  });

  it('hostile labels always give safe, unique ASCII entry names in a consistent archive (regression)', () => {
    const c = makeSyntheticCase({ implants: 1, seed: 4 });
    const fixed = ['../../etc/passwd', '..\\..\\boot.ini', 'C:\\x', '\\\\server\\share', 'CON', 'aux.stl', 'a\u0000b', '\u202Egpj.exe',
      'x\u200By', '\u{1F600}', ' . ', '\u2026', '\u01C5', 'a'.repeat(300), '\uD800', '', 'replacements', 'REPLACEMENT_x', 'x', 'X'];
    const rng = createRng(17);
    const alphabet = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '.', ' ', '-', '_', '\u0000', '\u001f', '\u007f', '\u202e', '\u0301', 'é', 'ß', 'ǅ', 'Ａ', '①', '中', '\uD83D', 'a', 'Z', '9'];
    const random = Array.from({ length: 44 }, () => Array.from({ length: 1 + Math.floor(rng() * 12) }, () => alphabet[Math.floor(rng() * alphabet.length)]!).join(''));
    const labels = [...fixed, ...random];
    const sites: ImplantSite[] = labels.map((label, i) => ({ ...c.sites[0]!, id: `site-${i + 1}`, label }));
    const bundle = buildBundle({
      arch: 'upper',
      captureFormat: 'demo',
      sites,
      geometryBySite: Object.fromEntries(sites.map((s) => [s.id, tall])),
      assemblyTransform: identity(),
      createdAt: CREATED,
      appVersion: '0.1.0',
    });
    const names = bundle.files.map((f) => f.name);
    const perSite = names.slice(2, 2 + sites.length);
    for (const name of perSite) expect(name).toMatch(/^replacement_[A-Za-z0-9._-]{1,80}\.stl$/);
    expect(perSite.every((n) => !n.includes('..'))).toBe(true);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(readCentralDirectory(bundle.zip)).toEqual(bundle.files.map((f) => ({ name: f.name, size: f.bytes.length })));
  });
});

/** Independent reader: EOCD -> central directory -> local headers; checks offsets, names, sizes, CRCs. */
function readCentralDirectory(zip: Uint8Array): { name: string; size: number }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let c = view.getUint32(end + 16, true);
  const out: { name: string; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(c, true)).toBe(0x02014b50);
    const crc = view.getUint32(c + 16, true), size = view.getUint32(c + 20, true), nameLength = view.getUint16(c + 28, true);
    const local = view.getUint32(c + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 26, true)).toBe(nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(zip.subarray(c + 46, c + 46 + nameLength));
    expect(new TextDecoder().decode(zip.subarray(local + 30, local + 30 + nameLength))).toBe(name);
    const data = zip.subarray(local + 30 + nameLength, local + 30 + nameLength + size);
    let k = 0xffffffff;
    for (const byte of data) {
      k ^= byte;
      for (let b = 0; b < 8; b++) k = (k >>> 1) ^ (0xedb88320 & -(k & 1));
    }
    expect((k ^ 0xffffffff) >>> 0).toBe(crc);
    out.push({ name, size });
    c += 46 + nameLength;
  }
  expect(c).toBe(end);
  return out;
}
