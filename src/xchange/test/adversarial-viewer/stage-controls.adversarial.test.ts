/**
 * Adversarial review of the finished viewer (d8a5229..6d52ebf), input and stage paths: the real attachControls on
 * EventTarget stand-ins (the pattern of test/ux/controls-keys.ux.test.ts, picking stubbed), the real viewForKey, and the
 * real Stage + App.resetCase on objects built without their DOM constructors. Tests named "BUG:" fail on purpose until
 * the code is fixed. No WebGL, synthetic data only.
 */
import * as THREE from 'three';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Mat4, Vec3 } from '../../core/types';
import { freshCase, Store, type CaseState } from '../../state/case';
import { App } from '../../ui/app';
import en from '../../ui/i18n/en';
import { Stage } from '../../ui/stage';
import { attachControls, type ControlCallbacks } from '../../viewer/controls';
import { viewForKey } from '../../viewer/presets';
import { DEFAULT_DISPLAY, type Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, pointer, type FakeElement } from '../adversarial/fake-dom';

const g = globalThis as Record<string, unknown>;
const had = g.window !== undefined;
installFakeDom();
afterAll(() => { if (!had) delete g.window; });

describe('exocad view keys on the number row (A2)', () => {
  it('BUG: on a French AZERTY keyboard 6 (Right) and 8 (Top) zoom out instead: "symbols win" eats the "-" and "_" printed there', () => {
    // French AZERTY number row, unshifted: & é " ' ( - è _ ç à. The spec promises "an AZERTY number row types &é"'… and
    // still works" and the help says "6 Right, 8 Top (number row or keypad, as in Exocad)".
    expect(viewForKey('Digit1', '&')).toBe('front'); // holds
    expect(viewForKey('Digit5', '(')).toBe('fit'); // holds
    expect([viewForKey('Digit6', '-'), viewForKey('Digit8', '_')], 'Digit6 types "-", Digit8 types "_"').toEqual(['right', 'top']);
  });
});

describe('distance points by touch (B3)', () => {
  it('BUG: on a tablet two quick taps on two different points fit the view instead of placing the second point', () => {
    const canvas = Object.assign(new EventTarget(), { setPointerCapture(): void {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) });
    const stage = Object.assign(new EventTarget(), { clientHeight: 600, focus(): void {}, classList: { add(): void {}, remove(): void {}, toggle(): void {} }, style: { setProperty(): void {} } });
    const viewer = {
      canvas, display: { speed: 3, fovDeg: 1 }, q: new THREE.Quaternion(), target: new THREE.Vector3(), dist: 100,
      axes: () => ({ right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), view: new THREE.Vector3(0, 0, 1) }),
      mmPerPixel: () => 0.05, stopCameraTween(): void {}, interacting(): void {}, invalidate(): void {}, setOrbitCenter(): void {}, finishPose(): void {},
      pickPart: () => null, pickSurface: vi.fn((x: number): Vec3 => [x / 10, 0, 0]), pickObject: () => 'jaw', measureDotAt: () => -1,
      assembly: { matrix: new THREE.Matrix4() }, setCenter: () => new THREE.Vector3(),
    };
    const onMeasurePoint = vi.fn(), onPreset = vi.fn();
    const cb: ControlCallbacks = {
      mode: () => 'measure', onSelect() {}, onGuidedPoint() {}, onSetChange() {}, onHover() {}, onPreset, onToggleJawOpacity() {},
      onToggleMap() {}, onShortcuts() {}, onGuidedKey() {}, onCtrl() {}, onMeasurePoint,
    };
    const ac = new AbortController();
    attachControls(viewer as unknown as Viewer, stage as unknown as HTMLElement, cb, ac.signal);
    const tap = (x: number, y: number, id: number): void => {
      canvas.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y }));
      canvas.dispatchEvent(pointer('pointerup', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, buttons: 0 }));
    };
    tap(300, 300, 5); // the first cap
    tap(520, 340, 6); // the second cap, 225 px away, within 300 ms
    // Today any second tap within 300 ms is a double tap (no distance check): Fit runs and the point is never placed
    expect(onPreset, 'no Fit').not.toHaveBeenCalled();
    expect(onMeasurePoint, 'both points placed').toHaveBeenCalledTimes(2);
    ac.abort();
  });
});

describe('a new case resets the tools silently (B2/B3, §5.10)', () => {
  /** A fake element that keeps its attributes and one child per selector (q() in the Stage), as in viewer-tools. */
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

  it('BUG: New case, the sample or Exit sample while measuring announces "Distance tool closed."', () => {
    const store = new Store<CaseState>({ ...freshCase('upper'), jaw: { mesh: { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) }, originalBytes: new Uint8Array(0), format: 'stl' } });
    const said: string[] = [];
    const viewer = { setSection: vi.fn((): number => 12), setMeasure: vi.fn(), finishPose: vi.fn(), hasJawColors: false };
    const stageApp = { lang: 'en' as const, c: en, viewer, say: { say: (t: string) => void said.push(t) }, get s() { return store.state; }, alignStep: { guided: null }, root: rec(), shown: 4 };
    const st = Object.create(Stage.prototype) as Stage;
    Object.assign(st, { app: stageApp, el: rec(), pop: rec({ hidden: true }), popBtn: rec(), secPop: rec({ hidden: true }), secBtn: rec(), display: { ...DEFAULT_DISPLAY }, hidden: new Set(), section: null, measure: null });
    // App: store.subscribe(() => this.render()), and render() ends with this.stage.update()
    store.subscribe(() => st.update());
    st.toggleMeasure();
    st.measurePoint([0, 0, 0] as Vec3);
    said.length = 0;
    const app = {
      store, get s() { return store.state; }, alignStep: { resetCase(): void {} }, jobs: { cancelAll(): void {} }, selected: null, meshCache: new Map(),
      jawNormals: null, componentData: [], geometry: { target: 'all', clearCaseNotes(): void {} }, clearAlerts(): void {}, notes(): void {}, capture: { clearWarnings(): void {} },
      stage: st, rebuildViewer(): void {},
    };
    App.prototype.resetCase.call(app as unknown as App, null); // main.ts: New case / Exit sample (the sample: resetCase(arch))
    expect(st.measuring).toBe(false);
    // Today store.set(freshCase()) renders first: Stage.update() sees another pose and ends the tool out loud, before
    // resetTools() would have ended it silently (§5.10 "remove the cut silently"); the user hears it with "New case."
    expect(said, 'nothing said by the reset').toEqual([]);
    expect((st as unknown as { measure: { pose: Mat4 } | null }).measure).toBeNull();
  });
});
