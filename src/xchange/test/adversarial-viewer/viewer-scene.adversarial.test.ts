/**
 * Adversarial review of the finished viewer (VIEWER-POLISH looks + slices A and B, d8a5229..6d52ebf): the real Viewer on
 * the real three.js, only WebGLRenderer replaced by the recording stand-in of test/ux/viewer-tools.ux.test.ts (a pick
 * pass is recorded draw by draw, readRenderTargetPixels answers a canned pixel). Tests named "BUG:" fail on purpose until
 * the production code is fixed. Synthetic data only.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mat4, TriMesh } from '../../core/types';
import { makeScanBodyCad } from '../../sample';
import { Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

interface Draw { object: THREE.Object3D; side: THREE.Side }
interface PickPass { override: THREE.Material | null; draws: Draw[] }

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
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
    pixel = [0, 0, 0, 0];
    passes: PickPass[] = [];
    setClearColor(c: THREE.ColorRepresentation, a = 1): void { this.clear.set(c); this.alpha = a; }
    getClearColor(t: THREE.Color): THREE.Color { return t.copy(this.clear); }
    getClearAlpha(): number { return this.alpha; }
    getRenderTarget(): unknown { return this.target; }
    setRenderTarget(t: unknown): void { this.target = t; }
    render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
      const mat = scene.overrideMaterial as THREE.ShaderMaterial | null;
      if (!mat) return;
      const draws: Draw[] = [];
      scene.traverseVisible((o) => {
        if (!(o as THREE.Mesh).isMesh || !o.layers.test(camera.layers)) return;
        mat.onBeforeRender(this as never, scene, camera, (o as THREE.Mesh).geometry, o, null as never);
        draws.push({ object: o, side: mat.side });
      });
      this.passes.push({ override: mat, draws });
    }
    readRenderTargetPixels(_t: unknown, _x: number, _y: number, _w: number, _h: number, buf: Float32Array): void { buf.set(this.pixel); }
    setPixelRatio(): void {}
    setSize(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer };
});

installFakeDom();

type Fake = { gpu: boolean };
const priv = <T>(v: object, key: string): T => (v as Record<string, T>)[key]!;
const render = (v: Viewer): void => (v as unknown as { render(): void }).render();
afterEach(() => { (THREE.WebGLRenderer as unknown as Fake).gpu = false; });

function box(sx = 60, sy = 50, sz = 12): TriMesh {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const mesh = { positions: Float32Array.from(g.getAttribute('position').array), indices: Uint32Array.from(g.getIndex()!.array) };
  g.dispose();
  return mesh;
}
const at = (x: number, y: number, z: number): Mat4 => Float64Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);

/** As viewer-tools: a 60 × 50 × 12 mm jaw box, the sample's CAD scan body at a (y −10) and b (y 12), front view (camera at −Y). */
function scene(gpu: boolean, labels: FakeElement = fakeElement()): Viewer {
  (THREE.WebGLRenderer as unknown as Fake).gpu = gpu;
  const v = new Viewer(fakeElement() as unknown as HTMLElement, labels as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
  v.arch = 'lower';
  v.setJaw(box(), null);
  v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
  const body = makeScanBodyCad();
  for (const id of ['a', 'b']) v.setGeometry(id, 'body', body, null);
  v.view('front', true);
  return v;
}
const part = (v: Viewer, id: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> =>
  v.assembly.children.find((o) => o.userData.siteId === id) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
const tags = (labels: FakeElement): FakeElement[] => labels.children.filter((c) => c.className === 'xch__tag');

describe('highlight ring with the section on (L3 with B2)', () => {
  it('BUG: looking into the cut through the selected implant, its ring has nothing to outline (stencil mask and copies draw front faces only)', () => {
    const labels = fakeElement();
    const v = scene(false, labels);
    v.setSelected('a');
    // P in the front view, then the slider to 0.5 mm past A's middle (A stands at y −10, radius 2.4): the cut faces the
    // camera through A, exactly the way the section starts ("the cut starts facing you")
    v.setSection({ offset: -9.5, flipped: false, follow: false });
    render(v);
    const a = part(v, 'a');
    expect(tags(labels)[0]!.classList.contains('is-off'), 'its label is gone too: the cut removed its middle').toBe(true);
    // what the frame shows of A: the triangles the cut keeps, by the side they turn to the camera (projected area, px²)
    a.updateMatrixWorld(true);
    const pos = a.geometry.getAttribute('position'), idx = a.geometry.getIndex()!;
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], s = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let front = 0, back = 0;
    for (let t = 0; t < idx.count; t += 3) {
      for (let k = 0; k < 3; k++) { p[k]!.fromBufferAttribute(pos, idx.getX(t + k)).applyMatrix4(a.matrixWorld); s[k]!.copy(p[k]!).project(v.camera); }
      const centroid = p[0]!.clone().add(p[1]!).add(p[2]!).divideScalar(3);
      if (v.plane.distanceToPoint(centroid) < 0) continue; // removed by the cut
      const area = ((s[1]!.x - s[0]!.x) * (s[2]!.y - s[0]!.y) - (s[2]!.x - s[0]!.x) * (s[1]!.y - s[0]!.y)) * 0.5 * 400 * 300;
      if (area > 0) front += area; else back -= area; // counter-clockwise on screen = a front face (three's default)
    }
    expect(front + back, 'A is on screen (its kept half, seen from inside: the flat cut faces)').toBeGreaterThan(20);
    // the ring: a stencil mask of the part, then 16 shifted copies drawn where the mask left the stencil clear
    const ring = a.children.filter((c) => c.name !== 'cut') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
    const mask = ring.find((r) => r.material.stencilFunc === THREE.AlwaysStencilFunc)!.material;
    const copies = ring.filter((r) => r.material.stencilFunc === THREE.GreaterStencilFunc).map((r) => r.material);
    const covered = (m: THREE.Material): number => (m.side !== THREE.BackSide ? front : 0) + (m.side !== THREE.FrontSide ? back : 0);
    // Today mask and copies are FrontSide while everything A shows is its back side: no ring, no glow (the emissive is on
    // the front faces), no label. A selected implant or the guided target cannot be told from the others while cut.
    expect(covered(mask) / (front + back), 'share of A the stencil mask can mark').toBeGreaterThan(0.5);
    for (const m of copies) expect(covered(m) / (front + back), 'share of A a ring copy can outline').toBeGreaterThan(0.5);
    v.dispose();
  });
});

describe('cut faces on an open scan (B2)', () => {
  it('BUG: with the cut on, the back side of an open jaw scan is painted as a section even where the plane cuts nothing', () => {
    // An intraoral scan is an open surface: its back side shows from many directions (the top of an upper arch seen from
    // the front, its inside seen from below). Here: a 20 × 20 mm patch of scan facing +Z, seen from below (its back side).
    (THREE.WebGLRenderer as unknown as Fake).gpu = false;
    const v = new Viewer(fakeElement() as unknown as HTMLElement, fakeElement() as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    v.setJaw({ positions: Float32Array.from([-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0]), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) }, null);
    v.view('front', true);
    v.setSection({ offset: -15, flipped: false, follow: false }); // P, then the slider: the plane at y = −15, 5 mm off the patch
    v.view('bottom', true);
    const jawMesh = priv<THREE.Mesh<THREE.BufferGeometry, THREE.Material>>(v, 'jaw');
    const corners = [[-10, -10, 0], [10, 10, 0]].map((c) => v.plane.distanceToPoint(new THREE.Vector3(...c)));
    expect(Math.min(...corners), 'the whole patch is kept, at least 5 mm from the plane: nothing of it is cut').toBeGreaterThanOrEqual(5);
    // what rasterizes the patch's back side (the side this camera sees): the jaw's lit material, or its cut-face child
    const backDrawers = [jawMesh, ...jawMesh.children].map((o) => (o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material).filter((m) => m.side !== THREE.FrontSide);
    const cutMaterial = priv<THREE.Material>(v, 'cutMaterial');
    // Without the cut this side is lit gum (DoubleSide). With it, the jaw turns FrontSide and the 'cut' child draws every
    // back face flat in --xch-cut: an uncut surface reads as a section (in the sample, the top of the arch in the front
    // view turns into a solid blue band above the gum, far above the plane).
    expect(backDrawers.length > 0 && backDrawers.every((m) => m === cutMaterial), 'the uncut back side is drawn only as a flat section').toBe(false);
    v.dispose();
  });
});

describe('labels follow what is drawn', () => {
  it('BUG: the label of a replacement hidden with Ctrl + middle click (or the Display switch) stays on screen, frozen', () => {
    const labels = fakeElement();
    const v = scene(false, labels);
    render(v);
    const tag = tags(labels)[0]!;
    expect(tag.classList.contains('is-off')).toBe(false);
    const before = String(tag.style.transform);
    v.setDisplay({ parts: false }); // Stage.hide('part') -> setDisplay({ parts: false }); labels stay on
    v.view('occlusal', true); // the user turns the view afterwards
    render(v);
    expect(String(tag.style.transform), 'it never moves again (placeLabels skips invisible parts)').toBe(before);
    // Today the label of a part that is no longer drawn stays visible at a stale spot over the scene
    expect(tag.hidden || tag.classList.contains('is-off'), 'the label of a hidden part is hidden').toBe(true);
    v.dispose();
  });
});

describe('section position slider (B2)', () => {
  it('BUG: after a middle click set the rotation center, the ±r slider can no longer reach the far side of the case', () => {
    const v = scene(false);
    // a middle click (or Home) on the near face of the jaw, front view: the rotation center moves onto that surface
    v.setOrbitCenter(new THREE.Vector3(0, -25, 0));
    const r = v.setSection({ offset: 0, flipped: false, follow: false }); // P: the cut starts through the target
    const half = Math.ceil(r * 10) / 10; // Stage.syncSection: min −half, max +half, Shift + wheel clamped alike
    const axis = v.plane.normal.clone(); // view direction at the start; offsets go deeper along it
    const shown = new THREE.Box3().setFromObject(priv<THREE.Mesh>(v, 'jaw')).union(new THREE.Box3().setFromObject(v.assembly));
    let deepest = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? shown.max.x : shown.min.x, i & 2 ? shown.max.y : shown.min.y, i & 4 ? shown.max.z : shown.min.z);
      deepest = Math.max(deepest, c.sub(v.target).dot(axis));
    }
    // r is the radius of what is shown (≈ 40.6 mm here) but the plane starts on its near face, 50 mm in front of its far
    // face: the back 9 mm (here the posterior part of an arch) can never be sectioned, while −r … 0 cuts nothing at all
    expect(deepest, `far side ${deepest.toFixed(1)} mm deep, slider ends at ${half} mm`).toBeLessThanOrEqual(half);
    v.dispose();
  });
});

