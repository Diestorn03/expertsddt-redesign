import { describe, expect, it } from 'vitest';
import { fromAxisAngle, getColumn, maxAbsDiff, transformPoint, validateRigid } from '../core/mat4';
import { closestPointOnTriangle, computeBounds, computeFaceNormals, countTriangles, surfaceArea, transformMesh } from '../core/mesh';
import type { TriMesh } from '../core/types';
import { encodeAsciiSTL, encodeOBJ, encodePLY } from './fixtures/encoders';
import { addNoise, makeArch, makeFrames, makeRevolutionBody, makeScanBody, makeSyntheticCase, placeBodies, randomRigid } from './fixtures';

function signedVolume(m: TriMesh): number {
  const p = m.positions, idx = m.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [3 * idx[t]!, 3 * idx[t + 1]!, 3 * idx[t + 2]!];
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

/** Max distance from mesh a's vertices to surface b (brute force). */
function maxVertexDistance(a: TriMesh, b: TriMesh): number {
  let worst = 0;
  for (let v = 0; v < a.positions.length; v += 3) {
    let best = Infinity;
    for (let t = 0; t < countTriangles(b); t++) {
      best = Math.min(best, closestPointOnTriangle(b.positions, b.indices, t, a.positions[v]!, a.positions[v + 1]!, a.positions[v + 2]!));
    }
    worst = Math.max(worst, Math.sqrt(best));
  }
  return worst;
}

describe('fixtures: scan bodies', () => {
  it('are closed, consistently oriented, outward, with the connection at the origin', () => {
    for (const body of [makeScanBody(), makeRevolutionBody(), makeScanBody({ chamfer: 0, segments: 16 })]) {
      const directed = new Set<string>();
      for (let t = 0; t < body.indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const edge = `${body.indices[t + k]}>${body.indices[t + ((k + 1) % 3)]}`;
          expect(directed.has(edge)).toBe(false);
          directed.add(edge);
        }
      }
      for (const edge of directed) expect(directed.has(edge.split('>').reverse().join('>'))).toBe(true);
      expect(signedVolume(body)).toBeGreaterThan(100); // ≈ π·2.5²·6.6 = 130 minus flat and chamfer
      const { min, max } = computeBounds(body);
      expect(min[2]).toBe(0);
      expect(max[2]).toBeCloseTo(6.6, 6);
      expect(Math.hypot(min[0], min[1])).toBeGreaterThan(3); // centred on the axis
    }
  });

  it('the flat breaks rotational symmetry about +Z; the revolution body keeps it', () => {
    const quarter = fromAxisAngle([0, 0, 1], Math.PI / 2);
    const flat = makeScanBody();
    const round = makeRevolutionBody();
    expect(maxVertexDistance(transformMesh(flat, quarter), flat)).toBeGreaterThan(0.3);
    expect(maxVertexDistance(transformMesh(round, quarter), round)).toBeLessThan(1e-5);
    const { max } = computeBounds(flat);
    expect(max[0]).toBeCloseTo(2, 6); // flat on the +X side at r - 0.5
    expect(max[1]).toBeCloseTo(2.5, 6);
  });
});

describe('fixtures: arch and frames', () => {
  it('arch strips have relief, no degenerate triangles, and face the occlusal side', () => {
    for (const arch of ['lower', 'upper'] as const) {
      const mesh = makeArch(arch);
      const normals = computeFaceNormals(mesh);
      let nz = 0;
      for (let t = 0; t < countTriangles(mesh); t++) {
        const len = Math.hypot(normals[3 * t]!, normals[3 * t + 1]!, normals[3 * t + 2]!);
        expect(len).toBeCloseTo(1, 5);
        nz += normals[3 * t + 2]!;
      }
      expect((nz / countTriangles(mesh)) * (arch === 'lower' ? 1 : -1)).toBeGreaterThan(0.5); // steep ridge flanks
      const { min, max } = computeBounds(mesh);
      expect(max[2] - min[2]).toBeGreaterThan(4);
      expect(max[0] - min[0]).toBeGreaterThan(45);
      expect(surfaceArea(mesh) / countTriangles(mesh)).toBeGreaterThan(0.1);
    }
  });

  it('frames are rigid, point out of the gum, and sit on the ridge', () => {
    for (const arch of ['lower', 'upper'] as const) {
      const frames = makeFrames(6, arch);
      expect(frames).toHaveLength(6);
      for (const f of frames) {
        expect(() => validateRigid(f, 1e-12)).not.toThrow();
        expect(getColumn(f, 2)[2] * (arch === 'lower' ? 1 : -1)).toBeGreaterThan(0.95);
        expect(Math.abs(getColumn(f, 3)[2])).toBeGreaterThan(3);
      }
      expect(maxAbsDiff(makeFrames(6, arch)[2]!, frames[2]!)).toBe(0); // deterministic
    }
    expect(makeFrames(1, 'lower')).toHaveLength(1);
  });
});

