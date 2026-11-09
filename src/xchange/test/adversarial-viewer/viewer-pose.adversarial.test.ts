/**
 * Adversarial review of the finished viewer (d8a5229..6d52ebf), pose and camera paths: the real Viewer, the real
 * attachControls and the real AlignStep callbacks (onSetChange, undo) on a minimal app; only WebGLRenderer is replaced
 * (no GPU in Node) and the DOM is ../adversarial/fake-dom. Motion on (the visitors' default; the developer PC forces
 * reduced motion, where these tweens do not exist). Tests named "BUG:" fail on purpose until the code is fixed.
 */
import type gsap from 'gsap';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { identity, maxAbsDiff } from '../../core/mat4';
import type { Mat4, TriMesh } from '../../core/types';
import { makeScanBodyCad } from '../../sample';
import en from '../../ui/i18n/en';
import { AlignStep } from '../../ui/step-align';
import { attachControls, type ControlCallbacks } from '../../viewer/controls';
import { presetView } from '../../viewer/presets';
import { toEngine, Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, keyEvent, pointer, type FakeElement } from '../adversarial/fake-dom';

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    readonly domElement = Object.assign(new EventTarget(), {
      className: '',
      setAttribute(): void {},
      remove(): void {},
      setPointerCapture(): void {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    });
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer };
});

installFakeDom();

function box(): TriMesh {
  const g = new THREE.BoxGeometry(60, 50, 12);
  const mesh = { positions: Float32Array.from(g.getAttribute('position').array), indices: Uint32Array.from(g.getIndex()!.array) };
  g.dispose();
  return mesh;
}
const at = (x: number, y: number, z: number): Mat4 => Float64Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);
const poseTween = (v: Viewer): gsap.core.Tween | null => (v as unknown as { poseTween: gsap.core.Tween | null }).poseTween;
const camTween = (v: Viewer): gsap.core.Tween | null => (v as unknown as { camTween: gsap.core.Tween | null }).camTween;

/** Jaw box, the sample's CAD scan body on two sites, the Default view; motion on unless asked. */
function scene(reducedMotion = false): { v: Viewer; stage: FakeElement; canvas: EventTarget } {
  const stage = fakeElement();
  const v = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion, onContextLost() {} });
  v.arch = 'lower';
  v.setJaw(box(), null);
  v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
  const body = makeScanBodyCad();
  for (const id of ['a', 'b']) v.setGeometry(id, 'body', body, null);
  v.view('occlusal', true);
  return { v, stage, canvas: v.canvas as unknown as EventTarget };
}

/** AlignStep with the slice of App its viewer input and undo read (store, stage, say); step 4 with a jaw: mode 'set'. */
function alignStep(v: Viewer, assembly: Mat4, undo: Mat4[]) {
  let state = { assembly, undo, lastAlignedPose: null as Mat4 | null, jaw: {}, exportedSinceChange: true };
  const app = {
    get s() { return state; },
    store: { set: (patch: Partial<typeof state>): void => { state = { ...state, ...patch }; } },
    viewer: v, shown: 4, c: en, say: { say(): void {} }, select(): void {},
    stage: { measuring: false, readout(): void {}, ctrlChip(): void {}, cameraMoved(): void {} },
  };
  const step = Object.create(AlignStep.prototype) as AlignStep;
  Object.assign(step, { app, guided: null, alignedResult: null, scheduleMeasure(): void {} });
  return { step, stored: (): Mat4 => state.assembly };
}

