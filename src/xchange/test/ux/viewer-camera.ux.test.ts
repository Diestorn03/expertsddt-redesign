/**
 * UX review, the 3D view (UI-DESIGN §6.1, §6.3, §6.7): view keys with motion on, and replacements drawn over the scan
 * bodies they coincide with once aligned. The real Viewer and controls run on three.js with only WebGLRenderer
 * replaced (no GPU in Node) and the fake DOM of ../adversarial/fake-dom.
 */
import type gsap from 'gsap';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { makeScanBodyCad } from '../../sample';
import { attachControls, type ControlCallbacks } from '../../viewer/controls';
import { PRESET_KEYS, presetView } from '../../viewer/presets';
import { DEPTH_BIAS_MM, Viewer } from '../../viewer/viewer';
import type { Mat4, TriMesh } from '../../core/types';
import { fakeElement, installFakeDom, keyEvent } from '../adversarial/fake-dom';

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

/** A 60 × 50 × 12 mm box standing in for a jaw scan. */
function box(): TriMesh {
  const g = new THREE.BoxGeometry(60, 50, 12);
  const mesh = { positions: Float32Array.from(g.getAttribute('position').array), indices: Uint32Array.from(g.getIndex()!.array) };
  g.dispose();
  return mesh;
}

const at = (x: number, y: number, z: number): Mat4 => Float64Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);
const tweenOf = (v: Viewer): gsap.core.Tween | null => (v as unknown as { camTween: gsap.core.Tween | null }).camTween;
const render = (v: Viewer): void => (v as unknown as { render(): void }).render();

function callbacks(v: Viewer): ControlCallbacks {
  return {
    mode: () => 'camera', onSelect() {}, onGuidedPoint() {}, onSetChange() {}, onHover() {}, onToggleJawOpacity() {}, onToggleMap() {},
    onShortcuts() {}, onGuidedKey() {}, onCtrl() {},
    onPreset: (p) => (p === 'fit' ? v.fit() : v.view(p)), // as Stage.preset
  };
}

describe('view keys with motion on (the visitors’ default)', () => {
  it('1-6, 0 and Home move the camera: the key does not stop the tween it starts', () => {
    const stage = fakeElement();
    const v = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: false, onContextLost() {} });
    v.arch = 'upper';
    v.setJaw(box(), null);
    const ac = new AbortController();
    attachControls(v, stage as unknown as HTMLElement, callbacks(v), ac.signal);
    const start = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -0.7, 0.2));
    for (const key of ['1', '2', '3', '4', '5', '6', '0', 'Home']) {
      v.q.copy(start);
      v.target.set(3, -4, 5);
      v.dist = 50_000;
      stage.dispatchEvent(keyEvent('keydown', key));
      const tween = tweenOf(v);
      expect(tween, `key ${key} keeps its camera tween`).not.toBeNull();
      tween!.progress(1);
      const preset = PRESET_KEYS[key];
      const { from, up } = presetView(preset ?? 'occlusal', 'upper');
      const want = preset ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(), new THREE.Vector3(...up))) : start;
      expect(v.q.angleTo(want), `key ${key} orientation`).toBeLessThan(1e-6);
      expect(v.dist, `key ${key} frames the case`).toBeLessThan(10_000);
      expect(v.target.distanceTo(new THREE.Vector3(3, -4, 5)), `key ${key} recenters`).toBeGreaterThan(1);
    }
    ac.abort();
    v.dispose();
  });

  it('an arrow key still takes over from a running view tween (direct input wins)', () => {
    const stage = fakeElement();
    const v = new Viewer(stage as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: false, onContextLost() {} });
    v.setJaw(box(), null);
    const ac = new AbortController();
    attachControls(v, stage as unknown as HTMLElement, callbacks(v), ac.signal);
    stage.dispatchEvent(keyEvent('keydown', '2'));
    expect(tweenOf(v)).not.toBeNull();
    stage.dispatchEvent(keyEvent('keydown', 'ArrowLeft'));
    expect(tweenOf(v)).toBeNull();
    ac.abort();
    v.dispose();
  });
});

