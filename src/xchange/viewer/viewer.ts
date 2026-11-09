/**
 * three.js scene of DDT Xchange (UI-DESIGN §6): render on demand, jaw fixed in world coordinates, the
 * implant set as one group whose matrix is the capture -> jaw transform. Buffers are built once per mesh;
 * implants sharing a geometry share its attributes and own only a color attribute. Colors come from the
 * site's CSS tokens and follow <html data-theme> live. Input lives in controls.ts. Slice B (VIEWER-POLISH §5): GPU
 * picking (pick.ts), one section plane with flat cut faces (section.ts), the distance overlay.
 */
import gsap from 'gsap';
import * as THREE from 'three';
import { fromColumnMajor } from '../core/mat4';
import type { Arch, Mat4, TriMesh, Vec3 } from '../core/types';
import { buildLut, colorize } from './colormap';
import { decodePick, PICK_CAPTURE, PICK_FS, PICK_JAW, PICK_PART, PICK_VS, type Pick, type SceneObject } from './pick';
import { presetView, type Preset } from './presets';
import { sectionPlane } from './section';
import { EASE_OUT, forget, transient } from '../ui/motion';

export type { SceneObject };

export interface SiteVisual {
  id: string;
  label: string;
  matrix: Mat4;
}

export interface DisplayOptions {
  jaw: boolean;
  jawColor: boolean;
  parts: boolean;
  capture: boolean;
  labels: boolean;
  map: boolean;
  jawOpacity: number;
  partOpacity: number;
  fovDeg: number;
  speed: number;
}

export const DEFAULT_DISPLAY: DisplayOptions = { jaw: true, jawColor: true, parts: true, capture: false, labels: true, map: false, jawOpacity: 1, partOpacity: 1, fovDeg: 1, speed: 3 };

/** How much nearer the camera replacements and captured bodies are drawn than a coincident scan surface (mm). */
export const DEPTH_BIAS_MM = 0.02;

/**
 * The look (UI-DESIGN §6.1): Blinn-Phong surfaces under a front light that turns with the camera (exocad's default) and
 * a soft hemisphere fill whose sky is the screen's up, Neutral tone mapping so highlights roll off instead of clipping.
 * Specular is a linear grey; with the color map on it drops so the LUT colors stay what the legend says.
 */
export const LOOK = {
  head: 2.25,
  fill: 1.25,
  sky: 0xfff6ee,
  ground: 0xa29cc8,
  jaw: { specular: 0.035, shininess: 24 },
  part: { specular: 0.1, shininess: 42 },
  mapped: { specular: 0.02, shininess: 30 },
  capture: { specular: 0.08, shininess: 36 },
  /** Highlight ring around the selected implant or guided target, CSS px. */
  ringPx: 2.5,
  /** The ring's opacity where the scan hides the part (the buried side), so the outline never floats over the gum. */
  ringHidden: 0.4,
  /** Default view and Fit: the visible box fills this share of the stage, a margin left for the chrome in the corners. */
  frame: 0.8,
  /** The same on a touch screen, where the 44 px chrome takes more of a smaller stage. */
  frameTouch: 0.68,
} as const;

/** The plane while there is no cut: it keeps everything within a kilometre. Every clipped material always carries the one
 * plane, so turning the cut on or off never recompiles a shader (the first P froze for 70–100 ms on a 3 M-triangle jaw). */
const NO_CUT = 1e6;
/** Above this field of view one scale no longer holds across the case (34 % off at 60°): the scale bar goes. */
const SCALE_FOV_MAX = 5;
/** The distance pill sits on the line's midpoint while the dots are this far apart (stage px); closer, it goes beside the line. */
const PILL_ON_LINE_PX = 120;

type Shine = { readonly specular: number; readonly shininess: number };
const shine = (m: THREE.MeshPhongMaterial, s: Shine): void => { m.specular.setScalar(s.specular); m.shininess = s.shininess; };

// the ring: a highlighted part's full silhouette goes into the stencil, then the same part is drawn 8× shifted by
// LOOK.ringPx on screen wherever the stencil stays clear: first depth-tested (where the part shows), then over
// everything at LOOK.ringHidden (where the scan hides it; it still shows where a buried implant is). Each copy marks the
// pixels it draws, so every ring pixel is drawn once. Last in the frame, in the same render call: no pass, no target.
// The cut clips mask and copies alike, so the ring outlines what is left of a cut part; both sides are drawn, because
// looking into the cut all that shows of a part is its back side (the cut faces).
const RING_VS = `#include <clipping_planes_pars_vertex>
uniform vec2 ringRes;
uniform vec2 ringDir;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_Position.xy += ringDir * 2.0 / ringRes * gl_Position.w;
  #include <clipping_planes_vertex>
}`;
const RING_FS = `#include <clipping_planes_pars_fragment>
uniform vec3 ringColor;
uniform float ringAlpha;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(ringColor, ringAlpha);
  #include <colorspace_fragment>
}`;

/** Pick layers (B1): the jaw alone (guided points), or with replacements and captured bodies; nothing else is pickable. */
const LAYER_JAW = 1, LAYER_PARTS = 2;

/** Section state (B2): the plane through `origin + offset · axis` (axis: the view direction when it started). */
export interface Section {
  offset: number;
  flipped: boolean;
  follow: boolean;
}

/** The scale bar: the longest 1, 2 or 5 × 10^n mm that fits in `maxPx` pixels, and its length in pixels. */
export function niceScale(mmPerPx: number, maxPx: number): { mm: number; px: number } {
  const most = mmPerPx * maxPx;
  if (!(most > 0) || !Number.isFinite(most)) return { mm: 0, px: 0 };
  const p = 10 ** Math.floor(Math.log10(most));
  const mm = +([5, 2, 1].map((k) => k * p).find((v) => v <= most) ?? p).toPrecision(1);
  return { mm, px: mm / mmPerPx };
}

/**
 * Where an implant label goes (stage px): just outside the part's screen box, past its free end when the axis shows on
 * screen (`axis`: base → free end, px), otherwise away from the middle of the set (`away`). `ox`/`oy` (−1…1) name the
 * label edge that touches that point (CSS `translate((ox − 1) · 50 %, (oy − 1) · 50 %)`), so the pill never covers the
 * part and its fit colour.
 */
export function labelSpot(box: { x0: number; y0: number; x1: number; y1: number }, axis: readonly [number, number], away: readonly [number, number]): { x: number; y: number; ox: number; oy: number } {
  const al = Math.hypot(away[0], away[1]);
  let dx = axis[0] + (al > 1e-6 ? (away[0] / al) * 12 : 0), dy = axis[1] + (al > 1e-6 ? (away[1] / al) * 12 : 0);
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
  // along the dominant axis the label starts 6 px past the box edge (that axis alone keeps them apart); across it, it
  // straddles the direction line
  const hw = (box.x1 - box.x0) / 2, hh = (box.y1 - box.y0) / 2, m = Math.max(Math.abs(dx), Math.abs(dy));
  const reach = ((Math.abs(dx) >= Math.abs(dy) ? hw : hh) + 6) / m;
  return { x: box.x0 + hw + dx * reach, y: box.y0 + hh + dy * reach, ox: dx / m, oy: dy / m };
}

/** Pixel-ratio ceiling: 2 with a mouse, 1.5 on touch screens (tablets get the lighter path). */
const dprCap = (): number => Math.min(window.devicePixelRatio || 1, window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2);

export interface PartHit {
  siteId: string;
  /** µm at the hit point when the map is on (barycentric). */
  um: number | null;
}

interface Implant {
  site: SiteVisual;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
  /** Children of `mesh` sharing its geometry: the stencil mask, then 8 ring copies where the part shows and 8 where it is hidden. */
  ring: THREE.Mesh[];
  geometryKey: string | null;
  label: HTMLElement;
  um: Float32Array | null;
}

