/**
 * UX review, tablets (UI-DESIGN §4: 768-959 px is a supported tablet layout; §6.6: a click places a guided point or
 * selects an implant). The real attachControls runs on EventTarget stand-ins for the canvas and the stage; picking is
 * stubbed. Tests named "BUG:" fail until the production code is fixed. No DOM library, no WebGL.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { attachControls, type ControlCallbacks, type ControlMode } from '../../viewer/controls';
import type { Viewer } from '../../viewer/viewer';

const g = globalThis as Record<string, unknown>;
const added = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'].filter((k) => g[k] === undefined);
if (g.window === undefined) g.window = new EventTarget();
if (g.requestAnimationFrame === undefined) g.requestAnimationFrame = (cb: (t: number) => void): unknown => setTimeout(() => cb(0), 16);
if (g.cancelAnimationFrame === undefined) g.cancelAnimationFrame = (id: Parameters<typeof clearTimeout>[0]): void => clearTimeout(id);
afterAll(() => { for (const k of added) delete g[k]; });

const el = (): EventTarget => Object.assign(new EventTarget(), {
  clientHeight: 600,
  classList: { add(): void {}, remove(): void {}, toggle(): void {} },
  focus(): void {},
  setPointerCapture(): void {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
});

/** One tap or click: down and up at the same point, 30 ms apart. */
async function tap(target: EventTarget, pointerType: 'touch' | 'mouse', x = 400, y = 300): Promise<void> {
  const ev = (type: string, buttons: number): Event => Object.assign(new Event(type, { cancelable: true }), { pointerType, pointerId: 7, button: 0, buttons, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
  target.dispatchEvent(ev('pointerdown', 1));
  await new Promise((r) => setTimeout(r, 30));
  target.dispatchEvent(ev('pointerup', 0));
}

function setup(mode: ControlMode) {
  const canvas = el();
  const stage = el();
  const viewer = {
    canvas, display: { speed: 3, fovDeg: 1 }, q: new THREE.Quaternion(), target: new THREE.Vector3(), dist: 100,
    axes: () => ({ right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), view: new THREE.Vector3(0, 0, 1) }),
    mmPerPixel: () => 0.05, stopCameraTween(): void {}, interacting(): void {}, invalidate(): void {}, setOrbitCenter(): void {},
    pickPart: () => ({ siteId: 'site-2', um: null }), pickSurface: (): [number, number, number] => [1, 2, 3],
    assembly: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false }, setCenter: () => new THREE.Vector3(),
  } as unknown as Viewer;
  const cb: ControlCallbacks = {
    mode: () => mode, onSelect: vi.fn(), onGuidedPoint: vi.fn(), onSetChange: vi.fn(), onHover: vi.fn(), onPreset: vi.fn(),
    onToggleJawOpacity: vi.fn(), onToggleMap: vi.fn(), onShortcuts: vi.fn(), onGuidedKey: vi.fn(), onCtrl: vi.fn(),
  };
  const ac = new AbortController();
  attachControls(viewer, stage as unknown as HTMLElement, cb, ac.signal);
  return { canvas, cb, ac };
}

describe('guided points and selection by touch (tablets)', () => {
  it('a mouse click on the jaw in guided mode places the point (reference behaviour)', async () => {
    const { canvas, cb, ac } = setup('guided');
    await tap(canvas, 'mouse');
    expect(cb.onGuidedPoint).toHaveBeenCalledWith([1, 2, 3]);
    ac.abort();
  });

  it('BUG: a tap on the jaw in guided mode places the point (today a tablet can never place guided points 1-2-3-4)', async () => {
    const { canvas, cb, ac } = setup('guided');
    await tap(canvas, 'touch');
    expect(cb.onGuidedPoint).toHaveBeenCalledWith([1, 2, 3]);
    ac.abort();
  });

  it('BUG: a tap on an implant in step 2 selects it, like a click ("Select an implant · Click it" in the shortcuts)', async () => {
    const { canvas, cb, ac } = setup('camera');
    await tap(canvas, 'touch');
    expect(cb.onSelect).toHaveBeenCalledWith('site-2');
    ac.abort();
  });

  it('a one-finger drag still only turns the view (no point, no selection)', async () => {
    const { canvas, cb, ac } = setup('guided');
    const ev = (type: string, x: number): Event => Object.assign(new Event(type, { cancelable: true }), { pointerType: 'touch', pointerId: 3, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: 300 });
    canvas.dispatchEvent(ev('pointerdown', 400));
    canvas.dispatchEvent(ev('pointermove', 440));
    canvas.dispatchEvent(ev('pointerup', 440));
    expect(cb.onGuidedPoint).not.toHaveBeenCalled();
    expect(cb.onSelect).not.toHaveBeenCalled();
    ac.abort();
  });
});
