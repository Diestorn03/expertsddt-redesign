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
*/
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;
const isMobile = () => window.matchMedia('(max-width: 1180px)').matches; // stacked layout up to tablet-landscape

// Always start at the top on a reload: the pinned scenes must not initialise mid-scroll.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

let lenis;
let ctx;

/* ---------------- Lenis ---------------- */
function initLenis() {
  if (reduced || lenis) return;
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  // anchor links go through Lenis
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href') === '#') return;
    const el = document.querySelector(a.getAttribute('href'));
    if (!el) return;
    e.preventDefault();
    lenis.scrollTo(el, { offset: -70 });
  });
}

/* ---------------- Theme toggle (dark / light, persisted) ---------------- */
function initTheme() {
  const root = document.documentElement;
  const sync = () => document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
    const l = b.querySelector('.theme-toggle__label'); if (l) l.textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark';
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
function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const from = document.querySelector('[data-nav-solid-from]');
  nav.classList.remove('is-solid');
  // created after initHero so the pin spacer is accounted for
  // desktop: solid once the hero scene is over; stacked layouts: solid after 80px so the logo never sits on images
  const useHero = from && !isMobile();
  ScrollTrigger.create({ trigger: useHero ? from : document.body, start: useHero ? 'bottom top+=90' : 80, onEnter: () => nav.classList.add('is-solid'), onLeaveBack: () => nav.classList.remove('is-solid') });

  const burger = document.querySelector('.burger');
  const menu = document.querySelector('.menu');
  if (burger && menu && !burger.dataset.bound) {
    burger.dataset.bound = '1';
    const toggle = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('is-open', open);
      lenis ? (open ? lenis.stop() : lenis.start()) : (document.body.style.overflow = open ? 'hidden' : '');
    };
    burger.addEventListener('click', () => toggle(burger.getAttribute('aria-expanded') !== 'true'));
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggle(false)));
    document.addEventListener('astro:before-swap', () => toggle(false));
  }
}

/* ---------------- Generic reveals ---------------- */
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
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    const type = el.dataset.reveal || 'up';
    const from = REVEALS[type] || REVEALS.up;
    const to = { x: 0, y: 0, scale: 1, skewY: 0, opacity: 1, filter: 'blur(0px)', duration: type.startsWith('clip') || type === 'iris' || type === 'drop' ? 1.3 : .95, ease: type === 'skew' || type === 'scale' ? 'back.out(1.6)' : 'power3.out', delay: +(el.dataset.delay || 0), clearProps: 'filter' };
    if (type === 'clip') to.clipPath = 'inset(0 0% 0 0)';
    if (type === 'drop') to.clipPath = 'inset(0 0 0% 0)';
    if (type === 'iris') to.clipPath = 'circle(75% at 50% 50%)';
    gsap.fromTo(el, from, { ...to, scrollTrigger: { trigger: el, start: el.dataset.start || 'top 86%', once: true, onEnter: () => el.classList.add('is-inview') } });
  });

  // staggered children
  gsap.utils.toArray('[data-stagger]').forEach((group) => {
    const kids = group.children;
    gsap.from(kids, { y: 60, opacity: 0, skewY: 3, duration: .9, ease: 'power3.out', stagger: +(group.dataset.stagger || .1), scrollTrigger: { trigger: group, start: 'top 82%', once: true } });
  });
}

/* ---------------- Text splitting ---------------- */
function initSplits() {
  gsap.utils.toArray('[data-split]').forEach((el) => {
    // mobile: sober — chars become words, lines stay (cheap)
    const mode = coarse && el.dataset.split === 'chars' ? 'words' : el.dataset.split; // chars | words | lines
    el.style.visibility = 'visible';
    const split = new SplitText(el, { type: mode === 'chars' ? 'chars,words' : mode, mask: mode === 'lines' ? 'lines' : undefined, linesClass: 'split-line', wordsClass: 'split-word', charsClass: 'split-char' });
    const targets = mode === 'chars' ? split.chars : mode === 'words' ? split.words : split.lines;
    const trig = { trigger: el, start: el.dataset.start || 'top 85%', once: true, onEnter: () => el.closest('[data-reveal-scope]')?.classList.add('is-inview') || el.classList.add('is-inview') };
    if (mode === 'chars') {
      el.style.perspective = '800px';
      gsap.from(targets, { rotateX: -90, y: '.4em', opacity: 0, transformOrigin: '50% 50% -30px', duration: .75, ease: 'back.out(1.4)', stagger: { each: .025, from: 'start' }, delay: +(el.dataset.delay || 0), scrollTrigger: trig });
    } else if (mode === 'words') {
      gsap.from(targets, { y: '110%', opacity: 0, rotate: 4, duration: .8, ease: 'power4.out', stagger: .05, delay: +(el.dataset.delay || 0), scrollTrigger: trig });
    } else {
      gsap.from(targets, { yPercent: 110, duration: .95, ease: 'power4.out', stagger: .11, delay: +(el.dataset.delay || 0), scrollTrigger: trig });
    }
  });
}

