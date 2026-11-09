/**
 * Integration review, workspace lifecycle: re-measure and the align worker, export state, case reset and dispose.
 * The real App / AlignStep / Motion methods run on objects built without their DOM constructors (Object.create plus
 * the fields those methods read, fake DOM from ./fake-dom); the real AlignClient talks to the real align handler
 * in process. Tests named "BUG:" fail on purpose until the production code is fixed. Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { maxAbsDiff } from '../../core/mat4';
import type { AlignmentFlag, AlignmentResult, Mat4 } from '../../core/types';
import { AlignClient, type WorkerLike } from '../../align/client';
import { createAlignHandler } from '../../align/handler';
import { buildIcpTarget } from '../../align/icp';
import { measureManualPose } from '../../align/metrics';
import type { AlignRequest } from '../../align/protocol';
import { freshCase, Store, type CaseState } from '../../state/case';
import { App } from '../../ui/app';
import en from '../../ui/i18n/en';
import { Motion } from '../../ui/motion';
import { AlignStep } from '../../ui/step-align';
import { GeometryStep } from '../../ui/step-geometry';
import { makeSyntheticCase } from '../fixtures';
import { fakeElement, installFakeDom, renderedChildren, type FakeElement } from './fake-dom';

installFakeDom();

const c = makeSyntheticCase({ implants: 4, seed: 3, noiseSigmaMm: 0.01 });
let auto: AlignmentResult;

beforeAll(() => {
  const m = measureManualPose(c.parts, buildIcpTarget(c.jaw), c.captureToJaw);
  auto = { ...m, method: 'auto', flags: ['visualCheckRequired'] };
}, 30_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A pad step: the same pose moved `mm` along X (row-major: m[3] is x). */
const nudge = (m: Mat4, mm: number): Mat4 => { const out = Float64Array.from(m); out[3] = out[3]! + mm; return out; };

/** Step 4 of a case aligned automatically: jaw loaded, every site with a geometry. */
const caseStore = (): Store<CaseState> => new Store<CaseState>({
  ...freshCase('lower'), sites: c.sites, geometryBySite: Object.fromEntries(c.sites.map((s) => [s.id, 'g'])),
  jaw: { mesh: c.jaw, originalBytes: new Uint8Array(84), format: 'stl' }, assembly: auto.transform, alignment: auto,
  lastAlignedPose: auto.transform, step: 4,
});

/** The App surface AlignStep's methods read. */
function fakeApp(store: Store<CaseState>, align: unknown, extra: Record<string, unknown> = {}) {
  return {
    store, get s(): CaseState { return store.state; }, align, parts: () => c.parts, viewer: null, lang: 'en' as const, c: en, hook: '', geometryName: () => 'G',
    say: { say: vi.fn() }, stage: { setDisplay: vi.fn() }, error: vi.fn(), render: vi.fn(), toasts: { show: vi.fn() }, ...extra,
  };
}

interface StepInternals {
  removeJaw(): void;
  undo(): void;
  commitPose(m: Mat4): void;
  doExport(): Promise<void>;
  renderJaw(): void;
  jawWarnings: unknown[];
  exportUrl: string | null;
  pane3: FakeElement;
  pane4: FakeElement;
}

/** An AlignStep without its DOM constructor: the fields a constructed one starts with. */
function alignStep(app: unknown): StepInternals {
  const step = Object.create(AlignStep.prototype) as StepInternals;
  Object.assign(step, {
    app, alignJob: null, jawJob: null, measureJob: null, measureTimer: 0, poseMoved: false, alignedResult: auto, mapShown: true, guided: null,
    exportUrl: null, exportLine: '', resultKey: null, jawWarnings: [], sampleJaw: null, exportName: '', pane3: fakeElement(), pane4: fakeElement(),
  });
  return step;
}

/**
 * The real AlignClient over the real align handler, one in-process "worker" per spawn. Messages wait in an inbox
 * until work() plays the worker thread, so a test can act while a call is in flight (fake timers on).
 */
