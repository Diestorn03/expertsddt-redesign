import { describe, expect, it } from 'vitest';
import { XchangeError } from '../../core/errors';
import { LIMITS } from '../../core/limits';
import { createRng, type Rng } from '../../core/sampling';
import { writeBinarySTL } from '../../core/stl-writer';
import type { MeshFormat, TriMesh } from '../../core/types';
import { makeScanBody } from '../../test/fixtures';
import { encodeAsciiSTL, encodeOBJ, encodePLY } from '../../test/fixtures/encoders';
import { detectMeshFormat, parseMesh } from './index';
import { encode, expectError } from './test-helpers';

const body = makeScanBody();
const scaled = (mesh: TriMesh, k: number): TriMesh => ({ positions: mesh.positions.map((v) => v * k), indices: mesh.indices });

describe('detectMeshFormat', () => {
  it('recognises every format by content only', () => {
    expect(detectMeshFormat(writeBinarySTL(body))).toBe('stl');
    const solidHeader = writeBinarySTL(body);
    solidHeader.set(encode('solid but binary'));
    expect(detectMeshFormat(solidHeader)).toBe('stl');
    expect(detectMeshFormat(encodeAsciiSTL(body))).toBe('stl');
    for (const encoding of ['ascii', 'binary_little_endian', 'binary_big_endian'] as const) expect(detectMeshFormat(encodePLY(body, encoding))).toBe('ply');
    expect(detectMeshFormat(encode('ply\r\nformat ascii 1.0\r\n'))).toBe('ply');
    expect(detectMeshFormat(encodeOBJ(body))).toBe('obj');
    // Large OBJ: the first MB holds only vertices, the faces come later.
    const vertices = Array.from({ length: 80_000 }, (_, i) => `v ${i * 0.001} ${i * 0.002} 1.5`);
    const bigObj = encode(['# big', ...vertices, 'f 1 2 3', ''].join('\n'));
    expect(bigObj.length).toBeGreaterThan(1024 * 1024);
    expect(detectMeshFormat(bigObj)).toBe('obj');
  });

  it('returns null for anything else, truncated binary STL included', () => {
    const others = [
      '', 'solid only a name\n', 'Application: MicronMapper V1.4.0.0\n', '<?xml version="1.0"?><ScanAdaptor/>', '{"positions": []}',
      'label,Mat0,Mat1\nA,1;0;0;0,0;1;0;0\n', 'hello world\n', 'v\u0000 1 2 3\n', '# only a comment\n', 'plyx\n',
    ];
    for (const text of others) expect(detectMeshFormat(encode(text)), JSON.stringify(text)).toBeNull();
    const stl = writeBinarySTL(body);
    expect(detectMeshFormat(stl.subarray(0, stl.length - 1))).toBeNull();
  });

  it('never throws on random bytes', () => {
    const rng = createRng(42);
    const prefixes = ['', 'solid x\nfacet ', 'ply\n', 'v 1 2 3\n', '\uFEFFsolid'].map(encode);
    for (let i = 0; i < 3000; i++) {
      const prefix = prefixes[i % prefixes.length]!;
      const bytes = new Uint8Array(prefix.length + Math.floor(rng() * 300));
      bytes.set(prefix);
      for (let j = prefix.length; j < bytes.length; j++) bytes[j] = Math.floor(rng() * 256);
      if (i % 7 === 0 && bytes.length >= 84) new DataView(bytes.buffer).setUint32(80, (bytes.length - 84) / 50, true);
      expect(() => detectMeshFormat(bytes)).not.toThrow();
    }
  });
});