const tmpM = new THREE.Matrix4();
const rowMajor = (m: Mat4): THREE.Matrix4 => new THREE.Matrix4().set(...(Array.from(m) as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]));
export const toEngine = (m: THREE.Matrix4): Mat4 => fromColumnMajor(m.elements);
export const toThree = rowMajor;

function bufferGeometry(mesh: TriMesh, normals: Float32Array | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** ⌀4 × 8 mm cylinder along +Z with an index tab on +X: an implant position before a geometry exists. */
function glyphGeometry(): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(2, 2, 8, 28, 1).rotateX(Math.PI / 2).translate(0, 0, 4);
  const tab = new THREE.BoxGeometry(0.8, 1.6, 3).translate(2.2, 0, 6.5);
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (const g of [cyl.toNonIndexed(), tab.toNonIndexed()]) {
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    for (let i = 0; i < g.getAttribute('position').count; i++) idx.push(base + i);
    g.dispose();
  }
  cyl.dispose();
  tab.dispose();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setIndex(idx);
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

function linearSrgbFromBytes(colors: Uint8Array): Float32Array {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  const out = new Float32Array(colors.length);
  for (let i = 0; i < colors.length; i++) out[i] = lut[colors[i]!]!;
  return out;
}

export interface ViewerOptions {
  reducedMotion: boolean;
  /** Called after WebGL context loss. */
  onContextLost: () => void;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(1, 1, 0.1, 1000);
  readonly assembly = new THREE.Group();
  readonly canvas: HTMLCanvasElement;
  display: DisplayOptions = { ...DEFAULT_DISPLAY };
  arch: Arch | null = null;

  // camera state: position = target + q·(0,0,dist)
  readonly target = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  dist = 100;

  private jaw: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial> | null = null;
  private jawLinearColors: Float32Array | null = null;
  private readonly implants = new Map<string, Implant>();
  private readonly ghosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>[] = [];
  private ghostUm: (Float32Array | null)[] = [];
  private readonly shared = new Map<string, THREE.BufferGeometry>();
  private readonly glyph = glyphGeometry();
  private readonly pins: { mesh: THREE.Mesh; el: HTMLElement; n: number }[] = [];
  private readonly pinGeometry = new THREE.SphereGeometry(1, 16, 12);
  private readonly pinMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  private readonly lut = buildLut().linear;
  private colors = { jaw: '#d9d1c4', part: '#d8ad77', capture: '#b8b5b0', active: '#f59e0b' };
  private readonly fill = new THREE.HemisphereLight(LOOK.sky, LOOK.ground, LOOK.fill);
  /** B2: the cut's plane, carried by every material it clips; it clips nothing while there is no cut (`cut` null). */
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), NO_CUT);
  private readonly ringRes = { value: new THREE.Vector2(800, 600) };
  private readonly ringColor = { value: new THREE.Color() };
  private readonly ringMask = new THREE.MeshBasicMaterial({
    colorWrite: false, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide, clippingPlanes: [this.plane],
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  // shown side first (depth-tested), then the hidden side; stencil 0 → 1: a pixel the ring already drew is never drawn again
  private readonly ringCopies = [true, false].flatMap((shown) => Array.from({ length: 8 }, (_, i) => new THREE.ShaderMaterial({
    uniforms: {
      ringRes: this.ringRes, ringColor: this.ringColor, ringAlpha: { value: shown ? 1 : LOOK.ringHidden },
      ringDir: { value: new THREE.Vector2(Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)).multiplyScalar(LOOK.ringPx) },
    },
    vertexShader: RING_VS, fragmentShader: RING_FS, clipping: true, clippingPlanes: [this.plane], side: THREE.DoubleSide,
    depthTest: shown, depthWrite: false, transparent: true,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.GreaterStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  })));
  /** Scale bar, bottom centre (labels layer): exact at the orbit target's depth, which the 1° view makes the whole scene;
   * above SCALE_FOV_MAX it is hidden. */
  private readonly scale: HTMLElement;
  private scaleText = '';
  private selected: string | null = null;
  private guided: { current: string | null; dim: boolean } | null = null;
  private pulse = new Set<string>();
  private raf = 0;
  private visible = true;
  private disposed = false;
  private readonly life = new AbortController();
  /** Aborted by dispose(): listeners bound to this viewer (controls) go with it. */
  readonly signal = this.life.signal;
  private interactingUntil = 0;
  private lowRes = false;
  private restoreTimer = 0;
  private readonly ctx: gsap.Context;
  private readonly ro: ResizeObserver;
  private readonly io: IntersectionObserver;
  private readonly mo: MutationObserver;
  /** Watches the adjust pad and the legend show and hide (the chrome labels step aside from). */
  private readonly co: MutationObserver;
  /** The chrome over the canvas (icon bar, views dial, adjust pad, legend), stage px; read outside the frame loop. */
  private chrome: { x0: number; y0: number; x1: number; y1: number }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 10);
  private poseTween: gsap.core.Tween | null = null;
  private camTween: gsap.core.Tween | null = null;
  /** The orientation the running camera tween ends on (a rotation center set meanwhile keeps it). */
  private readonly camEnd = new THREE.Quaternion();
  private onLost: (e: Event) => void;
  /** B1: a 1×1 float target and one pick material; `gpu` null until the first pick asks for float targets. */
  private readonly pickTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
  private readonly pickMat = new THREE.ShaderMaterial({ vertexShader: PICK_VS, fragmentShader: PICK_FS, uniforms: { code: { value: 0 } }, side: THREE.DoubleSide, clipping: true, clippingPlanes: [this.plane] });
  private readonly pickBuf = new Float32Array(4);
  /** The object codes of the pick under way (empty between picks: it never keeps a removed mesh alive). */
  private readonly pickCode = new Map<THREE.Object3D, number>();
  private readonly clearColor = new THREE.Color();
  private gpu: boolean | null = null;
  private unwarm: (() => void) | null = null;
  private cut: (Section & { origin: THREE.Vector3; axis: THREE.Vector3; r: number }) | null = null;
  private readonly cutMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, clippingPlanes: [this.plane] });
  /** B3: the distance overlay (made on first use), its points and its dots' last stage px. */
  private distEls: { root: SVGSVGElement; halo: SVGLineElement; line: SVGLineElement; dots: HTMLElement[]; pill: HTMLElement } | null = null;
  private measure: { points: Vec3[]; text: string } = { points: [], text: '' };
  private dotAt: [number, number][] = [];

  constructor(readonly stage: HTMLElement, private readonly labels: HTMLElement, private readonly opts: ViewerOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.localClippingEnabled = true; // the cut (B2); materials without planes pay nothing
    this.renderer.setPixelRatio(dprCap());
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'xch__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    stage.prepend(this.canvas);
    this.onLost = (e: Event) => { e.preventDefault(); opts.onContextLost(); };
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.scale = document.createElement('div');
    this.scale.className = 'xch__scale';
    this.scale.hidden = true;
    labels.append(this.scale);

    // the fill's sky follows the screen's up (updateCamera); the head light sits just above-left of the eye
    this.scene.add(this.fill);
    const head = new THREE.DirectionalLight(0xffffff, LOOK.head);
    head.position.set(-0.2, 0.3, 1);
    head.target.position.set(0, 0, -1);
    this.camera.add(head, head.target);
    this.scene.add(this.camera);
    this.assembly.matrixAutoUpdate = false;
    this.scene.add(this.assembly);

    this.ctx = gsap.context(() => {});
    this.ro = new ResizeObserver(() => { this.measureChrome(); this.resize(); });
    this.ro.observe(stage);
    // only a real show or hide (the stage rewrites `hidden` with the same value on every update)
    this.co = new MutationObserver((list) => {
      if (list.some((m) => (m.oldValue !== null) !== (m.target as HTMLElement).hidden)) { this.measureChrome(); this.invalidate(); }
    });
    for (const el of stage.querySelectorAll('.xch__pad, .xch__legend')) this.co.observe(el, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
    // the last entry is the current state (one callback can carry an enter and a leave)
    this.io = new IntersectionObserver((entries) => { this.visible = !!entries[entries.length - 1]?.isIntersecting; if (this.visible) this.invalidate(); });
    this.io.observe(stage);
    this.mo = new MutationObserver(() => this.refreshTheme());
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // per pick draw: the mesh's object code, its depth bias (a replacement over the scan wins as it is drawn) and the
    // sides the frame draws of it (a replacement shows its back side only as cut faces). The side only switches culling:
    // the pick shader never reads it, and three re-resolves the program only when the material changes
    this.pickMat.onBeforeRender = (_r, _s, _c, _g, object) => {
      const src = (object as THREE.Mesh).material as THREE.Material, m = this.pickMat;
      m.uniforms.code!.value = this.pickCode.get(object) ?? 0;
      m.polygonOffset = src.polygonOffset;
      m.polygonOffsetFactor = src.polygonOffsetFactor;
      m.polygonOffsetUnits = src.polygonOffsetUnits;
      m.side = this.cut ? THREE.DoubleSide : src.side;
      m.uniformsNeedUpdate = true;
    };
    // a replacement's cut faces keep its depth bias: where it coincides with the scanned scan body, its section wins
    this.cutMaterial.onBeforeRender = (_r, _s, _c, _g, object) => {
      const src = (object.parent as THREE.Mesh).material as THREE.Material, m = this.cutMaterial;
      m.polygonOffset = src.polygonOffset;
      m.polygonOffsetFactor = src.polygonOffsetFactor;
      m.polygonOffsetUnits = src.polygonOffsetUnits;
    };
    this.refreshTheme();
    this.resize();
  }

  /* ---------------- render on demand ---------------- */

  invalidate(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.visible || document.hidden) return; // re-requested by the observers
      this.render();
    });
  }

  /** Controls call this on every input: lowers the pixel ratio if frames get slow, restores it after 250 ms. */
  interacting(): void {
    this.interactingUntil = performance.now() + 250;
    clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => {
      if (this.lowRes) { this.lowRes = false; this.renderer.setPixelRatio(dprCap()); this.resize(); }
    }, 260);
  }

  private render(): void {
    const t0 = performance.now();
    this.updateCamera();
    this.biasDepth();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.placeScale();
    const ms = performance.now() - t0;
    if (ms > 18 && t0 < this.interactingUntil && !this.lowRes) { this.lowRes = true; this.renderer.setPixelRatio(1); this.resize(false); }
  }

  /** Writes the DOM only when the bar changes (an orbit at one zoom writes nothing). */
  private placeScale(): void {
    const any = (!!this.jaw || this.implants.size > 0 || this.ghosts.length > 0) && this.display.fovDeg <= SCALE_FOV_MAX;
    const { mm, px } = any ? niceScale(this.mmPerPixel(), 120) : { mm: 0, px: 0 };
    const key = `${px.toFixed(1)}|${mm}`;
    if (key === this.scaleText) return;
    this.scaleText = key;
    this.scale.hidden = !mm;
    this.scale.style.setProperty('--w', `${px.toFixed(1)}px`);
    this.scale.textContent = `${mm.toLocaleString(document.documentElement.lang || 'en')}\u00a0mm`;
  }

  /** Reads where the chrome sits (on resize, and when the pad or the legend shows or hides; never in a frame). */
  private measureChrome(): void {
    const s = this.stage.getBoundingClientRect();
    this.chrome = [...this.stage.querySelectorAll<HTMLElement>('.xch__toolbar, .xch__views, .xch__pad, .xch__legend')].filter((e) => !e.hidden).map((e) => {
      const r = e.getBoundingClientRect();
      return { x0: r.left - s.left, y0: r.top - s.top, x1: r.right - s.left, y1: r.bottom - s.top };
    }).filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  }

  /** Whether an implant label at `s` (labelSpot) would sit under the chrome; its size from its text, no layout read. */
  private underChrome(s: { x: number; y: number; ox: number; oy: number }, label: HTMLElement): boolean {
    if (!this.chrome.length) return false;
    const w = 7.5 * (label.textContent?.length ?? 0) + 20, h = 26; // .75rem bold digits, .55rem padding, a 1 px border
    const x0 = s.x + ((s.ox - 1) / 2) * w, y0 = s.y + ((s.oy - 1) / 2) * h;
    return this.chrome.some((r) => x0 < r.x1 && x0 + w > r.x0 && y0 < r.y1 && y0 + h > r.y0);
  }

  private resize(render = true): void {
    const w = Math.max(1, this.stage.clientWidth), h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.ringRes.value.set(w, h);
    if (render) this.invalidate();
  }

  private updateCamera(): void {
    const cam = this.camera;
    cam.fov = this.display.fovDeg;
    cam.quaternion.copy(this.q);
    cam.position.set(0, 0, this.dist).applyQuaternion(this.q).add(this.target);
    this.fill.position.set(0, 1, 0).applyQuaternion(this.q);
    const d = cam.position.distanceTo(this.sphere.center), r = Math.max(this.sphere.radius, 1);
    cam.near = Math.max(d - 1.5 * r, d / 1000);
    cam.far = d + 1.5 * r;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.placePlane();
  }

  /** The cut's plane for this frame: fixed in the scene, or (follow) perpendicular to the view at its depth from the target. */
  private placePlane(): void {
    const c = this.cut;
    if (!c) return;
    if (c.follow) { c.origin.copy(this.target); c.axis.set(0, 0, -1).applyQuaternion(this.q); }
    const { normal, constant } = sectionPlane(c.axis.toArray(), c.origin.toArray(), c.offset, c.flipped);
    this.plane.normal.set(...normal);
    this.plane.constant = constant;
  }

  /**
   * Replacements and captured bodies coincide with the scan bodies inside the jaw scan once aligned (different
   * tessellations: z-fighting stripes). Each is drawn DEPTH_BIAS_MM nearer the camera, converted per mesh to units of
   * the 24-bit depth buffer for this frame's near/far, so the bias stays the same in millimetres at every zoom.
   */
  private biasDepth(): void {
    const cam = this.camera, c = new THREE.Vector3();
    const bias = (mesh: THREE.Mesh, m: THREE.Material): void => {
      // at the mesh's center: distance d and view depth z. Window depth is far·(z − near) / ((far − near)·z), and b mm
      // along the view ray change z by b·z/d, so they span b·far·near / ((far − near)·z·d) of the depth range
      const s = mesh.geometry.boundingSphere;
      if (s) c.copy(s.center);
      else c.set(0, 0, 0);
      c.applyMatrix4(mesh.matrixWorld);
      const d = Math.max(cam.near, cam.position.distanceTo(c));
      const z = Math.max(cam.near, -c.applyMatrix4(cam.matrixWorldInverse).z);
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -Math.ceil(((DEPTH_BIAS_MM * cam.far * cam.near) / ((cam.far - cam.near) * z * d)) * 2 ** 24);
    };
    for (const imp of this.implants.values()) bias(imp.mesh, imp.mesh.material);
    for (const g of this.ghosts) bias(g, g.material);
  }

  /* ---------------- theme ---------------- */

  refreshTheme(): void {
    const s = getComputedStyle(this.stage);
    const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback;
    this.colors = { jaw: v('--xch-jaw', '#d9d1c4'), part: v('--xch-part', '#d8ad77'), capture: v('--xch-capture', '#b8b5b0'), active: v('--xch-active', '#f59e0b') };
    this.pinMaterial.color.set(this.colors.active);
    this.ringColor.value.set(this.colors.active);
    this.cutMaterial.color.set(v('--xch-cut', '#3d9ad4'));
    this.restyle();
  }

  /**
   * B2's cut faces: while the cut is on, every replacement (a closed solid; it shows its front side only) draws its back
   * side once more, flat and unlit in --xch-cut, so you look into a section rather than a lit inside. One material for
   * all: coincident cut faces cannot stripe. Not on a pick layer. The jaw scan and the captured bodies are open scanner
   * surfaces with nothing inside to section: the cut only removes from them, and both their sides stay lit, as without
   * it (painting their back side as a section made uncut surfaces far from the plane read as cut).
   */
  private syncCutFaces(): void {
    for (const { mesh: m } of this.implants.values()) {
      let f = m.getObjectByName('cut') as THREE.Mesh | undefined;
      if (!this.cut) { if (f) m.remove(f); continue; }
      if (!f) {
        f = new THREE.Mesh(m.geometry, this.cutMaterial);
        f.name = 'cut';
        f.matrixAutoUpdate = false;
        m.add(f);
        f.updateMatrixWorld(true); // picked before the next frame
      }
      f.geometry = m.geometry;
    }
  }

  /** Re-applies materials from colors, display options, selection and guided state. */
  private restyle(): void {
    const d = this.display;
    if (this.jaw) {
      const m = this.jaw.material;
      const colored = d.jawColor && !!this.jawLinearColors;
      m.vertexColors = colored;
      m.color.set(colored ? '#ffffff' : this.colors.jaw); // without scanner colors: stone
      m.opacity = d.jawOpacity;
      m.transparent = d.jawOpacity < 1;
      m.depthWrite = d.jawOpacity >= 1;
      m.needsUpdate = true;
      this.jaw.visible = d.jaw;
      this.jaw.renderOrder = d.jawOpacity < 1 ? 2 : 0;
    }
    for (const imp of this.implants.values()) {
      const m = imp.mesh.material;
      const isGlyph = imp.geometryKey === null;
      const mapped = d.map && !!imp.um && !isGlyph;
      m.vertexColors = mapped;
      // a position without geometry is a grey placeholder (a scanned scan body's grey); a library part is gold
      m.color.set(mapped ? '#ffffff' : isGlyph ? this.colors.capture : this.colors.part);
      shine(m, mapped ? LOOK.mapped : isGlyph ? LOOK.capture : LOOK.part);
      // highlighted: the ring (any color, any view, even behind the jaw); a warm glow only where it cannot be read as a µm color
      const active = imp.site.id === this.selected || imp.site.id === this.guided?.current || this.pulse.has(imp.site.id);
      m.emissive.set(active && !mapped ? this.colors.active : '#000000');
      m.emissiveIntensity = active && !mapped ? 0.18 : 0;
      for (const r of imp.ring) r.visible = active;
      let opacity = d.partOpacity;
      if (this.guided?.dim && imp.site.id !== this.guided.current) opacity *= 0.4;
      m.opacity = opacity;
      m.transparent = opacity < 1;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
      imp.mesh.visible = d.parts;
      imp.label.hidden = !d.labels || !d.parts; // a hidden replacement takes its label along
      imp.label.classList.toggle('is-active', active);
    }
    this.ghosts.forEach((g, i) => {
      const m = g.material;
      const mapped = d.map && !!this.ghostUm[i];
      m.vertexColors = mapped;
      m.color.set(mapped ? '#ffffff' : this.colors.capture);
      shine(m, mapped ? LOOK.mapped : LOOK.capture);
      m.opacity = mapped ? 1 : 0.45;
      m.transparent = !mapped;
      m.depthWrite = mapped;
      m.needsUpdate = true;
      g.visible = d.capture;
    });
    this.syncCutFaces();
    this.invalidate();
  }

  setDisplay(patch: Partial<DisplayOptions>): void {
    this.display = { ...this.display, ...patch };
    this.restyle();
  }

  /* ---------------- content ---------------- */

  setJaw(mesh: TriMesh | null, normals: Float32Array | null): void {
    if (this.jaw) {
      this.scene.remove(this.jaw);
      this.jaw.geometry.dispose();
      this.jaw.material.dispose();
      this.jaw = null;
      this.jawLinearColors = null;
    }
    if (mesh) {
      const g = bufferGeometry(mesh, normals);
      if (mesh.colors) {
        this.jawLinearColors = linearSrgbFromBytes(mesh.colors);
        g.setAttribute('color', new THREE.BufferAttribute(this.jawLinearColors, 3));
      }
      const m = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, clippingPlanes: [this.plane] });
      shine(m, LOOK.jaw);
      this.jaw = new THREE.Mesh(g, m);
      this.jaw.matrixAutoUpdate = false;
      this.scene.add(this.jaw);
    }
    this.updateSphere();
    this.restyle();
    if (mesh) this.warmPick();
  }

  get hasJawColors(): boolean {
    return !!this.jawLinearColors;
  }

  /** Captured shells in capture coordinates (they move with the implant set). */
  setCapture(components: readonly { mesh: TriMesh; normals: Float32Array | null }[]): void {
    for (const g of this.ghosts) { this.assembly.remove(g); g.geometry.dispose(); g.material.dispose(); }
    this.ghosts.length = 0;
    this.ghostUm = [];
    for (const c of components) {
      const g = new THREE.Mesh(bufferGeometry(c.mesh, c.normals), new THREE.MeshPhongMaterial({ side: THREE.DoubleSide, clippingPlanes: [this.plane] }));
      g.matrixAutoUpdate = false;
      g.renderOrder = 1;
      this.assembly.add(g);
      this.ghosts.push(g);
      this.ghostUm.push(null);
    }
    this.updateSphere();
    this.restyle();
  }

  /** Replaces the implant list (sites in capture coordinates). Geometries are kept per key. */
  setSites(sites: readonly SiteVisual[]): void {
    const keep = new Set(sites.map((s) => s.id));
    for (const [id, imp] of this.implants) if (!keep.has(id)) this.removeImplant(id, imp);
    for (const site of sites) {
      const imp = this.implants.get(site.id);
      if (imp) {
        imp.site = site;
        imp.label.textContent = site.label;
        imp.mesh.matrix.copy(rowMajor(site.matrix));
        imp.mesh.matrixWorldNeedsUpdate = true;
        continue;
      }
      const mesh = new THREE.Mesh(this.glyph, new THREE.MeshPhongMaterial({ clippingPlanes: [this.plane] }));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(rowMajor(site.matrix));
      mesh.userData.siteId = site.id;
      const ring = [this.ringMask, ...this.ringCopies].map((m) => {
        const r = new THREE.Mesh(this.glyph, m);
        r.matrixAutoUpdate = false;
        // after everything else: every mask, then every shown-side copy, then the hidden side
        r.renderOrder = m === this.ringMask ? 10 : m.depthTest ? 11 : 12;
        r.visible = false;
        return r;
      });
      mesh.add(...ring);
      this.assembly.add(mesh);
      const label = document.createElement('span');
      label.className = 'xch__tag';
      label.textContent = site.label;
      this.labels.append(label);
      this.implants.set(site.id, { site, mesh, ring, geometryKey: null, label, um: null });
    }
    this.updateSphere();
    this.restyle();
  }

  private removeImplant(id: string, imp: Implant): void {
    this.assembly.remove(imp.mesh);
    this.disposeImplantGeometry(imp);
    imp.mesh.material.dispose();
    imp.label.remove();
    this.implants.delete(id);
  }

  private disposeImplantGeometry(imp: Implant): void {
    // shared attributes belong to this.shared; only the per-implant wrapper (and its color attribute) goes
    if (imp.mesh.geometry !== this.glyph) imp.mesh.geometry.dispose();
  }

  /**
   * Gives a site its geometry (implant frame). `key` identifies the mesh: implants with the same key share
   * position/index/normal buffers. null = back to the glyph.
   */
  setGeometry(siteId: string, key: string | null, mesh: TriMesh | null, normals: Float32Array | null, animate = false): void {
    const imp = this.implants.get(siteId);
    if (!imp || imp.geometryKey === key) return;
    this.disposeImplantGeometry(imp);
    imp.um = null;
    if (key && mesh) {
      let base = this.shared.get(key);
      if (!base) this.shared.set(key, (base = bufferGeometry(mesh, normals)));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', base.getAttribute('position'));
      g.setAttribute('normal', base.getAttribute('normal'));
      g.setIndex(base.getIndex());
      g.boundingSphere = base.boundingSphere;
      g.boundingBox = base.boundingBox;
      imp.mesh.geometry = g;
      imp.geometryKey = key;
    } else {
      imp.mesh.geometry = this.glyph;
      imp.geometryKey = null;
    }
    for (const r of imp.ring) r.geometry = imp.mesh.geometry;
    this.pruneShared();
    if (animate && !this.opts.reducedMotion) {
      const s = { v: 0.85 };
      // the site's matrix of this moment (setSites may move it while the scale-in runs)
      transient(this.ctx, () => gsap.to(s, { v: 1, duration: 0.5, ease: 'back.out(1.4)', onUpdate: () => {
        imp.mesh.matrix.copy(rowMajor(imp.site.matrix)).multiply(tmpM.makeScale(s.v, s.v, s.v));
        imp.mesh.matrixWorldNeedsUpdate = true;
        this.invalidate();
      } }));
    }
    this.updateSphere();
    this.restyle();
  }

  private pruneShared(): void {
    const used = new Set([...this.implants.values()].map((i) => i.geometryKey));
    for (const [key, g] of this.shared) if (!used.has(key)) { g.dispose(); this.shared.delete(key); }
  }

  /** µm per vertex per site (replacement surfaces) or per component (capture surfaces); null clears. */
  setDeviation(perSite: Map<string, Float32Array> | null, surfaces: 'replacement' | 'capture', componentOf: (siteId: string) => number | undefined): void {
    for (const imp of this.implants.values()) { imp.um = null; imp.mesh.geometry.deleteAttribute('color'); }
    this.ghostUm = this.ghosts.map(() => null);
    for (const g of this.ghosts) g.geometry.deleteAttribute('color');
    if (perSite) {
      for (const [siteId, um] of perSite) {
        const target = surfaces === 'capture' ? this.ghosts[componentOf(siteId) ?? -1] : this.implants.get(siteId)?.mesh;
        if (!target || target.geometry === this.glyph || target.geometry.getAttribute('position').count !== um.length) continue;
        const colors = new Float32Array(um.length * 3);
        colorize(um, this.lut, colors);
        target.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        if (surfaces === 'capture') this.ghostUm[componentOf(siteId)!] = um;
        else this.implants.get(siteId)!.um = um;
      }
    }
    this.restyle();
  }

  setSelected(siteId: string | null): void {
    this.selected = siteId;
    this.restyle();
  }

  setGuided(state: { current: string | null; dim: boolean } | null): void {
    this.guided = state;
    for (const imp of this.implants.values()) imp.label.classList.toggle('is-target', imp.site.id === state?.current);
    this.restyle();
  }

  /** Briefly highlights sites (pulse once). */
  pulseSites(ids: readonly string[]): void {
    this.pulse = new Set(ids);
    this.restyle();
    window.setTimeout(() => { this.pulse.clear(); if (!this.disposed) this.restyle(); }, this.opts.reducedMotion ? 1200 : 900);
  }

  setPins(points: readonly Vec3[]): void {
    for (const p of this.pins) { this.scene.remove(p.mesh); p.el.remove(); }
    this.pins.length = 0;
    const r = Math.max(0.25, this.sphere.radius / 160);
    points.forEach((pt, i) => {
      const mesh = new THREE.Mesh(this.pinGeometry, this.pinMaterial);
      mesh.position.set(pt[0], pt[1], pt[2]);
      mesh.scale.setScalar(r);
      this.scene.add(mesh);
      const el = document.createElement('span');
      el.className = 'xch__pin';
      el.textContent = String(i + 1);
      this.labels.append(el);
      if (!this.opts.reducedMotion) transient(this.ctx, () => gsap.fromTo(el, { scale: 0 }, { scale: 1, duration: 0.45, ease: 'back.out(1.6)' }));
      this.pins.push({ mesh, el, n: i + 1 });
    });
    this.invalidate();
  }

  /** Implant set pose (capture -> world). `tween` = 'align' (.9 s expo.out) or 'step' (.35 s power3.out). */
  setAssembly(m: Mat4, tween: 'none' | 'align' | 'step' = 'none'): void {
    this.stopPose();
    const to = rowMajor(m);
    if (tween === 'none' || this.opts.reducedMotion) {
      this.assembly.matrix.copy(to);
      this.assembly.matrixWorldNeedsUpdate = true;
      this.updateSphere();
      this.invalidate();
      return;
    }
    const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s = new THREE.Vector3();
    const p1 = new THREE.Vector3(), q1 = new THREE.Quaternion();
    this.assembly.matrix.decompose(p0, q0, s);
    to.decompose(p1, q1, s);
    const one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), q = new THREE.Quaternion();
    const o = { t: 0 };
    this.poseTween = transient(this.ctx, () => gsap.to(o, {
        t: 1, duration: tween === 'align' ? 0.9 : 0.35, ease: tween === 'align' ? EASE_OUT : 'power3.out',
        onUpdate: () => {
          p.lerpVectors(p0, p1, o.t);
          q.slerpQuaternions(q0, q1, o.t);
          this.assembly.matrix.compose(p, q, one);
          this.assembly.matrixWorldNeedsUpdate = true;
          this.invalidate();
        },
        onComplete: () => { this.poseTween = null; this.assembly.matrix.copy(to); this.assembly.matrixWorldNeedsUpdate = true; this.updateSphere(); this.invalidate(); },
      }));
  }

  /** Ends a running pose animation at its target: a drag starts from the pose the store holds, not an in-between one. */
  finishPose(): void {
    this.poseTween?.progress(1);
  }

  /**
   * Stops a running pose animation where it is, writing nothing more. A set drag calls it with every pose it writes: a
   * pose animation started during the drag (Ctrl + Z with Ctrl held for it, an alignment result) must not land after the
   * release on a pose the store no longer holds. The hand wins; the release commits what the drag shows.
   */
  stopPose(): void {
    this.poseTween?.kill();
    forget(this.ctx, this.poseTween);
    this.poseTween = null;
  }

  /* ---------------- bounds, camera ---------------- */

  private updateSphere(): void {
    const box = new THREE.Box3();
    this.scene.updateMatrixWorld(true);
    if (this.jaw) box.expandByObject(this.jaw);
    for (const imp of this.implants.values()) box.expandByObject(imp.mesh);
    for (const g of this.ghosts) box.expandByObject(g);
    if (box.isEmpty()) box.set(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(10, 10, 10));
    box.getBoundingSphere(this.sphere);
  }

  /** Bounding box center of the implant set in world coordinates (manipulation pivot). */
  setCenter(): THREE.Vector3 {
    const box = new THREE.Box3();
    this.assembly.updateMatrixWorld(true);
    for (const imp of this.implants.values()) box.expandByObject(imp.mesh);
    return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  }

  jawCenter(): THREE.Vector3 | null {
    if (!this.jaw) return null;
    return new THREE.Box3().setFromObject(this.jaw).getCenter(new THREE.Vector3());
  }

  /** Camera axes in world: right, up, toward the viewer. */
  axes(): { right: THREE.Vector3; up: THREE.Vector3; view: THREE.Vector3 } {
    return {
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(this.q),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(this.q),
      view: new THREE.Vector3(0, 0, 1).applyQuaternion(this.q),
    };
  }

  /** World millimetres per screen pixel at the target depth. */
  mmPerPixel(): number {
    return (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.display.fovDeg) / 2)) / Math.max(1, this.stage.clientHeight);
  }

  private tweenCamera(target: THREE.Vector3, q: THREE.Quaternion, dist: number, duration = 0.7): void {
    this.stopCameraTween();
    this.camEnd.copy(q);
    if (this.opts.reducedMotion || duration === 0) {
      this.target.copy(target);
      this.q.copy(q);
      this.dist = dist;
      this.invalidate();
      return;
    }
    const t0 = this.target.clone(), q0 = this.q.clone(), d0 = this.dist;
    const o = { t: 0 };
    this.camTween = transient(this.ctx, () => gsap.to(o, {
      t: 1, duration, ease: EASE_OUT,
      onUpdate: () => {
        this.target.lerpVectors(t0, target, o.t);
        this.q.slerpQuaternions(q0, q, o.t);
        this.dist = d0 * (dist / d0) ** o.t; // geometric: a large zoom change does not rush its near end
        this.invalidate();
      },
      onComplete: () => { this.camTween = null; },
    }));
  }

  stopCameraTween(): void {
    this.camTween?.kill();
    forget(this.ctx, this.camTween);
    this.camTween = null;
  }

  private fitDistance(radius: number): number {
    const half = THREE.MathUtils.degToRad(this.display.fovDeg) / 2;
    const aspect = Math.max(0.2, this.camera.aspect);
    return (Math.max(radius, 1) / Math.sin(half * Math.min(1, aspect))) * 1.15;
  }

  /**
   * Target and distance that frame what is shown, seen with orientation `q`: every corner of the visible box inside
   * LOOK.frame of the stage (exocad fills its view; the margin keeps the chrome in the corners off the case). Tighter
   * than the bounding sphere, which left the arch at about half the stage.
   */
  private frame(q: THREE.Quaternion): { center: THREE.Vector3; dist: number } {
    const box = this.visibleBox();
    if (box.isEmpty()) return { center: this.sphere.center.clone(), dist: this.fitDistance(this.sphere.radius) };
    const center = box.getCenter(new THREE.Vector3()), inv = q.clone().invert(), c = new THREE.Vector3();
    const share = window.matchMedia?.('(pointer: coarse)').matches ? LOOK.frameTouch : LOOK.frame;
    const ty = Math.tan(THREE.MathUtils.degToRad(this.display.fovDeg) / 2) * share, tx = ty * Math.max(0.2, this.camera.aspect);
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      // the corner in camera axes (z toward the eye): at view depth dist − z it must project within ±tx, ±ty
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center).applyQuaternion(inv);
      dist = Math.max(dist, c.z + Math.max(Math.abs(c.x) / tx, Math.abs(c.y) / ty));
    }
    return { center, dist: Math.max(dist, this.fitDistance(1)) };
  }

  /** Bounding box of what is shown. */
  private visibleBox(): THREE.Box3 {
    this.updateSphere(); // also brings every matrixWorld up to date
    const box = new THREE.Box3();
    if (this.jaw?.visible) box.expandByObject(this.jaw);
    for (const imp of this.implants.values()) if (imp.mesh.visible) box.expandByObject(imp.mesh);
    for (const g of this.ghosts) if (g.visible) box.expandByObject(g);
    return box;
  }

  /**
   * The cut (B2); null removes it. It starts through the orbit target, perpendicular to the view, removing what lies
   * between it and the camera, and stays put in the scene (turn the view to see it from the side) unless `follow` keeps it
   * perpendicular to the view at its depth from the target. Returns the half-range of the position slider
   * (`sectionReach`). The plane is a uniform: no shader changes, so nothing compiles here.
   */
  setSection(s: Section | null): number {
    if (!s) {
      this.cut = null;
      this.plane.normal.set(0, 0, 1);
      this.plane.constant = NO_CUT;
    } else if (this.cut) Object.assign(this.cut, s);
    else {
      this.cut = { ...s, origin: this.target.clone(), axis: new THREE.Vector3(0, 0, -1).applyQuaternion(this.q), r: 0 };
      this.cut.r = this.sectionReach();
    }
    this.placePlane();
    this.restyle();
    return this.cut?.r ?? 0;
  }

  /**
   * How far the position slider must reach either way (mm) for the cut to sweep everything shown now: at least the radius
   * of what is shown, and as far as its farthest corner along the cut from where the cut started (a rotation center set
   * on a surface puts that start on the near face, the far side a whole case away). 0 without a cut.
   */
  sectionReach(): number {
    const c = this.cut;
    if (!c) return 0;
    const box = this.visibleBox();
    if (box.isEmpty()) return this.sphere.radius;
    let r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) r = Math.max(r, Math.abs(p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c.origin).dot(c.axis)));
    return r;
  }

  /** Frames everything visible (or only some sites), keeping the direction. */
  fit(siteIds?: readonly string[], instant = false): void {
    if (!siteIds?.length) {
      const { center, dist } = this.frame(this.q);
      this.tweenCamera(center, this.q.clone(), dist, instant ? 0 : 0.7);
      return;
    }
    let sphere = this.sphere;
    const box = new THREE.Box3();
    this.assembly.updateMatrixWorld(true);
    for (const id of siteIds) { const imp = this.implants.get(id); if (imp) box.expandByObject(imp.mesh); }
    if (!box.isEmpty()) sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius, 6);
    this.tweenCamera(sphere.center.clone(), this.q.clone(), this.fitDistance(sphere.radius), instant ? 0 : 0.7);
  }

  view(preset: Preset, instant = false): void {
    const { from, up } = presetView(preset, this.arch);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(), new THREE.Vector3(...up));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const { center, dist } = this.frame(q);
    this.tweenCamera(center, q, dist, instant ? 0 : 0.7);
  }

  /**
   * Orbit center at a world point (.35 s). A view still turning (Home or a middle click right after a view key) ends in
   * that view's orientation: the view asked for (pressed, maybe announced) is the view you get, centered on the point.
   */
  setOrbitCenter(point: THREE.Vector3): void {
    const eye = new THREE.Vector3(0, 0, this.dist).applyQuaternion(this.q).add(this.target);
    this.tweenCamera(point.clone(), (this.camTween ? this.camEnd : this.q).clone(), eye.distanceTo(point), 0.35);
  }

  /* ---------------- picking ---------------- */

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /** The implant drawn under (x, y): visible implant meshes (they are small) and their cut faces, never a removed half. */
  pickPart(x: number, y: number): PartHit | null {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const meshes = [...this.implants.values()].filter((i) => i.mesh.visible).flatMap((i) => [i.mesh, ...i.mesh.children.filter((c) => c.name === 'cut')]);
    const hit = this.raycaster.intersectObjects(meshes, false).find((h) => this.kept(h.point));
    if (!hit) return null;
    const imp = this.implants.get((hit.object.name === 'cut' ? hit.object.parent! : hit.object).userData.siteId as string);
    if (!imp) return null;
    let um: number | null = null;
    if (imp.um && hit.face && this.display.map) {
      const pos = imp.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const local = imp.mesh.worldToLocal(hit.point.clone());
      const a = new THREE.Vector3().fromBufferAttribute(pos, hit.face.a), b = new THREE.Vector3().fromBufferAttribute(pos, hit.face.b), c = new THREE.Vector3().fromBufferAttribute(pos, hit.face.c);
      const w = new THREE.Triangle(a, b, c).getBarycoord(local, new THREE.Vector3());
      if (w) um = w.x * imp.um[hit.face.a]! + w.y * imp.um[hit.face.b]! + w.z * imp.um[hit.face.c]!;
    }
    return { siteId: imp.site.id, um };
  }

  /** What the cut keeps (everything without a cut). */
  private kept(p: THREE.Vector3): boolean {
    return !this.cut || this.plane.distanceToPoint(p) >= 0;
  }

  /** The surface point drawn under (x, y) (`jawOnly`: on the jaw scan), world coordinates; never on a removed half. */
  pickSurface(x: number, y: number, jawOnly = false): Vec3 | null {
    return this.pickAt(x, y, jawOnly)?.point ?? null;
  }

  /** The object drawn under (x, y): the jaw scan, a replacement or a captured body (A9's modified middle clicks). */
  pickObject(x: number, y: number): SceneObject | null {
    return this.pickAt(x, y, false)?.object ?? null;
  }

  /**
   * Pickable: the jaw scan, replacements and captured bodies that are visible and at least 10 % opaque (`jawOnly`: the jaw
   * alone), as drawn: the cut removes, and a part within DEPTH_BIAS_MM behind the scan is on top.
   */
  private pickAt(x: number, y: number, jawOnly: boolean): Pick | null {
    return this.gpuPicks ? this.gpuPick(x, y, jawOnly) : this.raycastPick(x, y, jawOnly);
  }

  /** GPU picks need float render targets (EXT_color_buffer_float); without them the raycast stays. */
  private get gpuPicks(): boolean {
    return (this.gpu ??= !!this.renderer.extensions?.has?.('EXT_color_buffer_float'));
  }

  /**
   * B1: one render into the 1×1 float target framed on the CSS pixel (x, y), world position in rgb and the object code in
   * a (pick.ts), every mesh with its depth bias and the cut. Target, layers, view offset, override material and clear
   * color end as they were; no frame is scheduled.
   */
  private gpuPick(x: number, y: number, jawOnly: boolean): Pick | null {
    const r = this.canvas.getBoundingClientRect(), rnd = this.renderer, cam = this.camera, mat = this.pickMat;
    this.updateCamera();
    this.biasDepth();
    const sites: string[] = [];
    const pickable = (m: THREE.Mesh<THREE.BufferGeometry, THREE.Material>, code: number, layer: number): void => {
      m.layers.set(0);
      if (m.visible && m.material.opacity >= 0.1) { m.layers.enable(layer); this.pickCode.set(m, code); }
    };
    if (this.jaw) pickable(this.jaw, PICK_JAW, LAYER_JAW);
    for (const imp of this.implants.values()) pickable(imp.mesh, PICK_PART + sites.push(imp.site.id) - 1, LAYER_PARTS);
    for (const g of this.ghosts) pickable(g, PICK_CAPTURE, LAYER_PARTS);
    const mask = cam.layers.mask, target = rnd.getRenderTarget(), alpha = rnd.getClearAlpha(), override = this.scene.overrideMaterial;
    rnd.getClearColor(this.clearColor);
    cam.setViewOffset(r.width, r.height, x - r.left - 0.5, y - r.top - 0.5, 1, 1);
    cam.layers.mask = (1 << LAYER_JAW) | (jawOnly ? 0 : 1 << LAYER_PARTS);
    this.scene.overrideMaterial = mat;
    this.pickBuf.fill(0);
    try {
      rnd.setRenderTarget(this.pickTarget);
      rnd.setClearColor(0x000000, 0);
      rnd.render(this.scene, cam);
      rnd.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickBuf);
    } finally {
      rnd.setRenderTarget(target);
      rnd.setClearColor(this.clearColor, alpha);
      this.scene.overrideMaterial = override;
      cam.layers.mask = mask;
      cam.clearViewOffset();
      this.pickCode.clear();
      mat.side = THREE.DoubleSide;
    }
    return decodePick(this.pickBuf, sites);
  }

  /**
   * Without float render targets. ponytail: three's Raycaster is linear in triangles, ≈ 0.25–0.4 s per click on a
   * 3 M-triangle jaw; upgrade path: an RGBA8 target with the depth packed into it, unprojected back to a point.
   */
  private raycastPick(x: number, y: number, jawOnly: boolean): Pick | null {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    // a mesh, or its cut faces (the back side the cut shows), stands for its owner
    const kind = new Map<THREE.Object3D, [SceneObject, THREE.Object3D]>();
    const add = (m: THREE.Mesh<THREE.BufferGeometry, THREE.Material>, k: SceneObject): void => {
      if (!m.visible || m.material.opacity < 0.1) return;
      kind.set(m, [k, m]);
      const f = m.getObjectByName('cut');
      if (f) kind.set(f, [k, m]);
    };
    if (this.jaw) add(this.jaw, 'jaw');
    if (!jawOnly) {
      for (const i of this.implants.values()) add(i.mesh, 'part');
      for (const g of this.ghosts) add(g, 'capture');
    }
    const hits = this.raycaster.intersectObjects([...kind.keys()], false).filter((h) => this.kept(h.point));
    const top = hits.find((h) => kind.get(h.object)![0] !== 'jaw' && h.distance <= hits[0]!.distance + DEPTH_BIAS_MM) ?? hits[0];
    if (!top) return null;
    const [object, owner] = kind.get(top.object)!;
    return { point: [top.point.x, top.point.y, top.point.z], object, siteId: (owner.userData.siteId as string | undefined) ?? null };
  }

  /** B1: one pick at the stage center while the browser is idle, so compiling the pick shader never lands on a click. */
  private warmPick(): void {
    if (this.unwarm || !this.gpuPicks) return;
    const run = (): void => {
      this.unwarm = null;
      const r = this.canvas.getBoundingClientRect();
      if (!this.disposed && r.width > 0) this.gpuPick(r.left + r.width / 2, r.top + r.height / 2, false);
    };
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1000 });
      this.unwarm = () => cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(run, 200);
      this.unwarm = () => clearTimeout(id);
    }
  }

  /* ---------------- labels ---------------- */

  /** Transforms only, no layout reads (UI-DESIGN §3.5). Implant labels sit clear of their part (labelSpot). */
  private placeLabels(): void {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const v = new THREE.Vector3();
    /** Stage px of a world point; null behind the camera or past far. */
    const px = (world: THREE.Vector3): [number, number] | null => {
      v.copy(world).project(this.camera);
      return v.z > 1 || v.z < -1 ? null : [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    };
    for (const pin of this.pins) {
      const at = px(pin.mesh.position);
      pin.el.classList.toggle('is-off', !at);
      if (at) pin.el.style.transform = `translate(${at[0]}px, ${at[1]}px) translate(-50%, -130%)`;
    }
    const p = new THREE.Vector3();
    const d = this.distEls;
    if (d) {
      // the distance overlay (B3); all of it hides when a point leaves the stage
      const spots = this.measure.points.map((q) => { const s = px(p.set(...q)); return s && s[0] >= 0 && s[0] <= w && s[1] >= 0 && s[1] <= h ? s : null; });
      const on = spots.every((s) => !!s);
      this.dotAt = on ? (spots as [number, number][]) : [];
      d.dots.forEach((el, i) => {
        const s = on ? spots[i] : null;
        el.classList.toggle('is-off', !s);
        if (s) el.style.transform = `translate(${s[0]}px, ${s[1]}px) translate(-50%, -50%)`;
      });
      const [a, b] = this.dotAt;
      d.root.classList.toggle('is-off', !b);
      d.pill.classList.toggle('is-off', !b);
      if (a && b) {
        for (const l of [d.halo, d.line]) { l.setAttribute('x1', String(a[0])); l.setAttribute('y1', String(a[1])); l.setAttribute('x2', String(b[0])); l.setAttribute('y2', String(b[1])); }
        // the pill on the midpoint; on a short line it would hide both dots, so it goes beside it (above it, right of an
        // upright one) with its near edge 9 px off the line (dot radius, halo, a gap), the edge chosen as labelSpot does
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        let x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2, ox = 0, oy = 0;
        if (len < PILL_ON_LINE_PX) {
          let nx = len ? dy / len : 0, ny = len ? -dx / len : -1;
          if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
          const m = Math.max(Math.abs(nx), Math.abs(ny));
          x += nx * 9;
          y += ny * 9;
          ox = nx / m;
          oy = ny / m;
        }
        d.pill.style.transform = `translate(${x}px, ${y}px) translate(${(ox - 1) * 50}%, ${(oy - 1) * 50}%)`;
      }
    }
    if (!this.display.labels) return;
    const parts: { imp: Implant; box: { x0: number; y0: number; x1: number; y1: number }; axis: [number, number] }[] = [];
    for (const imp of this.implants.values()) {
      if (!imp.mesh.visible) continue;
      const b = imp.mesh.geometry.boundingBox!, m = imp.mesh.matrixWorld;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
      // a part whose middle the cut removed loses its label
      let off = !!this.cut && this.plane.distanceToPoint(p.set(cx, cy, (b.min.z + b.max.z) / 2).applyMatrix4(m)) < 0;
      for (let i = 0; i < 8 && !off; i++) {
        const at = px(p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m));
        if (!at) { off = true; break; }
        box.x0 = Math.min(box.x0, at[0]); box.x1 = Math.max(box.x1, at[0]); box.y0 = Math.min(box.y0, at[1]); box.y1 = Math.max(box.y1, at[1]);
      }
      // the part's axis on screen, base → free end (+Z of the implant frame)
      const base = off ? null : px(p.set(cx, cy, b.min.z).applyMatrix4(m)), end = base && px(p.set(cx, cy, b.max.z).applyMatrix4(m));
      imp.label.classList.toggle('is-off', !end);
      if (base && end) parts.push({ imp, box, axis: [end[0] - base[0], end[1] - base[1]] });
    }
    const mx = parts.reduce((s, q) => s + q.box.x0 + q.box.x1, 0) / (2 * parts.length || 1);
    const my = parts.reduce((s, q) => s + q.box.y0 + q.box.y1, 0) / (2 * parts.length || 1);
    for (const { imp, box, axis } of parts) {
      const away: [number, number] = [(box.x0 + box.x1) / 2 - mx, (box.y0 + box.y1) / 2 - my];
      let s = labelSpot(box, axis, away);
      // a label that would sit under the chrome (the views dial on a tablet) goes to the other side of its part
      if (this.underChrome(s, imp.label)) {
        const t = labelSpot(box, [-axis[0], -axis[1]], [-away[0], -away[1]]);
        if (!this.underChrome(t, imp.label)) s = t;
      }
      imp.label.style.transform = `translate(${s.x}px, ${s.y}px) translate(${(s.ox - 1) * 50}%, ${(s.oy - 1) * 50}%)`;
    }
  }

  /* ---------------- distance (B3) ---------------- */

  /**
   * The distance overlay: up to two world points, the value pill's text, and the index of a point just placed (it scales
   * in like a guided pin; reduced motion: it is just there). Drawn in the labels layer by placeLabels.
   */
  setMeasure(points: readonly Vec3[], text: string, placed = -1): void {
    const d = (this.distEls ??= this.distOverlay());
    this.measure = { points: points.map((q) => [...q] as Vec3), text };
    d.pill.textContent = text;
    // from an inline 0 (a fromTo would leave its startAt tween in the context)
    const pop = (el: HTMLElement): void => {
      el.style.setProperty('--pop', '0');
      transient(this.ctx, () => gsap.to(el, { '--pop': 1, duration: 0.45, ease: 'back.out(1.6)' }));
    };
    if (placed >= 0 && !this.opts.reducedMotion) {
      pop(d.dots[placed]!);
      if (placed === 1) pop(d.pill);
    }
    this.invalidate();
  }

  /** Which distance point is drawn within `radius` px of (x, y) (client px); -1 for none. */
  measureDotAt(x: number, y: number, radius: number): number {
    const r = this.canvas.getBoundingClientRect();
    return this.dotAt.findIndex(([sx, sy]) => Math.hypot(sx + r.left - x, sy + r.top - y) <= radius);
  }

  /** Two dots and a line in --xch-active with the crosshair's dark halo, and the value pill (aria-hidden: the live region speaks). */
  private distOverlay(): NonNullable<Viewer['distEls']> {
    const ns = 'http://www.w3.org/2000/svg';
    const root = document.createElementNS(ns, 'svg'), halo = document.createElementNS(ns, 'line'), line = document.createElementNS(ns, 'line');
    root.setAttribute('class', 'xch__dist is-off');
    halo.setAttribute('class', 'xch__disthalo');
    line.setAttribute('class', 'xch__distline');
    root.append(halo, line);
    const span = (cls: string): HTMLElement => { const e = document.createElement('span'); e.className = `${cls} is-off`; return e; };
    const dots = [span('xch__distdot'), span('xch__distdot')], pill = span('xch__distval');
    this.labels.append(root, ...dots, pill);
    return { root, halo, line, dots, pill };
  }

  /* ---------------- thumbnails ---------------- */

  /** 96×96 PNG of a geometry in a 3/4 view, --xch-part on transparent, lit like the stage. */
  thumbnail(mesh: TriMesh, normals: Float32Array | null): string {
    const size = 96;
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(LOOK.sky, LOOK.ground, LOOK.fill));
    const g = bufferGeometry(mesh, normals);
    const mat = new THREE.MeshPhongMaterial({ color: this.colors.part });
    shine(mat, LOOK.part);
    scene.add(new THREE.Mesh(g, mat));
    const sph = g.boundingSphere!;
    const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 1000);
    const dir = new THREE.Vector3(1, -1.2, 0.9).normalize();
    const d = sph.radius / Math.sin(THREE.MathUtils.degToRad(10)) * 1.08;
    cam.position.copy(sph.center).addScaledVector(dir, d);
    cam.up.set(0, 0, 1);
    cam.lookAt(sph.center);
    cam.near = d - sph.radius * 1.5;
    cam.far = d + sph.radius * 1.5;
    cam.updateProjectionMatrix();
    const light = new THREE.DirectionalLight(0xffffff, LOOK.head);
    light.position.copy(cam.position);
    scene.add(light);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    this.renderer.setRenderTarget(prev);
    g.dispose();
    mat.dispose();
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx2 = c.getContext('2d');
    if (!ctx2) return '';
    const img = ctx2.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    ctx2.putImageData(img, 0, 0);
    this.invalidate();
    return c.toDataURL('image/png');
  }

  /* ---------------- dispose ---------------- */

  dispose(): void {
    this.disposed = true;
    this.life.abort();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.restoreTimer);
    this.unwarm?.();
    this.ctx.revert();
    this.ro.disconnect();
    this.io.disconnect();
    this.mo.disconnect();
    this.co.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.setJaw(null, null);
    this.setCapture([]);
    for (const [id, imp] of [...this.implants]) this.removeImplant(id, imp);
    this.setPins([]);
    for (const g of this.shared.values()) g.dispose();
    this.shared.clear();
    this.glyph.dispose();
    this.pinGeometry.dispose();
    this.pinMaterial.dispose();
    this.ringMask.dispose();
    for (const m of this.ringCopies) m.dispose();
    this.pickTarget.dispose();
    this.pickMat.dispose();
    this.cutMaterial.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.replaceChildren();
  }
}

export type { Preset };
