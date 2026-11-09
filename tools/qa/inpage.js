/* Motion QA probes. Injected by qa.mjs before any page script (context.addInitScript) and read back through window.__qa.
   Plain browser JS, no dependencies. Every probe is read-only except watch()/activity, which only observe. */
(() => {
  if (window.top !== window || window.__qa) return;
  const now = () => performance.now();
  const r0 = (n) => Math.round(n);
  const qa = (window.__qa = { log: [], shifts: [], tasks: [], loafs: [], ft: [], fy: [], stuck: [], loaderAfterNav: 0 });
  const ev = (type, data) => qa.log.push({ type, t: r0(now()), ...data });

  /* ---------- helpers ---------- */
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return el ? el.nodeName : 'null';
    const cls = [...el.classList].filter((c) => !/^(split-|lit-word|is-)/.test(c)).slice(0, 2);
    const scope = el.id ? '' : el.parentElement?.closest('[id]')?.id || '';
    const txt = el.children.length < 3 ? (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) : '';
    return `${scope ? `#${scope} ` : ''}${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls.length ? `.${cls.join('.')}` : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const rr = (r) => r && { x: r0(r.x), y: r0(r.y), w: r0(r.width), h: r0(r.height) };
  const mx = (el) => { const t = getComputedStyle(el).transform; return new DOMMatrixReadOnly(t && t !== 'none' ? t : undefined); };
  const op = (el) => +getComputedStyle(el).opacity;
  const docTop = (el) => el.getBoundingClientRect().top + scrollY;
  const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
  qa.sel = sel;

  /* ---------- performance observers (buffered: they see the whole load) ---------- */
  const observe = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch {} };
  observe('layout-shift', (e) => qa.shifts.push({ t: r0(e.startTime), v: +e.value.toFixed(4), input: e.hadRecentInput, src: (e.sources || []).slice(0, 3).map((s) => ({ el: sel(s.node), from: rr(s.previousRect), to: rr(s.currentRect) })) }));
  observe('longtask', (e) => qa.tasks.push({ t: r0(e.startTime), d: r0(e.duration) }));
  observe('long-animation-frame', (e) => qa.loafs.push({ t: r0(e.startTime), d: r0(e.duration), block: r0(e.blockingDuration), scripts: (e.scripts || []).slice(0, 3).map((s) => `${s.sourceFunctionName || s.invoker || '?'} ${(s.sourceURL || '').split('/').pop()} ${r0(s.duration)}ms`) }));

  /* ---------- frame clock: one timestamp + scrollY per rendered frame ---------- */
  // scrollY comes from a passive scroll listener: reading it inside rAF forced style + layout (298 ms on the first frame)
  let sy = scrollY;
  addEventListener('scroll', () => { sy = scrollY; }, { passive: true });
  addEventListener('pageshow', (e) => ev('pageshow', { persisted: e.persisted }));
  let loaderState = 0; // 0 not seen, 1 present, 2 removed
  const tick = (t) => {
    qa.ft.push(t); qa.fy.push(sy);
    const has = !!document.getElementById('loader');
    if (loaderState === 0 && has) { loaderState = 1; ev('loader:seen'); }
    else if (loaderState === 1 && !has) { loaderState = 2; ev('loader:removed'); }
    else if (loaderState === 2 && has) qa.loaderAfterNav++; // a loader painted after a client-side navigation
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  qa.frameStats = (a, b) => {
    const d = []; let step = 0;
    for (let i = 1; i < qa.ft.length; i++) {
      if (qa.ft[i - 1] < a || qa.ft[i] > b) continue;
      d.push(qa.ft[i] - qa.ft[i - 1]); step = Math.max(step, Math.abs(qa.fy[i] - qa.fy[i - 1]));
    }
    if (d.length < 2) return null;
    const s = [...d].sort((x, y) => x - y), q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    const hist = { '<=17': 0, '17-25': 0, '25-34': 0, '34-50': 0, '50-100': 0, '>100': 0 };
    d.forEach((v) => { hist[v <= 17.5 ? '<=17' : v <= 25 ? '17-25' : v <= 34 ? '25-34' : v <= 50 ? '34-50' : v <= 100 ? '50-100' : '>100']++; });
    // dropped = frames a 60 Hz screen would have missed (rAF may tick faster on a high-refresh display)
    return { frames: d.length, ms: r0(b - a), refreshHz: r0(1000 / q(0.5)), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +s[s.length - 1].toFixed(1), dropped: d.reduce((n, v) => n + Math.max(0, Math.round(v / 16.67) - 1), 0), hist, maxScrollStep: r0(step) };
  };

  /* ---------- loader + router events ---------- */
  // same pick as motion.js initLoader: the hero laptop, else the first eager image in the first viewport (a lazy one below never decodes)
  const heroImg = () => { const i = document.querySelector('.hero__laptop img') || [...document.querySelectorAll('main img')].find((x) => x.loading !== 'lazy' && x.getBoundingClientRect().top < innerHeight); return i ? { complete: i.complete, w: i.naturalWidth } : null; };
  // layout boxes without transforms (offset chain + each offsetParent's border: a transformed ancestor becomes the
  // offsetParent mid-reveal and its 1 px border went missing): a change here is a real reflow, not an animation.
  // Keyed by index into one element list; names come later (boxNames), building them at the wipe start cost ~18 ms.
  let boxEls = [];
  qa.boxes = () => {
    if (!boxEls[0]?.isConnected) boxEls = [...document.querySelectorAll('main h1, main h2, main p, main img, main video, main .btn, .nav__inner, footer')];
    const out = { doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
    boxEls.forEach((el, i) => {
      let x = 0, y = 0;
      for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft + (e.offsetParent?.clientLeft || 0); y += e.offsetTop + (e.offsetParent?.clientTop || 0); }
      if (y < innerHeight * 1.5) out[i] = [x, y, el.offsetWidth, el.offsetHeight];
    });
    return out;
  };
  qa.boxNames = () => boxEls.map(sel);
  // layout when motion.js refreshes ScrollTrigger and lifts the loader, and in the first frame the visitor sees
  document.addEventListener('loader:done', () => {
    ev('loader:done', { fonts: document.fonts?.status, img: heroImg(), boxes: qa.boxes() });
    requestAnimationFrame(() => ev('loader:frame', { boxes: qa.boxes() }));
  });
  for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel'])
    document.addEventListener(type, (e) => { if (e.target.id === 'loader') ev(`loader:${type.slice(10)}`, { prop: e.propertyName }); }, true);
  for (const type of ['astro:before-preparation', 'astro:before-swap', 'astro:after-swap', 'astro:page-load'])
    document.addEventListener(type, () => ev(type, { path: location.pathname }));

  /* ---------- visibility of reveal-type elements ---------- */
  const clipClosed = (cp) => !!cp && cp !== 'none' && (/inset\((?:[^)]*\s)?100%/.test(cp) || /circle\(0(?:px|%)?[\s)]/.test(cp));
  // why an element is not visible right now (null = visible). Opacity is multiplied up to `stop` (its scene) so a faded scene is not blamed on the child.
  const hiddenReason = (el, stop) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return null; // not rendered on this layout: not a reveal problem
    if (cs.visibility === 'hidden') return 'visibility:hidden';
    let o = 1;
    for (let e = el; e && e !== stop && e !== document.body; e = e.parentElement) o *= op(e);
    if (o < 0.05) return `opacity ${o.toFixed(2)}`;
    if (clipClosed(cs.clipPath)) return `clip-path ${cs.clipPath}`;
    const m = mx(el);
    if (Math.hypot(m.m41, m.m42) > 40) return `translate ${r0(m.m41)},${r0(m.m42)}`;
    if (Math.abs(m.a * m.d - m.b * m.c) < 0.05) return 'scale 0';
    return null;
  };
  const reason = (el) => {
    if (el.matches('[data-count]')) return +el.dataset.count > 0 && el.textContent.trim() === '0' ? 'counter still 0' : null;
    const scene = el.closest('[data-scene]');
    const own = hiddenReason(el, scene);
    if (own || !el.matches('[data-split]')) return own;
    // split text: the animated parts are the finest split level present (chars > words > lines)
    let parts = el.querySelectorAll('.split-char');
    if (!parts.length) parts = el.querySelectorAll('.split-word');
    if (!parts.length) parts = el.querySelectorAll('.split-line');
    if (!parts.length) return null;
    let hidden = 0;
    parts.forEach((p) => {
      let o = 1;
      for (let e = p; e && e !== el; e = e.parentElement) o *= op(e);
      if (o < 0.05 || Math.abs(mx(p).m42) > p.offsetHeight * 0.5) hidden++;
    });
    return hidden / parts.length >= 0.5 ? `split ${hidden}/${parts.length} parts hidden` : null;
  };
  const CANDS = '[data-reveal], [data-split], [data-stagger] > *, [data-lit], [data-count], .pillar__copy > *';
  const HERO_INTRO = '#hero :is(.hero__eyebrow, .hero__title .w, .hero__lead, .hero__cta > *, .hero__rise)';
  const PORTAL = '#hero :is(.portal__head, .portal__feature, .portal__cta)';
  const heroPinned = () => !!document.querySelector('#hero')?.parentElement?.classList.contains('pin-spacer');
  const candidates = () => {
    const els = [...document.querySelectorAll(CANDS)].filter((e) => !e.closest('#hero, .menu, [hidden]'));
    // the pinned desktop hero is scrubbed (its copy fades by design): its states are checked by the pin pass instead.
    // Outside the pinned layout (same media query as index.astro) the Doctor Portal is plain content and must show.
    if (!heroPinned()) els.push(...document.querySelectorAll(HERO_INTRO));
    if (!matchMedia('(min-width: 1181px) and (prefers-reduced-motion: no-preference)').matches) els.push(...document.querySelectorAll(PORTAL));
    return els;
  };
  qa.reason = reason;
  // every candidate that is hidden right now, wherever it is (reduced motion: nothing may wait for a scroll)
  qa.hiddenAll = () => candidates().map((el) => [el, reason(el)]).filter(([, r]) => r).map(([el, r]) => ({ el: sel(el), reason: r, top: r0(docTop(el)) }));
  qa.hiddenInView = () => candidates().filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.bottom > innerHeight * 0.1 && r.top < innerHeight * 0.8 && r.right > 0 && r.left < innerWidth; })
    .map((el) => [el, reason(el)]).filter(([, r]) => r).map(([el, r]) => ({ el: sel(el), reason: r }));

  // stuck-reveal watcher: an element that has been inside the viewport band for > STUCK_MS and is still hidden.
  // Band = 10%..80% of the viewport height (past every trigger line used by motion.js: 70-86%).
  // At the very end of the page any visible sliver counts too: a trigger the page can never scroll to is a bug.
  // A flagged element keeps being watched: revealedAfterMs tells a late reveal from one that never came.
  const STUCK_MS = 1500;
  let ioBand, ioAny, timer;
  const inBand = new Map(), inAny = new Map(), flagged = new WeakMap();
  let bottomSince = 0;
  const startWatch = () => {
    ioBand?.disconnect(); ioAny?.disconnect(); inBand.clear(); inAny.clear();
    const track = (map) => (es) => es.forEach((e) => { if (e.isIntersecting) { if (!map.has(e.target)) map.set(e.target, now()); } else map.delete(e.target); });
    ioBand = new IntersectionObserver(track(inBand), { rootMargin: '-10% 0px -20% 0px' });
    ioAny = new IntersectionObserver(track(inAny));
    candidates().forEach((el) => { ioBand.observe(el); ioAny.observe(el); });
  };
  qa.watch = () => {
    if (timer) return;
    startWatch();
    document.addEventListener('astro:page-load', () => setTimeout(startWatch, 50));
    timer = setInterval(() => {
      const t = now(), atEnd = scrollY >= maxScroll() - 2;
      bottomSince = atEnd ? bottomSince || t : 0;
      const check = (el, since, where) => {
        if (t - since < STUCK_MS || !el.isConnected) return;
        const f = flagged.get(el);
        if (f) { if (f.revealedAfterMs == null && !reason(el)) f.revealedAfterMs = r0(t - f.since); return; }
        const why = reason(el);
        if (why) { const e = { el: sel(el), reason: why, where, y: r0(scrollY), path: location.pathname, inViewMs: r0(t - since), since, revealedAfterMs: null }; flagged.set(el, e); qa.stuck.push(e); }
      };
      inBand.forEach((since, el) => check(el, since, 'viewport'));
      if (bottomSince && t - bottomSince > STUCK_MS) inAny.forEach((since, el) => check(el, Math.max(since, bottomSince), 'page end'));
    }, 400);
  };

  /* ---------- layout detectors ---------- */
  qa.overflow = () => {
    const se = document.scrollingElement, W = innerWidth;
    let canScrollX = false;
    if (se.scrollWidth > se.clientWidth + 1) { const x = se.scrollLeft; se.scrollLeft = 80; canScrollX = se.scrollLeft > 0; se.scrollLeft = x; }
    // visible content cut by the screen edge: only main/body/html (the global clip) keep it from widening the page
    const cut = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.children.length && !/^(IMG|VIDEO|BUTTON|A|INPUT|P|H[1-6]|LI)$/.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || (r.right <= W + 1 && r.left >= -1)) continue;
      if (el.closest('[aria-hidden="true"], .menu, #loader, .sr-only, svg')) continue; // decorative bleed, closed menu, icons
      let L = r.left, R = r.right;
      for (let a = el.parentElement; a && a !== document.body && a.tagName !== 'MAIN'; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') { const ar = a.getBoundingClientRect(); L = Math.max(L, ar.left); R = Math.min(R, ar.right); }
      }
      if ((R > W + 1 || L < -1) && R > L && !hiddenReason(el)) cut.push({ el: sel(el), left: r0(L), right: r0(R) });
      if (cut.length >= 12) break;
    }
    return { scrollWidth: se.scrollWidth, innerWidth: W, canScrollX, cut };
  };
  // fixed UI (nav, floating buttons, cookie bar) covering interactive elements or headings
  qa.fixedOverlap = () => {
    const fixed = [...document.querySelectorAll('.nav, .floats > *, .consent:not([hidden])')].map((f) => [f, f.getBoundingClientRect()]).filter(([, r]) => r.width && r.height);
    const out = [];
    for (const el of document.querySelectorAll('main a, main button, main input, main select, main textarea, main h1, main h2, main h3, footer a')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth || hiddenReason(el)) continue;
      for (const [f, fr] of fixed) {
        const ix = Math.max(0, Math.min(r.right, fr.right) - Math.max(r.left, fr.left)), iy = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top));
        const frac = (ix * iy) / (r.width * r.height);
        if (frac > 0.3) out.push({ el: sel(el), under: f.classList.contains('nav') ? 'nav' : sel(f), frac: +frac.toFixed(2) });
      }
    }
    return out;
  };

  // invisible links/buttons that still take clicks: hit tests on a 24 px grid (the hidden Doctor Portal CTAs once sat over
  // the hero buttons). The before/after range (.ba) is a transparent control on purpose. `over` names the visible control
  // the ghost steals the click from; null = nothing visible there (an entrance that has not played yet).
  qa.ghosts = () => {
    const CTL = 'a, button, input, select, textarea, [role="button"]', res = new Map(), opa = new Map();
    const eff = (a) => { if (!opa.has(a)) { let o = 1; for (let p = a; p && o >= 0.1 && p !== document.documentElement; p = p.parentElement) o *= op(p); opa.set(a, o); } return opa.get(a); };
    for (let x = 12; x < innerWidth; x += 24) for (let y = 12; y < innerHeight; y += 24) {
      const stack = document.elementsFromPoint(x, y), a = stack[0]?.closest(CTL);
      if (!a || a.closest('.ba') || eff(a) >= 0.1) continue;
      const under = stack.find((e) => e.matches(CTL) && !a.contains(e) && !e.contains(a) && eff(e) >= 0.1);
      const h = res.get(a) || { n: 0, over: null };
      h.n++; h.over ??= under ? sel(under) : null;
      res.set(a, h);
    }
    return [...res].map(([a, h]) => ({ el: sel(a), href: a.getAttribute('href'), areaPx: h.n * 576, over: h.over }));
  };
  // the focused element: on screen, visible, and no overflow:hidden ancestor scrolled by the focus (the pillars track once
  // slid sideways for good). The before/after range input is transparent by design (its figure shows the focus ring).
  qa.focusState = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect(), scrolled = [];
    let o = getComputedStyle(el).visibility === 'hidden' ? 0 : 1;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) o *= op(p);
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((a.scrollLeft && cs.overflowX === 'hidden') || (a.scrollTop && cs.overflowY === 'hidden')) scrolled.push(`${sel(a)} scrolled to ${r0(a.scrollLeft)},${r0(a.scrollTop)}`);
    }
    return { el: sel(el), y: r0(scrollY), onScreen: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth, opacity: +o.toFixed(2), scrolled, exempt: el.matches('.ba__range') };
  };

  /* ---------- pinned scenes ---------- */
  qa.pins = () => [...document.querySelectorAll('.pin-spacer')].map((sp) => {
    const pin = sp.firstElementChild, next = sp.nextElementSibling;
    const st = window.__qaLib?.ScrollTrigger?.getAll().find((s) => s.pin === pin);
    return {
      id: pin.id || sel(pin), top: r0(docTop(sp)), spacerH: sp.offsetHeight, pinH: pin.offsetHeight, dist: sp.offsetHeight - pin.offsetHeight,
      next: next && sel(next), nextTop: next ? r0(docTop(next)) : null, st: st ? { start: r0(st.start), end: r0(st.end) } : null,
    };
  });
  qa.pinNow = (id) => {
    const pin = document.getElementById(id), next = pin?.parentElement?.nextElementSibling;
    return pin && { pos: getComputedStyle(pin).position, rect: rr(pin.getBoundingClientRect()), nextTop: next ? r0(next.getBoundingClientRect().top) : null };
  };
  // a full-screen pin is active while its spacer spans the whole viewport
  qa.pinnedNow = () => [...document.querySelectorAll('.pin-spacer')].some((sp) => { const r = sp.getBoundingClientRect(); return r.top < -1 && r.bottom > innerHeight + 1; });
  qa.hero = () => {
    const h = document.querySelector('#hero');
    if (!h) return null;
    const o = (s) => { const e = h.querySelector(s); return e ? +op(e).toFixed(2) : null; };
    const lap = h.querySelector('.hero__laptop'), img = lap?.querySelector('img'), m = lap && mx(lap);
    const portal = [...h.querySelectorAll('.portal__head, .portal__feature, .portal__cta')].map((e) => e.getBoundingClientRect());
    const pr = portal.length && portal.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }));
    const ir = img?.getBoundingClientRect();
    const overlap = pr && ir ? r0(Math.max(0, Math.min(pr.right, ir.right) - Math.max(pr.left, ir.left)) * Math.max(0, Math.min(pr.bottom, ir.bottom) - Math.max(pr.top, ir.top))) : 0;
    return {
      pinned: heroPinned(), copy: o('.hero__copy'), introHidden: [...h.querySelectorAll(HERO_INTRO.replace('#hero ', ''))].filter((e) => op(e) < 0.95).length,
      portalHead: o('.portal__head'), features: [...h.querySelectorAll('.portal__feature')].map((e) => +op(e).toFixed(2)), portalCta: o('.portal__cta'),
      laptop: m && { x: r0(m.m41), y: r0(m.m42), s: +Math.hypot(m.a, m.b).toFixed(3) }, laptopRect: ir && rr(ir),
      laptopCut: !!ir && (ir.left < -1 || ir.right > innerWidth + 1 || ir.top < -1 || ir.bottom > innerHeight + 1), portalLaptopOverlapPx: overlap,
      video: (() => { const v = h.querySelector('video'); return v && { display: getComputedStyle(v).display, paused: v.paused, src: v.hasAttribute('src'), playing: v.classList.contains('is-playing'), t: +v.currentTime.toFixed(2) }; })(),
    };
  };
  qa.pillars = () => {
    const w = document.querySelector('#pillars');
    if (!w) return null;
    const tr = w.querySelector('.pillars__track'), ps = [...tr.children], a = ps[0].getBoundingClientRect(), z = ps[ps.length - 1].getBoundingClientRect();
    const bar = w.querySelector('.pillars__progress i');
    return { static: w.classList.contains('is-static'), n: ps.length, trackX: r0(mx(tr).m41), firstLeft: r0(a.left), lastLeft: r0(z.left), lastRight: r0(z.right), bar: bar ? +mx(bar).a.toFixed(3) : null, count: w.querySelector('.pillars__count')?.textContent };
  };
  // compact state used to compare "same place, same look" (fresh load vs back-to-top vs after navigation)
  qa.signature = () => ({
    path: location.pathname, y: r0(scrollY), h: document.documentElement.scrollHeight, navSolid: !!document.querySelector('.nav')?.classList.contains('is-solid'),
    lenis: document.documentElement.classList.contains('lenis'), theme: document.documentElement.dataset.theme,
    pins: qa.pins().map((p) => [p.id, p.spacerH]), hero: qa.hero(), pillars: qa.pillars(), hiddenInView: qa.hiddenInView().length,
  });

  /* ---------- scroll helpers ---------- */
  // resolves when scrollY has not changed for `stable` frames and Lenis is not animating (timeout-safe for hidden tabs)
  qa.settle = (stable = 8, timeout = 5000) => new Promise((res) => {
    let last = -1, n = 0;
    const t0 = now();
    const done = (timedOut) => res({ y: r0(scrollY), ms: r0(now() - t0), timedOut });
    const to = setTimeout(() => done(true), timeout);
    const f = () => {
      const busy = document.documentElement.classList.contains('lenis-scrolling');
      n = scrollY === last && !busy ? n + 1 : 0; last = scrollY;
      if (n >= stable) { clearTimeout(to); done(false); } else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  qa.scenes = () => [...document.querySelectorAll('[data-scene]')].map((s) => {
    const sp = s.parentElement?.classList.contains('pin-spacer') ? s.parentElement : s;
    return { id: s.id || sel(s), top: r0(docTop(sp)) };
  });
  qa.maxScroll = maxScroll;

  /* ---------- reduced-motion activity: inline style writes = a JS animation is running ---------- */
  let mo, act;
  qa.activity = {
    start() { mo?.disconnect(); act = new Map(); mo = new MutationObserver((ms) => ms.forEach((m) => act.set(m.target, (act.get(m.target) || 0) + 1))); mo.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true }); },
    stop() { mo?.disconnect(); return [...(act || [])].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([el, n]) => ({ el: sel(el), writes: n })); },
  };
  // reduced motion: watch from the first parse, so an intro that plays behind or right after the loader is seen too
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.addEventListener('DOMContentLoaded', () => qa.activity.start(), { once: true });
})();
