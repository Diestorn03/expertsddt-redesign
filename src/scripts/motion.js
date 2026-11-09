/*
  Motion engine — GSAP 3.15 + ScrollTrigger + SplitText + Lenis.
  Techniques applied (epic-design catalogue):
    · Lenis smooth scroll wired to the GSAP ticker
    · Multi-layer parallax via [data-depth] / [data-parallax]
    · Pinned scrub timeline (hero → portal chapter)
    · Split converge / masked line curtain / char cylinder via [data-split]
    · Word-by-word scroll lighting (about section)
    · Horizontal scroll conversion (pillars)
    · Cascading card stack (testimonials)
    · Clip-path wipe / iris reveals via [data-reveal]
    · Scroll-speed reactive marquee
    · Count-up stats, magnetic buttons, 3D tilt cards
  Everything is data-attribute driven so pages stay declarative.
  prefers-reduced-motion: no Lenis, no pins, no reveals/intro/parallax/autoplay; content is shown as written.
*/
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);
// ScrollTrigger refreshes everything on window 'load' by default. The first page now boots before 'load', so on a slow
// device or network 'load' lands while the loader is lifting, and that full refresh (0.7 s at CPU x4) froze the hero intro.
// Instead: refresh on 'load' only if late images changed the page height, and never while the curtain is lifting.
ScrollTrigger.config({ autoRefreshEvents: 'visibilitychange,DOMContentLoaded,resize' });
let refreshedH = -1;
ScrollTrigger.addEventListener('refresh', () => { refreshedH = document.documentElement.scrollHeight; });
addEventListener('load', function lateImages() {
  if (document.querySelector('#loader.is-done')) return void setTimeout(lateImages, 250); // wiping: wait until it is removed
  if (document.documentElement.scrollHeight !== refreshedH) ScrollTrigger.refresh();
}, { once: true });

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
const isMobile = () => window.matchMedia('(max-width: 1180px)').matches; // stacked layout up to tablet-landscape

// Always start at the top on a reload: the pinned scenes must not initialise mid-scroll. A #hash is re-applied once they exist.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);
// `motion` turns on the CSS pre-hide of the animated elements: set by this script, so if it never loads nothing stays hidden
document.documentElement.classList.add('motion');

let lenis;
let ctx;
let bootId = 0;
let gate = Promise.resolve(); // resolves when entrances may play (shortly after the loader starts lifting)
let wipeAt = -1e9; // when the loader's wipe started (first load with motion); 0.7 s, uncovering the screen bottom to top
let pending = location.hash ? { hash: location.hash } : null; // where to put the reader once the page's scenes exist
let navType = 'push';
const cleanups = []; // listeners/observers owned by the current page view
const pageHooks = []; // ScrollTrigger refresh listeners owned by the current page
const onRefresh = (fn) => { ScrollTrigger.addEventListener('refresh', fn); pageHooks.push(fn); };
const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); cleanups.push(() => el.removeEventListener(type, fn, opts)); };
// callbacks that fire later (gate, timers) must not touch a page view that has been torn down
const live = (fn) => { const id = bootId; return (...a) => { if (id === bootId) fn(...a); }; };
const frames = () => new Promise((r) => { let done = 0; const f = () => { if (!done) { done = 1; r(); } }; requestAnimationFrame(() => requestAnimationFrame(f)); setTimeout(f, 120); });
const navOffset = () => document.querySelector('.nav')?.offsetHeight || 70;
const jump = (y) => {
  if (lenis) { lenis.resize(); lenis.scrollTo(y, { immediate: true, force: true }); } else window.scrollTo(0, y);
  ScrollTrigger.update();
};

