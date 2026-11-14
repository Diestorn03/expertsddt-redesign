/**
 * Step 3 · Jaw scan and step 4 · Align and export (UI-DESIGN §5.5, §5.6, §6.6, §6.7, §8, §9).
 * Loading the jaw starts auto align. Every pose change is re-measured 250 ms after the gesture; a re-measure of
 * the aligned pose keeps the original method (state/case mergeMeasured). A measure is never aborted (that would
 * terminate the align worker and rebuild the jaw target): a newer pose only makes its result stale. With a jaw, export waits for an
 * applied alignment. The email is asked once, before the first export, and never blocks the download.
 */
import * as THREE from 'three';
import { identity, maxAbsDiff } from '../core/mat4';
import { computeBounds, countTriangles } from '../core/mesh';
import { distance } from '../core/vec3';
import type { AlignmentResult, ExportRequest, ImplantSite, LandmarkPair, Mat4, Vec3 } from '../core/types';
import { guidePoint, orderSitesAlongArch } from '../align/landmarks';
import { DEFAULT_QUALITY } from '../align/metrics';
import type { AlignStage } from '../align/multistart';
import { activeSites, alignedBody, bodyOf, canMatchCapture, chosenBodies, exchangedSites, exportBlocker, guidedTargets, matchedBodies, measuredBodies, mergeMeasured, missingGeometry, pushUndo, shownDeviation, siteStatus, type AlignedWith } from '../state/case';
import { CAPTURE_BODY_ID, mainFileName } from '../export/report';
import type { ExportResult, JawResult } from '../state/jobs-handler';
import { markSent, needsEmail, retryPending, submitLead, type LeadEnv, type StorageLike } from '../state/lead';
import { rotatePose, translatePose, type ControlCallbacks, type ControlMode } from '../viewer/controls';
import { toEngine } from '../viewer/viewer';
import type { App } from './app';
import { LIMITS } from '../core/limits';
import { fill, fillKeep, h, icon, isOff, pickFiles, q, qa, radiogroup, setChecked } from './dom';
import { bringIntoView, noteCard, openModal } from './feedback';
import { ACCEPT, buffersOf, download, readFiles, revokeUrl } from './files';
import { dropZone } from './step-capture';
import { fmt, mb, num, warningMessage } from './i18n/format';

export const XCHANGE_VERSION = '1.0.0';
/** Guided points closer than this (mm) are on one spot: they mark different scan bodies, millimetres apart. */
const GUIDED_APART_MM = 0.5;
const STAGE_SPAN: Readonly<Record<AlignStage, [number, number]>> = { prepare: [0, 0.1], coarse: [0.1, 0.55], fine: [0.55, 0.9], metrics: [0.9, 1] };
const TONE = { good: ['ok', 'check'], acceptable: ['info', 'info'], weak: ['warn', 'warn'], ambiguous: ['warn', 'warn'], failed: ['bad', 'bad'] } as const;

interface Guided {
  targets: ImplantSite[];
  pairs: (LandmarkPair | null)[];
  skipped: Set<number>;
  order: number[];
  idx: number;
}

/** What the ZIP is built from: if one of these changed while it was built, it is not the case on screen. */
const EXPORTED = ['arch', 'sites', 'excluded', 'geometryBySite', 'caseGeometries', 'assembly', 'jaw', 'alignment', 'alignedWith', 'format'] as const;

const storage = (): StorageLike | null => { try { return window.localStorage; } catch { return null; } };

export class AlignStep {
  private readonly pane3: HTMLElement;
  private readonly pane4: HTMLElement;
  private alignJob: AbortController | null = null;
  private jawJob: AbortController | null = null;
  /** Token of the newest measure; an older one that finishes finds it changed and drops its result. */
  private measureJob: object | null = null;
  private measureTimer = 0;
  /** A jaw was sent to the align worker (released by Remove and by a new case). */
  private jawLoaded = false;
  private alignedResult: AlignmentResult | null = null;
  private mapShown = false;
  guided: Guided | null = null;
  private exportUrl: string | null = null;
  private exportLine = '';
  private resultKey: unknown = null;
  private jawWarnings: HTMLElement[] = [];
  /** Sample jaw bytes (PLY with colors), set by the sample case. */
  sampleJaw: Uint8Array | null = null;
  /** The jaw scan is the user's own file (not the sample's): the leave guard protects it. */
  ownJaw = false;

