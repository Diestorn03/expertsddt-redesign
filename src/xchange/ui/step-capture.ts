/** Step 1 · Arch and capture (UI-DESIGN §5.3): import pipeline, capture scan body, provisional positions. */
import type { XchangeWarning } from '../core/errors';
import type { Arch, CaptureFormat, ImplantSite } from '../core/types';
import { hasDownstreamWork, pendingProvisional, redetected, step1Blocker } from '../state/case';
import { captureOnly, type CaptureResult, type DetectResult } from '../state/jobs-handler';
import type { App } from './app';
import { fillKeep, h, pickFiles, q, radiogroup, setChecked } from './dom';
import { noteCard } from './feedback';
import { LIMITS } from '../core/limits';
import { ACCEPT, buffersOf, readFiles } from './files';
import { fmt, warningMessage } from './i18n/format';

/** The kind of file a format comes in, for "Use only the CSV file" (a format token, the same in every language). */
export const fileKind = (format: CaptureFormat): string =>
  ({ 'micronmapper-csv': 'CSV', 'scanadaptor-xml': 'XML', 'matrix-table': 'CSV/TXT', 'positions-json': 'JSON', 'matrix-xml': 'XML', 'icam-txt': 'TXT' } as Partial<Record<CaptureFormat, string>>)[format] ?? format.toUpperCase();

export class CaptureStep {
  private readonly pane: HTMLElement;
  /** Warnings of the last import / detection, shown until the next one. */
  private warnings: XchangeWarning[] = [];
  /** A position file and a mesh in different coordinate systems, until the user keeps one of them. */
  private mixed: CaptureResult | null = null;
  private rowsKey = '';
  private job: AbortController | null = null;

  constructor(private readonly app: App) {
    const { root, signal } = app;
    this.pane = q(root, '[data-pane="1"]');
    radiogroup(q(this.pane, '[data-arch-group]'), (b) => void this.chooseArch(b.dataset.arch as Arch, b), signal);
    // the arch cards are the file pickers: drop a file on one and it is that arch's file
    for (const b of this.pane.querySelectorAll<HTMLButtonElement>('[data-arch]')) {
      dropZone(b, (files) => { this.setArch(b.dataset.arch as Arch); void this.importFiles(files, b); }, signal);
    }
    for (const b of this.pane.querySelectorAll<HTMLButtonElement>('[data-pick="capture"]')) {
      b.addEventListener('click', async () => { const files = await pickFiles(ACCEPT.capture, true); if (files.length) void this.importFiles(files, b); }, { signal });
    }
    q(this.pane, '[data-pick="reference"]').addEventListener('click', () => void app.geometry.loadFromPicker('reference'), { signal });
  }

  clearWarnings(): void {
    this.warnings = [];
    this.mixed = null;
  }

  setArch(arch: Arch): void {
    this.app.store.set({ arch });
    if (this.app.viewer) this.app.viewer.arch = arch;
    this.maybeAdvance();
  }

  /** A click on an arch card: with no file yet it opens the picker for that arch; with a file it answers "upper or lower?". */
  private picking = false;
  private async chooseArch(arch: Arch, opener: Element): Promise<void> {
    this.setArch(arch);
    if (this.app.s.sources.length || this.picking) return; // a double click opens one chooser
    this.picking = true;
    try {
      const files = await pickFiles(ACCEPT.capture, true);
      if (files.length) void this.importFiles(files, opener);
    } finally {
      this.picking = false;
    }
  }

  /** A clean capture with its arch known goes straight to step 2; anything that needs a look keeps the user here (UI-DESIGN §5.3). */
  private maybeAdvance(): void {
    const app = this.app;
    app.later(() => {
      const s = app.s;
      if (app.shown !== 1 || step1Blocker(s) !== null || this.mixed || s.unresolved.length || this.warnings.some((w) => w.code === 'MESH_UNITS_SUSPECT')) return;
      app.go(2);
    }, 600);
  }