describe('fixtures: noise, rigid motions, cases, encoders', () => {
  it('placeBodies, addNoise and randomRigid are deterministic', () => {
    const body = makeScanBody();
    const frames = makeFrames(3, 'lower');
    expect(countTriangles(placeBodies(frames, body))).toBe(3 * countTriangles(body));
    const noisy = addNoise(body, 0.01, 5);
    expect(Array.from(addNoise(body, 0.01, 5).positions)).toEqual(Array.from(noisy.positions));
    let sum2 = 0;
    for (let i = 0; i < body.positions.length; i++) sum2 += (noisy.positions[i]! - body.positions[i]!) ** 2;
    expect(Math.sqrt(sum2 / body.positions.length)).toBeCloseTo(0.01, 2);
    const m = randomRigid(9, 1, 5);
    expect(() => validateRigid(m, 1e-12)).not.toThrow();
    expect(maxAbsDiff(randomRigid(9, 1, 5), m)).toBe(0);
  });

  it('a synthetic case is the capture moved by captureToJaw', () => {
    const c = makeSyntheticCase({ implants: 3, seed: 4 });
    expect(c.sites.map((s) => [s.id, s.componentIndex])).toEqual([['site-1', 0], ['site-2', 1], ['site-3', 2]]);
    expect(c.jaw.positions.length).toBe(c.archMesh.positions.length + c.captureMesh.positions.length);
    const offset = c.archMesh.positions.length;
    const p = transformPoint(c.captureToJaw, [c.captureMesh.positions[0]!, c.captureMesh.positions[1]!, c.captureMesh.positions[2]!]);
    for (let k = 0; k < 3; k++) expect(c.jaw.positions[offset + k]).toBeCloseTo(p[k]!, 4);
    expect(Array.from(c.parts[1]!.mesh.positions)).toEqual(Array.from(transformMesh(c.body, c.frames[1]!).positions));
    const round = makeSyntheticCase({ flat: false, noiseSigmaMm: 0.01 });
    expect(round.sites.every((s) => s.flags.indexAmbiguous)).toBe(true);
  });

  it('encoders write well-formed files', () => {
    const body = { ...makeScanBody({ segments: 12, heightSegments: 1 }), colors: undefined };
    const v = body.positions.length / 3, t = countTriangles(body);
    const stl = new TextDecoder().decode(encodeAsciiSTL(body, 'x'));
    expect(stl.startsWith('solid x\n')).toBe(true);
    expect(stl.match(/facet normal/g)).toHaveLength(t);
    expect(stl.trimEnd().endsWith('endsolid x')).toBe(true);
    const colored: TriMesh = { positions: body.positions, indices: body.indices, colors: new Uint8Array(3 * v).fill(200) };
    for (const [enc, colors, size] of [
      ['binary_little_endian', false, 12 * v + 13 * t],
      ['binary_big_endian', true, 15 * v + 13 * t],
    ] as const) {
      const bytes = encodePLY(colors ? colored : body, enc);
      const headerEnd = new TextDecoder().decode(bytes).indexOf('end_header\n') + 'end_header\n'.length;
      expect(bytes.length - headerEnd).toBe(size);
    }
    const ascii = new TextDecoder().decode(encodePLY(colored, 'ascii')).split('\n');
    expect(ascii).toContain(`element vertex ${v}`);
    expect(ascii.filter((l) => l.startsWith('3 '))).toHaveLength(t);
    const obj = new TextDecoder().decode(encodeOBJ(body)).split('\n');
    expect(obj.filter((l) => l.startsWith('v '))).toHaveLength(v);
    expect(obj.filter((l) => l.startsWith('f '))).toHaveLength(t);
  });
});