describe('GPU pick memory (B1)', () => {
  it('BUG: after "Remove" (setJaw(null)) the last pick still holds the removed jaw mesh and its arrays', () => {
    const v = scene(true);
    v.pickSurface(400, 300); // any click, or the idle warm-up pick that follows every jaw load
    const old = priv<THREE.Mesh>(v, 'jaw');
    v.setJaw(null, null); // step 3 "Remove": the store drops the jaw, the viewer disposes its GPU buffers
    const held = [...priv<Map<THREE.Object3D, number>>(v, 'pickCode').keys()];
    // Measured on the 3 M-triangle jaw (ANGLE D3D11, implants still drawn): JS heap 73.8 MB before Remove, 73.9 MB after
    // it, 5.2 MB only after the next pick; without any pick Remove frees it at once (74.0 -> 5.3 MB). There is no warm-up
    // pick without a jaw, so it stays until the next middle click or Home, while the next file is being parsed.
    expect(held.includes(old), 'pickCode references the removed jaw').toBe(false);
    v.dispose();
  });
});

describe('GPU pick sees what the frame draws (B1)', () => {
  it('BUG: without a cut the pick pass draws replacements double-sided, though the frame draws only their front faces', () => {
    const v = scene(true);
    v.pickObject(400, 300);
    const pass = (v.renderer as unknown as { passes: PickPass[] }).passes.at(-1)!;
    const a = part(v, 'a');
    const draw = pass.draws.find((d) => d.object === a)!;
    expect(a.material.side, 'the frame: front faces only (no cut faces without a cut)').toBe(THREE.FrontSide);
    expect(a.children.some((c) => c.name === 'cut')).toBe(false);
    // An open library part seen through its opening (or a camera inside a part): the frame shows the jaw behind, the pick
    // returns the part's invisible inner wall, so a middle click pivots there, Ctrl + middle click hides the replacements
    // instead of the jaw and a distance point lands on a surface nobody sees.
    expect(draw.side, 'the side the pick pass rasterizes for that part').toBe(THREE.FrontSide);
    v.dispose();
  });
});

