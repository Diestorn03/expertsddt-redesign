/**
 * New logic of the review fixes (2026-11-09) outside the viewer: the adjust pad's Fine toggle, the Section and Distance
 * buttons on an empty stage, the section slider following what is shown, guided points on one spot, and toasts leaving
 * when step 4 opens. The real Stage (its constructor over fake elements, as test/ux-viewer/stage.bugs.test.ts), AlignStep
 * and Toasts; the fake DOM of ../adversarial/fake-dom. Synthetic data only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ImplantSite, Mat4, TriMesh } from '../../core/types';
import { Toasts } from '../../ui/feedback';
import en from '../../ui/i18n/en';
import es from '../../ui/i18n/es';
import { Stage } from '../../ui/stage';
import { AlignStep } from '../../ui/step-align';
import type { App } from '../../ui/app';
import type { Motion } from '../../ui/motion';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

const { document: doc } = installFakeDom();
// icons (svg) for the toasts' close button
(doc as unknown as Record<string, unknown>).createElementNS = (_ns: string, tag: string): FakeElement => fakeElement({ tag });

/** A fake element that keeps its attributes and one child per selector (q() in the Stage). */
const rec = (props: Record<string, unknown> = {}): FakeElement => {
  const attrs: Record<string, string> = {}, kids = new Map<string, FakeElement>();
  return fakeElement({
    attrs,
    dataset: {},
    setAttribute: (k: string, v: string) => { attrs[k] = String(v); },
    getAttribute: (k: string) => attrs[k] ?? null,
    querySelector: (sel: string) => { let k = kids.get(sel); if (!k) kids.set(sel, (k = rec())); return k; },
    ...props,
  });
};
const attr = (el: FakeElement, k: string): string | undefined => (el.attrs as Record<string, string>)[k];

/** A real Stage over fake elements. */
function realStage(lang: 'en' | 'es' = 'en', s: Record<string, unknown> = {}) {
  const root = rec(), stageEl = root.querySelector('.xch__stage');
  const said: string[] = [];
  const state = { assembly: new Float64Array(16) as Mat4, sites: [], captureMesh: null, jaw: {}, surfaces: 'replacement', deviation: null, components: [], ...s };
  const viewer = { finishPose: vi.fn(), setMeasure: vi.fn(), setSection: vi.fn((): number => 10), sectionReach: vi.fn((): number => 10), hasJawColors: false };
  const app = {
    root, section: rec(), signal: new AbortController().signal, lang, c: lang === 'es' ? es : en, s: state, shown: 4,
    viewer, say: { say: (t: string) => void said.push(t) }, alignStep: { guided: null, pad: vi.fn() },
  };
  return { stage: new Stage(app as unknown as App), stageEl, said, app, viewer, state };
}
const click = (el: FakeElement, props: Record<string, unknown> = {}): void => void el.dispatchEvent(Object.assign(new Event('click'), { detail: 1, ...props }));


describe('Section and Distance wait for something to show, as the map and the transparency do', () => {
  it('on an empty stage both buttons are disabled and inert; P and R do nothing', () => {
    const { stage, stageEl, said, viewer } = realStage('en', { jaw: null });
    stage.update();
    const sec = stageEl.querySelector('[data-section-btn]'), dist = stageEl.querySelector('[data-dist-btn]');
    expect([attr(sec, 'aria-disabled'), attr(dist, 'aria-disabled')]).toEqual(['true', 'true']);
    click(sec);
    click(dist);
    stage.toggleSection(true);
    stage.toggleMeasure();
    expect(viewer.setSection).not.toHaveBeenCalled();
    expect(stage.measuring).toBe(false);
    expect(said, 'no "Finish the guided points first." either: that is not why').toEqual([]);
  });

  it('with a case they are enabled; the Distance button says why it waits during guided points', () => {
    const { stage, stageEl, said, app } = realStage();
    stage.update();
    const dist = stageEl.querySelector('[data-dist-btn]');
    expect([attr(stageEl.querySelector('[data-section-btn]'), 'aria-disabled'), attr(dist, 'aria-disabled')]).toEqual(['false', 'false']);
    (app.alignStep as { guided: unknown }).guided = {};
    stage.update();
    expect(attr(dist, 'aria-disabled')).toBe('true');
    click(dist);
    expect(said).toEqual(['Finish the guided points first.']);
  });
});

