/** Stage chrome (UI-DESIGN §6.2-§6.8): toolbar, display popover, adjust pad, legend, readout, drop overlay. */
import type { Step } from '../state/case';
import type { Preset } from '../viewer/presets';
import { DEFAULT_DISPLAY, type DisplayOptions, type PartHit } from '../viewer/viewer';
import type { App } from './app';
import { q, qa, roving } from './dom';
import { openModal } from './feedback';
import { fmt, num } from './i18n/format';

const VIEW_KEY = 'ddt-xchange:view';

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

  constructor(private readonly app: App) {
    const { root, signal } = app;
    this.el = q(root, '.xch__stage');
    this.pop = q(this.el, '[data-display]');
    this.popBtn = q(this.el, '[data-display-btn]');
    roving(q(this.el, '.xch__toolbar'), signal);
    roving(q(this.el, '.xch__views'), signal);
    for (const b of qa<HTMLButtonElement>(this.el, '[data-view]')) b.addEventListener('click', () => this.preset(b.dataset.view as Preset | 'fit'), { signal });
    // the icon bar's direct toggles take the keys' path (C, T), so the legend follows the map
    const enabled = (e: Event): boolean => (e.currentTarget as Element).getAttribute('aria-disabled') !== 'true';
    q(this.el, '[data-map-btn]').addEventListener('click', (e) => { if (enabled(e)) this.toggleMap(); }, { signal });
    q(this.el, '[data-xray-btn]').addEventListener('click', (e) => { if (enabled(e)) this.toggleJawOpacity(); }, { signal });
    this.popBtn.addEventListener('click', () => this.togglePopover(), { signal });
    this.pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.togglePopover(false); } }, { signal });
    // it covers the adjust pad: focus leaving it (Tab, Shift+Tab) closes it, so nothing focused stays hidden under it
    this.pop.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !this.pop.contains(to) && to !== this.popBtn) this.togglePopover(false, false);
    }, { signal });
    document.addEventListener('pointerdown', (e) => { if (!this.pop.hidden && !this.pop.contains(e.target as Node) && e.target !== this.popBtn) this.togglePopover(false, false); }, { signal });
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
    for (const b of qa<HTMLButtonElement>(pad, '[data-pad-op]')) b.addEventListener('click', (e) => app.alignStep.pad(b.dataset.padOp!, Number(b.dataset.padDir), e.shiftKey), { signal });
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

  private togglePopover(open = this.pop.hidden, focusBack = true): void {
    this.pop.hidden = !open;
    this.popBtn.setAttribute('aria-expanded', String(open));
    if (open) q<HTMLElement>(this.pop, 'button, input').focus();
    else if (focusBack) this.popBtn.focus();
  }

  setDisplay(patch: Partial<DisplayOptions>): void {
    this.display = { ...this.display, ...patch };
    this.app.viewer?.setDisplay(this.display);
    this.syncControls();
  }

  /** Every control that mirrors the display options, the legend included: whatever changed the map (C, the map button, the Display switch), the legend follows. */
  private syncControls(): void {
    const d = this.display, app = this.app, c = app.c;
    const mapped = d.map && !!app.s?.deviation;
    q(this.el, '[data-legend]').hidden = !mapped;
    const map = q(this.el, '[data-map-btn]'), xray = q(this.el, '[data-xray-btn]');
    map.setAttribute('aria-pressed', String(mapped));
    map.setAttribute('aria-disabled', String(!app.s?.deviation));
    xray.setAttribute('aria-pressed', String(d.jawOpacity < 1));
    xray.setAttribute('aria-disabled', String(!app.s?.jaw));
    for (const sw of qa(this.pop, '[data-switch]')) {
      const key = sw.dataset.switch as keyof DisplayOptions;
      sw.setAttribute('aria-checked', String(!!d[key]));
      if (key === 'jawColor') sw.hidden = !app.viewer?.hasJawColors;
      if (key === 'map') sw.setAttribute('aria-disabled', String(!app.s?.deviation));
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
    const any = s.sites.length > 0 || !!s.captureMesh || !!s.jaw;
    q(this.el, '[data-empty]').hidden = any && !!app.viewer;
    q(this.el, '[data-pad]').hidden = !(app.shown === 4 && s.jaw && !app.alignStep?.guided);
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

  preset(p: Preset | 'fit'): void {
    const v = this.app.viewer;
    if (!v) return;
    v.arch = this.app.s.arch;
    if (p === 'fit') v.fit();
    else v.view(p);
    this.pressed = p;
    for (const b of qa(this.el, '[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === this.pressed));
  }

  toggleJawOpacity(): void {
    const cur = this.display.jawOpacity;
    if (cur < 1) { this.lastJawOpacity = cur; this.setDisplay({ jawOpacity: 1 }); }
    else this.setDisplay({ jawOpacity: this.lastJawOpacity < 1 ? this.lastJawOpacity : 0.3 });
  }

  toggleMap(): void {
    if (this.app.s.deviation) this.setDisplay({ map: !this.display.map });
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
      ? fmt(app.lang, c.readout.um, { label: site.label, value: num(app.lang, hit!.um) })
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
    this.el.classList.toggle('is-guided', on);
    this.el.setAttribute('aria-describedby', on ? 'xch-view-help xch-view-gp' : 'xch-view-help'); // Enter places a point only now
    this.update();
  }

  contextLost(): void {
    q(this.el, '[data-lost]').hidden = false;
  }

  dispose(): void {
    if (document.fullscreenElement === this.el) void document.exitFullscreen();
  }
}
