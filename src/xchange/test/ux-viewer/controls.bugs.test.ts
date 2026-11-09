/**
 * UX review of the finished viewer (review-ux, 2026-11-09): input bugs found in system Chrome, reproduced on the real
 * attachControls with the EventTarget stand-ins of test/ux/controls-keys.ux.test.ts. Each test is named "BUG: ..." and
 * fails until the bug is fixed. No DOM library, no WebGL.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '../../core/types';
import { attachControls, type ControlCallbacks, type ControlMode } from '../../viewer/controls';
import type { PartHit, SceneObject, Viewer } from '../../viewer/viewer';
import { pointer } from '../adversarial/fake-dom';

const g = globalThis as Record<string, unknown>;
const added = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'].filter((k) => g[k] === undefined);
if (g.window === undefined) g.window = new EventTarget();
if (g.requestAnimationFrame === undefined) g.requestAnimationFrame = (cb: (t: number) => void): unknown => setTimeout(() => cb(0), 16);
if (g.cancelAnimationFrame === undefined) g.cancelAnimationFrame = (id: Parameters<typeof clearTimeout>[0]): void => clearTimeout(id);
afterAll(() => { for (const k of added) delete g[k]; });

/** Canvas and stage stand-ins: 800 × 600 at the page origin (as in controls-keys.ux.test.ts). */
const el = () => Object.assign(new EventTarget(), {
  clientHeight: 600,
  classList: { add(): void {}, remove(): void {}, toggle(): void {} },
  style: { setProperty(): void {} },
  focus(): void {},
  setPointerCapture(): void {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
});

function setup(mode: ControlMode) {
  const canvas = el();
  const stage = el();
  const viewer = {
    canvas, display: { speed: 3, fovDeg: 1 }, q: new THREE.Quaternion(), target: new THREE.Vector3(), dist: 100,
    axes: () => ({ right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), view: new THREE.Vector3(0, 0, 1) }),
    mmPerPixel: () => 0.05, stopCameraTween: vi.fn(), interacting(): void {}, invalidate(): void {}, setOrbitCenter: vi.fn(), finishPose: vi.fn(),
    pickPart: vi.fn((): PartHit | null => null), pickSurface: vi.fn((): Vec3 | null => [1, 2, 3]), pickObject: vi.fn((): SceneObject | null => 'jaw'),
    assembly: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false }, setCenter: () => new THREE.Vector3(),
    measureDotAt: vi.fn((): number => -1),
  };
  const cb = {
    mode: () => mode, onSelect: vi.fn(), onGuidedPoint: vi.fn(), onGuidedMiss: vi.fn(), onSetChange: vi.fn(), onHover: vi.fn(), onPreset: vi.fn(),
    onToggleJawOpacity: vi.fn(), onToggleMap: vi.fn(), onShortcuts: vi.fn(), onGuidedKey: vi.fn(), onCtrl: vi.fn(),
    onPivot: vi.fn(), onPivotMiss: vi.fn(), onToggleOpacity: vi.fn(), onHide: vi.fn(), onShowAll: vi.fn(), onCameraInput: vi.fn(),
    onToggleSection: vi.fn(), onSectionNudge: vi.fn((): boolean => false), onToggleMeasure: vi.fn(), onMeasurePoint: vi.fn(), onMeasureMiss: vi.fn(),
    onMeasureKey: vi.fn(), onMeasureDrag: vi.fn(),
  } satisfies ControlCallbacks;
  const ac = new AbortController();
  attachControls(viewer as unknown as Viewer, stage as unknown as HTMLElement, cb, ac.signal);
  const mouse = (type: string, props: Record<string, unknown> = {}): void => void canvas.dispatchEvent(pointer(type, { clientX: 400, clientY: 300, ...props }));
  return { canvas, stage, viewer, cb, ac, mouse };
}

describe('review-ux · mouse input an exocad user relies on', () => {
  it('BUG: left + right drag pans (keys row 2 "both buttons", G3), but the second button arrives as a chorded pointermove, so the drag keeps turning the view', () => {
    // System Chrome, left then right pressed on the canvas and dragged 120 px: the canvas got "pointerdown b0 bs1",
    // "pointermove b2 bs3", moves with buttons 3, "pointermove b2 bs1" (right released) and "pointerup b0 bs0"; the four
    // labels moved by different vectors (a turn). Pointer Events never send a second pointerdown for a chorded button,
    // so the `e.buttons === 3` test in pointerdown (controls.ts:196) can never be true.
    const { viewer, ac, mouse } = setup('camera');
    mouse('pointerdown', { button: 0, buttons: 1 });
    mouse('pointermove', { button: 2, buttons: 3 });
    for (const x of [430, 460, 490, 520]) mouse('pointermove', { button: -1, buttons: 3, clientX: x });
    mouse('pointermove', { button: 2, buttons: 1, clientX: 520 });
    mouse('pointerup', { button: 0, buttons: 0, clientX: 520 });
    expect(viewer.q.equals(new THREE.Quaternion()), 'both buttons must not turn the view').toBe(true);
    expect(viewer.target.x, 'both buttons move (pan) the view').not.toBe(0);
    ac.abort();
  });

  it('BUG: a double-click while measuring (or placing guided points) refits the view, throwing away the zoom set up for the point', () => {
    // System Chrome, step 4, zoomed in three wheel notches, distance tool on, one double-click on the palate: two points
    // on one spot ("Distance: 0.00 mm."), then the dblclick handler (controls.ts:310) ran Fit and the zoom was gone. In
    // guided mode the same reflex places two guided points on one scan body and refits.
    for (const mode of ['measure', 'guided'] as const) {
      const { cb, ac, mouse, canvas } = setup(mode);
      mouse('pointerdown'); mouse('pointerup', { buttons: 0 });
      mouse('pointerdown'); mouse('pointerup', { buttons: 0 });
      canvas.dispatchEvent(new Event('dblclick'));
      expect(cb.onPreset, `${mode}: no Fit from a double-click`).not.toHaveBeenCalledWith('fit');
      ac.abort();
    }
  });

  it('BUG: the wheel over the stage chrome (icon bar, views dial, adjust pad, legend) scrolls the page instead of zooming: only the canvas listens', () => {
    // System Chrome at 1440 × 900, step 4: three wheel notches over the icon bar, the views dial, the pad or the legend
    // scrolled the page 300 px (the stage carries data-lenis-prevent, so the browser scrolls natively) and did not zoom;
    // over the canvas they zoomed. The wheel reaches the stage by bubbling from that chrome: the stage must take it.
    const { stage, viewer, ac } = setup('set');
    const wheel = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -100, deltaX: 0, deltaMode: 0, clientX: 760, clientY: 80, shiftKey: false });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented, 'the page must not scroll under the 3D view').toBe(true);
    expect(viewer.dist, 'the wheel zooms, as it does on the canvas').toBeLessThan(100);
    ac.abort();
  });
});