/* ---------------- Lenis ---------------- */
function initLenis() {
  if (reduced || lenis) return;
  // lerp follows the wheel frame by frame; the old 1.15s duration made every flick take ~1s to settle
  lenis = new Lenis({ lerp: 0.16, wheelMultiplier: 1, smoothWheel: true, allowNestedScroll: true }); // nested scrollers (the contact textarea) scroll natively, then hand the wheel back to the page
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
// Same-page anchors go through Lenis. Capture phase + preventDefault: the ClientRouter (which skips defaultPrevented clicks)
// would otherwise jump natively first, and Lenis, still holding the old position, animated straight back to it.
document.addEventListener('click', (e) => {
  if (!lenis || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.('a[href^="#"]');
  if (!a || a.getAttribute('href') === '#') return;
  let el = null;
  try { el = document.getElementById(decodeURIComponent(a.hash.slice(1))); } catch {}
  if (!el) return;
  e.preventDefault();
  // Lenis already subtracts the target's scroll-margin (global.css gives :target the nav height): never count it twice
  lenis.scrollTo(el, { offset: (parseFloat(getComputedStyle(el).scrollMarginTop) || 0) - navOffset() });
  // what a native fragment jump does for keyboard users (skip link): move focus to the target
  if (!el.matches('a, button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}, true);

/* ---------------- Loader (first load only) ---------------- */
function initLoader() {
  const el = document.getElementById('loader');
  if (!el) { gate = Promise.resolve(); return; }
  let open;
  gate = new Promise((r) => { open = r; });
  // only an image the visitor sees first: a lazy one further down never decodes and held the loader to its cap (/services/)
  const img = document.querySelector('.hero__laptop img')
    || [...document.querySelectorAll('main img')].find((i) => i.loading !== 'lazy' && i.getBoundingClientRect().top < innerHeight);
  const ready = Promise.all([img ? img.decode().catch(() => {}) : 0, document.fonts?.ready]);
  // minimum .5 s counted from the loader's first paint, so it never reads as a flash (Paint Timing; else the head script's
  // two-rAF mark, which can come before the first frame that actually has content)
  const minShown = new Promise((r) => {
    let n = 0;
    const wait = () => {
      const t = performance.getEntriesByName('first-paint')[0]?.startTime ?? performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? (n++ > 30 ? window.__lp : null);
      if (t != null) setTimeout(r, Math.max(0, 500 - (performance.now() - t))); else requestAnimationFrame(wait);
    };
    wait();
  });
  // maximum 2 s counted from navigation start (performance.now() is 0 there), not from when this script ran
  const cap = new Promise((r) => setTimeout(r, Math.max(0, 2000 - performance.now())));
  Promise.race([Promise.all([ready, minShown]), cap]).then(live(() => {
    ScrollTrigger.refresh(); // measured while the page is still covered
    restore();
    frames().then(() => { // the wipe starts on a fresh frame, not inside the refresh task
      el.classList.add('is-done');
      if (!reduced) wipeAt = performance.now();
      document.dispatchEvent(new Event('loader:done'));
      setTimeout(open, reduced ? 0 : 200); // entrances start a little into the wipe, so they are seen and do not compete with its first frames
      const gone = () => el.remove();
      el.addEventListener('transitionend', (e) => e.target === el && gone());
      setTimeout(gone, 1500);
    });
  }));
}

/* ---------------- Theme toggle (dark / light, persisted) ---------------- */
function initTheme() {
  const root = document.documentElement;
  const sync = () => document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    const l = b.querySelector('.theme-toggle__label'); if (l) l.textContent = root.dataset.theme === 'dark' ? l.dataset.toLight : l.dataset.toDark;
  });
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = '1';
    b.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch {}
      sync();
    });
  });
  sync();
}

/* ---------------- Nav ---------------- */
// The header (with the burger) persists across navigations, the menu is swapped with the page: always act on the live menu.
function toggleMenu(open) {
  const burger = document.querySelector('.burger');
  if (!burger) return;
  burger.setAttribute('aria-expanded', String(open));
  document.getElementById('menu')?.classList.toggle('is-open', open);
  document.querySelector('.nav')?.classList.toggle('is-menu', open);
  if (lenis) { if (open) lenis.stop(); else lenis.start(); } else document.body.style.overflow = open ? 'hidden' : '';
}
document.addEventListener('click', (e) => { if (e.target.closest?.('#menu a')) toggleMenu(false); });
document.addEventListener('astro:before-swap', () => toggleMenu(false));

