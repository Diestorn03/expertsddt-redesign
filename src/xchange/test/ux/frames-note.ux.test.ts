/**
 * A position file and a mesh in different coordinate systems (UI-DESIGN §5.3, §5.4): the step 1 note keeps only one of
 * the two files, the step 2 note never applies a positions STL that is not at the implants. The real CaptureStep and
 * GeometryStep methods on objects built without their DOM constructors; fake DOM of ../adversarial/fake-dom. Synthetic data only.
 */
import { describe, expect, it, vi } from 'vitest';
import { writeBinarySTL } from '../../core/stl-writer';
import { freshCase, Store, type CaseState } from '../../state/case';
import { readCapture } from '../../state/jobs-handler';
import en from '../../ui/i18n/en';
import es from '../../ui/i18n/es';
import { plural } from '../../ui/i18n/format';
import { CaptureStep } from '../../ui/step-capture';
import { GeometryStep } from '../../ui/step-geometry';
import { makeSyntheticCase, randomRigid } from '../fixtures';
import { encodeMicronMapperExport, utf8 } from '../fixtures/positions';
import { transformMesh } from '../../core/mesh';
import { fakeElement, installFakeDom, renderedChildren, type FakeElement } from '../adversarial/fake-dom';

const { document: doc } = installFakeDom();
Object.assign(doc, {
  createElement: (tag: string): FakeElement => fakeElement({ tag, dataset: {} }), // notes carry data-plan
  createElementNS: (_ns: string, tag: string): FakeElement => fakeElement({ tag }), // icons
});

const c = makeSyntheticCase({ implants: 4, seed: 4 });
// The CSV of the capture, and an STL of the same bodies moved elsewhere (another coordinate system).
const mixed = readCapture([
  { bytes: utf8(encodeMicronMapperExport(c.frames, 'BTH')), extension: 'csv' },
  { bytes: writeBinarySTL(transformMesh(c.captureMesh, randomRigid(5, Math.PI, 40))), extension: 'stl' },
]);

const texts = (el: FakeElement): string[] => [String(el.textContent), ...renderedChildren(el).flatMap(texts)].filter(Boolean);
const buttons = (el: FakeElement): FakeElement[] => renderedChildren(el).flatMap((k) => (k.className === 'btn btn--outline xch-btn-sm' ? [k] : buttons(k)));
const click = async (b: FakeElement): Promise<void> => { b.dispatchEvent(new Event('click')); await new Promise((r) => setTimeout(r, 0)); };
const noteOf = (step: CaptureStep): FakeElement => step.framesNote() as unknown as FakeElement;

function captureStep(lang: 'en' | 'es' = 'en') {
  const store = new Store<CaseState>(freshCase('lower'));
  const app = {
    store, get s(): CaseState { return store.state; }, c: lang === 'en' ? en : es, lang, viewer: null, componentData: [] as unknown[],
    resetCase: vi.fn(() => store.set(freshCase('lower'))), confirm: vi.fn(async () => true), rebuildViewer: vi.fn(),
    stage: { setDisplay: vi.fn() }, say: { say: vi.fn() }, toasts: { show: vi.fn() },
    plural: (t: Parameters<typeof plural>[1], n: number, v: Record<string, string | number> = {}) => plural(lang, t, n, v),
    later: (_fn: () => void, _ms: number): void => {}, // the auto-advance to step 2 (step-capture maybeAdvance) is not under test here
  };
  const step = Object.create(CaptureStep.prototype) as CaptureStep;
  Object.assign(step, { app, warnings: [], mixed: null, rowsKey: '', pane: fakeElement() });
  step.apply(mixed, false);
  return { step, app, store };
}

