/**
 * UX review of the finished viewer (review-ux, 2026-11-09): bugs of the real Viewer found in system Chrome, reproduced
 * with three.js itself and the WebGLRenderer stand-in of test/ux/viewer-tools.ux.test.ts (no GPU in Node). Each test is
 * named "BUG: ..." and fails until the bug is fixed.
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Mat4, TriMesh, Vec3 } from '../../core/types';
import { makeScanBodyCad } from '../../sample';
import { Viewer } from '../../viewer/viewer';
import { fakeElement, installFakeDom, type FakeElement } from '../adversarial/fake-dom';

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
    readonly extensions = { has: (): boolean => false };
    localClippingEnabled = false;
    toneMapping = 0;
    target: unknown = null;
    clear = new three.Color();
    alpha = 1;
    setClearColor(c: THREE.ColorRepresentation, a = 1): void { this.clear.set(c); this.alpha = a; }
    getClearColor(t: THREE.Color): THREE.Color { return t.copy(this.clear); }
    getClearAlpha(): number { return this.alpha; }
    getRenderTarget(): unknown { return this.target; }
    setRenderTarget(t: unknown): void { this.target = t; }
    render(): void {}
    readRenderTargetPixels(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
  }
  return { ...three, WebGLRenderer };
});

const { document: doc } = installFakeDom();
(doc as unknown as Record<string, unknown>).createElementNS = (_ns: string, tag: string): FakeElement => {
  const attrs: Record<string, string> = {};
  return fakeElement({ tag, attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null });
};

const render = (v: Viewer): void => (v as unknown as { render(): void }).render();
function box(sx = 60, sy = 50, sz = 12): TriMesh {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const mesh = { positions: Float32Array.from(geo.getAttribute('position').array), indices: Uint32Array.from(geo.getIndex()!.array) };
  geo.dispose();
  return mesh;
}
const at = (x: number, y: number, z: number): Mat4 => Float64Array.from([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]);

/** The scene of viewer-tools.ux.test.ts: jaw box, scan bodies a (y −10) and b (y 12), front view (camera at −Y), 800 × 600. */
function scene(labels: FakeElement = fakeElement()): Viewer {
  const v = new Viewer(fakeElement() as unknown as HTMLElement, labels as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
  v.arch = 'lower';
  v.setJaw(box(), null);
  v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
  const body = makeScanBodyCad();
  for (const id of ['a', 'b']) v.setGeometry(id, 'body', body, null);
  v.view('front', true);
  render(v);
  return v;
}
const screen = (v: Viewer, p: THREE.Vector3): [number, number] => {
  const s = p.clone().project(v.camera);
  return [((s.x + 1) / 2) * 800, ((1 - s.y) / 2) * 600];
};
/** The middle of an implant's part on screen. */
const partCenter = (v: Viewer, id: string): [number, number] => {
  const m = v.assembly.children.find((o) => o.userData.siteId === id) as THREE.Mesh;
  return screen(v, m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld));
};

describe('review-ux · the section plane and the part raycast', () => {
  it('BUG: a part the cut removed is still hovered (µm readout, grab cursor), dragged in step 4 and selected: pickPart ignores the section plane', () => {
    // System Chrome, sample case in step 4, P then the Position slider at +8 mm: the four scan bodies are gone (the stage
    // background shows where they stood), yet hovering there shows "AXO02 · 7 µm" with the grab cursor, and a plain
    // left drag from that empty spot moved the implant set ("Fit measured: No usable fit, RMS 4,438 µm") instead of
    // turning the view. B1 says a click never lands on a removed part; pickSurface/pickObject respect the cut, pickPart
    // (viewer.ts:935, hover, set drags and step-2 selection) does not.
    const v = scene();
    const [x, y] = partCenter(v, 'a');
    expect(v.pickPart(x, y)?.siteId, 'before the cut the part is under the pointer').toBe('a');
    v.setSection({ offset: 0, flipped: false, follow: false }); // front view: everything at y < 0 is removed; a stands at y −10 (all of it)
    render(v);
    expect(v.pickPart(x, y), 'nothing of part a is drawn there any more').toBeNull();
    v.dispose();
  });
});

describe('review-ux · the distance overlay', () => {
  it('BUG: at a short on-screen distance the value pill sits on the segment and hides both dots and the line', () => {
    // System Chrome, 1440 × 900, step 4 at Fit: two clicks 40 px apart on the palate gave dots at x 870–882 and 910–922
    // and the pill "4.12 mm" at x 862–930: both dots and the whole line were under the pill, so nothing showed where the
    // points are (and a dot has to be found blind to drag it). placeLabels (viewer.ts:1094) always centres the pill on the
    // midpoint. The pill is at least 56 × 18 px (".75rem" bold, ".2rem .55rem" padding, "0.00 mm"); the dots are 12 px.
    const labels = fakeElement();
    const v = scene(labels);
    const a: Vec3 = [-1.5, -25, 0], b: Vec3 = [1.5, -25, 0]; // 3 mm apart on the jaw's near face
    v.setMeasure([a, b], '3.00 mm', 1);
    render(v);
    const [sa, sb] = [screen(v, new THREE.Vector3(...a)), screen(v, new THREE.Vector3(...b))];
    expect(Math.hypot(sb[0] - sa[0], sb[1] - sa[1]), 'the setup: the dots are a short distance apart on screen').toBeLessThan(60);
    const pill = labels.children.find((c) => String(c.className).startsWith('xch__distval'))!;
    const t = String(pill.style.transform);
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) translate\(([-\d.e]+)%, ([-\d.e]+)%\)/.exec(t);
    expect(m, t).not.toBeNull();
    const W = 56, H = 18;
    const left = +m![1]! + (+m![3]! / 100) * W, top = +m![2]! + (+m![4]! / 100) * H;
    const pillBox = [left, top, left + W, top + H];
    const hit = (d: [number, number]): boolean => !(d[0] + 6 <= pillBox[0]! || d[0] - 6 >= pillBox[2]! || d[1] + 6 <= pillBox[1]! || d[1] - 6 >= pillBox[3]!);
    expect([hit(sa), hit(sb)], 'the pill must leave both dots visible').toEqual([false, false]);
    v.dispose();
  });
});
