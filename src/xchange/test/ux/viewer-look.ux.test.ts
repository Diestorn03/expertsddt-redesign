/**
 * UX review, look A merged (VIEWER-POLISH §3, the judges' must-fix list): the 3D view stays live after a scroll, the
 * camera eases like the site, the default view frames the case tightly, labels never cover their part, the scale bar,
 * and the legend that follows the color map whatever turned it off. The real Viewer runs on three.js with only
 * WebGLRenderer replaced (no GPU in Node) and the fake DOM of ../adversarial/fake-dom.
 */
import type gsap from 'gsap';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Mat4, TriMesh } from '../../core/types';
import en from '../../ui/i18n/en';
import { EASE_OUT } from '../../ui/motion';
import { Stage } from '../../ui/stage';
import { DEFAULT_DISPLAY, LOOK, labelSpot, niceScale, Viewer } from '../../viewer/viewer';
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
const render = (v: Viewer): void => (v as unknown as { render(): void }).render();
const priv = <T>(v: object, key: string): T => (v as Record<string, T>)[key]!;
const viewer = (reducedMotion = true, labels = fakeElement()): Viewer => {
  const v = new Viewer(fakeElement() as unknown as HTMLElement, labels as unknown as HTMLElement, { reducedMotion, onContextLost() {} });
  v.setJaw(box(), null);
  return v;
};

describe('visibility', () => {
  it('follows the last entry of an IntersectionObserver batch (an enter and a leave can arrive together)', () => {
    let report: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    const g = globalThis as Record<string, unknown>;
    const inert = g.IntersectionObserver;
    g.IntersectionObserver = class { constructor(cb: typeof report) { report = cb; } observe(): void {} disconnect(): void {} };
    try {
      const v = viewer();
      report!([{ isIntersecting: true }, { isIntersecting: false }]);
      expect(priv<boolean>(v, 'visible')).toBe(false);
      report!([{ isIntersecting: false }, { isIntersecting: true }]);
      expect(priv<boolean>(v, 'visible'), 'scrolled back in: renders again').toBe(true);
      v.dispose();
    } finally {
      g.IntersectionObserver = inert;
    }
  });
});

describe('camera moves on the site easing (VIEWER-POLISH A3)', () => {
  const tweenOf = (v: Viewer): gsap.core.Tween | null => priv<gsap.core.Tween | null>(v, 'camTween');

  it('views and Fit: .7 s expo.out (= --ease-out); the rotation center .35 s; reduced motion jumps', () => {
    expect(EASE_OUT).toBe('expo.out');
    const v = viewer(false);
    v.view('front');
    expect(tweenOf(v)!.vars.ease).toBe(EASE_OUT);
    expect(tweenOf(v)!.duration()).toBeCloseTo(0.7);
    tweenOf(v)!.progress(1);
    v.fit();
    expect(tweenOf(v)!.vars.ease).toBe(EASE_OUT);
    tweenOf(v)!.progress(1);
    v.setOrbitCenter(new THREE.Vector3(5, 0, 0));
    expect(tweenOf(v)!.duration()).toBeCloseTo(0.35);
    v.dispose();
    const r = viewer(true);
    r.view('front');
    expect(tweenOf(r)).toBeNull();
    r.dispose();
  });

  it('the distance changes geometrically, so a large zoom change does not rush its near end', () => {
    const v = viewer(false);
    v.view('occlusal', true);
    const near = v.dist;
    v.dist = near * 100;
    v.fit();
    tweenOf(v)!.progress(0.5);
    const t = tweenOf(v)!.ratio; // the eased share at half time (GSAP rounds the tweened value to 1e-4)
    expect(v.dist / (near * 100 * (1 / 100) ** t)).toBeCloseTo(1, 3);
    expect(v.dist, 'a linear blend would still be 4× away').toBeLessThan(near * 1.5);
    v.dispose();
  });
});