function alignHarness(): { align: AlignClient; work: () => Promise<void>; jawBuilds: () => number } {
  let builds = 0;
  const workers: { inbox: AlignRequest[]; dead: boolean; handle: (m: AlignRequest) => void }[] = [];
  const align = new AlignClient((): WorkerLike => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const w = { inbox: [] as AlignRequest[], dead: false, handle: createAlignHandler((m) => { if (!w.dead) for (const l of listeners) l({ data: m } as MessageEvent); }) };
    workers.push(w);
    return {
      postMessage: (m) => void w.inbox.push(m as AlignRequest),
      addEventListener: (type, l) => { if (type === 'message') listeners.push(l as (e: MessageEvent) => void); },
      terminate: () => { w.dead = true; },
    };
  });
  const work = async (): Promise<void> => {
    for (let round = 0; round < 8; round++) {
      for (const w of workers) while (!w.dead && w.inbox.length) { const m = w.inbox.shift()!; if (m.type === 'setJaw') builds++; w.handle(m); }
      await vi.advanceTimersByTimeAsync(0);
    }
  };
  return { align, work, jawBuilds: () => builds };
}

describe('re-measure after a manual adjustment', () => {
  it('BUG: a second adjustment while the first one is being measured keeps the align worker and its jaw', { timeout: 30_000 }, async () => {
    vi.useFakeTimers();
    const { align, work, jawBuilds } = alignHarness();
    const ready = align.setJaw(c.jaw);
    await work();
    await ready;
    const store = caseStore();
    const app = fakeApp(store, align);
    const step = alignStep(app);
    step.commitPose(nudge(auto.transform, 1)); // pad click 1 -> scheduleMeasure(true)
    await vi.advanceTimersByTimeAsync(260); // 250 ms later the measure is posted; the worker is busy with it
    step.commitPose(nudge(auto.transform, 2)); // pad click 2 while it runs -> measureJob.abort() -> worker.terminate()
    await vi.advanceTimersByTimeAsync(260);
    await work();
    expect(app.error).not.toHaveBeenCalled();
    expect(store.state.measuring).toBe(false);
    expect(maxAbsDiff(store.state.alignment!.transform, nudge(auto.transform, 2))).toBe(0);
    // Today the respawned worker gets the jaw again and rebuilds its whole target (samples, k-d tree, triangle
    // tree): ~1.9 s for a 1 M-triangle jaw (~6 s at the 3 M limit) against ~40 ms for the measure itself, so
    // quick adjustments keep "Measuring…" (and the export button) blocked while the CPU rebuilds.
    expect(jawBuilds()).toBe(1);
    align.dispose();
  });

  it('BUG: "Remove" in step 3 releases the jaw: the align worker no longer measures against it', { timeout: 30_000 }, async () => {
    vi.useFakeTimers();
    const { align, work } = alignHarness();
    const ready = align.setJaw(c.jaw);
    await work();
    await ready;
    const store = caseStore();
    const step = alignStep(fakeApp(store, align, { stage: { setDisplay: vi.fn(), update: vi.fn() } }));
    step.removeJaw();
    expect(store.state.jaw).toBeNull();
    const probe = align.measure(c.parts, auto.transform).then(() => 'measured against the removed jaw', (e: unknown) => e);
    await work();
    // Today neither removeJaw nor App.resetCase (New case, sample, new capture) tells the AlignClient: it keeps the
    // mesh to re-send and its worker keeps the jaw's whole target (samples, k-d tree, triangle tree; hundreds of MB
    // at the 3 M-triangle limit) until the next jaw or leaving the page.
    expect(await probe).toMatchObject({ code: 'INSUFFICIENT_DATA' });
    align.dispose();
  });

  it('BUG: Undo back to the automatic pose before the re-measure keeps method "auto" (no "Adjusted by hand" in the ZIP)', async () => {
    vi.useFakeTimers();
    // what the worker's measureManualPose answers: method 'manual' + flag 'manualPose' (mergeMeasured decides)
    const align = {
      measure: vi.fn(async (_parts: unknown, pose: Mat4): Promise<AlignmentResult> => ({ ...auto, method: 'manual', flags: ['visualCheckRequired', 'manualPose'] as AlignmentFlag[], transform: pose })),
      deviation: vi.fn(async () => new Map<string, Float32Array>()),
    };
    const store = caseStore();
    const step = alignStep(fakeApp(store, align));
    step.commitPose(nudge(auto.transform, 1)); // a pad click...
    step.undo(); // ...undone (Ctrl+Z) within the 250 ms debounce
    await vi.advanceTimersByTimeAsync(300);
    expect(align.measure).toHaveBeenCalledTimes(1);
    expect(maxAbsDiff(store.state.assembly, auto.transform)).toBe(0); // the pose IS the automatic one
    // Today poseMoved stays true through the undo, so the export's report says method "manual" + manualPose and
    // step 4 warns "adjusted by hand" for an untouched automatic result.
    expect(store.state.alignment!.method).toBe('auto');
    expect(store.state.alignment!.flags).not.toContain('manualPose');
  });
});

