/**
 * UX review of the finished viewer (review-ux, 2026-11-09): a keyboard bug of the stage chrome found in system Chrome,
 * reproduced on a real Stage built over fake elements (test/adversarial/fake-dom). Named "BUG: ..."; it fails until fixed.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Mat4 } from '../../core/types';
import en from '../../ui/i18n/en';
import { Stage } from '../../ui/stage';
import type { App } from '../../ui/app';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

installFakeDom();

/** A fake element that keeps its attributes and one child per selector, all of the same kind (q() in the Stage). */
const rec = (props: Record<string, unknown> = {}): FakeElement => {
  const attrs: Record<string, string> = {}, kids = new Map<string, FakeElement>();
  return fakeElement({
    attrs,
    setAttribute: (k: string, v: string) => { attrs[k] = String(v); },
    getAttribute: (k: string) => attrs[k] ?? null,
    querySelector: (sel: string) => { let k = kids.get(sel); if (!k) kids.set(sel, (k = rec())); return k; },
    ...props,
  });
};

/** A real Stage over fake elements, its distance tool on. */
function stageWithTool() {
  const root = rec(), stageEl = root.querySelector('.xch__stage');
  stageEl.focus = vi.fn();
  const said: string[] = [];
  const s = { assembly: new Float64Array(16) as Mat4, sites: [], captureMesh: null, jaw: {}, surfaces: 'replacement', deviation: null, components: [] };
  const app = {
    root, section: rec(), signal: new AbortController().signal, lang: 'en', c: en, s, shown: 4,
    viewer: { finishPose: vi.fn(), setMeasure: vi.fn(), hasJawColors: false },
    say: { say: (t: string) => void said.push(t) }, alignStep: { guided: null },
  };
  return { stage: new Stage(app as unknown as App), stageEl, said, app };
}

describe('review-ux · the distance value', () => {
  it('BUG: a second point on top of the first (a double-click, or Enter twice at the crosshair) makes a 0.00 mm "distance"', () => {
    // System Chrome, step 4: a double-click on the palate with the tool on announced "First point placed. Now the second.
    // Distance: 0.00 mm." and drew the 0.00 mm pill over both dots. A zero-length pair measures nothing.
    const { stage, said } = stageWithTool();
    stage.toggleMeasure();
    stage.measurePoint([1.25, -3, 7]);
    stage.measurePoint([1.25, -3, 7]);
    expect(said.filter((t) => /0\.00\s?mm/.test(t)), 'no 0.00 mm value').toEqual([]);
  });
});

describe('review-ux · toggles before there is a jaw', () => {
  it('BUG: T (or Shift + middle click) flips Jaw transparency while its button is disabled for want of a jaw, so the jaw later arrives see-through', () => {
    // System Chrome, sample step 1 (no jaw; the Jaw transparency button aria-disabled), T on the focused stage: the button
    // became aria-pressed="true" while still disabled and the Display slider read 30 %; after "Use the sample jaw scan"
    // step 4 showed the jaw at 30 % opacity with nobody having asked for it on a jaw. toggleMap() checks for a measurement
    // before acting; toggleJawOpacity() (stage.ts:272) checks nothing, and the key path skips the button's disabled state.
    const { stage, app } = stageWithTool();
    (app.s as { jaw: unknown }).jaw = null;
    stage.toggleJawOpacity();
    expect(stage.display.jawOpacity, 'nothing to make transparent yet').toBe(1);
  });
});

describe('review-ux · the distance tool by keyboard', () => {
  it('BUG: Enter on the "Measure a distance" button turns the tool on but leaves focus on the button, so the next Enter (dist.keyboard: "press Enter") turns it off', () => {
    // System Chrome, step 4: Tab to the icon bar, arrows to "Measure a distance", Enter -> tool on (hint chip shown), focus
    // still on the button, crosshair not shown (it needs the stage focused), the stage's description (xch-view-dist) never
    // read; Enter again -> "Distance tool closed." The Section button moves focus into its popover (Position); the
    // distance tool should likewise take the keyboard into the 3D view, where Enter places a point at the crosshair.
    const { stage, stageEl } = stageWithTool();
    const btn = stageEl.querySelector('[data-dist-btn]');
    btn.dispatchEvent(Object.assign(new Event('click'), { detail: 0 })); // Enter or Space on the button
    expect(stage.measuring, 'the tool is on').toBe(true);
    expect(stageEl.focus, 'focus moves into the 3D view, where Enter places a point').toHaveBeenCalled();
  });
});
