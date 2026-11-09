/**
 * Fernando's workflow 2 through the real step code (UI-DESIGN §5.2, §5.4, §5.6): "No exchange" keeps each implant's
 * own body from the positions file, the alignment is made with them, and an exchange afterwards only changes what is
 * exported: no re-measure with the new geometry (it is not the body the scan shows: before, the fit read weak and the
 * implants "No match"), back to step 4 with a note, the map off the exchanged parts, report.json matchedWith. The real
 * App / GeometryStep / AlignStep methods on objects built without their DOM constructors (the workspace-lifecycle
 * pattern), the real jobs handler for the ZIP; the fake DOM of ../adversarial/fake-dom. Synthetic data only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fromTranslation, multiply } from '../../core/mat4';
import type { AlignmentFlag, AlignmentResult, AssemblyPart, Mat4, TriMesh } from '../../core/types';
import { buildIcpTarget, type IcpTarget } from '../../align/icp';
import { measureManualPose } from '../../align/metrics';
import { alignmentParts, captureGeometryId, freshCase, Store, type CaseState } from '../../state/case';
import { runJob, type JobRequest } from '../../state/jobs-handler';
import { App } from '../../ui/app';
import en from '../../ui/i18n/en';
import es from '../../ui/i18n/es';
import { GeometryStep } from '../../ui/step-geometry';
import { AlignStep } from '../../ui/step-align';
import { makeRevolutionBody, makeSyntheticCase } from '../fixtures';
import { fakeElement, installFakeDom, renderedChildren, type FakeElement } from '../adversarial/fake-dom';

const { document: doc } = installFakeDom();
Object.assign(doc, {
  createElement: (tag: string): FakeElement => fakeElement({ tag, dataset: {} }),
  createElementNS: (_ns: string, tag: string): FakeElement => fakeElement({ tag }),
});
Object.assign(globalThis, { HTMLElement: class {}, CSS: { escape: (s: string) => s } }); // fillKeep's focus check

const c = makeSyntheticCase({ implants: 4, seed: 3, noiseSigmaMm: 0.01 });
const components = c.parts.map((p) => p.mesh); // the positions STL: site i = body i
/** What the lab wants on the implants instead: a healing cap the jaw scan does not show. */
const healingCap: TriMesh = makeRevolutionBody({ radius: 2.9, height: 4 });
let target: IcpTarget;
let auto: AlignmentResult;

beforeAll(() => {
  target = buildIcpTarget(c.jaw);
  const m = measureManualPose(c.parts, target, c.captureToJaw);
  auto = { ...m, method: 'auto', flags: ['visualCheckRequired'] };
}, 30_000);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const texts = (el: FakeElement): string[] => [String(el.textContent), ...renderedChildren(el).flatMap(texts)].filter(Boolean);
/** The worker's measureManualPose, as AlignClient.measure answers it. */
const measure = vi.fn(async (parts: AssemblyPart[], pose: Mat4): Promise<AlignmentResult> => ({
  ...measureManualPose(parts, target, pose), method: 'manual', flags: ['visualCheckRequired', 'manualPose'] as AlignmentFlag[],
}));

/**
 * The workspace in step 2 of a case whose capture holds a CSV and its positions STL (every site linked to its body).
 * `aligned`: already aligned with the bodies of the file ("No exchange"), jaw loaded.
 */