describe('step 1: a CSV and an STL that do not share coordinates', () => {
  it('the import links nothing and the note offers to keep only one file (EN and ES)', () => {
    expect(mixed.framesDiffer).toBe(true);
    expect(mixed.sites.every((s) => s.componentIndex === undefined)).toBe(true);
    const note = noteOf(captureStep().step);
    expect(texts(note)).toContain('The CSV file and the STL file are in different coordinate systems: the positions don\'t fall on the bodies, so they weren\'t matched. Keep one of the two.');
    expect(buttons(note).map((b) => b.textContent)).toEqual(['Use only the STL file', 'Use only the CSV file']);
    expect(buttons(noteOf(captureStep('es').step)).map((b) => b.textContent)).toEqual(['Usar solo el archivo STL', 'Usar solo el archivo CSV']);
  });

  it('Use only the STL file: the mesh stays, the positions go, the capture scan body is asked for', async () => {
    const { step, app, store } = captureStep();
    await click(buttons(noteOf(step))[0]!);
    expect([store.state.sites.length, store.state.needsReference, store.state.sources.map((s) => s.kind), store.state.format]).toEqual([0, true, ['mesh'], 'stl']);
    expect(store.state.captureMesh).toBe(mixed.mesh);
    expect(app.toasts.show).toHaveBeenCalledWith('Using only the STL file.');
    expect(step.framesNote()).toBeNull();
  });

  it('Use only the CSV file: the positions stay, the mesh goes; with work in steps 2-4 it asks first', async () => {
    const { step, app, store } = captureStep();
    store.set({ geometryBySite: { 'site-1': 'g' } }); // downstream work
    app.confirm.mockResolvedValueOnce(false);
    await click(buttons(noteOf(step))[1]!);
    expect(store.state.geometryBySite).toEqual({ 'site-1': 'g' }); // kept: the answer was no
    await click(buttons(noteOf(step))[1]!);
    expect([store.state.sites.map((s) => s.label), store.state.captureMesh, store.state.components, store.state.needsReference]).toEqual([['BTH01', 'BTH02', 'BTH03', 'BTH04'], null, [], false]);
    expect(app.confirm).toHaveBeenCalledTimes(2);
  });
});

describe('step 2: a positions STL picked as the geometry, not at the implants', () => {
  function geometryStep() {
    const app = {
      c: en, lang: 'en' as const, go: vi.fn(), render: vi.fn(), capture: { importFiles: vi.fn(async () => {}) },
    };
    const step = Object.create(GeometryStep.prototype) as GeometryStep;
    Object.assign(step, { app, notes: [], pane: fakeElement() });
    (step as unknown as { offSites(file: File, kind: string): void }).offSites({ name: 'x' } as File, 'STL');
    const notes = (step as unknown as { notes: FakeElement[] }).notes;
    return { step, app, notes };
  }

  it('is not applied: a note says why, with this file as the capture or the capture kept', () => {
    const { notes } = geometryStep();
    expect(notes).toHaveLength(1);
    expect(texts(notes[0]!)[0]).toMatch(/^The bodies in this file aren't on the implant positions of the capture/);
    expect(buttons(notes[0]!).map((b) => b.textContent)).toEqual(['Use only this STL file', "Keep the capture's positions"]);
  });

  it('Use only this STL file imports it as the capture in step 1; Keep the capture just closes the note', async () => {
    const first = geometryStep();
    await click(buttons(first.notes[0]!)[0]!);
    expect(first.app.go).toHaveBeenCalledWith(1);
    expect(first.app.capture.importFiles).toHaveBeenCalledWith([{ name: 'x' }], null);
    const second = geometryStep();
    await click(buttons(second.notes[0]!)[1]!);
    expect((second.step as unknown as { notes: unknown[] }).notes).toEqual([]);
    expect(second.app.capture.importFiles).not.toHaveBeenCalled();
  });

  it('a new case drops the notes about the last geometry file and keeps the library ones', () => {
    const { step, notes } = geometryStep();
    const library = fakeElement({ dataset: {} }); // e.g. "Saved in this browser only"
    notes.push(library);
    step.clearCaseNotes();
    expect((step as unknown as { notes: unknown[] }).notes).toEqual([library]);
  });
});