function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  nav.classList.remove('is-solid');
  // the header persists across view transitions: keep the current-page marker in sync
  nav.querySelectorAll('.nav__links a').forEach((a) => {
    const here = a.getAttribute('href') === location.pathname;
    if (here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // the persisted header would keep the previous page's language link: point it at this page's alternate (from <head>)
  const langLink = nav.querySelector('.nav__lang');
  const altHead = langLink && document.querySelector(`link[rel="alternate"][hreflang="${langLink.getAttribute('hreflang')}"]`);
  if (altHead) langLink.setAttribute('href', new URL(altHead.href).pathname);
  // created after initHero so the pin spacer is accounted for.
  // Desktop home: transparent over the pinned hero, solid the moment the hero is released and content starts moving under
  // the bar. Everywhere else: solid after 80px, before any heading can slide under the transparent links.
  const pinned = document.querySelector('#hero')?.parentElement?.classList.contains('pin-spacer');
  const next = pinned && document.querySelector('#hero').parentElement.nextElementSibling;
  ScrollTrigger.create({ trigger: next || document.body, start: next ? 'top bottom' : 80, onEnter: () => nav.classList.add('is-solid'), onLeaveBack: () => nav.classList.remove('is-solid') });

  const burger = nav.querySelector('.burger');
  if (burger && !burger.dataset.bound) { // once per header (a language switch brings a new one)
    burger.dataset.bound = '1';
    burger.addEventListener('click', () => toggleMenu(burger.getAttribute('aria-expanded') !== 'true'));
  }
}

/* ---------------- Entrances: play once when seen, never behind the loader ---------------- */
// An IntersectionObserver per element instead of a ScrollTrigger: no per-frame scroll work, no refresh cost,
// and it cannot be measured on a stale layout (pins, stacked pillars, fonts).
function whenSeen(el, start, fn) {
  const pct = +(/(\d+)%/.exec(start || '')?.[1] ?? 86); // 'top 86%' = the element's top passes 86 % of the viewport
  const io = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    io.disconnect();
    gate.then(live(() => {
      // first load: wait for the wipe to uncover the element's middle, so a page-hero entrance plays in view, not behind the
      // curtain (its cubic-bezier(.76,0,.24,1) edge reaches the fraction e of the screen at about t = .3 + .4e)
      const r = el.getBoundingClientRect();
      const e = 1 - Math.min(1, Math.max(0, (r.top + r.height / 2) / innerHeight));
      const wait = wipeAt + 700 * (0.3 + 0.4 * e) - performance.now();
      if (wait > 0) setTimeout(live(fn), wait); else fn();
    }));
  }, { rootMargin: `0px 0px ${pct - 100}% 0px` });
  io.observe(el);
  cleanups.push(() => io.disconnect());
}
// Once per element: a layout rebuild (crossing 1180 px) must not hide and replay what the reader has already seen.
const played = new WeakSet();
const playWhenSeen = (el, start, tween, onSeen) => {
  if (played.has(el)) { onSeen?.(); tween.progress(1); return; }
  tween.pause(); whenSeen(el, start, () => { played.add(el); onSeen?.(); tween.play(); });
};

const REVEALS = {
  up:    { y: 56, opacity: 0 },
  down:  { y: -56, opacity: 0 },
  left:  { x: -72, opacity: 0 },
  right: { x: 72, opacity: 0 },
  scale: { scale: .86, opacity: 0 },
  blur:  { y: 30, opacity: 0, filter: 'blur(10px)' },
  skew:  { y: 80, skewY: 6, opacity: 0 },
  clip:  { clipPath: 'inset(0 100% 0 0)', opacity: 1 },
  drop:  { clipPath: 'inset(0 0 100% 0)', opacity: 1 },
  iris:  { clipPath: 'circle(0% at 50% 50%)', opacity: 1 },
};

function initReveals() {
  // reduced motion: content is simply there (global.css forces opacity); nothing slides, skews or scales
  if (reduced) { gsap.utils.toArray('[data-reveal]').forEach((el) => el.classList.add('is-inview')); return; }
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    const type = el.dataset.reveal || 'up';
    const from = REVEALS[type] || REVEALS.up;
    const to = { x: 0, y: 0, scale: 1, skewY: 0, opacity: 1, filter: 'blur(0px)', duration: type.startsWith('clip') || type === 'iris' || type === 'drop' ? 1.3 : .95, ease: type === 'skew' || type === 'scale' ? 'back.out(1.6)' : 'power3.out', delay: +(el.dataset.delay || 0), clearProps: 'filter' };
    if (type === 'clip') to.clipPath = 'inset(0 0% 0 0)';
    if (type === 'drop') to.clipPath = 'inset(0 0 0% 0)';
    if (type === 'iris') to.clipPath = 'circle(75% at 50% 50%)';
    playWhenSeen(el, el.dataset.start, gsap.fromTo(el, from, to), () => el.classList.add('is-inview'));
  });

  // staggered children
  gsap.utils.toArray('[data-stagger]').forEach((group) => {
    // fromTo + clearProps: a .btn child has a CSS transform transition, and a from() tween re-reads its mid-transition transform as the end value
    playWhenSeen(group, 'top 82%', gsap.fromTo(group.children, { y: 60, opacity: 0, skewY: 3 }, { y: 0, opacity: 1, skewY: 0, duration: .9, ease: 'power3.out', stagger: +(group.dataset.stagger || .1), clearProps: 'transform' }));
  });
}

