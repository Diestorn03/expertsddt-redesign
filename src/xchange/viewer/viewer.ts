/**
 * three.js scene of DDT Xchange (UI-DESIGN §6): render on demand, jaw fixed in world coordinates, the
 * implant set as one group whose matrix is the capture -> jaw transform. Buffers are built once per mesh;
 * implants sharing a geometry share its attributes and own only a color attribute. Colors come from the
 * site's CSS tokens and follow <html data-theme> live. Input lives in controls.ts.
 */
import gsap from 'gsap';
import * as THREE from 'three';
import { fromColumnMajor } from '../core/mat4';
import { computeBounds } from '../core/mesh';
import type { Arch, Mat4, TriMesh, Vec3 } from '../core/types';
import { buildLut, colorize } from './colormap';
import { presetView, type Preset } from './presets';

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

export interface PartHit {
  siteId: string;
  /** µm at the hit point when the map is on (barycentric). */
  um: number | null;
}

interface Implant {
  site: SiteVisual;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  geometryKey: string | null;
  top: THREE.Vector3; // label anchor in the implant frame
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

/** Translucent ⌀4 × 8 mm cylinder along +Z with an index tab on +X, before a geometry exists. */
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

  private jaw: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;
  private jawLinearColors: Float32Array | null = null;
  private readonly implants = new Map<string, Implant>();
  private readonly ghosts: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  private ghostUm: (Float32Array | null)[] = [];
  private readonly shared = new Map<string, THREE.BufferGeometry>();
  private readonly glyph = glyphGeometry();
  private readonly pins: { mesh: THREE.Mesh; el: HTMLElement; n: number }[] = [];
  private readonly pinGeometry = new THREE.SphereGeometry(1, 16, 12);
  private readonly pinMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  private readonly lut = buildLut().linear;
  private colors = { jaw: '#e3c8bc', part: '#046bd2', capture: '#94a3b8', active: '#f59e0b' };
  private selected: string | null = null;
  private guided: { current: string | null; dim: boolean } | null = null;
  private pulse = new Set<string>();
  private raf = 0;
  private visible = true;
  private disposed = false;
  private interactingUntil = 0;
  private lowRes = false;
  private restoreTimer = 0;
  private readonly ctx: gsap.Context;
  private readonly ro: ResizeObserver;
  private readonly io: IntersectionObserver;
  private readonly mo: MutationObserver;
  private readonly raycaster = new THREE.Raycaster();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 10);
  private poseTween: gsap.core.Tween | null = null;
  private camTween: gsap.core.Tween | null = null;
  private onLost: (e: Event) => void;

  constructor(readonly stage: HTMLElement, private readonly labels: HTMLElement, private readonly opts: ViewerOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'xch__canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    stage.prepend(this.canvas);
    this.onLost = (e: Event) => { e.preventDefault(); opts.onContextLost(); };
    this.canvas.addEventListener('webglcontextlost', this.onLost);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a99b3, 1.25));
    const head = new THREE.DirectionalLight(0xffffff, 2.1);
    head.position.set(0.25, 0.35, 1);
    head.target.position.set(0, 0, -1);
    this.camera.add(head, head.target);
    this.scene.add(this.camera);
    this.assembly.matrixAutoUpdate = false;
    this.scene.add(this.assembly);

    this.ctx = gsap.context(() => {});
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    this.io = new IntersectionObserver(([e]) => { this.visible = !!e?.isIntersecting; if (this.visible) this.invalidate(); });
    this.io.observe(stage);
    this.mo = new MutationObserver(() => this.refreshTheme());
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
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
      if (this.lowRes) { this.lowRes = false; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); this.resize(); }
    }, 260);
  }

  private render(): void {
    const t0 = performance.now();
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    const ms = performance.now() - t0;
    if (ms > 18 && t0 < this.interactingUntil && !this.lowRes) { this.lowRes = true; this.renderer.setPixelRatio(1); this.resize(false); }
  }

  private resize(render = true): void {
    const w = Math.max(1, this.stage.clientWidth), h = Math.max(1, this.stage.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (render) this.invalidate();
  }

  private updateCamera(): void {
    const cam = this.camera;
    cam.fov = this.display.fovDeg;
    cam.quaternion.copy(this.q);
    cam.position.set(0, 0, this.dist).applyQuaternion(this.q).add(this.target);
    const d = cam.position.distanceTo(this.sphere.center), r = Math.max(this.sphere.radius, 1);
    cam.near = Math.max(d - 1.5 * r, d / 1000);
    cam.far = d + 1.5 * r;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /* ---------------- theme ---------------- */

  refreshTheme(): void {
    const s = getComputedStyle(this.stage);
    const v = (name: string, fallback: string): string => s.getPropertyValue(name).trim() || fallback;
    this.colors = { jaw: v('--xch-jaw', '#e3c8bc'), part: v('--xch-part', '#046bd2'), capture: v('--xch-capture', '#94a3b8'), active: v('--xch-active', '#f59e0b') };
    this.pinMaterial.color.set(this.colors.active);
    this.restyle();
  }

  /** Re-applies materials from colors, display options, selection and guided state. */
  private restyle(): void {
    const d = this.display;
    if (this.jaw) {
      const m = this.jaw.material;
      const colored = d.jawColor && !!this.jawLinearColors;
      m.vertexColors = colored;
      m.color.set(colored ? '#ffffff' : this.colors.jaw);
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
      m.color.set(mapped ? '#ffffff' : this.colors.part);
      const active = imp.site.id === this.selected || imp.site.id === this.guided?.current || this.pulse.has(imp.site.id);
      m.emissive.set(active ? this.colors.active : '#000000');
      m.emissiveIntensity = active ? 0.35 : 0;
      let opacity = isGlyph ? 0.55 : d.partOpacity;
      if (this.guided?.dim && imp.site.id !== this.guided.current) opacity *= 0.4;
      m.opacity = opacity;
      m.transparent = opacity < 1;
      m.depthWrite = opacity >= 1;
      m.needsUpdate = true;
      imp.mesh.visible = d.parts;
      imp.label.hidden = !d.labels;
      imp.label.classList.toggle('is-active', active);
    }
    this.ghosts.forEach((g, i) => {
      const m = g.material;
      const mapped = d.map && !!this.ghostUm[i];
      m.vertexColors = mapped;
      m.color.set(mapped ? '#ffffff' : this.colors.capture);
      m.opacity = mapped ? 1 : 0.35;
      m.transparent = !mapped;
      m.depthWrite = mapped;
      m.needsUpdate = true;
      g.visible = d.capture;
    });
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
      const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
      this.jaw = new THREE.Mesh(g, m);
      this.jaw.matrixAutoUpdate = false;
      this.scene.add(this.jaw);
    }
    this.updateSphere();
    this.restyle();
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
      const g = new THREE.Mesh(bufferGeometry(c.mesh, c.normals), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, side: THREE.DoubleSide }));
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
      const mesh = new THREE.Mesh(this.glyph, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 }));
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(rowMajor(site.matrix));
      mesh.userData.siteId = site.id;
      this.assembly.add(mesh);
      const label = document.createElement('span');
      label.className = 'xch__tag';
      label.textContent = site.label;
      this.labels.append(label);
      this.implants.set(site.id, { site, mesh, geometryKey: null, top: new THREE.Vector3(0, 0, 8), label, um: null });
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
      const b = computeBounds(mesh);
      imp.top.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]);
    } else {
      imp.mesh.geometry = this.glyph;
      imp.geometryKey = null;
      imp.top.set(0, 0, 8);
    }
    this.pruneShared();
    if (animate && !this.opts.reducedMotion) {
      const s = { v: 0.85 };
      const base = rowMajor(imp.site.matrix);
      this.ctx.add(() => gsap.to(s, { v: 1, duration: 0.5, ease: 'back.out(1.4)', onUpdate: () => {
        imp.mesh.matrix.copy(base).multiply(tmpM.makeScale(s.v, s.v, s.v));
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
      if (!this.opts.reducedMotion) this.ctx.add(() => gsap.fromTo(el, { scale: 0 }, { scale: 1, duration: 0.45, ease: 'back.out(1.6)' }));
      this.pins.push({ mesh, el, n: i + 1 });
    });
    this.invalidate();
  }

  /** Implant set pose (capture -> world). `tween` = 'align' (.9 s expo.out) or 'step' (.35 s power3.out). */
  setAssembly(m: Mat4, tween: 'none' | 'align' | 'step' = 'none'): void {
    this.poseTween?.kill();
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
    this.ctx.add(() => {
      this.poseTween = gsap.to(o, {
        t: 1, duration: tween === 'align' ? 0.9 : 0.35, ease: tween === 'align' ? 'expo.out' : 'power3.out',
        onUpdate: () => {
          p.lerpVectors(p0, p1, o.t);
          q.slerpQuaternions(q0, q1, o.t);
          this.assembly.matrix.compose(p, q, one);
          this.assembly.matrixWorldNeedsUpdate = true;
          this.invalidate();
        },
        onComplete: () => { this.assembly.matrix.copy(to); this.assembly.matrixWorldNeedsUpdate = true; this.updateSphere(); this.invalidate(); },
      });
    });
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
    this.camTween?.kill();
    if (this.opts.reducedMotion || duration === 0) {
      this.target.copy(target);
      this.q.copy(q);
      this.dist = dist;
      this.invalidate();
      return;
    }
    const t0 = this.target.clone(), q0 = this.q.clone(), d0 = this.dist;
    const o = { t: 0 };
    this.ctx.add(() => {
      this.camTween = gsap.to(o, {
        t: 1, duration, ease: 'power3.inOut',
        onUpdate: () => {
          this.target.lerpVectors(t0, target, o.t);
          this.q.slerpQuaternions(q0, q, o.t);
          this.dist = d0 + (dist - d0) * o.t;
          this.invalidate();
        },
      });
    });
  }

  stopCameraTween(): void {
    this.camTween?.kill();
  }

  private fitDistance(radius: number): number {
    const half = THREE.MathUtils.degToRad(this.display.fovDeg) / 2;
    const aspect = Math.max(0.2, this.camera.aspect);
    return (Math.max(radius, 1) / Math.sin(half * Math.min(1, aspect))) * 1.15;
  }

  /** Frames everything visible (or only some sites), keeping the direction. */
  fit(siteIds?: readonly string[], instant = false): void {
    let sphere = this.sphere;
    if (siteIds?.length) {
      const box = new THREE.Box3();
      this.assembly.updateMatrixWorld(true);
      for (const id of siteIds) { const imp = this.implants.get(id); if (imp) box.expandByObject(imp.mesh); }
      if (!box.isEmpty()) sphere = box.getBoundingSphere(new THREE.Sphere());
      sphere.radius = Math.max(sphere.radius, 6);
    } else this.updateSphere();
    this.tweenCamera(sphere.center.clone(), this.q.clone(), this.fitDistance(sphere.radius), instant ? 0 : 0.7);
  }

  view(preset: Preset, instant = false): void {
    this.updateSphere();
    const { from, up } = presetView(preset, this.arch);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...from), new THREE.Vector3(), new THREE.Vector3(...up));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.tweenCamera(this.sphere.center.clone(), q, this.fitDistance(this.sphere.radius), instant ? 0 : 0.7);
  }

  /** Orbit center at a world point (.35 s). */
  setOrbitCenter(point: THREE.Vector3): void {
    const eye = new THREE.Vector3(0, 0, this.dist).applyQuaternion(this.q).add(this.target);
    this.tweenCamera(point.clone(), this.q.clone(), eye.distanceTo(point), 0.35);
  }

  /* ---------------- picking ---------------- */

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  /** Visible implant meshes only (they are small). */
  pickPart(x: number, y: number): PartHit | null {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const meshes = [...this.implants.values()].filter((i) => i.mesh.visible).map((i) => i.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const imp = this.implants.get(hit.object.userData.siteId as string);
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

  /** Jaw or any visible surface, world point. ponytail: plain three raycast (linear in triangles); fine per click, never on hover. */
  pickSurface(x: number, y: number, jawOnly = false): Vec3 | null {
    this.updateCamera();
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const targets: THREE.Object3D[] = [];
    if (this.jaw?.visible) targets.push(this.jaw);
    if (!jawOnly) for (const i of this.implants.values()) if (i.mesh.visible) targets.push(i.mesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }

  /* ---------------- labels ---------------- */

  private placeLabels(): void {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const v = new THREE.Vector3();
    const place = (el: HTMLElement, world: THREE.Vector3): void => {
      v.copy(world).project(this.camera);
      const off = v.z > 1 || v.z < -1;
      el.classList.toggle('is-off', off);
      if (!off) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -130%)`;
    };
    if (this.display.labels) for (const imp of this.implants.values()) {
      if (!imp.mesh.visible) continue;
      place(imp.label, imp.top.clone().applyMatrix4(imp.mesh.matrixWorld));
    }
    for (const p of this.pins) place(p.el, p.mesh.position);
  }

  /* ---------------- thumbnails ---------------- */

  /** 96×96 PNG of a geometry in a 3/4 view, --xch-part on transparent. */
  thumbnail(mesh: TriMesh, normals: Float32Array | null): string {
    const size = 96;
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a99b3, 1.3));
    const g = bufferGeometry(mesh, normals);
    const mat = new THREE.MeshStandardMaterial({ color: this.colors.part, roughness: 0.35, metalness: 0.15 });
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
    const light = new THREE.DirectionalLight(0xffffff, 2);
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
    cancelAnimationFrame(this.raf);
    clearTimeout(this.restoreTimer);
    this.ctx.revert();
    this.ro.disconnect();
    this.io.disconnect();
    this.mo.disconnect();
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
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.replaceChildren();
  }
}

export type { Preset };
