/**
 * The workspace: store, workers, library, viewer and the 4-step wizard (UI-DESIGN §4-§5). Step logic lives in
 * step-capture.ts, step-geometry.ts and step-align.ts; the stage chrome in stage.ts. Loaded lazily by main.ts,
 * so three.js never competes with the hero intro.
 */
import { isXchangeError, toErrorPayload } from '../core/errors';
import { inverseRigid } from '../core/mat4';
import { computeVertexNormals, transformMesh } from '../core/mesh';
import type { ImplantSite, ReplacementGeometry, TriMesh } from '../core/types';
import { AlignClient } from '../align/client';
import { activeSites, alignmentParts, freshCase, reachable, Store, type CaseState, type Step } from '../state/case';
import { JobsClient } from '../state/jobs';
import { UiError } from '../state/jobs-handler';
import { Library } from '../state/library';
import { attachControls } from '../viewer/controls';
import { Viewer } from '../viewer/viewer';
import { h, icon, q, qa } from './dom';
import { alertCard, Announcer, bringIntoView, confirmDialog, noteCard, Toasts } from './feedback';
import type { Copy } from './i18n/en';
import { errorMessage, fmt, plural, type Lang, type MessageContext, type Purpose } from './i18n/format';
import { Motion } from './motion';
import { CaptureStep } from './step-capture';
import { GeometryStep } from './step-geometry';
import { AlignStep } from './step-align';
import { Stage } from './stage';

export interface MeshData {
  mesh: TriMesh;
  normals: Float32Array;
}

export interface Busy {
  set(fraction: number | null, text?: string): void;
  done(): void;
}

export class App {
  readonly store = new Store<CaseState>(freshCase());
  readonly jobs = new JobsClient();
  readonly align = new AlignClient();
  readonly motion: Motion;
  readonly say: Announcer;
  readonly toasts: Toasts;
  readonly ac = new AbortController();
  readonly signal = this.ac.signal;
  readonly section: HTMLElement;
  library!: Library;
  viewer: Viewer | null = null;
  stage!: Stage;
  capture!: CaptureStep;
  geometry!: GeometryStep;
  alignStep!: AlignStep;

  /** Library meshes read this visit (with display normals), by geometry id. */
  readonly meshCache = new Map<string, MeshData>();
  selected: string | null = null;
  /** Focus target for the next list render (e.g. a row's Undo after Leave out). */
  focusKey: string | null = null;
  shown: Step = 1;
  private busyCount = 0;
  private timers = new Set<number>();

  constructor(readonly root: HTMLElement, readonly c: Copy, readonly lang: Lang, readonly reduced: boolean, readonly hook: string) {
    this.section = root.closest('section') ?? root;
    this.motion = new Motion(reduced, this.section);
    this.say = new Announcer(q(document, '#xch-status'));
    this.toasts = new Toasts(q(this.section, '.xch__toasts'), this.motion, c.say.close);
  }

  get s(): CaseState {
    return this.store.state;
  }

  async init(): Promise<void> {
    this.library = await Library.open();
    if (this.signal.aborted) { this.library.close(); return; }
    this.stage = new Stage(this);
    this.capture = new CaptureStep(this);
    this.geometry = new GeometryStep(this);
    this.alignStep = new AlignStep(this);
    this.createViewer();
    this.wireWizard();
    this.store.subscribe(() => this.render());
    this.root.removeAttribute('aria-busy');
    q(this.root, '[data-loading]').hidden = true;
    this.render();
  }

  /* ---------------- viewer ---------------- */