/* ---------------- Text splitting ---------------- */
function initSplits() {
  // reduced motion: no SplitText at all, the heading stays as written (its underline accent shown)
  if (reduced) { gsap.utils.toArray('[data-split]').forEach((el) => (el.closest('[data-reveal-scope]') || el).classList.add('is-inview')); return; }
  gsap.utils.toArray('[data-split]').forEach((el) => {
    // mobile: sober — chars become words, lines stay (cheap)
    const mode = coarse && el.dataset.split === 'chars' ? 'words' : el.dataset.split; // chars | words | lines
    el.style.visibility = 'visible';
    const split = new SplitText(el, { type: mode === 'chars' ? 'chars,words' : mode, aria: 'none', mask: mode === 'lines' ? 'lines' : undefined, linesClass: 'split-line', wordsClass: 'split-word', charsClass: 'split-char' });
    const targets = mode === 'chars' ? split.chars : mode === 'words' ? split.words : split.lines;
    const delay = +(el.dataset.delay || 0);
    let tw;
    if (mode === 'chars') {
      el.style.perspective = '800px';
      tw = gsap.from(targets, { rotateX: -90, y: '.4em', opacity: 0, transformOrigin: '50% 50% -30px', duration: .75, ease: 'back.out(1.4)', stagger: { each: .025, from: 'start' }, delay });
    } else if (mode === 'words') {
      tw = gsap.from(targets, { y: '110%', opacity: 0, rotate: 4, duration: .8, ease: 'power4.out', stagger: .05, delay });
    } else {
      tw = gsap.from(targets, { yPercent: 110, duration: .95, ease: 'power4.out', stagger: .11, delay });
    }
    playWhenSeen(el, el.dataset.start || 'top 85%', tw, () => el.closest('[data-reveal-scope]')?.classList.add('is-inview') || el.classList.add('is-inview'));
  });
}

