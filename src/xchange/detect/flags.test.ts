import { describe, expect, it } from 'vitest';
import { mergeMeshes } from '../core/mesh';
import { addNoise, makeArch, makeFrames, makeRevolutionBody, makeScanBody, placeBodies } from '../test/fixtures';
import { expectFrames, speck, withoutTrianglesAt } from '../test/fixtures/detect';
import { recoverSitesFromMesh } from './sites';

const DEG = Math.PI / 180;
const body = makeScanBody();

describe('recoverSitesFromMesh: flags and unresolved shells', () => {
  it('a revolution body gives origin and axis but flags the index as ambiguous', () => {
    const round = makeRevolutionBody();
    const frames = makeFrames(5, 'upper', 4);
    const exact = recoverSitesFromMesh(placeBodies(frames, round), { mesh: round });
    expectFrames(exact, frames, 0.02, 0.05 * DEG, false);
    expect(exact.sites.every((s) => s.flags.indexAmbiguous === true && !s.flags.provisional)).toBe(true);
    expect(exact.warnings).toEqual([{ code: 'SITE_INDEX_AMBIGUOUS', details: { count: 5 } }]);
    const noisy = recoverSitesFromMesh(addNoise(placeBodies(frames, round), 0.01, 2), { mesh: round });
    expectFrames(noisy, frames, 0.03, 0.3 * DEG, false);
    expect(noisy.sites.every((s) => s.flags.indexAmbiguous === true && !s.flags.provisional)).toBe(true);
  });

  it('leaves the arch strip unresolved and skips a flagged fragment', () => {
    const frames = makeFrames(4, 'lower', 5);
    const result = recoverSitesFromMesh(mergeMeshes([placeBodies(frames, body), makeArch('lower'), speck]), { mesh: body });
    expectFrames(result, frames, 0.02, 0.05 * DEG);
    expect(result.unresolved).toEqual([4]);
    expect(result.components[5]!.fragment).toBe(true);
    expect(result.fits.map((f) => f.componentIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(result.fits[4]).toMatchObject({ status: 'unresolved', rmsMm: Infinity, indexAmbiguous: false });
    expect(result.warnings).toEqual([{ code: 'COMPONENT_FRAGMENTS', details: { count: 1 } }]);
  });

  it('marks fits provisional when a check fails, and unresolved when the reference does not match', () => {
    const frames = makeFrames(3, 'lower', 9);
    // Ends that look alike: +Z cannot be told from -Z, however small the residual.
    const plain = makeScanBody({ chamfer: 0 });
    const symmetric = recoverSitesFromMesh(placeBodies(frames, plain), { mesh: plain });
    expect(symmetric.sites).toHaveLength(3);
    expect(symmetric.sites.every((s) => s.flags.provisional === true)).toBe(true);
    expect(symmetric.fits.every((f) => f.datumAmbiguous && f.rmsMm < 0.001)).toBe(true);
    expect(symmetric.warnings).toEqual([{ code: 'SITE_PROVISIONAL', details: { count: 3 } }]);
    // A slightly bigger body: close (within 3 × maxRmsMm) but not reliable.
    const bigger = recoverSitesFromMesh(placeBodies(frames, makeScanBody({ radius: 2.54 })), { mesh: body });
    expect(bigger.sites.every((s) => s.flags.provisional === true)).toBe(true);
    expect(bigger.fits.every((f) => f.status === 'provisional' && f.rmsMm > 0.03 && f.rmsMm < 0.09)).toBe(true);
    expectFrames(bigger, frames, 0.03, 0.5 * DEG);
    // A different body: no site at all.
    const wrong = recoverSitesFromMesh(placeBodies(frames, body), { mesh: makeScanBody({ radius: 2 }) });
    expect(wrong.sites).toEqual([]);
    expect(wrong.unresolved).toEqual([0, 1, 2]);
  });

  it('accepts a capture with an open base (partial body) as reliable', () => {
    const frames = makeFrames(3, 'upper', 6);
    const bottomCentre = body.positions.length / 3 - 2;
    const result = recoverSitesFromMesh(placeBodies(frames, withoutTrianglesAt(body, bottomCentre)), { mesh: body });
    expectFrames(result, frames, 0.02, 0.05 * DEG);
    expect(result.fits.every((f) => f.status === 'reliable' && f.referenceCoverage > 0.8 && f.referenceCoverage < 0.95)).toBe(true);
  });
});
