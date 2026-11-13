/**
 * Slice B of VIEWER-POLISH.md in the real Viewer: GPU picking (B1), the section plane and its cut faces (B2), the distance
 * overlay (B3). three.js is the real library; only WebGLRenderer is replaced (no GPU in Node), by a stand-in that runs a
 * pick pass the way three does (each visible mesh on the camera's layers, the override material's per-draw callback) and
 * answers a canned pixel. Then the Stage's side of B2 and B3 (popover state, the distance tool, exclusivity,
 * announcements EN/ES) on a Stage built without its DOM constructor. Fake DOM of ../adversarial/fake-dom.
 */
import type gsap from 'gsap';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mat4, TriMesh, Vec3 } from '../../core/types';
import { makeScanBodyCad } from '../../sample';
import en from '../../ui/i18n/en';
import es from '../../ui/i18n/es';
import { distanceMm, Stage } from '../../ui/stage';
import { AlignStep } from '../../ui/step-align';
import { PICK_CAPTURE, PICK_JAW, PICK_PART } from '../../viewer/pick';
import { DEFAULT_DISPLAY, Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

interface Draw { object: THREE.Object3D; code: number; offset: boolean; units: number; side: THREE.Side }
interface PickPass { target: unknown; mask: number; view: THREE.PerspectiveCamera['view']; override: THREE.Material | null; alpha: number; draws: Draw[] }

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    /** Float render targets (EXT_color_buffer_float) in this test. */
    static gpu = false;
    readonly domElement = Object.assign(new EventTarget(), {
      className: '',
      setAttribute(): void {},
      remove(): void {},
      setPointerCapture(): void {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }),
    });
    readonly extensions = { has: (name: string): boolean => name === 'EXT_color_buffer_float' && WebGLRenderer.gpu };
    localClippingEnabled = false;
    toneMapping = 0;
    target: unknown = null;
    clear = new three.Color();
    alpha = 1;
    /** What the next readRenderTargetPixels answers. */
    pixel = [0, 0, 0, 0];
    passes: PickPass[] = [];
    setClearColor(c: THREE.ColorRepresentation, a = 1): void { this.clear.set(c); this.alpha = a; }
    getClearColor(t: THREE.Color): THREE.Color { return t.copy(this.clear); }
    getClearAlpha(): number { return this.alpha; }
    getRenderTarget(): unknown { return this.target; }
    setRenderTarget(t: unknown): void { this.target = t; }
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
      const mat = scene.overrideMaterial as THREE.ShaderMaterial | null;
      if (!mat) return; // a frame: nothing to record
      const draws: Draw[] = [];
      scene.traverseVisible((o) => {
        if (!(o as THREE.Mesh).isMesh || !o.layers.test(camera.layers)) return;
        mat.onBeforeRender(this as never, scene, camera, (o as THREE.Mesh).geometry, o, null as never);
        draws.push({ object: o, code: mat.uniforms.code!.value as number, offset: mat.polygonOffset, units: mat.polygonOffsetUnits, side: mat.side });
      });
      this.passes.push({ target: this.target, mask: camera.layers.mask, view: camera.view && { ...camera.view }, override: mat, alpha: this.alpha, draws });
    }
    readRenderTargetPixels(_t: unknown, _x: number, _y: number, _w: number, _h: number, buf: Float32Array): void { buf.set(this.pixel); }
    setPixelRatio(): void {}
    setSize(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer };
});

const { document: doc } = installFakeDom();
// the distance overlay's <svg> and <line>s: fake elements that keep their attributes
(doc as unknown as Record<string, unknown>).createElementNS = (_ns: string, tag: string): FakeElement => {
  const attrs: Record<string, string> = {};
  return fakeElement({ tag, attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null });
};

type Fake = { gpu: boolean };
type Rnd = { passes: PickPass[]; pixel: number[]; setClearColor(c: THREE.ColorRepresentation, a?: number): void; getClearAlpha(): number; getRenderTarget(): unknown; setRenderTarget(t: unknown): void; getClearColor(t: THREE.Color): THREE.Color };
const rnd = (v: Viewer): Rnd => v.renderer as unknown as Rnd;
const priv = <T>(v: object, key: string): T => (v as Record<string, T>)[key]!;
const render = (v: Viewer): void => (v as unknown as { render(): void }).render();
afterEach(() => { vi.useRealTimers(); (THREE.WebGLRenderer as unknown as Fake).gpu = false; });

/** A 60 × 50 × 12 mm box standing in for a jaw scan. */
function box(sx = 60, sy = 50, sz = 12): TriMesh {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const mesh = { positions: Float32Array.from(g.getAttribute('position').array), indices: Uint32Array.from(g.getIndex()!.array) };
  g.dispose();
  return mesh;
}
const at = (x: number, y: number, z: number): Mat4 => Float64Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);

