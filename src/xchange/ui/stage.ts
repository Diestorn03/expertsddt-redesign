/**
 * Stage chrome (UI-DESIGN §6.2-§6.8): toolbar, display and section popovers, adjust pad, legend, readout, drop overlay,
 * and the distance tool's state (VIEWER-POLISH B3; the viewer draws it).
 */
import type { Mat4, Vec3 } from '../core/types';
import { distance } from '../core/vec3';
import { shownDeviation, type Step } from '../state/case';
import type { Preset } from '../viewer/presets';
import { DEFAULT_DISPLAY, type DisplayOptions, type PartHit, type SceneObject, type Section } from '../viewer/viewer';
import type { App } from './app';
import { q, qa, roving } from './dom';
import { openModal } from './feedback';
import { fmt, num, type Lang } from './i18n/format';

const VIEW_KEY = 'ddt-xchange:view';

/** B3's value: the straight-line distance in mm with two decimals, in the page language ("12.34", "12,34"). */
export const distanceMm = (lang: Lang, a: Vec3, b: Vec3): string => num(lang, distance(a, b), 2);

function loadView(): Partial<DisplayOptions> {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { fovDeg?: unknown; speed?: unknown };
    const out: Partial<DisplayOptions> = {};
    if (typeof v.fovDeg === 'number' && v.fovDeg >= 1 && v.fovDeg <= 60) out.fovDeg = v.fovDeg;
    if (typeof v.speed === 'number' && v.speed >= 1 && v.speed <= 5) out.speed = v.speed;
    return out;
  } catch {
    return {};
  }
}

export class Stage {
  display: DisplayOptions = { ...DEFAULT_DISPLAY, ...loadView() };
  readonly el: HTMLElement;
  private readonly pop: HTMLElement;
  private readonly popBtn: HTMLElement;
  private lastJawOpacity = 0.3;
  private pressed: string | null = null;
  private readonly hidden = new Set<'jaw' | 'parts' | 'capture'>();
  private readonly secPop: HTMLElement;
  private readonly secBtn: HTMLElement;
  /** B2: the cut as its popover shows it (`r`: the slider's half-range, mm); null while there is none. */
  private section: (Section & { r: number }) | null = null;
  /** B3: the distance points and the implant-set pose they were taken on; null while the tool is off. */
  private measure: { points: Vec3[]; pose: Mat4 } | null = null;
  /** The adjust pad's Fine toggle: every click steps 5° · 0.1 mm, as with Shift. */
  private fine = false;