describe('export state', () => {
  it('BUG: a pose change while the ZIP is being built keeps the leave guard armed (that ZIP has the old pose)', async () => {
    vi.useFakeTimers();
    let finish!: (r: { zipName: string; zip: Uint8Array }) => void;
    const jobs = { run: vi.fn(() => new Promise((resolve) => { finish = resolve; })) };
    const store = caseStore();
    const app = fakeApp(store, { measure: vi.fn(() => new Promise(() => {})), deviation: vi.fn() }, {
      jobs, busy: () => ({ set() {}, done() {} }), clearAlerts: vi.fn(), later: vi.fn(),
      loadGeometry: vi.fn(async () => null), replacement: () => ({ id: 'g', name: 'G', mesh: c.body }),
    });
    const step = alignStep(app);
    const exporting = step.doExport();
    await vi.advanceTimersByTimeAsync(0); // request built and posted: "Preparing ZIP…" (seconds for a large jaw)
    expect(jobs.run).toHaveBeenCalledTimes(1);
    step.commitPose(nudge(auto.transform, 1)); // the stage stays live meanwhile: the user nudges the set
    finish({ zipName: 'DDT-Xchange_lower_export.zip', zip: new Uint8Array(22) });
    await exporting;
    const sent = (jobs.run.mock.calls[0] as unknown as [{ request: { assemblyTransform: Mat4 } }])[0].request;
    expect(maxAbsDiff(sent.assemblyTransform, auto.transform)).toBe(0); // the ZIP holds the pose before the nudge
    // Today exportedSinceChange becomes true anyway: leaving no longer asks, "Download again" serves the old pose.
    expect(store.state.exportedSinceChange).toBe(false);
    if (step.exportUrl) URL.revokeObjectURL(step.exportUrl);
  });
});

describe('new case', () => {
  it("BUG: a new case (New case, sample, another capture) does not show the previous jaw scan's warnings in step 3", () => {
    const store = caseStore();
    const step = alignStep(fakeApp(store, {}));
    step.jawWarnings = [fakeElement({ textContent: 'Large jaw scan: 2,100,000 triangles.' })]; // loadJaw: r.warnings -> noteCard
    const app = Object.create(App.prototype) as App;
    Object.assign(app, {
      store, alignStep: step, jobs: { cancelAll: vi.fn() }, meshCache: new Map(), geometry: { target: 'one', clearCaseNotes: vi.fn() }, capture: { clearWarnings: vi.fn() },
      viewer: null, root: fakeElement(), selected: null, jawNormals: null, componentData: [],
    });
    app.resetCase('lower'); // what [New case], loadSample and CaptureStep.apply call
    expect(store.state.jaw).toBeNull();
    step.renderJaw(); // part of every App.render()
    // Today AlignStep.jawWarnings survives resetCase, so every render puts the old jaw's notes back.
    expect(renderedChildren(step.pane3.querySelector('[data-notes="3"]')).map((n) => n.textContent)).toEqual([]);
  });
});