describe('the displayed pose is the stored (and exported) pose', () => {
  it('BUG: Ctrl + Z during a Ctrl + drag (A5) leaves the view on the undone pose while the store keeps the dragged one', () => {
    const { v, stage, canvas } = scene();
    const P0 = identity(), P1 = at(1.5, 0, 0); // P1 = the last committed move; undo brings P0 back
    v.setAssembly(P1);
    const { step, stored } = alignStep(v, P1, [P0]);
    const ac = new AbortController();
    attachControls(v, stage as unknown as HTMLElement, step.controlCallbacks(), ac.signal);
    // A5: Ctrl + drag anywhere turns the set; Ctrl is already down, so Z before the release is Ctrl + Z
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300, ctrlKey: true }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 440, clientY: 300, ctrlKey: true }));
    const z = keyEvent('keydown', 'z', { code: 'KeyZ', ctrlKey: true });
    stage.dispatchEvent(z);
    expect(z.defaultPrevented, 'the stage leaves Ctrl keys to step-align: it bubbles to the root listener').toBe(false);
    AlignStep.prototype.undo.call(step); // step-align's root keydown: Ctrl + Z with an undo stack -> undo()
    canvas.dispatchEvent(pointer('pointermove', { clientX: 470, clientY: 300, ctrlKey: true })); // the drag goes on
    canvas.dispatchEvent(pointer('pointerup', { clientX: 470, clientY: 300, ctrlKey: true })); // released within .35 s
    poseTween(v)?.progress(1); // the undo's .35 s pad-step tween, never killed by the drag, plays to its end
    // Today the view lands on P0 while the store (metrics, leave guard, ZIP) holds the dragged pose: what is exported is
    // not what is shown. The same happens when an auto-align result arrives during any set drag (.9 s window).
    expect(maxAbsDiff(toEngine(v.assembly.matrix), stored()), 'shown vs stored pose').toBeLessThan(1e-9);
    ac.abort();
    v.dispose();
  });

  it('BUG: an auto-align result that arrives during a set drag is shown after the release, while the store keeps the drag', () => {
    const { v, stage, canvas } = scene();
    const { step, stored } = alignStep(v, identity(), []);
    const ac = new AbortController();
    attachControls(v, stage as unknown as HTMLElement, step.controlCallbacks(), ac.signal);
    v.pickPart = () => ({ siteId: 'a', um: null }); // the press lands on an implant: a plain drag moves the set
    canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointermove', { clientX: 430, clientY: 300 }));
    // AlignStep.applyResult (the worker answers while the user drags): store, then a .9 s expo.out toward the result
    const result = at(0.4, -0.3, 0.2);
    (step as unknown as { app: { store: { set(p: object): void } } }).app.store.set({ assembly: result });
    v.setAssembly(result, 'align');
    canvas.dispatchEvent(pointer('pointermove', { clientX: 450, clientY: 300 }));
    canvas.dispatchEvent(pointer('pointerup', { clientX: 450, clientY: 300 }));
    poseTween(v)?.progress(1);
    expect(maxAbsDiff(toEngine(v.assembly.matrix), stored()), 'shown vs stored pose').toBeLessThan(1e-9);
    ac.abort();
    v.dispose();
  });
});

describe('camera tweens and the rotation center (A3, A6, A10)', () => {
  it('BUG: Home right after a view key stops that view part-way, yet the view stays pressed (and was announced)', () => {
    const { v, stage } = scene();
    let pressed: string | null = null;
    const cb: ControlCallbacks = {
      mode: () => 'camera', onSelect() {}, onGuidedPoint() {}, onSetChange() {}, onHover() {}, onToggleJawOpacity() {}, onToggleMap() {},
      onShortcuts() {}, onGuidedKey() {}, onCtrl() {}, onPivot() {},
      onPreset: (p) => { if (p === 'fit') v.fit(); else v.view(p); pressed = p; }, // Stage.preset: view + aria-pressed (+ "View: Front.")
      onCameraInput: () => { pressed = null; }, // Stage.cameraMoved
    };
    const ac = new AbortController();
    attachControls(v, stage as unknown as HTMLElement, cb, ac.signal);
    stage.dispatchEvent(keyEvent('keydown', '1', { code: 'Digit1' })); // Front: .7 s expo.out from the Default view
    camTween(v)!.progress(0.15); // Home about 100 ms later (two quick keystrokes)
    v.pickSurface = () => [0, -25, 0]; // a surface under the crosshair
    stage.dispatchEvent(keyEvent('keydown', 'Home', { code: 'Home' }));
    camTween(v)?.progress(1);
    const { from, up } = presetView('front', v.arch);
    const front = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(), new THREE.Vector3(...up)));
    const off = THREE.MathUtils.radToDeg(v.q.angleTo(front));
    // Today setOrbitCenter kills the view tween and keeps the in-between orientation (≈ 64° short of Front here: the
    // Default view to Front is a half turn) while the Front button stays aria-pressed: the view should finish, or the
    // pressed state should go.
    expect(off < 1e-4 || pressed === null, `${off.toFixed(1)}° from Front, pressed: ${pressed}`).toBe(true);
    ac.abort();
    v.dispose();
  });
});