function workspace(lang: 'en' | 'es', aligned: boolean) {
  const store = new Store<CaseState>({ ...freshCase('lower'), sites: c.sites, components, captureMesh: c.captureMesh, step: 2 });
  const app = Object.create(App.prototype) as App;
  const viewer = { setDeviation: vi.fn(), setAssembly: vi.fn(), finishPose: vi.fn() };
  const timers: (() => void)[] = [];
  const said: string[] = [];
  Object.assign(app, {
    store, c: lang === 'en' ? en : es, lang, meshCache: new Map(), partsKey: [], partsCache: [], selected: null, focusKey: null, shown: 2,
    library: { meta: () => (({ id: 'lib-cap', name: lang === 'en' ? 'Healing cap' : 'Pilar de cicatrización' }) as never), get: async () => healingCap, list: () => [], size: 0 },
    viewer, root: fakeElement(), say: { say: (t: string) => void said.push(t) }, toasts: { show: vi.fn(), clear: vi.fn() }, motion: { count() {}, chip() {}, rows() {} },
    stage: { setDisplay: vi.fn(), update: vi.fn() }, render: vi.fn(), syncSites: vi.fn(), error: vi.fn(), clearAlerts: vi.fn(),
    busy: () => ({ set() {}, done() {} }), later: (fn: () => void) => void timers.push(fn), go: vi.fn((n: number) => { app.shown = n as never; store.set({ step: n as never }); }),
    align: { measure, deviation: vi.fn(async (parts: AssemblyPart[]) => new Map(parts.map((p) => [p.siteId, new Float32Array(p.mesh.positions.length / 3)]))) },
    jobs: { run: vi.fn(async (job: JobRequest) => runJob(job, [])) },
  });
  const geometry = Object.create(GeometryStep.prototype) as GeometryStep;
  Object.assign(geometry, { app, target: 'all', notes: [], pane: fakeElement(), query: '', renaming: null, removing: null });
  const step = Object.create(AlignStep.prototype) as AlignStep;
  Object.assign(step, {
    app, alignJob: null, jawJob: null, measureJob: null, measureTimer: 0, alignedResult: null, mapShown: true, guided: null,
    exportUrl: null, exportLine: '', resultKey: null, jawWarnings: [], sampleJaw: null, exportName: '', pane3: fakeElement(), pane4: fakeElement(),
  });
  Object.assign(app, { geometry, alignStep: step });
  if (aligned) {
    geometry.keepBodies();
    timers.length = 0;
    const kept = store.state.geometryBySite;
    store.set({ jaw: { mesh: c.jaw, originalBytes: new Uint8Array(84), format: 'stl' }, assembly: auto.transform, alignment: auto, alignedWith: { surfaces: 'replacement', geometryBySite: kept }, lastAlignedPose: auto.transform, step: 4 });
    Object.assign(step, { alignedResult: auto });
    app.shown = 4;
  }
  return { app, store, geometry, step, viewer, timers, said };
}

describe('step 2: "No exchange: use the bodies in the file"', () => {
  it('is offered first when every implant has its own body in the positions file, never for a position file alone', () => {
    const { app, geometry, store } = workspace('en', false);
    const list = fakeElement();
    geometry.renderList(list as unknown as HTMLElement, 'apply');
    const shown = texts(list);
    expect(shown[0]).toBe('In the positions file');
    expect(shown).toContain('No exchange: use the bodies in the file');
    expect(shown).toContain('Each implant keeps its own body from the positions file. Align with them, then exchange if you need to.');
    // its title is a sentence, shown whole (library names are cut with an ellipsis): the browser check found it cut
    const all = (el: FakeElement): FakeElement[] => [el, ...renderedChildren(el).flatMap(all)];
    const whole = all(list).filter((e) => e.classList.contains('xch__libmain--wrap'));
    expect(whole.map((e) => texts(e).includes('No exchange: use the bodies in the file'))).toEqual([true]);
    store.set({ components: [], captureMesh: null }); // a CSV alone: no body to keep
    geometry.renderList(list as unknown as HTMLElement, 'apply');
    expect(texts(list)).not.toContain('No exchange: use the bodies in the file');
    expect(app.c.s2.noExchange).not.toBe(es.s2.noExchange);
    expect(es.s2.noExchange).toBe('Sin intercambio: usar los cuerpos del archivo');
  });

  it('gives every implant its own captured body, completes step 2 and goes on to step 3 (no jaw yet)', () => {
    const { app, store, geometry, timers } = workspace('en', false);
    geometry.keepBodies();
    const s = store.state;
    expect(s.geometryBySite).toEqual(Object.fromEntries(c.sites.map((x) => [x.id, captureGeometryId(x.id)])));
    for (const site of c.sites) {
      const placed = alignmentParts([site], (id) => s.caseGeometries.get(s.geometryBySite[id]!)?.mesh, [], 'replacement')[0]!.mesh.positions;
      expect(Math.max(...placed.map((v, i) => Math.abs(v - components[site.componentIndex!]!.positions[i]!)))).toBeLessThan(1e-4); // at its site, it is the captured body
    }
    expect(app.toasts.show).toHaveBeenCalledWith('No exchange on all implants: the bodies of the file stay.', expect.anything());
    timers.forEach((t) => t());
    expect(app.go).toHaveBeenLastCalledWith(3);
  });

  it('with Selected implant, only that implant keeps its body', () => {
    const { app, store, geometry } = workspace('es', false);
    Object.assign(geometry, { target: 'one' });
    app.selected = 'site-2';
    geometry.keepBodies();
    expect(store.state.geometryBySite).toEqual({ 'site-2': 'capture:site-2' });
    expect(app.toasts.show).toHaveBeenCalledWith('Sin intercambio en el implante S2: se quedan los cuerpos del archivo.', expect.anything());
  });
});