/* ---------------- Parallax ---------------- */
function initParallax() {
  if (coarse) return;
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
  if (!hero) return;
  const q = gsap.utils.selector(hero);
  const desktop = !reduced && !isMobile();
  // desktop start pose: laptop peeks in from the bottom-right, scrub brings it to centre
  const laptopFrom = { x: '22vw', y: '12vh', scale: .82 };
  if (desktop) gsap.set(q('.hero__laptop'), laptopFrom);

  // Intro (time-based). Created paused so initial states apply at once; plays as soon as the laptop image is decoded
  // and fonts are in (capped at 400ms) so the first frames don't stutter on decode/reflow.
  const intro = gsap.timeline({ paused: true, defaults: { ease: 'power4.out' } });
  const img = q('.hero__laptop img')[0];
  const ready = Promise.all([
    img ? img.decode().catch(() => {}) : Promise.resolve(),
    document.fonts?.ready ?? Promise.resolve(),
  ]);
  Promise.race([ready, new Promise((r) => setTimeout(r, 400))]).then(() => requestAnimationFrame(() => intro.play()));
  intro
    .from(q('.hero__bg video, .hero__bg img'), { scale: 1.15, duration: 2.2, ease: 'power2.out' }, 0)
    .from(q('.hero__eyebrow'), { y: 24, opacity: 0, duration: .8 }, .3)
    .from(q('.hero__title .w'), { yPercent: 110, opacity: 0, rotate: 3, duration: 1.1, stagger: .06 }, .35)
    .from(q('.hero__lead'), { y: 28, opacity: 0, duration: .9 }, .9)
    .from(q('.hero__cta > *'), { y: 28, opacity: 0, duration: .8, stagger: .1 }, 1.05)
    // intro and scrub own different layers: .hero__rise (intro) vs .hero__laptop (scrub); .g1/.g2 (intro) vs .line-mask (scrub)
    .from(q('.hero__rise'), { y: 160, opacity: 0, duration: 1.6, ease: 'expo.out' }, .7)
    .from(q('.hero__ghost .g1, .hero__ghost .g2'), { yPercent: 100, opacity: 0, duration: 1.2, stagger: .1 }, .5);
  if (window.scrollY > 40) intro.progress(1).pause(); // not at the top (e.g. anchor link): skip the intro, no overlap with the scrub

  if (!desktop) return; // mobile: hero flows naturally, no pin

  // Scrub chapter: hero text exits, laptop rises to centre, portal chapter fades in
  const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: '+=220%', pin: true, scrub: 1.1, anticipatePin: 1 } });
  tl
    .to(q('.hero__copy'), { yPercent: -30, opacity: 0, duration: .22, ease: 'power2.in' }, 0)
    .to(q('.hero__ghost .line-mask:first-child'), { xPercent: -25, opacity: 0, duration: .3 }, 0)
    .to(q('.hero__ghost .line-mask:last-child'), { xPercent: 25, opacity: 0, duration: .3 }, 0)
    // explicit start values: from "filter: none" GSAP would infer brightness(0) and black out the hero on the first tick
    .fromTo(q('.hero__bg'), { scale: 1, filter: 'brightness(1) blur(0px)' }, { scale: 1.12, filter: 'brightness(.55) blur(4px)', duration: .45, immediateRender: false }, 0)
    .to(q('.hero__scroll'), { opacity: 0, duration: .1 }, 0)
    .fromTo(q('.hero__laptop'), laptopFrom, { x: 0, y: 0, scale: 1, duration: .45, ease: 'power2.inOut', immediateRender: false }, .05)
    .fromTo(q('.portal__head'), { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: .22, ease: 'power3.out' }, .24)
    .fromTo(q('.portal__feature'), { y: 60, opacity: 0, scale: .92 }, { y: 0, opacity: 1, scale: 1, duration: .22, stagger: .07, ease: 'back.out(1.4)' }, .36)
    .fromTo(q('.portal__cta'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: .18 }, .58)
    .to({}, { duration: .3 });
}