describe('parseMesh', () => {
  it('checks emptiness and size before anything else', () => {
    expectError(() => parseMesh(new Uint8Array(0), 'capture'), 'FILE_EMPTY');
    const big = new Uint8Array(LIMITS.geometry.maxBytes + 1);
    expectError(() => parseMesh(big, 'geometry', 'stl'), 'FILE_TOO_LARGE', { limitBytes: LIMITS.geometry.maxBytes, bytes: big.length });
  });

  it('uses the hint only when the content matches nothing, so the user gets that parser\'s error', () => {
    const stl = writeBinarySTL(body);
    const truncated = stl.subarray(0, stl.length - 7);
    expectError(() => parseMesh(truncated, 'capture'), 'FORMAT_UNKNOWN');
    expectError(() => parseMesh(truncated, 'capture', 'stl'), 'MESH_TRUNCATED');
    expectError(() => parseMesh(encode('hello\n'), 'capture', 'obj'), 'MESH_MALFORMED', { format: 'obj', reason: 'unknownRecord' });
    expectError(() => parseMesh(encode('hello\n'), 'capture', 'ply'), 'MESH_MALFORMED', { format: 'ply', reason: 'magic' });
    expectError(() => parseMesh(encode('hello\n'), 'capture', 'xyz' as MeshFormat), 'FORMAT_UNKNOWN');
    // Content wins over the hint.
    expect(parseMesh(encodePLY(body, 'ascii'), 'capture', 'stl').format).toBe('ply');
    expect(parseMesh(stl, 'capture', 'obj').format).toBe('stl');
  });

  it('refuses formats the purpose does not allow (OBJ jaw)', () => {
    expectError(() => parseMesh(encodeOBJ(body), 'jaw'), 'FORMAT_NOT_ALLOWED', { format: 'obj', purpose: 'jaw' });
    expectError(() => parseMesh(encode('hello\n'), 'jaw', 'obj'), 'FORMAT_NOT_ALLOWED', { format: 'obj', purpose: 'jaw' });
    for (const purpose of ['jaw', 'capture', 'geometry'] as const) {
      // One ~10 mm scan body is a plausible capture or geometry, but not a jaw scan (>= 15 mm across).
      expect(parseMesh(writeBinarySTL(body), purpose).warnings.map((w) => w.code)).toEqual(purpose === 'jaw' ? ['MESH_UNITS_SUSPECT'] : []);
      expect(parseMesh(encodePLY(body), purpose).mesh.indices).toEqual(body.indices);
    }
    expect(parseMesh(encodeOBJ(body), 'geometry').format).toBe('obj');
  });

  it('warns about suspicious units without converting', () => {
    const metres = parseMesh(writeBinarySTL(scaled(body, 0.001)), 'geometry');
    expect(metres.warnings).toEqual([{ code: 'MESH_UNITS_SUSPECT', details: { extentMm: 0.009 } }]);
    expect(metres.mesh.positions[0]).toBeCloseTo(body.positions[0]! * 0.001, 9);
    const huge = parseMesh(writeBinarySTL(scaled(body, 100)), 'capture');
    expect(huge.warnings.map((w) => w.code)).toEqual(['MESH_UNITS_SUSPECT']);
  });

  it('warns about jaws above LIMITS.jaw.warnTriangles', () => {
    const faces = LIMITS.jaw.warnTriangles + 1;
    const head = encode(
      `ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face ${faces}\nproperty list uchar int vertex_indices\nend_header\n`,
    );
    const bytes = new Uint8Array(head.length + 36 + 13 * faces);
    bytes.set(head);
    const view = new DataView(bytes.buffer);
    [0, 0, 0, 30, 0, 0, 0, 30, 0].forEach((v, i) => view.setFloat32(head.length + 4 * i, v, true));
    const base = head.length + 36;
    bytes.set([3, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], base);
    for (let filled = 13; filled < 13 * faces; filled *= 2) bytes.copyWithin(base + filled, base, base + Math.min(filled, 13 * faces - filled));
    const { warnings, mesh } = parseMesh(bytes, 'jaw');
    expect(mesh.indices.length).toBe(3 * faces);
    expect(warnings).toEqual([{ code: 'MESH_LARGE', details: { triangles: faces } }]);
  });

  it('throws only XchangeError on mutated files (fuzz)', () => {
    const small = makeScanBody({ segments: 12, heightSegments: 2 });
    const colored: TriMesh = { ...small, colors: Uint8Array.from(small.positions, (_, i) => (i * 13) & 255) };
    const sources: Array<[Uint8Array, MeshFormat]> = [
      [writeBinarySTL(small), 'stl'],
      [encodeAsciiSTL(small), 'stl'],
      [encodePLY(colored, 'ascii'), 'ply'],
      [encodePLY(colored, 'binary_little_endian'), 'ply'],
      [encodePLY(small, 'binary_big_endian'), 'ply'],
      [encodeOBJ(small), 'obj'],
    ];
    const rng = createRng(7);
    let parsed = 0, rejected = 0;
    for (const [source, hint] of sources) {
      for (let i = 0; i < 250; i++) {
        const bytes = mutate(source, rng);
        expect(() => detectMeshFormat(bytes)).not.toThrow();
        try {
          parseMesh(bytes, 'capture', hint);
          parsed++;
        } catch (error) {
          if (!(error instanceof XchangeError)) throw error;
          rejected++;
        }
      }
    }
    expect(parsed).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });
});

function mutate(source: Uint8Array, rng: Rng): Uint8Array {
  const pick = (n: number): number => Math.floor(rng() * n);
  const r = rng();
  if (r < 0.2) return source.slice(0, pick(source.length));
  if (r < 0.35) {
    const at = pick(source.length);
    const insert = Uint8Array.from({ length: 1 + pick(16) }, () => pick(256));
    return Uint8Array.from([...source.subarray(0, at), ...insert, ...source.subarray(at)]);
  }
  const out = source.slice();
  const alphabet = r < 0.7 ? null : encode(' \n\r\t/#-+.eE0123456789\\');
  for (let k = 1 + pick(6); k > 0; k--) out[pick(out.length)] = alphabet ? alphabet[pick(alphabet.length)]! : pick(256);
  return out;
}
