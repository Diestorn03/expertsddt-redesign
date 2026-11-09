/**
 * Slice A of VIEWER-POLISH.md (navigation): exocad's view keys (A1, A2), arrows pan and Shift + arrows / PageUp / PageDown
 * turn (A4), Ctrl/⌘ + drag anywhere turns the implant set (A5), Home sets the rotation center (A6), touch & hold (A8),
 * per-object middle clicks and S (A9), camera input clears the views' pressed state and keyboard views are announced
 * (A10). Slice B's keys and pointer paths: P and Shift + wheel (B2), the distance tool (B3), D (B4). The real
 * attachControls runs on EventTarget stand-ins for the canvas and the stage (the pattern of controls-touch.ux.test.ts);
 * picking is stubbed. No DOM library, no WebGL.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '../../core/types';
import en from '../../ui/i18n/en';
import es from '../../ui/i18n/es';
import { Stage } from '../../ui/stage';
import { attachControls, type ControlCallbacks, type ControlMode } from '../../viewer/controls';
import { DEFAULT_DISPLAY, type DisplayOptions, type PartHit, type SceneObject, type Viewer } from '../../viewer/viewer';
import { keyEvent, pointer } from '../adversarial/fake-dom';

const g = globalThis as Record<string, unknown>;
const added = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'].filter((k) => g[k] === undefined);
if (g.window === undefined) g.window = new EventTarget();
if (g.requestAnimationFrame === undefined) g.requestAnimationFrame = (cb: (t: number) => void): unknown => setTimeout(() => cb(0), 16);
if (g.cancelAnimationFrame === undefined) g.cancelAnimationFrame = (id: Parameters<typeof clearTimeout>[0]): void => clearTimeout(id);
afterAll(() => { for (const k of added) delete g[k]; });
afterEach(() => { vi.useRealTimers(); });

const DEG = Math.PI / 180;

/** Canvas and stage stand-ins: 800 × 600 at the page origin; the stage records its classes and style properties. */
const el = () => {
  const classes = new Set<string>(), props = new Map<string, string>();
  return Object.assign(new EventTarget(), {
    clientHeight: 600,
    classes,
    props,
    classList: { add: (...c: string[]): void => c.forEach((x) => classes.add(x)), remove: (...c: string[]): void => c.forEach((x) => classes.delete(x)), toggle(): void {} },
    style: { setProperty: (k: string, v: string): void => void props.set(k, v) },
    focus(): void {},
    setPointerCapture(): void {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  });
};

function setup(mode: ControlMode) {
  const canvas = el();
  const stage = el();
  const viewer = {
    canvas, display: { speed: 3, fovDeg: 1 }, q: new THREE.Quaternion(), target: new THREE.Vector3(), dist: 100,
    axes: () => ({ right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), view: new THREE.Vector3(0, 0, 1) }),
    mmPerPixel: () => 0.05, stopCameraTween: vi.fn(), interacting(): void {}, invalidate(): void {}, setOrbitCenter: vi.fn(), finishPose: vi.fn(),
    pickPart: vi.fn((): PartHit | null => null), pickSurface: vi.fn((): Vec3 | null => [1, 2, 3]), pickObject: vi.fn((): SceneObject | null => 'jaw'),
    assembly: { matrix: new THREE.Matrix4(), matrixWorldNeedsUpdate: false }, setCenter: () => new THREE.Vector3(),
    measureDotAt: vi.fn((_x: number, _y: number, _r: number): number => -1),
  };
  const cb = {
    mode: () => mode, onSelect: vi.fn(), onGuidedPoint: vi.fn(), onGuidedMiss: vi.fn(), onSetChange: vi.fn(), onHover: vi.fn(), onPreset: vi.fn(),
    onToggleJawOpacity: vi.fn(), onToggleMap: vi.fn(), onShortcuts: vi.fn(), onGuidedKey: vi.fn(), onCtrl: vi.fn(),
    onPivot: vi.fn(), onPivotMiss: vi.fn(), onToggleOpacity: vi.fn(), onHide: vi.fn(), onShowAll: vi.fn(), onCameraInput: vi.fn(),
    onToggleSection: vi.fn(), onSectionNudge: vi.fn((_mm: number): boolean => false), onToggleMeasure: vi.fn(), onMeasurePoint: vi.fn(), onMeasureMiss: vi.fn(),
    onMeasureKey: vi.fn(), onMeasureDrag: vi.fn(),
  } satisfies ControlCallbacks;
  const ac = new AbortController();
  attachControls(viewer as unknown as Viewer, stage as unknown as HTMLElement, cb, ac.signal);
  const key = (k: string, props: Record<string, unknown> = {}): Event => {
    const e = keyEvent('keydown', k, props);
    stage.dispatchEvent(e);
    return e;
  };
  const mouse = (type: string, props: Record<string, unknown> = {}): void => void canvas.dispatchEvent(pointer(type, { clientX: 400, clientY: 300, ...props }));
  const touch = (type: string, x: number, y: number, id = 5): void =>
    void canvas.dispatchEvent(pointer(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
  return { canvas, stage, viewer, cb, ac, key, mouse, touch };
}

describe('A1 + A2 · exocad view keys', () => {
  it('a view key asks for its view as a keyboard view and never stops the camera tween it starts', () => {
    const { viewer, cb, ac, key } = setup('camera');
    for (const [code, k, view] of [['Digit1', '&', 'front'], ['Numpad2', '2', 'bottom'], ['Digit3', '3', 'back'], ['Numpad4', '4', 'left'], ['Digit5', '5', 'fit'], ['Digit6', '6', 'right'], ['Numpad8', '8', 'top'], ['Digit0', '0', 'occlusal']] as const) {
      const e = key(k, { code });
      expect(cb.onPreset, code).toHaveBeenLastCalledWith(view, true);
      expect(e.defaultPrevented, code).toBe(true);
    }
    expect(cb.onPreset).toHaveBeenCalledTimes(8);
    expect(viewer.stopCameraTween).not.toHaveBeenCalled();
    expect(cb.onCameraInput).not.toHaveBeenCalled(); // A10: a view key keeps the view buttons' pressed state
    ac.abort();
  });

  it('Shift is allowed; Ctrl, ⌘ and Alt leave the key to the browser', () => {
    const { cb, ac, key } = setup('camera');
    key('!', { code: 'Digit1', shiftKey: true });
    expect(cb.onPreset).toHaveBeenLastCalledWith('front', true);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) expect(key('1', { code: 'Digit1', [mod]: true }).defaultPrevented, mod).toBe(false);
    expect(cb.onPreset).toHaveBeenCalledTimes(1);
    ac.abort();
  });

  it('a held key repeats only camera steps: a view, Home, a toggle or Enter acts once', () => {
    const { viewer, cb, ac, key } = setup('guided');
    for (const [k, code] of [['1', 'Digit1'], ['Home', 'Home'], ['t', 'KeyT'], ['c', 'KeyC'], ['s', 'KeyS'], ['Enter', 'Enter']]) {
      key(k!, { code });
      expect(key(k!, { code, repeat: true }).defaultPrevented, `${k} repeat`).toBe(true); // still kept from the page
      key(k!, { code, repeat: true });
    }
    expect(cb.onPreset).toHaveBeenCalledTimes(1);
    expect(viewer.setOrbitCenter).toHaveBeenCalledTimes(1);
    expect(cb.onToggleJawOpacity).toHaveBeenCalledTimes(1);
    expect(cb.onToggleMap).toHaveBeenCalledTimes(1);
    expect(cb.onShowAll).toHaveBeenCalledTimes(1);
    expect(cb.onGuidedPoint).toHaveBeenCalledTimes(1);
    key('ArrowLeft', { code: 'ArrowLeft' });
    key('ArrowLeft', { code: 'ArrowLeft', repeat: true });
    expect(viewer.target.x).toBeCloseTo(-3); // two steps of 1.5 mm
    ac.abort();
  });

  it('7 and 9 do nothing; a symbol keeps its meaning; with NumLock off the keypad acts as the key it sends', () => {
    const { viewer, cb, ac, key } = setup('camera');
    expect(key('7', { code: 'Digit7' }).defaultPrevented).toBe(false);
    expect(key('9', { code: 'Numpad9' }).defaultPrevented).toBe(false);
    key('+', { code: 'Digit1' }); // Swiss layout: + on the 1 key zooms in
    expect(viewer.dist).toBeCloseTo(100 / 1.15);
    key('ArrowDown', { code: 'Numpad2' }); // NumLock off: an arrow, so it pans
    expect(viewer.target.y).not.toBe(0);
    expect(cb.onPreset).not.toHaveBeenCalled();
    ac.abort();
  });
});

describe('A4 · arrows pan; Shift + arrows and PageUp/PageDown turn', () => {
  it('the arrows pan 5 % of the stage height per press (repeats too) and leave the orientation', () => {
    const { viewer, ac, key } = setup('guided');
    key('ArrowLeft', { code: 'ArrowLeft' });
    // 5 % of 600 px at 0.05 mm per px: the view moves 1.5 mm, so the scene slides toward the other side
    expect(viewer.target.toArray()).toEqual([-1.5, 0, 0]);
    key('ArrowLeft', { code: 'ArrowLeft', repeat: true });
    key('ArrowUp', { code: 'ArrowUp' });
    expect(viewer.target.x).toBeCloseTo(-3);
    expect(viewer.target.y).toBeCloseTo(1.5);
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(true);
    ac.abort();
  });

  it('Shift + arrows turn 10° about the screen axes and leave the target; PageUp turns like Shift + ←, PageDown the other way', () => {
    const { viewer, ac, key } = setup('camera');
    key('ArrowLeft', { code: 'ArrowLeft', shiftKey: true });
    const shiftLeft = viewer.q.clone();
    expect(shiftLeft.angleTo(new THREE.Quaternion()) / DEG).toBeCloseTo(10);
    expect(viewer.target.lengthSq()).toBe(0);
    viewer.q.identity();
    const up = key('PageUp', { code: 'PageUp' });
    expect(up.defaultPrevented).toBe(true); // the page does not scroll while the stage has focus
    expect(viewer.q.angleTo(shiftLeft)).toBeLessThan(1e-12);
    viewer.q.identity();
    const down = key('PageDown', { code: 'Numpad3' }); // keypad 3 with NumLock off
    expect(down.defaultPrevented).toBe(true);
    expect(viewer.q.angleTo(shiftLeft.clone().invert())).toBeLessThan(1e-12);
    viewer.q.identity();
    key('ArrowUp', { code: 'ArrowUp', shiftKey: true }); // about the screen's X axis
    const axis = new THREE.Vector3(viewer.q.x, viewer.q.y, viewer.q.z).normalize();
    expect(Math.abs(axis.x)).toBeCloseTo(1);
    expect(viewer.target.lengthSq()).toBe(0);
    ac.abort();
  });

  it('every key that moves the camera stops a running tween first, and never moves the implant set', () => {
    const { viewer, cb, ac, key } = setup('set');
    for (const [k, extra] of [['ArrowRight', {}], ['ArrowDown', { shiftKey: true }], ['PageUp', {}], ['PageDown', {}], ['+', {}], ['-', {}], ['=', {}], ['_', {}]] as const) {
      viewer.stopCameraTween.mockClear();
      expect(key(k, { code: k, ...extra }).defaultPrevented, k).toBe(true);
      expect(viewer.stopCameraTween, k).toHaveBeenCalledTimes(1);
    }
    expect(cb.onSetChange).not.toHaveBeenCalled();
    expect(viewer.assembly.matrix.equals(new THREE.Matrix4())).toBe(true);
    ac.abort();
  });
});

describe('A5 · Ctrl/⌘ + drag anywhere rotates the implant set (step 4)', () => {
  /** The rotation of a pose about the origin (the stand-in's set center): angle and axis. */
  const rotationOf = (m: THREE.Matrix4): { deg: number; axis: THREE.Vector3 } => {
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    return { deg: (2 * Math.acos(Math.min(1, Math.abs(q.w)))) / DEG, axis: new THREE.Vector3(q.x, q.y, q.z).normalize().multiplyScalar(Math.sign(q.w) || 1) };
  };

  it('Ctrl + drag on empty space: start, move, end with a rotated pose; the camera stays', () => {
    const { viewer, cb, ac, mouse, stage } = setup('set');
    mouse('pointerdown', { ctrlKey: true });
    expect(stage.classes.has('is-grabbing')).toBe(true);
    mouse('pointermove', { clientX: 460, ctrlKey: true });
    mouse('pointerup', { clientX: 460, buttons: 0, ctrlKey: true });
    expect(cb.onSetChange.mock.calls.map((c) => c[1])).toEqual(['start', 'move', 'end']);
    const end = cb.onSetChange.mock.calls[2]![0] as THREE.Matrix4;
    const r = rotationOf(end);
    expect(r.deg).toBeCloseTo(60 * 0.3); // 0.3°/px × speed/3, about the screen's up axis (the drag was horizontal)
    expect(Math.abs(r.axis.y)).toBeCloseTo(1);
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(true);
    expect(viewer.finishPose).toHaveBeenCalled(); // from the stored pose, never an in-between one
    expect(stage.classes.has('is-grabbing')).toBe(false);
    ac.abort();
  });

  it('⌘ works as Ctrl, and Shift (held from the start) keeps the dominant axis only', () => {
    const { cb, ac, mouse } = setup('set');
    mouse('pointerdown', { metaKey: true, shiftKey: true });
    mouse('pointermove', { clientX: 460, clientY: 320, metaKey: true, shiftKey: true });
    mouse('pointerup', { clientX: 460, clientY: 320, buttons: 0 });
    const r = rotationOf(cb.onSetChange.mock.calls.at(-1)![0] as THREE.Matrix4);
    expect(r.deg).toBeCloseTo(60 * 0.3); // the 20 px down are dropped
    expect(Math.abs(r.axis.y)).toBeCloseTo(1);
    ac.abort();
  });

  it('the same drag without Ctrl turns the view and leaves the set; a plain drag on an implant still moves it', () => {
    const { viewer, cb, ac, mouse } = setup('set');
    mouse('pointerdown');
    mouse('pointermove', { clientX: 460 });
    mouse('pointerup', { clientX: 460, buttons: 0 });
    expect(cb.onSetChange).not.toHaveBeenCalled();
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(false);
    viewer.pickPart.mockReturnValue({ siteId: 'site-1', um: null });
    mouse('pointerdown');
    mouse('pointermove', { clientX: 460 });
    mouse('pointerup', { clientX: 460, buttons: 0 });
    expect(cb.onSetChange.mock.calls.map((c) => c[1])).toEqual(['start', 'move', 'end']);
    expect((cb.onSetChange.mock.calls[2]![0] as THREE.Matrix4).elements[12]).toBeCloseTo(60 * 0.05); // moved 3 mm right
    ac.abort();
  });

  it('outside step 4 a Ctrl + drag turns the view, as before', () => {
    const { viewer, cb, ac, mouse } = setup('camera');
    mouse('pointerdown', { ctrlKey: true });
    mouse('pointermove', { clientX: 460, ctrlKey: true });
    mouse('pointerup', { clientX: 460, buttons: 0 });
    expect(cb.onSetChange).not.toHaveBeenCalled();
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(false);
    ac.abort();
  });
});

describe('A6 · Home sets the rotation center', () => {
  it('with no pointer over the canvas it picks at the stage center (the crosshair) and announces the hit', () => {
    const { viewer, cb, ac, key } = setup('camera');
    expect(key('Home', { code: 'Home' }).defaultPrevented).toBe(true);
    expect(viewer.pickSurface).toHaveBeenCalledWith(400, 300);
    expect(viewer.setOrbitCenter).toHaveBeenCalledTimes(1);
    expect((viewer.setOrbitCenter.mock.calls[0]![0] as THREE.Vector3).toArray()).toEqual([1, 2, 3]);
    expect(cb.onPivot).toHaveBeenCalledTimes(1);
    expect(cb.onPreset).not.toHaveBeenCalled(); // Home no longer fits
    expect(viewer.stopCameraTween).not.toHaveBeenCalled(); // it starts its own .35 s tween
    ac.abort();
  });

  it('after the mouse moves over the canvas it picks under the pointer; after the pointer leaves, at the center again', () => {
    const { viewer, ac, key, mouse, canvas } = setup('camera');
    mouse('pointermove', { clientX: 120, clientY: 90, buttons: 0 });
    key('Home', { code: 'Numpad7' }); // keypad 7 with NumLock off
    expect(viewer.pickSurface).toHaveBeenLastCalledWith(120, 90);
    canvas.dispatchEvent(pointer('pointerleave', {}));
    key('Home');
    expect(viewer.pickSurface).toHaveBeenLastCalledWith(400, 300);
    ac.abort();
  });

  it('a miss leaves the rotation center and reports it', () => {
    const { viewer, cb, ac, key } = setup('guided');
    viewer.pickSurface.mockReturnValue(null);
    key('Home');
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    expect(cb.onPivotMiss).toHaveBeenCalledTimes(1);
    expect(cb.onPivot).not.toHaveBeenCalled();
    ac.abort();
  });

  it('a plain middle click still sets it under the pointer, silently', () => {
    const { viewer, cb, ac, mouse } = setup('camera');
    mouse('pointerdown', { button: 1, buttons: 4, clientX: 250, clientY: 180 });
    mouse('pointerup', { button: 1, buttons: 0, clientX: 250, clientY: 180 });
    expect(viewer.pickSurface).toHaveBeenCalledWith(250, 180);
    expect(viewer.setOrbitCenter).toHaveBeenCalledTimes(1);
    expect(viewer.pickObject).not.toHaveBeenCalled();
    expect(cb.onPivot).not.toHaveBeenCalled();
    ac.abort();
  });
});

describe('A8 · touch & hold sets the rotation center', () => {
  it('a finger held still for 500 ms sets it under the finger; the ring shows at 150 ms; lifting is no tap', () => {
    vi.useFakeTimers();
    const { viewer, cb, ac, stage, touch } = setup('guided');
    touch('pointerdown', 300, 200);
    vi.advanceTimersByTime(140);
    expect(stage.classes.has('is-hold')).toBe(false);
    vi.advanceTimersByTime(20);
    expect(stage.classes.has('is-hold')).toBe(true);
    expect([stage.props.get('--hold-x'), stage.props.get('--hold-y')]).toEqual(['300px', '200px']);
    touch('pointermove', 305, 200); // 5 px: the view starts to turn, the hold stays (within 8 px)
    expect(viewer.stopCameraTween).toHaveBeenCalled();
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    vi.advanceTimersByTime(360); // 520 ms
    expect(viewer.pickSurface).toHaveBeenCalledWith(300, 200);
    expect(viewer.setOrbitCenter).toHaveBeenCalledTimes(1);
    expect(stage.classes.has('is-held')).toBe(true);
    viewer.stopCameraTween.mockClear();
    touch('pointermove', 306, 201); // jitter: the drag restarts at the hold, so the rotation-center tween keeps running
    expect(viewer.stopCameraTween).not.toHaveBeenCalled();
    touch('pointerup', 306, 201);
    expect(cb.onGuidedPoint).not.toHaveBeenCalled();
    expect(cb.onSelect).not.toHaveBeenCalled();
    expect(cb.onPreset).not.toHaveBeenCalled();
    expect(stage.classes.has('is-hold') || stage.classes.has('is-held')).toBe(false);
    // the lift was no tap at all: a quick tap right after places a point instead of making a double tap (Fit)
    vi.advanceTimersByTime(60);
    touch('pointerdown', 306, 201);
    vi.advanceTimersByTime(30);
    touch('pointerup', 306, 201);
    expect(cb.onGuidedPoint).toHaveBeenCalledTimes(1);
    expect(cb.onPreset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(viewer.setOrbitCenter).toHaveBeenCalledTimes(1);
    ac.abort();
  });

  it('moving more than 8 px, or a second finger, before 500 ms cancels it (the turn and the pinch are unchanged)', () => {
    vi.useFakeTimers();
    const { viewer, cb, ac, stage, touch } = setup('camera');
    touch('pointerdown', 300, 200);
    vi.advanceTimersByTime(200);
    touch('pointermove', 310, 200);
    expect(stage.classes.has('is-hold')).toBe(false);
    vi.advanceTimersByTime(600);
    touch('pointerup', 310, 200);
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(false); // it turned the view
    expect(cb.onCameraInput).toHaveBeenCalled();
    touch('pointerdown', 300, 200, 1);
    vi.advanceTimersByTime(100);
    touch('pointerdown', 400, 200, 2);
    vi.advanceTimersByTime(600);
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    touch('pointerup', 300, 200, 1);
    touch('pointerup', 400, 200, 2);
    ac.abort();
  });

  it('within 8 px the hold still fires; nothing under the finger: the ring goes and the center stays', () => {
    vi.useFakeTimers();
    const { viewer, ac, stage, touch } = setup('camera');
    viewer.pickSurface.mockReturnValue(null);
    touch('pointerdown', 300, 200);
    touch('pointermove', 306, 203);
    vi.advanceTimersByTime(520);
    expect(viewer.pickSurface).toHaveBeenCalledWith(300, 200);
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    expect(stage.classes.has('is-hold')).toBe(false);
    touch('pointerup', 306, 203);
    ac.abort();
  });

  it('a quick tap still selects (the 30 ms tap of controls-touch)', async () => {
    const { viewer, cb, ac, touch } = setup('camera');
    viewer.pickPart.mockReturnValue({ siteId: 'site-2', um: null });
    touch('pointerdown', 300, 200);
    await new Promise((r) => setTimeout(r, 30));
    touch('pointerup', 300, 200);
    expect(cb.onSelect).toHaveBeenCalledWith('site-2');
    await new Promise((r) => setTimeout(r, 520));
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled();
    ac.abort();
  });
});

describe('A9 · per-object middle clicks and S', () => {
  const click = (s: ReturnType<typeof setup>, mods: Record<string, boolean>): void => {
    s.mouse('pointerdown', { button: 1, buttons: 4, ...mods });
    s.mouse('pointerup', { button: 1, buttons: 0, ...mods });
  };
  const table: [mods: Record<string, boolean>, under: SceneObject | null, want: [keyof ControlCallbacks, ...unknown[]] | null][] = [
    [{ shiftKey: true }, 'jaw', ['onToggleJawOpacity']],
    [{ shiftKey: true }, 'part', ['onToggleOpacity', 'part']],
    [{ shiftKey: true }, 'capture', null],
    [{ shiftKey: true }, null, null],
    [{ ctrlKey: true }, 'jaw', ['onHide', 'jaw']],
    [{ ctrlKey: true }, 'part', ['onHide', 'part']],
    [{ metaKey: true }, 'capture', ['onHide', 'capture']],
    [{ ctrlKey: true }, null, null],
    [{ ctrlKey: true, shiftKey: true }, 'jaw', ['onShowAll']],
    [{ metaKey: true, shiftKey: true }, null, ['onShowAll']],
  ];
  for (const [mods, under, want] of table) {
    it(`${Object.keys(mods).join(' + ')} + middle click on ${under ?? 'nothing'} → ${want ? want.join(' ') : 'nothing'}`, () => {
      const s = setup('set');
      s.viewer.pickObject.mockReturnValue(under);
      click(s, mods);
      const acted = (['onToggleJawOpacity', 'onToggleOpacity', 'onHide', 'onShowAll'] as const).filter((k) => s.cb[k].mock.calls.length);
      expect(acted).toEqual(want ? [want[0]] : []);
      if (want && want.length > 1) expect(s.cb[want[0] as 'onHide']).toHaveBeenCalledWith(...want.slice(1));
      expect(s.viewer.setOrbitCenter).not.toHaveBeenCalled();
      s.ac.abort();
    });
  }

  it('S (and Shift + S) shows everything hidden; T still toggles the jaw transparency', () => {
    const { cb, ac, key } = setup('camera');
    expect(key('s', { code: 'KeyS' }).defaultPrevented).toBe(true);
    key('S', { code: 'KeyS', shiftKey: true });
    expect(cb.onShowAll).toHaveBeenCalledTimes(2);
    key('t', { code: 'KeyT' });
    expect(cb.onToggleJawOpacity).toHaveBeenCalledTimes(1);
    ac.abort();
  });
});

describe('A10 · camera input clears the pressed view', () => {
  it('a drag, the wheel, a pinch, the arrows, PageUp and the zoom keys call onCameraInput; views, Home, toggles and set drags do not', () => {
    const { cb, ac, key, mouse, touch, canvas } = setup('set');
    key('1', { code: 'Digit1' });
    key('Home');
    key('t');
    key('c');
    cb.onSetChange.mockClear();
    mouse('pointerdown', { ctrlKey: true }); // a set drag moves the set, not the camera
    mouse('pointermove', { clientX: 460, ctrlKey: true });
    mouse('pointerup', { clientX: 460, buttons: 0 });
    expect(cb.onSetChange).toHaveBeenCalled();
    expect(cb.onCameraInput).not.toHaveBeenCalled();
    mouse('pointerdown', { button: 2, buttons: 2 });
    mouse('pointermove', { clientX: 460, buttons: 2 });
    mouse('pointerup', { clientX: 460, button: 2, buttons: 0 });
    expect(cb.onCameraInput).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100, deltaMode: 0, clientX: 400, clientY: 300 }));
    expect(cb.onCameraInput).toHaveBeenCalledTimes(2);
    for (const k of ['ArrowLeft', 'PageUp', '+']) key(k);
    expect(cb.onCameraInput).toHaveBeenCalledTimes(5);
    touch('pointerdown', 300, 300, 1);
    touch('pointerdown', 500, 300, 2);
    touch('pointermove', 520, 300, 2);
    expect(cb.onCameraInput).toHaveBeenCalledTimes(6);
    touch('pointerup', 300, 300, 1);
    touch('pointerup', 520, 300, 2);
    ac.abort();
  });
});