  /** Reads and parses every file in the jobs worker; an error leaves the case untouched. */
  async importFiles(files: File[], opener: Element | null): Promise<void> {
    const app = this.app;
    app.clearAlerts(1);
    this.job?.abort();
    const job = (this.job = new AbortController());
    const busy = app.busy('1', app.plural(app.c.s1.reading, files.length), () => job.abort());
    app.root.classList.add('is-dim'); // the previous case stays visible, dimmed
    let result: CaptureResult;
    try {
      const inputs = await readFiles(files, LIMITS.capture.maxBytes);
      result = await app.jobs.run<CaptureResult>({ type: 'readCapture', files: inputs }, buffersOf(inputs), job.signal);
    } catch (e) {
      app.error(1, e, 'positions');
      return;
    } finally {
      busy.done();
      app.root.classList.remove('is-dim');
    }
    if (hasDownstreamWork(app.s) && !(await app.confirm('replace', opener))) return;
    const replaced = app.s.sites.length > 0 || !!app.s.captureMesh;
    this.apply(result, false);
    if (replaced) app.toasts.show(app.c.say.captureReplaced);
  }

  /** "The CSV file and the STL file are in different coordinate systems" with [Use only the STL file] [Use only the CSV file]. */
  framesNote(): HTMLElement | null {
    const app = this.app, c = app.c, r = this.mixed;
    if (!r) return null;
    const kinds = { positions: fileKind(r.format), mesh: fileKind(r.sources.find((x) => x.kind === 'mesh')?.format ?? 'stl') };
    const only = (keep: 'positions' | 'mesh'): HTMLElement => {
      const b = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: fmt(app.lang, c.s1.useOnly, { kind: kinds[keep] }) });
      b.addEventListener('click', () => void this.useOnly(keep, b));
      return b;
    };
    return noteCard(fmt(app.lang, c.s1.framesDiffer, kinds), 'warn', h('div', 'cta-row', {}, only('mesh'), only('positions')));
  }

  /** The way out of a position file and a mesh that don't share coordinates: keep only one of them. */
  private async useOnly(keep: 'positions' | 'mesh', opener: Element): Promise<void> {
    const app = this.app, r = this.mixed;
    if (!r) return;
    if (hasDownstreamWork(app.s) && !(await app.confirm('replace', opener))) return;
    const only = captureOnly(r, keep);
    this.apply(only, false);
    app.toasts.show(fmt(app.lang, app.c.say.usingOnly, { kind: fileKind(only.format) }));
    q<HTMLElement>(this.pane, '.xch__h').focus({ preventScroll: true }); // the button that had focus is gone with the note
  }

  /** Installs a parsed capture as the new case. */
  apply(r: CaptureResult, sample: boolean): void {
    const app = this.app;
    app.resetCase(app.s.arch);
    app.componentData = (r.components ?? []).map((c) => ({ mesh: c.shell, normals: c.normals }));
    const mesh = r.mesh ?? null;
    this.warnings = r.warnings;
    this.mixed = r.framesDiffer ? r : null;
    app.store.set({
      sources: r.sources,
      format: sample ? 'demo' : r.format,
      sites: r.sites,
      captureMesh: mesh,
      components: (r.components ?? []).map((c) => c.shell),
      bodies: (r.components ?? []).map((c) => c.mesh),
      needsReference: !!mesh && r.sites.length === 0,
      sample,
    });
    app.stage.setDisplay({ capture: !!mesh });
    app.rebuildViewer();
    app.viewer?.view('occlusal', true);
    if (r.sites.length) app.say.say(app.plural(app.c.say.captureOk, r.sites.length));
    this.rowsKey = '';
    if (mesh && !r.sites.length) void this.identify(mesh);
    else this.maybeAdvance();
  }

  /**
   * A mesh-only capture: every saved geometry is tried as the capture scan body and the one that finds the most bodies
   * is used, so nobody has to know which scan body it was. With no match the list stays for a manual pick.
   */
  private async identify(mesh: NonNullable<CaptureResult['mesh']>): Promise<void> {
    const app = this.app;
    // ponytail: tries up to 12 geometries one after the other (favorites first); a size prefilter if the library grows
    const ids = app.library.list().sort((a, b) => Number(b.favorite) - Number(a.favorite)).slice(0, 12).map((m) => m.id);
    if (!ids.length) return;
    const job = (this.job = new AbortController());
    const busy = app.busy('1', fmt(app.lang, app.c.s1.identifying, { n: 1, total: ids.length }), () => job.abort());
    let best: { id: string; found: number; provisional: number } | null = null;
    try {
      for (const [i, id] of ids.entries()) {
        busy.set(i / ids.length, fmt(app.lang, app.c.s1.identifying, { n: i + 1, total: ids.length }));
        const ref = await app.loadGeometry(id);
        if (!ref) continue;
        const r = await app.jobs.run<DetectResult>({ type: 'detect', mesh, reference: ref.mesh }, [], job.signal);
        const provisional = r.sites.filter((x) => x.flags.provisional).length, found = r.sites.length - provisional;
        if (found > (best?.found ?? 0) || (best && found === best.found && provisional < best.provisional)) best = { id, found, provisional };
        if (found && !provisional && !r.unresolved.length) break; // every body found: no need to try the rest
      }
    } catch {
      return; // cancelled, or a geometry that can't be read: the list stays for a manual pick
    } finally {
      busy.done();
    }
    if (!best || app.s.captureMesh !== mesh) return;
    await this.detect(best.id);
    app.toasts.show(fmt(app.lang, app.c.say.identified, { name: app.geometryName(best.id) }));
  }

  /** Mesh-only capture: fits the picked capture scan body to every body, at once. */
  async detect(referenceId: string): Promise<void> {
    const app = this.app, mesh = app.s.captureMesh;
    if (!mesh) return;
    app.clearAlerts(1);
    const ref = await app.loadGeometry(referenceId);
    if (!ref) return;
    this.job?.abort();
    const job = (this.job = new AbortController());
    const busy = app.busy('1', app.c.s1.detecting, () => job.abort());
    try {
      const r = await app.jobs.run<DetectResult>({ type: 'detect', mesh, reference: ref.mesh }, [], job.signal);
      this.warnings = [...this.warnings.filter((w) => w.code === 'MESH_DEGENERATE_TRIANGLES_DROPPED' || w.code === 'MESH_UNITS_SUSPECT'), ...r.warnings];
      // new frames: nothing made for the old ones survives (state/case redetected); a running alignment would be for them too
      const aligned = app.s.alignment !== null;
      const { patch, dropped } = redetected(app.s, r.sites, r.unresolved);
      for (const id of dropped) app.meshCache.delete(id);
      app.alignStep.stopAligning();
      app.geometry.clearCaseNotes();
      app.store.set({ ...patch, referenceId });
      app.alignStep.applyDeviation();
      app.syncSites();
      if (aligned) app.toasts.show(app.c.say.realign);
      app.viewer?.view('occlusal');
      const provisional = r.sites.filter((s) => s.flags.provisional).length;
      const d = app.c.say.detected, parts = { found: r.sites.length - provisional, provisional, unresolved: r.unresolved.length };
      // zero parts are left out (UI-DESIGN §12.7); "found" is always said
      this.maybeAdvance();
      app.say.say((['found', 'provisional', 'unresolved'] as const).filter((k) => k === 'found' || parts[k] > 0).map((k) => fmt(app.lang, d[k], parts)).join(' '));
      this.rowsKey = '';
    } catch (e) {
      app.error(1, e, 'geometry');
    } finally {
      busy.done();
    }
  }

  leaveOut(id: string): void {
    const excluded = new Set(this.app.s.excluded).add(id);
    const geometryBySite = { ...this.app.s.geometryBySite };
    delete geometryBySite[id];
    this.app.focusKey = `undo:${id}`;
    this.app.store.set({ excluded, geometryBySite, exportedSinceChange: false });
    this.app.syncSites();
  }

  include(id: string): void {
    const excluded = new Set(this.app.s.excluded);
    excluded.delete(id);
    this.app.focusKey = `row:${id}`;
    this.app.store.set({ excluded, exportedSinceChange: false });
    this.app.syncSites();
  }

  private confirmAll(): void {
    const confirmed = new Set(this.app.s.confirmed);
    for (const s of pendingProvisional(this.app.s)) confirmed.add(s.id);
    this.app.store.set({ confirmed });
  }

  render(): void {
    const app = this.app, s = app.s, c = app.c;
    setChecked(q(this.pane, '[data-arch-group]'), s.arch, 'data-arch');
    const hasCapture = s.sources.length > 0;
    const asking = hasCapture && !s.arch; // a file came in before the arch was picked
    q(this.pane, '[data-arch-label]').textContent = asking ? c.s1.archAsk : c.s1.arch;
    q(this.pane, '[data-arch-group]').parentElement?.classList.toggle('is-asking', asking);
    q(this.pane, '[data-formats="1"]').hidden = hasCapture;
    q(this.pane, '[data-sources]').hidden = !hasCapture;
    fillKeep(q(this.pane, '[data-list="sources"]'), s.sources.map((src) => {
      const fmtName = (c.format as Record<string, string>)[src.format] ?? src.format;
      const text = src.kind === 'mesh' ? app.plural(c.s1.sourceMesh, src.count, { format: fmtName }) : app.plural(c.s1.sourcePositions, src.count, { format: fmtName });
      return h('li', 'xch__src', {}, h('span', '', { text }), s.sample ? app.chip('info', c.s1.sampleChip, 'info') : null);
    }));
    const ref = q(this.pane, '[data-ref]');
    ref.hidden = !s.captureMesh || (!s.needsReference && !s.referenceId);
    if (!ref.hidden) app.geometry.renderList(q(ref, '[data-list="ref"]'), 'reference');

    // notes: warnings, unresolved bodies, round bodies, provisional banner
    const notes: HTMLElement[] = this.warnings.filter((w) => w.code !== 'SITE_INDEX_AMBIGUOUS').map((w) => noteCard(warningMessage(c, app.lang, w, s.captureMesh ? 'capture' : 'positions')));
    const frames = this.framesNote();
    if (frames) notes.unshift(frames);
    if (s.unresolved.length) notes.push(noteCard(app.plural(c.s1.unresolved, s.unresolved.length, { list: s.unresolved.map((i) => i + 1).join(', ') })));
    const prov = pendingProvisional(s);
    if (prov.length) {
      const show = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.s1.provShow });
      show.addEventListener('click', () => { app.viewer?.fit(prov.map((x) => x.id)); app.viewer?.pulseSites(prov.map((x) => x.id)); });
      const ok = h('button', 'btn btn--primary xch-btn-sm', { type: 'button', text: c.s1.provConfirm });
      ok.addEventListener('click', () => this.confirmAll());
      notes.unshift(noteCard(app.plural(c.s1.provTitle, prov.length), 'warn', h('p', 'xch__small', { text: c.s1.provText }), h('div', 'cta-row', {}, show, ok)));
    }
    q(this.pane, '[data-notes="1"]').replaceChildren(...notes);

    const wrap = q(this.pane, '[data-implants-wrap="1"]');
    wrap.hidden = s.sites.length === 0;
    q(this.pane, '[data-implant-count="1"]').textContent = s.sites.length ? `· ${app.plural(c.s1.implantCount, s.sites.length - s.excluded.size)}` : '';
    const list = q(this.pane, '[data-list="implants1"]');
    fillKeep(list, app.implantRows(1), app.focusKey);
    const key = s.sites.map((x: ImplantSite) => x.id).join();
    if (key !== this.rowsKey) { this.rowsKey = key; app.motion.rows(list.children); }

    const blocker = step1Blocker(s);
    const next = q<HTMLButtonElement>(this.pane, '[data-next="1"]');
    next.setAttribute('aria-disabled', String(blocker !== null));
    q(this.pane, '[data-reason="1"]').textContent = blocker ? c.s1[blocker] : '';
  }
}

/** Drop zone: highlight while dragging over, hand the files over on drop. The button inside is the real control. */
export function dropZone(el: HTMLElement, onFiles: (files: File[]) => void, signal: AbortSignal): void {
  let depth = 0;
  el.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; el.classList.add('is-over'); }, { signal });
  el.addEventListener('dragover', (e) => e.preventDefault(), { signal });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('is-over'); } }, { signal });
  el.addEventListener('drop', (e) => {
    e.preventDefault(); // tells the workspace-wide handler (stage.ts) that this drop is taken
    depth = 0;
    el.classList.remove('is-over');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  }, { signal });
}
