import { describe, expect, it } from 'vitest';
import { fromTranslation, multiply, transformPoint } from '../core/mat4';
import { countTriangles, mergeMeshes, surfaceArea, transformMesh } from '../core/mesh';
import type { ImplantSite, TriMesh } from '../core/types';
import { distance } from '../core/vec3';
import { pcaOfSurface } from '../geometry/pca';
import { addNoise, makeFrames, makeRevolutionBody, makeScanBody, placeBodies } from '../test/fixtures';
import { capWithInsert, expectFrames, speck, withoutTrianglesAt } from '../test/fixtures/detect';
import { linkSitesToComponents, recoverSitesFromMesh, splitComponents } from './sites';

const DEG = Math.PI / 180;
const body = makeScanBody();

describe('splitComponents', () => {
  it('returns one component per body in placeBodies order, with area and surface centroid', () => {
    const frames = makeFrames(5, 'lower', 2);
    const components = splitComponents(placeBodies(frames, body));
    const centroid = pcaOfSurface(body).centroid;
    expect(components).toHaveLength(5);
    components.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.fragment).toBe(false);
      expect(c.areaMm2).toBeCloseTo(surfaceArea(body), 3);
      expect(distance(c.centroid, transformPoint(frames[i]!, centroid))).toBeLessThan(1e-4);
      expect(countTriangles(c.mesh)).toBe(countTriangles(body));
    });
  });

  it('flags tiny shells as fragments, keeps them, and enforces the component limit', () => {
    const components = splitComponents(mergeMeshes([placeBodies(makeFrames(2), body), speck]));
    expect(components.map((c) => c.fragment)).toEqual([false, false, true]);
    const tooMany = placeBodies(makeFrames(65, 'lower', 1), makeScanBody({ segments: 6, heightSegments: 1, chamfer: 0 }));
    expect(() => splitComponents(tooMany)).toThrow(/TOO_MANY_COMPONENTS.*"limit":64/);
    expect(() => splitComponents({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toThrow(/MESH_EMPTY/);
  });
});

describe('recoverSitesFromMesh: accuracy', () => {
  it('recovers 4 and 8 flat-indexed frames exactly (noise-free), lower and upper, within the time budget', () => {
    for (const [n, arch, seed] of [[4, 'lower', 7], [8, 'upper', 3]] as const) {
      const frames = makeFrames(n, arch, seed);
      const start = performance.now();
      const result = recoverSitesFromMesh(placeBodies(frames, body), { mesh: body });
      expect(performance.now() - start).toBeLessThan(n * 500);
      expectFrames(result, frames, 0.02, 0.05 * DEG);
      expect(result.sites.map((s) => [s.id, s.label, s.source])).toEqual(frames.map((_, i) => [`site-${i + 1}`, `Implant ${i + 1}`, 'stl']));
      expect(result.sites.every((s) => Object.keys(s.flags).length === 0)).toBe(true);
      expect(result.unresolved).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.fits.every((f) => f.status === 'reliable' && f.rmsMm < 0.001 && f.referenceCoverage > 0.99)).toBe(true);
    }
  });

  it('stays within 30 µm / 0.3° with 10 µm vertex noise', () => {
    // The fixture's flat has ~45 vertices: with 10 µm noise the clocking is only known to ~0.1° (1 sigma).
    const frames = makeFrames(6, 'lower', 7);
    const result = recoverSitesFromMesh(addNoise(placeBodies(frames, body), 0.01, 7), { mesh: body }, { source: 'ply' });
    expectFrames(result, frames, 0.03, 0.3 * DEG);
    expect(result.sites.every((s) => s.source === 'ply' && !s.flags.provisional && !s.flags.indexAmbiguous)).toBe(true);
    expect(result.fits.every((f) => f.rmsMm < 0.012)).toBe(true);
  });

  it('rejects an unusable reference and bad options', () => {
    const capture = placeBodies(makeFrames(1), body);
    const flat: TriMesh = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0), indices: Uint32Array.of(0, 1, 2) };
    expect(() => recoverSitesFromMesh(capture, { mesh: flat })).toThrow(/REFERENCE_NO_MATCH/);
    expect(() => recoverSitesFromMesh(capture, { mesh: { positions: new Float32Array(3), indices: Uint32Array.of(0, 0, 1) } })).toThrow(/index/);
    for (const options of [{ samples: 5 }, { samples: 1.5 }, { maxRmsMm: 0 }, { minCoverage: 2 }, { seed: 0.5 }, { source: 'xyz' as 'stl' }]) {
      expect(() => recoverSitesFromMesh(capture, { mesh: body }, options)).toThrow(/INVALID_ARGUMENT/);
    }
  });
});