/* ---------------- Parallax ---------------- */
function initParallax() {
  if (coarse || reduced) return;
  gsap.utils.toArray('[data-parallax]').forEach((el) => {
    const amt = parseFloat(el.dataset.parallax || '0.2');
    gsap.fromTo(el, { yPercent: amt * 40 }, { yPercent: -amt * 40, ease: 'none', scrollTrigger: { trigger: el.closest('[data-scene]') || el, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
  const factors = { 0: .1, 1: .25, 2: .5, 3: .8, 4: 1, 5: 1.2 };
  gsap.utils.toArray('[data-depth]').forEach((el) => {
    const f = factors[el.dataset.depth] ?? 1;
    if (f === 1) return;
    gsap.to(el, { yPercent: -18 * (1 - f) * 2, ease: 'none', scrollTrigger: { trigger: el.closest('[data-scene]') || el, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
}

/* ---------------- Hero: pinned scrub chapter ---------------- */
function initHero() {
  const hero = document.querySelector('#hero');
  if (!hero || reduced) return; // reduced motion: no intro, no pin (the CSS pre-hide and the pinned layout are gated on no-preference too)
  const q = gsap.utils.selector(hero);
  const desktop = !isMobile();
  // desktop start pose: laptop peeks in from the bottom-right, scrub brings it to centre
  const laptopFrom = { x: '6vw', y: '18vh', scale: .86 }; // must match the html.motion pre-position in index.astro
  if (desktop) gsap.set(q('.hero__laptop'), laptopFrom);

  // Intro (time-based). Created paused so initial states apply at once; plays when the loader lifts (first load)
  // or as soon as the laptop image is decoded and fonts are in (client-side navigation, capped at 400ms).
  const intro = gsap.timeline({ paused: true, defaults: { ease: 'power4.out' } });
  const img = q('.hero__laptop img')[0];
  const start = document.getElementById('loader')
    ? gate
    : Promise.race([Promise.all([img ? img.decode().catch(() => {}) : 0, document.fonts?.ready]), new Promise((r) => setTimeout(r, 400))]);
  // fromTo with explicit end values: CSS pre-hides these elements (html.motion) so `from` would animate 0 → 0
  intro
    .fromTo(q('.hero__bg video, .hero__bg img'), { scale: 1.15 }, { scale: 1, duration: 2.2, ease: 'power2.out' }, 0)
    .fromTo(q('.hero__eyebrow'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .8 }, .3)
    .fromTo(q('.hero__title .w'), { yPercent: 110, opacity: 0, rotate: 3 }, { yPercent: 0, opacity: 1, rotate: 0, duration: 1.1, stagger: .06 }, .35)
    .fromTo(q('.hero__lead'), { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: .9 }, .9)
    .fromTo(q('.hero__cta > *'), { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: .8, stagger: .1 }, 1.05)
    // intro and scrub own different layers: .hero__rise (intro) vs .hero__laptop (scrub); .g1/.g2 (intro) vs .line-mask (scrub)
    .fromTo(q('.hero__rise'), { y: 160, opacity: 0 }, { y: 0, opacity: 1, duration: 1.6, ease: 'expo.out' }, .7)
    .fromTo(q('.hero__ghost .g1, .hero__ghost .g2'), { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, stagger: .1 }, .5);
  // landing mid-page (anchor, Back, layout change): skip the intro, no overlap with the scrub, no replay
  const landing = window.scrollY > 40 || (pending && (pending.hash || pending.el || pending.i != null || pending.y > 40));
  if (landing) intro.progress(1).pause();
  else start.then(live(() => intro.play())); // no rAF here: hidden tabs never fire it and the intro would never start

  if (!desktop) return; // mobile: hero flows naturally, no pin

  // Scrub chapter: hero text exits, laptop rises to centre, portal chapter fades in.
  // autoAlpha (opacity + visibility): what is invisible can be neither clicked nor focused.
  const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: '+=120%', pin: true, scrub: .5, anticipatePin: 1 } });
  tl
    .to(q('.hero__copy'), { yPercent: -30, autoAlpha: 0, duration: .22, ease: 'power2.in' }, 0)
    .to(q('.hero__ghost .line-mask:first-child'), { xPercent: -25, opacity: 0, duration: .3 }, 0)
    .to(q('.hero__ghost .line-mask:last-child'), { xPercent: 25, opacity: 0, duration: .3 }, 0)
    // scale + a dark overlay's opacity: both compositor-only (an animated filter on a full-screen video repaints every frame)
    .fromTo(q('.hero__bg'), { scale: 1 }, { scale: 1.08, duration: .45, immediateRender: false }, 0)
    .fromTo(q('.hero__dim'), { opacity: 0 }, { opacity: .45, duration: .45, immediateRender: false }, 0)
    .to(q('.hero__scroll'), { opacity: 0, duration: .1 }, 0)
    .fromTo(q('.hero__laptop'), laptopFrom, { x: 0, y: 0, scale: 1, duration: .45, ease: 'power2.inOut', immediateRender: false }, .05)
    .fromTo(q('.portal__head'), { y: 60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .22, ease: 'power3.out' }, .24)
    .fromTo(q('.portal__feature'), { y: 60, autoAlpha: 0, scale: .92 }, { y: 0, autoAlpha: 1, scale: 1, duration: .22, stagger: .07, ease: 'back.out(1.4)' }, .36)
    .fromTo(q('.portal__cta'), { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: .18 }, .58)
    .to({}, { duration: .3 });
}

/* ---------------- Pillars: horizontal scroll ---------------- */
let pillarsPin = null; // { yOf(panel), current() } while the horizontal chapter is pinned
function initPillars() {
  const wrap = document.querySelector('#pillars');
  if (!wrap) return;
  const track = wrap.querySelector('.pillars__track');
  const panels = gsap.utils.toArray('.pillar', track);
  const bar = wrap.querySelector('.pillars__progress i');
  const count = wrap.querySelector('.pillars__count');
  const isStatic = reduced || isMobile() || panels.length < 2;
  wrap.classList.toggle('is-static', isStatic); // toggle, not add: the class must follow the layout when the breakpoint is crossed back
  if (isStatic) return;
  const scroll = () => track.scrollWidth - window.innerWidth;
  const RATIO = .55; // vertical scroll spent per horizontal px: < 1 so the pinned chapter is short and never feels stuck
  const tween = gsap.to(track, {
    x: () => -scroll(), ease: 'none',
    scrollTrigger: {
      trigger: wrap, start: 'top top', end: () => `+=${scroll() * RATIO}`, pin: true, scrub: .4, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate: (self) => {
        if (bar) bar.style.transform = `scaleX(${self.progress})`;
        // panels[0] is the intro: it shares "01" with the first pillar, so the HUD reads 01-04 like the pillar numbers
        // written only when it changes: a text write every frame invalidated layout, and the next trigger's scroll read paid for it
        const n = String(Math.min(panels.length - 1, Math.max(1, Math.round(self.progress * (panels.length - 1))))).padStart(2, '0');
        if (count && count.textContent !== n) count.textContent = n;
      },
    },
  });
  const st = tween.scrollTrigger;
  // page position at which a panel fills the screen (keyboard focus, and the reader's place across a 1180 px rebuild)
  const yOf = (p) => st.start + Math.min(1, p.offsetLeft / Math.max(1, scroll())) * (st.end - st.start);
  pillarsPin = { yOf, current: () => (window.scrollY >= st.start && window.scrollY <= st.end ? panels[Math.round(st.progress * (panels.length - 1))] : null) };
  cleanups.push(() => { pillarsPin = null; });
  const reveals = new Map();
  panels.forEach((p) => {
    if (p.classList.contains('pillar--intro')) return; // its heading/lead/hint already reveal with data-split / data-reveal on the vertical scroll
    const media = p.querySelector('.pillar__media > :is(img, video)');
    if (media) gsap.fromTo(media, { xPercent: -12, scale: 1.15 }, { xPercent: 12, scale: 1.15, ease: 'none', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
    reveals.set(p, gsap.fromTo(p.querySelectorAll('.pillar__copy > *'), { y: 50, opacity: 0 }, { y: 0, opacity: 1, stagger: .08, duration: .8, ease: 'power3.out', clearProps: 'transform', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left 70%', once: true } }));
  });
  // Keyboard: Tab into a panel that is still off to the side → bring that panel on screen (the page scrolls, the track follows)
  on(wrap, 'focusin', (e) => {
    const p = e.target.closest('.pillar');
    if (!p || !e.target.matches(':focus-visible')) return;
    jump(yOf(p));
    st.getTween?.()?.progress(1); // skip the scrub lag
    const r = reveals.get(p);
    if (r && r.progress() < 1) { r.scrollTrigger?.kill(); r.progress(1); }
  });
}

/* ---------------- Word-by-word lighting ---------------- */
function initLit() {
  if (reduced) return;
  gsap.utils.toArray('[data-lit]').forEach((el) => {
    const split = new SplitText(el, { type: 'words', aria: 'none', wordsClass: 'lit-word' });
    el.style.visibility = 'visible';
    gsap.fromTo(split.words, { opacity: .66 }, { opacity: 1, stagger: .02, ease: 'none', scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 45%', scrub: .6 } });
  });
}

/* ---------------- Testimonials: card stack ---------------- */
function initStack() {
  const cards = gsap.utils.toArray('.stack-card');
  if (!cards.length || reduced) return;
  cards.forEach((card, i) => {
    if (i === cards.length - 1) return;
    // only the contents fade: the card background stays opaque so the card behind it never shows through
    const st = { trigger: cards[i + 1], start: 'top 85%', end: 'top 12%', scrub: true };
    gsap.to(card, { scale: .94 - (cards.length - 2 - i) * .02, ease: 'none', scrollTrigger: st });
    gsap.to(card.children, { opacity: .35, ease: 'none', scrollTrigger: { ...st } });
  });
}

/* ---------------- Marquee (scroll-speed reactive) ---------------- */
// one ticker for the whole session (booted on every page view, so it must not stack), width cached, idle when off-screen
let marqueeTick;
function initMarquee() {
  if (marqueeTick) gsap.ticker.remove(marqueeTick);
  marqueeTick = null;
  if (reduced) return; // static text
  const items = gsap.utils.toArray('.marquee').map((m) => {
    const track = m.querySelector('.marquee__track');
    if (!track) return null;
    if (!track.dataset.cloned) { track.innerHTML += track.innerHTML; track.dataset.cloned = '1'; }
    const it = { track, x: 0, half: track.scrollWidth / 2, visible: false };
    const io = new IntersectionObserver(([e]) => { it.visible = e.isIntersecting; });
    io.observe(m); cleanups.push(() => io.disconnect());
    return it;
  }).filter(Boolean);
  if (!items.length) return;
  onRefresh(() => items.forEach((it) => { it.half = it.track.scrollWidth / 2; }));
  // Lenis' own position: reading window.scrollY here, right after this tick's style writes, forced a layout every frame
  const pos = () => (lenis ? lenis.animatedScroll : 0);
  let vel = 0, last = pos();
  marqueeTick = () => {
    const y = pos(), dy = y - last; last = y;
    if (!items.some((it) => it.visible)) { vel = 0; return; }
    vel = Math.min(18, Math.abs(dy) * .35 + vel * .9);
    items.forEach((it) => {
      if (!it.visible) return;
      it.x -= .9 + vel;
      if (-it.x >= it.half) it.x += it.half;
      it.track.style.transform = `translate3d(${it.x}px,0,0)`;
    });
  };
  gsap.ticker.add(marqueeTick);
}

/* ---------------- Before / after comparison ---------------- */
function initCompare() {
  gsap.utils.toArray('.ba').forEach((fig) => {
    const range = fig.querySelector('.ba__range');
    if (!range) return;
    const set = (v) => fig.style.setProperty('--pos', `${v}%`);
    on(range, 'input', () => set(range.value));
    if (reduced) return;
    // one-time hint that the image is draggable; any interaction cancels it
    const o = { v: 50 };
    const tl = gsap.timeline({ scrollTrigger: { trigger: fig, start: 'top 70%', once: true } })
      .to(o, { v: 26, duration: .8, ease: 'power2.inOut', onUpdate: () => set(o.v) })
      .to(o, { v: 72, duration: 1, ease: 'power2.inOut', onUpdate: () => set(o.v) })
      .to(o, { v: 50, duration: .7, ease: 'power2.out', onUpdate: () => set(o.v) });
    ['pointerdown', 'keydown', 'focus'].forEach((ev) => on(range, ev, () => tl.kill(), { once: true }));
  });
}

/* ---------------- Counters ---------------- */
function initCounters() {
  gsap.utils.toArray('[data-count]').forEach((el) => {
    const target = parseFloat(el.dataset.count);
    if (reduced) { el.textContent = String(target); return; }
    const obj = { v: 0 };
    el.textContent = '0';
    playWhenSeen(el, 'top 85%', gsap.to(obj, { v: target, duration: 2, ease: 'power3.out', onUpdate: () => { el.textContent = String(Math.round(obj.v)); } }));
  });
}

/* ---------------- Tilt + magnetic ---------------- */
function initPointerFx() {
  if (coarse || reduced) return;
  gsap.utils.toArray('[data-tilt]').forEach((card) => {
    const setX = gsap.quickTo(card, 'rotationY', { duration: .5, ease: 'power3' });
    const setY = gsap.quickTo(card, 'rotationX', { duration: .5, ease: 'power3' });
    card.style.transformStyle = 'preserve-3d';
    card.parentElement.style.perspective = '1000px';
    on(card, 'pointermove', (e) => {
      const r = card.getBoundingClientRect();
      setX(((e.clientX - r.left) / r.width - .5) * 12);
      setY(-((e.clientY - r.top) / r.height - .5) * 12);
    });
    on(card, 'pointerleave', () => { setX(0); setY(0); });
  });
  // the header's Booking button persists across pages: its listeners are removed with the page view (on), so they never pile up
  gsap.utils.toArray('[data-magnetic]').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: .4, ease: 'power3' });
    const my = gsap.quickTo(el, 'y', { duration: .4, ease: 'power3' });
    on(el, 'pointermove', (e) => { const r = el.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * .3); my((e.clientY - r.top - r.height / 2) * .3); });
    on(el, 'pointerleave', () => { mx(0); my(0); });
  });
}

/* ---------------- Videos: always muted, play only while visible ---------------- */
// The hero background video has no src in the HTML (phones never download it): it gets one only on the desktop layout
// with motion allowed. Any video hidden by CSS loses its src until it is shown again (breakpoint crossed back).
function initVideos() {
  const vids = gsap.utils.toArray('video');
  if (!vids.length) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting && getComputedStyle(v).display !== 'none') v.play().catch(() => {});
    else v.pause();
  }), { rootMargin: '200px 0px', threshold: 0 });
  cleanups.push(() => io.disconnect());
  const observed = [];
  vids.forEach((v) => {
    v.muted = true; v.defaultMuted = true; v.volume = 0; v.setAttribute('muted', '');
    v.removeAttribute('autoplay');
    if (!v.dataset.src && v.getAttribute('src')) v.dataset.src = v.getAttribute('src');
    on(v, 'playing', () => v.classList.add('is-playing'), { once: true });
    const hero = v.closest('#hero');
    if (getComputedStyle(v).display === 'none' || (hero && (reduced || isMobile()))) {
      v.pause();
      if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); }
      return;
    }
    if (reduced) { v.pause(); return; } // reduced motion: poster / first frame, no looping autoplay
    if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
    // the hero video lives inside a pinned scene: pin/unpin can confuse intersection reports, so it just plays (after the loader)
    if (hero) { gate.then(live(() => v.play().catch(() => {}))); return; }
    io.observe(v); observed.push(v);
  });
  // after ScrollTrigger moves things around (pin spacers, refresh), re-observe to get a fresh intersection report
  onRefresh(() => observed.forEach((v) => { io.unobserve(v); io.observe(v); }));
}
// browsers pause muted videos in hidden/occluded tabs and do not always resume them: resume the hero video (registered once)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const v = document.querySelector('#hero video');
  if (v && v.paused && v.getAttribute('src') && getComputedStyle(v).display !== 'none') v.play().catch(() => {});
});

/* ---------------- Cursor glow (desktop only) ---------------- */
function initGlow() {
  if (coarse || reduced) return;
  gsap.utils.toArray('[data-glow]').forEach((el) => {
    on(el, 'pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--gx', `${e.clientX - r.left}px`);
      el.style.setProperty('--gy', `${e.clientY - r.top}px`);
    });
  });
}