describe('raycast fallback (no EXT_color_buffer_float)', () => {
  it('BUG: with the cut on, every click raycasts the jaw twice (the mesh and its cut-face child share its triangles)', () => {
    const v = scene(false); // no float targets: pickSurface and pickObject use three's linear raycast
    v.setSection({ offset: 0, flipped: false, follow: false });
    const jawGeometry = priv<THREE.Mesh>(v, 'jaw').geometry;
    let walks = 0;
    const raycast = vi.spyOn(THREE.Mesh.prototype, 'raycast').mockImplementation(function (this: THREE.Mesh) { if (this.geometry === jawGeometry) walks++; });
    v.pickSurface(400, 300);
    raycast.mockRestore();
    // The ponytail note prices the fallback at ≈ 0.25–0.4 s per click on 3 M triangles; with the cut it walks them twice
    // (≈ 0.5–0.8 s), and a dragged distance point runs one such pick per animation frame.
    expect(walks, 'linear walks over the jaw triangles per click').toBe(1);
    v.dispose();
  });
});

describe('scale bar (look graft from C)', () => {
  it('BUG: at a wide field of view the bar still shows one length for the whole case, off by a third at its near and far ends', () => {
    const labels = fakeElement();
    const v = scene(false, labels);
    v.setDisplay({ fovDeg: 60 }); // the Display popover allows 1–60°
    v.fit(undefined, true); // Stage: a field-of-view change refits at once
    render(v);
    const bar = labels.children.find((c) => c.className === 'xch__scale')!;
    // what the bar says: mm per px at the orbit target's depth; what the case shows: mm per px at each visible depth
    v.camera.updateMatrixWorld(true);
    const shown = new THREE.Box3().setFromObject(priv<THREE.Mesh>(v, 'jaw')).union(new THREE.Box3().setFromObject(v.assembly));
    const depths: number[] = [];
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(i & 1 ? shown.max.x : shown.min.x, i & 2 ? shown.max.y : shown.min.y, i & 4 ? shown.max.z : shown.min.z);
      depths.push(-c.applyMatrix4(v.camera.matrixWorldInverse).z);
    }
    const off = Math.max(...depths.map((z) => Math.abs(z / v.dist - 1)));
    // Today 34 %: the "10 mm" bar spans what is ≈ 6.6 mm at the front of the case and ≈ 13.4 mm at its back. Exact enough
    // only at 1° (≈ 1 %); above a few degrees it should go, or say it holds at the rotation center only.
    expect(bar.hidden || off <= 0.05, `bar shown: ${!bar.hidden}, "${String(bar.textContent)}", worst scale error ${(off * 100).toFixed(0)} %`).toBe(true);
    v.dispose();
  });
});
