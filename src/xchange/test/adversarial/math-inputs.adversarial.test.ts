/**
 * Adversarial inputs on the way from files to frames and meshes: mirrored frames and wrong units.
 * Tests named "BUG:" fail on purpose until the production code is fixed (see the review findings);
 * the others document attacks that hold. Bottom-row, NaN-geometry and -0 cases live in the
 * positions-io / export / mesh-io adversarial files.
 */
import { describe, expect, it } from 'vitest';
import type { XchangeError } from '../../core/errors';
import { writeBinarySTL } from '../../core/stl-writer';
import type { Mat4, TriMesh } from '../../core/types';
import { parseMesh } from '../../io/mesh/index';
import { parsePositions } from '../../io/positions/index';
import { makeArch, makeFrames } from '../fixtures';
import { compactLabels, encodeICamPoints, encodeMatrixTable, encodeMatrixXML, encodePositionsJSON, encodeScanAdaptorXML } from '../fixtures/positions';

const codeOf = (fn: () => unknown): { code?: string; reason?: unknown } => {
  try {
    fn();
    return {};
  } catch (error) {
    const e = error as XchangeError;
    return { code: e.code, reason: e.details?.['reason'] };
  }
};

describe('position files -> frames', () => {
  const frames = makeFrames(3, 'upper', 11);
  const labels = compactLabels(3);
  const families: Array<[string, (f: readonly Mat4[]) => string]> = [
    ['json', (f) => encodePositionsJSON(f, labels)],
    ['table m00..m33', (f) => encodeMatrixTable(f, labels, { schema: 'matrix' })],
    ['table Mat0..Mat3', (f) => encodeMatrixTable(f, labels, { schema: 'rows', delimiter: '\t' })],
    ['matrix xml text', (f) => encodeMatrixXML(f, labels)],
    ['matrix xml entries', (f) => encodeMatrixXML(f, labels, { entries: true, indexBase: 1 })],
    ['scanadaptor', (f) => encodeScanAdaptorXML(f, labels)],
    ['icam', (f) => encodeICamPoints(f, labels)],
  ];

  it('every family refuses a left-handed (mirrored) frame instead of importing it', () => {
    const mirrored = frames.map((m, i) => {
      const out = Float64Array.from(m);
      if (i === 1) for (const k of [0, 4, 8]) out[k] = -out[k]!; // +X flipped: det = -1
      return out;
    });
    for (const [name, encode] of families) {
      expect({ name, ...codeOf(() => parsePositions(encode(mirrored))) }).toEqual({ name, code: 'MATRIX_NOT_RIGID', reason: 'reflection' });
    }
  });

  it('every family that declares units refuses centimetres', () => {
    const texts = [
      JSON.stringify({ units: 'cm', matrixOrder: 'row-major', positions: frames.map((m, i) => ({ name: labels[i], matrix: Array.from(m) })) }),
      encodeMatrixTable(frames, labels, { units: 'line' }).replace('units,mm', 'units,cm'),
      encodeMatrixXML(frames, labels).replace('units="mm"', 'units="cm"'),
      encodeScanAdaptorXML(frames, labels, { units: 'cm' }),
      `units: cm\r\n${encodeICamPoints(frames, labels)}`,
    ];
    for (const text of texts) expect(codeOf(() => parsePositions(text)).code).toBe('UNITS_NOT_MM');
  });
});

describe('mesh files', () => {
  it('BUG: a full-arch jaw scan written in centimetres is not flagged MESH_UNITS_SUSPECT', () => {
    const arch = makeArch('lower');
    const codes = (m: TriMesh): string[] => parseMesh(writeBinarySTL(m), 'jaw').warnings.map((w) => w.code);
    expect(codes(arch)).not.toContain('MESH_UNITS_SUSPECT');
    // ~7 "mm" across: inside the single PLAUSIBLE_EXTENT_MM range (2-250) shared by jaws, captures and geometries.
    expect(codes({ positions: Float32Array.from(arch.positions, (v) => v / 10), indices: arch.indices })).toContain('MESH_UNITS_SUSPECT');
  });
});