describe('Stage: hide, show all, the pressed view and keyboard announcements', () => {
  type Fake = { display: DisplayOptions; hidden: Set<string>; pressed: string | null; el: unknown; app: unknown; setDisplay(p: Partial<DisplayOptions>): void; press(p: string | null): void };
  const proto = Stage.prototype as unknown as Record<string, (this: Fake, ...a: unknown[]) => void>;
  const fake = (lang: 'en' | 'es') => {
    const said: string[] = [];
    const buttons = ['fit', 'front', 'occlusal'].map((view) => ({ dataset: { view }, pressed: '', setAttribute(_: string, v: string) { this.pressed = v; } }));
    const viewer = { arch: null as unknown, fit: vi.fn(), view: vi.fn() };
    const f: Fake = {
      display: { ...DEFAULT_DISPLAY }, hidden: new Set(), pressed: null, el: { querySelectorAll: () => buttons },
      app: { lang, c: lang === 'es' ? es : en, s: { arch: 'upper' }, viewer, say: { say: (t: string) => void said.push(t) } },
      setDisplay(p) { this.display = { ...this.display, ...p }; },
      press(p) { proto.press!.call(this, p); },
    };
    return { f, said, buttons, viewer };
  };

  it('Ctrl + middle click hides through the Display switch, once; S brings back exactly what was hidden that way', () => {
    const { f, said } = fake('en');
    proto.hide!.call(f, 'part');
    proto.hide!.call(f, 'part');
    proto.hide!.call(f, 'jaw');
    expect([f.display.parts, f.display.jaw, f.display.capture]).toEqual([false, false, false]);
    expect(said).toEqual(['Replacements hidden. Press S to show everything again.', 'Jaw scan hidden. Press S to show everything again.']);
    proto.showAll!.call(f);
    expect([f.display.parts, f.display.jaw, f.display.capture]).toEqual([true, true, false]); // captured bodies were off already
    expect(said.at(-1)).toBe(en.say.shown);
    proto.showAll!.call(f);
    expect(said).toHaveLength(3); // nothing left to show: silent
    proto.hide!.call(f, 'capture'); // off already: nothing to remember
    expect(f.hidden.size).toBe(0);
    proto.hide!.call(f, 'jaw');
    proto.showAll!.call(f, false); // a new case: back, silently
    expect(f.display.jaw).toBe(true);
    expect(said).toHaveLength(4);
  });

  it('the Spanish announcement stays impersonal around the name', () => {
    const { f, said } = fake('es');
    proto.hide!.call(f, 'capture');
    f.display.capture = true;
    proto.hide!.call(f, 'capture');
    expect(said).toEqual(['Se ocultó: Scan bodies capturados. Pulsa S para volver a mostrar todo.']);
  });

  it('Shift + middle click on a replacement: geometry opacity 100 % ↔ 30 %', () => {
    const { f } = fake('en');
    proto.togglePartOpacity!.call(f);
    expect(f.display.partOpacity).toBe(0.3);
    proto.togglePartOpacity!.call(f);
    expect(f.display.partOpacity).toBe(1);
  });

  it('a view from the keyboard is announced and pressed; camera input clears the pressed state', () => {
    const { f, said, buttons, viewer } = fake('en');
    proto.preset!.call(f, 'front', true);
    expect(viewer.view).toHaveBeenCalledWith('front');
    expect(said).toEqual(['View: Front.']);
    expect(buttons.map((b) => b.pressed)).toEqual(['false', 'true', 'false']);
    proto.preset!.call(f, 'fit'); // a mouse click: pressed, not announced
    expect(viewer.fit).toHaveBeenCalled();
    expect(said).toHaveLength(1);
    expect(buttons.map((b) => b.pressed)).toEqual(['true', 'false', 'false']);
    proto.cameraMoved!.call(f);
    expect(buttons.map((b) => b.pressed)).toEqual(['false', 'false', 'false']);
    const es1 = fake('es');
    proto.preset!.call(es1.f, 'occlusal', true);
    expect(es1.said).toEqual(['Vista: Oclusal.']);
  });
});