describe('default view and Fit frame what is shown', () => {
  /** Stage px of the visible box corners after a view, and how much of the stage they span. */
  const spread = (v: Viewer): { x: number; y: number } => {
    (v as unknown as { updateCamera(): void }).updateCamera();
    const b = new THREE.Box3().setFromObject(v.scene.children.find((o) => (o as THREE.Mesh).isMesh)!);
    let x = 0, y = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(v.camera);
      x = Math.max(x, Math.abs(p.x));
      y = Math.max(y, Math.abs(p.y));
    }
    return { x, y };
  };

  it(`the case fills ${LOOK.frame * 100} % of the stage on its tighter side, never more, at any field of view`, () => {
    const v = viewer();
    for (const fovDeg of [1, 30, 60]) {
      v.setDisplay({ fovDeg });
      for (const preset of ['occlusal', 'front', 'left'] as const) {
        v.view(preset, true);
        const s = spread(v);
        expect(Math.max(s.x, s.y), `${preset} at ${fovDeg}°`).toBeCloseTo(LOOK.frame, 2);
      }
      v.fit(undefined, true);
      expect(Math.max(spread(v).x, spread(v).y)).toBeLessThanOrEqual(LOOK.frame + 1e-6);
    }
    v.dispose();
  });

  it('frames closer than the bounding sphere did (the arch filled about half the stage)', () => {
    const v = viewer();
    v.view('occlusal', true);
    const sphere = (v as unknown as { fitDistance(r: number): number }).fitDistance(priv<THREE.Sphere>(v, 'sphere').radius);
    expect(v.dist).toBeLessThan(sphere * 0.8);
    v.dispose();
  });

  it('hidden objects do not count: with the jaw off, the parts fill the view', () => {
    const v = viewer();
    v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, 6) }, { id: 'b', label: 'B', matrix: at(18, 12, 6) }]);
    v.view('occlusal', true);
    const all = v.dist;
    v.setDisplay({ jaw: false });
    v.view('occlusal', true);
    expect(v.dist).toBeLessThan(all);
    expect(v.target.distanceTo(new THREE.Vector3(-1, 1, 10)), 'centered on the parts').toBeLessThan(1);
    v.dispose();
  });
});

