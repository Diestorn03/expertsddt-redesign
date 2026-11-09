/**
 * Adversarial review of the engine slices after 3d10f75 (positions-shells): one body = the outer shell plus what sits
 * inside it. Fixed with the review findings: they now guard against regressions. Synthetic data only.
 */
import { describe, expect, it } from 'vitest';
import { fromTranslation } from '../../core/mat4';
import { mergeMeshes, transformMesh } from '../../core/mesh';
import { writeBinarySTL } from '../../core/stl-writer';
import { describeComponents } from '../../detect/sites';
import { readCapture } from '../../state/jobs-handler';
import { makeRevolutionBody, makeScanBody, makeSyntheticCase, placeBodies } from '../fixtures';
import { withoutTrianglesAt } from '../fixtures/detect';
import { encodeMicronMapperExport, utf8 } from '../fixtures/positions';

describe('inner pieces of a cap that carries an index flat', () => {
  // The usual scan body (r 2.5, h 6.6, open base) with its index flat 0.8 mm deep, and a coaxial insert well inside it.
  const closed = makeScanBody({ flatDepth: 0.8, heightSegments: 8 });
  const cap = withoutTrianglesAt(closed, closed.positions.length / 3 - 2);
  const insert = transformMesh(makeRevolutionBody({ radius: 1.25, height: 4.6, chamfer: 0.3 }), fromTranslation([0, 0, 0.35]));
  const body = mergeMeshes([cap, insert]);

  it('BUG: the insert is not folded into its cap, so a positions STL of 4 such bodies counts 8 implants', () => {
    // Failure: sites.ts outerShells tests the insert's centroid against the cap's principal axis through the cap's
    // surface centroid; the flat moves that centroid 0.19 mm off the implant axis, more than 2 % of the diagonal.
    const shells = describeComponents(body);
    expect(shells.map((s) => s.inner.length)).toEqual([1]);
    const c = makeSyntheticCase({ implants: 4, seed: 5 });
    const r = readCapture([
      { bytes: utf8(encodeMicronMapperExport(c.frames, 'BTH')), extension: 'csv' },
      { bytes: writeBinarySTL(placeBodies(c.frames, body)), extension: 'stl' },
    ]);
    expect(r.sources.map((s) => `${s.kind}:${s.count}`)).toEqual(['positions:4', 'mesh:4']);
  });
});
