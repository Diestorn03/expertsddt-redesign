/**
 * Step 2 · Replacement geometry and "Your geometries" (UI-DESIGN §5.4, §7). Picking a geometry applies it at
 * once (client request: no "use selected" button), to all implants or to the selected one, with an Undo toast;
 * a pick for all auto-advances to step 3 after .6 s.
 */
import { computeVertexNormals } from '../core/mesh';
import type { TriMesh } from '../core/types';
import { activeSites, missingGeometry, type CaseGeometry } from '../state/case';
import { UiError, type GeometryResult } from '../state/jobs-handler';
import { LibraryError, matchesQuery, type GeometryMeta } from '../state/library';
import type { App } from './app';
import { dropZone } from './step-capture';
import { fill, fillKeep, h, icon, pickFiles, q, radiogroup, setChecked } from './dom';
import { noteCard } from './feedback';
import { ACCEPT, buffersOf, download, readFiles } from './files';
import { fmt, num, warningMessage } from './i18n/format';

type ListMode = 'apply' | 'reference';
let assemblies = 0;

export class GeometryStep {
  target: 'all' | 'one' = 'all';
  private readonly pane: HTMLElement;
  private renaming: string | null = null;
  private removing: string | null = null;
  private query = '';
  private notes: HTMLElement[] = [];
  private libUrl: string | null = null;