describe('dispose (astro:before-swap)', () => {
  it('BUG: dispose revokes every blob URL the workspace created (both export ZIPs and the library file)', async () => {
    vi.useFakeTimers();
    const created: string[] = [];
    const revoked = new Set<string>();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const u = `blob:test/${created.length + 1}`; created.push(u); return u; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.add(u));
    // The App, without its DOM constructor, holding what dispose() releases.
    const app = Object.create(App.prototype) as App;
    const ac = new AbortController();
    Object.assign(app, {
      ac, signal: ac.signal, timers: new Set<number>(), meshCache: new Map(), viewer: null, section: fakeElement(), capture: {},
      motion: { dispose: vi.fn() }, say: { dispose: vi.fn() }, toasts: { dispose: vi.fn() }, align: { dispose: vi.fn() },
      jobs: { dispose: vi.fn() }, stage: { dispose: vi.fn() }, library: { close: vi.fn() },
    });
    const later = (fn: () => void, ms: number): void => App.prototype.later.call(app, fn, ms);
    const zip = { zipName: 'DDT-Xchange_lower_export.zip', zip: new Uint8Array(22) };
    const step = alignStep(fakeApp(caseStore(), {}, {
      jobs: { run: vi.fn(async () => zip) }, busy: () => ({ set() {}, done() {} }), clearAlerts: vi.fn(), later,
      loadGeometry: vi.fn(async () => null), replacement: () => ({ id: 'g', name: 'G', mesh: c.body }),
    }));
    const lib = Object.create(GeometryStep.prototype) as { exportLibrary(): Promise<void> };
    Object.assign(lib, {
      app: { library: { entriesForExport: async () => [] }, jobs: { run: async () => new Uint8Array(10) }, later, toasts: { show() {} }, c: en, error: vi.fn() },
      libUrl: null, notes: [],
    });
    Object.assign(app, { alignStep: step, geometry: lib });
    await step.doExport(); // ZIP 1
    await step.doExport(); // ZIP 2: ZIP 1's URL goes to later(revoke, 60 s)
    await lib.exportLibrary(); // ddt-xchange-geometries.json: revoke in 60 s
    app.dispose(); // astro:before-swap within that minute
    vi.runAllTimers();
    expect(created).toHaveLength(3);
    // Today only ZIP 2 is revoked (AlignStep.dispose); dispose clears the later() timers (and later() checks the
    // aborted signal) and never calls GeometryStep.dispose(). With the ClientRouter the document lives on, so the
    // blobs (a ZIP can be 512 MB) stay in memory until a full reload.
    expect(created.filter((u) => !revoked.has(u))).toEqual([]);
  });

  it('BUG: finished UI animations are released (200 re-measures do not pile up 600 count-up tweens and their old nodes)', () => {
    const motion = new Motion(false, fakeElement() as unknown as Element);
    // AlignStep.renderResult on every re-measure: a new result box with three count-ups (RMS, P95, coverage)
    for (let i = 0; i < 200; i++) for (let k = 0; k < 3; k++) motion.count(fakeElement() as unknown as HTMLElement, 42, String);
    for (const t of motion.ctx.getTweens()) t.progress(1); // all of them done
    // gsap.context keeps every animation it ever recorded until revert(): each holds its onUpdate closure and so
    // its (detached) element, for as long as the workspace stays mounted. Same for the Viewer's pose/camera tweens.
    expect((motion.ctx as unknown as { data: unknown[] }).data.length).toBeLessThan(50);
    motion.dispose();
  });
});
