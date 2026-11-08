/**
 * Lifecycle of the DDT Xchange workspace on a page that persists across Astro view transitions (UI-DESIGN §3.4).
 * mount() is idempotent (data-mounted) and cheap: copy + small-screen check. The workspace (three.js, workers,
 * IndexedDB) loads with import() when it comes within a viewport height, or on the first "Try a sample case".
 * dispose() tears everything down; the leave guard asks the browser's own "Leave site?" while work is unexported.
 */
import type { App } from './app';
import type { Lang } from './i18n/format';
import type { CaptureResult } from '../state/jobs-handler';

export interface Mounted {
  dispose(): void;
}

const SMALL = '(max-width: 767.98px) and (pointer: coarse), (max-width: 599.98px)';

declare global {
  interface Window {
    __xchMounts?: number;
  }
}

export function mount(root: HTMLElement): Mounted {
  if (root.dataset.mounted) return { dispose() {} };
  root.dataset.mounted = '1';
  window.__xchMounts = (window.__xchMounts ?? 0) + 1;
  const ac = new AbortController();
  const { signal } = ac;
  const lang: Lang = root.dataset.lang === 'es' ? 'es' : 'en';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const section = root.closest('section') ?? document.body;
  const small = matchMedia(SMALL);
  let app: App | null = null;
  let starting: Promise<App | null> | null = null;
  let wantSample = false;
  let disposed = false;
  const observers: IntersectionObserver[] = [];

  const start = (): Promise<App | null> => {
    if (starting) return starting;
    if (small.matches) return Promise.resolve(null);
    starting = (async () => {
      const [{ App: AppClass }, copy] = await Promise.all([import('./app'), lang === 'es' ? import('./i18n/es') : import('./i18n/en')]);
      if (disposed) return null;
      const a = new AppClass(root, copy.default, lang, reduced, root.dataset.hook ?? '');
      app = a;
      await a.init();
      if (disposed) return null;
      if (wantSample) {
        wantSample = false;
        void loadSample(a, null);
      }
      return a;
    })().catch((e: unknown) => {
      console.error(e);
      return null;
    });
    return starting;
  };

  // "Try a sample case" anywhere on the page; a click before the workspace is ready is queued.
  document.addEventListener('click', (e) => {
    const b = (e.target as Element | null)?.closest?.('[data-xch-demo]');
    if (!b) return;
    if (b.tagName === 'BUTTON') e.preventDefault();
    if (!app) {
      wantSample = true;
      void start();
    } else void loadSample(app, b);
  }, { signal });
  section.querySelector('[data-new-case]')?.addEventListener('click', async (e) => {
    const a = app ?? (await start());
    if (!a) return;
    if (a.hasUnsaved() && !(await a.confirm('new', e.target as Element))) return;
    a.resetCase(null);
    a.go(1);
    a.say.say(a.c.say.newCase);
  }, { signal });
  section.querySelector('[data-exit-sample]')?.addEventListener('click', () => {
    if (!app) return;
    app.resetCase(null);
    app.go(1);
    app.say.say(app.c.say.newCase);
  }, { signal });

  // lazy: the workspace loads when it comes within one viewport height
  const near = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) {
      near.disconnect();
      void start();
    }
  }, { rootMargin: '100% 0px' });
  near.observe(root);
  observers.push(near);
  // the floats (WhatsApp, Apex) would cover the stage's corner while it fills the view; in the one-column layouts
  // (< 1180 px, zoomed laptops) they would cover panel controls, so there they hide while any of the tool shows
  const stage = root.querySelector('.xch__stage');
  const narrow = matchMedia('(max-width: 1179.98px)');
  let stageHalf = false, toolIn = false;
  const syncFloats = (): void => void document.documentElement.classList.toggle('xch-in-view', stageHalf || (narrow.matches && toolIn));
  if (stage) {
    const io = new IntersectionObserver(([x]) => { stageHalf = !!x && x.intersectionRatio >= 0.5; syncFloats(); }, { threshold: [0, 0.5, 1] });
    io.observe(stage);
    observers.push(io);
  }
  const tool = new IntersectionObserver(([x]) => { toolIn = !!x?.isIntersecting; syncFloats(); });
  tool.observe(root);
  observers.push(tool);
  narrow.addEventListener('change', syncFloats, { signal });
  // a tablet rotated to landscape mounts the 3D; shrinking never destroys a case
  small.addEventListener('change', () => { if (!small.matches) void start(); }, { signal });
  wireSmallCard(section, signal);

  // leave guard: the browser's own prompt only (no custom confirm, never window.confirm)
  const unsaved = (): boolean => !!app?.hasUnsaved();
  window.addEventListener('beforeunload', (e) => { if (unsaved()) e.preventDefault(); }, { signal });
  document.addEventListener('astro:before-preparation', (e) => { if (unsaved()) e.preventDefault(); }, { signal });

  return {
    dispose() {
      disposed = true;
      ac.abort();
      for (const o of observers) o.disconnect();
      document.documentElement.classList.remove('xch-in-view');
      app?.dispose();
      app = null;
      delete root.dataset.mounted;
    },
  };
}

async function loadSample(a: App, opener: Element | null): Promise<void> {
  if (a.hasUnsaved() && !(await a.confirm('sample', opener))) return;
  const { makeSample } = await import('./demo');
  const sample = makeSample();
  a.resetCase('lower');
  a.go(1);
  try {
    const r = await a.jobs.run<CaptureResult>({ type: 'readCapture', files: [{ bytes: sample.csv, extension: 'csv' }] }, [sample.csv.buffer as ArrayBuffer]);
    a.capture.apply(r, true);
  } catch (e) {
    a.error(1, e, 'positions');
    return;
  }
  const caseGeometries = new Map(a.s.caseGeometries);
  caseGeometries.set('sample-body', { id: 'sample-body', name: a.c.lib.sampleName, mesh: sample.body, kind: 'sample', group: 'sample' });
  a.store.set({ arch: 'lower', caseGeometries, exportedSinceChange: false });
  if (a.viewer) a.viewer.arch = 'lower';
  a.alignStep.sampleJaw = sample.jaw;
  a.say.say(a.c.say.sample);
  a.root.querySelector<HTMLElement>('[data-next="1"]')?.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('scroll-to', { detail: a.root }));
}

function wireSmallCard(section: Element, signal: AbortSignal): void {
  const copy = section.querySelector<HTMLButtonElement>('[data-copy-link]');
  const share = section.querySelector<HTMLButtonElement>('[data-share-link]');
  const url = (): string => location.origin + location.pathname;
  const status = document.getElementById('xch-status');
  copy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url());
      if (status) status.textContent = copy.dataset.ok ?? '';
    } catch {
      if (status) status.textContent = copy.dataset.fail ?? '';
    }
  }, { signal });
  if (share && 'share' in navigator) {
    share.hidden = false;
    share.addEventListener('click', () => void navigator.share({ url: url() }).catch(() => {}), { signal });
  }
}