/* ---------------- Reader position across navigations and layout changes ---------------- */
// Astro scrolls to the #hash / the history position BEFORE this page's pins exist, so that position is short by the pin
// spacers. It is re-applied here once the scenes are built and measured.
const outer = (s) => (s.parentElement?.classList.contains('pin-spacer') ? s.parentElement : s);
// What the reader is looking at, just under the nav: inside a pinned chapter, the progress through it; elsewhere, the
// element at that line and how far into it (survives reflow better than a fraction of a whole section).
function scenePoint() {
  const line = navOffset() + 1;
  const panel = pillarsPin?.current(); // pinned pillars: the panel on screen, not a fraction of the (differently sized) chapter
  if (panel) return { el: panel, f: 0 };
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const i = scenes.findIndex((s) => { const o = outer(s); if (o === s) return false; const r = o.getBoundingClientRect(); return r.top <= line && r.bottom > line; });
  if (i >= 0) { const r = outer(scenes[i]).getBoundingClientRect(); return { i, f: (line - r.top) / r.height }; }
  let el = document.elementFromPoint(window.innerWidth / 2, line);
  el = el?.closest('[data-split], [data-lit]') || el; // split words/lines are rebuilt by the reboot
  if (!el || el === document.documentElement || el === document.body) return { y: window.scrollY };
  const r = el.getBoundingClientRect();
  return { el, f: (line - r.top) / (r.height || 1) };
}
function restore() {
  const p = pending;
  pending = null;
  if (!p) return;
  let y = p.y;
  if (p.hash) {
    let el = null;
    try { el = document.getElementById(decodeURIComponent(p.hash.slice(1))); } catch {}
    if (!el) return;
    y = el.getBoundingClientRect().top + window.scrollY - navOffset();
  } else if (pillarsPin && p.el?.closest?.('.pillar')) {
    y = pillarsPin.yOf(p.el.closest('.pillar'));
  } else if (p.i != null || p.el) {
    const o = p.el || outer(document.querySelectorAll('[data-scene]')[p.i] || document.body);
    if (!o.isConnected) return;
    const r = o.getBoundingClientRect();
    y = r.top + window.scrollY + p.f * r.height - (navOffset() + 1);
  }
  if (y != null) jump(Math.max(0, y));
}