describe('implant labels sit clear of their part', () => {
  /** The label's rectangle for a w × h pill placed at a spot. */
  const rect = (s: ReturnType<typeof labelSpot>, w: number, h: number) => {
    const x0 = s.x + ((s.ox - 1) / 2) * w, y0 = s.y + ((s.oy - 1) / 2) * h;
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };
  const overlaps = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const part = { x0: 100, y0: 100, x1: 130, y1: 190 };

  it('past the free end when the axis shows on screen (front view: below a part that points down)', () => {
    const s = labelSpot(part, [0, 80], [0, 0]);
    expect(rect(s, 60, 22).y0).toBeGreaterThan(part.y1);
    expect(s.x).toBeCloseTo(115);
  });

  it('away from the middle of the set when the axis points at the viewer (occlusal view)', () => {
    const left = labelSpot(part, [0, 0], [-50, 0]);
    expect(rect(left, 60, 22).x1).toBeLessThan(part.x0);
    expect(labelSpot(part, [0, 0], [0, 0]).oy, 'one implant alone: above it').toBe(-1);
  });

  it('never covers the part, whatever the direction and the pill size', () => {
    for (let a = 0; a < 360; a += 7.5) {
      const d: [number, number] = [Math.cos((a * Math.PI) / 180) * 40, Math.sin((a * Math.PI) / 180) * 40];
      for (const [w, h] of [[40, 22], [90, 22], [24, 24]] as const) {
        expect(overlaps(rect(labelSpot(part, d, [0, 0]), w, h), part), `${a}° ${w}×${h}`).toBe(false);
        expect(overlaps(rect(labelSpot(part, [0, 0], d), w, h), part), `away ${a}° ${w}×${h}`).toBe(false);
      }
    }
  });

  it('the viewer puts them past the free end (front view) or outward from the set (occlusal view)', () => {
    const labels = fakeElement();
    const v = viewer(true, labels);
    v.arch = 'upper';
    // two placeholders (⌀4 × 8 mm along +Z from their origin) hanging from an upper arch
    v.setSites([{ id: 'a', label: 'A', matrix: at(-20, -10, -6) }, { id: 'b', label: 'B', matrix: at(18, 12, -6) }]);
    const tags = labels.children.filter((c) => c.className === 'xch__tag');
    const spot = (tag: FakeElement): { x: number; y: number; ox: number; oy: number } => {
      const m = /^translate\(([-\d.e]+)px, ([-\d.e]+)px\) translate\(([-\d.e]+)%, ([-\d.e]+)%\)$/.exec(String(tag.style.transform));
      expect(m, String(tag.style.transform)).not.toBeNull();
      return { x: +m![1]!, y: +m![2]!, ox: +m![3]! / 50 + 1, oy: +m![4]! / 50 + 1 };
    };
    const screen = (x: number, y: number, z: number): THREE.Vector3 => {
      const p = new THREE.Vector3(x, y, z).project(v.camera);
      return p.set(((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600, 0);
    };
    v.view('front', true); // +Z (the free ends) is screen up
    render(v);
    for (const [i, x, y] of [[0, -20, -10], [1, 18, 12]] as const) {
      const s = spot(tags[i]!);
      expect(s.oy, 'above the part').toBe(-1);
      expect(s.y).toBeLessThan(screen(x, y, 2).y); // the placeholder's top (z −6 + 8)
    }
    v.view('occlusal', true); // the axes point at the viewer: outward, each away from the other
    render(v);
    const [a, b] = [screen(-20, -10, 0), screen(18, 12, 0)];
    expect(Math.sign(spot(tags[0]!).x - a.x)).toBe(Math.sign(a.x - b.x));
    expect(Math.sign(spot(tags[1]!).x - b.x)).toBe(Math.sign(b.x - a.x));
    v.dispose();
  });
});

describe('scale bar', () => {
  it('picks the longest 1-2-5 length that fits', () => {
    expect(niceScale(0.05, 120)).toEqual({ mm: 5, px: 100 });
    expect(niceScale(0.4, 120)).toEqual({ mm: 20, px: 50 });
    const s = niceScale(0.0123, 120);
    expect(s.mm).toBe(1);
    expect(s.px).toBeCloseTo(81.3, 1);
    expect(niceScale(0.001, 120).mm).toBe(0.1);
    expect(niceScale(0, 120)).toEqual({ mm: 0, px: 0 });
    expect(niceScale(Number.NaN, 120)).toEqual({ mm: 0, px: 0 });
  });

  it('shows at the bottom of the view once there is something to measure, and follows the zoom', () => {
    const labels = fakeElement();
    const v = new Viewer(fakeElement() as unknown as HTMLElement, labels as unknown as HTMLElement, { reducedMotion: true, onContextLost() {} });
    const bar = labels.children.find((c) => c.className === 'xch__scale')!;
    render(v);
    expect(bar.hidden, 'empty stage').toBe(true);
    v.setJaw(box(), null);
    v.view('occlusal', true);
    render(v);
    expect(bar.hidden).toBe(false);
    expect(String(bar.textContent)).toMatch(/^\d+(\.\d+)?\smm$/);
    const far = String(bar.textContent);
    v.dist /= 20;
    render(v);
    expect(String(bar.textContent)).not.toBe(far);
    v.dispose();
  });
});

describe('the legend follows the color map, whatever turned it', () => {
  /** A Stage without its DOM constructor (the workspace-lifecycle pattern): the fields its methods read. */
  function stage(deviation: boolean): { st: Stage; legend: FakeElement } {
    const st = Object.create(Stage.prototype) as Stage;
    const el = fakeElement();
    const app = {
      s: { deviation: deviation ? new Map() : null, sites: [], captureMesh: null, jaw: null, surfaces: 'replacement' },
      c: en, lang: 'en', viewer: null, root: fakeElement(), shown: 4, alignStep: { guided: null },
    };
    Object.assign(st, { app, el, pop: fakeElement(), display: { ...DEFAULT_DISPLAY } });
    return { st, legend: el.querySelector('[data-legend]') };
  }

  it('the Display switch (setDisplay) hides it with the map, as C does', () => {
    const { st, legend } = stage(true);
    st.setDisplay({ map: true });
    expect(legend.hidden).toBe(false);
    st.setDisplay({ map: false }); // the popover switch
    expect(legend.hidden).toBe(true);
    st.toggleMap(); // C, or the map button
    expect(legend.hidden).toBe(false);
    st.toggleMap();
    expect(legend.hidden).toBe(true);
  });

  it('never shows without a measurement', () => {
    const { st, legend } = stage(false);
    st.setDisplay({ map: true });
    expect(legend.hidden).toBe(true);
  });
});
