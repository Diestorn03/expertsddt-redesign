/**
 * End to end across the modules, the way the wizard will chain them: synthetic files in, ZIP out, every
 * exported replacement checked against the ground truth (true capture -> jaw pose · true frame · geometry).
 */
import { describe, expect, it } from 'vitest';
import { getColumn, rotationAngleBetween, transformPoint } from '../core/mat4';
import { writeBinarySTL } from '../core/stl-writer';
import type { ImplantSite, LandmarkPair, Mat4, ReplacementGeometry } from '../core/types';
import { distance } from '../core/vec3';
import { buildIcpTarget } from '../align/icp';
import { alignFromLandmarks, guidePoint, orderSitesAlongArch } from '../align/landmarks';
import { multiStartAlign } from '../align/multistart';
import { linkSitesToComponents, recoverSitesFromMesh, splitComponents } from '../detect/sites';
import { buildBundle, type ExportBundle } from '../export/bundle';
import { parseMesh } from '../io/mesh/index';
import { parsePositions } from '../io/positions/index';
import { makeRevolutionBody, makeSyntheticCase } from './fixtures';
import { encodePLY } from './fixtures/encoders';
import { encodeScanAdaptorXML } from './fixtures/positions';

const c = makeSyntheticCase({ implants: 4, seed: 31, noiseSigmaMm: 0.005, maxAngleRad: Math.PI });
const captureFile = writeBinarySTL(c.captureMesh);
const jawFile = encodePLY(c.jaw, 'binary_little_endian');
const library: ReplacementGeometry = { id: 'lib-cap', name: 'Cap 9 mm', mesh: makeRevolutionBody({ radius: 2, height: 9, segments: 24, heightSegments: 2 }) };
const DEG = Math.PI / 180;

/** Worst distance (mm) between each site's exported replacement, read back, and truth · frame · geometry. */
function worstReplacementError(bundle: ExportBundle, sites: readonly ImplantSite[], frameOf: (site: ImplantSite) => Mat4): number {
  let worst = 0;
  for (const site of sites) {
    const file = bundle.report.sites.find((s) => s.id === site.id)!.file;
    const { mesh } = parseMesh(bundle.files.find((f) => f.name === file)!.bytes, 'geometry');
    const g = library.mesh.positions, frame = frameOf(site);
    // writeBinarySTL writes triangle corners in index order; parseSTL merges them back in first-use order.
    const seen = new Map<number, number>();
    let next = 0;
    for (const v of library.mesh.indices) if (!seen.has(v)) seen.set(v, next++);
    for (const [source, parsed] of seen) {
      const truth = transformPoint(c.captureToJaw, transformPoint(frame, [g[3 * source]!, g[3 * source + 1]!, g[3 * source + 2]!]));
      worst = Math.max(worst, distance(truth, [mesh.positions[3 * parsed]!, mesh.positions[3 * parsed + 1]!, mesh.positions[3 * parsed + 2]!]));
    }
  }
  return worst;
}

function commonChecks(bundle: ExportBundle, sites: readonly ImplantSite[]): void {
  expect(bundle.report.coordinateFrame).toBe('jaw');
  expect(bundle.report.alignment?.matchesExport).toBe(true);
  expect(bundle.files.find((f) => f.name === 'jaw.ply')!.bytes).toEqual(jawFile); // byte for byte
  expect(bundle.files.map((f) => f.name)).toEqual([
    `${c.arch}_implant_position.stl`, // the main file: the group, as Fernando names his
    'combined.stl',
    ...sites.map((s) => `replacement_${s.label.replaceAll(' ', '_')}.stl`),
    'jaw.ply',
    'report.json',
    'README.txt',
  ]);
  // combined = re-serialised jaw + every replacement, readable by our own jaw parser.
  const combined = parseMesh(bundle.files.find((f) => f.name === 'combined.stl')!.bytes, 'jaw').mesh;
  expect(combined.indices.length / 3).toBe(c.jaw.indices.length / 3 + sites.length * (library.mesh.indices.length / 3));
}