  constructor(private readonly app: App) {
    const { root, signal } = app;
    this.pane3 = q(root, '[data-pane="3"]');
    this.pane4 = q(root, '[data-pane="4"]');
    for (const b of this.pane3.querySelectorAll<HTMLButtonElement>('[data-pick="jaw"]')) {
      b.addEventListener('click', async () => { const [f] = await pickFiles(ACCEPT.jaw, false); if (f) void this.loadJaw(f); }, { signal });
    }
    dropZone(q(this.pane3, '[data-drop="jaw"]'), (files) => void this.loadJaw(files[0]!), signal);
    q(this.pane3, '[data-sample-jaw]').addEventListener('click', () => { if (this.sampleJaw) void this.loadJaw(null, this.sampleJaw.slice()); }, { signal });
    q(this.pane3, '[data-jaw-remove]').addEventListener('click', () => this.removeJaw(), { signal });
    q(this.pane3, '[data-skip]').addEventListener('click', () => { app.store.set({ jawSkipped: true }); app.go(4); }, { signal });
    const alignBtn = (kind: string, run: () => void): void => {
      const b = q(this.pane4, `[data-align="${kind}"]`);
      b.addEventListener('click', () => { if (isOff(b)) app.say.say(app.c.al.running); else run(); }, { signal });
    };
    alignBtn('auto', () => void this.autoAlign());
    alignBtn('guided', () => this.startGuided());
    for (const b of qa<HTMLButtonElement>(this.pane4, '[data-gp]')) b.addEventListener('click', () => this.guidedAction(b.dataset.gp!), { signal });
    const exportBtn = q<HTMLButtonElement>(this.pane4, '[data-export]');
    exportBtn.addEventListener('click', () => void this.onExport(exportBtn), { signal });
    q(this.pane4, '[data-ex-again]').addEventListener('click', () => this.downloadAgain(), { signal });
    root.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && app.s.undo.length) { e.preventDefault(); this.undo(); }
    }, { signal });
    this.wireEmail();
    void retryPending(this.leadEnv());
  }

  /* ---------------- viewer input ---------------- */

  /** Guided points win; the distance tool pauses set drags; step 4 with a jaw drags the set. */
  mode(): ControlMode {
    if (this.guided) return 'guided';
    if (this.app.stage?.measuring) return 'measure';
    return this.app.shown === 4 && this.app.s.jaw ? 'set' : 'camera';
  }

  controlCallbacks(): ControlCallbacks {
    const app = this.app;
    let before: Mat4 | null = null;
    return {
      mode: () => this.mode(),
      onSelect: (id) => { if (app.shown !== 4 || !app.s.jaw) app.select(id, false); },
      onGuidedPoint: (p) => this.place(p),
      onGuidedMiss: () => app.say.say(app.c.gp.miss),
      onSetChange: (pose, phase) => {
        if (phase === 'start') before = Float64Array.from(app.s.assembly);
        if (phase === 'end' && before) {
          app.store.set({ assembly: toEngine(pose), undo: pushUndo(app.s.undo, before), exportedSinceChange: false });
          before = null;
          this.scheduleMeasure();
        }
      },
      onHover: (hit) => app.stage.readout(hit),
      onPreset: (p, keyboard) => app.stage.preset(p, keyboard),
      onToggleJawOpacity: () => app.stage.toggleJawOpacity(),
      onToggleMap: () => app.stage.toggleMap(),
      onShortcuts: () => app.stage.openKeys(),
      onGuidedKey: (k) => (k === 'Escape' ? this.leaveGuided() : this.guidedAction('back')),
      onCtrl: (down) => app.stage.ctrlChip(down && this.mode() === 'set'),
      onPivot: () => app.say.say(app.c.say.pivot),
      onPivotMiss: () => app.say.say(app.c.say.pivotMiss),
      onToggleOpacity: () => app.stage.togglePartOpacity(),
      onHide: (o) => app.stage.hide(o),
      onShowAll: () => app.stage.showAll(),
      onCameraInput: () => app.stage.cameraMoved(),
      onToggleSection: () => app.stage.toggleSection(true),
      onSectionNudge: (mm) => app.stage.nudgeSection(mm),
      onToggleMeasure: () => app.stage.toggleMeasure(),
      onMeasureBusy: () => app.say.say(app.c.dist.busy),
      onMeasurePoint: (p) => app.stage.measurePoint(p),
      onMeasureMiss: () => app.say.say(app.c.dist.miss),
      onMeasureKey: (k) => app.stage.measureKey(k),
      onMeasureDrag: (i, p, end) => app.stage.measureDrag(i, p, end),
    };
  }

  /* ---------------- step 3: jaw ---------------- */

  async loadJaw(file: File | null, bytes?: Uint8Array): Promise<void> {
    const app = this.app, c = app.c;
    app.clearAlerts(3);
    this.jawJob?.abort();
    const job = (this.jawJob = new AbortController());
    const busy = app.busy('3', c.s3.reading, () => job.abort());
    try {
      const [input] = file ? await readFiles([file], LIMITS.jaw.maxBytes) : [{ bytes: bytes!, extension: 'ply' }];
      const r = await app.jobs.run<JawResult>({ type: 'readJaw', file: input! }, buffersOf([input!]), job.signal);
      busy.set(null, c.s3.preparing);
      await app.align.setJaw(r.mesh, { signal: job.signal });
      this.jawLoaded = true;
      this.ownJaw = !!file;
      this.cancelAll();
      this.alignedResult = null;
      app.jawNormals = r.normals;
      this.jawWarnings = r.warnings.map((w) => noteCard(warningMessage(c, app.lang, w, 'jaw')));
      app.store.set({ jaw: { mesh: r.mesh, originalBytes: r.originalBytes, format: r.format }, jawColors: !!r.mesh.colors, jawSkipped: false, assembly: identity(), alignment: null, alignedWith: null, lastAttempt: null, lastAlignedPose: null, undo: [], deviation: null, exportedSinceChange: false });
      app.viewer?.setJaw(r.mesh, r.normals);
      app.viewer?.setAssembly(identity());
      app.viewer?.setDeviation(null, app.s.surfaces, () => undefined);
      app.stage.update();
      app.viewer?.view('occlusal'); // an import ends on Occlusal + Fit (UI-DESIGN §6.3): the jaw's own frame until the set sits on it
      app.say.say(c.say.jawReady);
      busy.done();
      app.go(4);
      void this.autoAlign();
    } catch (e) {
      app.error(3, e, 'jaw');
    } finally {
      busy.done();
    }
  }

  private removeJaw(): void {
    const app = this.app;
    this.cancelAll();
    this.alignedResult = null;
    this.jawWarnings = [];
    this.jawLoaded = false;
    this.ownJaw = false;
    app.align.clearJaw(); // the worker's jaw target is hundreds of MB at the 3 M-triangle limit
    app.jawNormals = null;
    app.store.set({ jaw: null, jawColors: false, assembly: identity(), alignment: null, alignedWith: null, lastAttempt: null, lastAlignedPose: null, undo: [], deviation: null, exportedSinceChange: false });
    app.viewer?.setJaw(null, null);
    app.viewer?.setAssembly(identity());
    this.applyDeviation();
    app.stage.update();
  }

  /* ---------------- step 4: alignment ---------------- */

  onEnter(): void {
    const s = this.app.s;
    if (s.jaw && s.deviation === null && s.alignment && !this.measureJob) this.scheduleMeasure();
  }

  private progress(): { busy: ReturnType<App['busy']>; onProgress: (stage: AlignStage, f: number) => void } {
    const app = this.app, c = app.c;
    const job = this.alignJob!;
    const busy = app.busy('align', c.al.stage.prepare, () => job.abort());
    let lastStage: AlignStage | null = null;
    return {
      busy,
      onProgress: (stage, f) => {
        const [a, b] = STAGE_SPAN[stage];
        const frac = a + (b - a) * f;
        busy.set(frac, fmt(app.lang, c.al.progress, { stage: c.al.stage[stage], pct: Math.round(frac * 100) }));
        if (stage !== lastStage) { lastStage = stage; app.say.say(fmt(app.lang, c.say.aligning, { stage: c.al.stage[stage] })); }
      },
    };
  }

  async autoAlign(initial?: Mat4): Promise<void> {
    const app = this.app;
    if (!app.s.jaw) return;
    app.clearAlerts(4);
    this.stopMeasure();
    this.alignJob?.abort();
    const job = (this.alignJob = new AbortController());
    const { busy, onProgress } = this.progress();
    app.render(); // the align buttons show as disabled while it runs
    const bodies = chosenBodies(app.s); // a new alignment uses what is in place now
    try {
      const r = await app.align.autoAlign(app.parts(bodies), initial ? { initial } : {}, { signal: job.signal, onProgress });
      await this.applyResult(r, bodies);
    } catch (e) {
      if ((e as { code?: string }).code === 'CANCELLED') app.say.say(app.c.say.alignCancelled);
      else app.error(4, e, 'jaw');
    } finally {
      busy.done();
      if (this.alignJob === job) this.alignJob = null;
      app.render();
    }
  }

  /** `bodies`: what the result was computed with; it stays measured with them, whatever is exchanged later. */
  private async applyResult(r: AlignmentResult, bodies: AlignedWith): Promise<void> {
    const app = this.app, c = app.c;
    if (r.status === 'failed') {
      app.store.set({ lastAttempt: r });
      app.say.say(c.say.alignFailed);
      return;
    }
    this.alignedResult = r;
    app.store.set({ assembly: r.transform, alignment: r, alignedWith: bodies, lastAttempt: null, lastAlignedPose: r.transform, undo: [], deviation: null, exportedSinceChange: false });
    app.viewer?.setAssembly(r.transform, 'align');
    app.say.say(fmt(app.lang, c.say.aligned, { status: c.al.status[r.status], rms: num(app.lang, r.rmsMm * 1000) }));
    await this.computeDeviation();
  }

  /** Deviation map of the current pose; `current` false (a newer pose came meanwhile) drops it. */
  private async computeDeviation(current: () => boolean = () => true): Promise<void> {
    const app = this.app;
    const parts = app.parts(measuredBodies(app.s));
    if (!parts.length || !app.s.jaw) return;
    const dev = await app.align.deviation(parts, app.s.assembly);
    if (!current()) return;
    app.store.set({ deviation: dev });
    this.applyDeviation();
    if (!this.mapShown) { this.mapShown = true; app.stage.setDisplay({ map: true }); }
  }

  /** The map on what it can be drawn on: never on a part exchanged after the alignment (state/case shownDeviation). */
  applyDeviation(): void {
    const app = this.app;
    app.viewer?.setDeviation(shownDeviation(app.s), app.s.surfaces, (id) => app.s.sites.find((x) => x.id === id)?.componentIndex);
  }

  /**
   * An exchange keeps the alignment (UI-DESIGN §5.2, alignedWith): nothing is re-measured with the new geometry, which
   * is often not the body the jaw scan shows (workflow 2). Only the map leaves the exchanged parts.
   */
  onGeometryChanged(): void {
    this.applyDeviation();
  }

  /** Stops waiting for a re-measure; one already in the worker finishes (it is short) and is dropped. */
  private stopMeasure(): void {
    clearTimeout(this.measureTimer);
    this.measureJob = null;
    if (this.app.s.measuring) this.app.store.set({ measuring: false });
  }

  /** Re-measure 250 ms after the last change; a measure still running becomes stale. */
  scheduleMeasure(): void {
    const app = this.app;
    if (!app.s.jaw) return;
    clearTimeout(this.measureTimer);
    this.measureJob = null;
    if (!app.s.measuring) app.store.set({ measuring: true });
    this.measureTimer = window.setTimeout(() => void this.runMeasure(), 250);
  }

  private async runMeasure(): Promise<void> {
    const app = this.app;
    const job = (this.measureJob = {});
    const current = (): boolean => this.measureJob === job;
    const bodies = measuredBodies(app.s); // the alignment's own bodies, whatever was exchanged since
    const parts = app.parts(bodies);
    if (!parts.length) { app.store.set({ measuring: false }); return; }
    try {
      const pose = app.s.assembly;
      const r = await app.align.measure(parts, pose, {});
      if (!current()) return;
      // moved = away from the aligned pose (an Undo back to it is no manual adjustment)
      const aligned = app.s.lastAlignedPose;
      const merged = mergeMeasured(app.s.alignment, r, !aligned || maxAbsDiff(pose, aligned) > 1e-12);
      app.store.set({ alignment: merged, alignedWith: bodies, lastAttempt: null, measuring: false });
      app.say.say(fmt(app.lang, app.c.say.measured, { status: app.c.al.status[merged.status], rms: num(app.lang, merged.rmsMm * 1000) }));
      await this.computeDeviation(current);
    } catch (e) {
      if ((e as { code?: string }).code === 'CANCELLED' || !current()) return;
      app.store.set({ measuring: false });
      app.error(4, e, 'jaw');
    } finally {
      if (current()) this.measureJob = null;
    }
  }

  /* ---------------- manual adjustment ---------------- */

  private commitPose(m: Mat4, tween: 'step' | 'align' = 'step'): void {
    const app = this.app;
    app.store.set({ assembly: m, undo: pushUndo(app.s.undo, app.s.assembly), exportedSinceChange: false });
    app.viewer?.setAssembly(m, tween);
    this.scheduleMeasure();
  }

  /** Adjust pad: 30° / 1 mm per click, 5° / 0.1 mm with Shift, in screen axes about the set's center. */
  pad(op: string, dir: number, shift: boolean): void {
    const v = this.app.viewer;
    if (!v || !this.app.s.jaw) return;
    v.finishPose(); // a quick second click starts from the committed pose, not from the in-between one
    const pose = v.assembly.matrix.clone();
    const pivot = v.setCenter();
    const { right, up, view } = v.axes();
    const angle = ((shift ? 5 : 30) * Math.PI) / 180 * dir, step = (shift ? 0.1 : 1) * dir;
    let next: THREE.Matrix4;
    switch (op) {
      case 'rx': next = rotatePose(pose, right, angle, pivot); break;
      case 'ry': next = rotatePose(pose, up, angle, pivot); break;
      case 'rz': next = rotatePose(pose, view, angle, pivot); break;
      case 'tx': next = translatePose(pose, right.multiplyScalar(step)); break;
      case 'ty': next = translatePose(pose, up.multiplyScalar(step)); break;
      case 'fx': next = rotatePose(pose, right, Math.PI, pivot); break;
      default: next = rotatePose(pose, up, Math.PI, pivot);
    }
    this.commitPose(toEngine(next));
  }


  undo(): void {
    const app = this.app;
    const stack = [...app.s.undo];
    const prev = stack.pop();
    if (!prev) return;
    const atAligned = !!app.s.lastAlignedPose && maxAbsDiff(prev, app.s.lastAlignedPose) < 1e-12;
    app.store.set({ assembly: prev, undo: stack, exportedSinceChange: false, ...(atAligned && this.alignedResult ? { alignment: this.alignedResult } : {}) });
    app.viewer?.setAssembly(prev, 'step');
    this.scheduleMeasure();
    app.say.say(app.c.say.undone);
  }


  /* ---------------- guided points ---------------- */

  private startGuided(): void {
    const app = this.app;
    if (!app.s.jaw) return;
    this.stopMeasure();
    const targets = guidedTargets(activeSites(app.s));
    this.guided = { targets, pairs: targets.map(() => null), skipped: new Set(), order: [], idx: 0 };
    app.stage.setGuided(true);
    this.syncGuided();
    const first = targets[0];
    app.viewer?.fit(first ? [first.id] : undefined); // the crosshair starts on the first target, not inside the arch
    app.render();
    // the button that opened this is hidden now: focus the panel title, say what to do
    const title = q<HTMLElement>(this.pane4, '[data-sec="guided"] .xch__subtitle');
    title.focus({ preventScroll: true });
    bringIntoView(title);
    if (first) app.say.say(`${app.c.gp.text} ${fmt(app.lang, app.c.gp.first, { label: first.label })}`);
  }

  private syncGuided(): void {
    const g = this.guided, v = this.app.viewer;
    if (!v) return;
    v.setGuided(g ? { current: g.targets[g.idx]?.id ?? null, dim: true } : null);
    v.setPins(g ? g.order.map((i) => g.pairs[i]!.target) : []);
  }

  private nextIndex(g: Guided, from: number): number {
    const n = g.targets.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (!g.pairs[i] && !g.skipped.has(i)) return i;
    }
    return -1;
  }

  private place(p: Vec3): void {
    const app = this.app, g = this.guided;
    if (!g || g.idx < 0) return;
    const site = g.targets[g.idx]!;
    // each point marks another scan body: one on top of a placed one (a double-click, Enter twice at the crosshair) is
    // refused here, not four points later as "points on top of each other"
    if (g.pairs.some((q) => q && distance(q.target, p) < GUIDED_APART_MM)) { app.say.say(fmt(app.lang, app.c.gp.same, { label: site.label })); return; }
    const body = app.bodyInImplantFrame(site);
    if (!body) return;
    g.pairs[g.idx] = { source: guidePoint(site, body), target: p };
    g.order.push(g.idx);
    const n = g.order.length;
    const next = this.nextIndex(g, g.idx);
    g.idx = next;
    this.syncGuided();
    if (next < 0) {
      app.say.say(fmt(app.lang, app.c.gp.announceLast, { n }));
      void this.runGuided();
    } else app.say.say(fmt(app.lang, app.c.gp.announce, { n, label: g.targets[next]!.label }));
    app.render();
  }

  private guidedAction(action: string): void {
    const g = this.guided;
    if (!g) return;
    if (action === 'cancel') return this.leaveGuided(true);
    if (action === 'align') { if (this.canAlignGuided()) void this.runGuided(); return; }
    if (action.startsWith('unskip:')) {
      const i = Number(action.slice(7));
      g.skipped.delete(i);
      if (g.idx < 0) g.idx = i;
    } else if (action === 'back') {
      const last = g.order.pop();
      if (last === undefined) return;
      g.pairs[last] = null;
      g.idx = last;
    } else if (action === 'skip') {
      if (g.idx < 0) return;
      g.skipped.add(g.idx);
      g.idx = this.nextIndex(g, g.idx);
    } else if (action === 'restart') {
      g.pairs = g.targets.map(() => null);
      g.skipped.clear();
      g.order = [];
      g.idx = 0;
    } else if (action.startsWith('redo:')) {
      const i = Number(action.slice(5));
      g.pairs[i] = null;
      g.order = g.order.filter((x) => x !== i);
      g.skipped.delete(i);
      g.idx = i;
    }
    this.syncGuided();
    this.app.render();
  }

  /** Three points (or every target of a smaller case), or fewer once every other implant is skipped. */
  private canAlignGuided(): boolean {
    const g = this.guided;
    if (!g || !g.order.length) return false;
    return g.order.length >= Math.min(3, g.targets.length) || g.idx < 0;
  }

  private async runGuided(): Promise<void> {
    const app = this.app, g = this.guided;
    if (!g) return;
    const pairs = g.order.map((i) => g.pairs[i]!);
    this.leaveGuided(false);
    app.clearAlerts(4);
    this.alignJob?.abort();
    const job = (this.alignJob = new AbortController());
    const { busy, onProgress } = this.progress();
    app.render(); // the align buttons show as disabled while it runs
    const bodies = chosenBodies(app.s);
    try {
      const r = await app.align.alignFromLandmarks(app.parts(bodies), pairs, {}, { signal: job.signal, onProgress });
      await this.applyResult(r, bodies);
    } catch (e) {
      if ((e as { code?: string }).code === 'CANCELLED') app.say.say(app.c.say.alignCancelled);
      else app.error(4, e, 'jaw');
    } finally {
      busy.done();
      if (this.alignJob === job) this.alignJob = null;
      app.render();
    }
  }

  /** Focus in the guided panel (hidden now) goes back to the button that opened it; the stage keeps its focus. */
  leaveGuided(render = true): void {
    if (!this.guided) return;
    const active = document.activeElement;
    const inPanel = !active || active === document.body || q(this.pane4, '[data-sec="guided"]').contains(active);
    this.guided = null;
    this.app.stage.setGuided(false);
    this.syncGuided();
    if (render) this.app.render();
    if (inPanel) {
      q(this.pane4, '[data-sec="align"]').hidden = !this.app.s.jaw;
      q<HTMLElement>(this.pane4, '[data-align="guided"]').focus({ preventScroll: true });
    }
  }

  /* ---------------- export + email gate ---------------- */

  private leadEnv(): LeadEnv {
    return { storage: storage(), hook: this.app.hook, lang: this.app.lang, page: location.origin + location.pathname };
  }

  private wireEmail(): void {
    const app = this.app, dlg = q<HTMLDialogElement>(app.section, '#xch-email');
    const form = q<HTMLFormElement>(dlg, 'form');
    const input = q<HTMLInputElement>(form, 'input[name="email"]');
    for (const b of qa(dlg, '[data-close]')) b.addEventListener('click', () => dlg.close(), { signal: app.signal });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }, { signal: app.signal });
    input.addEventListener('input', () => input.setCustomValidity(''), { signal: app.signal });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      input.setCustomValidity('');
      if (!input.checkValidity()) { input.setCustomValidity(input.dataset.invalid ?? ''); input.reportValidity(); input.focus(); return; }
      const honeypot = (form.elements.namedItem('website') as HTMLInputElement).value;
      if (honeypot) markSent(storage());
      else void submitLead(input.value.trim(), this.leadEnv());
      dlg.close();
      form.reset();
      void this.doExport();
    }, { signal: app.signal });
  }

  private async onExport(btn: HTMLButtonElement): Promise<void> {
    const app = this.app;
    if (btn.classList.contains('is-busy')) return; // one export at a time
    const blocker = exportBlocker(app.s);
    if (blocker) { app.say.say(q(this.pane4, '[data-reason="4"]').textContent ?? ''); return; }
    if (needsEmail(storage())) {
      const dlg = q<HTMLDialogElement>(app.section, '#xch-email');
      openModal(dlg, btn);
      q<HTMLInputElement>(dlg, 'input[name="email"]').focus();
      return;
    }
    void retryPending(this.leadEnv());
    await this.doExport();
  }

  private async doExport(): Promise<void> {
    const app = this.app, s = app.s, c = app.c;
    app.clearAlerts(4);
    const btn = q<HTMLButtonElement>(this.pane4, '[data-export]');
    btn.classList.add('is-busy');
    btn.setAttribute('aria-disabled', 'true');
    const busy = app.busy('export', c.ex.building);
    try {
      const sites = activeSites(s);
      const geometryBySite: Record<string, NonNullable<ReturnType<App['replacement']>>> = {};
      for (const site of sites) {
        const gid = s.geometryBySite[site.id];
        const g = gid ? (await app.loadGeometry(gid), app.replacement(gid)) : null;
        if (g) geometryBySite[site.id] = g;
      }
      const aligned = !!(s.jaw && s.alignment);
      const request: ExportRequest = {
        arch: s.arch ?? 'lower', captureFormat: s.format ?? 'demo', sites, geometryBySite,
        assemblyTransform: s.jaw ? s.assembly : identity(), jaw: s.jaw ?? undefined, alignment: aligned ? s.alignment! : undefined,
        // the bodies the alignment was made with: an exchange after it keeps its pose and metrics (report.json, README)
        ...(aligned ? { matchedWith: matchedBodies(s, (id) => app.geometryName(id), c.s2.fileBody) } : {}),
        createdAt: new Date().toISOString(), appVersion: XCHANGE_VERSION,
      };
      const r = await app.jobs.run<ExportResult>({ type: 'export', request });
      const old = this.exportUrl;
      if (old) app.later(() => revokeUrl(old), 60_000); // a download in progress may still read it
      this.exportUrl = download(r.zip, r.zipName, 'application/zip');
      this.exportName = r.zipName;
      const size = mb(app.lang, r.zip.byteLength);
      // the ZIP holds the case as it was when the export started: a change made meanwhile keeps the guard armed
      const now = app.s;
      const unchanged = EXPORTED.every((k) => now[k] === s[k]);
      this.exportLine = unchanged ? fmt(app.lang, c.ex.last, { time: new Intl.DateTimeFormat(app.lang, { timeStyle: 'short' }).format(new Date()), size }) : '';
      if (unchanged) app.store.set({ exportedSinceChange: true });
      // the toast region (role=status) announces it: no second message in #xch-status
      app.toasts.show(fmt(app.lang, c.say.exportReady, { size }), unchanged ? { label: c.ex.again, run: () => this.downloadAgain() } : undefined);
    } catch (e) {
      app.error(4, e, 'jaw');
    } finally {
      busy.done();
      btn.classList.remove('is-busy');
      app.render();
    }
  }

  private exportName = '';
  private downloadAgain(): void {
    if (!this.exportUrl) return;
    const a = h('a', '', { href: this.exportUrl, download: this.exportName, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
  }

  /* ---------------- render ---------------- */

  render(): void {
    this.renderJaw();
    this.renderAlign();
    this.renderExport();
  }

  private renderJaw(): void {
    const app = this.app, s = app.s, c = app.c;
    const jaw = s.jaw;
    q(this.pane3, '[data-drop="jaw"]').hidden = !!jaw;
    if (s.arch) { // "Import the upper jaw scan": not to be mistaken for the implant position file of step 1
      q(this.pane3, '.xch__h').textContent = c.s3.titleArch[s.arch];
      q(this.pane3, '[data-drop="jaw"] .xch__droptitle').textContent = c.s3.dropArch[s.arch];
    }
    q(this.pane3, '[data-sample-jaw]').hidden = !s.sample || !!jaw;
    q(this.pane3, '[data-jawcard]').hidden = !jaw;
    q(this.pane3, '[data-next="3"]').hidden = !jaw && !s.jawSkipped;
    if (jaw) {
      const chip = q(this.pane3, '[data-jaw-chip]');
      chip.replaceChildren(icon('check', 14), c.s3.ready);
      const b = computeBoundsCached(jaw.mesh);
      q(this.pane3, '[data-jaw-meta]').textContent = fmt(app.lang, c.s3.meta, {
        format: jaw.format.toUpperCase(), color: s.jawColors ? c.s3.withColor : '', triangles: num(app.lang, countTriangles(jaw.mesh)), size: num(app.lang, b, 0),
      });
    }
    fill(q(this.pane3, '[data-notes="3"]'), this.jawWarnings);
  }

  private renderAlign(): void {
    const app = this.app, s = app.s, c = app.c, g = this.guided;
    const jaw = !!s.jaw;
    q(this.pane4, '[data-s4-title]').textContent = jaw ? c.s4.titleAlign : c.s4.titleReview;
    q(this.pane4, '[data-s4-text]').textContent = jaw ? c.s4.textAlign : c.s4.noJaw;
    q(this.pane4, '[data-sec="align"]').hidden = !jaw || !!g;
    q(this.pane4, '[data-sec="guided"]').hidden = !g;
    q(this.pane4, '[data-sec="manual"]').hidden = !jaw || !!g;
    q(this.pane4, '[data-sec="review"]').hidden = jaw;
    if (!jaw) fillKeep(q(this.pane4, '[data-list="implants4"]'), app.implantRows(4), app.focusKey);
    const running = !!this.alignJob;
    for (const b of qa(this.pane4, '[data-align]')) b.setAttribute('aria-disabled', String(running));
    const captureOk = canMatchCapture(activeSites(s), s.components);
    q(this.pane4, '[data-not-yet]').hidden = !!(s.alignment || s.lastAttempt) || running;
    const exchanged = exchangedSites(s);
    const note = q(this.pane4, '[data-exchanged]');
    note.hidden = !exchanged.length;
    note.textContent = exchanged.length ? fmt(app.lang, c.al.exchanged, {
      aligned: this.bodyNames(exchanged.map((x) => alignedBody(s, x.id))),
      exported: this.bodyNames(exchanged.map((x) => bodyOf(s, s.geometryBySite[x.id]))),
    }) : '';
    this.renderResult();
    if (g) this.renderGuided(g);
  }

  private renderResult(): void {
    const app = this.app, s = app.s, c = app.c;
    const box = q(this.pane4, '[data-result]');
    const r = s.alignment ?? s.lastAttempt;
    const key = s.measuring ? 'measuring' : r;
    if (key === this.resultKey) return;
    this.resultKey = key;
    box.hidden = !r && !s.measuring;
    if (!r && !s.measuring) { box.replaceChildren(); return; }
    if (s.measuring && r && box.childElementCount > 1) { // the card stays at its height, dimmed, until the new numbers arrive
      box.classList.add('is-measuring');
      box.setAttribute('aria-busy', 'true');
      return;
    }
    box.classList.remove('is-measuring');
    box.removeAttribute('aria-busy');
    if (s.measuring || !r) {
      box.classList.remove('is-attempt');
      box.replaceChildren(app.chip('', c.al.measuring, 'info'));
      return;
    }
    const failed = !s.alignment;
    box.classList.toggle('is-attempt', failed);
    const status = failed ? 'failed' : r.status;
    const [tone, ico] = TONE[status];
    const chip = app.chip(tone, c.al.status[status], ico);
    chip.classList.add('xch-chip--big');
    const q0 = DEFAULT_QUALITY, tol = Math.round(r.toleranceMm * 1000);
    const limits = { goodRms: q0.goodRmsMm * 1000, goodCov: q0.goodCoverage * 100, accRms: q0.acceptableRmsMm * 1000, accCov: q0.acceptableCoverage * 100, minVis: q0.minVisible * 100, tol };
    const explain = fmt(app.lang, c.al.explain[!failed && status === 'failed' ? 'weak' : status], limits);
    const metric = (value: number, label: string, help: string, unit: string, digits = 0): HTMLElement => {
      const b = h('b', '', { text: '0' });
      app.motion.count(b, value, (v) => `${num(app.lang, v, digits)} ${unit}`);
      return h('div', 'xch__metric', {}, b, h('span', '', { text: label }));
    };
    // what the numbers mean, for everyone (a title tooltip reaches neither keyboard, touch nor screen readers)
    const help = h('details', 'xch__what', {}, h('summary', '', { text: c.al.metricsWhat }),
      h('ul', '', {}, h('li', '', { text: `${c.al.rms}: ${c.al.rmsHelp}` }), h('li', '', { text: `${c.al.p95}: ${c.al.p95Help}` }),
        h('li', '', { text: `${fmt(app.lang, c.al.coverage, { tol })}: ${fmt(app.lang, c.al.coverageHelp, { tol })}` }),
        h('li', '', { text: fmt(app.lang, c.al.limits, limits) })));
    const metrics = h('div', 'xch__metrics', {},
      metric(r.rmsMm * 1000, c.al.rms, c.al.rmsHelp, 'µm'),
      metric(r.p95Mm * 1000, c.al.p95, c.al.p95Help, 'µm'),
      metric(r.coverage * 100, fmt(app.lang, c.al.coverage, { tol }), fmt(app.lang, c.al.coverageHelp, { tol }), '%'));
    const flags = r.flags.filter((f) => f !== 'visualCheckRequired').map((f) => h('li', '', { text: c.al.flags[f] }));
    const order = orderSitesAlongArch(activeSites(s));
    const fitOf = new Map(r.perSite.map((p) => [p.siteId, p]));
    const rows = order.filter((x) => fitOf.has(x.id)).map((site) => {
      const fit = fitOf.get(site.id)!;
      const st = siteStatus(fit);
      const show = h('button', '', { type: 'button', text: site.label, 'aria-label': fmt(app.lang, c.al.table.show, { label: site.label }) });
      show.addEventListener('click', () => { app.viewer?.fit([site.id]); app.viewer?.pulseSites([site.id]); });
      const stTone = st === 'good' ? ['ok', 'check'] : st === 'acceptable' ? ['info', 'info'] : st === 'weak' ? ['warn', 'warn'] : ['bad', 'bad'];
      return h('tr', '', {}, h('th', '', { scope: 'row' }, show), h('td', 'n', { text: num(app.lang, fit.rmsMm * 1000) }), h('td', 'n', { text: `${num(app.lang, fit.coverage * 100)} %` }), h('td', '', {}, app.chip(stTone[0] as 'ok', c.al.site[st], stTone[1]!)));
    });
    const table = h('div', 'xch__tablewrap', { 'data-lenis-prevent': true }, h('table', 'xch__table', {},
      h('caption', '', { text: c.al.table.caption }),
      h('thead', '', {}, h('tr', '', {}, h('th', '', { scope: 'col', text: c.al.table.implant }), h('th', 'n', { scope: 'col', text: c.al.table.rms }), h('th', 'n', { scope: 'col', text: fmt(app.lang, c.al.table.within, { tol }) }), h('th', '', { scope: 'col', text: c.al.table.status }))),
      h('tbody', '', {}, ...rows)));
    // the status and the three numbers are what is read at a glance; the rest waits in a disclosure (open when the fit needs a look)
    const details = h('details', 'xch__what', {},
      h('summary', '', { text: c.al.details }),
      metrics,
      h('p', 'xch__small', { text: fmt(app.lang, c.al.visible, { pct: Math.round(r.visible * 100) }) }),
      help,
      h('p', 'xch__small', { text: `${c.al.method}: ${c.al.methods[r.method]}` }),
      table);
    details.open = status === 'weak' || status === 'failed';
    box.replaceChildren(...([
      h('div', 'xch__row', {}, chip),
      // a good or acceptable fit is the chip alone (Fernando, 2026-11-13); what to do about a weak one is said
      status === 'good' || status === 'acceptable' ? null : h('p', 'xch__small', { text: explain }),
      failed ? h('p', 'xch__label', { text: c.al.lastAttempt }) : null,
      flags.length ? h('ul', 'xch__flags', {}, ...flags) : null,
      details,
    ].filter(Boolean) as Node[]));
    app.motion.chip(chip);
    app.motion.rows(rows);
    const guided = q<HTMLElement>(this.pane4, '[data-align="guided"]');
    guided.classList.toggle('btn--primary', failed);
    guided.classList.toggle('btn--outline', !failed);
  }

  private renderGuided(g: Guided): void {
    const app = this.app, c = app.c;
    const list = q(this.pane4, '[data-list="guided"]');
    fill(list, g.targets.map((site, i) => {
      const placed = !!g.pairs[i], now = i === g.idx, skipped = g.skipped.has(i);
      const li = h('li', placed ? 'is-placed' : now ? 'is-now' : '', {}, h('span', 'xch__gpnum', { text: String(i + 1) }), h('span', 'xch__rowlabel', { text: site.label }),
        h('span', 'xch__gpstate', { text: placed ? `✓ ${c.gp.placed}` : now ? `● ${c.gp.now}` : skipped ? c.gp.skipped : `○ ${c.gp.next}` }));
      if (skipped) {
        const undo = h('button', 'xch__textbtn', { type: 'button', text: c.gp.unskip });
        undo.addEventListener('click', () => this.guidedAction(`unskip:${i}`));
        li.append(undo);
      }
      if (placed) {
        const redo = h('button', 'xch__textbtn', { type: 'button', text: c.gp.redo });
        redo.addEventListener('click', () => this.guidedAction(`redo:${i}`));
        li.append(redo);
      }
      return li;
    }));
    const alignBtn = q(this.pane4, '[data-gp="align"]');
    alignBtn.textContent = app.plural(c.gp.align, g.order.length);
    alignBtn.setAttribute('aria-disabled', String(!this.canAlignGuided()));
    q(this.pane4, '[data-gp="back"]').setAttribute('aria-disabled', String(!g.order.length));
    const note = q(this.pane4, '[data-gp-note]');
    const n = g.order.length;
    // only when that many points is what the alignment will actually use
    const few = n > 0 && n < 3 && this.canAlignGuided();
    note.hidden = !few;
    note.textContent = few ? (n === 1 ? c.gp.one : c.gp.two) : '';
  }

  /** "the bodies in the file" or geometry names, once each, in order. */
  private bodyNames(bodies: readonly (string | undefined)[]): string {
    const app = this.app;
    return [...new Set(bodies.flatMap((b) => (b === undefined ? [] : [b === CAPTURE_BODY_ID ? app.c.s2.fileBodies : app.geometryName(b)])))].join(', ');
  }

  private renderExport(): void {
    const app = this.app, s = app.s, c = app.c;
    const jaw = !!s.jaw;
    const sites = activeSites(s);
    const a = jaw ? s.alignment : null;
    const warns: string[] = [];
    if (a?.status === 'weak' || a?.status === 'failed') warns.push(c.ex.warnWeak);
    if (a?.status === 'ambiguous') warns.push(c.ex.warnAmbiguous);
    if (a?.method === 'manual') warns.push(c.ex.warnManual);
    const prov = sites.filter((x) => x.flags.provisional).length;
    if (prov) warns.push(app.plural(c.ex.warnProvisional, prov));
    if (sites.some((x) => x.flags.indexAmbiguous)) warns.push(c.ex.warnRotation);
    fill(q(this.pane4, '[data-ex-warn]'), warns.map((t) => h('li', '', {}, icon('warn', 16), t)));
    const blocker = exportBlocker(s);
    const reason = blocker === 'geometry' ? app.plural(c.s2.need, missingGeometry(s)) : blocker === 'notAligned' ? `${c.ui.notAligned.t} ${c.ui.notAligned.b}` : blocker === 'measuring' ? c.al.measuring : '';
    q(this.pane4, '[data-reason="4"]').textContent = reason;
    const btn = q(this.pane4, '[data-export]');
    if (!btn.classList.contains('is-busy')) btn.setAttribute('aria-disabled', String(!!blocker));
    if (!s.exportedSinceChange && this.exportUrl) { const u = this.exportUrl; this.exportUrl = null; app.later(() => revokeUrl(u), 1000); this.exportLine = ''; }
    const last = q(this.pane4, '[data-ex-last]');
    last.hidden = !this.exportLine;
    q(last, 'span').textContent = this.exportLine;
  }

  /** New implant frames (a detection in step 1): an alignment or measurement still running would be for the old ones. */
  stopAligning(): void {
    this.alignJob?.abort();
    this.alignJob = null;
    this.stopMeasure();
    this.leaveGuided(false);
    this.alignedResult = null;
  }

  /** Cancels every running alignment or measurement (new case, dispose). */
  cancelAll(): void {
    this.alignJob?.abort();
    this.alignJob = null;
    this.jawJob?.abort();
    this.stopMeasure();
    this.leaveGuided(false);
  }

  /** A new case (App.resetCase): nothing of the previous jaw or result stays. */
  resetCase(): void {
    this.cancelAll();
    if (this.jawLoaded) { this.jawLoaded = false; this.app.align.clearJaw(); }
    this.jawWarnings = [];
    this.ownJaw = false;
    this.alignedResult = null;
    this.sampleJaw = null;
    this.mapShown = false;
    this.resultKey = null;
  }

  dispose(): void {
    this.cancelAll();
    clearTimeout(this.measureTimer);
    this.exportUrl = null; // App.dispose revokes every blob URL (files.ts)
  }

  /** Brings the export section into view (skip link). */
  focusExport(): void {
    const el = q(this.pane4, '#xch-export');
    bringIntoView(el);
    el.focus({ preventScroll: true });
  }
}

const boundsCache = new WeakMap<object, number>();
function computeBoundsCached(mesh: { positions: Float32Array }): number {
  let d = boundsCache.get(mesh);
  if (d === undefined) {
    const b = computeBounds(mesh as never);
    d = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    boundsCache.set(mesh, d);
  }
  return d;
}