  createViewer(): void {
    const stageEl = q(this.root, '.xch__stage');
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) throw new Error('webgl2');
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      this.viewer = new Viewer(stageEl, q(stageEl, '.xch__labels'), { reducedMotion: this.reduced, onContextLost: () => this.stage.contextLost() });
    } catch {
      this.viewer = null;
      const m = this.c.ui.webglUnavailable;
      q(stageEl, '[data-empty]').replaceChildren(h('p', 'xch__emptytitle', { text: m.t }), h('p', '', { text: m.b }));
      qa<HTMLButtonElement>(this.root, '.xch__panel button').forEach((b) => b.setAttribute('aria-disabled', 'true'));
      return;
    }
    const v = this.viewer;
    v.setDisplay(this.stage.display);
    attachControls(v, stageEl, this.alignStep.controlCallbacks(), this.signal);
    this.rebuildViewer();
  }

  /** Rebuilds the scene from the case (after a context loss or a new case). */
  rebuildViewer(): void {
    const v = this.viewer;
    if (!v) return;
    const s = this.s;
    v.arch = s.arch;
    v.setJaw(s.jaw?.mesh ?? null, this.jawNormals);
    v.setCapture(this.componentData);
    this.syncSites();
    v.setAssembly(s.assembly);
    this.alignStep.applyDeviation();
    this.stage.update();
    if (s.sites.length || s.captureMesh) v.view('occlusal', true);
  }

  restartViewer(): void {
    this.viewer?.dispose();
    this.viewer = null;
    this.createViewer();
  }

  jawNormals: Float32Array | null = null;
  componentData: MeshData[] = [];

  /** Pushes sites and their geometries to the viewer. */
  syncSites(animate: readonly string[] = []): void {
    const v = this.viewer;
    if (!v) return;
    const sites = activeSites(this.s);
    v.setSites(sites.map((x) => ({ id: x.id, label: x.label, matrix: x.matrix })));
    for (const site of sites) {
      const gid = this.s.geometryBySite[site.id];
      const data = gid ? this.meshData(gid) : null;
      v.setGeometry(site.id, data ? gid! : null, data?.mesh ?? null, data?.normals ?? null, animate.includes(site.id));
    }
    v.setSelected(this.selected);
  }

  /* ---------------- geometry lookup ---------------- */

  meshData(geometryId: string): MeshData | null {
    const cached = this.meshCache.get(geometryId);
    if (cached) return cached;
    const g = this.s.caseGeometries.get(geometryId);
    if (!g) return null;
    const data = { mesh: g.mesh, normals: computeVertexNormals(g.mesh) };
    this.meshCache.set(geometryId, data);
    return data;
  }

  /** Loads a library mesh into the cache (IndexedDB read); null when missing. */
  async loadGeometry(id: string): Promise<MeshData | null> {
    const have = this.meshData(id);
    if (have) return have;
    const mesh = await this.library.get(id);
    if (!mesh) return null;
    const data = { mesh, normals: computeVertexNormals(mesh) };
    this.meshCache.set(id, data);
    return data;
  }

  geometryName(id: string): string {
    return this.s.caseGeometries.get(id)?.name ?? this.library.meta(id)?.name ?? '';
  }

  /** Library or case-only geometry as the engine expects it. */
  replacement(id: string): ReplacementGeometry | null {
    const data = this.meshData(id);
    return data ? { id, name: this.geometryName(id), mesh: data.mesh } : null;
  }

  /** Mesh of a site's geometry in the implant frame. */
  siteGeometry = (siteId: string): TriMesh | undefined => {
    const gid = this.s.geometryBySite[siteId];
    return gid ? this.meshData(gid)?.mesh : undefined;
  };

  private partsKey: unknown[] = [];
  private partsCache: ReturnType<typeof alignmentParts> = [];
  /** Alignment surfaces, built once per change of sites, geometry or surfaces. */
  parts(): ReturnType<typeof alignmentParts> {
    const s = this.s;
    const key = [s.sites, s.excluded, s.geometryBySite, s.surfaces, s.components];
    if (key.every((k, i) => k === this.partsKey[i])) return this.partsCache;
    this.partsKey = key;
    this.partsCache = alignmentParts(activeSites(s), this.siteGeometry, s.components, s.surfaces);
    return this.partsCache;
  }

  /** The site's alignment surface in its implant frame (guided points). */
  bodyInImplantFrame(site: ImplantSite): TriMesh | undefined {
    if (this.s.surfaces === 'capture' && site.componentIndex !== undefined) {
      const m = this.s.components[site.componentIndex];
      return m ? transformMesh(m, inverseRigid(site.matrix)) : undefined;
    }
    return this.siteGeometry(site.id);
  }

  /* ---------------- wizard ---------------- */

  private wireWizard(): void {
    for (const b of qa<HTMLButtonElement>(this.root, '.xch__step')) {
      b.addEventListener('click', () => {
        const n = Number(b.dataset.step) as Step;
        if (reachable(this.s, n)) this.go(n);
      }, { signal: this.signal });
    }
    for (const b of qa<HTMLButtonElement>(this.root, '[data-next]')) b.addEventListener('click', () => this.next(Number(b.dataset.next) as Step), { signal: this.signal });
    for (const b of qa<HTMLButtonElement>(this.root, '[data-back]')) b.addEventListener('click', () => this.go((Number(b.dataset.back) - 1) as Step), { signal: this.signal });
  }

  next(from: Step): void {
    const to = (from + 1) as Step;
    if (from === 3 && !this.s.jaw && !this.s.jawSkipped) return;
    if (to <= 4 && reachable(this.s, to)) this.go(to);
    else {
      const reason = q(this.root, `[data-reason="${from}"]`);
      if (reason.textContent) this.say.say(reason.textContent);
    }
  }

  /** Step change with the site's reveal vocabulary; focus to the new heading. */
  go(step: Step): void {
    if (step === this.shown && this.s.step === step) return;
    const from = q(this.root, `[data-pane="${this.shown}"]`);
    const to = q(this.root, `[data-pane="${step}"]`);
    this.alignStep.leaveGuided();
    this.shown = step;
    this.store.set({ step });
    this.stage.onStep(step);
    void this.motion.panel(from, to, () => {
      from.hidden = true;
      to.hidden = false;
    }).then(() => {
      q<HTMLElement>(to, '.xch__h').focus({ preventScroll: true });
      bringIntoView(q(this.root, '.xch__stepper'));
    });
    this.say.say(fmt(this.lang, this.c.say.step, { n: step, name: this.c.steps.names[step - 1]! }));
    if (step === 4) this.alignStep.onEnter();
  }

  /* ---------------- render ---------------- */

  render(): void {
    if (this.signal.aborted) return;
    const s = this.s;
    const done = [reachable(s, 2), reachable(s, 3), !!s.jaw || s.jawSkipped, false];
    qa<HTMLButtonElement>(this.root, '.xch__step').forEach((b, i) => {
      const n = (i + 1) as Step;
      const ok = reachable(s, n);
      const current = n === this.shown;
      b.toggleAttribute('aria-current', current);
      if (current) b.setAttribute('aria-current', 'step');
      b.classList.toggle('is-done', !!done[i] && !current);
      b.setAttribute('aria-disabled', String(!ok));
      q(b, '[data-step-state]').textContent = ` · ${current ? this.c.steps.current : !ok ? this.c.steps.locked : done[i] ? this.c.steps.done : ''}`;
      const lock = b.parentElement?.querySelector('[data-step-lock]');
      if (lock) lock.textContent = ok ? '' : n === 2 ? this.c.steps.lockedCapture : this.c.steps.lockedGeometry;
    });
    const completed = done.slice(0, 3).filter(Boolean).length;
    q(this.root, '.xch__track i').style.transform = `scaleX(${Math.min(completed, 3) / 3})`;
    q(this.section, '[data-sample-pill]').hidden = !s.sample;
    q(this.section, '[data-exit-sample]').hidden = !s.sample;
    this.capture.render();
    this.geometry.render();
    this.alignStep.render();
    this.stage.update();
  }

  /** Implant rows shared by steps 1, 2 and 4. */
  implantRows(mode: 1 | 2 | 4): HTMLElement[] {
    const s = this.s, c = this.c;
    const list = mode === 1 ? s.sites : activeSites(s);
    return list.map((site) => {
      const left = s.excluded.has(site.id);
      const btn = h('button', 'xch__rowbtn', { type: 'button', 'aria-pressed': String(this.selected === site.id), 'data-key': `row:${site.id}` }, h('span', 'xch__rowlabel', { text: site.label }));
      btn.addEventListener('click', () => this.select(site.id));
      const li = h('li', `xch__row${left ? ' is-left' : ''}`, {}, btn);
      if (mode === 1) {
        if (left) {
          btn.append(h('span', 'xch__rowmeta', { text: c.s1.leftOut }));
          const undo = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.s1.undo, 'data-key': `undo:${site.id}` });
          undo.addEventListener('click', () => this.capture.include(site.id));
          li.append(undo);
        } else {
          btn.append(this.siteChip(site));
          if (site.flags.provisional && !s.confirmed.has(site.id)) {
            const out = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.s1.leaveOut, 'data-key': `out:${site.id}` });
            out.addEventListener('click', () => this.capture.leaveOut(site.id));
            li.append(out);
          }
        }
      } else {
        const gid = s.geometryBySite[site.id];
        btn.append(h('span', 'xch__rowmeta', { text: gid ? this.geometryName(gid) : c.s2.noGeometry }));
      }
      return li;
    });
  }

  siteChip(site: ImplantSite): HTMLElement {
    const c = this.c.s1.status;
    if (site.flags.provisional && !this.s.confirmed.has(site.id)) return this.chip('warn', c.check, 'warn');
    if (site.flags.indexAmbiguous) return this.chip('warn', c.rotation, 'info');
    if (site.source === 'stl' || site.source === 'ply' || site.source === 'obj') return this.chip('ok', c.found, 'check');
    return this.chip('', c.fromFile, 'file');
  }

  chip(tone: '' | 'ok' | 'info' | 'warn' | 'bad', text: string, ico: string): HTMLElement {
    return h('span', `xch-chip${tone ? ` xch-chip--${tone}` : ''}`, {}, icon(ico, 14), text);
  }

  /** Selects an implant (list or stage) and eases the camera to it. */
  select(siteId: string | null, focusCamera = true): void {
    this.selected = siteId;
    this.viewer?.setSelected(siteId);
    if (siteId) {
      if (focusCamera) this.viewer?.fit([siteId]);
      const site = this.s.sites.find((x) => x.id === siteId);
      if (site) this.say.say(fmt(this.lang, this.c.say.selected, { label: site.label }));
      this.geometry.target = 'one';
    }
    this.render();
  }

  /* ---------------- feedback ---------------- */

  /** Busy row + the stage's slim bar. `fraction` null = indeterminate. */
  busy(key: string, text: string, onCancel?: () => void): Busy {
    const box = q(this.root, `[data-busy="${key}"]`);
    const label = h('span', '', { text, id: `xch-busy-${key}` });
    const bar = h('div', 'xch-progress is-indet', { role: 'progressbar', 'aria-labelledby': `xch-busy-${key}`, 'aria-valuetext': this.reduced ? this.c.say.working : text }, h('i'));
    const row = h('div', 'xch__busyrow', {}, label);
    if (onCancel) {
      const b = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: this.c.panel.cancel });
      b.addEventListener('click', onCancel);
      row.append(b);
    }
    box.replaceChildren(row, bar);
    box.hidden = false;
    this.busyCount++;
    this.stage.busy(this.busyCount > 0);
    let finished = false;
    return {
      set: (fraction, t) => {
        if (t) label.textContent = t;
        if (fraction === null) return;
        bar.classList.remove('is-indet');
        bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuetext', t ?? label.textContent ?? '');
        q(bar, 'i').style.transform = `scaleX(${fraction})`;
      },
      done: () => {
        if (finished) return;
        finished = true;
        box.hidden = true;
        box.replaceChildren();
        this.busyCount--;
        this.stage.busy(this.busyCount > 0);
      },
    };
  }

  /** Error alert in a step (CANCELLED only says so quietly). */
  error(step: Step | 'lib', error: unknown, purpose: Purpose, ctx: MessageContext & { vars?: Record<string, number> } = {}): void {
    const box = q(this.root, `[data-alerts="${step === 'lib' ? 2 : step}"]`);
    if (isXchangeError(error) && error.code === 'CANCELLED') { this.say.say(this.c.say.cancelled); return; }
    let msg;
    if (error instanceof UiError || (error as { code?: string })?.code === 'libraryFull' || (error as { code?: string })?.code === 'storageFull') {
      const key = error instanceof UiError ? error.key : (error as { code: string }).code;
      const row = (this.c.ui as unknown as Record<string, { t: string; b: string }>)[key] ?? this.c.errors.INTERNAL;
      const vars = { limit: 50, ...ctx.vars };
      msg = { title: fmt(this.lang, row.t, vars), body: fmt(this.lang, row.b, vars), code: fmt(this.lang, this.c.err.code, { code: key, reason: '' }) };
    } else {
      if (!isXchangeError(error)) console.error(error);
      msg = errorMessage(this.c, this.lang, toErrorPayload(error), { purpose, labels: this.s.sites.map((x) => x.label), ...ctx });
    }
    const card = alertCard(msg, this.c.err.dismiss, () => card.remove());
    box.replaceChildren(card);
    this.motion.appear(card);
    bringIntoView(card);
  }

  clearAlerts(step: Step): void {
    q(this.root, `[data-alerts="${step}"]`).replaceChildren();
  }

  notes(step: Step, texts: readonly (string | HTMLElement)[]): void {
    this.root.querySelector(`[data-notes="${step}"]`)?.replaceChildren(...texts.map((t) => (typeof t === 'string' ? noteCard(t) : t)));
  }

  plural(text: Parameters<typeof plural>[1], n: number, vars: Record<string, string | number> = {}): string {
    return plural(this.lang, text, n, vars);
  }

  confirm(kind: 'replace' | 'new' | 'sample', opener: Element | null): Promise<boolean> {
    const c = this.c.confirm;
    const copy = kind === 'replace' ? { title: c.replaceTitle, text: c.replaceText, yes: c.replaceYes } : kind === 'new' ? { title: c.newTitle, text: c.newText, yes: c.newYes } : { title: c.sampleTitle, text: c.sampleText, yes: c.sampleYes };
    return confirmDialog(q<HTMLDialogElement>(this.section, '#xch-confirm'), { ...copy, keep: c.keep }, opener);
  }

  later(fn: () => void, ms: number): void {
    const t = window.setTimeout(() => { this.timers.delete(t); if (!this.signal.aborted) fn(); }, ms);
    this.timers.add(t);
  }

  /** Replaces the whole case (arch and library stay). */
  resetCase(arch = this.s.arch): void {
    this.alignStep.cancelAll();
    this.jobs.cancelAll();
    this.selected = null;
    for (const id of this.s.caseGeometries.keys()) this.meshCache.delete(id);
    this.jawNormals = null;
    this.componentData = [];
    this.geometry.target = 'all';
    this.store.set(freshCase(arch));
    for (const n of [1, 2, 3, 4] as Step[]) { this.clearAlerts(n); this.notes(n, []); }
    this.capture?.clearWarnings();
    this.rebuildViewer();
  }

  /** Unexported work that the leave guard protects. */
  hasUnsaved(): boolean {
    return (this.s.sites.length > 0 || !!this.s.captureMesh) && !this.s.exportedSinceChange;
  }

  dispose(): void {
    this.ac.abort();
    for (const t of this.timers) clearTimeout(t);
    this.alignStep?.dispose();
    this.motion.dispose();
    this.say.dispose();
    this.toasts.dispose();
    this.align.dispose();
    this.jobs.dispose();
    this.viewer?.dispose();
    this.viewer = null;
    this.stage?.dispose();
    for (const d of qa<HTMLDialogElement>(this.section, 'dialog')) if (d.open) d.close();
    document.dispatchEvent(new CustomEvent('scroll-lock', { detail: false }));
    this.library?.close();
    this.meshCache.clear();
  }
}