/* ---------------- Pillars: horizontal scroll ---------------- */
function initPillars() {
  const wrap = document.querySelector('#pillars');
  if (!wrap) return;
  const track = wrap.querySelector('.pillars__track');
  const panels = gsap.utils.toArray('.pillar', track);
  const bar = wrap.querySelector('.pillars__progress i');
  const count = wrap.querySelector('.pillars__count');
  if (reduced || isMobile() || panels.length < 2) {
    wrap.classList.add('is-static');
    return;
  }
  const scroll = () => track.scrollWidth - window.innerWidth;
  const tween = gsap.to(track, {
    x: () => -scroll(), ease: 'none',
    scrollTrigger: {
      trigger: wrap, start: 'top top', end: () => `+=${scroll()}`, pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true,
      onUpdate: (self) => {
        if (bar) bar.style.transform = `scaleX(${self.progress})`;
        if (count) count.textContent = String(Math.min(panels.length, Math.round(self.progress * (panels.length - 1)) + 1)).padStart(2, '0');
      },
    },
  });
  panels.forEach((p) => {
    const media = p.querySelector('.pillar__media > *');
    if (media) gsap.fromTo(media, { xPercent: -12, scale: 1.15 }, { xPercent: 12, scale: 1.15, ease: 'none', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
    gsap.from(p.querySelectorAll('.pillar__copy > *'), { y: 50, opacity: 0, stagger: .08, duration: .8, ease: 'power3.out', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left 70%', once: true } });
  });
}

/* ---------------- Word-by-word lighting ---------------- */
function initLit() {
  gsap.utils.toArray('[data-lit]').forEach((el) => {
    const split = new SplitText(el, { type: 'words', wordsClass: 'lit-word' });
    el.style.visibility = 'visible';
    gsap.fromTo(split.words, { opacity: .18 }, { opacity: 1, stagger: .02, ease: 'none', scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 45%', scrub: .6 } });
  });
}

/* ---------------- Testimonials: card stack ---------------- */
function initStack() {
  const cards = gsap.utils.toArray('.stack-card');
  if (!cards.length || reduced) return;
  cards.forEach((card, i) => {
    if (i === cards.length - 1) return;
    gsap.to(card, { scale: .94 - (cards.length - 2 - i) * .02, opacity: .55, ease: 'none', scrollTrigger: { trigger: cards[i + 1], start: 'top 85%', end: 'top 12%', scrub: true } });
  });
}

/* ---------------- Marquee (scroll-speed reactive) ---------------- */
function initMarquee() {
  gsap.utils.toArray('.marquee').forEach((m) => {
    const track = m.querySelector('.marquee__track');
    if (!track) return;
    track.innerHTML += track.innerHTML;
    const half = () => track.scrollWidth / 2;
    let x = 0, vel = 0, last = window.scrollY;
    gsap.ticker.add(() => {
      const dy = window.scrollY - last; last = window.scrollY;
      vel = Math.min(18, Math.abs(dy) * .35 + vel * .9);
      x -= (reduced ? 0 : .9) + vel;
      if (-x >= half()) x += half();
      track.style.transform = `translate3d(${x}px,0,0)`;
    });
  });
}

/* ---------------- Counters ---------------- */
function initCounters() {
  gsap.utils.toArray('[data-count]').forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const obj = { v: 0 };
    gsap.to(obj, { v: target, duration: 2, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true }, onUpdate: () => { el.textContent = String(Math.round(obj.v)); } });
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
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      setX(((e.clientX - r.left) / r.width - .5) * 12);
      setY(-((e.clientY - r.top) / r.height - .5) * 12);
    });
    card.addEventListener('pointerleave', () => { setX(0); setY(0); });
  });
  gsap.utils.toArray('[data-magnetic]').forEach((el) => {
    const mx = gsap.quickTo(el, 'x', { duration: .4, ease: 'power3' });
    const my = gsap.quickTo(el, 'y', { duration: .4, ease: 'power3' });
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); mx((e.clientX - r.left - r.width / 2) * .3); my((e.clientY - r.top - r.height / 2) * .3); });
    el.addEventListener('pointerleave', () => { mx(0); my(0); });
  });
}

/* ---------------- Videos: always muted, play only while visible ---------------- */
function initVideos() {
  const vids = gsap.utils.toArray('video');
  if (!vids.length) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    const v = e.target;
    if (e.isIntersecting && getComputedStyle(v).display !== 'none') v.play().catch(() => {});
    else v.pause();
  }), { rootMargin: '200px 0px', threshold: 0 });
  const observed = [];
  vids.forEach((v) => {
    v.muted = true; v.defaultMuted = true; v.volume = 0; v.setAttribute('muted', '');
    v.removeAttribute('autoplay');
    v.addEventListener('playing', () => v.classList.add('is-playing'), { once: true });
    if (getComputedStyle(v).display === 'none') { v.pause(); v.removeAttribute('src'); v.load(); return; }
    // the hero video lives inside a pinned scene: pin/unpin can confuse intersection reports, so it just plays
    if (v.closest('#hero')) { v.play().catch(() => {}); return; }
    io.observe(v); observed.push(v);
  });
  // after ScrollTrigger moves things around (pin spacers, refresh), re-observe to get a fresh intersection report
  ScrollTrigger.addEventListener('refresh', () => observed.forEach((v) => { io.unobserve(v); io.observe(v); }));
}

/* ---------------- Cursor glow (desktop only) ---------------- */
function initGlow() {
  if (coarse || reduced) return;
  gsap.utils.toArray('[data-glow]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--gx', `${e.clientX - r.left}px`);
      el.style.setProperty('--gy', `${e.clientY - r.top}px`);
    });
  });
}

/* ---------------- Boot / teardown (View Transitions aware) ---------------- */
function boot() {
  ctx?.revert();
  ScrollTrigger.getAll().forEach((t) => t.kill());
  ctx = gsap.context(() => {
    initTheme();
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
    initPointerFx();
    initGlow();
  });
  // fonts change line breaks → refresh after they load
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

initLenis();
document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', () => { ctx?.revert(); ScrollTrigger.getAll().forEach((t) => t.kill()); });
document.addEventListener('astro:after-swap', () => { lenis?.scrollTo(0, { immediate: true }); });