describe('integration: files -> sites -> alignment -> ZIP', () => {
  const capture = parseMesh(captureFile, 'capture');
  const jaw = parseMesh(jawFile, 'jaw');
  const target = buildIcpTarget(jaw.mesh);
  const request = { arch: c.arch, createdAt: '2026-11-07T12:00:00Z', appVersion: '0.1.0' } as const;

  it('mesh capture: detect frames, auto-align on the jaw, export at the true positions', { timeout: 20_000 }, () => {
    expect(capture.warnings).toEqual([]);
    expect(jaw.warnings).toEqual([]);
    const found = recoverSitesFromMesh(capture.mesh, { mesh: c.body });
    expect(found.unresolved).toEqual([]);
    expect(found.sites.map((s) => s.componentIndex)).toEqual([0, 1, 2, 3]);
    for (const s of found.sites) {
      const truth = c.frames[s.componentIndex!]!;
      expect(distance(getColumn(s.matrix, 3), getColumn(truth, 3))).toBeLessThan(0.02);
      expect(rotationAngleBetween(s.matrix, truth)).toBeLessThan(0.05 * DEG);
    }

    // The scanned shells are the alignment surface (spec 4.3, base 'capture').
    const parts = found.sites.map((s) => ({ siteId: s.id, mesh: found.components[s.componentIndex!]!.mesh }));
    const alignment = multiStartAlign(parts, target);
    expect(alignment.status).toBe('good');
    expect(alignment.perSite.map((f) => f.siteId)).toEqual(found.sites.map((s) => s.id));

    const bundle = buildBundle({
      ...request,
      captureFormat: capture.format,
      sites: found.sites,
      geometryBySite: Object.fromEntries(found.sites.map((s) => [s.id, library])),
      assemblyTransform: alignment.transform,
      jaw: { mesh: jaw.mesh, originalBytes: jawFile, format: 'ply' },
      alignment,
    });
    commonChecks(bundle, found.sites);
    expect(worstReplacementError(bundle, found.sites, (s) => c.frames[s.componentIndex!]!)).toBeLessThan(0.02);
  });

  it('position file + capture mesh: link shells, guided clicks 1-2-3, export with the file frames unchanged', { timeout: 20_000 }, () => {
    const labels = ['36', '34', '44', '46'];
    const { sites, format } = parsePositions(encodeScanAdaptorXML(c.frames, labels));
    const linked = linkSitesToComponents(sites, splitComponents(capture.mesh));
    expect(linked.map((s) => s.componentIndex)).toEqual([0, 1, 2, 3]);
    const components = splitComponents(capture.mesh);
    const parts = linked.map((s) => ({ siteId: s.id, mesh: components[s.componentIndex!]!.mesh }));

    // Three clicks in arch order, each 0.2 mm off the true top centre of its scan body.
    const clicks: LandmarkPair[] = orderSitesAlongArch(linked)
      .slice(0, 3)
      .map((site, k) => {
        const source = guidePoint(site, c.body);
        const target = transformPoint(c.captureToJaw, source);
        return { source, target: [target[0] + 0.2 * Math.cos(k), target[1] + 0.2 * Math.sin(k), target[2]] };
      });
    const alignment = alignFromLandmarks(parts, target, clicks);
    expect(alignment.method).toBe('landmarks');
    expect(alignment.status).toBe('good');

    const bundle = buildBundle({
      ...request,
      captureFormat: format,
      sites: linked,
      geometryBySite: Object.fromEntries(linked.map((s) => [s.id, library])),
      assemblyTransform: alignment.transform,
      jaw: { mesh: jaw.mesh, originalBytes: jawFile, format: 'ply' },
      alignment,
    });
    commonChecks(bundle, linked);
    // The file is the authority on the frames: they reach report.json exactly as read.
    bundle.report.sites.forEach((s, i) => expect(s.implantToCapture).toEqual(Array.from(c.frames[i]!)));
    expect(worstReplacementError(bundle, linked, (s) => c.frames[linked.indexOf(s)]!)).toBeLessThan(0.02);
  });
});