  constructor(private readonly app: App) {
    const { root, signal } = app;
    this.pane = q(root, '[data-pane="2"]');
    radiogroup(q(this.pane, '[data-apply-group]'), (b) => {
      this.target = b.dataset.apply === 'one' ? 'one' : 'all';
      if (this.target === 'all') app.select(null);
      else app.render();
    }, signal);
    q(this.pane, '[data-pick="geometry"]').addEventListener('click', () => void this.loadFromPicker('apply'), { signal });
    dropZone(q(this.pane, '.xch__library'), (files) => void this.loadFile(files[0]!, 'apply'), signal);
    const menuBtn = q(this.pane, '[data-lib-menu]'), menu = q(this.pane, '#xch-libmenu');
    const closeMenu = (): void => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };
    menuBtn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); if (open) q(menu, 'button').focus(); }, { signal });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); menuBtn.focus(); } }, { signal });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.parentElement!.contains(e.target as Node)) closeMenu(); }, { signal });
    q(menu, '[data-lib-import]').addEventListener('click', () => { closeMenu(); void this.importLibrary(); }, { signal });
    q(menu, '[data-lib-export]').addEventListener('click', () => { closeMenu(); void this.exportLibrary(); }, { signal });
    q<HTMLInputElement>(this.pane, '[data-lib-filter] input').addEventListener('input', (e) => { this.query = (e.target as HTMLInputElement).value; this.render(); }, { signal });
    if (!app.library.persistent) {
      const m = app.c.ui.storageUnavailable;
      this.notes.push(noteCard(`${m.t} ${m.b}`, 'info'));
    }
  }

  async loadFromPicker(mode: ListMode): Promise<void> {
    const files = await pickFiles(ACCEPT.geometry, false);
    if (files[0]) await this.loadFile(files[0], mode);
  }

  /** parseMesh(…, 'geometry') + planAssembly in the jobs worker, then the plan decides (§5.4 table). */
  async loadFile(file: File, mode: ListMode): Promise<void> {
    const app = this.app, step = mode === 'reference' ? 1 : 2;
    app.clearAlerts(step);
    const busy = app.busy(mode === 'reference' ? '1' : 'lib', app.c.lib.saving);
    let r: GeometryResult;
    try {
      const [input] = await readFiles([file]);
      const sites = mode === 'apply' ? activeSites(app.s) : [];
      r = await app.jobs.run<GeometryResult>({ type: 'readGeometry', file: input!, sites, captureMesh: mode === 'apply' ? app.s.captureMesh ?? undefined : undefined }, buffersOf([input!]));
    } catch (e) {
      app.error(step, e, 'geometry');
      return;
    } finally {
      busy.done();
    }
    const c = app.c;
    if (mode === 'apply') this.notes = [...this.notes.filter((n) => !n.dataset.warn), ...r.warnings.map((w) => { const n = noteCard(warningMessage(c, app.lang, w, 'geometry')); n.dataset.warn = '1'; return n; })];
    if (r.plan.kind === 'countMismatch') {
      app.error(step, new UiError('assemblyCount'), 'geometry', { vars: { bodies: r.plan.bodies, sites: r.plan.sites } });
      return;
    }
    if (r.plan.kind === 'fixed') {
      const group = `asm-${++assemblies}`;
      const caseGeometries = new Map(app.s.caseGeometries);
      const geometryBySite = { ...app.s.geometryBySite };
      for (const [siteId, mesh] of Object.entries(r.plan.meshBySite)) {
        const id = `${group}-${siteId}`;
        caseGeometries.set(id, { id, name: `${c.lib.assemblyBadge} ${assemblies}`, mesh, kind: 'assembly', group });
        geometryBySite[siteId] = id;
      }
      this.notes = this.notes.filter((n) => !n.dataset.plan);
      const note = noteCard(c.s2.assemblyFixed, 'info');
      note.dataset.plan = '1';
      this.notes.push(note);
      if (r.layoutCompatible === false) { const w = noteCard(c.s2.layoutMismatch); w.dataset.plan = '1'; this.notes.push(w); }
      this.commit(geometryBySite, caseGeometries, `${c.lib.assemblyBadge} ${assemblies}`, true);
      return;
    }
    const mesh = r.plan.kind === 'normalized' ? r.plan.mesh : r.mesh;
    if (r.plan.kind === 'normalized') {
      this.notes = this.notes.filter((n) => !n.dataset.plan);
      const note = noteCard(fmt(app.lang, c.s2.assemblyNormalized, { um: Math.round(r.plan.maxDeviationMm * 1000) }), 'info');
      note.dataset.plan = '1';
      this.notes.push(note);
      this.target = 'all';
    }
    this.askName(mode, mesh, r.plan.kind === 'normalized' ? undefined : r.normals);
  }

  /** Inline name field (Enter saves, Esc cancels); the name never comes from the file. */
  private askName(mode: ListMode, mesh: TriMesh, normals: Float32Array | undefined): void {
    const app = this.app, c = app.c;
    const box = q(app.root, `[data-namefield="${mode === 'reference' ? 'reference' : 'geometry'}"]`);
    const input = h('input', '', { type: 'text', maxlength: 60, value: fmt(app.lang, c.lib.nameDefault, { n: app.library.size + 1 }), 'aria-describedby': 'xch-namehint' });
    const save = h('button', 'btn btn--primary xch-btn-sm', { type: 'submit', text: c.lib.save });
    const cancel = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.lib.cancel });
    const form = h('form', 'xch__field', {}, h('label', 'xch__field', {}, c.lib.nameLabel, input), h('small', '', { id: 'xch-namehint', text: c.lib.nameHint }), h('div', 'cta-row', {}, save, cancel));
    cancel.addEventListener('click', () => box.replaceChildren());
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); box.replaceChildren(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const meta = await app.library.add(input.value, mesh);
        box.replaceChildren();
        app.meshCache.set(meta.id, { mesh, normals: normals ?? computeVertexNormals(mesh) });
        this.thumbnail(meta.id);
        app.toasts.show(fmt(app.lang, c.say.saved, { name: meta.name }));
        if (mode === 'reference') void app.capture.detect(meta.id);
        else await this.apply(meta.id);
      } catch (err) {
        if (err instanceof LibraryError && err.code === 'nameEmpty') { input.focus(); return; }
        app.error(mode === 'reference' ? 1 : 2, err, 'geometry', { vars: { limit: 50 } });
      }
    });
    box.replaceChildren(form);
    app.motion.appear(form);
    input.focus();
    input.select();
  }

  private thumbnail(id: string): void {
    const app = this.app;
    requestAnimationFrame(() => {
      const data = app.meshData(id);
      if (!data || !app.viewer || app.signal.aborted) return;
      const png = app.viewer.thumbnail(data.mesh, data.normals);
      if (png) void app.library.setThumbnail(id, png).then(() => app.render());
    });
  }

  /** Apply on pick. A positioned assembly always applies to all implants. */
  async apply(geometryId: string): Promise<void> {
    const app = this.app, s = app.s;
    const data = await app.loadGeometry(geometryId);
    if (!data) return;
    const one = this.target === 'one' && app.selected && !s.excluded.has(app.selected);
    const targets = one ? [app.selected!] : activeSites(s).map((x) => x.id);
    const geometryBySite = { ...s.geometryBySite };
    for (const t of targets) geometryBySite[t] = geometryId;
    const name = app.geometryName(geometryId);
    const label = one ? s.sites.find((x) => x.id === app.selected)?.label ?? '' : '';
    this.commit(geometryBySite, s.caseGeometries, name, !one, label);
  }

  private commit(geometryBySite: Record<string, string>, caseGeometries: Map<string, CaseGeometry>, name: string, all: boolean, label = ''): void {
    const app = this.app, c = app.c;
    const prev = { geometryBySite: app.s.geometryBySite, caseGeometries: app.s.caseGeometries };
    const changed = Object.keys(geometryBySite).filter((k) => geometryBySite[k] !== prev.geometryBySite[k]);
    app.store.set({ geometryBySite, caseGeometries, exportedSinceChange: false });
    app.syncSites(changed);
    app.alignStep.onGeometryChanged();
    const target = all ? c.lib.targetAll : fmt(app.lang, c.lib.targetOne, { label });
    const text = fmt(app.lang, c.say.applied, { name, target });
    let advanced = false;
    app.toasts.show(text, {
      label: c.say.undo,
      run: () => {
        app.store.set({ ...prev, exportedSinceChange: false });
        app.syncSites();
        app.alignStep.onGeometryChanged();
        if (advanced) app.go(2);
        app.say.say(c.say.undone);
      },
    });
    app.say.say(text);
    if (all && missingGeometry(app.s) === 0) app.later(() => { if (app.shown === 2) { advanced = true; app.go(3); } }, 600);
  }

  /* ---------------- library list ---------------- */

  renderList(container: HTMLElement, mode: ListMode): void {
    const app = this.app, c = app.c, s = app.s;
    const metas = app.library.list().filter((m) => !this.query || matchesQuery(m.name, this.query));
    const used = (id: string): number => Object.values(s.geometryBySite).filter((g) => g === id).length;
    const target = this.target === 'one' && app.selected ? fmt(app.lang, c.lib.targetOne, { label: s.sites.find((x) => x.id === app.selected)?.label ?? '' }) : c.lib.targetAll;
    const actionName = (name: string): string => (mode === 'reference' ? fmt(app.lang, c.s1.refUse, { name }) : fmt(app.lang, c.lib.apply, { name, target }));
    const nodes: Node[] = [];
    const group = (title: string, rows: HTMLElement[]): void => {
      if (!rows.length) return;
      nodes.push(h('p', 'xch__libgroup', { text: title }), h('ul', 'xch__lib', { 'data-lenis-prevent': true }, ...rows));
    };
    const libRow = (m: GeometryMeta): HTMLElement => {
      if (this.renaming === m.id) return this.renameRow(m);
      if (this.removing === m.id) return this.removeRow(m);
      const pick = (): void => { if (mode === 'reference') void app.capture.detect(m.id); else void this.apply(m.id); };
      const main = this.mainButton(m.id, m.name, fmt(app.lang, c.lib.meta, { triangles: num(app.lang, m.triangles), size: m.extentMm.map((v) => num(app.lang, v, 1)).join(' × ') }), m.thumbnail, actionName(m.name), used(m.id), mode, pick);
      const star = h('button', 'xch__iconbtn', { type: 'button', 'aria-pressed': String(m.favorite), 'aria-label': `${c.lib.favorite}: ${m.name}`, 'data-key': `fav:${m.id}` }, icon('star', 18));
      star.addEventListener('click', async () => {
        await app.library.setFavorite(m.id, !m.favorite);
        app.toasts.show(fmt(app.lang, m.favorite ? c.say.favOff : c.say.favOn, { name: m.name }));
        app.render();
      });
      const li = h('li', 'xch__libitem', {}, main, star);
      if (mode === 'apply') {
        const ren = h('button', 'xch__iconbtn', { type: 'button', 'aria-label': `${c.lib.rename}: ${m.name}`, 'data-key': `ren:${m.id}` }, icon('pencil', 18));
        ren.addEventListener('click', () => { this.renaming = m.id; app.render(); });
        const del = h('button', 'xch__iconbtn', { type: 'button', 'aria-label': `${c.lib.remove}: ${m.name}`, 'data-key': `del:${m.id}` }, icon('trash', 18));
        del.addEventListener('click', () => { this.removing = m.id; app.focusKey = `no:${m.id}`; app.render(); });
        li.append(ren, del);
      }
      return li;
    };
    group(c.lib.favorites, metas.filter((m) => m.favorite).map(libRow));
    group(c.lib.all, metas.filter((m) => !m.favorite).map(libRow));
    if (mode === 'apply') {
      const seen = new Set<string>();
      const rows: HTMLElement[] = [];
      for (const g of s.caseGeometries.values()) {
        if (seen.has(g.group)) continue;
        seen.add(g.group);
        const badge = g.kind === 'sample' ? c.lib.sampleBadge : c.lib.assemblyBadge;
        const meta = g.kind === 'sample' ? c.say.sampleHint : c.s2.assemblyAll;
        const pick = (): void => { if (g.kind === 'assembly') { this.target = 'all'; this.reapplyAssembly(g.group); } else void this.apply(g.id); };
        const usedOn = [...s.caseGeometries.values()].filter((x) => x.group === g.group).reduce((n, x) => n + used(x.id), 0);
        const main = this.mainButton(g.id, g.name, meta, '', actionName(g.name), usedOn, mode, pick, badge);
        rows.push(h('li', 'xch__libitem', {}, main));
      }
      group(c.lib.caseOnly, rows);
    }
    if (!nodes.length) nodes.push(h('p', 'xch__small xch__muted', { text: this.query ? fmt(app.lang, c.lib.noMatch, { query: this.query }) : c.lib.empty }));
    fillKeep(container, nodes, app.focusKey?.startsWith('no:') || app.focusKey?.startsWith('lib:') ? app.focusKey : undefined);
  }

  private mainButton(id: string, name: string, meta: string, thumb: string, label: string, usedOn: number, mode: ListMode, onPick: () => void, badge?: string): HTMLButtonElement {
    const app = this.app;
    const img = thumb ? h('img', '', { src: thumb, alt: '', width: 48, height: 48 }) : icon('pin', 22);
    const text = h('span', 'xch__libtext', {}, h('span', 'xch__libname', { text: name }), h('span', 'xch__libmeta', { text: meta }));
    const btn = h('button', 'xch__libmain', { type: 'button', 'aria-label': label, 'data-key': `lib:${id}` }, h('span', 'xch__thumb', {}, img), text);
    if (badge) text.append(app.chip('info', badge, 'info'));
    if (usedOn && mode === 'apply') text.append(app.chip('ok', app.plural(app.c.lib.used, usedOn), 'check'));
    btn.addEventListener('click', onPick);
    return btn;
  }

  private reapplyAssembly(group: string): void {
    const app = this.app;
    const geometryBySite = { ...app.s.geometryBySite };
    for (const g of app.s.caseGeometries.values()) if (g.group === group) geometryBySite[g.id.slice(group.length + 1)] = g.id;
    this.commit(geometryBySite, app.s.caseGeometries, app.geometryName([...app.s.caseGeometries.values()].find((g) => g.group === group)!.id), true);
  }

  private renameRow(m: GeometryMeta): HTMLElement {
    const app = this.app, c = app.c;
    const input = h('input', '', { type: 'text', maxlength: 60, value: m.name, 'aria-label': c.lib.nameLabel, 'data-key': `name:${m.id}` });
    const form = h('form', 'xch__field', {}, input, h('div', 'cta-row', {}, h('button', 'btn btn--primary xch-btn-sm', { type: 'submit', text: c.lib.save }), h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.lib.cancel, 'data-cancel': true })));
    const done = (): void => { this.renaming = null; app.focusKey = `ren:${m.id}`; app.render(); };
    q(form, '[data-cancel]').addEventListener('click', done);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); done(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const next = await app.library.rename(m.id, input.value);
        app.toasts.show(fmt(app.lang, c.say.renamed, { name: next.name }));
        done();
      } catch { input.focus(); }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
    return h('li', 'xch__libitem', {}, form);
  }

  private removeRow(m: GeometryMeta): HTMLElement {
    const app = this.app, c = app.c;
    const yes = h('button', 'btn btn--primary xch-btn-sm', { type: 'button', text: c.lib.removeYes });
    const no = h('button', 'btn btn--outline xch-btn-sm', { type: 'button', text: c.lib.removeNo, 'data-key': `no:${m.id}` });
    no.addEventListener('click', () => { this.removing = null; app.focusKey = `del:${m.id}`; app.render(); });
    yes.addEventListener('click', async () => {
      const list = app.library.list();
      const nextId = list[list.findIndex((x) => x.id === m.id) + 1]?.id;
      await app.library.remove(m.id); // implants using it keep the cached mesh for this case
      this.removing = null;
      app.focusKey = nextId ? `lib:${nextId}` : null;
      app.toasts.show(fmt(app.lang, c.say.removed, { name: m.name }));
      app.render();
    });
    return h('li', 'xch__libconfirm', { role: 'group' }, h('p', '', { text: fmt(app.lang, c.lib.removeConfirm, { name: m.name }) }), h('div', 'cta-row', {}, yes, no));
  }

  /* ---------------- library file ---------------- */

  private async importLibrary(): Promise<void> {
    const app = this.app, c = app.c;
    const [file] = await pickFiles(ACCEPT.library, false);
    if (!file) return;
    app.clearAlerts(2);
    const busy = app.busy('lib', c.lib.readingFile);
    try {
      const [input] = await readFiles([file]);
      if (input!.bytes.byteLength > 100 * 1024 * 1024) throw new UiError('libraryFileTooLarge');
      const r = await app.jobs.run<{ entries: { name: string; favorite: boolean; mesh: TriMesh }[]; skipped: number }>({ type: 'libraryIn', bytes: input!.bytes }, buffersOf([input!]));
      const res = await app.library.importEntries(r.entries);
      for (const m of res.added) if (await app.loadGeometry(m.id)) this.thumbnail(m.id);
      let text = app.plural(c.say.libImported, res.added.length);
      if (res.renamed) text += ' ' + app.plural(c.say.libRenamed, res.renamed);
      app.toasts.show(text);
      app.say.say(text);
      const skipped = r.skipped + res.skipped;
      if (skipped) this.notes.push(noteCard(app.plural(c.ui.librarySkipped, skipped)));
      app.render();
    } catch (e) {
      app.error(2, e, 'library', { vars: { limit: 100 } });
    } finally {
      busy.done();
    }
  }

  private async exportLibrary(): Promise<void> {
    const app = this.app;
    try {
      const entries = await app.library.entriesForExport();
      const bytes = await app.jobs.run<Uint8Array>({ type: 'libraryOut', entries });
      if (this.libUrl) URL.revokeObjectURL(this.libUrl);
      this.libUrl = download(bytes, 'ddt-xchange-geometries.json', 'application/json');
      app.later(() => { if (this.libUrl) URL.revokeObjectURL(this.libUrl); this.libUrl = null; }, 60_000);
      app.toasts.show(app.c.say.libExported);
    } catch (e) {
      app.error(2, e, 'library');
    }
  }

  render(): void {
    const app = this.app, s = app.s, c = app.c;
    const sel = app.selected ? s.sites.find((x) => x.id === app.selected) : undefined;
    if (!sel && this.target === 'one') this.target = 'all';
    const group = q(this.pane, '[data-apply-group]');
    const all = q(group, '[data-apply="all"]'), one = q(group, '[data-apply="one"]');
    all.textContent = fmt(app.lang, c.s2.all, { count: activeSites(s).length });
    one.textContent = sel ? fmt(app.lang, c.s2.selected, { label: sel.label }) : c.s2.selectedNone;
    one.setAttribute('aria-disabled', String(!sel));
    setChecked(group, this.target, 'data-apply');
    fillKeep(q(this.pane, '[data-list="implants2"]'), app.implantRows(2));
    q(this.pane, '[data-lib-filter]').hidden = app.library.size < 10;
    this.renderList(q(this.pane, '[data-list="lib"]'), 'apply');
    fill(q(this.pane, '[data-notes="2"]'), this.notes);
    const missing = missingGeometry(s);
    q(this.pane, '[data-next="2"]').setAttribute('aria-disabled', String(missing > 0));
    q(this.pane, '[data-reason="2"]').textContent = missing ? app.plural(c.s2.need, missing) : '';
  }

  dispose(): void {
    if (this.libUrl) URL.revokeObjectURL(this.libUrl);
  }
}