/** Jaw box, two scan bodies on it (a at y −10, b at y 12), one captured shell; front view (camera at −Y). */
function scene(gpu: boolean, opts: { reducedMotion?: boolean; labels?: FakeElement } = {}): Viewer {
  (THREE.WebGLRenderer as unknown as Fake).gpu = gpu;
  const v = new Viewer(fakeElement() as unknown as HTMLElement, (opts.labels ?? fakeElement()) as unknown as HTMLElement, { reducedMotion: opts.reducedMotion ?? true, onContextLost() {} });
  v.arch = 'lower';
  v.setJaw(box(), null);
  v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
  const body = makeScanBodyCad();
  for (const id of ['a', 'b']) v.setGeometry(id, 'body', body, null);
  v.setCapture([{ mesh: box(4, 4, 10), normals: null }]);
  v.setDisplay({ capture: true });
  v.view('front', true);
  return v;
}
const part = (v: Viewer, id: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> => v.assembly.children.find((o) => o.userData.siteId === id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
const jaw = (v: Viewer): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> => priv(v, 'jaw');
const ghost = (v: Viewer): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> => priv<THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>[]>(v, 'ghosts')[0]!;

describe('B1 · GPU picking', () => {
  it('one render into the 1×1 float target framed on the clicked pixel; it returns what the pixel holds', () => {
    const v = scene(true);
    rnd(v).pixel = [1.5, -2.25, 30.125, PICK_PART + 1];
    expect(v.pickSurface(300, 200)).toEqual([1.5, -2.25, 30.125]);
    expect(v.pickObject(300, 200)).toBe('part');
    const pass = rnd(v).passes.at(-1)!;
    const target = pass.target as THREE.WebGLRenderTarget;
    expect([target.width, target.height, target.texture.type]).toEqual([1, 1, THREE.FloatType]);
    expect(pass.view).toMatchObject({ enabled: true, fullWidth: 800, fullHeight: 600, offsetX: 299.5, offsetY: 199.5, width: 1, height: 1 });
    expect(pass.alpha, 'cleared to code 0').toBe(0);
    expect(pass.override).toBeInstanceOf(THREE.ShaderMaterial);
    expect(pass.override!.side).toBe(THREE.DoubleSide);
    rnd(v).pixel = [4, 5, 6, PICK_CAPTURE];
    expect(v.pickObject(1, 1)).toBe('capture');
    rnd(v).pixel = [4, 5, 6, PICK_JAW];
    expect(v.pickObject(1, 1)).toBe('jaw');
    rnd(v).pixel = [4, 5, 6, 0];
    expect(v.pickSurface(1, 1)).toBeNull();
    v.dispose();
  });

  it('draws the jaw, each implant (3 + its index) and the captured shell, with their depth bias; never rings, pins or cut faces', () => {
    const v = scene(true);
    v.setSelected('a'); // ring on
    v.setPins([[0, 0, 6]]);
    v.setSection({ offset: 0, flipped: false, follow: false }); // cut faces on
    v.pickSurface(400, 300);
    const draws = rnd(v).passes.at(-1)!.draws;
    expect(new Set(draws.map((d) => d.object))).toEqual(new Set([jaw(v), part(v, 'a'), part(v, 'b'), ghost(v)]));
    expect(draws).toHaveLength(4);
    const code = (o: THREE.Object3D): number => draws.find((d) => d.object === o)!.code;
    expect([code(jaw(v)), code(part(v, 'a')), code(part(v, 'b')), code(ghost(v))]).toEqual([PICK_JAW, PICK_PART, PICK_PART + 1, PICK_CAPTURE]);
    for (const o of [part(v, 'a'), part(v, 'b'), ghost(v)]) {
      const d = draws.find((x) => x.object === o)!;
      expect(d.offset).toBe(true);
      expect(d.units).toBe((o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.polygonOffsetUnits);
      expect(d.units).toBeLessThan(0);
    }
    expect(draws.find((d) => d.object === jaw(v))!.offset).toBe(false);
    v.dispose();
  });

  it('rasterizes the sides the frame draws: replacements their front only, with the cut their cut faces too; the scans both; nothing kept after', () => {
    const v = scene(true);
    const sides = (): THREE.Side[] => rnd(v).passes.at(-1)!.draws.map((d) => d.side);
    const objects = (): THREE.Object3D[] => rnd(v).passes.at(-1)!.draws.map((d) => d.object);
    v.pickObject(400, 300);
    const expected = (o: THREE.Object3D, cut: boolean): THREE.Side => (o === part(v, 'a') || o === part(v, 'b')) && !cut ? THREE.FrontSide : THREE.DoubleSide;
    expect(sides()).toEqual(objects().map((o) => expected(o, false)));
    v.setSection({ offset: 0, flipped: false, follow: false });
    v.pickObject(400, 300);
    expect(sides()).toEqual(objects().map((o) => expected(o, true)));
    expect(priv<THREE.ShaderMaterial>(v, 'pickMat').side, 'the material itself ends double-sided').toBe(THREE.DoubleSide);
    expect(priv<Map<THREE.Object3D, number>>(v, 'pickCode').size, 'no mesh is kept between picks').toBe(0);
    v.dispose();
  });

  it('jawOnly (guided points) sees the jaw alone; hidden or nearly transparent meshes are not pickable', () => {
    const v = scene(true);
    v.pickSurface(400, 300, true);
    let pass = rnd(v).passes.at(-1)!;
    expect(pass.mask).toBe(1 << 1);
    expect(pass.draws.map((d) => d.object)).toEqual([jaw(v)]);
    v.setDisplay({ partOpacity: 0.05, capture: false });
    v.pickObject(400, 300);
    pass = rnd(v).passes.at(-1)!;
    expect(pass.mask).toBe((1 << 1) | (1 << 2));
    expect(pass.draws.map((d) => d.object)).toEqual([jaw(v)]);
    v.setDisplay({ partOpacity: 0.1, jaw: false });
    v.pickObject(400, 300);
    expect(rnd(v).passes.at(-1)!.draws.map((d) => d.object)).toEqual([part(v, 'a'), part(v, 'b')]);
    v.dispose();
  });

  it('leaves target, clear color, override material, camera layers and view offset as they were, and schedules no frame', () => {
    vi.useFakeTimers();
    const v = scene(true);
    vi.runAllTimers(); // the frame the setup asked for, and the warm-up pick
    const sentinel = new THREE.WebGLRenderTarget(2, 2);
    rnd(v).setRenderTarget(sentinel);
    rnd(v).setClearColor(0x123456, 0.25);
    const projection = v.camera.projectionMatrix.clone();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    v.pickSurface(300, 200);
    v.pickObject(310, 210);
    expect(rnd(v).getRenderTarget()).toBe(sentinel);
    expect(rnd(v).getClearColor(new THREE.Color()).getHex()).toBe(0x123456);
    expect(rnd(v).getClearAlpha()).toBe(0.25);
    expect(v.scene.overrideMaterial).toBeNull();
    expect(v.camera.layers.mask).toBe(1);
    expect(v.camera.view?.enabled ?? false).toBe(false);
    expect(v.camera.projectionMatrix.equals(projection)).toBe(true);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
    sentinel.dispose();
    v.dispose();
  });

  it('warm-up: one pick at the stage center once a jaw loads, when the browser is idle (200 ms without requestIdleCallback); the cut never needs another', () => {
    vi.useFakeTimers();
    const v = scene(true);
    const passes = rnd(v).passes;
    expect(passes).toHaveLength(0);
    vi.advanceTimersByTime(250);
    expect(passes).toHaveLength(1);
    expect(passes[0]!.view).toMatchObject({ offsetX: 399.5, offsetY: 299.5 });
    // the pick shader always carries the plane (it clips nothing without a cut): one program, warmed with the jaw. The
    // cut on, moved, flipped, following and off again changes no material, so nothing recompiles and nothing re-warms
    const pickMat = priv<THREE.ShaderMaterial>(v, 'pickMat'), version = pickMat.version;
    expect(passes[0]!.override!.clippingPlanes).toEqual([v.plane]);
    v.setSection({ offset: 0, flipped: false, follow: false });
    v.setSection({ offset: 2, flipped: true, follow: true });
    v.setSection(null);
    vi.advanceTimersByTime(1000);
    expect(passes).toHaveLength(1);
    expect(pickMat.version, 'no recompile').toBe(version);
    expect(pickMat.clippingPlanes).toEqual([v.plane]);
    v.dispose();
    const w = scene(true);
    w.dispose(); // a pending warm-up goes with the viewer
    vi.advanceTimersByTime(1000);
    expect(rnd(w).passes).toHaveLength(0);
  });

  it('without float targets nothing is rendered: the three raycast answers, and respects the cut', () => {
    const v = scene(false);
    v.setDisplay({ parts: false, capture: false });
    const hit = v.pickSurface(400, 300)!;
    expect(hit[1]).toBeCloseTo(-25, 4); // the box's near face (camera at −Y)
    v.setSection({ offset: 0, flipped: false, follow: false });
    const behind = v.pickSurface(400, 300)!;
    expect(behind[1], 'the near half is cut away: the inside of the far wall').toBeCloseTo(25, 4);
    expect(v.plane.distanceToPoint(new THREE.Vector3(...behind))).toBeGreaterThan(0);
    expect(v.pickObject(400, 300)).toBe('jaw');
    expect(rnd(v).passes).toHaveLength(0);
    v.dispose();
  });

  it('dispose releases the pick target and material and the cut material', () => {
    const v = scene(true);
    v.pickSurface(400, 300);
    const gone: string[] = [];
    for (const k of ['pickTarget', 'pickMat', 'cutMaterial']) priv<THREE.EventDispatcher<{ dispose: object }>>(v, k).addEventListener('dispose', () => gone.push(k));
    v.dispose();
    expect(gone.sort()).toEqual(['cutMaterial', 'pickMat', 'pickTarget']);
  });
});

describe('B2 · the section plane in the viewer', () => {
  const lookDir = (v: Viewer): THREE.Vector3 => new THREE.Vector3(0, 0, -1).applyQuaternion(v.q);

  it('starts through the orbit target, facing away from the camera; the slider half-range is the radius of what is shown', () => {
    const v = scene(false);
    const r = v.setSection({ offset: 0, flipped: false, follow: false });
    expect(v.plane.normal.distanceTo(lookDir(v))).toBeLessThan(1e-9); // front view: +Y
    expect(v.plane.distanceToPoint(v.target)).toBeCloseTo(0, 9);
    expect(v.plane.distanceToPoint(new THREE.Vector3(0, -24, 0)), 'toward the camera: removed').toBeLessThan(0);
    const shown = new THREE.Box3().setFromObject(jaw(v)).union(new THREE.Box3().setFromObject(v.assembly)).getBoundingSphere(new THREE.Sphere()).radius;
    expect(r).toBeCloseTo(shown, 6);
    v.dispose();
  });

  it('clips every drawn surface with one plane; replacements show their back side flat in --xch-cut on a second, unpickable draw with their depth bias; the scans keep both sides lit', () => {
    const v = scene(false);
    v.setSelected('a');
    v.setSection({ offset: 0, flipped: false, follow: false });
    const meshes = [jaw(v), part(v, 'a'), part(v, 'b'), ghost(v)];
    const cutMat = priv<THREE.MeshBasicMaterial>(v, 'cutMaterial');
    for (const m of [part(v, 'a'), part(v, 'b')]) {
      expect(m.material.clippingPlanes).toEqual([v.plane]);
      expect(m.material.side).toBe(THREE.FrontSide);
      const faces = m.children.filter((c) => c.name === 'cut') as THREE.Mesh[];
      expect(faces).toHaveLength(1);
      expect(faces[0]!.material).toBe(cutMat);
      expect(faces[0]!.geometry).toBe(m.geometry);
      expect(faces[0]!.layers.mask, 'not on a pick layer').toBe(1);
    }
    // the jaw scan and the captured shell are open scanner surfaces: the cut removes from them, both sides stay lit as
    // without it (a back side painted as a section read as cut far from the plane), no cut faces
    for (const m of [jaw(v), ghost(v)]) {
      expect(m.material.clippingPlanes).toEqual([v.plane]);
      expect(m.material.side).toBe(THREE.DoubleSide);
      expect(m.children.some((c) => c.name === 'cut')).toBe(false);
    }
    expect([cutMat.side, cutMat.toneMapped, '#' + cutMat.color.getHexString(), cutMat.clippingPlanes]).toEqual([THREE.BackSide, false, '#3d9ad4', [v.plane]]);
    // the highlight ring is clipped alike, so it outlines what is left of a cut part
    for (const ring of part(v, 'a').children.filter((c) => c.name !== 'cut') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]) expect(ring.material.clippingPlanes).toEqual([v.plane]);
    // a cut face is drawn with its replacement's depth bias: where it coincides with the scanned scan body (lit, both
    // sides), the section wins without stripes
    render(v);
    const face = part(v, 'a').children.find((c) => c.name === 'cut') as THREE.Mesh;
    cutMat.onBeforeRender(v.renderer, v.scene, v.camera, face.geometry, face, null as never);
    expect([cutMat.polygonOffset, cutMat.polygonOffsetFactor, cutMat.polygonOffsetUnits]).toEqual([true, -1, part(v, 'a').material.polygonOffsetUnits]);
    expect(cutMat.polygonOffsetUnits).toBeLessThan(0);
    v.setSection(null);
    // no cut: the same plane stays on every material (no shader recompiles) and keeps everything shown
    const shown = new THREE.Box3().setFromObject(jaw(v)).union(new THREE.Box3().setFromObject(v.assembly));
    for (let i = 0; i < 8; i++) expect(v.plane.distanceToPoint(new THREE.Vector3(i & 1 ? shown.max.x : shown.min.x, i & 2 ? shown.max.y : shown.min.y, i & 4 ? shown.max.z : shown.min.z))).toBeGreaterThan(1e5);
    for (const m of meshes) {
      expect(m.material.clippingPlanes).toEqual([v.plane]);
      expect(m.children.some((c) => c.name === 'cut')).toBe(false);
    }
    expect([jaw(v).material.side, ghost(v).material.side]).toEqual([THREE.DoubleSide, THREE.DoubleSide]);
    expect(part(v, 'a').children).toHaveLength(17); // the scene graph is back as it was (ring only)
    v.dispose();
  });

  it('stays put in the scene as the view turns; Follow the view keeps it perpendicular at its depth from the target', () => {
    const v = scene(false);
    v.setSection({ offset: 3, flipped: false, follow: false });
    const fixed = v.plane.clone();
    v.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6));
    render(v);
    expect(v.plane.equals(fixed)).toBe(true);
    v.setSection({ offset: 3, flipped: false, follow: true });
    expect(v.plane.normal.distanceTo(lookDir(v))).toBeLessThan(1e-9);
    expect(v.plane.distanceToPoint(v.target)).toBeCloseTo(-3, 9); // 3 mm deeper than the target: the target is removed
    v.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4));
    v.target.add(new THREE.Vector3(2, 0, 1));
    render(v);
    expect(v.plane.normal.distanceTo(lookDir(v))).toBeLessThan(1e-9);
    expect(v.plane.distanceToPoint(v.target)).toBeCloseTo(-3, 9);
    v.setSection({ offset: 3, flipped: false, follow: false }); // off again: it stays where it is now
    const now = v.plane.clone();
    v.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1));
    render(v);
    expect(v.plane.equals(now)).toBe(true);
    v.dispose();
  });

  it('flip keeps the other half at the same place; a geometry change keeps its cut faces on the new geometry', () => {
    const v = scene(false);
    v.setSection({ offset: 2, flipped: false, follow: false });
    const p = new THREE.Vector3(0, -20, 0);
    const before = v.plane.distanceToPoint(p);
    v.setSection({ offset: 2, flipped: true, follow: false });
    expect(v.plane.distanceToPoint(p)).toBeCloseTo(-before, 9);
    v.setGeometry('a', null, null, null); // back to the placeholder
    const a = part(v, 'a');
    expect((a.children.find((c) => c.name === 'cut') as THREE.Mesh).geometry).toBe(a.geometry);
    v.dispose();
  });

  it('an implant whose middle the cut removed loses its label; the other keeps it', () => {
    const labels = fakeElement();
    const v = scene(false, { labels });
    const tag = (id: string): FakeElement => labels.children.filter((c) => c.className === 'xch__tag')[id === 'a' ? 0 : 1]!;
    render(v);
    expect([tag('a').classList.contains('is-off'), tag('b').classList.contains('is-off')]).toEqual([false, false]);
    v.setSection({ offset: 0, flipped: false, follow: false }); // front view: y < target (0) is removed; a stands at y −10
    render(v);
    expect([tag('a').classList.contains('is-off'), tag('b').classList.contains('is-off')]).toEqual([true, false]);
    v.setSection({ offset: 0, flipped: true, follow: false });
    render(v);
    expect([tag('a').classList.contains('is-off'), tag('b').classList.contains('is-off')]).toEqual([false, true]);
    v.dispose();
  });
});