describe('linkSitesToComponents', () => {
  it('links shuffled sites to their own bodies, leaves far sites unlinked, and returns new objects', () => {
    const frames = makeFrames(5, 'lower', 11);
    const far = frames[0]!.slice();
    far[3] = far[3]! + 30;
    // A fragment right at the far site: fragments are never linked.
    const components = splitComponents(mergeMeshes([placeBodies(frames, body), transformMesh(speck, far)]));
    expect(components[5]!.fragment).toBe(true);
    const sites: ImplantSite[] = frames.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'micronmapper-csv', flags: {} }));
    sites.push({ id: 'site-6', label: 'S6', matrix: far, source: 'micronmapper-csv', flags: {}, componentIndex: 3 });
    const shuffled = [sites[3]!, sites[5]!, sites[0]!, sites[4]!, sites[1]!, sites[2]!];
    const linked = linkSitesToComponents(shuffled, components);
    expect(linked.map((s) => [s.id, s.componentIndex])).toEqual([
      ['site-4', 3], ['site-6', undefined], ['site-1', 0], ['site-5', 4], ['site-2', 1], ['site-3', 2],
    ]);
    expect('componentIndex' in linked[1]!).toBe(false);
    expect(linked[0]).not.toBe(shuffled[0]);
    expect(linked[0]!.matrix).not.toBe(shuffled[0]!.matrix);
    expect(shuffled[1]!.componentIndex).toBe(3); // input untouched
    expect(linkSitesToComponents(sites, []).every((s) => s.componentIndex === undefined)).toBe(true);
  });

  it('never links a body that stands far along a site axis (another coordinate system)', () => {
    const frames = makeFrames(4, 'lower', 11);
    const sites: ImplantSite[] = frames.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'micronmapper-csv', flags: {} }));
    const along = (mm: number) => splitComponents(placeBodies(frames.map((f) => multiply(f, fromTranslation([0, 0, mm]))), body));
    expect(linkSitesToComponents(sites, along(47)).map((s) => s.componentIndex)).toEqual([undefined, undefined, undefined, undefined]);
    expect(linkSitesToComponents(sites, along(12)).map((s) => s.componentIndex)).toEqual([0, 1, 2, 3]); // a tall body: still its own
  });
});

describe('one body = the outer shell plus the pieces inside it', () => {
  const { cap, insert, body: capped } = capWithInsert();
  const frames = makeFrames(4, 'lower', 6);
  const capture = placeBodies(frames, capped);
  const sites: ImplantSite[] = frames.map((matrix, i) => ({ id: `site-${i + 1}`, label: `S${i + 1}`, matrix, source: 'micronmapper-csv', flags: {} }));

  it('counts one body per implant and keeps the insert with it (it pokes out of the box by 0.05 mm)', () => {
    const components = splitComponents(capture);
    expect(components).toHaveLength(4);
    components.forEach((c, i) => {
      expect([c.index, c.fragment, c.inner.length]).toEqual([i, false, 1]);
      expect(countTriangles(c.mesh)).toBe(countTriangles(cap));
      expect(countTriangles(c.inner[0]!)).toBe(countTriangles(insert));
    });
  });

  it('finds each implant once, with the cap alone or the cap and its insert as the capture scan body', () => {
    for (const reference of [cap, capped]) {
      const r = recoverSitesFromMesh(capture, { mesh: reference });
      expectFrames(r, frames, 0.02, 0.05 * DEG, false);
      expect(r.unresolved).toEqual([]);
      expect(r.fits.map((f) => f.status)).toEqual(['reliable', 'reliable', 'reliable', 'reliable']);
    }
  });

  it('links each position to its body, never to the insert', () => {
    expect(linkSitesToComponents(sites, splitComponents(capture)).map((s) => s.componentIndex)).toEqual([0, 1, 2, 3]);
  });

  it('folds the insert into a cap whose index flat moves its centroid and leans its principal axes off the cap axis', () => {
    const open = (m: TriMesh): TriMesh => withoutTrianglesAt(m, m.positions.length / 3 - 2);
    const insert = (height: number): TriMesh => transformMesh(makeRevolutionBody({ radius: 1.25, height, chamfer: 0.3 }), fromTranslation([0, 0, 0.35]));
    // the review's sweep: 0.5 mm flats on caps 4.5-5.5 mm tall (about as tall as wide: undecided principal axes)
    for (const height of [4.5, 5, 5.5]) {
      expect(splitComponents(mergeMeshes([open(makeScanBody({ flatDepth: 0.5, height, heightSegments: 8 })), insert(height - 2)])).map((c) => c.inner.length)).toEqual([1]);
    }
    // a wide outer part with a deep flat (its centroid 0.5 mm off the axis), the insert well inside its round outline
    const wide = open(makeScanBody({ radius: 3.5, height: 8.5, flatDepth: 1.5, heightSegments: 10 }));
    expect(distance(pcaOfSurface(wide).centroid, [0, 0, pcaOfSurface(wide).centroid[2]])).toBeGreaterThan(0.4);
    expect(splitComponents(mergeMeshes([wide, insert(6)])).map((c) => c.inner.length)).toEqual([1]);
  });

  it('never folds a piece that stands out of the top of the cap (a stacked part), nor one off the round axis', () => {
    const stacked = transformMesh(makeRevolutionBody({ radius: 1.25, height: 5 }), fromTranslation([0, 0, 3])); // up to 8 mm, the cap 6.6
    expect(splitComponents(mergeMeshes([cap, stacked])).map((c) => c.inner.length)).toEqual([0, 0]);
    const flatCap = withoutTrianglesAt(makeScanBody({ flatDepth: 0.8 }), makeScanBody({ flatDepth: 0.8 }).positions.length / 3 - 2);
    const beside = transformMesh(makeRevolutionBody({ radius: 1.0, height: 4 }), fromTranslation([-1.2, 0, 0.5])); // inside, 1.2 mm off the axis
    expect(splitComponents(mergeMeshes([flatCap, beside])).map((c) => c.inner.length)).toEqual([0, 0]);
  });

  it('folds in only a shell that is on the axis and inside the box', () => {
    const shaft = transformMesh(makeRevolutionBody({ radius: 1.25, height: 4.65 }), fromTranslation([1, 0, 0.35])); // inside the box, 1 mm off the axis
    expect(splitComponents(mergeMeshes([cap, shaft])).map((c) => c.inner.length)).toEqual([0, 0]);
    // The same body twice, 1 µm apart (beyond the weld): one body, the later copy folded into the first.
    const twin = splitComponents(mergeMeshes([cap, transformMesh(cap, fromTranslation([0.001, 0, 0]))]));
    expect(twin.map((c) => [c.index, c.inner.length])).toEqual([[0, 1]]);
  });
});