describe('workflow 2: align with the bodies of the file, then exchange', () => {
  it('the exchange keeps the alignment: no re-measure, back to step 4, the note says what was aligned and what is exported', async () => {
    vi.useFakeTimers();
    const { app, store, geometry, step, timers } = workspace('en', true);
    // what the old rule showed: the healing cap measured against a scan of the file's bodies
    const old = measureManualPose(alignmentParts(c.sites, () => healingCap, [], 'replacement'), target, auto.transform);
    expect(old.status === 'weak' || old.status === 'failed').toBe(true);
    expect(auto.status).toBe('good');
    app.shown = 2;
    await geometry.apply('lib-cap');
    await vi.advanceTimersByTimeAsync(1000);
    expect(measure).not.toHaveBeenCalled();
    expect(store.state.alignment).toBe(auto); // the same result: status, metrics, per-implant table
    expect(store.state.measuring).toBe(false);
    timers.forEach((t) => t());
    expect(app.go).toHaveBeenLastCalledWith(4);
    const note = (step as unknown as { pane4: FakeElement }).pane4.querySelector('[data-exchanged]');
    (step as unknown as { renderAlign(): void }).renderAlign();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('Aligned with the bodies in the file · Exporting Healing cap. The exchange keeps this alignment: the position and the fit above are the ones measured with the bodies in the file, and the color map is not drawn on the exchanged geometry.');
    // a hand move is measured with the file's bodies still: the fit stays good
    (step as unknown as { commitPose(m: Mat4): void }).commitPose(multiply(fromTranslation([0.001, 0, 0]), auto.transform));
    await vi.advanceTimersByTimeAsync(300);
    expect(measure).toHaveBeenCalledTimes(1);
    const parts = measure.mock.calls[0]![0];
    parts.forEach((p, i) => expect(Math.max(...p.mesh.positions.map((v, k) => Math.abs(v - components[i]!.positions[k]!)))).toBeLessThan(1e-4));
    expect(store.state.alignment!.status).toBe('good');
    expect(store.state.alignedWith).toEqual({ surfaces: 'replacement', geometryBySite: Object.fromEntries(c.sites.map((x) => [x.id, captureGeometryId(x.id)])) });
  });

  it('the color map leaves the exchanged parts; Undo of the exchange brings it back', async () => {
    const { store, geometry, step, viewer } = workspace('en', true);
    store.set({ deviation: new Map(c.sites.map((x) => [x.id, new Float32Array(3)])) });
    await geometry.apply('lib-cap');
    expect(viewer.setDeviation).toHaveBeenLastCalledWith(null, 'replacement', expect.any(Function));
    store.set({ geometryBySite: { ...store.state.geometryBySite, 'site-1': captureGeometryId('site-1') } });
    step.onGeometryChanged();
    expect([...(viewer.setDeviation.mock.lastCall![0] as Map<string, unknown>).keys()]).toEqual(['site-1']);
  });

  it('the export: the main file, the exchanged geometry in place, report.json matchedWith the bodies of the file (ES copy)', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test/1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { app, geometry, step } = workspace('es', true);
    await geometry.apply('lib-cap');
    await (step as unknown as { doExport(): Promise<void> }).doExport();
    expect(app.error).not.toHaveBeenCalled();
    const job = (app.jobs.run as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Extract<JobRequest, { type: 'export' }>;
    const fileBody = { id: 'capture', name: 'Cuerpo del archivo' };
    expect(job.request.matchedWith).toEqual(Object.fromEntries(c.sites.map((x) => [x.id, fileBody])));
    const { report, files } = (await import('../../export/bundle')).buildBundle(job.request);
    expect(files[0]!.name).toBe('lower_implant_position.stl');
    expect(report.alignment!.perSite.map((p) => p.matchedWith)).toEqual(c.sites.map(() => fileBody));
    expect(report.sites.map((x) => x.geometry)).toEqual(c.sites.map(() => ({ id: 'lib-cap', name: 'Pilar de cicatrización' })));
    expect(report.alignment).toMatchObject({ status: 'good', matchesExport: true });
    const readme = new TextDecoder().decode(files.find((f) => f.name === 'README.txt')!.bytes);
    expect(readme).toContain('Alineado con los cuerpos del archivo de posiciones; se exporta Pilar de cicatrización.');
    // "No exchange" exported as is: the bodies of the file, id 'capture' in the report, no exchange line
    const kept = workspace('en', true);
    await (kept.step as unknown as { doExport(): Promise<void> }).doExport();
    const keptJob = (kept.app.jobs.run as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Extract<JobRequest, { type: 'export' }>;
    expect(Object.values(keptJob.request.geometryBySite).map((g) => [g.id, g.name])).toEqual(c.sites.map(() => ['capture', 'Body from the file']));
    expect((await import('../../export/bundle')).buildBundle(keptJob.request).report.notes.some((n) => n.includes('exchanged'))).toBe(false);
  });
});
