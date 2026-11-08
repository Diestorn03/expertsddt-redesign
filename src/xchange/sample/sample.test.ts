/**
 * The in-browser sample case (UI-DESIGN §10): deterministic, within its triangle and time budgets, an All-on-4 upper
 * arch, and a believable case for the real pipeline: 4/4 positions read from the CSV, the jaw's scanned scan bodies
 * detected 4/4 as the offered geometry, auto align good at a few µm, export with the jaw byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { getColumn, rotationAngleBetween, transformPoint } from '../core/mat4';
import { computeBounds, countTriangles } from '../core/mesh';
import { distance, dot } from '../core/vec3';
import { buildIcpTarget } from '../align/icp';
import { multiStartAlign } from '../align/multistart';
import { recoverSitesFromMesh } from '../detect/sites';
import { buildBundle } from '../export/bundle';
import { alignmentParts } from '../state/case';
import { readCapture, readJaw } from '../state/jobs-handler';
import { makeSample } from './index';

const DEG = Math.PI / 180;
const sample = makeSample();
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** CPU time of this test process (ms): the full suite runs dozens of files at once, which stretches wall time, not work. */
function cpuMs(): number {
  const p = (globalThis as { process?: { cpuUsage(): { user: number; system: number } } }).process;
  if (!p) return performance.now();
  const u = p.cpuUsage();
  return (u.user + u.system) / 1000;
}

describe('sample case generator', () => {
  it('is deterministic: the same bytes every time', () => {
    const again = makeSample();
    expect(sameBytes(again.csv, sample.csv)).toBe(true);
    expect(sameBytes(again.jaw, sample.jaw)).toBe(true);
    expect(Array.from(again.body.positions)).toEqual(Array.from(sample.body.positions));
  });

  it('is generated in well under 300 ms of CPU (warm; about 120 ms, 200 ms cold in Chrome)', () => {
    makeSample();
    const times = [0, 1, 2, 3, 4].map(() => { const t0 = cpuMs(); makeSample(); return cpuMs() - t0; });
    expect(Math.min(...times)).toBeLessThan(300);
  });

  it('is a colored upper-arch scan of 250-600 k triangles, about the size of a real one', () => {
    const jaw = readJaw({ bytes: sample.jaw, extension: 'ply' });
    expect(sample.arch).toBe('upper');
    expect(jaw.format).toBe('ply');
    expect(jaw.warnings).toEqual([]);
    expect(jaw.mesh.colors?.length).toBe(jaw.mesh.positions.length);
    const triangles = countTriangles(jaw.mesh);
    expect(triangles).toBeGreaterThanOrEqual(250_000);
    expect(triangles).toBeLessThanOrEqual(600_000);
    const { min, max } = computeBounds(jaw.mesh);
    expect(max[0] - min[0]).toBeGreaterThan(60); // arch width, vestibule to vestibule
    expect(max[0] - min[0]).toBeLessThan(85);
    expect(max[1] - min[1]).toBeGreaterThan(45); // lip to the back of the palate
    expect(max[1] - min[1]).toBeLessThan(70);
  });

  it('places All-on-4: two near-straight anterior implants, two posterior ones tilted ~30° distally', () => {
    const occlusal = [0, 0, -1] as const; // upper arch
    const tilts = sample.truth.frames.map((f) => Math.acos(dot(getColumn(f, 2), occlusal)) / DEG);
    expect(tilts[1]).toBeLessThan(12);
    expect(tilts[2]).toBeLessThan(12);
    for (const k of [0, 3]) {
      expect(tilts[k]).toBeGreaterThan(26);
      expect(tilts[k]).toBeLessThan(34);
      expect(getColumn(sample.truth.frames[k]!, 2)[1]).toBeGreaterThan(0.3); // leans toward posterior (+Y)
    }
  });

  it('offers a generic CAD scan body: ~4.8 mm wide, 10 mm tall, index flat on +X', () => {
    const { min, max } = computeBounds(sample.body);
    expect(max[1] - min[1]).toBeCloseTo(4.8, 5);
    expect(max[2] - min[2]).toBeCloseTo(10, 5);
    expect(-min[0]).toBeCloseTo(2.4, 5);
    expect(max[0]).toBeCloseTo(1.804, 3); // the flat
  });
});

describe('sample case through the real pipeline', () => {
  it('reads 4/4 positions, detects the 4 scanned scan bodies, aligns them at a few µm and exports', { timeout: 120_000 }, () => {
    const capture = readCapture([{ bytes: sample.csv, extension: 'csv' }]);
    expect(capture.format).toBe('micronmapper-csv');
    expect(capture.warnings).toEqual([]);
    expect(capture.sites.map((s) => s.label)).toEqual(['AXO01', 'AXO02', 'AXO03', 'AXO04']);
    const jaw = readJaw({ bytes: sample.jaw, extension: 'ply' });

    // the scan bodies in the jaw scan are the offered geometry, standing where the truth puts them
    const found = recoverSitesFromMesh(jaw.mesh, { mesh: sample.body });
    expect(found.sites).toHaveLength(4);
    for (const truth of sample.truth.frames) {
      const site = found.sites.find((s) => distance(getColumn(s.matrix, 3), getColumn(truth, 3)) < 0.05);
      expect(site, 'a detected body at every implant').toBeDefined();
      expect(rotationAngleBetween(site!.matrix, truth)).toBeLessThan(0.5 * DEG); // axis and index flat
      expect(site!.flags).toEqual({});
    }

    const parts = alignmentParts(capture.sites, () => sample.body, [], 'replacement');
    const auto = multiStartAlign(parts, buildIcpTarget(jaw.mesh));
    expect(auto.status).toBe('good');
    expect(auto.rmsMm).toBeLessThan(0.01);
    expect(auto.coverage).toBeGreaterThan(0.95);
    expect(rotationAngleBetween(auto.transform, sample.truth.captureToJaw)).toBeLessThan(0.05 * DEG);
    capture.sites.forEach((s, i) => {
      const placed = transformPoint(auto.transform, getColumn(s.matrix, 3));
      expect(distance(placed, getColumn(sample.truth.frames[i]!, 3))).toBeLessThan(0.02);
    });

    const geometry = { id: 'sample-body', name: 'Sample scan body', mesh: sample.body };
    const bundle = buildBundle({
      arch: sample.arch, captureFormat: 'demo', sites: capture.sites, geometryBySite: Object.fromEntries(capture.sites.map((s) => [s.id, geometry])),
      assemblyTransform: auto.transform, jaw: { mesh: jaw.mesh, originalBytes: jaw.originalBytes, format: jaw.format }, alignment: auto,
      createdAt: '2026-11-08T12:00:00Z', appVersion: '1.0.0',
    });
    expect(bundle.zipName).toBe('DDT-Xchange_upper_export.zip');
    expect(bundle.report.alignment?.matchesExport).toBe(true);
    expect(sameBytes(bundle.files.find((f) => f.name === 'jaw.ply')!.bytes, sample.jaw)).toBe(true);
  });
});