describe('implant labels step aside from the chrome', () => {
  it('a label that would sit under the chrome (the views dial on a tablet) goes to the other side of its part', () => {
    const labels = fakeElement();
    const v = scene(false, { labels });
    render(v);
    const tag = labels.children.filter((c) => c.className === 'xch__tag')[1]!; // B
    const rect = (): number[] => {
      const [x, y, tx, ty] = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) translate\(([-\d.e]+)%, ([-\d.e]+)%\)/.exec(String(tag.style.transform))!.slice(1).map(Number) as [number, number, number, number];
      const w = 7.5 * String(tag.textContent).length + 20, h = 26;
      return [x + (tx / 100) * w, y + (ty / 100) * h, x + (tx / 100) * w + w, y + (ty / 100) * h + h];
    };
    const before = rect();
    const chrome = { x0: before[0]! - 30, y0: before[1]! - 30, x1: before[2]! + 30, y1: before[3]! + 30 };
    (v as unknown as { chrome: object[] }).chrome = [chrome];
    render(v);
    const after = rect();
    expect(after[0]! >= chrome.x1 || after[2]! <= chrome.x0 || after[1]! >= chrome.y1 || after[3]! <= chrome.y0, `${before} -> ${after}`).toBe(true);
    // on the other side of its part (labelSpot keeps it clear of the part there too)
    const b = new THREE.Box3().setFromObject(part(v, 'b'));
    const c = b.getCenter(new THREE.Vector3()).project(v.camera);
    const cx = ((c.x + 1) / 2) * 800;
    expect(Math.sign((after[0]! + after[2]!) / 2 - cx)).toBe(-Math.sign((before[0]! + before[2]!) / 2 - cx));
    v.dispose();
  });
});