  constructor(private readonly app: App) {
    const { root, signal } = app;
    this.el = q(root, '.xch__stage');
    this.pop = q(this.el, '[data-display]');
    this.popBtn = q(this.el, '[data-display-btn]');
    this.secPop = q(this.el, '[data-section]');
    this.secBtn = q(this.el, '[data-section-btn]');
    roving(q(this.el, '.xch__toolbar'), signal);
    roving(q(this.el, '.xch__views'), signal);
    // Enter or Space on a view button (a click with detail 0) is announced, as a view key is; a mouse click is not
    for (const b of qa<HTMLButtonElement>(this.el, '[data-view]')) b.addEventListener('click', (e) => this.preset(b.dataset.view as Preset | 'fit', e.detail === 0), { signal });
    // the icon bar's direct toggles take the keys' path (C, T), so the legend follows the map
    const enabled = (e: Event): boolean => (e.currentTarget as Element).getAttribute('aria-disabled') !== 'true';
    q(this.el, '[data-map-btn]').addEventListener('click', (e) => { if (enabled(e)) this.toggleMap(); }, { signal });
    q(this.el, '[data-xray-btn]').addEventListener('click', (e) => { if (enabled(e)) this.toggleJawOpacity(); }, { signal });
    this.wirePopover(this.pop, this.popBtn);
    this.wirePopover(this.secPop, this.secBtn);
    this.popBtn.addEventListener('click', () => this.togglePopover(this.pop, this.popBtn), { signal });
    // the Section button opens its popover and turns the cut on if it was off; closing the popover keeps the cut (exocad)
    this.secBtn.addEventListener('click', (e) => {
      if (!enabled(e)) return; // nothing to cut yet
      if (this.secPop.hidden && !this.section) this.toggleSection();
      this.togglePopover(this.secPop, this.secBtn);
    }, { signal });
    const range = q<HTMLInputElement>(this.secPop, '[data-section-range]');
    range.addEventListener('input', () => this.changeSection({ offset: Number(range.value) }), { signal });
    for (const sw of qa<HTMLButtonElement>(this.secPop, '[data-section-switch]')) {
      const key = sw.dataset.sectionSwitch as 'flipped' | 'follow';
      sw.addEventListener('click', () => this.changeSection({ [key]: !this.section?.[key] }), { signal });
    }
    q(this.secPop, '[data-section-off]').addEventListener('click', () => { this.toggleSection(); this.togglePopover(this.secPop, this.secBtn, false); }, { signal });
    q(this.el, '[data-dist-btn]').addEventListener('click', (e) => {
      if (!enabled(e)) { if (app.alignStep?.guided) app.say.say(app.c.dist.busy); return; }
      this.toggleMeasure();
      // the tool works in the 3D view (Enter at the crosshair, Backspace, Esc, R): the keyboard goes there with it, as the
      // Section button takes it into its popover; a pointer click focuses the view too, where the crosshair stays hidden
      if (this.measuring) this.el.focus({ preventScroll: true });
    }, { signal });
    for (const sw of qa<HTMLButtonElement>(this.pop, '[data-switch]')) {
      sw.addEventListener('click', () => {
        if (sw.getAttribute('aria-disabled') === 'true') return;
        const key = sw.dataset.switch as keyof DisplayOptions;
        this.setDisplay({ [key]: !this.display[key] } as Partial<DisplayOptions>);
      }, { signal });
    }
    for (const r of qa<HTMLInputElement>(this.pop, '[data-range]')) {
      r.addEventListener('input', () => {
        const key = r.dataset.range as 'jawOpacity' | 'partOpacity' | 'fovDeg' | 'speed';
        const v = Number(r.value);
        this.setDisplay({ [key]: key.endsWith('Opacity') ? v / 100 : v } as Partial<DisplayOptions>);
        if (key === 'fovDeg') app.viewer?.fit(undefined, true);
        if (key === 'fovDeg' || key === 'speed') { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ fovDeg: this.display.fovDeg, speed: this.display.speed })); } catch { /* per-viewer convenience only */ } }
      }, { signal });
    }
    const keys = q<HTMLDialogElement>(app.section, '#xch-keys');
    q(this.el, '[data-keys-btn]').addEventListener('click', (e) => openModal(keys, e.currentTarget as Element), { signal });
    for (const b of qa(keys, '[data-close]')) b.addEventListener('click', () => keys.close(), { signal });
    keys.addEventListener('click', (e) => { if (e.target === keys) keys.close(); }, { signal });
    const fs = q<HTMLButtonElement>(this.el, '[data-fs-btn]');
    fs.hidden = !document.fullscreenEnabled;
    fs.addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void this.el.requestFullscreen?.(); }, { signal });
    document.addEventListener('fullscreenchange', () => {
      const on = !!document.fullscreenElement, name = on ? fs.dataset.on! : fs.dataset.off!;
      fs.setAttribute('aria-label', name);
      fs.dataset.tip = name;
      fs.classList.toggle('is-on', on);
    }, { signal });
    // icon tooltips (CSS, data-tip): Esc hides the one showing until the pointer or focus leaves it (WCAG 1.4.13)
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const t of qa(this.el, '[data-tip]:hover, [data-tip]:focus-visible')) t.classList.add('is-tipoff'); }, { signal });
    const tipBack = (e: Event): void => {
      const t = (e.target as Element).closest?.('[data-tip]'), to = (e as FocusEvent).relatedTarget as Node | null;
      if (t && !(to && t.contains(to))) t.classList.remove('is-tipoff');
    };
    this.el.addEventListener('pointerout', tipBack, { signal });
    this.el.addEventListener('focusout', tipBack, { signal });
    const pad = q(this.el, '[data-pad]');
    roving(pad, signal);
    for (const b of qa<HTMLButtonElement>(pad, '[data-pad-op]')) b.addEventListener('click', (e) => app.alignStep.pad(b.dataset.padOp!, Number(b.dataset.padDir), e.shiftKey || this.fine), { signal });
    // Fine: 5° · 0.1 mm per click without Shift (a tablet has none; neither has a screen reader's click)
    q(pad, '[data-pad-fine]').addEventListener('click', () => { this.fine = !this.fine; this.syncPad(); }, { signal });
    q(this.el, '[data-restart]').addEventListener('click', () => { q(this.el, '[data-lost]').hidden = true; app.restartViewer(); }, { signal });
    // handled here on every step (an in-page anchor would go to the router and Lenis, and drop focus)
    const skip = q<HTMLAnchorElement>(root, '[data-skip-view]');
    skip.addEventListener('click', (e) => {
      e.preventDefault();
      if (app.shown === 4) { app.alignStep.focusExport(); return; }
      const help = document.getElementById('xch-help-title');
      if (!help) return;
      document.dispatchEvent(new CustomEvent('scroll-to', { detail: help }));
      help.focus({ preventScroll: true });
    }, { signal });
    this.el.addEventListener('keydown', () => this.el.classList.add('is-keyboard'), { signal });
    this.el.addEventListener('pointerdown', () => this.el.classList.remove('is-keyboard'), { signal });
    this.wireDrop();
    this.syncControls();
  }

  /** Files dragged anywhere over the workspace: the iris overlay of the mobile menu, routed to the current step. */
  private wireDrop(): void {
    const { root, signal, c } = this.app;
    const over = q(this.el, '[data-dropover]');
    let depth = 0;
    const show = (on: boolean, e?: DragEvent): void => {
      if (e) {
        const r = this.el.getBoundingClientRect();
        over.style.setProperty('--dx', `${e.clientX - r.left}px`);
        over.style.setProperty('--dy', `${e.clientY - r.top}px`);
      }
      q(over, 'p').textContent = [c.drop.step1, c.drop.step2, c.drop.step3, c.drop.step4][this.app.shown - 1]!;
      over.classList.toggle('is-on', on);
    };
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files');
    root.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (depth++ === 0) show(true, e); }, { signal });
    root.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); }, { signal });
    root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; show(false); } }, { signal });
    root.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      const taken = e.defaultPrevented; // a panel drop zone already handled it
      e.preventDefault();
      depth = 0;
      show(false);
      if (taken) return;
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const app = this.app;
      if (app.shown === 1) {
        if (app.s.needsReference) void app.geometry.loadFile(files[0]!, 'reference');
        else void app.capture.importFiles(files, null);
      } else if (app.shown === 2) void app.geometry.loadFile(files[0]!, 'apply');
      else if (app.shown === 3) void app.alignStep.loadJaw(files[0]!);
    }, { signal });
  }

  /**
   * Display and Section popovers: non-modal, one open at a time. Esc closes and gives focus back to the button; an outside
   * press closes; focus leaving closes (they cover the adjust pad: nothing focused stays hidden under them).
   */
  private wirePopover(pop: HTMLElement, btn: HTMLElement): void {
    const { signal } = this.app;
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.togglePopover(pop, btn, false); return; }
      // Tab from the last control: the popover closes and focus goes on to the views dial, next in order. The Display
      // menu hides the dial while open (it covers it), so the browser's own next stop would be off the stage
      if (e.key !== 'Tab' || e.shiftKey) return;
      const all = qa<HTMLElement>(pop, 'button, input').filter((x) => !x.hidden);
      const dial = qa<HTMLElement>(this.el, '.xch__views button').find((b) => b.tabIndex === 0);
      if (e.target !== all[all.length - 1] || !dial) return;
      e.preventDefault();
      this.togglePopover(pop, btn, false, false);
      dial.focus();
    }, { signal });
    pop.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !pop.contains(to) && !btn.contains(to)) this.togglePopover(pop, btn, false, false);
    }, { signal });
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) this.togglePopover(pop, btn, false, false); }, { signal });
  }

  private togglePopover(pop: HTMLElement, btn: HTMLElement, open = pop.hidden, focusBack = true): void {
    if (open) for (const [p, b] of [[this.pop, this.popBtn], [this.secPop, this.secBtn]] as const) if (p !== pop && !p.hidden) this.togglePopover(p, b, false, false);
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) q<HTMLElement>(pop, 'button, input').focus();
    else if (focusBack) btn.focus();
  }

  setDisplay(patch: Partial<DisplayOptions>): void {
    this.display = { ...this.display, ...patch };
    this.app.viewer?.setDisplay(this.display);
    this.syncControls();
  }

  /** Every control that mirrors the display options, the legend included: whatever changed the map (C, the map button, the Display switch), the legend follows. */
  private syncControls(): void {
    const d = this.display, app = this.app, c = app.c;
    // what the viewer can draw: a part exchanged after the alignment has no map (state/case shownDeviation)
    const drawable = !!app.s && !!shownDeviation(app.s);
    const mapped = d.map && drawable;
    q(this.el, '[data-legend]').hidden = !mapped;
    const map = q(this.el, '[data-map-btn]'), xray = q(this.el, '[data-xray-btn]');
    map.setAttribute('aria-pressed', String(mapped));
    map.setAttribute('aria-disabled', String(!drawable));
    xray.setAttribute('aria-pressed', String(d.jawOpacity < 1));
    xray.setAttribute('aria-disabled', String(!app.s?.jaw));
    for (const sw of qa(this.pop, '[data-switch]')) {
      const key = sw.dataset.switch as keyof DisplayOptions;
      sw.setAttribute('aria-checked', String(!!d[key]));
      if (key === 'jawColor') sw.hidden = !app.viewer?.hasJawColors;
      if (key === 'map') sw.setAttribute('aria-disabled', String(!drawable));
      if (key === 'capture') sw.hidden = !app.s?.components.length;
    }
    for (const r of qa<HTMLInputElement>(this.pop, '[data-range]')) {
      const key = r.dataset.range as 'jawOpacity' | 'partOpacity' | 'fovDeg' | 'speed';
      const v = d[key];
      r.value = String(key.endsWith('Opacity') ? Math.round(v * 100) : v);
      const text = key.endsWith('Opacity') ? `${num(app.lang, Math.round(v * 100))} %` : key === 'fovDeg' ? `${v}°` : fmt(app.lang, c.display.speedValue, { n: v });
      r.setAttribute('aria-valuetext', text);
      q(r.parentElement!, 'output').textContent = text;
    }
  }

  /** Refreshes overlays from the case. */
  update(): void {
    const app = this.app, s = app.s;
    if (!s) return;
    // any change of the implant-set pose (undo, reset, alignment) ends the distance tool: no number of a pose you no longer see
    if (this.measure && s.assembly !== this.measure.pose) { this.endMeasure(); return; }
    const any = this.hasContent;
    q(this.el, '[data-empty]').hidden = any && !!app.viewer;
    q(this.el, '[data-pad]').hidden = !(app.shown === 4 && s.jaw && !app.alignStep?.guided && !this.measure);
    // nothing shown: nothing to cut or measure (as the map and the transparency wait for a measurement and a jaw)
    q(this.el, '[data-section-btn]').setAttribute('aria-disabled', String(!any));
    // no distance during guided points: the button says why
    const dist = q(this.el, '[data-dist-btn]'), busy = !!app.alignStep?.guided;
    dist.setAttribute('aria-disabled', String(busy || !any));
    dist.setAttribute('data-tip', busy ? app.c.dist.busy : fmt(app.lang, app.c.view.tip, { name: app.c.dist.button, key: 'R' }));
    // what is shown grew since the cut started (a jaw after a cut in step 2): the slider reaches it
    const reach = this.section ? app.viewer?.sectionReach?.() ?? 0 : 0;
    if (this.section && reach > this.section.r) { this.section.r = reach; this.syncSection(); }
    q(this.el, '[data-legend-sub]').textContent = s.surfaces === 'capture' ? app.c.legend.onCapture : app.c.legend.onReplacement;
    q<HTMLAnchorElement>(app.root, '[data-skip-view]').href = app.shown === 4 ? '#xch-export' : '#help';
    this.syncControls();
  }

  onStep(step: Step): void {
    const s = this.app.s;
    if (step === 1 && s.captureMesh) this.setDisplay({ capture: true });
    else if (step !== 1 && this.display.capture && s.surfaces !== 'capture') this.setDisplay({ capture: false });
    this.ctrlChip(false);
  }

  /** A view or Fit; `announce` (keyboard): "View: Front." */
  preset(p: Preset | 'fit', announce = false): void {
    const app = this.app, v = app.viewer;
    if (!v) return;
    v.arch = app.s.arch;
    if (p === 'fit') v.fit();
    else v.view(p);
    this.press(p);
    if (announce) app.say.say(fmt(app.lang, app.c.say.view, { name: app.c.view[p] }));
  }

  /** The camera left the last view (drag, wheel, pinch, arrows): no view button claims it. */
  cameraMoved(): void {
    if (this.pressed !== null) this.press(null);
  }

  private press(p: string | null): void {
    this.pressed = p;
    for (const b of qa(this.el, '[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === p));
  }

  /** A jaw, a capture or implant positions: something on the stage. */
  private get hasContent(): boolean {
    const s = this.app.s;
    return !!s && (s.sites.length > 0 || !!s.captureMesh || !!s.jaw);
  }

  /** The adjust pad's step: 30° · 1 mm, or with Fine 5° · 0.1 mm; each button's name and tooltip say the step it makes. */
  private syncPad(): void {
    const { lang, c } = this.app, pad = q(this.el, '[data-pad]');
    q(pad, '[data-pad-fine]').setAttribute('aria-pressed', String(this.fine));
    const step = this.fine ? { deg: 5, mm: num(lang, 0.1, 1) } : { deg: 30, mm: 1 };
    for (const b of qa(pad, '[data-pad-key]')) {
      const name = fmt(lang, c.pad[b.dataset.padKey as keyof typeof c.pad], step);
      b.setAttribute('aria-label', name);
      b.dataset.tip = name;
    }
  }

  toggleJawOpacity(): void {
    if (!this.app.s?.jaw) return; // the transparency button waits for a jaw: T and Shift + middle click do too
    const cur = this.display.jawOpacity;
    if (cur < 1) { this.lastJawOpacity = cur; this.setDisplay({ jawOpacity: 1 }); }
    else this.setDisplay({ jawOpacity: this.lastJawOpacity < 1 ? this.lastJawOpacity : 0.3 });
  }

  /** Shift + middle click on a replacement: geometry opacity 100 % ↔ 30 %. */
  togglePartOpacity(): void {
    this.setDisplay({ partOpacity: this.display.partOpacity < 1 ? 1 : 0.3 });
  }

  /** Ctrl/⌘ + middle click: the object's Display switch goes off, remembered until S (or a new case) shows it again. */
  hide(o: SceneObject): void {
    const key = o === 'part' ? 'parts' : o;
    if (!this.display[key]) return;
    this.hidden.add(key);
    const patch: Partial<DisplayOptions> = {};
    patch[key] = false;
    this.setDisplay(patch);
    this.app.say.say(fmt(this.app.lang, this.app.c.say.hidden, { name: this.app.c.display[key] }));
  }

  /** S, Ctrl/⌘ + Shift + middle click: everything hidden by `hide` comes back (silently on a new case). */
  showAll(announce = true): void {
    if (!this.hidden.size) return;
    const patch: Partial<DisplayOptions> = {};
    for (const key of this.hidden) patch[key] = true;
    this.hidden.clear();
    this.setDisplay(patch);
    if (announce) this.app.say.say(this.app.c.say.shown);
  }

  toggleMap(): void {
    if (shownDeviation(this.app.s)) this.setDisplay({ map: !this.display.map });
    this.update();
  }

  openKeys(): void {
    openModal(q<HTMLDialogElement>(this.app.section, '#xch-keys'), document.activeElement);
  }

  readout(hit: PartHit | null): void {
    const el = q(this.el, '[data-readout]'), app = this.app, c = app.c;
    const site = hit ? app.s.sites.find((x) => x.id === hit.siteId) : undefined;
    if (!site) { el.hidden = true; return; }
    const gid = app.s.geometryBySite[site.id];
    el.textContent = hit!.um !== null
      ? fmt(app.lang, Number.isNaN(hit!.um) ? c.readout.hidden : c.readout.um, { label: site.label, value: num(app.lang, hit!.um) })
      : site.flags.provisional && !app.s.confirmed.has(site.id) ? fmt(app.lang, c.readout.provisional, { label: site.label })
      : site.flags.indexAmbiguous ? fmt(app.lang, c.readout.rotation, { label: site.label })
      : fmt(app.lang, c.readout.geometry, { label: site.label, name: gid ? app.geometryName(gid) : c.s2.noGeometry });
    el.hidden = false;
  }

  ctrlChip(on: boolean): void {
    q(this.el, '[data-ctrlchip]').hidden = !on;
  }

  busy(on: boolean): void {
    q(this.el, '.xch__bar').hidden = !on;
  }

  setGuided(on: boolean): void {
    if (on) this.endMeasure(false); // guided points end the distance tool
    this.el.classList.toggle('is-guided', on);
    this.describe();
    this.update();
  }

  /** The stage's description: the help, plus what Enter does now (guided points or the distance tool). */
  private describe(): void {
    const extra = this.el.classList.contains('is-guided') ? ' xch-view-gp' : this.measure ? ' xch-view-dist' : '';
    this.el.setAttribute('aria-describedby', `xch-view-help${extra}`);
  }

  /* ---------------- section (B2) ---------------- */

  /** P or the Section button: the cut on or off; `announce` (P) says so. On, it starts through the orbit target, facing you. */
  toggleSection(announce = false): void {
    const app = this.app, v = app.viewer;
    if (!v) return;
    if (this.section) {
      this.section = null;
      v.setSection(null);
      if (!this.secPop.hidden) this.togglePopover(this.secPop, this.secBtn, false, false);
    } else {
      if (!this.hasContent) return; // P on an empty stage: nothing to cut
      const s = { offset: 0, flipped: false, follow: false };
      this.section = { ...s, r: v.setSection(s) };
    }
    this.syncSection();
    if (announce) app.say.say(this.section ? app.c.say.sectionOn : app.c.say.sectionOff);
  }

  /** The slider, the two switches. */
  private changeSection(patch: Partial<Section>): void {
    if (!this.section) return;
    Object.assign(this.section, patch);
    this.app.viewer?.setSection(this.section);
    this.syncSection();
  }

  /** Shift + wheel: the cut moves `mm` within the slider's range; false without a cut (the wheel zooms then). */
  nudgeSection(mm: number): boolean {
    const s = this.section;
    if (!s) return false;
    const r = Math.ceil(s.r * 10) / 10;
    this.changeSection({ offset: Math.max(-r, Math.min(r, s.offset + mm)) });
    return true;
  }

  /** The Section button (pressed look and name while the cut is on) and the popover's controls. */
  private syncSection(): void {
    const s = this.section, app = this.app, c = app.c;
    this.secBtn.classList.toggle('is-on', !!s);
    this.secBtn.setAttribute('aria-label', s ? c.section.titleOn : c.section.title);
    if (!s) return;
    const range = q<HTMLInputElement>(this.secPop, '[data-section-range]'), r = Math.ceil(s.r * 10) / 10;
    range.min = String(-r);
    range.max = String(r);
    range.value = String(s.offset);
    const text = fmt(app.lang, c.section.value, { mm: num(app.lang, Math.round(s.offset * 10) / 10 || 0, 1) });
    range.setAttribute('aria-valuetext', text);
    q(range.parentElement!, 'output').textContent = text;
    for (const sw of qa(this.secPop, '[data-section-switch]')) sw.setAttribute('aria-checked', String(!!s[sw.dataset.sectionSwitch as 'flipped' | 'follow']));
  }

  /* ---------------- distance (B3) ---------------- */

  get measuring(): boolean {
    return !!this.measure;
  }

  /** R or the Distance button: the tool on or off (never during guided points). */
  toggleMeasure(): void {
    const app = this.app;
    if (this.measure) return this.endMeasure();
    if (app.alignStep?.guided) { app.say.say(app.c.dist.busy); return; }
    if (!app.viewer || !this.hasContent) return;
    app.viewer.finishPose(); // points go on the set as the store has it
    this.measure = { points: [], pose: app.s.assembly };
    this.syncMeasure();
  }

  /** Leaving the tool clears its points; `announce` says it closed. */
  endMeasure(announce = true): void {
    if (!this.measure) return;
    this.measure = null;
    this.syncMeasure();
    if (announce) this.app.say.say(this.app.c.say.distOff);
  }

  /** A point on a surface: the first, the second (the value), or a third that starts a new pair. */
  measurePoint(p: Vec3): void {
    const m = this.measure, app = this.app;
    if (!m) return;
    // a second point on top of the first (a double-click, Enter twice at the crosshair) would measure 0.00 mm: it says so
    if (m.points.length === 1 && distance(m.points[0]!, p) < 0.005) { app.say.say(app.c.dist.same); return; }
    if (m.points.length === 2) m.points = [];
    m.points.push(p);
    this.syncMeasure(m.points.length - 1);
    const [a, b] = m.points;
    app.say.say(a && b ? fmt(app.lang, app.c.say.distance, { mm: distanceMm(app.lang, a, b) }) : app.c.say.distFirst);
  }

  /** Backspace removes the last point; Esc ends the tool. */
  measureKey(k: 'Backspace' | 'Escape'): void {
    if (k === 'Escape') this.endMeasure();
    else if (this.measure?.points.pop()) this.syncMeasure();
  }

  /** A dragged point follows the surface (null: nothing there, it stays); the release says the new value. */
  measureDrag(i: number, p: Vec3 | null, end: boolean): void {
    const m = this.measure, app = this.app;
    if (!m || i >= m.points.length) return;
    if (p) { m.points[i] = p; this.syncMeasure(); }
    const [a, b] = m.points;
    if (end && a && b) app.say.say(fmt(app.lang, app.c.say.distance, { mm: distanceMm(app.lang, a, b) }));
  }

  /** The viewer's overlay, the button, the hint chip (while a point is missing), the stage's mode and description. */
  private syncMeasure(placed = -1): void {
    const m = this.measure, app = this.app, [a, b] = m?.points ?? [];
    app.viewer?.setMeasure(m?.points ?? [], a && b ? fmt(app.lang, app.c.dist.value, { mm: distanceMm(app.lang, a, b) }) : '', placed);
    this.el.classList.toggle('is-measure', !!m);
    q(this.el, '[data-dist-btn]').setAttribute('aria-pressed', String(!!m));
    q(this.el, '[data-disthint]').hidden = !m || !!b;
    this.describe();
    this.update(); // the adjust pad hides while measuring
  }

  /** A new case or a viewer restart: no cut, no distance, silently. */
  resetTools(): void {
    if (this.section) this.toggleSection();
    this.endMeasure(false);
  }

  contextLost(): void {
    q(this.el, '[data-lost]').hidden = false;
  }

  dispose(): void {
    if (document.fullscreenElement === this.el) void document.exitFullscreen();
  }
}