/* ---------------- Boot / teardown (View Transitions aware) ---------------- */
function teardown() {
  bootId++;
  ctx?.revert();
  ctx = null;
  cleanups.splice(0).forEach((fn) => fn());
  pageHooks.splice(0).forEach((fn) => ScrollTrigger.removeEventListener('refresh', fn));
  ScrollTrigger.getAll().forEach((t) => t.kill());
}

function boot() {
  teardown();
  ctx = gsap.context(() => {
    initTheme();
    initLoader(); // first: sets the gate the entrances and the hero video wait for
    initVideos();
    initHero();
    initNav();
    initPillars();
    initSplits();
    initReveals();
    initParallax();
    initLit();
    initStack();
    initMarquee();
    initCounters();
    initCompare();
    initPointerFx();
    initGlow();
  });
  // fonts change line breaks → refresh after they load
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(live(() => ScrollTrigger.refresh()));
  // (window 'load' is handled by ScrollTrigger's own auto-refresh)
  if (pending && !document.getElementById('loader')) { ScrollTrigger.refresh(); restore(); }
}

initLenis();
// First page view: boot as soon as this module runs (the HTML is parsed). astro:page-load waits for window 'load', i.e. every
// image and video, which kept the loader up well past its 2 s maximum. Later views boot on astro:page-load after their swap.
let swapped = false;
boot();
document.addEventListener('astro:page-load', () => { if (!swapped) return; swapped = false; boot(); });
document.addEventListener('astro:before-swap', (e) => { navType = e.navigationType; lastPoint = null; teardown(); });
document.addEventListener('astro:after-swap', () => {
  swapped = true;
  document.documentElement.classList.add('motion'); // the swap replaced every <html> attribute
  document.getElementById('loader')?.remove(); // client-side navigation: no loader
  // no scrollTo(0) here: Astro already put the new page at the top / the hash / the history position
  pending = navType === 'traverse' ? { y: history.state?.scrollY ?? window.scrollY } : location.hash ? { hash: location.hash } : null;
  if (lenis) { lenis.reset(); lenis.updateClassName(); } // resync with the real position; the swap wiped the <html> classes
});

// Crossing 1180 px rebuilds the home scenes (pinned ↔ stacked). Other pages have nothing layout-specific to rebuild.
// The reader's place is noted whenever scrolling stops, in the layout they were reading: by the time the media query
// fires, the page has already reflowed at the new width and scroll anchoring does not survive the pinned ↔ stacked switch.
let bpTimer, lastPoint = null;
ScrollTrigger.addEventListener('scrollEnd', () => { lastPoint = scenePoint(); });
window.matchMedia('(max-width: 1180px)').addEventListener('change', () => {
  clearTimeout(bpTimer);
  bpTimer = setTimeout(() => {
    if (!document.querySelector('#hero, #pillars')) return;
    pending = (lastPoint?.el && !lastPoint.el.isConnected ? null : lastPoint) || scenePoint(); // same place, after the rebuild
    teardown();
    window.scrollTo(0, 0); lenis?.reset(); // the pins are built from the top, then the reader is put back
    boot();
  }, 150);
});