describe('B3 · the distance overlay', () => {
  const overlay = (labels: FakeElement) => ({
    svg: labels.children.find((c) => c.tag === 'svg')!,
    dots: labels.children.filter((c) => String(c.className).startsWith('xch__distdot')),
    pill: labels.children.find((c) => String(c.className).startsWith('xch__distval'))!,
  });
  const off = (el: FakeElement): boolean => el.classList.contains('is-off');
  const screen = (v: Viewer, p: Vec3): [number, number] => {
    const s = new THREE.Vector3(...p).project(v.camera);
    return [((s.x + 1) / 2) * 800, ((1 - s.y) / 2) * 600];
  };

  it('one point: its dot only; two: dots, the line between them and the value at the midpoint; off-screen: nothing', () => {
    const labels = fakeElement();
    const v = scene(true, { labels });
    const a: Vec3 = [-20, -25, 0], b: Vec3 = [18, -25, 3];
    v.setMeasure([a], '', 0);
    render(v);
    const o = overlay(labels);
    expect(o.dots).toHaveLength(2);
    expect([off(o.dots[0]!), off(o.dots[1]!), off(o.svg), off(o.pill)]).toEqual([false, true, true, true]);
    v.setMeasure([a, b], '38.12 mm', 1);
    render(v);
    expect([off(o.dots[0]!), off(o.dots[1]!), off(o.svg), off(o.pill)]).toEqual([false, false, false, false]);
    const [sa, sb] = [screen(v, a), screen(v, b)];
    for (const line of o.svg.children) {
      const attrs = line.attrs as Record<string, string>;
      expect([+attrs.x1!, +attrs.y1!, +attrs.x2!, +attrs.y2!].map((x) => x.toFixed(3))).toEqual([...sa, ...sb].map((x) => x.toFixed(3)));
    }
    expect(o.pill.textContent).toBe('38.12 mm');
    expect(String(o.pill.style.transform)).toBe(`translate(${(sa[0] + sb[0]) / 2}px, ${(sa[1] + sb[1]) / 2}px) translate(-50%, -50%)`);
    expect(String(o.dots[1]!.style.transform)).toBe(`translate(${sb[0]}px, ${sb[1]}px) translate(-50%, -50%)`);
    // a press near a dot finds it (client px = stage px here); far from both: none
    expect(v.measureDotAt(sb[0] + 8, sb[1] + 8, 12)).toBe(1);
    expect(v.measureDotAt(sa[0], sa[1] - 11, 12)).toBe(0);
    expect(v.measureDotAt(sa[0] + 20, sa[1], 12)).toBe(-1);
    v.target.x += 1e4; // both points leave the stage
    render(v);
    expect([off(o.dots[0]!), off(o.dots[1]!), off(o.svg), off(o.pill)]).toEqual([true, true, true, true]);
    expect(v.measureDotAt(sa[0], sa[1], 12)).toBe(-1);
    v.setMeasure([], '');
    v.target.x -= 1e4;
    render(v);
    expect([off(o.dots[0]!), off(o.dots[1]!), off(o.svg), off(o.pill)]).toEqual([true, true, true, true]);
    v.dispose();
  });

  it('a point placed scales in like a guided pin (the pill with the second); reduced motion: no animation', () => {
    const tweens = (v: Viewer): gsap.core.Tween[] => priv<gsap.Context>(v, 'ctx').getTweens() as gsap.core.Tween[];
    const v = scene(true, { reducedMotion: false });
    v.setMeasure([[0, 0, 0]], '', 0);
    expect(tweens(v)).toHaveLength(1);
    v.setMeasure([[0, 0, 0], [1, 0, 0]], '1.00 mm', 1);
    expect(tweens(v)).toHaveLength(3);
    v.setMeasure([[0, 0, 0], [2, 0, 0]], '2.00 mm'); // a dragged point does not pop again
    expect(tweens(v)).toHaveLength(3);
    v.dispose();
    const r = scene(true, { reducedMotion: true });
    r.setMeasure([[0, 0, 0], [1, 0, 0]], '1.00 mm', 1);
    expect(tweens(r)).toHaveLength(0);
    r.dispose();
  });
});

