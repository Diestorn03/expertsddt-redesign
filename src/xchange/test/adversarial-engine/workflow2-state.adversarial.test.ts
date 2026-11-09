/**
 * Adversarial review of the engine slices after 3d10f75 (workflow2-export, with positions-shells): "No exchange", the
 * alignedWith rule and the export. Real state / step code on objects built without their DOM constructors (the pattern
 * of test/ux/workflow2.ux.test.ts), the fake DOM of ../adversarial/fake-dom. Fixed with the review findings: they now
 * guard against regressions. Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fromTranslation, identity, multiply } from '../../core/mat4';
import { countTriangles } from '../../core/mesh';
import { writeBinarySTL } from '../../core/stl-writer';
import type { AlignmentResult, AssemblyPart, ImplantSite, Mat4, ReplacementGeometry } from '../../core/types';
import { buildIcpTarget, type IcpTarget } from '../../align/icp';
import { measureManualPose } from '../../align/metrics';
import { buildBundle } from '../../export/bundle';
import { capturedBodies, exchangedSites, freshCase, shownDeviation, Store, type CaseState } from '../../state/case';
import { readCapture, runJob, type DetectResult, type JobRequest } from '../../state/jobs-handler';
import { App } from '../../ui/app';
import en from '../../ui/i18n/en';
import { CaptureStep } from '../../ui/step-capture';
import { GeometryStep } from '../../ui/step-geometry';
import { AlignStep } from '../../ui/step-align';
import { makeSyntheticCase, placeBodies } from '../fixtures';
import { capWithInsert } from '../fixtures/detect';
import { encodeMicronMapperExport, utf8 } from '../fixtures/positions';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

const { document: doc } = installFakeDom();
Object.assign(doc, {
  createElement: (tag: string): FakeElement => fakeElement({ tag, dataset: {} }),
  createElementNS: (_ns: string, tag: string): FakeElement => fakeElement({ tag }),
});
Object.assign(globalThis, { HTMLElement: class {}, CSS: { escape: (s: string) => s } });

const stlTriangles = (bytes: Uint8Array): number => (bytes.length - 84) / 50;

describe('"No exchange" exports the bodies of the positions file', () => {
  it('BUG: the insert inside each cap is dropped from <arch>_implant_position.stl (only the outer shells are kept)', () => {
    // Failure: readCapture hands the UI components[].mesh = the outer shell only (MeshComponent.inner is never passed
    // on), and capturedBodies / keepBodies build the "No exchange" geometry from it; planAssembly keeps the inserts.
    const c = makeSyntheticCase({ implants: 4, seed: 5 });
    const { body } = capWithInsert();
    const r = readCapture([
      { bytes: utf8(encodeMicronMapperExport(c.frames, 'BTH')), extension: 'csv' },
      { bytes: writeBinarySTL(placeBodies(c.frames, body)), extension: 'stl' },
    ]);
    expect(r.sites.every((s) => s.componentIndex !== undefined)).toBe(true); // "No exchange" is offered
    const kept = capturedBodies(r.sites, r.components!.map((x) => x.mesh), en.s2.fileBody);
    const geometryBySite: Record<string, ReplacementGeometry> = Object.fromEntries([...kept].map(([id, g]) => [id, { id: 'capture', name: g.name, mesh: g.mesh }]));
    const { files } = buildBundle({
      arch: 'lower', captureFormat: r.format, sites: r.sites, geometryBySite, assemblyTransform: identity(),
      createdAt: '2026-11-09T12:00:00.000Z', appVersion: '0.1.0',
    });
    expect(files[0]!.name).toBe('lower_implant_position.stl');
    expect(stlTriangles(files[0]!.bytes)).toBe(4 * countTriangles(body)); // what the positions STL holds: caps + inserts
  });
});

describe('"Captured scan bodies" (Surfaces to match) is not an exchange', () => {
  it('BUG: aligning with the captured bodies reads as "exchanged after aligning" with nothing exchanged (note, README, report notes)', () => {
    // Failure: state/case alignedBody returns CAPTURE_BODY_ID for any 'capture' alignment, so exchangedSites compares the
    // file's bodies with the geometry picked BEFORE aligning: step 4 shows al.exchanged ("…the color map is not drawn
    // on the exchanged geometry", while shownDeviation does draw it on the captured shells) and the export says the
    // geometry "was exchanged after aligning".
    const c = makeSyntheticCase({ implants: 3, seed: 2 });
    const geometryBySite = Object.fromEntries(c.sites.map((x) => [x.id, 'lib-cap']));
    const alignment = { transform: identity(), method: 'auto', rmsMm: 0.02, p95Mm: 0.04, coverage: 0.98, visible: 0.7, toleranceMm: 0.1, perSite: [], status: 'good', flags: ['visualCheckRequired'] } satisfies AlignmentResult;
    const s: CaseState = { ...freshCase('lower'), sites: c.sites, components: c.parts.map((p) => p.mesh), geometryBySite, alignment, alignedWith: { surfaces: 'capture', geometryBySite }, deviation: new Map() };
    expect(shownDeviation(s)).not.toBeNull(); // the map is drawn on the captured shells
    expect(exchangedSites(s)).toEqual([]); // the geometry is the one in place when aligning
  });
});

describe('a capture re-detected with another reference (step 1) after "No exchange" or an alignment', () => {
  const c = makeSyntheticCase({ implants: 4, seed: 3, noiseSigmaMm: 0.01 });
  const components = c.parts.map((p) => p.mesh); // mesh-only capture: site i sits on body i
  /** What the second reference gives: the same bodies, the implant frames 0.5 mm along their axes (another datum). */
  const redetected: ImplantSite[] = c.sites.map((s) => ({ ...s, matrix: multiply(s.matrix, fromTranslation([0, 0, 0.5])) }));
  let target: IcpTarget;
  let auto: AlignmentResult;
  beforeAll(() => {
    target = buildIcpTarget(c.jaw);
    auto = { ...measureManualPose(c.parts, target, c.captureToJaw), method: 'auto', flags: ['visualCheckRequired'] };
  }, 30_000);
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function workspace() {
    const store = new Store<CaseState>({ ...freshCase('lower'), sites: c.sites, components, captureMesh: c.captureMesh, referenceId: 'ref-1', step: 2 });
    const app = Object.create(App.prototype) as App;
    const timers: (() => void)[] = [];
    const measure = vi.fn(async (parts: AssemblyPart[], pose: Mat4): Promise<AlignmentResult> => ({ ...measureManualPose(parts, target, pose), method: 'manual', flags: ['visualCheckRequired', 'manualPose'] }));
    Object.assign(app, {
      store, c: en, lang: 'en', meshCache: new Map(), partsKey: [], partsCache: [], selected: null, focusKey: null, shown: 2,
      library: { meta: () => undefined, get: async () => null, list: () => [], size: 0 },
      viewer: { setDeviation: vi.fn(), setAssembly: vi.fn(), finishPose: vi.fn(), view: vi.fn() },
      root: fakeElement(), say: { say: vi.fn() }, toasts: { show: vi.fn(), clear: vi.fn() }, motion: { count() {}, chip() {}, rows() {} },
      stage: { setDisplay: vi.fn(), update: vi.fn() }, render: vi.fn(), syncSites: vi.fn(), error: vi.fn(), clearAlerts: vi.fn(),
      busy: () => ({ set() {}, done() {} }), later: (fn: () => void) => void timers.push(fn), go: vi.fn((n: number) => { app.shown = n as never; store.set({ step: n as never }); }),
      loadGeometry: vi.fn(async () => ({ mesh: c.body, normals: new Float32Array(c.body.positions.length) })),
      align: { measure, deviation: vi.fn(async (parts: AssemblyPart[]) => new Map(parts.map((p) => [p.siteId, new Float32Array(p.mesh.positions.length / 3)]))) },
      jobs: { run: vi.fn(async (job: JobRequest) => (job.type === 'detect' ? ({ sites: redetected, unresolved: [], warnings: [] } satisfies DetectResult) : runJob(job, []))) },
    });
    const geometry = Object.create(GeometryStep.prototype) as GeometryStep;
    Object.assign(geometry, { app, target: 'all', notes: [], pane: fakeElement(), query: '', renaming: null, removing: null });
    const capture = Object.create(CaptureStep.prototype) as CaptureStep;
    Object.assign(capture, { app, pane: fakeElement(), warnings: [], mixed: null, rowsKey: '', job: null });
    const step = Object.create(AlignStep.prototype) as AlignStep;
    Object.assign(step, {
      app, alignJob: null, jawJob: null, measureJob: null, measureTimer: 0, alignedResult: null, mapShown: true, guided: null,
      exportUrl: null, exportLine: '', resultKey: null, jawWarnings: [], sampleJaw: null, exportName: '', pane3: fakeElement(), pane4: fakeElement(),
    });
    Object.assign(app, { geometry, capture, alignStep: step });
    return { app, store, geometry, capture, timers, measure };
  }

  it('BUG: "No exchange" picked again after the re-detection keeps the body built for the old frames: it sits 0.5 mm off its scan', async () => {
    // Failure: keepBodies keeps an existing case geometry `capture:<site id>` (`if (!caseGeometries.has(g.id))`), and
    // app.meshCache is keyed by the same id; the site ids repeat after a re-detection, the frames do not.
    const { app, store, geometry, capture } = workspace();
    geometry.keepBodies();
    app.parts(); // the viewer and the alignment read the meshes once (meshCache)
    await capture.detect('ref-2');
    expect(store.state.sites).toBe(redetected);
    geometry.keepBodies();
    const parts = app.parts();
    parts.forEach((p, i) => {
      const shell = components[i]!.positions;
      expect(Math.max(...p.mesh.positions.map((v, k) => Math.abs(v - shell[k]!)))).toBeLessThan(1e-4); // back at its site it is the file's body
    });
  });

  it('BUG: the alignment made with the old frames survives the re-detection: the pick goes straight to step 4 and nothing is re-measured', async () => {
    // Failure: detect() replaces the sites (and clears geometryBySite) but keeps alignment / alignedWith / assembly; since
    // workflow2-export, onGeometryChanged no longer re-measures and stepAfterGeometry jumps back to step 4, so the result
    // card, the export gate and report.json (matchesExport true) carry metrics measured at implant frames that are gone.
    vi.useFakeTimers();
    const { store, geometry, capture, timers, measure } = workspace();
    geometry.keepBodies();
    timers.length = 0;
    store.set({ jaw: { mesh: c.jaw, originalBytes: new Uint8Array(84), format: 'stl' }, assembly: auto.transform, alignment: auto, alignedWith: { surfaces: 'replacement', geometryBySite: store.state.geometryBySite }, lastAlignedPose: auto.transform, step: 4 });
    await capture.detect('ref-2');
    geometry.keepBodies();
    timers.forEach((t) => t());
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.state.step).toBe(4);
    const fresh = store.state.alignment === null || measure.mock.calls.length > 0;
    expect(fresh).toBe(true);
  });
});