describe('replacements over the scan bodies they coincide with (z-fighting)', () => {
  it(`draws every replacement ${DEPTH_BIAS_MM * 1000} µm nearer the camera at every zoom and field of view`, () => {
    const v = new Viewer(fakeElement() as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    v.setJaw(box(), null);
    v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
    const body = makeScanBodyCad();
    for (const id of ['a', 'b']) v.setGeometry(id, 'body', body, null);
    const meshes = v.assembly.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
    let checked = 0;
    for (const fovDeg of [1, 30, 60]) {
      for (const zoom of [0.25, 1, 25]) {
        v.setDisplay({ fovDeg });
        v.view('front', true);
        v.dist *= zoom;
        render(v);
        const cam = v.camera;
        for (const mesh of meshes) {
          const m = mesh.material;
          expect(m.polygonOffset).toBe(true);
          expect(m.polygonOffsetFactor).toBeLessThan(0); // also slope-scaled, for the grazing walls
          // independent check through three's own projection: the window depth that DEPTH_BIAS_MM toward the camera spans
          const p = mesh.geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
          const toward = cam.position.clone().sub(p).normalize().multiplyScalar(DEPTH_BIAS_MM);
          const windowZ = (q: THREE.Vector3): number => (q.clone().project(cam).z + 1) / 2;
          const units = (windowZ(p) - windowZ(p.clone().add(toward))) * 2 ** 24;
          expect(-m.polygonOffsetUnits, `fov ${fovDeg}°, zoom ×${zoom}`).toBeGreaterThanOrEqual(units * 0.999);
          expect(-m.polygonOffsetUnits, `fov ${fovDeg}°, zoom ×${zoom}`).toBeLessThanOrEqual(units * 1.02 + 1);
          checked++;
        }
      }
    }
    expect(checked).toBe(18);
    v.dispose();
  });
});

describe('highlight ring and materials (look: gold parts, color map, grey placeholders)', () => {
  const setup = (): { v: Viewer; ring: (id: string) => THREE.Mesh[]; part: (id: string) => THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> } => {
    const v = new Viewer(fakeElement() as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    v.setJaw(box(), null);
    v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
    const part = (id: string) => v.assembly.children.find((o) => o.userData.siteId === id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
    return { v, part, ring: (id) => part(id).children as THREE.Mesh[] };
  };

  it('the selected implant, the guided target and a pulse show the ring; nothing else does', () => {
    const { v, ring } = setup();
    expect(v.assembly.children).toHaveLength(2); // the ring hangs under each part, never in the set itself
    const shown = (id: string): boolean => ring(id).every((r) => r.visible);
    const hidden = (id: string): boolean => ring(id).every((r) => !r.visible);
    expect(ring('a')).toHaveLength(9); // stencil mask + 8 shifted copies
    expect(hidden('a') && hidden('b')).toBe(true);
    v.setSelected('a');
    expect(shown('a') && hidden('b')).toBe(true);
    v.setSelected(null);
    v.setGuided({ current: 'b', dim: true });
    expect(hidden('a') && shown('b')).toBe(true);
    v.setGuided(null);
    expect(hidden('a') && hidden('b')).toBe(true);
    v.pulseSites(['a']);
    expect(shown('a')).toBe(true);
    v.dispose();
  });

  it('the ring follows the part geometry and is drawn last (mask before copies)', () => {
    const { v, ring, part } = setup();
    const body = makeScanBodyCad();
    v.setGeometry('a', 'body', body, null);
    for (const r of ring('a')) expect(r.geometry).toBe(part('a').geometry);
    const [mask, ...copies] = ring('a');
    expect(mask!.renderOrder).toBeLessThan(Math.min(...copies.map((c) => c.renderOrder)));
    expect(mask!.renderOrder).toBeGreaterThan(Math.max(part('a').renderOrder, 2)); // after the see-through jaw (2)
    v.setGeometry('a', null, null, null);
    for (const r of ring('a')) expect(r.geometry).toBe(part('a').geometry);
    v.dispose();
  });

  it('a position without geometry is an opaque grey placeholder; a part is gold; the map keeps its LUT colors', () => {
    const { v, part } = setup();
    const body = makeScanBodyCad();
    const m = part('a').material;
    expect(m.opacity).toBe(1);
    expect('#' + m.color.getHexString()).toBe('#b8b5b0');
    v.setGeometry('a', 'body', body, null);
    expect('#' + m.color.getHexString()).toBe('#d8ad77');
    const gold = m.specular.r;
    // color map on: vertex colors, white base, less specular, and no warm glow on a highlighted part (it would read as µm)
    v.setDeviation(new Map([['a', new Float32Array(body.positions.length / 3).fill(80)]]), 'replacement', () => undefined);
    v.setDisplay({ map: true });
    v.setSelected('a');
    expect(m.vertexColors).toBe(true);
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.specular.r).toBeLessThan(gold / 2);
    expect(m.emissiveIntensity).toBe(0);
    expect(part('a').children.every((r) => r.visible)).toBe(true);
    v.setDisplay({ map: false });
    expect(m.emissiveIntensity).toBeGreaterThan(0);
    v.dispose();
  });
});