describe('Stage · the section popover and the distance tool (B2, B3)', () => {
  /** A fake element that keeps its attributes and one child per selector (q() in the Stage). */
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
  type Parts = { secPop: FakeElement; secBtn: FakeElement; el: FakeElement };
  function stage(lang: 'en' | 'es' = 'en') {
    const said: string[] = [];
    const viewer = { setSection: vi.fn((_s: unknown): number => 12.34), setMeasure: vi.fn(), finishPose: vi.fn(), hasJawColors: false };
    const state = { s: { assembly: new Float64Array(16) as Mat4, sites: [], captureMesh: null, jaw: {}, surfaces: 'replacement', deviation: null, components: [] } };
    const app = { lang, c: lang === 'es' ? es : en, viewer, say: { say: (t: string) => void said.push(t) }, get s() { return state.s; }, alignStep: { guided: null as unknown }, root: rec(), shown: 4 };
    const st = Object.create(Stage.prototype) as Stage, f = st as unknown as Parts;
    Object.assign(st, { app, el: rec(), pop: rec({ hidden: true }), popBtn: rec(), secPop: rec({ hidden: true }), secBtn: rec(), display: { ...DEFAULT_DISPLAY }, hidden: new Set(), section: null, measure: null });
    const range = f.secPop.querySelector('[data-section-range]');
    range.parentElement = rec();
    const output = (range.parentElement as FakeElement).querySelector('output');
    const sub = (sel: string): FakeElement => f.el.querySelector(sel);
    return { st, f, said, viewer, state, app, range, output, sub };
  }
  const attr = (el: FakeElement, k: string): string | undefined => (el.attrs as Record<string, string>)[k];

  it('P: the cut on through the target (said), the slider ±r in 0.1 mm steps, Shift + wheel within it; P again: off', () => {
    const { st, f, said, viewer, range, output } = stage();
    st.toggleSection(true);
    expect(viewer.setSection).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, flipped: false, follow: false }));
    expect(said).toEqual(['Section on.']);
    expect([f.secBtn.classList.contains('is-on'), attr(f.secBtn, 'aria-label')]).toEqual([true, 'Section (on)']);
    expect([range.min, range.max, range.value, attr(range, 'aria-valuetext'), output.textContent]).toEqual(['-12.4', '12.4', '0', '0.0 mm', '0.0 mm']);
    expect(st.nudgeSection(0.5)).toBe(true);
    expect(viewer.setSection).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0.5 }));
    expect(output.textContent).toBe('0.5 mm');
    st.nudgeSection(20);
    expect(output.textContent).toBe('12.4 mm');
    st.nudgeSection(-30);
    st.nudgeSection(12.36);
    expect(output.textContent, 'never "-0.0"').toBe('0.0 mm');
    st.toggleSection(true);
    expect(viewer.setSection).toHaveBeenLastCalledWith(null);
    expect(said).toEqual(['Section on.', 'Section off.']);
    expect(st.nudgeSection(0.5), 'no cut: the wheel zooms').toBe(false);
    expect([f.secBtn.classList.contains('is-on'), attr(f.secBtn, 'aria-label')]).toEqual([false, 'Section']);
  });

  it('removing the cut closes its popover; the Spanish copy', () => {
    const { st, f, said, output } = stage('es');
    st.toggleSection(true);
    st.nudgeSection(0.5);
    expect(output.textContent).toBe('0,5 mm');
    f.secPop.hidden = false;
    st.toggleSection(true);
    expect([f.secPop.hidden, attr(f.secBtn, 'aria-expanded')]).toEqual([true, 'false']);
    expect(said).toEqual(['Corte activado.', 'Corte desactivado.']);
  });

  it('the distance: two decimals in the page language', () => {
    expect(distanceMm('en', [0, 0, 0], [12.34, 0, 0])).toBe('12.34');
    expect(distanceMm('es', [0, 0, 0], [12.34, 0, 0])).toBe('12,34');
    expect(distanceMm('en', [1, 1, 1], [4, 5, 13])).toBe('13.00');
    expect(distanceMm('en', [0, 0, 0], [0.004, 0, 0])).toBe('0.00');
  });

  it('the tool: first point, second (the value), a third starts a new pair; Backspace; Esc closes it (said)', () => {
    const { st, f, said, viewer, sub } = stage();
    st.toggleMeasure();
    expect(st.measuring).toBe(true);
    expect(viewer.finishPose).toHaveBeenCalled();
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([], '', -1);
    expect([f.el.classList.contains('is-measure'), attr(sub('[data-dist-btn]'), 'aria-pressed'), sub('[data-disthint]').hidden]).toEqual([true, 'true', false]);
    expect(attr(f.el, 'aria-describedby')).toBe('xch-view-help xch-view-dist');
    st.measurePoint([1, 1, 1]);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[1, 1, 1]], '', 0);
    st.measurePoint([4, 5, 13]);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[1, 1, 1], [4, 5, 13]], '13.00 mm', 1);
    expect(sub('[data-disthint]').hidden, 'the hint goes with the second point').toBe(true);
    st.measurePoint([0, 0, 0]);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[0, 0, 0]], '', 0);
    expect(said).toEqual(['First point placed. Now the second.', 'Distance: 13.00 mm.', 'First point placed. Now the second.']);
    st.measureKey('Backspace');
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([], '', -1);
    st.measureKey('Backspace'); // nothing left: nothing happens
    st.measureKey('Escape');
    expect(st.measuring).toBe(false);
    expect(said.at(-1)).toBe('Distance tool closed.');
    expect([f.el.classList.contains('is-measure'), attr(sub('[data-dist-btn]'), 'aria-pressed'), sub('[data-disthint]').hidden]).toEqual([false, 'false', true]);
    expect(attr(f.el, 'aria-describedby')).toBe('xch-view-help');
  });

  it('Spanish: the value and the announcement with a decimal comma', () => {
    const { st, f, said, viewer } = stage('es');
    st.toggleMeasure();
    st.measurePoint([0, 0, 0]);
    st.measurePoint([12.34, 0, 0]);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[0, 0, 0], [12.34, 0, 0]], '12,34 mm', 1);
    expect(said).toEqual(['Primer punto colocado. Ahora el segundo.', 'Distancia: 12,34 mm.']);
  });

  it('a dragged point updates the value as it goes; the release says it; over nothing it stays', () => {
    const { st, f, said, viewer } = stage();
    st.toggleMeasure();
    st.measurePoint([0, 0, 0]);
    st.measurePoint([3, 4, 0]);
    said.length = 0;
    st.measureDrag(1, [6, 8, 0], false);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[0, 0, 0], [6, 8, 0]], '10.00 mm', -1);
    expect(said).toEqual([]);
    st.measureDrag(1, null, true);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([[0, 0, 0], [6, 8, 0]], '10.00 mm', -1);
    expect(said).toEqual(['Distance: 10.00 mm.']);
  });

  it('a pose change ends it (said); guided points end it silently and keep it off (the button says why)', () => {
    const { st, f, said, state, app, sub } = stage();
    st.toggleMeasure();
    st.measurePoint([0, 0, 0]);
    state.s = { ...state.s, assembly: new Float64Array(16) as Mat4 }; // undo, reset or an alignment: another pose
    st.update();
    expect(st.measuring).toBe(false);
    expect(said.at(-1)).toBe('Distance tool closed.');
    st.toggleMeasure();
    said.length = 0;
    st.setGuided(true);
    app.alignStep.guided = {};
    st.update();
    expect(st.measuring).toBe(false);
    expect(said).toEqual([]);
    expect(attr(f.el, 'aria-describedby')).toBe('xch-view-help xch-view-gp');
    st.toggleMeasure();
    expect(st.measuring).toBe(false);
    expect(said).toEqual(['Finish the guided points first.']);
    expect([attr(sub('[data-dist-btn]'), 'aria-disabled'), attr(sub('[data-dist-btn]'), 'data-tip')]).toEqual(['true', 'Finish the guided points first.']);
    app.alignStep.guided = null;
    st.setGuided(false);
    expect([attr(sub('[data-dist-btn]'), 'aria-disabled'), attr(sub('[data-dist-btn]'), 'data-tip')]).toEqual(['false', 'Measure a distance · R']);
  });

  it('a new case or a viewer restart: no cut, no distance, nothing said', () => {
    const { st, f, said, viewer } = stage();
    st.toggleSection();
    st.toggleMeasure();
    st.resetTools();
    expect(viewer.setSection).toHaveBeenLastCalledWith(null);
    expect(viewer.setMeasure).toHaveBeenLastCalledWith([], '', -1);
    expect(st.measuring).toBe(false);
    expect(said).toEqual([]);
  });

  it('controls mode: guided points win, then the distance tool, then step 4 with a jaw drags the set', () => {
    const step = Object.create(AlignStep.prototype) as AlignStep;
    const app = { stage: { measuring: true }, shown: 4, s: { jaw: {} } };
    Object.assign(step, { app, guided: null });
    expect(step.mode()).toBe('measure');
    step.guided = {} as AlignStep['guided'];
    expect(step.mode()).toBe('guided');
    step.guided = null;
    app.stage.measuring = false;
    expect(step.mode()).toBe('set');
    app.shown = 2;
    expect(step.mode()).toBe('camera');
  });
});