describe('B2 · P toggles the cut; Shift + wheel moves it', () => {
  const wheel = (canvas: EventTarget, props: Record<string, unknown>): Event => {
    const e = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 0, deltaX: 0, deltaMode: 0, clientX: 400, clientY: 300, shiftKey: false, ...props });
    canvas.dispatchEvent(e);
    return e;
  };

  it("P (any mode, held: once) toggles the cut and leaves the camera; Ctrl + P stays the browser's", () => {
    for (const mode of ['camera', 'set', 'guided', 'measure'] as const) {
      const { viewer, cb, ac, key } = setup(mode);
      expect(key('p', { code: 'KeyP' }).defaultPrevented, mode).toBe(true);
      key('p', { code: 'KeyP', repeat: true });
      key('P', { code: 'KeyP', shiftKey: true });
      expect(key('p', { code: 'KeyP', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(cb.onToggleSection, mode).toHaveBeenCalledTimes(2);
      expect(viewer.stopCameraTween).not.toHaveBeenCalled();
      expect(cb.onCameraInput).not.toHaveBeenCalled();
      ac.abort();
    }
  });

  it('with a cut, Shift + wheel moves it 0.5 mm a notch (up goes deeper) and does not zoom', () => {
    const { viewer, cb, ac, canvas } = setup('camera');
    cb.onSectionNudge.mockReturnValue(true);
    expect(wheel(canvas, { deltaY: -100, shiftKey: true }).defaultPrevented).toBe(true);
    expect(cb.onSectionNudge).toHaveBeenLastCalledWith(0.5);
    wheel(canvas, { deltaY: 200, shiftKey: true });
    expect(cb.onSectionNudge).toHaveBeenLastCalledWith(-1);
    wheel(canvas, { deltaY: -3, deltaMode: 1, shiftKey: true }); // 3 lines = 48 px
    expect(cb.onSectionNudge.mock.lastCall![0]).toBeCloseTo(0.24);
    wheel(canvas, { deltaX: 100, shiftKey: true }); // macOS: Shift turns the wheel sideways
    expect(cb.onSectionNudge).toHaveBeenLastCalledWith(-0.5);
    expect(viewer.dist).toBe(100);
    expect(cb.onCameraInput).not.toHaveBeenCalled();
    ac.abort();
  });

  it('without a cut, Shift + wheel zooms as before; a plain wheel never asks', () => {
    const { viewer, cb, ac, canvas } = setup('camera');
    wheel(canvas, { deltaY: 100, shiftKey: true });
    expect(cb.onSectionNudge).toHaveBeenCalledTimes(1);
    expect(viewer.dist).toBeCloseTo(112);
    wheel(canvas, { deltaY: 100 });
    expect(cb.onSectionNudge).toHaveBeenCalledTimes(1);
    expect(viewer.dist).toBeCloseTo(112 * 1.12);
    expect(cb.onCameraInput).toHaveBeenCalledTimes(2);
    ac.abort();
  });
});

describe('B4 · D toggles the color map, as C does', () => {
  it("d → onToggleMap once (held too); Ctrl + D stays the browser's bookmark", () => {
    const { cb, ac, key } = setup('set');
    expect(key('d', { code: 'KeyD' }).defaultPrevented).toBe(true);
    key('d', { code: 'KeyD', repeat: true });
    expect(cb.onToggleMap).toHaveBeenCalledTimes(1);
    key('D', { code: 'KeyD', shiftKey: true });
    expect(cb.onToggleMap).toHaveBeenCalledTimes(2);
    expect(key('d', { code: 'KeyD', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(cb.onToggleMap).toHaveBeenCalledTimes(2);
    ac.abort();
  });
});

describe('B3 · the distance tool (measure mode)', () => {
  const click = (s: ReturnType<typeof setup>, x: number, y: number): void => {
    s.mouse('pointerdown', { clientX: x, clientY: y });
    s.mouse('pointerup', { clientX: x, clientY: y, buttons: 0 });
  };

  it("R toggles the tool (held: once); during guided points R is ignored; Ctrl + R stays the browser's", () => {
    for (const mode of ['camera', 'set', 'measure'] as const) {
      const { cb, ac, key } = setup(mode);
      expect(key('r', { code: 'KeyR' }).defaultPrevented, mode).toBe(true);
      key('r', { code: 'KeyR', repeat: true });
      expect(key('r', { code: 'KeyR', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(cb.onToggleMeasure, mode).toHaveBeenCalledTimes(1);
      ac.abort();
    }
    const { cb, ac, key } = setup('guided');
    expect(key('r', { code: 'KeyR' }).defaultPrevented).toBe(false);
    expect(cb.onToggleMeasure).not.toHaveBeenCalled();
    ac.abort();
  });

  it('two clicks give the two pickSurface results (any visible surface, not only the jaw); nothing under a click: nothing', () => {
    const s = setup('measure');
    s.viewer.pickSurface.mockReturnValueOnce([1, 2, 3]).mockReturnValueOnce([4, 6, 3]).mockReturnValueOnce(null);
    click(s, 120, 90);
    click(s, 300, 200);
    click(s, 500, 500);
    expect(s.viewer.pickSurface.mock.calls).toEqual([[120, 90, false], [300, 200, false], [500, 500, false]]);
    expect(s.cb.onMeasurePoint.mock.calls).toEqual([[[1, 2, 3]], [[4, 6, 3]]]);
    expect(s.cb.onSelect).not.toHaveBeenCalled();
    expect(s.cb.onGuidedPoint).not.toHaveBeenCalled();
    s.ac.abort();
  });

  it('a tap places a point too; a drag turns the view and places nothing', async () => {
    const s = setup('measure');
    s.touch('pointerdown', 300, 200);
    await new Promise((r) => setTimeout(r, 30));
    s.touch('pointerup', 300, 200);
    expect(s.cb.onMeasurePoint).toHaveBeenCalledWith([1, 2, 3]);
    s.mouse('pointerdown');
    s.mouse('pointermove', { clientX: 460 });
    s.mouse('pointerup', { clientX: 460, buttons: 0 });
    expect(s.cb.onMeasurePoint).toHaveBeenCalledTimes(1);
    expect(s.viewer.q.equals(new THREE.Quaternion())).toBe(false);
    s.ac.abort();
  });

  it('Enter picks at the canvas center (the crosshair); a miss reports it; Backspace and Esc reach onMeasureKey', () => {
    const { viewer, cb, ac, key } = setup('measure');
    key('Enter', { code: 'Enter' });
    expect(viewer.pickSurface).toHaveBeenLastCalledWith(400, 300, false);
    expect(cb.onMeasurePoint).toHaveBeenLastCalledWith([1, 2, 3]);
    key('Enter', { code: 'Enter', repeat: true }); // held: once
    expect(cb.onMeasurePoint).toHaveBeenCalledTimes(1);
    viewer.pickSurface.mockReturnValue(null);
    key('Enter', { code: 'Enter' });
    expect(cb.onMeasureMiss).toHaveBeenCalledTimes(1);
    expect(key('Backspace').defaultPrevented).toBe(true);
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(cb.onMeasureKey.mock.calls).toEqual([['Backspace'], ['Escape']]);
    expect(cb.onGuidedKey).not.toHaveBeenCalled();
    expect(cb.onGuidedPoint).not.toHaveBeenCalled();
    ac.abort();
  });

  it('outside measure mode Enter, Backspace and Esc keep their meaning (guided points, or nothing)', () => {
    const g = setup('guided');
    g.key('Enter');
    g.key('Backspace');
    expect(g.viewer.pickSurface).toHaveBeenLastCalledWith(400, 300, true);
    expect(g.cb.onGuidedPoint).toHaveBeenCalledTimes(1);
    expect(g.cb.onGuidedKey).toHaveBeenCalledWith('Backspace');
    expect(g.cb.onMeasurePoint).not.toHaveBeenCalled();
    expect(g.cb.onMeasureKey).not.toHaveBeenCalled();
    g.ac.abort();
    const c = setup('camera');
    expect(c.key('Enter').defaultPrevented).toBe(false);
    expect(c.key('Escape').defaultPrevented).toBe(false);
    c.ac.abort();
  });

  it('measuring pauses set drags: a drag on an implant or a Ctrl + drag turns the view, never the set', () => {
    const { viewer, cb, ac, mouse } = setup('measure');
    viewer.pickPart.mockReturnValue({ siteId: 'site-1', um: null });
    mouse('pointerdown');
    mouse('pointermove', { clientX: 460 });
    mouse('pointerup', { clientX: 460, buttons: 0 });
    mouse('pointerdown', { ctrlKey: true });
    mouse('pointermove', { clientX: 520, ctrlKey: true });
    mouse('pointerup', { clientX: 520, buttons: 0, ctrlKey: true });
    expect(cb.onSetChange).not.toHaveBeenCalled();
    expect(viewer.finishPose).not.toHaveBeenCalled();
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(false);
    ac.abort();
  });

  it('a press on a point (12 px with a mouse) drags it along the surfaces, one pick a frame; the release gives the last spot', () => {
    vi.useFakeTimers();
    const { viewer, cb, ac, mouse } = setup('measure');
    viewer.measureDotAt.mockImplementation((x, y, r) => (Math.hypot(x - 400, y - 300) <= r ? 1 : -1));
    mouse('pointerdown', { clientX: 405, clientY: 300 });
    expect(viewer.measureDotAt).toHaveBeenCalledWith(405, 300, 12);
    mouse('pointermove', { clientX: 430, clientY: 310 });
    mouse('pointermove', { clientX: 440, clientY: 320 }); // same frame: one pick
    viewer.pickSurface.mockReturnValue([7, 8, 9]);
    vi.advanceTimersByTime(20);
    expect(viewer.pickSurface).toHaveBeenCalledTimes(1);
    expect(viewer.pickSurface).toHaveBeenLastCalledWith(440, 320);
    expect(cb.onMeasureDrag).toHaveBeenLastCalledWith(1, [7, 8, 9], false);
    viewer.pickSurface.mockReturnValue(null); // over nothing: the point stays (the stage keeps it)
    mouse('pointerup', { clientX: 470, clientY: 330, buttons: 0 });
    expect(cb.onMeasureDrag).toHaveBeenLastCalledWith(1, null, true);
    vi.advanceTimersByTime(40);
    expect(cb.onMeasureDrag).toHaveBeenCalledTimes(2);
    expect(cb.onMeasurePoint).not.toHaveBeenCalled(); // a drag places no point
    expect(viewer.q.equals(new THREE.Quaternion()), 'the view stays').toBe(true);
    expect(cb.onCameraInput).not.toHaveBeenCalled();
    ac.abort();
  });

  it('on touch the radius is 24 px and no hold starts; a press on a point without moving is a plain click', () => {
    vi.useFakeTimers();
    const { viewer, cb, ac, touch, mouse } = setup('measure');
    viewer.measureDotAt.mockReturnValue(0);
    touch('pointerdown', 300, 200);
    expect(viewer.measureDotAt).toHaveBeenCalledWith(300, 200, 24);
    touch('pointermove', 340, 200);
    vi.advanceTimersByTime(600);
    expect(viewer.setOrbitCenter).not.toHaveBeenCalled(); // no touch & hold on a point
    touch('pointerup', 340, 200);
    expect(cb.onMeasureDrag).toHaveBeenLastCalledWith(0, [1, 2, 3], true);
    mouse('pointerdown', { clientX: 300, clientY: 200 });
    mouse('pointerup', { clientX: 300, clientY: 200, buttons: 0 });
    expect(cb.onMeasurePoint).toHaveBeenCalledWith([1, 2, 3]);
    ac.abort();
  });

  it('outside measure mode no point is ever looked for', () => {
    const { viewer, ac, mouse, touch } = setup('camera');
    mouse('pointerdown');
    mouse('pointerup', { buttons: 0 });
    touch('pointerdown', 300, 200);
    touch('pointerup', 300, 200);
    expect(viewer.measureDotAt).not.toHaveBeenCalled();
    ac.abort();
  });
});

describe('review fixes (2026-11-09) · keys on the chrome, R during guided points, taps, both buttons, the wheel', () => {
  /** A keydown that bubbled to the stage from `target` (a focused button of its chrome, or a popover control). */
  const from = (s: ReturnType<typeof setup>, target: object, k: string, code: string): Event => {
    const e = keyEvent('keydown', k, { code });
    Object.defineProperty(e, 'target', { value: target });
    s.stage.dispatchEvent(e);
    return e;
  };
  const button = (inPopover = false): object => ({ tagName: 'BUTTON', closest: (sel: string) => (inPopover && sel === '.xch__display' ? {} : null) });

  it('a character key on a chrome button acts as on the stage; the button keeps Enter, Space, arrows, Home and End; a popover keeps every key', () => {
    const s = setup('camera');
    expect(from(s, button(), '1', 'Digit1').defaultPrevented).toBe(true); // the views dial: 1 is Front
    expect(s.cb.onPreset).toHaveBeenLastCalledWith('front', true);
    from(s, button(), 'p', 'KeyP'); // the icon bar: P is the cut
    expect(s.cb.onToggleSection).toHaveBeenCalledTimes(1);
    for (const [k, code] of [['Enter', 'Enter'], [' ', 'Space'], ['ArrowLeft', 'ArrowLeft'], ['Home', 'Home'], ['End', 'End']]) {
      expect(from(s, button(), k!, code!).defaultPrevented, k).toBe(false);
    }
    expect(s.viewer.target.toArray(), 'the arrows stay the toolbar\'s').toEqual([0, 0, 0]);
    expect(s.viewer.setOrbitCenter, 'Home stays the toolbar\'s').not.toHaveBeenCalled();
    expect(from(s, button(true), 'p', 'KeyP').defaultPrevented, 'a switch in the Section menu').toBe(false);
    expect(from(s, { tagName: 'INPUT', closest: () => null }, '5', 'Digit5').defaultPrevented, 'a range input').toBe(false);
    expect(s.cb.onToggleSection).toHaveBeenCalledTimes(1);
    expect(s.cb.onPreset).toHaveBeenCalledTimes(1);
    s.ac.abort();
  });

  it('R during guided points says why it does nothing (once when held) and still leaves the key alone', () => {
    const s = setup('guided');
    const onMeasureBusy = vi.fn();
    (s.cb as ControlCallbacks).onMeasureBusy = onMeasureBusy;
    expect(s.key('r', { code: 'KeyR' }).defaultPrevented).toBe(false);
    s.key('r', { code: 'KeyR', repeat: true });
    expect(onMeasureBusy).toHaveBeenCalledTimes(1);
    expect(s.cb.onToggleMeasure).not.toHaveBeenCalled();
    s.ac.abort();
  });

  it('a double tap is two taps on one spot: two quick taps apart are two taps; while taps place points none fits', () => {
    const s = setup('camera');
    s.touch('pointerdown', 300, 300, 1);
    s.touch('pointerup', 300, 300, 1);
    s.touch('pointerdown', 520, 340, 2); // within 300 ms, 225 px away: a second tap
    s.touch('pointerup', 520, 340, 2);
    expect(s.cb.onPreset).not.toHaveBeenCalled();
    expect(s.cb.onSelect).toHaveBeenCalledTimes(2);
    s.touch('pointerdown', 530, 345, 3); // within 24 px of the last tap: a double tap fits
    s.touch('pointerup', 530, 345, 3);
    expect(s.cb.onPreset).toHaveBeenCalledWith('fit');
    s.ac.abort();
    for (const mode of ['guided', 'measure'] as const) {
      const p = setup(mode);
      for (const id of [1, 2]) { p.touch('pointerdown', 300, 300, id); p.touch('pointerup', 300, 300, id); }
      expect(p.cb.onPreset, mode).not.toHaveBeenCalled();
      p.canvas.dispatchEvent(new Event('dblclick'));
      expect(p.cb.onPreset, `${mode}: dblclick`).not.toHaveBeenCalled();
      p.ac.abort();
    }
    const c = setup('set');
    c.canvas.dispatchEvent(new Event('dblclick'));
    expect(c.cb.onPreset, 'elsewhere a double-click still fits').toHaveBeenCalledWith('fit');
    c.ac.abort();
  });

  it('right then left (both buttons) pans too; releasing one keeps the pan', () => {
    const { viewer, ac, mouse } = setup('camera');
    mouse('pointerdown', { button: 2, buttons: 2 });
    mouse('pointermove', { button: 0, buttons: 3 });
    mouse('pointermove', { button: -1, buttons: 3, clientX: 460 });
    mouse('pointermove', { button: 0, buttons: 2, clientX: 500 });
    mouse('pointerup', { button: 2, buttons: 0, clientX: 500 });
    expect(viewer.q.equals(new THREE.Quaternion())).toBe(true);
    expect(viewer.target.x).toBeCloseTo(-5); // 100 px at 0.05 mm per px, the scene follows the pointer
    ac.abort();
  });

  it('the wheel over the chrome zooms; over a popover it scrolls the popover and never the page; the canvas wheel is handled once', () => {
    const { viewer, cb, ac, stage, canvas } = setup('camera');
    const wheel = (target: object, props: Record<string, unknown> = {}): Event => {
      const e = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100, deltaX: 0, deltaMode: 0, clientX: 700, clientY: 100, shiftKey: false, ...props });
      Object.defineProperty(e, 'target', { value: target });
      stage.dispatchEvent(e);
      return e;
    };
    const popover = (scrolls: boolean): object => ({ closest: (sel: string) => (sel === '.xch__display' ? { scrollHeight: scrolls ? 700 : 300, clientHeight: 400 } : null) });
    expect(wheel(popover(true)).defaultPrevented, 'a popover that scrolls scrolls itself').toBe(false);
    expect(wheel(popover(false)).defaultPrevented, 'one that does not: nothing moves').toBe(true);
    expect(viewer.dist).toBe(100);
    expect(wheel(canvas).defaultPrevented, 'bubbled from the canvas: already handled there').toBe(false);
    expect(cb.onCameraInput).not.toHaveBeenCalled();
    wheel({ closest: () => null }); // the legend, say
    expect(viewer.dist).toBeCloseTo(112);
    expect(cb.onCameraInput).toHaveBeenCalledTimes(1);
    ac.abort();
  });
});