describe('the section slider follows what is shown', () => {
  it('a jaw loaded after the cut started in step 2 widens the slider (never narrows it under the user)', () => {
    const { stage, stageEl, viewer } = realStage();
    const range = stageEl.querySelector('[data-section]').querySelector('[data-section-range]');
    range.parentElement = rec();
    stage.toggleSection();
    stage.update();
    expect([range.min, range.max]).toEqual(['-10', '10']);
    viewer.sectionReach.mockReturnValue(42.04);
    stage.update(); // the jaw arrived: Stage.update() runs after viewer.setJaw
    expect([range.min, range.max]).toEqual(['-42.1', '42.1']);
    viewer.sectionReach.mockReturnValue(5);
    stage.update();
    expect(range.max).toBe('42.1');
    expect(stage.nudgeSection(100)).toBe(true);
    expect(viewer.setSection).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 42.1 }));
  });
});

describe('guided points mark different scan bodies', () => {
  it('a point on top of a placed one (a double-click, Enter twice) is refused and said; one elsewhere goes on', () => {
    const body: TriMesh = { positions: Float32Array.from([-2, -2, 0, 2, -2, 0, 0, 2, 8]), indices: Uint32Array.from([0, 1, 2]) };
    const at = (x: number): ImplantSite => ({ id: `s${x}`, label: `AXO0${x}`, matrix: Float64Array.from([1, 0, 0, x * 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) as Mat4 } as unknown as ImplantSite);
    const targets = [at(1), at(2), at(3)];
    const said: string[] = [];
    const app = { lang: 'en', c: en, say: { say: (t: string) => void said.push(t) }, bodyInImplantFrame: () => body, viewer: null, render(): void {} };
    const step = Object.create(AlignStep.prototype) as AlignStep;
    Object.assign(step, { app, guided: { targets, pairs: targets.map(() => null), skipped: new Set(), order: [], idx: 0 } });
    const place = (p: [number, number, number]): void => (step as unknown as { place(p: [number, number, number]): void }).place(p);
    place([1, 2, 3]);
    place([1, 2, 3]);
    place([1.2, 2.1, 3]); // 0.22 mm off: still the same spot
    expect(step.guided!.order).toEqual([0]);
    expect(said).toEqual(['Point 1 placed. Next: implant AXO02.', 'There is a point there already. Place this one on the top of implant AXO02.', 'There is a point there already. Place this one on the top of implant AXO02.']);
    place([11, 2, 3]);
    expect(step.guided!.order).toEqual([0, 1]);
  });
});

describe('toasts', () => {
  it('clear() takes every toast away, as its close button does, once', () => {
    const box = fakeElement();
    const out = vi.fn((_el: unknown, done: () => void) => done());
    const toasts = new Toasts(box as unknown as HTMLElement, { toastIn(): void {}, toastOut: out } as unknown as Motion, 'Close');
    vi.useFakeTimers();
    toasts.show('Sample scan body applied to all implants.', { label: 'Undo', run(): void {} });
    toasts.show('Export ready.');
    expect(box.children).toHaveLength(2);
    toasts.clear();
    expect(out).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(20_000); // their own timers find them gone
    expect(out).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    toasts.dispose();
  });
});

describe('popovers: Tab from the last control goes on to the views dial', () => {
  it('the popover closes and the dial takes focus (the Display menu hides the dial while open: the browser would leave the stage)', () => {
    const { stageEl } = realStage();
    const pop = stageEl.querySelector('[data-display]'), btn = stageEl.querySelector('[data-display-btn]');
    const first = rec(), last = rec(), hiddenSwitch = rec({ hidden: true });
    pop.querySelectorAll = (sel: string): FakeElement[] => (sel === 'button, input' ? [first, last, hiddenSwitch] : []);
    const dial = [rec({ tabIndex: -1, focus: vi.fn() }), rec({ tabIndex: 0, focus: vi.fn() })];
    stageEl.querySelectorAll = (sel: string): FakeElement[] => (sel === '.xch__views button' ? dial : []);
    pop.hidden = true;
    click(btn);
    expect(pop.hidden).toBe(false);
    const tab = (target: FakeElement, shiftKey = false): Event => {
      const e = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab', shiftKey });
      Object.defineProperty(e, 'target', { value: target });
      pop.dispatchEvent(e);
      return e;
    };
    expect(tab(first).defaultPrevented, 'not the last: the browser moves on inside').toBe(false);
    expect(tab(last, true).defaultPrevented, 'Shift + Tab goes back as usual').toBe(false);
    expect(pop.hidden).toBe(false);
    expect(tab(last).defaultPrevented).toBe(true);
    expect([pop.hidden, attr(btn, 'aria-expanded')]).toEqual([true, 'false']);
    expect(dial[1]!.focus).toHaveBeenCalled();
    expect(dial[0]!.focus).not.toHaveBeenCalled();
  });
});
