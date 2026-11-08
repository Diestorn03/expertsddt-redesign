# DDT Xchange · UI design

Implementable spec of the tool page `/ddt-xchange/` (EN) and `/es/ddt-xchange/` (ES): page structure, the 4-step
wizard, the 3D viewer, the geometry library, export, the email gate, the sample case, accessibility and **all copy in
English and Spanish**. Engine APIs are in `CONTRACTS.md`; nothing here changes them. Status: design only
(2026-11-07); `state/`, `viewer/` and `ui/` are still empty.

Contents: 0 Read me first · 1 Where it lives · 2 Page structure · 3 Site integration contract · 4 Workspace layout ·
5 Wizard · 6 3D viewer · 7 Geometry library · 8 Export · 9 Email gate · 10 Sample case · 11 Accessibility ·
12 Copy (EN/ES) · 13 Site dictionary keys · 14 Implementation map and acceptance · 15 Decisions and open questions

---

## 0. Read me first

### 0.1 Sources

- Engine: `README.md`, `CONTRACTS.md`, `core/errors.ts` (39 error codes, 9 warning codes), `core/limits.ts`,
  `align/metrics.ts` (`DEFAULT_QUALITY`), `align/client.ts`, `detect/sites.ts`, `detect/assembly.ts`, `export/*`.
- Behavior: `DDT-XCHANGE-SPEC.md` §1, §4.4-4.6, §6, §7.2; Fernando's videos of 2026-11-05 (12.57.30 and 8.47.45);
  prototype screens `work/sheets/v01_*`, `v02_*`. The prototype is a behavior reference only: no code, data or copy
  is reused.
- Site: `src/styles/global.css`, `src/layouts/Base.astro`, `src/scripts/motion.js`, `src/components/{LibraryDownload,
  Cta,Analytics,Apex}.astro`, `src/pages/{index,services,exocad-libraries,contact}.astro`, `src/i18n/*`,
  `public/.htaccess`, `docs/n8n/web-leads.workflow.json`.

### 0.2 Rules for the implementer

1. **It is a section of expertsddt.com, not an app embedded in it.** Same tokens, type, buttons, cards, pills, radii,
   shadows, eases and motion attributes. No new font, no new brand color, no UI kit, no CSS framework.
2. **Files never leave the computer.** The only request the tool makes is the marketing email POST. No input file name
   is ever stored, shown, logged, announced, sent or exported.
3. **Clicks, not settings.** Picking a geometry applies it. Loading the jaw starts alignment. Every automatic action can
   be undone or cancelled.
4. **Never guess silently.** Whatever the engine flags (provisional, rotation unknown, ambiguous, weak) is said in plain
   words where the user is looking.
5. **The main thread stays free.** Parsing, detection, alignment and export run in workers; the 3D view renders only
   when something changed.
6. **Every pointer action has a keyboard path** (WCAG 2.2 AA).

### 0.3 Glossary (fixed terms in both languages)

| Concept | EN | ES | Note |
|---|---|---|---|
| Arch | arch (upper / lower) | arcada (superior / inferior) | A label only: ZIP name, report, Occlusal view |
| Capture | capture | captura | Position file(s) and/or a capture mesh |
| Position file | position file | archivo de posiciones | |
| Capture mesh | capture mesh | malla de captura | The scanned scan bodies as STL/PLY/OBJ |
| Scan body | scan body | scan body | The site's Spanish already keeps the English term |
| Healing cap | healing cap | pilar de cicatrización | Store wording |
| Capture scan body | capture scan body | scan body de la captura | Body fitted to a capture mesh to read positions (step 1) |
| Replacement geometry | replacement geometry | geometría de reemplazo | Placed on every implant in the export (step 2) |
| Geometry library | Your geometries | Tus geometrías | Avoids clashing with the site's downloadable "Exocad libraries / librerías" |
| Jaw scan | jaw scan | escaneo de la arcada | The tissue scan from the intraoral scanner |
| Implant set (assembly) | implant set | conjunto de implantes | All replacements, moved as one rigid body |
| Guided points | guided points 1–2–3–4 | puntos guiados 1–2–3–4 | |
| Color map | color map | mapa de color | Unsigned distance, 0–100 µm |

Copy is **American English** (the site writes "patient-centered", "customized") and neutral Latin American Spanish with
*tú* ("computadora", "mouse"), like `es.js`. µm is U+00B5.

---

## 1. Where the tool lives and how visitors find it

| Item | Decision |
|---|---|
| URL | `/ddt-xchange/` and `/es/ddt-xchange/` (trailing slash like every page). `src/pages/ddt-xchange.astro` plus the one-line wrapper `src/pages/es/ddt-xchange.astro` (`import Page from '../ddt-xchange.astro'; <Page />`) |
| Layout | `<Base title={t.meta.xchange} description={t.meta.xchangeDesc}>`. Nav, footer, theme toggle, language link, loader, cookie banner and floats come from Base unchanged |
| Footer (every page) | New link in the "Doctor portal" column right after "Free Exocad libraries": `t.footer.xchange` → `href('/ddt-xchange/')` |
| /exocad-libraries/ | New band between the three step cards and `<Cta>` (same audience: Exocad users looking for free resources). Markup in §2.6 |
| Main nav | **Not added.** The bar already holds 6 links + language + theme + cart + booking and collapses at 1180 px; a utility page does not earn a top-level slot. Revisit with launch analytics |
| /services/ | Not linked: paid design services, where a free-tool CTA competes with booking. The tool page itself ends with the site `<Cta>` toward design services |
| SEO | The sitemap picks the page up; Base emits canonical and hreflang. Optional `SoftwareApplication` JSON-LD through Base's `head` slot (§2.1) |
| Smoke test | Add `/ddt-xchange/` and `/es/ddt-xchange/` to the "200" list in `scripts/smoke.mjs` |

---

## 2. Page structure

Top to bottom, every block is an existing site section type:

| # | Block | Section | Motion (site attributes, used exactly as on the other pages) |
|---|---|---|---|
| 1 | Hero / intro | `section.page-hero[data-nav-solid-from][data-scene]` + `.grid-bg` | pill, lead, CTA row and privacy line `data-reveal="up"` with `data-delay` .3/.45/.55; h1 `data-split="words"`; visual `data-reveal="iris"`; primary button `data-magnetic` (as /exocad-libraries/) |
| 2 | Workspace | `section.section#workspace[data-scene]` | header `[data-reveal-scope]`: eyebrow `data-reveal="up"`, h2 `data-split="lines"` with `.underline-accent`, lead `data-reveal="up" data-delay=".2"`; the tool card inside a single-child `[data-stagger=".1"]` wrapper (§2.2) |
| 3 | How it works + help and limits | `section.section.section--mist#help[data-scene]` | header as above; `.grid-4[data-stagger=".12"]` step cards; `.grid-3[data-stagger=".12"]` cards; shortcuts table `data-reveal="up"` |
| 4 | FAQ | `section.section#faq[data-scene]` | header as above; list `[data-stagger=".06"]` |
| 5 | CTA | site `<Cta title text />` | its own `data-reveal="scale"` |

`c` below is the tool dictionary for the page language (§12), `t` the site dictionary.

### 2.1 Hero

```astro
<Fragment slot="head"><script type="application/ld+json" set:html={JSON.stringify(softwareApp)}></script></Fragment>
<section class="page-hero xch-hero" data-nav-solid-from data-scene>
  <div class="grid-bg" aria-hidden="true"></div>
  <div class="wrap grid-2">
    <div class="stack">
      <span class="pill" data-reveal="up">{c.hero.pill}</span>
      <h1 class="h-display" data-split="words">{c.hero.title}</h1>
      <p class="lead" data-reveal="up" data-delay=".3">{c.hero.lead}</p>
      <div class="cta-row" data-reveal="up" data-delay=".45">
        <a class="btn btn--white" href="#workspace" data-magnetic>{c.hero.start} <span class="arrow">↓</span></a>
        <a class="btn btn--ghost" href="#workspace" data-xch-demo>{c.hero.demo}</a>
      </div>
      <p class="xch-hero__privacy" data-reveal="up" data-delay=".55"><svg …lock… aria-hidden="true" /> {c.hero.privacy}</p>
    </div>
    <div class="xch-hero__visual" data-reveal="iris" aria-hidden="true">…</div>
  </div>
</section>
```

- Both buttons are `#workspace` anchors: motion.js already routes `a[href^="#"]` through Lenis (offset −70), so they
  smooth-scroll for free. `data-xch-demo` also starts the sample case (§10); a click before the tool is mounted is
  queued.
- Privacy line: `display:flex; gap:.5rem; align-items:center; font-size:.9rem; color:#c7d6ee`, 16 px lock icon in
  `#8fc1ff` (the hero's light-blue accent).
- Visual: the `.lib__disc` recipe of /exocad-libraries/ (conic gradient disc, inset ring, 30 s spin) copied into the
  page style as `.xch-hero__disc`, but only its ring layer spins; on top sits a static inline SVG (~2 KB, no image
  request): an arch outline in `#8fc1ff` with four white implant glyphs numbered 1–4. One `data-parallax="0.25"` on
  the ring (the `.about__orbit` precedent) is the only parallax on the page. At ≤ 960 px the visual goes above the copy
  at 240 px, like `.lib`.
- JSON-LD (optional, never executed so CSP does not apply): `{"@context":"https://schema.org","@type":
  "SoftwareApplication","name":"DDT Xchange","applicationCategory":"DesignApplication","operatingSystem":"Web browser",
  "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"inLanguage":lang,"publisher":{"@id":origin+"/#org"}}`.

### 2.2 Workspace section

```astro
<section id="workspace" class="section xch" data-scene aria-labelledby="xch-title">
  <div class="wrap">
    <header class="xch__head" data-reveal-scope>
      <div class="stack">
        <span class="eyebrow" data-reveal="up">{c.ws.eyebrow}</span>
        <h2 id="xch-title" class="h-xl" data-split="lines">{c.ws.title} <span class="underline-accent">{c.ws.titleAccent}</span></h2>
        <p class="lead" data-reveal="up" data-delay=".2">{c.ws.lead}</p>
      </div>
      <div class="xch__case cta-row" data-reveal="up" data-delay=".3"><!-- sample pill + Exit sample (hidden) · New case · Try a sample case --></div>
    </header>
    <div class="xch__reveal" data-stagger=".1">
      <div id="xchange" class="xch__shell card" data-lang={lang}><!-- §4 --></div>
    </div>
    <div class="xch__small card"><!-- §2.5 --></div>
    <noscript><p class="note">{c.ws.noscript}</p></noscript>
  </div>
  <div class="xch__toasts" role="status" aria-live="polite"></div>
  <p id="xch-status" class="sr-only" role="status" aria-live="polite"></p>
  <dialog id="xch-email" class="xch-dialog" aria-labelledby="xch-email-title" data-lenis-prevent>…§9…</dialog>
  <dialog id="xch-confirm" class="xch-dialog" aria-labelledby="xch-confirm-title" data-lenis-prevent>…§12.2…</dialog>
  <dialog id="xch-keys" class="xch-dialog xch-dialog--wide" aria-labelledby="xch-keys-title" data-lenis-prevent>…§6.8…</dialog>
</section>
```

Why the single-child wrapper: `data-stagger` animates its children with `clearProps: 'transform'`, so after the
entrance the tool card carries **no inline transform**. What `data-reveal` leaves behind (`translate(0,0)`) would make
the card a containing block for fixed descendants and puts the sticky stage at risk. Toasts, the live region and the
dialogs sit outside the card for the same reason. All four step panels are server-rendered inside `#xchange` (only the
current one without `hidden`), so static copy comes from Astro and the client never builds markup from strings.

### 2.3 Help and limits (`#help`)

Header (eyebrow, h2 with accent, lead) then:

1. "How it works": `.grid-4` of four `.card` items reusing the /exocad-libraries/ `.step` look (outlined numbers
   01–04 with `-webkit-text-stroke: 1.5px rgba(4,107,210,.5)`, h3 1.15rem, text). Copy §12.1 `help.how`.
2. `.grid-3` of three `.card` items: What you can import · Limits (numbers interpolated from `LIMITS`, never typed) ·
   Before you use the files.
3. A `.card` with the mouse and keyboard table (same rows as the in-tool dialog, §6.8), in a `<table>` wrapper with
   `overflow-x:auto`.

### 2.4 FAQ (`#faq`)

`<details class="xch-faq__item">` list with `<summary><h3>…</h3></summary>` (one heading per summary, allowed by the
content model), 18 px radius rows on `--mist`, chevron rotating .35 s `var(--ease-out)`. Opening animates only where
supported, CSS only: `.xch-faq { interpolate-size: allow-keywords } .xch-faq__item::details-content { block-size: 0;
overflow: clip; transition: block-size .5s var(--ease-out), content-visibility .5s allow-discrete }
.xch-faq__item[open]::details-content { block-size: auto }`; elsewhere it opens instantly. Ten items, §12.1.

### 2.5 Small screens (< 768 px)

- Query, shared by CSS and JS: `SMALL = (max-width: 767.98px) and (pointer: coarse), (max-width: 599.98px)`. Phones
  and small touch tablets under 768 px get the card; a desktop browser between 600 and 767 CSS px (a narrow window, or
  a 1280–1366 px laptop at 200 % zoom) keeps the one-column workspace, so zooming never locks a low-vision user out
  (WCAG 1.4.4). Below 600 px everything gets the card.
- CSS: `.xch__small { display: none }` and `@media SMALL { .xch__reveal, .xch__case { display: none } .xch__small {
  display: grid } }`.
- JS: while `SMALL` matches nothing heavy is created (no three.js, workers, WebGL context or IndexedDB). A change of
  `matchMedia(SMALL)` creates them when the window grows (a tablet rotated to landscape). A case is never destroyed when
  the window shrinks: the workspace hides and rendering pauses.
- Card: monitor/tablet line icon in the 54 px `--grad-blue` rounded square (the `.svc__icon` recipe), title, text,
  `[Copy link]` (`navigator.clipboard.writeText(location.origin + location.pathname)` → toast), `[Share link]` only
  when `navigator.share` exists. Hero, help and FAQ stay fully readable.

### 2.6 Band on /exocad-libraries/

```astro
<section class="section xch-band" data-scene>
  <div class="wrap">
    <div class="card card--grad xch-band__box" data-reveal="up">
      <div class="stack">
        <span class="pill">{l.xchange.pill}</span>
        <h2 class="h-lg">{l.xchange.title}</h2>
        <p>{l.xchange.text}</p>
      </div>
      <a class="btn btn--white" href={href('/ddt-xchange/')} data-magnetic>{l.xchange.cta} <span class="arrow">→</span></a>
    </div>
  </div>
</section>
```

Scoped style: `.xch-band { padding-top: 0 } .xch-band__box { display:flex; flex-wrap:wrap; align-items:center;
justify-content:space-between; gap:1.5rem 2rem } .xch-band h2 { color:#fff } .xch-band .stack { max-width:60ch }
.xch-band .pill { background: rgba(255,255,255,.14); color:#fff }` (the services `.guide__box` structure on the
`.res--free` gradient).

---

## 3. Site integration contract

### 3.1 Identity: reuse, never imitate

Reuse as-is: tokens `--blue --blue-dark --grad --grad-blue --navy-deep --ink --slate --muted --mist --line --surface
--radius --ease-out --font`; classes `.wrap .section .section--mist .eyebrow .h-xl .h-lg .lead .btn .btn--primary
.btn--outline .btn--white .btn--ghost .arrow .card .card--grad .pill .note .cta-row .stack .grid-2 .grid-3 .grid-4
.sr-only .underline-accent`; the field recipe of `contact.astro`/`LibraryDownload.astro` (12 px radius, 1.5 px `--line`
border, focus `border-color: var(--blue); box-shadow: 0 0 0 4px rgba(4,107,210,.15)`, min-height 48 px); the dialog
recipe of `LibraryDownload.astro` (24 px radius, `--surface`, `0 40px 100px -30px rgba(0,0,0,.6)`, backdrop
`rgba(10,26,58,.62)` + `blur(4px)`, 44 px round close button); the floating-card recipe of `.consent` for toasts (18 px
radius, `--surface`, `--line` border, `0 24px 60px -20px rgba(0,0,0,.5)`); the sub-card recipe of `.channels li`
(`--mist`, 16 px radius).

New tokens, only what the site lacks, defined on `.xch, .xch-dialog` in `src/xchange/ui/xchange.css` (dark values
under `[data-theme="dark"]`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--xch-stage` | `radial-gradient(130% 100% at 50% 0%, #fff 0%, var(--mist) 55%, #e2eaf4 100%)` | `radial-gradient(130% 100% at 50% 0%, #1d4f9a 0%, #0f346e 45%, #0a1a3a 100%)` (the home product-stage navy) | 3D stage background; the canvas is transparent |
| `--xch-glass` | `rgba(255,255,255,.9)` | `rgba(11,22,48,.88)` | toolbar, pad, legend, readout over the canvas. No `backdrop-filter`: it would re-blur on every rendered frame |
| `--xch-glass-line` | `rgba(29,50,115,.1)` | `rgba(143,193,255,.16)` | their 1 px border |
| `--xch-jaw` | `#e3c8bc` | `#d9c1b6` | jaw material |
| `--xch-part` | `#046bd2` | `#5aa7f5` | replacement geometry |
| `--xch-capture` | `#94a3b8` | `#8fa0bd` | captured scan bodies (ghost) |
| `--xch-active` | `#f59e0b` | `#fbbf24` | selected implant, current guided target, guided pins, Ctrl hint. A fill, never text: anything written on it uses `#1e293b` (6.8:1 light, 8.8:1 dark) |
| `--xch-ok` | `#166534` | `#4ade80` | good, found, success text |
| `--xch-info` | `var(--blue)` | `#8fc1ff` | acceptable |
| `--xch-warn` | `#92400e` | `#fbbf24` | weak, ambiguous, provisional, warnings |
| `--xch-bad` | `#b91c1c` | `#f87171` | no usable fit, errors, not recognized |
| `--xch-map-0` / `--xch-map-50` / `--xch-map-100` | `#86efac` / `#fbbf24` / `#dc2626` | same | color-map stops (data, not chrome) |

Chips: text in the status token on `color-mix(in srgb, <token> 10%, transparent)` (the `.pill` tint), 999px radius,
`.75rem` 600 with `.06em` tracking (the `.pill` voice), always icon + word. Computed WCAG contrast of each text token
on its 10 % tint over `--surface`: light ok 6.1, warn 6.1, bad 5.5, info 4.5 (the site's own `.pill` pair); dark ok
8.5, warn 9.0, bad 5.7, info 7.9. Re-check with axe (§14.3) if a value changes. The color-map stops have OKLab
lightness 0.871 → 0.837 → 0.577 (falling, §6.5).

### 3.2 Motion

**Page sections** move only through motion.js attributes (table in §2). Inside the workspace: no `data-parallax`,
`data-depth` or `data-tilt` (tilt would rotate controls under the pointer); `data-magnetic` only on the hero's primary
button and the /exocad-libraries/ band button, as the site does on its main CTAs.

**Inside the workspace** content is dynamic, so motion.js never sees it. The tool animates with GSAP (already bundled;
the same module instance motion.js uses) or CSS transitions, with this vocabulary only:

| Element | Trigger | Animation | Duration · ease |
|---|---|---|---|
| Step panel | step change | outgoing children `to({y:-16, opacity:0, stagger:.03})`; incoming children `fromTo({y:40, opacity:0, skewY:2}, {y:0, opacity:1, skewY:0, stagger:.06, clearProps:'transform,opacity'})`: the `data-stagger` move, smaller | .25 s `power2.in` · .7 s `power3.out` |
| Stepper track | step completed | fill `transform: scaleX(done/3)` | CSS .9 s `var(--ease-out)` |
| Stepper dot | becomes current | background → `--grad-blue`, number → white, `scale(1.08)` then 1 | CSS .35 s `var(--ease-out)` |
| Buttons | hover, press | the site `.btn` (shine sweep, −2 px lift, `.arrow` nudge 4 px), never restyled | site CSS |
| Busy button | job running | `.arrow` replaced by a 14 px ring spinner | CSS .8 s linear infinite |
| Drop zone | drag over | border → `--blue`, background `rgba(4,107,210,.06)`, `scale(1.01)` | CSS .35 s `var(--ease-out)` |
| Stage drop overlay | files dragged over the workspace | `clip-path: circle(0% → 150% at <pointer>)` (the mobile menu's iris) | .5 s `expo.out` |
| Progress bar | progress | `transform: scaleX(fraction)` | CSS .35 s `var(--ease-out)` |
| Indeterminate bar | parsing, export | the loader's own `loaderBar` keyframes (40 % bar, 1.1 s `cubic-bezier(.65,0,.35,1)` infinite), already global through Base's inline loader style; reuse the name, don't redefine it | infinite |
| Status chip | new result | `fromTo({scale:.86, opacity:0}, {scale:1, opacity:1})` (= `data-reveal="scale"`) | .6 s `back.out(1.6)` |
| Metric numbers | new result | count-up like `[data-count]` | .9 s `power3.out` |
| Table and list rows | rendered | `fromTo({y:24, opacity:0}, {y:0, opacity:1, stagger:.04, clearProps:'transform,opacity'})` | .6 s `power3.out` |
| Toast | show / hide | `y: 24 → 0` + opacity | .5 s `expo.out` · .3 s `power2.in` |
| Dialog | open / close | CSS `@starting-style { opacity:0; transform: translateY(16px) scale(.98) }`, backdrop fades; exit through `transition-behavior: allow-discrete` on `display, overlay` | .5 s `var(--ease-out)` · .3 s |
| Display popover | open | opacity + `translateY(-8px) → 0` | CSS .35 s `var(--ease-out)` |
| Camera preset, Fit, focus on an implant | click, key | slerp orientation, lerp target, geometric distance (`d0 · (d1 / d0)^t`) | .7 s `expo.out` = `EASE_OUT` in `ui/motion.ts` (≈ `--ease-out`); rotation center .35 s |
| Implant set after an alignment | result applied | slerp + lerp from the old pose to the new one | .9 s `expo.out` (≈ `--ease-out`) |
| Pad step (30°/5°, flip, move) | click | same pose tween | .35 s `power3.out` |
| Geometry applied | apply-on-pick | new part meshes `scale .85 → 1`, material opacity 0 → 1 | .5 s `back.out(1.4)` |
| Guided point pin | placed | `scale 0 → 1` | .45 s `back.out(1.6)` |
| Current guided target | waiting | label ring pulse (the `.fab__dot` `pulse` keyframes) | 2.2 s infinite |
| Floats (WhatsApp, Apex) | stage ≥ 50 % in view | `html.xch-in-view .floats { opacity:0; transform: translateY(16px); pointer-events:none }` (they would cover the stage's bottom-right corner; they come back on the help section) | CSS .35 s `var(--ease-out)` |

GSAP eases map to site tokens: `expo.out` ≈ `--ease-out` (`cubic-bezier(.16,1,.3,1)`), `power3.inOut` ≈ the loader
curve; `power3.out` and `back.out(1.6)` are what motion.js uses for reveals. No CustomEase. **No ScrollTrigger**:
motion.js kills every ScrollTrigger on each `astro:page-load`, so visibility uses IntersectionObserver. Every tween is
created inside one `gsap.context(…, root)` per mount and reverted on dispose. Interrupt, never queue: a new step change
first completes the running timeline (`tl.progress(1)`).

### 3.3 Lenis

- `data-lenis-prevent` on: `.xch__stage` (wheel = zoom, touch = camera), every tool `<dialog>`, the display popover,
  the library list (scrolls past 8 rows), the implant list (past 12 rows) and the per-implant table wrapper (past 12
  rows). The Lenis CSS already gives them `overscroll-behavior: contain`.
- The rest of the panel has **no** inner scroll: it grows with the page and the stage is sticky, so the wheel over the
  panel scrolls the page like everywhere else on the site.
- **Modal dialogs stop Lenis.** The instance is private to motion.js (`window.lenis` only holds the version), so
  motion.js gets a two-line event bridge, reusing the mobile menu's exact logic:

  ```js
  // motion.js, after initLenis(): app-like pages pause or drive the shared smooth scroll through events
  document.addEventListener('scroll-lock', (e) => (lenis ? (e.detail ? lenis.stop() : lenis.start()) : (document.body.style.overflow = e.detail ? 'hidden' : '')));
  document.addEventListener('scroll-to', (e) => (lenis ? lenis.scrollTo(e.detail, { offset: -90 }) : e.detail.scrollIntoView()));
  ```

  The tool dispatches `new CustomEvent('scroll-lock', { detail: true })` right after `showModal()` and `false` on the
  dialog's `close` event (and on dispose while a dialog is open). `scroll-to` (detail = element) brings the panel top
  into view after a step change, or an alert that appeared off-screen, only when it is outside the viewport.

### 3.4 View transitions lifecycle

```ts
// <script> in src/pages/ddt-xchange.astro (bundled by Astro: no inline script)
import { mount, type Mounted } from '../xchange/ui/main';
let app: Mounted | null = null;
document.addEventListener('astro:page-load', () => {
  const root = document.getElementById('xchange');
  if (!root || app) return; // another page, or already mounted
  app = mount(root);        // refuses a root that already has data-mounted
});
document.addEventListener('astro:before-swap', () => { app?.dispose(); app = null; });
```

- A bundled module runs once per full page load (the ClientRouter does not re-run it), so these listeners exist once.
  `mount()` is idempotent: it marks the root with `data-mounted` and returns early if the mark is there.
- `dispose()` does all of this, in order: cancel the pending `requestAnimationFrame`; `gsap.context.revert()` (kills
  camera, pose and UI tweens); abort the mount's `AbortController` (every DOM, window, document and `matchMedia`
  listener is registered with `{ signal }`); disconnect the ResizeObserver, IntersectionObservers and the theme
  MutationObserver; `alignClient.dispose()` and `jobs.dispose()` (terminate both workers); traverse the scene and
  dispose every geometry, material and texture, remove the `CSS2DRenderer` element; `renderer.dispose();
  renderer.forceContextLoss();` remove the canvas; revoke every object URL; clear timers; close open dialogs and
  dispatch `scroll-lock` `false`; `db.close()`; remove `html.xch-in-view`; drop all references.
- Acceptance: go /ddt-xchange/ ↔ /services/ ten times. One `<canvas>` on the tool page, no "Too many active WebGL
  contexts" warning, `renderer.info.memory` at 0 after each dispose, heap after GC within ±5 % of the first visit, no
  worker threads left in DevTools after leaving, dev-only `window.__xchMounts` equal to the number of visits.
- **Leave guard.** While the case holds unexported work (a capture imported, no export since the last change):
  `beforeunload` calls `preventDefault()` (the browser's own "Leave site?" prompt), and `astro:before-preparation`
  calls `event.preventDefault()`. In Astro 7.3 a prevented preparation falls back to `location.href = to.href`, a full
  navigation, which raises that same native prompt. No custom confirm, never `window.confirm`. Disarmed on New case,
  after a successful export, and on dispose. The language switch counts as leaving.

### 3.5 Fluidity budget

| Rule | How |
|---|---|
| Render on demand | No `setAnimationLoop`. `invalidate()` schedules one `requestAnimationFrame` if none is pending. Callers: controls (pointer, keys), GSAP `onUpdate` of camera and pose tweens, any state change that affects the picture, the ResizeObserver, the theme observer. Idle = zero frames |
| Pause off-screen | IntersectionObserver on the stage: not intersecting → renders skipped; `document.hidden` → skipped |
| 60 fps while interacting | Pixel ratio `min(devicePixelRatio, 2)`; if a frame during interaction takes > 18 ms, render at pixel ratio 1 until 250 ms after the last input, then one full-resolution frame |
| Heavy work off the main thread | New `jobs` worker (§14.1): parse meshes and position files, split, detect, link, `planAssembly`, `verifyAssemblyLayout`, display normals, `buildBundle`, library file read/write. The existing `AlignClient` worker: alignment, measure, deviation. Typed arrays are transferred when the sender does not keep them |
| Buffers uploaded once | One `BufferGeometry` per mesh, built once. Implants sharing a geometry share its position/index/normal `BufferAttribute`s and own only a color attribute. A pose change touches `object.matrix` only; a measurement uploads one color attribute per implant |
| No layout thrash | Labels move with `transform` inside the render callback (read the camera, write styles; never read layout there). Lists are built in a `DocumentFragment` and swapped in one write |
| Lazy 3D | The entry script is small (lifecycle, copy, state). `three` and `viewer/` load with `import()` when the workspace comes within one viewport height (IntersectionObserver `rootMargin: '100% 0px'`) or on the first `data-xch-demo` click, so three.js never competes with the hero's GSAP intro |
| Budgets | ≥ 55 fps orbiting a 1.5 M-triangle jaw at 1280×800 on a mid laptop; no main-thread task > 50 ms during alignment; a step change completes in ≤ .9 s |

### 3.6 Reduced motion

- Read `matchMedia('(prefers-reduced-motion: reduce)')` once per mount, as motion.js does.
- When it matches: every GSAP call of §3.2 becomes `gsap.set` to the end state; camera and pose changes are instant; no
  geometry scale-in, no pulse; CSS transitions and keyframes are already cut by `global.css`. Progress shows the
  determinate bar or the word "Working…", never the sliding bar.
- Essential feedback stays: colors, focus rings, text.
- The developer's PC forces reduced motion (Windows animations off): check every animated state with DevTools ›
  Rendering › Emulate CSS `prefers-reduced-motion: no-preference` (or Playwright `emulateMedia({ reducedMotion:
  'no-preference' })`).
- Site gap, not the tool's: motion.js still runs `data-reveal` movement, splits, parallax and counters under reduced
  motion (`global.css` only forces opacity). The fix belongs in motion.js (§15.2).

### 3.7 Theme

- Panel, dialogs and toasts use site tokens and switch by themselves.
- The stage background is CSS (`--xch-stage`; renderer `alpha: true`, clear alpha 0), so it follows the theme with the
  body's `.3s` transition.
- Materials and labels read `--xch-jaw`, `--xch-part`, `--xch-capture`, `--xch-active` with
  `getComputedStyle(stage)` at mount and on every change of `<html data-theme>` (one MutationObserver,
  `attributeFilter: ['data-theme']`), then `invalidate()`. The color map is the same in both themes.

### 3.8 CSP and privacy guardrails

- Today's header: `script-src 'self' 'unsafe-inline' …`, no `worker-src` (falls back to `script-src`), `connect-src
  'self' … https://n8n.wigoqd.easypanel.host …`, `img-src 'self' data: …`. The tool must keep working after
  `'unsafe-inline'` is removed:
  - no inline script, no `eval`/`new Function`, no CDN; workers are `new Worker(new URL('./x.worker.ts',
    import.meta.url), { type: 'module' })`, emitted under `/_astro/` (`'self'`), never `blob:` workers;
  - thumbnails are `data:` PNG URLs (`img-src` has no `blob:`);
  - the ZIP download is an `<a download>` on a `blob:` URL (a navigation, not governed by CSP), revoked later;
  - client-side text is set with `textContent` only; dynamic rows are cloned from server-rendered `<template>`s. No
    `innerHTML` with data anywhere.
- Network: one request type, `POST PUBLIC_N8N_FORM_WEBHOOK` (§9). Nothing is fetched at runtime (the sample case is
  generated in the browser, §10).
- File names: `file.name` is read only to take the lowercase extension (mesh hint, and the engine's refusal of
  `pic/tupel/beb/xlsx/xls`). It never reaches state, DOM, aria text, `document.title`, the console, IndexedDB,
  localStorage, toasts, the webhook or the ZIP. Every `<input type=file>` value is reset right after reading.
- Alerts show code + numbers + reason ids, per the `core/errors.ts` rule. The only text from a file the UI shows is an
  implant label, in the lists where the user already sees it. Multi-file errors name files by position ("File 2 of
  3"), never by name.

---

## 4. Workspace layout

Desktop ≥ 1180 px (designed at 1280×800; `.wrap` = 1200 px):

```
┌ .xch__shell.card (padding 12px, radius var(--radius)) ───────────────────────────────────────────────┐
│ .xch__stepper     (1) Arch & capture ─── (2) Geometry ─── (3) Jaw scan · optional ─── (4) Align & export │
├──────────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ .xch__panel      │ .xch__stage  sticky · top: calc(var(--nav-h) + 1rem)                              │
│ 340 px           │  height: clamp(560px, calc(100svh - var(--nav-h) - 2rem), 900px)                  │
│ eyebrow          │ ┌ toolbar  [Fit][Occlusal][Front][Back][Left][Right][Top]     [Display][?][⛶] ┐   │
│ h3               │ │ ▔▔▔▔▔ slim progress bar while a job runs                                     │   │
│ one sentence     │ │                                                                ┌ pad ┐       │   │
│ step body        │ │                 canvas + implant labels                        │ ⟲ ⟳ │       │   │
│ (grows with the  │ │                                                                │ ↑ ↓ │       │   │
│  page, no inner  │ │ ┌ legend ─────────────┐        readout "AXO2 · 42 µm"          └─────┘       │   │
│  scroll)         │ │ └ 0  25  50  75 100+ ┘                                                       │   │
│ [Back][Continue] │ └──────────────────────────────────────────────────────────────────────────────┘   │
└──────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

`.xch__body { display:grid; grid-template-columns: 340px minmax(0,1fr); gap:12px; align-items:start }`; the stage has
its own radius (`calc(var(--radius) - 6px)`), `overflow:hidden`, `background: var(--xch-stage)`, and the canvas fills
it. The shell card keeps the site `.card` shadow and border; its padding drops to 12 px so the stage reads as a
"screen" inside the card, like `.pillar__media`.

| Width | Layout |
|---|---|
| ≥ 1180 px | as drawn; view presets as text buttons |
| 960–1179 px | panel 300 px; presets collapse into one "View" menu button; pad icon-only |
| 768–959 px (tablet portrait) | one column in DOM order (so focus order = visual order): stepper (numbers + current label) → panel → stage (not sticky, `height: clamp(420px, 60svh, 640px)`). After an import or a pick the stage is brought into view with `scroll-to`. Touch moves the camera only; the implant set moves through the pad |
| 600–767 px with a mouse | the same one column (narrow desktop window, or a laptop at 200 % zoom) |
| < 768 px on touch, < 600 px on anything | §2.5 card |

**Stepper.** `<nav aria-label>` + `<ol>`, one `<button>` per step, 32 px circles on a 2 px `--line` track whose
`--blue` fill scales 0 → 1. Current: circle `--grad-blue`, white number, label `--ink` 600, `aria-current="step"`.
Done: `--blue` outline circle with a check, clickable. Available: outline circle, clickable. Locked: muted,
`aria-disabled="true"`, reason in `aria-describedby` and in a hover/focus tooltip. Labels `.78rem`, 600, `.12em`
tracking, uppercase (the `.eyebrow` voice); step 3 adds a muted "Optional" under its label.

**Panel anatomy** (every step): `.eyebrow` "Step n of 4" → `h3.h-lg` (`tabindex="-1"`, focus target on step change)
→ one sentence in `--slate` → step body → alert and warning area → footer `.cta-row` with `[← Back]` (`.btn--outline`)
and `[Continue →]` (`.btn--primary` + `.arrow`). Continue uses `aria-disabled` (stays focusable) with a visible
one-line reason under it while disabled. Panel padding `1.25rem 1rem`.

- Compact secondary buttons: `.btn--outline` at the `.consent .btn` size (`padding:.6rem 1rem; min-height:42px;
  font-size:.85rem`).
- Disabled look, missing from `global.css`: `.xch .btn[aria-disabled="true"] { opacity:.5; cursor:not-allowed;
  transform:none; box-shadow:none } .xch .btn[aria-disabled="true"]::after { display:none }`.
- Sub-cards (sources, jaw card, result card): the `.channels li` recipe (`--mist`, 16 px radius, `1rem 1.1rem`).
- Alerts: sub-card with a 3 px left border in `--xch-bad`, icon, bold title, body, muted `.8rem` "Code: …" line,
  `[Dismiss]`. Warnings: same with `--xch-warn`, no dismiss (they clear on the next import).
- Drop zone: `border: 2px dashed var(--line); border-radius:18px; background: var(--mist); padding:1.6rem;
  text-align:center`; the upload icon in the 54 px `--grad-blue` rounded square; title 600; "or"; `[Choose files]`
  (`.btn--primary`); formats line `.85rem` `--muted`. The whole stage also accepts drops (overlay copy per step,
  §12.3).

---

## 5. The wizard

### 5.1 Case state the UI works on (`state/`)

```ts
interface CaseState {
  arch: Arch | null;
  sources: { kind: 'positions' | 'mesh' | 'sample'; format: CaptureFormat; count: number }[]; // never a name
  sites: ImplantSite[];                     // merged, ids re-numbered site-1..n
  captureMesh?: TriMesh;
  components?: MeshComponent[];             // splitComponents(captureMesh)
  fits?: ComponentFit[]; unresolved: number[];
  referenceId: string | null;               // capture scan body (mesh-only captures)
  confirmed: Set<string>; excluded: Set<string>; // provisional sites confirmed / left out
  geometryBySite: Record<string, string>;   // site id -> geometry id (library or case-only)
  caseGeometries: Map<string, ReplacementGeometry>; // sample, positioned assemblies
  jaw: JawScan | null; jawSkipped: boolean;
  matchSurfaces: 'replacement' | 'capture';
  assembly: Mat4;                           // capture -> jaw; identity without a jaw
  alignment: AlignmentResult | null;        // last result applied to `assembly`
  lastAlignedPose: Mat4 | null; undo: Mat4[]; // undo holds at most 20 poses
  deviation: Map<string, Float32Array> | null; measuring: boolean;
  step: 1 | 2 | 3 | 4; sample: boolean; exportedSinceChange: boolean;
}
```

The geometry library, display preferences and the email flag live outside the case: New case keeps them.

### 5.2 Gating and invalidation

| Step | Reachable when | Done when | Continue |
|---|---|---|---|
| 1 Arch & capture | always | `arch` set ∧ ≥ 1 site with a frame ∧ every provisional site confirmed or left out | → 2 |
| 2 Geometry | step 1 done | every site not left out has a geometry | → 3 |
| 3 Jaw scan (optional) | step 2 done | jaw loaded (→ 4 and auto align) or Skip (→ 4 without jaw) | — |
| 4 Align & export | step 2 done | — | — |

Going back never loses work. Upstream changes invalidate downstream results like this:

| Change | Effect |
|---|---|
| New valid capture | Replaces the case (confirm first when steps 2–4 hold work, §5.3); arch and library stay. An invalid file changes nothing |
| Arch changed | Label only (ZIP name, report, Occlusal preset); nothing invalidated |
| Geometry reassigned | With `matchSurfaces = 'replacement'` the metrics go stale and are re-measured when step 4 shows |
| Jaw replaced | `assembly` back to identity, alignment cleared, auto align runs again |
| Jaw removed | `assembly` identity, alignment cleared, step 4 becomes "Review and export" |
| Surfaces to match changed | Current pose re-measured |
| Any pose change | Metrics and color map stale → re-measured 250 ms after the gesture ends (cancelling a measurement still running) |

Re-measuring uses `alignClient.measure()`, whose result always says method `manual` with flag `manualPose`. The UI
keeps that only when the pose was moved by hand. When the pose did not move (surfaces or geometry changed), it keeps the
previous result's `method` and method flags (`landmark*`, `ambiguousAlternative`, `notConverged`, `fewCorrespondences`)
and takes only the new metrics, `perSite`, `status` and `symmetricSource` from the measurement, so the report never
says "adjusted by hand" for an automatic pose.

### 5.3 Step 1 · Arch and capture

Body, in order:

1. **Arch**: radiogroup of two cards (`role="radiogroup"`, each a `role="radio"` button with `aria-checked`, arrow
   keys move), upper-arch (∩) and lower-arch (∪) line icons, two columns, min-height 96 px. Checked card: 2 px `--blue`
   border, `rgba(4,107,210,.06)` fill, check badge. None checked at first.
2. **Drop zone**, multiple files, `accept=".stl,.ply,.obj,.csv,.txt,.tsv,.xml,.json,.xlsx,.xls,.pic,.tupel,.beb"`
   (the last five only so they reach the engine's precise refusal messages).
3. **Sources** (after import): one row per source with a format chip and a count ("MicronMapper CSV · 4 positions",
   "Capture mesh (STL) · 4 bodies"), never a name; `[Replace capture]` reopens the picker.
4. **Capture scan body picker** (mesh-only captures, §5.3.2).
5. **Implant list** (§5.3.3).
6. Warnings and alerts.

Import pipeline, all of it inside the jobs worker:

| Input | Rule | Engine calls |
|---|---|---|
| Each file | Mesh when `detectMeshFormat(bytes)` is not null, or when the extension is stl/ply/obj (passed as `hint` so a broken mesh gets its specific error); otherwise a position file | `detectMeshFormat` |
| More than one mesh | Refused with `ui.oneMesh`; the case is unchanged | — |
| Position files | Parsed one by one, extension passed for the vendor/spreadsheet refusal | `parsePositions(bytes, { extension })` |
| Several position files | Merged: a label present in two files is kept once when `maxAbsDiff(a.matrix, b.matrix) ≤ 1e-7`, otherwise `XchangeError('LABEL_DUPLICATE', { reason: 'crossFile' })`; ids re-numbered `site-1..n` (file order, then row order); merged count above `LIMITS.positions.maxPositions` → `TOO_MANY_POSITIONS { limit }` | `maxAbsDiff` (core/mat4) |
| Mesh + position file(s) | The file positions are the authority; the mesh gives each implant its captured surface | `parseMesh(bytes, 'capture', hint)` → `splitComponents(mesh)` → `linkSitesToComponents(sites, components)` |
| Mesh only | Bodies are counted at once; positions wait for a capture scan body | `parseMesh` → `splitComponents`; then `recoverSitesFromMesh(mesh, { mesh: reference })` |

`capture.format` = the first position file's format, else the mesh format (each site keeps its own `source`). Any error
leaves the case untouched; with several files the alert starts "File 2 of 3:".

| State | What shows |
|---|---|
| Empty | Arch cards, drop zone, hint "Excel? Save it as CSV first.", a text button "Try a sample case"; the stage shows the empty state (§12.3) |
| Reading | The drop zone becomes a progress row (indeterminate bar, "Reading the file…" / "Reading 3 files…", `[Cancel]` = terminate the jobs worker); the previous case, if any, stays visible and dimmed |
| Mesh, no capture scan body yet | Sources row + picker; the stage shows the captured bodies in `--xch-capture`, numbered 1..n |
| Detecting | Progress row "Finding the implant positions…" |
| Success | Sources + implant list; the stage frames the implants in Occlusal view; live region "Capture imported: 4 implants." |
| Warnings | Amber notes under the sources (§12.8), never blocking |
| Provisional positions | Banner with `[Show them]` (camera frames them, they pulse once) and `[Confirm positions]`; each provisional row has `[Leave out]`. Continue stays disabled until each one is confirmed or left out |
| Not recognized bodies | Note "2 bodies weren't recognized and are left out (bodies 3, 6). Wrong scan body? Pick another one." |
| Round bodies (index ambiguous) | Note `s1.roundNote`; rows show "Rotation unknown"; not blocking (the report records it) |
| Error | Red alert (§12.9); the previous case untouched |

**5.3.1 Replacing a case.** A valid new capture while steps 2–4 hold work opens `#xch-confirm` ("Replace the current
case?"); the parsed result waits in memory until the answer. Without downstream work it replaces silently and toasts
"Capture replaced."

**5.3.2 Capture scan body (mesh-only).** Card "Which scan body is in this capture?": text, a compact list of Your
geometries (favorites first; same rows as step 2, whose main action reads "Use H6.6 cap as the capture scan body"),
`[Load scan body file]` (`parseMesh(bytes, 'geometry')` → named → saved to the library). Picking runs detection at once,
with no confirm button; picking another re-runs it. Unresolved component indices are shown 1-based.

**5.3.3 Implant list.** `<ul>` of row buttons: label (600, tabular figures), small source icon, status chip — Found
(`--xch-ok`), Check (provisional, `--xch-warn`), Rotation unknown (`--xch-warn`, info icon), From file (neutral);
provisional rows add `[Leave out]`, left-out rows read "Left out" with `[Undo]`. Activating a row selects that implant
and eases the camera to it. Scrolls inside past 12 rows (`data-lenis-prevent`).

### 5.4 Step 2 · Replacement geometry

Body:

1. **Apply to**: radiogroup of two pills (the `.jump a` shape on `--mist`): `All implants (4)` | `Selected implant:
   AXO2`. The second is disabled until an implant is selected; selecting one in the stage or in the list checks it;
   choosing All clears the selection.
2. **Implant list** (same component as step 1) with the assigned geometry name or "No geometry yet".
3. **Your geometries** (§7): `[Load geometry file]`, a ⋯ menu (Import / Export geometries), groups Favorites · All
   geometries · This case only, rows with thumbnails.

**Apply on pick** (the client's request): activating a row applies that geometry to the target at once. There is no
"Use selected" button.

- Stage: the affected implants swap their meshes with the scale-in (§3.2).
- Toast: "H6.6 cap applied to all 4 implants. [Undo]". Undo restores the previous `geometryBySite` (and the step, if
  it auto-advanced). The toast stays 10 s, pauses while hovered or focused, closes with Esc or ×.
- Auto-advance: when the target was **All implants** and every implant now has a geometry, go to step 3 after .6 s.
  The step sentence says so beforehand (WCAG 3.2.2). Per-implant picks never auto-advance.

**Loading a geometry file:** `parseMesh(bytes, 'geometry')` then `planAssembly(mesh, sites)`:

| Plan | UI |
|---|---|
| `single` | Inline name field opens (default "Geometry n", focused and selected); Enter saves to the library and applies it to the target |
| `normalized` | Note `s2.assemblyNormalized` (with `maxDeviationMm` in µm); named, saved, applied to all implants |
| `fixed` | Note `s2.assemblyFixed`; a case-only entry applied to all implants; with a capture mesh also `verifyAssemblyLayout(captureMesh, mesh)`, `compatible: false` → warning `s2.layoutMismatch` |
| `countMismatch` | Alert `ui.assemblyCount` |

Continue is enabled when every implant not left out has a geometry; otherwise the reason line reads "2 implants still
need a geometry."

### 5.5 Step 3 · Jaw scan (optional)

- Drop zone `accept=".stl,.ply"`; `[Use the sample jaw scan]` only in the sample case; `[Skip: export without aligning]`
  (`.btn--outline`) → step 4 without a jaw, with the note "The files stay in the capture's coordinates."
- Reading: indeterminate bar "Reading the jaw scan…", then "Preparing the surface…" while `alignClient.setJaw(mesh)`
  builds the worker's target.
- Success card: "Jaw scan ready" + "PLY with color · 1,248,330 triangles · 61 mm across" + `[Replace]` `[Remove]`, plus
  warnings (`MESH_LARGE`, `MESH_UNITS_SUSPECT`, `MESH_COLORS_IGNORED`, …).
- Then, automatically: go to step 4 and start Auto align (the prototype behavior Fernando showed), announced "Jaw scan
  ready. Aligning automatically…", with Cancel available.
- Error: alert; the case is unchanged.
- `JawScan = { mesh, originalBytes, format }`: `originalBytes` is the file's own buffer, transferred to the jobs worker
  and back untouched (the engine never aliases it).

### 5.6 Step 4 · Align and export

**With a jaw scan — "Align and export".** Three panel sections:

**A. Alignment**

- `[Auto align]` (`.btn--primary`) and `[Guided points 1–2–3–4]` (`.btn--outline`). After a result, `[Refine from
  here]` (compact) = `autoAlign(parts, { initial: assembly })`: local refinement first, global search only if that is
  not good (engine behavior).
- **Surfaces to match**: radiogroup `Replacement geometry` (default) | `Captured scan bodies` (enabled only when every
  site not left out has a `componentIndex`; otherwise disabled with reason `al.surfCaptureOff`). Why this default: in
  the case Fernando described, the photogrammetry capture and the tissue scan show *different* bodies, and the geometry
  chosen in step 2 is the one visible in the jaw scan. The prototype matched the captured bodies first, one reason its
  auto alignment "lo alinea mal".
- **Alignment parts** (the known gap the UI fills): per site, `transformMesh(geometry.mesh, site.matrix)` with the
  site's replacement geometry (a `fixed` assembly uses its per-site body), or `components[site.componentIndex].mesh`
  for captured bodies. Built once per change of geometry or surfaces, not per call.
- **Progress** (while running): determinate bar with stage weights prepare 0–.10, coarse .10–.55, fine .55–.90,
  metrics .90–1; text "{stage} · {pct} %"; `[Cancel]` aborts the `AbortSignal` → `CANCELLED` → quiet "Alignment
  cancelled." and the pose unchanged.
- **Result card**: status chip + one-sentence explanation (thresholds interpolated from `DEFAULT_QUALITY`, never typed
  in copy) + metrics row (RMS µm · 95 % within µm · within {tol} µm %) + method + the flags present other than
  `visualCheckRequired` (that one is the standing note of the Export section) + the per-implant table. Applied
  results tween the implant set into place (§3.2) and turn the color map on the first time.
- `failed`: chip "No usable fit", the attempt's metrics grayed under "Last attempt (not applied)", pose unchanged,
  `[Guided points]` offered as the primary action.
- Stale (pose, surfaces or geometry changed): chip "Measuring…" until `measure()` returns, then the normal card
  (method rule in §5.2).
- **Per-implant table**: `<table>` with caption, rows in guided order (`orderSitesAlongArch`), columns Implant · RMS
  (µm) · Within {tol} µm · Status. Status per site from `DEFAULT_QUALITY`: good (rms ≤ `goodRmsMm` ∧ coverage ≥
  `goodCoverage`), acceptable (rms ≤ `acceptableRmsMm` ∧ coverage ≥ `acceptableCoverage`), no match (coverage <
  `usableCoverage`), weak otherwise. The first cell is a button "Show AXO2 in the view" (camera eases to it, it pulses
  once). Numbers right-aligned, `font-variant-numeric: tabular-nums`.

**Guided points mode** (replaces section A while active; stage behavior in §6.6):

- Targets come from `orderSitesAlongArch(sites)`: with ≤ 4 implants all of them; with more, four spread ones at
  indices `0, round((n−1)/3), round(2(n−1)/3), n−1` of that order (Fernando's 1-2-3-4 spans the arch without extra
  clicks).
- Ordered list: number, label, state (Placed ✓ · Now ● · Next ○ · Skipped); a placed row has `[Redo]`.
- Source point = `guidePoint(site, body)` where `body` is the site's alignment surface in the implant frame (the
  replacement geometry, or the captured shell mapped by `inverseRigid(site.matrix)`); target = the clicked jaw point.
- After the last target, `alignFromLandmarks(parts, pairs)` runs by itself. `[Align with 3 points]` is enabled from 3
  points (from 1 when the case has fewer than 3 implants, showing the `gp.one`/`gp.two` text).
- `[Remove last point]` (Backspace), `[Skip this implant]`, `[Start over]`, `[Cancel]` (Esc).
- The result shows like any alignment (method "Guided points"; flags `landmarkTranslationOnly` / `landmarkAxisFree`
  explained).

**B. Adjust by hand**: sentence `s4.manualText` + `[Move to the jaw]` `[Undo]` `[Reset to last alignment]`. The pad
itself lives in the stage (§6.7).

**C. Export**: §8.

**Without a jaw scan — "Review and export".** Sentence `s4.noJaw`, the implant list with geometry names, and the Export
section. No pad and no manual moves (without a jaw they would only produce the `capture-adjusted` frame nobody asked
for).

**Export gating with a jaw:** blocked until an alignment result is applied (auto, guided, or a measured manual pose);
otherwise the replacements stay in capture coordinates while the jaw is in jaw coordinates and `combined.stl` would not
line up. The reason line is `ui.notAligned` (align, or remove the jaw in step 3). Weak, ambiguous and manual results
only warn (`ex.warn*`; blocking is Fernando's call, §15.3). Export also waits while `measuring` (≤ ~0.5 s) so
`report.alignment.matchesExport` stays true.

---

## 6. 3D viewer

### 6.1 Scene

- three.js `WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })`, sRGB output,
  `PerspectiveCamera` whose near/far follow the visible bounding sphere every frame (`near = max(d − 1.5r, d/1000)`,
  `far = d + 1.5r`), so the default 1° field of view keeps its depth precision.
- World = jaw coordinates when a jaw exists, capture coordinates otherwise. The jaw never moves (`matrixAutoUpdate =
  false`, identity).
- `assembly` group: `matrixAutoUpdate = false`, `matrix.set(...assembly)` (`Matrix4.set` takes row-major arguments,
  exactly the engine's `Mat4`). Children: one mesh per implant (replacement geometry, positioned by `site.matrix`);
  one ghost mesh per captured component (`components[i].mesh`, the same meshes the engine measures, so deviation values
  map 1:1 onto vertices); before a geometry exists, a site glyph (translucent ⌀4 × 8 mm cylinder along +Z with a flat
  facing +X, so axis and index read at a glance).
- Look (dental-CAD conventions, `LOOK` in `viewer/viewer.ts`): the stage is a flat deep indigo-violet (`--xch-stage`,
  a barely visible radial falloff) in both site themes; Neutral tone mapping; DPR capped at 2 (1.5 on touch screens).
- Lights: a directional front light parented to the camera, just above-left of the eye (the lit side always faces you,
  exocad's default), plus a hemisphere fill whose sky follows the screen's up (warm white over a lavender bounce).
- Materials (Blinn-Phong, `MeshPhongMaterial`): jaw `{ color: --xch-jaw (stone, used when the scan has no colors),
  side: DoubleSide, vertexColors: <PLY colors on> }` with a faint sheen; parts `--xch-part` warm beige-gold with a soft
  specular; a position without geometry is an opaque grey placeholder (`--xch-capture`); ghosts `{ color:
  --xch-capture, opacity: .45, depthWrite: false }`. With the color map on, parts switch to `vertexColors: true`,
  `color #fff` and nearly no specular, so the LUT colors stay what the legend says.
- Highlight (selected implant, current guided target, a pulse): a 2.5 px `--xch-active` ring around the part's whole
  silhouette, drawn last (the part into the stencil, then 8 copies shifted on screen where the stencil is clear: first
  depth-tested at full strength where the part shows, then over everything at 40 % where the scan hides it, each ring
  pixel drawn once), plus a faint warm glow only when the map is off. It never changes the color map's reading.
- Transparency: jaw opacity < 1 → `transparent, depthWrite: false`, drawn after the opaque parts (`renderOrder`).
- Coincident surfaces: once aligned, a replacement (or captured body) lies on the scan body inside the jaw scan with
  another tessellation, which z-fights in stripes. Parts and ghosts are drawn `DEPTH_BIAS_MM` = 20 µm nearer the
  camera: `polygonOffset`, factor −1 (grazing walls) and units recomputed every frame per mesh from the current
  near/far, its view depth and distance (24-bit depth), so the bias stays 20 µm at every zoom and field of view. A real
  deviation above 20 µm still shows the scan through.
- Labels: DOM pills in the labels layer, moved with transforms in the render callback (no layout reads): `--xch-glass`
  with `--ink` text `.75rem` 600, `aria-hidden` (the lists carry the same information). Each sits 6 px outside its
  part's screen box, past the part's free end when its axis shows on screen, else outward from the middle of the set
  (`labelSpot` in `viewer.ts`), so it never covers the part or its fit color.
- Scale bar, bottom center (labels layer): the longest 1, 2 or 5 × 10ⁿ mm under 120 px at the orbit target's depth
  (`niceScale`), exact for the whole scene at the default 1° field of view; written to the DOM only when it changes.
- WebGL unavailable at mount: the stage shows `ui.webglUnavailable` and the step panels are disabled (nothing can be
  checked visually). Context lost later: `preventDefault()`, the stage shows "3D view paused" + `[Restart the 3D
  view]`, which disposes the viewer and rebuilds it from the case state (the case survives).

### 6.2 Toolbar

Icon buttons (our own 24 px line icons, 1.8 stroke, `currentColor`) on `--xch-glass`, each with an accessible name and a
tooltip (`data-tip`: after 400 ms of hover, at once on keyboard focus, Esc hides it). Two `role="toolbar"`s with
roving tabindex (one Tab stop each, arrow keys move):

- Icon bar, top right, vertical: Display (popover, §6.4, opens to its left) · Color map (C) · Jaw transparency (T) |
  Shortcuts (`?`, opens `#xch-keys`) · Full screen (`stage.requestFullscreen()`, hidden when
  `document.fullscreenEnabled` is false; name, tooltip and icon toggle to "Exit full screen"). Color map and Jaw
  transparency are toggles (`aria-pressed`) on the keys' path (`Stage.toggleMap()`, `toggleJawOpacity()`), so the
  legend follows; `aria-disabled` before a measurement or a jaw scan.
- Views dial, bottom right: Fit in the hub; Top, Back, Right, Bottom, Front, Left at the ends of three faint view axes
  (screen up/down and left/right, Front/Back on the depth diagonal); below, the default view button "Occlusal"
  (tooltip "Initial view (occlusal)"). `aria-pressed` on the last preset used, cleared as soon as a drag, the wheel, a
  pinch or a camera key moves the camera off it; tooltips (`view.tip`, "Front · 1") and `aria-keyshortcuts` carry the key
  from `VIEW_KEYS` (§6.3). Enter or Space on a view button announces `say.view`; a mouse click does not. 32 px discs on a
  50 px radius, at least 6 px apart; 44 px on a 66 px radius on touch. Discs carry a tint and a hairline.
- Before the toolbar, a skip link visible on focus, "Skip the 3D view", jumps to the Export section (step 4) or to
  `#help`.

### 6.3 View presets

World-axis directions, assuming scanner coordinates with +Z toward the occlusal side of the lower arch and −Y toward
anterior. The Z rule matches the synthetic fixtures (implant axes point +Z on the lower arch, −Z on the upper); the
anterior direction is an assumption. The table is the only thing to change if real exports differ (§15.3); it lives
in `viewer/presets.ts`.

| Preset | Key | Camera from | Up |
|---|---|---|---|
| Occlusal (the default view) | 0 | lower: +Z · upper: −Z | −Y (anterior at the top) |
| Front | 1 | −Y | +Z |
| Bottom | 2 | −Z | −Y |
| Back | 3 | +Y | +Z |
| Left (patient's) | 4 | +X | +Z |
| Fit | 5 | keeps the direction, frames everything visible | — |
| Right (patient's) | 6 | −X | +Z |
| Top | 8 | +Z | −Y |

Keys follow exocad's numpad (`VIEW_KEYS` and `viewForKey(code, key)` in `viewer/presets.ts`): the number row by
`event.code` whatever the layout types there (an AZERTY row types `& é " '`), the keypad only with NumLock on (with it
off the keypad sends Home, End, the arrows and PageUp/PageDown, which keep their meaning), a typed `+ - = _ ?` keeps its
meaning (Swiss and Czech layouts type `+` on the 1 key), 7 and 9 do nothing. Home is no longer Fit (§6.7).

Framing (Default view, presets, Fit): the bounding box of what is shown (jaw, replacements, captured bodies that are
visible), every corner checked in camera space, fills `LOOK.frame` = 80 % of the stage on its limiting side, a margin
left for the chrome in the corners. "Show in the view" (one implant) keeps `r / sin(fov/2) × 1.15` with r ≥ 6 mm.
Tween per §3.2. After every import the view goes to Occlusal + Fit; after an alignment the camera stays and the
implant set moves.

### 6.4 Display popover

Non-modal panel under the Display button (`aria-expanded`/`aria-controls`; Esc and outside click close it; focus returns
to the button).

- Switches (`<button role="switch" aria-checked>`): Jaw scan · Jaw color (PLY; shown only when the PLY had colors) ·
  Replacements · Captured scan bodies (on by default in step 1 for mesh captures, off afterwards) · Labels · Color map
  (enabled once a deviation exists; turns on with the first result).
- Sliders (`<input type="range">` + `<output>`, `aria-valuetext`): Jaw opacity 0–100 % (step 5); Geometry opacity
  0–100 %; Perspective (field of view) 1–60°, default 1° (near-orthographic, exocad-like); Rotation speed 1–5, default
  3 (scales orbit and set-rotation gain).
- Field of view and rotation speed persist in `localStorage['ddt-xchange:view']` (wrapped in try/catch).
- Shortcuts: T toggles jaw opacity 100 % ↔ 30 % (also Shift + middle click on the jaw and the icon bar); Shift + middle
  click on a replacement toggles geometry opacity 100 % ↔ 30 %; C toggles the color map (also the icon bar). The legend
  shows exactly while the map is on and measured, whichever control changed it.
- Ctrl/⌘ + middle click hides what is under the pointer by turning its switch off (Jaw scan, Replacements or Captured
  scan bodies) and announces `say.hidden`; S or Ctrl/⌘ + Shift + middle click turns back on what was hidden that way
  (`say.shown`). The set is kept across a viewer restart and shown again, silently, when a new case starts.

### 6.5 Color map and legend

- Data: `alignClient.deviation(parts, assembly)` after every alignment or measurement → µm per vertex per implant.
  Colors come from a 256-entry LUT built once by OKLab interpolation of `--xch-map-0` (0 µm), `--xch-map-50` (50 µm)
  and `--xch-map-100` (≥ 100 µm, saturated). Lightness falls from 0 to 100 µm, so the ramp also reads in grayscale and
  with red-green color blindness; exact numbers are always available (hover readout, per-implant table).
- The map is drawn on the surfaces that were measured (replacements or captured bodies), which are the meshes shown.
- Legend, bottom-left glass card: title "Distance to the jaw scan" with "µm" at its right, 8 × 180 px gradient bar,
  ticks 0 · 25 · 50 · 75 · 100+ each at its value on the bar (the ends align outward), sub-line "On the replacement
  geometry" / "On the captured scan bodies". `role="img"` with `legend.aria`.

### 6.6 Hover readout, picking and the guided flow in the stage

- **Hover** (mouse or pen): raycast the visible part meshes only (they are small), at most once per frame. Readout chip
  bottom-center: with the map on "AXO2 · 42 µm" (barycentric interpolation of the hit triangle's three values);
  otherwise "AXO2 · H6.6 cap", "AXO2 · provisional" or "AXO2 · rotation unknown". The jaw is never raycast on hover (up
  to 3 M triangles), only on click.
- **Click** (pointer down/up within 4 px and 300 ms) → raycast. Steps 1–2: a part selects its implant. Step 4 in guided
  mode: the jaw receives the current point (an `--xch-active` pin with its number in `#1e293b`, scale-in); parts are
  ignored.
- **Guided mode visuals**: the current target implant glows `--xch-active` and its label pulses; other implants drop to
  40 % opacity; placed points keep numbered pins on the jaw; on entering, Fit frames the jaw and the implant set
  together; the camera stays under the user's control.
- **Keyboard alternative** (WCAG 2.1.1, 2.5.7): while the stage has focus in guided mode, a crosshair (24 px,
  `--xch-active` lines with a dark outline for contrast) marks the stage center. The user turns, pans and zooms with the
  keyboard until the crosshair sits on the top of the scan body, then Enter raycasts from the center. Backspace removes
  the last point, Esc cancels. The instructions are in the panel and in the stage's `aria-describedby`; each placement
  is announced.
- **Rotation center** (any step): a middle click on a surface, Home (under the mouse when it is over the canvas, else at
  the stage center, where the crosshair is; a hit announces `say.pivot`, a miss `say.pivotMiss`), or on a tablet a touch
  and hold: one finger still within 8 px for 500 ms. A 32 px `--xch-active` ring with the crosshair's dark halo shows
  under the finger from 150 ms and grows to full size at 500 ms (CSS `scale` on `var(--ease-out)`; with reduced motion
  it appears at 500 ms, full size); the center moves there (.35 s) and the ring stays until the finger lifts. Lifting is
  no tap; moving on turns the view; moving more than 8 px or a second finger before 500 ms cancels the hold. Over
  nothing the ring goes and the center stays. `.xch__stage` has `-webkit-touch-callout: none`.

### 6.7 Camera and implant-set controls (exocad mapping)

A small custom controller in `viewer/controls.ts`: OrbitControls cannot roll (exocad rotates freely) and
TrackballControls cannot zoom toward the cursor; both also own pointer events that would fight the implant-set drags.
Trackball rotation about the orbit target with quaternions.

| Input | Camera | Implant set (step 4, jaw loaded) |
|---|---|---|
| Right-drag | rotate | — |
| Left-drag on empty space or on the jaw | rotate | — |
| Left-drag on an implant | — | move the whole set in the camera plane |
| Ctrl or ⌘ + left-drag anywhere on the canvas | rotate (outside step 4) | rotate the set (arcball about its bounding-box center); + Shift (before or during the drag): only the dominant axis |
| Middle-drag, Shift + drag, left + right drag | pan | — |
| Wheel, trackpad pinch | zoom toward the pointer (dolly along the cursor ray to the target plane) | — |
| Middle click on a surface | rotation center there (.35 s tween) | — |
| Shift + middle click | jaw opacity 100 % ↔ last value (on the jaw), geometry opacity 100 % ↔ 30 % (on a replacement) | — |
| Ctrl or ⌘ + middle click · + Shift | hide what is under the pointer (§6.4) · show what was hidden | — |
| Double-click | Fit | — |
| Touch: one finger · two fingers · double tap · touch and hold | rotate · pinch zoom + pan · Fit · rotation center (§6.6) | pad only (no touch drags on the set) |
| Arrow keys | pan 5 % of the view height (exocad: the cursor keys move the view) | — |
| Shift + arrow keys · PageUp / PageDown | rotate 10° about the screen axes · about the screen's vertical axis (PageUp = Shift + ←) | — |
| + / − (also = and _) | zoom 15 % at the center | — |
| 1 · 2 · 3 · 4 · 5 · 6 · 8 · 0 | Front · Bottom · Back · Left · Fit · Right · Top · Occlusal (§6.3) | — |
| Home | rotation center under the mouse, else at the stage center (§6.6) | — |
| T · C · S · ? | jaw transparency · color map · show what was hidden · shortcuts | — |
| Ctrl or ⌘ + Z | — | undo the last set move |

Single-key shortcuts act only while focus is inside the stage (WCAG 2.1.4), with no Ctrl, ⌘ or Alt held (Shift is
allowed); every handled key calls `preventDefault()`, so PageUp/PageDown never scroll the page from the stage. Held
camera keys repeat one step per OS repeat; a view key, Home, a toggle or Enter acts once however long it is held. Keys
that start a camera tween (views, Fit, Home) never stop it; keys that move the camera themselves stop a running tween
first, as every drag, wheel and pinch does (interrupt, never queue). Camera keys never move the implant set. Ctrl/⌘+Z acts while focus is inside the workspace but not in a text field. The context menu
is suppressed on the canvas (right-drag rotates). Cursors: `grab` / `grabbing` over implants in step 4, `crosshair` in
guided mode. Holding Ctrl/⌘ over the stage in step 4 shows the chip "Drag to rotate · Shift: one axis" (`--xch-active`
fill, `#1e293b` text): it holds anywhere on the canvas. Shift + drag pans the camera, even over an implant, unless Ctrl/⌘
is held in step 4. Gains: camera rotation 0.25°/px and set rotation 0.3°/px, both × speed/3; pan maps pixels at the
target depth; wheel step 12 %. Modified middle clicks pick with a three raycast over the visible meshes (opacity ≥ 10 %;
a part within 20 µm behind the scan counts as on top, as drawn), linear in triangles: slice B makes it a GPU pick.

**Adjust pad** (step 4 with a jaw): a glass toolbar at the stage's top left, three columns of 36 px icon buttons (44 px
on touch): Rotate one column per axis (tilt, turn, roll), Move as an arrow-key cluster, Flip; groups separated by a
hairline, `role="toolbar"` with roving tabindex, tooltips as the toolbar.

| Group | Buttons (the accessible name includes the amount) | Step |
|---|---|---|
| Rotate | Tilt forward / back (screen X) · Turn left / right (screen Y) · Roll counterclockwise / clockwise (view axis) | 30°, Shift 5° |
| Move | Up · Down · Left · Right (screen plane) | 1 mm, Shift 0.1 mm |
| Flip | Flip over (180° about screen X) · Turn around (180° about screen Y) | — |
| Other | Move to the jaw (set's bounding-box center → jaw's) · Undo · Reset to last alignment | — |

Pivot: the set's bounding-box center in its current pose. Every action pushes the previous pose onto the undo stack
(≤ 20 entries; cleared by a new alignment), tweens the pose (.35 s) and schedules the re-measure. Shift with Enter or
Space on a focused pad button uses the small step (read from the click event's `shiftKey`).

### 6.8 Shortcuts dialog

`#xch-keys` (wide variant, 720 px): the table of §12.3 `keys.rows`, the touch line and `[Close]`. The same table is
rendered statically in the help section.

---

## 7. Geometry library ("Your geometries")

### 7.1 Storage

IndexedDB database `ddt-xchange`, version 1, two object stores always written in one transaction:

| Store | Key | Value |
|---|---|---|
| `meta` | `id` (`crypto.randomUUID()`) | `{ schema: 1, id, name, favorite, createdAt, updatedAt, triangles, extentMm: [x, y, z], thumbnail }` (thumbnail = 96×96 `data:image/png`) |
| `mesh` | `id` | `{ positions: Float32Array, indices: Uint32Array }`, in the implant frame |

- The list loads `meta` only; a mesh is read when it is picked, so memory stays flat with a full library.
- Limits: 50 entries (`ui.libraryFull`); each file within `LIMITS.geometry`, enforced by `parseMesh(…, 'geometry')`;
  `QuotaExceededError` → `ui.storageFull`. Nothing is ever deleted except by an explicit Remove (the prototype's silent
  dedupe-by-name deletion, spec S10, is not repeated).
- Names: given by the user, trimmed, control characters removed, 1–60 characters, unique case-insensitively after NFKC;
  a collision gets " (2)", " (3)". Never derived from a file name (`lib.nameHint` says so).
- Thumbnail: rendered once with the main renderer into a 96×96 render target (3/4 view, `--xch-part` on transparent),
  read back into a 2D canvas, `toDataURL('image/png')`. Queued, one per frame.
- IndexedDB unavailable or blocked (private mode, site data off): the library works in memory for the visit and step 2
  shows the persistent note `ui.storageUnavailable`.
- On `versionchange` (another tab upgrading) the connection closes; `db.close()` on dispose.

### 7.2 Operations

| Operation | UI | Notes |
|---|---|---|
| Add | `[Load geometry file]` → inline name field → Enter | Saved, then applied to the current target (step 2) or used as the capture scan body (step 1) |
| Apply | Activate the row | §5.4 apply on pick |
| Favorite | Star toggle, `aria-pressed` | Favorites group first; toast |
| Rename | Pencil → inline field (Enter saves, Esc cancels) | Also renames the in-case geometry, whose name goes into `report.json` |
| Remove | Trash → inline confirm in the row (`lib.removeConfirm`, `[Yes, remove]` `[No]`) | Implants using it keep it in this case; toast. Themed, never `window.confirm` |
| Filter | Text field shown from 10 entries | Name contains, case- and accent-insensitive |
| Export | ⋯ › Export geometries | One JSON file, §7.3 |
| Import | ⋯ › Import geometries | Merges, never overwrites; summary toast |

Case-only entries (sample case, positioned assemblies) appear under "This case only" with a badge and no star, rename
or remove; they vanish with New case. Row layout: 48 px thumbnail (12 px radius, `--mist` background), name (600),
meta line `.8rem` `--muted` ("36,244 triangles · 5 × 5 × 6.6 mm"), "On 4 implants" chip when used, icon buttons on
the right (36 px targets). The row's main button has the accessible name "Apply H6.6 cap to all implants".

### 7.3 Library file

`ddt-xchange-geometries.json`, written and read in the jobs worker:

```json
{ "schema": "ddt-xchange-geometries", "schemaVersion": 1, "exportedAt": "2026-11-07T18:00:00.000Z",
  "entries": [ { "name": "H6.6 cap", "favorite": true, "stl": "<base64 of a binary STL from writeBinarySTL>" } ] }
```

- JSON rather than a ZIP because import then needs no ZIP reader (the engine only writes ZIPs): `JSON.parse`, base64,
  and the hardened `parseMesh(bytes, 'geometry')` per entry.
- Import limits: file ≤ 256 MB (`ui.libraryFileTooLarge`, checked from File.size before reading; 50 ordinary ~50 k-triangle parts fit; an export over it gets the `ui.libraryExportTooLarge` note); total ≤ 50 entries with the existing ones (extra entries
  skipped and counted); wrong `schema` → `ui.libraryFileInvalid`; a bad entry is skipped and counted
  (`ui.librarySkipped`), never fatal; names pass the §7.1 rules.
- The file holds nothing about cases: no ids, no dates of use.

---

## 8. Export

- Request, built on the main thread and run by the jobs worker: `ExportRequest { arch, captureFormat, sites (not left
  out), geometryBySite (ids → ReplacementGeometry, case-only included), assemblyTransform (identity without a jaw), jaw?,
  alignment? (the applied result, matching the pose), createdAt: new Date().toISOString(), appVersion: XCHANGE_VERSION }`
  → `buildBundle(request)`; the jaw is structured-cloned in, the ZIP buffer transferred back.
- Before the button: the coordinates sentence (`ex.textJaw` / `ex.textCapture`), a `<details>` "What's in the ZIP"
  listing each file (`ex.files.*`), and a three-row summary: Coordinates (Jaw scan / Capture) · Implants n · Alignment
  (status · method · RMS, or None).
- Standing note, always: `al.flags.visualCheckRequired` ("A surface fit is not a clinical validation…").
- Warning lines when they apply: `ex.warnWeak`, `ex.warnAmbiguous`, `ex.warnManual`, `ex.warnProvisional`,
  `ex.warnRotation`.
- Button states: idle `[Export ZIP ↓]` (`.btn--primary`) → first time, the email gate (§9) → busy "Preparing ZIP…"
  with the indeterminate bar → done: the download starts (`<a download>` on a `blob:` URL; the file name is the
  engine's `DDT-Xchange_${arch}_export.zip`, no names or dates), toast "ZIP ready: 12.4 MB." + `[Download again]`, and
  the panel line "Exported at 14:32 · 12.4 MB" + `[Download again]` (same blob until the case changes; the old URL is
  revoked on change, 60 s after a newer export, or on dispose) → error: alert (`EXPORT_*` copy).
- A successful export disarms the leave guard until the next change.

---

## 9. Email gate

| Aspect | Decision |
|---|---|
| When | The first click on Export ZIP in this browser (any case, the sample included). Never before using the tool: the visitor sees the value first, and the client gets the address at the moment of value |
| Remembered | `localStorage['ddt-xchange:lead']` = `{"v":1,"state":"sent"}` (no email kept once sent) or `{"v":1,"state":"pending","email":"…"}` until a POST succeeds. Storage blocked → asked again next visit; never an error |
| Dialog | `#xch-email`, the LibraryDownload recipe: × close, title, text, one field (`type="email"`, required, `autocomplete="email"`, `inputmode="email"`, `maxlength="160"`, visible hint "Personal, company or office"), the honeypot `website` input of the site forms, consent note with the privacy link (`target="_blank" rel="noopener"`: a same-tab navigation would lose the case), "We'll only ask once on this browser.", buttons `[Continue to download ↓]` (`.btn--primary`) and `[Not now]` (`.btn--outline`, no export) |
| Validation | `form.reportValidity()` with the custom message `email.invalid`; focus stays in the field |
| Send | On submit: save `pending`, close the dialog, **start the export at once**, and in parallel `fetch(PUBLIC_N8N_FORM_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'ddt-xchange', email, lang, page: location.origin + location.pathname }), keepalive: true })`; `ok` → `sent` |
| Failure | Never blocks or delays the download (no lost work because of a marketing call). It stays `pending` and is retried silently once on the next mount and before the next export; no error is shown. Webhook unset (dev): `console.warn` like LibraryDownload and state `sent`, so it does not nag |
| Payload | Exactly `{ source, email, lang, page }`: no file names, labels, counts or metrics. `page` drops query and hash |
| Honeypot filled | Treated as `sent` locally, nothing posted, export proceeds |
| Lenis | `scroll-lock` true on open, false on close |
| n8n | `docs/n8n/web-leads.workflow.json` needs a third Switch branch `source = ddt-xchange` → Google Sheets row (email, lang, page, received at); CORS origin as the other branches |

---

## 10. Sample case

- Entry points: hero `[Try a sample case]` (`href="#workspace" data-xch-demo`: motion.js scrolls, the tool starts the
  sample once mounted), the workspace header button, and the step 1 empty state.
- If the case holds work, `#xch-confirm` asks first ("Load the sample case?").
- Generated in the browser, deterministic, with no network and no patient: `ui/demo.ts` (loaded with `import()`, so it
  costs nothing until used) re-exports `makeSample()` from the runtime module `sample/` (the test fixtures stay
  test-only). The case is an edentulous **upper** arch restored All-on-4 style: Fernando's recorded cases are upper
  arches, and the palate is what makes a scan read as a mouth at a glance (an edentulous lower arch is a bare
  horseshoe).
  - Jaw scan: binary PLY with per-vertex colors, ~280 k triangles of ~0.165 mm, 5.7 MB, in the scanner coordinates of
    an upper arch (occlusal −Z, anterior −Y, patient's left +X: §6.3). Palate vault with rugae, incisive papilla and
    raphe; rounded crest with healed-socket dimples, tuberosities, vestibule fold, lip mucosa and frena; fine scan
    noise and a ragged scan border. Colors: lighter attached gingiva on the crest, pale pink palate, redder mucosa, a
    dark vestibule fold, a redder soft palate, mottling; grey scan bodies with a darker sulcus where they leave the
    gingiva.
  - Implants: MicronMapper markers AXO01–AXO04 from the patient's right to left; two anterior near-straight, two
    posterior tilted 30° distally. Each carries our own generic scan body (⌀4.8 × 10 mm cylinder, full-height index
    flat on +X, 0.8 mm chamfer on top: no manufacturer's part), scanned standing in the gingiva (5 µm noise, tissue
    cuff, closed so the buried part is there to measure).
  - Capture: a MicronMapper V1.4 CSV of the four implant frames in capture coordinates, 11° and ~16 mm away from the
    jaw scan's, so the alignment has real work to do.
  - Replacement geometry (step 2): the same scan body as clean CAD (96 segments, separate vertices at the creases),
    named "Sample scan body".
  - Budget: about 115 ms warm and 190–210 ms on the first run in Chrome on the development PC (2026-11).
- The sample goes through the **real** pipeline (`parsePositions` on the CSV bytes, `parseMesh` on the PLY bytes, real
  alignment, real export): it demonstrates the tool rather than faking it. `sample/sample.test.ts` pins it: the same
  bytes every run, 250–600 k triangles, the All-on-4 layout, the jaw's scan bodies detected 4/4 as the offered
  geometry, auto align "good" at ~4 µm RMS, export with the jaw byte for byte.
- Walkthrough (the user still clicks Continue, so the flow is learned):
  1. Step 1 filled: arch Upper, source "MicronMapper CSV · 4 positions" with a "Sample" chip; the header shows the pill
     "Sample case · synthetic data" + `[Exit sample]`. Live: `say.sample`. Focus moves to Continue.
  2. Step 2: "This case only" holds "Sample scan body" with the hint `say.sampleHint`; picking it applies to all and
     auto-advances.
  3. Step 3: `[Use the sample jaw scan]` next to the normal drop zone → step 4 + auto align → expected "Good fit"
     (RMS ~4 µm).
  4. Step 4: color map, per-implant table, Export → email gate (first time) → `DDT-Xchange_upper_export.zip`.
- Sample geometries are case-only and never saved to the library. `[Exit sample]` = New case.

---

## 11. Accessibility (WCAG 2.2 AA)

### 11.1 Focus order

1. Site skip link → nav → hero: Start a case → Try a sample case.
2. Workspace header: `[Exit sample]` (when shown) → `[New case]` → `[Try a sample case]`.
3. Stepper: four buttons.
4. Panel, in visual order (arch radios → choose files → sources → capture scan body → implant list → library → …) →
   alert actions → `[Back]` → `[Continue]`.
5. "Skip the 3D view" → toolbar (one Tab stop, arrows inside) → stage (`tabindex="0"`) → pad (one Tab stop) → the
   display popover when open.
6. Help → FAQ → CTA → footer.

On step change focus goes to the new panel's `h3`; on dialog close back to the opener; after removing a library row to
the next row (or the list heading); after "Leave out" to the row's Undo.

### 11.2 Semantics

| Part | Pattern |
|---|---|
| Stepper | `<nav aria-label="Steps"><ol>` of buttons; `aria-current="step"`; locked = `aria-disabled="true"` + `aria-describedby` reason |
| Arch, Apply to, Surfaces to match | `role="radiogroup"` of `role="radio"` buttons, arrow keys move |
| Drop zones | A real `<button>` opens the hidden file input; dropping is an enhancement |
| Implant lists | `<ul>` of buttons; the selected one has `aria-pressed="true"` |
| Library rows | `<li>`: main button "Apply {name} to {target}" + named icon buttons (favorite with `aria-pressed`, rename, remove) |
| Stage | `<div role="application" aria-roledescription="3D viewer" aria-label aria-describedby tabindex="0">`; the canvas, labels and readout are `aria-hidden` (lists and the table carry the same information) |
| Toolbar, pad | `role="toolbar"`, roving tabindex |
| Switches, sliders | `role="switch" aria-checked`; native range inputs with `aria-valuetext` ("30 %", "1°", "3 of 5") |
| Progress | `role="progressbar"` with `aria-valuenow` (determinate) or none (indeterminate) and `aria-valuetext`, labelled by its visible text |
| Result | Chip = icon + word, never color alone; table with `<caption>` and `<th scope>` |
| Dialogs | Native `<dialog>.showModal()` (focus trap, Esc, top layer), `aria-labelledby` |
| FAQ | `<details>` / `<summary>` |

### 11.3 Live regions

- `#xch-status` (polite): step changes, import and detection results, the stage of long jobs ("Searching for the best
  position…", not every percent), alignment summaries, guided points placed, geometry applied or undone, library
  changes, export ready, link copied. Messages within 300 ms are merged.
- Errors: the alert card has `role="alert"` and is announced when inserted; focus does not jump; when off-screen it is
  brought into view with `scroll-to`.
- Toasts: container `role="status"`; a toast with an action stays 10 s and pauses while hovered or focused (WCAG
  2.2.1), and its action is never the only way to do it (re-picking a geometry also reverts an apply).

### 11.4 Other AA points

- Target size ≥ 24 × 24 px everywhere (pad 40, toolbar 36, row icons 36).
- Focus visible: the site's 3 px `--blue` outline; inside the stage `outline-offset: -3px` (the stage clips its corners);
  dark theme ring `#6fb6ff`.
- Contrast: tokens in §3.1; glass overlays at .9 opacity keep text ≥ 4.5:1 over any rendered pixel.
- `@media (forced-colors: active)`: chips, toolbar, pad and drop zones get `border: 1px solid CanvasText`; icons use
  `currentColor`.
- Zoom and reflow: a 1280 px laptop at 200 % zoom (640 CSS px) keeps a usable one-column workspace; the larger-screen
  card only replaces it below 600 CSS px or on touch screens under 768 px (§2.5). The 3D stage itself is 2D-layout
  content, the WCAG 1.4.10 exception.
- Language: copy follows `<html lang>`; numbers through `Intl.NumberFormat(lang)` (1,248,330 · 1.248.330), plurals
  through `Intl.PluralRules(lang)`, times through `Intl.DateTimeFormat(lang, { timeStyle: 'short' })`.
- Timing: no timeouts on user tasks; every long job can be cancelled.

---

## 12. Copy (EN / ES)

Where it lives: `src/xchange/ui/i18n/en.ts` and `es.ts`, both typed `Copy` (`ui/i18n/types.ts`), so a missing or extra
key fails `npm run typecheck:xchange`; `errors` is `Record<ErrorCode, …>` and `warnings` is `Record<WarningCode, …>`, so
every engine code must have text. The Astro page imports the dictionary of its language to server-render the static
copy; the client loads only its language with `import()` for dynamic text. The site dictionaries get only the keys of
§13.

Conventions: `{x}` = interpolation (numbers through `Intl`); a cell "one: … · other: …" is a plural pair
(`Intl.PluralRules`); HTML only where marked; backticks inside a cell mark literal markup or file names and are not
part of the copy. Spanish uses «» quotes, a decimal comma through `Intl`, and *tú*.

### 12.1 Page: hero, workspace header, small screens, help, FAQ, CTA

| Key | EN | ES |
|---|---|---|
| `hero.pill` | Free tool · No login | Herramienta gratis · Sin registro |
| `hero.title` | DDT Xchange | DDT Xchange |
| `hero.lead` | Put the geometry your lab uses on every implant position from a capture, line it up with the jaw scan and export a ZIP for Exocad. Free, in your browser. | Coloca la geometría que usa tu laboratorio en cada posición de implante de una captura, alinéala con el escaneo de la arcada y exporta un ZIP para Exocad. Gratis y en tu navegador. |
| `hero.start` | Start a case | Empezar un caso |
| `hero.demo` | Try a sample case | Probar un caso de ejemplo |
| `hero.privacy` | Your files never leave this computer. No login, no patient names. | Tus archivos nunca salen de esta computadora. Sin registro y sin nombres de pacientes. |
| `ws.eyebrow` | Workspace | Área de trabajo |
| `ws.title` | Four steps to an | Cuatro pasos hasta un |
| `ws.titleAccent` | Exocad-ready ZIP | ZIP listo para Exocad |
| `ws.lead` | Everything runs on this computer and nothing is uploaded. Start with your capture, or try the sample case first. | Todo se procesa en esta computadora y no se sube nada. Empieza con tu captura o prueba primero el caso de ejemplo. |
| `ws.newCase` | New case | Caso nuevo |
| `ws.demo` | Try a sample case | Probar un caso de ejemplo |
| `ws.samplePill` | Sample case · synthetic data | Caso de ejemplo · datos sintéticos |
| `ws.exitSample` | Exit sample | Salir del ejemplo |
| `ws.noscript` | DDT Xchange needs JavaScript to run in your browser. | DDT Xchange necesita JavaScript para funcionar en tu navegador. |
| `small.title` | DDT Xchange needs a larger screen | DDT Xchange necesita una pantalla más grande |
| `small.text` | The 3D workspace works on a computer, or on a tablet at least 768 px wide. Open this page there: there is nothing to install. | El área de trabajo 3D funciona en una computadora o en una tablet de al menos 768 px de ancho. Abre esta página allí: no hay nada que instalar. |
| `small.copy` | Copy link | Copiar enlace |
| `small.share` | Share link | Compartir enlace |
| `help.eyebrow` | Help | Ayuda |
| `help.title` | Formats, limits and | Formatos, límites y |
| `help.titleAccent` | good practice | buenas prácticas |
| `help.lead` | What DDT Xchange reads, how far it goes and what to check before you use the files. | Qué lee DDT Xchange, hasta dónde llega y qué revisar antes de usar los archivos. |
| `help.howTitle` | How it works | Cómo funciona |
| `help.how[0].t` | Arch and capture | Arcada y captura |
| `help.how[0].d` | Pick upper or lower and import the implant positions: a file from your photogrammetry or scanner software, or a mesh of the scan bodies. | Elige superior o inferior e importa las posiciones de los implantes: un archivo de tu software de fotogrametría o escáner, o una malla de los scan bodies. |
| `help.how[1].t` | Geometry | Geometría |
| `help.how[1].d` | Pick the scan body or healing cap your lab uses. It lands on every implant, in the exact position. | Elige el scan body o pilar de cicatrización que usa tu laboratorio. Queda sobre cada implante, en la posición exacta. |
| `help.how[2].t` | Jaw scan | Escaneo de la arcada |
| `help.how[2].d` | Optional: add the tissue scan and the implants line up with it automatically, or with three or four guided clicks. | Opcional: agrega el escaneo de tejidos y los implantes se alinean con él automáticamente o con tres o cuatro clics guiados. |
| `help.how[3].t` | Export | Exportar |
| `help.how[3].d` | Check the fit on the color map and download one ZIP that opens in Exocad in a single coordinate system. | Revisa el ajuste en el mapa de color y descarga un ZIP que se abre en Exocad en un solo sistema de coordenadas. |
| `help.import.title` | What you can import | Qué puedes importar |
| `help.import.items[0]` | Implant positions: MicronMapper CSV (V1.4 AXO, V1.6 AHY), ScanAdaptor XML, iCam TXT, matrix tables in CSV or TXT, JSON and ImplantPositions XML. | Posiciones de implantes: CSV de MicronMapper (V1.4 AXO, V1.6 AHY), XML de ScanAdaptor, TXT de iCam, tablas de matrices en CSV o TXT, JSON y XML ImplantPositions. |
| `help.import.items[1]` | Capture mesh: STL, PLY or OBJ of the scan bodies, alone or with a position file. | Malla de captura: STL, PLY u OBJ de los scan bodies, sola o con un archivo de posiciones. |
| `help.import.items[2]` | Geometry: STL, PLY or OBJ in the implant frame (origin at the connection, +Z along the axis, +X toward the index). | Geometría: STL, PLY u OBJ en el sistema del implante (origen en la conexión, +Z a lo largo del eje, +X hacia el índice). |
| `help.import.items[3]` | Jaw scan: STL or PLY; the color is kept. | Escaneo de la arcada: STL o PLY; se conserva el color. |
| `help.import.items[4]` | Not read: Excel (save it as CSV), PIC, Tupel and BEB projects, column-major matrices, quaternions and units other than millimeters. | No se leen: Excel (guárdalo como CSV), proyectos PIC, Tupel y BEB, matrices por columnas, cuaterniones ni unidades distintas del milímetro. |
| `help.limits.title` | Limits | Límites |
| `help.limits.items[0]` | Jaw scan: up to {jawMb} MB and {jawTri} triangles (slower above {jawWarn}). | Escaneo de la arcada: hasta {jawMb} MB y {jawTri} triángulos (más lento por encima de {jawWarn}). |
| `help.limits.items[1]` | Capture mesh: up to {capMb} MB, {capTri} triangles and {capBodies} scan bodies. | Malla de captura: hasta {capMb} MB, {capTri} triángulos y {capBodies} scan bodies. |
| `help.limits.items[2]` | Geometry: up to {geoMb} MB and {geoTri} triangles. | Geometría: hasta {geoMb} MB y {geoTri} triángulos. |
| `help.limits.items[3]` | Position files: up to {posMb} MB and {posMax} implants. | Archivos de posiciones: hasta {posMb} MB y {posMax} implantes. |
| `help.limits.items[4]` | Export: up to {zipMb} MB. Millimeters only: nothing is ever converted. | Exportación: hasta {zipMb} MB. Solo milímetros: nunca se convierte nada. |
| `help.check.title` | Before you use the files | Antes de usar los archivos |
| `help.check.items[0]` | A surface fit is not a clinical validation: check every implant. | Un ajuste de superficies no es una validación clínica: revisa cada implante. |
| `help.check.items[1]` | combined.stl joins the surfaces without merging or cutting them, so they can overlap. | combined.stl junta las superficies sin fusionarlas ni recortarlas, así que pueden superponerse. |
| `help.check.items[2]` | Round scan bodies don't show their rotation: check flats and hexes in Exocad. | Los scan bodies redondos no muestran su giro: revisa planos y hexágonos en Exocad. |
| `help.check.items[3]` | Your geometries live in this browser: export them now and then as a backup. | Tus geometrías viven en este navegador: expórtalas de vez en cuando como respaldo. |
| `help.keysTitle` | Mouse and keyboard | Mouse y teclado |
| `faq.eyebrow` | FAQ | Preguntas frecuentes |
| `faq.title` | Questions about | Preguntas sobre |
| `faq.titleAccent` | DDT Xchange | DDT Xchange |
| `faq.items[0].q` | Are my files uploaded? | ¿Se suben mis archivos? |
| `faq.items[0].a` | No. Reading, aligning and exporting all happen in your browser, on this computer. The only thing we receive is the email address you give us before your first download. | No. La lectura, la alineación y la exportación ocurren en tu navegador, en esta computadora. Lo único que recibimos es el correo que nos das antes de tu primera descarga. |
| `faq.items[1].q` | Which capture files work? | ¿Qué archivos de captura funcionan? |
| `faq.items[1].a` | Position files from MicronMapper (CSV, V1.4 and V1.6) and iCam (ScanAdaptor XML or TransformedPoints TXT), tables of 4×4 matrices in CSV or TXT, JSON and ImplantPositions XML. You can also import a mesh of the scan bodies (STL, PLY or OBJ), alone or together with a position file. | Archivos de posiciones de MicronMapper (CSV, V1.4 y V1.6) y de iCam (XML de ScanAdaptor o TXT de TransformedPoints), tablas de matrices de 4×4 en CSV o TXT, JSON y XML ImplantPositions. También puedes importar una malla de los scan bodies (STL, PLY u OBJ), sola o junto con un archivo de posiciones. |
| `faq.items[2].q` | My scanner gives me Excel, PIC or Tupel files. What now? | Mi escáner me da archivos Excel, PIC o Tupel. ¿Qué hago? |
| `faq.items[2].a` | Save Excel sheets as CSV and import the CSV. Native PIC, Tupel and BEB projects can't be read without guessing their content: export the implant positions as CSV or XML from the scanner software. | Guarda las hojas de Excel como CSV e importa ese CSV. Los proyectos nativos PIC, Tupel y BEB no se pueden leer sin adivinar su contenido: exporta las posiciones de los implantes como CSV o XML desde el software del escáner. |
| `faq.items[3].q` | Which geometry should I pick? | ¿Qué geometría debo elegir? |
| `faq.items[3].a` | The one that should sit on the implants in Exocad, usually the scan body or healing cap you can see in the jaw scan. Its file must use the implant frame: origin at the implant connection, +Z along the implant axis toward the top, +X toward the index. | La que debe quedar sobre los implantes en Exocad, normalmente el scan body o pilar de cicatrización que se ve en el escaneo de la arcada. Su archivo debe usar el sistema del implante: origen en la conexión, +Z a lo largo del eje hacia arriba, +X hacia el índice. |
| `faq.items[4].q` | What do RMS and the color map tell me? | ¿Qué me dicen el RMS y el mapa de color? |
| `faq.items[4].a` | RMS is the typical distance between the implant surfaces and the jaw scan. The map colors every point from green (0 µm) to red (100 µm or more). A low RMS and a mostly green map mean the surfaces line up; they don't replace a clinical check. | El RMS es la distancia típica entre las superficies de los implantes y el escaneo. El mapa colorea cada punto de verde (0 µm) a rojo (100 µm o más). Un RMS bajo y un mapa casi todo verde indican que las superficies coinciden; no reemplazan una revisión clínica. |
| `faq.items[5].q` | Why does it say the rotation is unknown? | ¿Por qué dice que el giro es desconocido? |
| `faq.items[5].a` | A round scan body looks the same from every side, so its rotation around the implant axis can't be read from the scan. Position and axis are still exact. If your replacement has a flat or a hex, check its rotation in Exocad. | Un scan body redondo se ve igual desde todos lados, así que su giro alrededor del eje no se puede leer del escaneo. La posición y el eje siguen siendo exactos. Si tu reemplazo tiene un plano o un hexágono, revisa su giro en Exocad. |
| `faq.items[6].q` | Auto align got it wrong. What can I do? | La alineación automática falló. ¿Qué hago? |
| `faq.items[6].a` | First check "Surfaces to match": pick what the jaw scan really shows on the implants. Then use guided points: click the top of three or four implants on the jaw, in the order shown. You can also drag the implant set close by hand and press "Refine from here". | Primero revisa «Superficies a comparar»: elige lo que de verdad se ve sobre los implantes en el escaneo. Luego usa los puntos guiados: haz clic en la parte superior de tres o cuatro implantes en la arcada, en el orden indicado. También puedes acercar el conjunto a mano y pulsar «Afinar desde aquí». |
| `faq.items[7].q` | Where are my geometries saved? | ¿Dónde se guardan mis geometrías? |
| `faq.items[7].a` | In this browser, on this computer. They don't follow you to another computer, and clearing the site's data removes them. Use "Export geometries" to keep a backup or to move them. | En este navegador, en esta computadora. No te siguen a otra computadora y se borran si eliminas los datos del sitio. Usa «Exportar geometrías» para guardar un respaldo o pasarlas a otro equipo. |
| `faq.items[8].q` | Why do you ask for my email? | ¿Por qué piden mi correo? |
| `faq.items[8].a` | DDT Xchange is free. We ask once per browser, before the first download, to send you occasional news about our tools, libraries and courses. You can unsubscribe at any time. | DDT Xchange es gratis. Te lo pedimos una vez por navegador, antes de la primera descarga, para enviarte novedades ocasionales sobre nuestras herramientas, librerías y cursos. Puedes darte de baja cuando quieras. |
| `faq.items[9].q` | Which browsers work? | ¿Qué navegadores funcionan? |
| `faq.items[9].a` | Recent Chrome, Edge, Firefox or Safari on a computer, or on a tablet at least 768 px wide, with WebGL 2. Large jaw scans need a computer with enough memory. | Chrome, Edge, Firefox o Safari recientes en una computadora, o en una tablet de al menos 768 px de ancho, con WebGL 2. Los escaneos grandes necesitan una computadora con suficiente memoria. |
| `cta.title` (HTML) | Rather have us design it? `<span class="cta__accent">`Send us the case.`</span>` | ¿Prefieres que lo diseñemos nosotros? `<span class="cta__accent">`Envíanos el caso.`</span>` |
| `cta.text` | Our team designs All-on-X, bars and bridges in Exocad from your scans. Book a consultation or write to us. | Nuestro equipo diseña All-on-X, barras y puentes en Exocad a partir de tus escaneos. Reserva una consulta o escríbenos. |

### 12.2 Stepper, panels and confirmations

| Key | EN | ES |
|---|---|---|
| `steps.label` | Steps | Pasos |
| `steps.names[0]` | Arch & capture | Arcada y captura |
| `steps.names[1]` | Geometry | Geometría |
| `steps.names[2]` | Jaw scan | Escaneo de la arcada |
| `steps.names[3]` | Align & export | Alinear y exportar |
| `steps.optional` | Optional | Opcional |
| `steps.done` | completed | completado |
| `steps.current` | current step | paso actual |
| `steps.locked` | not available yet | aún no disponible |
| `steps.lockedCapture` | Import a capture first. | Primero importa una captura. |
| `steps.lockedGeometry` | Give every implant a geometry first. | Primero asigna una geometría a cada implante. |
| `panel.stepOf` | Step {n} of 4 | Paso {n} de 4 |
| `panel.stepOfOptional` | Step {n} of 4 · optional | Paso {n} de 4 · opcional |
| `panel.back` | Back | Atrás |
| `panel.continue` | Continue | Continuar |
| `panel.cancel` | Cancel | Cancelar |
| `s1.title` | Arch and capture | Arcada y captura |
| `s1.text` | Pick the arch, then import the implant capture: a position file from your photogrammetry or scanner software, or a mesh of the scan bodies. | Elige la arcada y luego importa la captura de implantes: un archivo de posiciones de tu software de fotogrametría o escáner, o una malla de los scan bodies. |
| `s1.arch` | Arch | Arcada |
| `s1.upper` | Upper arch | Arcada superior |
| `s1.lower` | Lower arch | Arcada inferior |
| `s1.drop` | Drop the capture here | Suelta aquí la captura |
| `s1.or` | or | o |
| `s1.choose` | Choose files | Elegir archivos |
| `s1.formats` | MicronMapper CSV · ScanAdaptor XML · iCam TXT · matrix tables (CSV/TXT) · JSON · ImplantPositions XML · or an STL, PLY or OBJ mesh of the scan bodies. A position file and a mesh can go together. | CSV de MicronMapper · XML de ScanAdaptor · TXT de iCam · tablas de matrices (CSV/TXT) · JSON · XML ImplantPositions · o una malla STL, PLY u OBJ de los scan bodies. Un archivo de posiciones y una malla pueden ir juntos. |
| `s1.excel` | Excel? Save it as CSV first. | ¿Excel? Guárdalo primero como CSV. |
| `s1.sources` | Imported | Importado |
| `s1.sourcePositions` | one: {format} · 1 position · other: {format} · {count} positions | one: {format} · 1 posición · other: {format} · {count} posiciones |
| `s1.sourceMesh` | one: Capture mesh ({format}) · 1 body · other: Capture mesh ({format}) · {count} bodies | one: Malla de captura ({format}) · 1 cuerpo · other: Malla de captura ({format}) · {count} cuerpos |
| `s1.sampleChip` | Sample | Ejemplo |
| `s1.replace` | Replace capture | Reemplazar captura |
| `s1.reading` | one: Reading the file… · other: Reading {count} files… | one: Leyendo el archivo… · other: Leyendo {count} archivos… |
| `s1.detecting` | Finding the implant positions… | Buscando las posiciones de los implantes… |
| `s1.linking` | Matching the positions to the captured bodies… | Asociando las posiciones con los cuerpos capturados… |
| `s1.refTitle` | Which scan body is in this capture? | ¿Qué scan body aparece en esta captura? |
| `s1.refText` | Pick it from your geometries or load its file. It is fitted to every body to read the implant position: the connection, the axis and the index. | Elígelo de tus geometrías o carga su archivo. Se ajusta a cada cuerpo para leer la posición del implante: la conexión, el eje y el índice. |
| `s1.refUse` | Use {name} as the capture scan body | Usar {name} como scan body de la captura |
| `s1.refLoad` | Load scan body file | Cargar archivo de scan body |
| `s1.implants` | Implants | Implantes |
| `s1.implantCount` | one: 1 implant · other: {count} implants | one: 1 implante · other: {count} implantes |
| `s1.status.found` | Found | Encontrado |
| `s1.status.check` | Check | Revisar |
| `s1.status.rotation` | Rotation unknown | Giro desconocido |
| `s1.status.fromFile` | From file | Del archivo |
| `s1.provTitle` | one: 1 position is provisional · other: {count} positions are provisional | one: 1 posición es provisional · other: {count} posiciones son provisionales |
| `s1.provText` | The fit came close but didn't pass every check. Look at them in the view, then confirm them or leave them out. | El ajuste se acercó, pero no pasó todas las pruebas. Míralas en el visor y luego confírmalas o exclúyelas. |
| `s1.provShow` | Show them | Mostrarlas |
| `s1.provConfirm` | Confirm positions | Confirmar posiciones |
| `s1.leaveOut` | Leave out | Excluir |
| `s1.leftOut` | Left out | Excluido |
| `s1.undo` | Undo | Deshacer |
| `s1.unresolved` | one: 1 body wasn't recognized and is left out (body {list}). Wrong scan body? Pick another one. · other: {count} bodies weren't recognized and are left out (bodies {list}). Wrong scan body? Pick another one. | one: 1 cuerpo no se reconoció y queda fuera (cuerpo {list}). ¿Scan body equivocado? Elige otro. · other: {count} cuerpos no se reconocieron y quedan fuera (cuerpos {list}). ¿Scan body equivocado? Elige otro. |
| `s1.roundNote` | Round scan body: the rotation around each implant axis can't be read. Positions and axes are exact; if your replacement has a flat or a hex, check its rotation. | Scan body redondo: no se puede leer el giro alrededor del eje de cada implante. Las posiciones y los ejes son exactos; si tu reemplazo tiene un plano o un hexágono, revisa su giro. |
| `s1.needArch` | Choose the arch. | Elige la arcada. |
| `s1.needCapture` | Import a capture. | Importa una captura. |
| `s1.needReference` | Choose the capture scan body. | Elige el scan body de la captura. |
| `s1.needConfirm` | Confirm or leave out the provisional positions. | Confirma o excluye las posiciones provisionales. |
| `s1.fileOf` | File {n} of {total}: | Archivo {n} de {total}: |
| `s2.title` | Replacement geometry | Geometría de reemplazo |
| `s2.text` | Pick what should sit on each implant in the export, usually the scan body or healing cap visible in your jaw scan. A geometry applies as soon as you pick it; picked for all implants, it also takes you to the next step. | Elige lo que irá sobre cada implante en la exportación, normalmente el scan body o pilar de cicatrización que se ve en tu escaneo. La geometría se aplica en cuanto la eliges; si es para todos los implantes, también te lleva al siguiente paso. |
| `s2.applyTo` | Apply to | Aplicar a |
| `s2.all` | All implants ({count}) | Todos los implantes ({count}) |
| `s2.selected` | Selected implant: {label} | Implante seleccionado: {label} |
| `s2.selectedNone` | Selected implant (pick one in the view or the list) | Implante seleccionado (elige uno en el visor o en la lista) |
| `s2.noGeometry` | No geometry yet | Sin geometría |
| `s2.need` | one: 1 implant still needs a geometry. · other: {count} implants still need a geometry. | one: A 1 implante aún le falta geometría. · other: A {count} implantes aún les falta geometría. |
| `s2.assemblyNormalized` | This file holds the same body at every implant (they agree within {um} µm). It was turned into one geometry. | Este archivo trae el mismo cuerpo en cada implante (coinciden a menos de {um} µm). Se convirtió en una sola geometría. |
| `s2.assemblyFixed` | This file holds a different body at each implant, already in place. Each implant keeps its own body, for this case only. | Este archivo trae un cuerpo distinto en cada implante, ya en su lugar. Cada implante conserva su cuerpo, solo para este caso. |
| `s2.assemblyAll` | A positioned assembly always applies to all implants. | Un ensamblaje posicionado siempre se aplica a todos los implantes. |
| `s2.layoutMismatch` | The bodies in this file don't sit where the captured bodies are; they may come from another coordinate system. | Los cuerpos de este archivo no están donde están los cuerpos capturados; pueden venir de otro sistema de coordenadas. |
| `s3.title` | Jaw scan | Escaneo de la arcada |
| `s3.text` | Add the tissue scan from the intraoral scanner, as STL or PLY, to align the implants to it. It is never changed: the export copies it byte for byte. | Agrega el escaneo de tejidos del escáner intraoral, en STL o PLY, para alinear los implantes con él. Nunca se modifica: la exportación lo copia byte a byte. |
| `s3.drop` | Drop the jaw scan here | Suelta aquí el escaneo de la arcada |
| `s3.choose` | Choose file | Elegir archivo |
| `s3.formats` | STL or PLY (the color is kept) | STL o PLY (se conserva el color) |
| `s3.sample` | Use the sample jaw scan | Usar el escaneo de ejemplo |
| `s3.skip` | Skip: export without aligning | Omitir: exportar sin alinear |
| `s3.skipNote` | The files stay in the capture's coordinates. | Los archivos quedan en las coordenadas de la captura. |
| `s3.reading` | Reading the jaw scan… | Leyendo el escaneo… |
| `s3.preparing` | Preparing the surface… | Preparando la superficie… |
| `s3.ready` | Jaw scan ready | Escaneo listo |
| `s3.meta` | {format}{color} · {triangles} triangles · {size} mm across | {format}{color} · {triangles} triángulos · {size} mm de extremo a extremo |
| `s3.withColor` | with color | con color |
| `s3.replace` | Replace | Reemplazar |
| `s3.remove` | Remove | Quitar |
| `s4.titleAlign` | Align and export | Alinear y exportar |
| `s4.titleReview` | Review and export | Revisar y exportar |
| `s4.noJaw` | No jaw scan: the replacements stay in the capture's coordinates, exactly where the capture put them. | Sin escaneo de la arcada: los reemplazos quedan en las coordenadas de la captura, justo donde la captura los ubicó. |
| `s4.alignment` | Alignment | Alineación |
| `s4.manual` | Adjust by hand | Ajuste manual |
| `s4.manualText` | Drag an implant to move the whole set; hold Ctrl (⌘ on Mac) and drag to rotate it. The adjust panel at the top left of the view turns it 30° per click, 5° with Shift. The fit is measured again after every move. | Arrastra un implante para mover todo el conjunto; mantén Ctrl (⌘ en Mac) y arrastra para girarlo. El panel de ajuste, arriba a la izquierda del visor, lo gira 30° por clic, 5° con Shift. El ajuste se vuelve a medir después de cada movimiento. |
| `s4.moveToJaw` | Move to the jaw | Llevar a la arcada |
| `s4.undo` | Undo | Deshacer |
| `s4.reset` | Reset to last alignment | Volver a la última alineación |
| `confirm.replaceTitle` | Replace the current case? | ¿Reemplazar el caso actual? |
| `confirm.replaceText` | The new capture clears this case's implants, geometry choices, jaw scan and alignment. Your saved geometries stay. | La nueva captura borra los implantes, las geometrías elegidas, el escaneo y la alineación de este caso. Tus geometrías guardadas se conservan. |
| `confirm.replaceYes` | Replace case | Reemplazar caso |
| `confirm.newTitle` | Start a new case? | ¿Empezar un caso nuevo? |
| `confirm.newText` | This clears the current case. Nothing was uploaded, so it can't be recovered unless you exported it. Your saved geometries stay. | Esto borra el caso actual. Como no se subió nada, no se puede recuperar salvo que lo hayas exportado. Tus geometrías guardadas se conservan. |
| `confirm.newYes` | Start new case | Empezar caso nuevo |
| `confirm.sampleTitle` | Load the sample case? | ¿Cargar el caso de ejemplo? |
| `confirm.sampleText` | The sample replaces the current case. Your saved geometries stay. | El ejemplo reemplaza el caso actual. Tus geometrías guardadas se conservan. |
| `confirm.sampleYes` | Load sample | Cargar ejemplo |
| `confirm.keep` | Keep current case | Conservar el caso actual |

### 12.3 Viewer, display, pad, legend, shortcuts

| Key | EN | ES |
|---|---|---|
| `view.label` | 3D view of the case | Vista 3D del caso |
| `view.role` | 3D viewer | visor 3D |
| `view.help` | Drag or use Shift + the arrow keys to turn the view; the arrow keys or Shift + drag pan; the wheel or + and − zoom. Press ? for every shortcut. | Arrastra o usa Shift + flechas para girar la vista; las flechas o Shift + arrastrar la desplazan; la rueda o + y − acercan. Pulsa ? para ver todos los atajos. |
| `view.empty` | Your case will appear here | Tu caso aparecerá aquí |
| `view.emptyText` | Drop files anywhere in the workspace, or try the sample case. | Suelta archivos en cualquier parte del área de trabajo o prueba el caso de ejemplo. |
| `view.skip` | Skip the 3D view | Saltar el visor 3D |
| `view.toolbar` | View tools | Herramientas de vista |
| `view.views` | Views | Vistas |
| `view.menu` | View | Vista |
| `view.fit` | Fit | Encuadrar |
| `view.occlusal` | Occlusal | Oclusal |
| `view.front` | Front | Frontal |
| `view.back` | Back | Posterior |
| `view.left` | Left | Izquierda |
| `view.right` | Right | Derecha |
| `view.top` | Top | Superior |
| `view.bottom` | Bottom | Inferior |
| `view.defaultView` | Initial view (occlusal) (the Occlusal pill's tooltip) | Vista inicial (oclusal) |
| `view.xray` | Jaw transparency | Transparencia del escaneo |
| `view.tip` | {name} · {key} | {name} · {key} |
| `view.display` | Display | Visualización |
| `view.shortcuts` | Shortcuts | Atajos |
| `view.fullscreen` | Full screen | Pantalla completa |
| `view.exitFullscreen` | Exit full screen | Salir de pantalla completa |
| `view.lost` | 3D view paused | Vista 3D en pausa |
| `view.lostText` | The graphics card reset the 3D view. Your case is safe. | La tarjeta gráfica reinició la vista 3D. Tu caso está a salvo. |
| `view.restart` | Restart the 3D view | Reiniciar la vista 3D |
| `drop.step1` | Drop to import the capture | Suelta para importar la captura |
| `drop.step2` | Drop to add a geometry | Suelta para agregar una geometría |
| `drop.step3` | Drop to load the jaw scan | Suelta para cargar el escaneo |
| `drop.step4` | Go back to a step to import files | Vuelve a un paso anterior para importar archivos |
| `display.title` | Display | Visualización |
| `display.jaw` | Jaw scan | Escaneo |
| `display.jawColor` | Jaw color (PLY) | Color del escaneo (PLY) |
| `display.parts` | Replacements | Reemplazos |
| `display.capture` | Captured scan bodies | Scan bodies capturados |
| `display.labels` | Labels | Etiquetas |
| `display.map` | Color map | Mapa de color |
| `display.jawOpacity` | Jaw opacity | Opacidad del escaneo |
| `display.partOpacity` | Geometry opacity | Opacidad de la geometría |
| `display.fov` | Perspective (field of view) | Perspectiva (campo de visión) |
| `display.speed` | Rotation speed | Velocidad de giro |
| `display.speedValue` | {n} of 5 | {n} de 5 |
| `legend.title` | Distance to the jaw scan | Distancia al escaneo |
| `legend.onReplacement` | On the replacement geometry | Sobre la geometría de reemplazo |
| `legend.onCapture` | On the captured scan bodies | Sobre los scan bodies capturados |
| `legend.aria` | Color scale from 0 µm, green, to 100 µm or more, red | Escala de color de 0 µm, verde, a 100 µm o más, rojo |
| `readout.um` | {label} · {value} µm | {label} · {value} µm |
| `readout.geometry` | {label} · {name} | {label} · {name} |
| `readout.provisional` | {label} · provisional | {label} · provisional |
| `readout.rotation` | {label} · rotation unknown | {label} · giro desconocido |
| `pad.label` | Adjust the implant set | Ajustar el conjunto de implantes |
| `pad.rotate` | Rotate | Girar |
| `pad.move` | Move | Mover |
| `pad.flip` | Flip | Voltear |
| `pad.tiltForward` | Tilt forward {deg}° | Inclinar hacia adelante {deg}° |
| `pad.tiltBack` | Tilt back {deg}° | Inclinar hacia atrás {deg}° |
| `pad.turnLeft` | Turn left {deg}° | Girar a la izquierda {deg}° |
| `pad.turnRight` | Turn right {deg}° | Girar a la derecha {deg}° |
| `pad.rollCcw` | Roll counterclockwise {deg}° | Rotar en sentido antihorario {deg}° |
| `pad.rollCw` | Roll clockwise {deg}° | Rotar en sentido horario {deg}° |
| `pad.up` | Move up {mm} mm | Mover hacia arriba {mm} mm |
| `pad.down` | Move down {mm} mm | Mover hacia abajo {mm} mm |
| `pad.left` | Move left {mm} mm | Mover a la izquierda {mm} mm |
| `pad.right` | Move right {mm} mm | Mover a la derecha {mm} mm |
| `pad.flipOver` | Flip over 180° | Dar vuelta 180° |
| `pad.turnAround` | Turn around 180° | Girar media vuelta 180° |
| `pad.hint` | 30° · 1 mm per click. Shift: 5° · 0.1 mm | 30° · 1 mm por clic. Shift: 5° · 0,1 mm |
| `pad.ctrlHint` | Drag to rotate · Shift: one axis | Arrastra para girar · Shift: un eje |
| `keys.title` | Mouse and keyboard | Mouse y teclado |
| `keys.colAction` | Action | Acción |
| `keys.colMouse` | Mouse | Mouse |
| `keys.colKeys` | Keyboard (3D view focused) | Teclado (con el visor activo) |
| `keys.touch` | On a tablet: one finger turns the view, two fingers zoom and pan, a double tap fits everything, touch and hold sets the rotation center; move the implant set with the adjust panel. | En una tablet: un dedo gira la vista, dos dedos acercan y desplazan, un doble toque encuadra todo y mantener presionado fija el centro de giro; mueve el conjunto con el panel de ajuste. |
| `keys.close` | Close | Cerrar |

`keys.rows` (action · mouse · keyboard; "—" = none):

| # | EN | ES |
|---|---|---|
| 1 | Turn the view · Right-drag, or left-drag on empty space · Shift + arrow keys, Page Up / Page Down | Girar la vista · Arrastrar con el botón derecho, o con el izquierdo sobre un espacio vacío · Shift + flechas, Re Pág / Av Pág |
| 2 | Pan · Middle-drag, Shift + drag, or both buttons · Arrow keys | Desplazar · Arrastrar con el botón central, Shift + arrastrar, o con ambos botones · Flechas |
| 3 | Zoom · Wheel (toward the pointer) · + and − | Acercar o alejar · Rueda (hacia el puntero) · + y − |
| 4 | Fit everything · Double-click · 5 | Encuadrar todo · Doble clic · 5 |
| 5 | Views · View buttons · 1 Front, 2 Bottom, 3 Back, 4 Left, 6 Right, 8 Top (number row or keypad, as in Exocad) | Vistas · Botones de vista · 1 Frontal, 2 Inferior, 3 Posterior, 4 Izquierda, 6 Derecha, 8 Superior (fila de números o teclado numérico, como en Exocad) |
| 6 | Initial view (occlusal) · View buttons · 0 | Vista inicial (oclusal) · Botones de vista · 0 |
| 7 | Rotation center · Middle-click on a surface; on a tablet, touch and hold · Home (under the pointer, or at the center) | Centro de giro · Clic central sobre una superficie; en una tablet, mantener presionado · Inicio (bajo el puntero o en el centro) |
| 8 | Transparency of what is under the pointer · Shift + middle-click; the toolbar (jaw scan) · T (jaw scan) | Transparencia de lo que está bajo el puntero · Shift + clic central; la barra de herramientas (escaneo) · T (escaneo) |
| 9 | Hide what is under the pointer · Ctrl or ⌘ + middle-click · Display menu | Ocultar lo que está bajo el puntero · Ctrl o ⌘ + clic central · Menú Visualización |
| 10 | Show what you hid · Ctrl or ⌘ + Shift + middle-click · S | Mostrar lo que ocultaste · Ctrl o ⌘ + Shift + clic central · S |
| 11 | Color map · Toolbar or Display menu · C | Mapa de color · Barra de herramientas o menú Visualización · C |
| 12 | Select an implant (step 2) · Click it · Implant list | Seleccionar un implante (paso 2) · Clic sobre él · Lista de implantes |
| 13 | Move the implant set (step 4) · Drag an implant · Adjust panel | Mover el conjunto (paso 4) · Arrastrar un implante · Panel de ajuste |
| 14 | Rotate the implant set (step 4) · Ctrl or ⌘ + drag anywhere (Shift: one axis) · Adjust panel (Shift: 5°) | Girar el conjunto (paso 4) · Ctrl o ⌘ + arrastrar en cualquier parte (Shift: un eje) · Panel de ajuste (Shift: 5°) |
| 15 | Undo a move · — · Ctrl or ⌘ + Z | Deshacer un movimiento · — · Ctrl o ⌘ + Z |
| 16 | Place a guided point · Click on the jaw · Enter at the crosshair | Colocar un punto guiado · Clic en el escaneo · Enter sobre la mira |
| 17 | Remove the last point · — · Backspace | Quitar el último punto · — · Retroceso |
| 18 | Cancel guided points, close menus · — · Esc | Cancelar los puntos guiados, cerrar menús · — · Esc |
| 19 | Show this list · — · ? | Mostrar esta lista · — · ? |

### 12.4 Your geometries

| Key | EN | ES |
|---|---|---|
| `lib.title` | Your geometries | Tus geometrías |
| `lib.where` | Saved in this browser, on this computer. | Guardadas en este navegador, en esta computadora. |
| `lib.load` | Load geometry file | Cargar archivo de geometría |
| `lib.formats` | STL, PLY or OBJ in the implant frame: origin at the connection, +Z along the axis, +X toward the index. | STL, PLY u OBJ en el sistema del implante: origen en la conexión, +Z a lo largo del eje, +X hacia el índice. |
| `lib.menu` | Library options | Opciones de la biblioteca |
| `lib.import` | Import geometries… | Importar geometrías… |
| `lib.export` | Export geometries… | Exportar geometrías… |
| `lib.favorites` | Favorites | Favoritas |
| `lib.all` | All geometries | Todas las geometrías |
| `lib.caseOnly` | This case only | Solo este caso |
| `lib.sampleBadge` | Sample | Ejemplo |
| `lib.assemblyBadge` | Positioned assembly | Ensamblaje posicionado |
| `lib.apply` | Apply {name} to {target} | Aplicar {name} a {target} |
| `lib.targetAll` | all implants | todos los implantes |
| `lib.targetOne` | implant {label} | el implante {label} |
| `lib.favorite` | Favorite | Favorita |
| `lib.rename` | Rename | Cambiar nombre |
| `lib.remove` | Remove | Eliminar |
| `lib.used` | one: On 1 implant · other: On {count} implants | one: En 1 implante · other: En {count} implantes |
| `lib.meta` | {triangles} triangles · {size} mm | {triangles} triángulos · {size} mm |
| `lib.nameLabel` | Name | Nombre |
| `lib.nameDefault` | Geometry {n} | Geometría {n} |
| `lib.nameHint` | Give it a name you'll recognize. The file name isn't kept. | Ponle un nombre que reconozcas. El nombre del archivo no se guarda. |
| `lib.save` | Save | Guardar |
| `lib.cancel` | Cancel | Cancelar |
| `lib.removeConfirm` | Remove “{name}” from your geometries? Implants using it in this case keep it. | ¿Eliminar «{name}» de tus geometrías? Los implantes que la usan en este caso la conservan. |
| `lib.removeYes` | Yes, remove | Sí, eliminar |
| `lib.removeNo` | No | No |
| `lib.empty` | No geometries yet. Load the STL of the scan body or healing cap your lab uses; it stays here for your next cases. | Aún no hay geometrías. Carga el STL del scan body o pilar de cicatrización que usa tu laboratorio; quedará aquí para tus próximos casos. |
| `lib.filter` | Filter geometries | Filtrar geometrías |
| `lib.noMatch` | No geometry matches “{query}”. | Ninguna geometría coincide con «{query}». |
| `lib.saving` | Saving to your geometries… | Guardando en tus geometrías… |
| `lib.readingFile` | Reading the library file… | Leyendo el archivo de biblioteca… |

### 12.5 Alignment and guided points

| Key | EN | ES |
|---|---|---|
| `al.auto` | Auto align | Alinear automáticamente |
| `al.guided` | Guided points 1–2–3–4 | Puntos guiados 1–2–3–4 |
| `al.refine` | Refine from here | Afinar desde aquí |
| `al.cancel` | Cancel | Cancelar |
| `al.surfaces` | Surfaces to match | Superficies a comparar |
| `al.surfReplacement` | Replacement geometry | Geometría de reemplazo |
| `al.surfCapture` | Captured scan bodies | Scan bodies capturados |
| `al.surfHelp` | Pick what the jaw scan shows on the implants: the geometry chosen in step 2 (the usual case) or the same scan bodies as the capture. | Elige lo que se ve sobre los implantes en el escaneo: la geometría elegida en el paso 2 (lo habitual) o los mismos scan bodies de la captura. |
| `al.surfCaptureOff` | Not available: the capture has no mesh for every implant. | No disponible: la captura no tiene malla para cada implante. |
| `al.notYet` | Not aligned yet. Auto align usually finds the position in a few seconds; if it doesn't, use guided points. | Aún sin alinear. La alineación automática suele encontrar la posición en pocos segundos; si no, usa los puntos guiados. |
| `al.stage.prepare` | Preparing surfaces | Preparando superficies |
| `al.stage.coarse` | Searching for the best position | Buscando la mejor posición |
| `al.stage.fine` | Refining | Afinando |
| `al.stage.metrics` | Measuring the fit | Midiendo el ajuste |
| `al.progress` | {stage} · {pct} % | {stage} · {pct} % |
| `al.progressLabel` | Alignment progress | Progreso de la alineación |
| `al.measuring` | Measuring… | Midiendo… |
| `al.status.good` | Good fit | Buen ajuste |
| `al.status.acceptable` | Acceptable | Aceptable |
| `al.status.weak` | Weak | Débil |
| `al.status.ambiguous` | Ambiguous | Ambiguo |
| `al.status.failed` | No usable fit | Sin ajuste útil |
| `al.explain.good` | The surfaces match closely: RMS up to {goodRms} µm and at least {goodCov} % of the surface within {tol} µm. Still check every implant. | Las superficies coinciden de cerca: RMS de hasta {goodRms} µm y al menos {goodCov} % de la superficie a menos de {tol} µm. Igual revisa cada implante. |
| `al.explain.acceptable` | Usable, but not tight: RMS up to {accRms} µm and at least {accCov} % within {tol} µm. Look at the color map around each implant. | Útil, pero no ajustado: RMS de hasta {accRms} µm y al menos {accCov} % a menos de {tol} µm. Mira el mapa de color alrededor de cada implante. |
| `al.explain.weak` | The surfaces only partly match. Check that the jaw scan shows these scan bodies and that the surfaces to match are right, then try guided points. | Las superficies coinciden solo en parte. Revisa que el escaneo muestre estos scan bodies y que las superficies a comparar sean las correctas; luego prueba con los puntos guiados. |
| `al.explain.ambiguous` | Another, clearly different position fits almost as well. This is typical with one round scan body or a symmetric layout. Use guided points to pick the right one. | Otra posición, claramente distinta, encaja casi igual de bien. Es típico con un solo scan body redondo o una distribución simétrica. Usa los puntos guiados para elegir la correcta. |
| `al.explain.failed` | No usable fit was found. The last attempt is shown below but was not applied. Try guided points. | No se encontró un ajuste útil. El último intento se muestra abajo, pero no se aplicó. Prueba con los puntos guiados. |
| `al.lastAttempt` | Last attempt (not applied) | Último intento (no aplicado) |
| `al.rms` | RMS | RMS |
| `al.rmsHelp` | Typical distance between the implant surfaces and the jaw scan. | Distancia típica entre las superficies de los implantes y el escaneo. |
| `al.p95` | 95 % within | 95 % a menos de |
| `al.p95Help` | 95 % of the surface is closer than this. | El 95 % de la superficie está más cerca que esto. |
| `al.coverage` | Within {tol} µm | A menos de {tol} µm |
| `al.coverageHelp` | Share of the implant surfaces within {tol} µm of the jaw scan. | Porcentaje de las superficies de los implantes a menos de {tol} µm del escaneo. |
| `al.method` | Method | Método |
| `al.method.auto` | Automatic | Automático |
| `al.method.landmarks` | Guided points | Puntos guiados |
| `al.method.manual` | Adjusted by hand | Ajuste manual |
| `al.flags.notConverged` | The fit stopped before settling. Press Refine from here. | El ajuste se detuvo antes de estabilizarse. Pulsa Afinar desde aquí. |
| `al.flags.ambiguousAlternative` | Another, different position fits almost as well. | Otra posición distinta encaja casi igual de bien. |
| `al.flags.symmetricSource` | The implant set is nearly symmetric, so the surfaces alone can't tell some turns apart. | El conjunto de implantes es casi simétrico, así que las superficies por sí solas no distinguen algunos giros. |
| `al.flags.fewCorrespondences` | Few matching points were found between the surfaces. | Se encontraron pocos puntos en común entre las superficies. |
| `al.flags.landmarkTranslationOnly` | Placed with one point: the set was moved, not turned. | Colocado con un punto: el conjunto se desplazó, pero no se giró. |
| `al.flags.landmarkAxisFree` | Placed with two points (or points in a line): the turn around their line is free. | Colocado con dos puntos (o puntos en línea): el giro alrededor de esa línea queda libre. |
| `al.flags.manualPose` | Measured on a position you adjusted by hand. | Medido sobre una posición que ajustaste a mano. |
| `al.flags.visualCheckRequired` | A surface fit is not a clinical validation. Check every implant before using these files. | Un ajuste de superficies no es una validación clínica. Revisa cada implante antes de usar estos archivos. |
| `al.table.caption` | Per implant | Por implante |
| `al.table.implant` | Implant | Implante |
| `al.table.rms` | RMS (µm) | RMS (µm) |
| `al.table.within` | Within {tol} µm | A menos de {tol} µm |
| `al.table.status` | Status | Estado |
| `al.table.show` | Show {label} in the view | Ver {label} en el visor |
| `al.site.good` | Good | Bien |
| `al.site.acceptable` | Acceptable | Aceptable |
| `al.site.weak` | Weak | Débil |
| `al.site.poor` | No match | No coincide |
| `gp.title` | Guided points | Puntos guiados |
| `gp.text` | Click on the jaw scan where each highlighted implant sits, aiming at the top center of its scan body. Follow the order 1–2–3–4. | Haz clic en el escaneo donde está cada implante resaltado, apuntando al centro superior de su scan body. Sigue el orden 1–2–3–4. |
| `gp.keyboard` | Keyboard: turn the view with Shift + arrows, pan with the arrow keys, zoom with + and −, then press Enter to place the point under the crosshair. | Con teclado: gira la vista con Shift + flechas, desplázala con las flechas, acerca con + y −, y pulsa Enter para colocar el punto bajo la mira. |
| `gp.placed` | Placed | Colocado |
| `gp.now` | Now | Ahora |
| `gp.next` | Next | Siguiente |
| `gp.skipped` | Skipped | Omitido |
| `gp.redo` | Redo | Rehacer |
| `gp.back` | Remove last point | Quitar el último punto |
| `gp.skip` | Skip this implant | Omitir este implante |
| `gp.restart` | Start over | Empezar de nuevo |
| `gp.cancel` | Cancel | Cancelar |
| `gp.align` | one: Align with 1 point · other: Align with {count} points | one: Alinear con 1 punto · other: Alinear con {count} puntos |
| `gp.one` | One point only moves the implant set; it doesn't turn it. | Un solo punto solo desplaza el conjunto; no lo gira. |
| `gp.two` | With two points, the turn around their line stays free. | Con dos puntos, el giro alrededor de su línea queda libre. |
| `gp.announce` | Point {n} placed. Next: implant {label}. | Punto {n} colocado. Siguiente: implante {label}. |
| `gp.announceLast` | Point {n} placed. Aligning… | Punto {n} colocado. Alineando… |
| `gp.miss` | Nothing under the crosshair. Pan (arrow keys) or turn (Shift + arrows) the view until it sits on the top of the scan body, then press Enter. | No hay nada bajo la mira. Desplaza (flechas) o gira (Shift + flechas) la vista hasta que quede sobre la parte superior del scan body y pulsa Enter. |

### 12.6 Export and email gate

| Key | EN | ES |
|---|---|---|
| `ex.title` | Export for Exocad | Exportar para Exocad |
| `ex.textJaw` | One ZIP with everything in the jaw scan's coordinates. | Un ZIP con todo en las coordenadas del escaneo de la arcada. |
| `ex.textCapture` | One ZIP with everything in the capture's coordinates. | Un ZIP con todo en las coordenadas de la captura. |
| `ex.what` | What's in the ZIP | Qué trae el ZIP |
| `ex.files.combined` | combined.stl: the jaw scan and every replacement in one file. The surfaces are joined, not merged or cut. | combined.stl: el escaneo y todos los reemplazos en un archivo. Las superficies se juntan; no se fusionan ni se recortan. |
| `ex.files.combinedNoJaw` | combined.stl: every replacement in one file (the same as replacements.stl when there is no jaw scan). | combined.stl: todos los reemplazos en un archivo (igual a replacements.stl cuando no hay escaneo). |
| `ex.files.replacements` | replacements.stl: all replacement bodies together. | replacements.stl: todos los cuerpos de reemplazo juntos. |
| `ex.files.single` | `replacement_<label>.stl`: one file per implant, named after its label. | `replacement_<etiqueta>.stl`: un archivo por implante, con su etiqueta. |
| `ex.files.jaw` | jaw.stl or jaw.ply: your jaw scan, byte for byte as you imported it. | jaw.stl o jaw.ply: tu escaneo, byte a byte como lo importaste. |
| `ex.files.report` | report.json: positions as 4×4 matrices (mm, row-major), alignment metrics and checksums. No file names, no patient data. | report.json: posiciones como matrices de 4×4 (mm, por filas), métricas de alineación y sumas de verificación. Sin nombres de archivos ni datos de pacientes. |
| `ex.files.readme` | README.txt: how to use the files, in Spanish and English. | README.txt: cómo usar los archivos, en español e inglés. |
| `ex.sum.coords` | Coordinates | Coordenadas |
| `ex.sum.jaw` | Jaw scan | Escaneo de la arcada |
| `ex.sum.capture` | Capture | Captura |
| `ex.sum.implants` | Implants | Implantes |
| `ex.sum.alignment` | Alignment | Alineación |
| `ex.sum.alignmentValue` | {status} · {method} · RMS {rms} µm | {status} · {method} · RMS {rms} µm |
| `ex.sum.none` | None | Ninguna |
| `ex.warnWeak` | The alignment is weak: check it in Exocad before using the files. | La alineación es débil: revísala en Exocad antes de usar los archivos. |
| `ex.warnAmbiguous` | The alignment is ambiguous: check it in Exocad before using the files. | La alineación es ambigua: revísala en Exocad antes de usar los archivos. |
| `ex.warnManual` | The implant set was placed by hand: check every implant. | El conjunto de implantes se colocó a mano: revisa cada implante. |
| `ex.warnProvisional` | one: Includes 1 provisional position (noted in the report). · other: Includes {count} provisional positions (noted in the report). | one: Incluye 1 posición provisional (anotada en el informe). · other: Incluye {count} posiciones provisionales (anotadas en el informe). |
| `ex.warnRotation` | Some scan bodies are round, so their rotation is unknown (noted in the report). | Algunos scan bodies son redondos, así que su giro es desconocido (anotado en el informe). |
| `ex.button` | Export ZIP | Exportar ZIP |
| `ex.building` | Preparing ZIP… | Preparando ZIP… |
| `ex.again` | Download again | Descargar de nuevo |
| `ex.last` | Exported at {time} · {size} MB | Exportado a las {time} · {size} MB |
| `email.title` | One step before your first download | Un paso antes de tu primera descarga |
| `email.text` | DDT Xchange is free. Enter your personal, company or office email to download. We'll send you occasional news about Experts DDT tools, libraries and courses. | DDT Xchange es gratis. Escribe tu correo personal, de la empresa o del consultorio para descargar. Te enviaremos novedades ocasionales sobre herramientas, librerías y cursos de Experts DDT. |
| `email.label` | Email | Correo electrónico |
| `email.hint` | Personal, company or office | Personal, de la empresa o del consultorio |
| `email.placeholder` | name@clinic.com | nombre@clinica.com |
| `email.submit` | Continue to download | Continuar con la descarga |
| `email.later` | Not now | Ahora no |
| `email.close` | Close | Cerrar |
| `email.note` | We only receive this email address: your files and patient data never leave this computer. You can unsubscribe at any time. | Solo recibimos este correo: tus archivos y los datos de pacientes nunca salen de esta computadora. Puedes darte de baja cuando quieras. |
| `email.privacy` | Privacy policy (opens in a new tab) | Política de privacidad (se abre en otra pestaña) |
| `email.once` | We'll only ask once on this browser. | Solo te lo pediremos una vez en este navegador. |
| `email.invalid` | Enter a valid email, like name@clinic.com. | Escribe un correo válido, por ejemplo nombre@clinica.com. |

### 12.7 Toasts and live announcements

| Key | EN | ES |
|---|---|---|
| `say.step` | Step {n} of 4: {name}. | Paso {n} de 4: {name}. |
| `say.captureOk` | one: Capture imported: 1 implant. · other: Capture imported: {count} implants. | one: Captura importada: 1 implante. · other: Captura importada: {count} implantes. |
| `say.captureReplaced` | Capture replaced. | Captura reemplazada. |
| `say.detected` | Positions found: {found}. Provisional: {provisional}. Not recognized: {unresolved}. (parts with 0 are left out) | Posiciones encontradas: {found}. Provisionales: {provisional}. No reconocidas: {unresolved}. (se omiten las partes en 0) |
| `say.applied` | {name} applied to {target}. | {name} aplicada a {target}. |
| `say.undo` | Undo | Deshacer |
| `say.undone` | Undone. | Deshecho. |
| `say.saved` | {name} saved to your geometries. | {name} guardada en tus geometrías. |
| `say.favOn` | {name} added to favorites. | {name} agregada a favoritas. |
| `say.favOff` | {name} removed from favorites. | {name} quitada de favoritas. |
| `say.renamed` | Renamed to {name}. | Ahora se llama {name}. |
| `say.removed` | {name} removed. | {name} eliminada. |
| `say.libImported` | one: 1 geometry imported. · other: {count} geometries imported. | one: 1 geometría importada. · other: {count} geometrías importadas. |
| `say.libRenamed` | one: 1 renamed to avoid a repeated name. · other: {count} renamed to avoid repeated names. | one: 1 renombrada para evitar un nombre repetido. · other: {count} renombradas para evitar nombres repetidos. |
| `say.libExported` | Geometries exported. | Geometrías exportadas. |
| `say.jawReady` | Jaw scan ready. Aligning automatically… | Escaneo listo. Alineando automáticamente… |
| `say.aligning` | Aligning: {stage}… | Alineando: {stage}… |
| `say.aligned` | Aligned: {status}, RMS {rms} µm. | Alineado: {status}, RMS {rms} µm. |
| `say.alignFailed` | No usable fit. The position was not changed. | Sin ajuste útil. La posición no cambió. |
| `say.alignCancelled` | Alignment cancelled. | Alineación cancelada. |
| `say.cancelled` | Cancelled. | Cancelado. |
| `say.measured` | Fit measured: {status}, RMS {rms} µm. | Ajuste medido: {status}, RMS {rms} µm. |
| `say.exportReady` | ZIP ready: {size} MB. | ZIP listo: {size} MB. |
| `say.linkCopied` | Link copied. | Enlace copiado. |
| `say.sample` | Sample case loaded: synthetic data, no patient. Press Continue. | Caso de ejemplo cargado: datos sintéticos, sin paciente. Pulsa Continuar. |
| `say.sampleHint` | Pick it to apply it to all implants | Elígela para aplicarla a todos los implantes |
| `say.newCase` | New case: start with the arch and the capture. | Caso nuevo: empieza por la arcada y la captura. |
| `say.selected` | Implant {label} selected. | Implante {label} seleccionado. |
| `say.pivot` | Rotation center set. (Home) | Centro de giro fijado. |
| `say.pivotMiss` | No surface there. The rotation center did not change. | No hay ninguna superficie ahí. El centro de giro no cambió. |
| `say.hidden` | {name} hidden. Press S to show everything again. ({name} = the Display switch label) | Se ocultó: {name}. Pulsa S para volver a mostrar todo. |
| `say.shown` | Everything you hid is visible again. | Lo que ocultaste vuelve a estar visible. |
| `say.view` | View: {name}. (a view from the keyboard; {name} = the view button's label) | Vista: {name}. |
| `say.working` | Working… | Procesando… |
| `say.dismiss` | Dismiss | Cerrar |

### 12.8 Warnings (`WARNING_CODES`, all 9)

Shown as amber notes under the import that produced them; never blocking.

| Code | EN | ES |
|---|---|---|
| `MESH_DEGENERATE_TRIANGLES_DROPPED` {count} | one: 1 empty triangle was skipped; the rest of the surface is intact. · other: {count} empty triangles were skipped; the rest of the surface is intact. | one: Se omitió 1 triángulo vacío; el resto de la superficie está intacto. · other: Se omitieron {count} triángulos vacíos; el resto de la superficie está intacto. |
| `MESH_LARGE` {triangles} | Large scan ({triangles} triangles). It works, but the view and the alignment will be slower. | Escaneo grande ({triangles} triángulos). Funciona, pero la vista y la alineación serán más lentas. |
| `MESH_UNITS_SUSPECT` {extentMm} | The mesh measures {extent} mm across, which is unusual for {purposeA}. Files must be in millimeters: nothing is converted. | La malla mide {extent} mm de extremo a extremo, algo inusual para {purposeA}. Los archivos deben estar en milímetros: no se convierte nada. |
| `MESH_COLORS_IGNORED` | The colors in this PLY were incomplete and were ignored. | Los colores de este PLY estaban incompletos y se ignoraron. |
| `STL_MULTIPLE_SOLIDS` {count} | This STL holds {count} parts; all of them were imported. | Este STL trae {count} partes; se importaron todas. |
| `UNITS_ASSUMED_MM` | The file doesn't state its units; millimeters were assumed. | El archivo no indica sus unidades; se asumieron milímetros. |
| `COMPONENT_FRAGMENTS` {count} | one: 1 small fragment was found and left out of the detection. · other: {count} small fragments were found and left out of the detection. | one: Se encontró 1 fragmento pequeño y se dejó fuera de la detección. · other: Se encontraron {count} fragmentos pequeños y se dejaron fuera de la detección. |
| `SITE_INDEX_AMBIGUOUS` {count} | one: 1 scan body is round: its rotation around the implant axis can't be read. Position and axis are exact. · other: {count} scan bodies are round: their rotation around the implant axis can't be read. Positions and axes are exact. | one: 1 scan body es redondo: no se puede leer su giro alrededor del eje. La posición y el eje son exactos. · other: {count} scan bodies son redondos: no se puede leer su giro alrededor del eje. Las posiciones y los ejes son exactos. |
| `SITE_PROVISIONAL` {count} | one: 1 position is provisional: check it before you continue. · other: {count} positions are provisional: check them before you continue. | one: 1 posición es provisional: revísala antes de continuar. · other: {count} posiciones son provisionales: revísalas antes de continuar. |

### 12.9 Errors (`ERROR_CODES`, all 39, plus UI-only codes)

Alert anatomy: **title** + body + muted line `err.code` ("Code: FORMAT_UNSUPPORTED · spreadsheet"), prefixed with
`s1.fileOf` when several files were imported. `CANCELLED` never shows an alert: only the quiet status line
`say.cancelled` / `say.alignCancelled`. Tokens: `{size}` and `{limit}` in MB (1 decimal) when the details are bytes,
raw counts otherwise; `{purposeA}`, `{accepted}`, `{loc}`, `{formatName}` from §12.10; `{FORMAT}` = details.format in
capitals. A reason row overrides the code row; an unknown reason falls back to the code row.

| Code · reason (details) | EN | ES |
|---|---|---|
| `INTERNAL` | **Something went wrong.** An unexpected error stopped this step. Your files and your case are unchanged. Try again; if it happens again, contact us and mention the code below. | **Algo salió mal.** Un error inesperado detuvo este paso. Tus archivos y tu caso no cambiaron. Inténtalo de nuevo; si se repite, contáctanos e indica el código de abajo. |
| `INVALID_ARGUMENT` | **An internal check failed.** A safety check inside DDT Xchange stopped this step. Your files and your case are unchanged. Try again; if it happens again, contact us and mention the code below. | **Falló una verificación interna.** Una verificación de seguridad de DDT Xchange detuvo este paso. Tus archivos y tu caso no cambiaron. Inténtalo de nuevo; si se repite, contáctanos e indica el código de abajo. |
| `CANCELLED` | (no alert) Cancelled. | (sin alerta) Cancelado. |
| `FILE_EMPTY` | **The file is empty.** It has no content (0 bytes). Export it again from your software. | **El archivo está vacío.** No tiene contenido (0 bytes). Expórtalo de nuevo desde tu software. |
| `FILE_TOO_LARGE` {limitBytes, bytes} | **File too large.** This file is {size} MB; the limit for {purposeA} is {limit} MB. Reduce it in your software and try again. | **Archivo demasiado grande.** Este archivo pesa {size} MB; el límite para {purposeA} es de {limit} MB. Redúcelo en tu software y vuelve a intentarlo. |
| `FORMAT_UNKNOWN` | **Format not recognized.** DDT Xchange doesn't read this kind of file. Accepted here: {accepted}. | **Formato no reconocido.** DDT Xchange no lee este tipo de archivo. Aquí se aceptan: {accepted}. |
| `FORMAT_NOT_ALLOWED` {format, purpose} | **Format not accepted here.** {FORMAT} files can't be used as {purposeA}. Accepted here: {accepted}. | **Formato no aceptado aquí.** Los archivos {FORMAT} no se pueden usar como {purposeA}. Aquí se aceptan: {accepted}. |
| ↳ purpose `jaw` (appended) | The jaw scan is copied byte for byte into the export, so it must be a format Exocad opens as a scan. | El escaneo se copia byte a byte en la exportación, así que debe estar en un formato que Exocad abra como escaneo. |
| `FORMAT_UNSUPPORTED` · `nativeVendorFormat` | **Native scanner project.** PIC, Tupel and BEB project files can't be read without guessing their content. Export the implant positions as CSV or XML from the scanner software. | **Proyecto nativo del escáner.** Los proyectos PIC, Tupel y BEB no se pueden leer sin adivinar su contenido. Exporta las posiciones de los implantes como CSV o XML desde el software del escáner. |
| ↳ `spreadsheet` | **Excel file.** Spreadsheets aren't read directly. In Excel choose File › Save As › CSV (comma delimited), then import the CSV. | **Archivo de Excel.** Las hojas de cálculo no se leen directamente. En Excel elige Archivo › Guardar como › CSV (delimitado por comas) e importa ese CSV. |
| ↳ `freeform` | **Curved surfaces in the OBJ.** This OBJ uses freeform curves or surfaces{loc}. Export it as a triangle mesh; STL is the safest choice. | **Superficies curvas en el OBJ.** Este OBJ usa curvas o superficies libres{loc}. Expórtalo como malla de triángulos; STL es lo más seguro. |
| ↳ `columnMajor` | **Matrices stored by columns.** This file writes its matrices column by column. DDT Xchange only accepts row-major matrices, so it never has to guess. Export them row-major (or transposed) and try again. | **Matrices guardadas por columnas.** Este archivo escribe sus matrices columna por columna. DDT Xchange solo acepta matrices por filas (row-major), para no tener que adivinar. Expórtalas por filas (o transpuestas) y vuelve a intentarlo. |
| ↳ `quaternion` | **Rotations as quaternions.** Rotations written as quaternions aren't supported. Use 4×4 matrices. | **Rotaciones en cuaterniones.** No se admiten rotaciones escritas como cuaterniones. Usa matrices de 4×4. |
| ↳ `unknownVersion` | **MicronMapper version not supported.** Only MicronMapper V1.4 (AXO markers) and V1.6 (AHY markers) are read, and the marker prefix must match the version. | **Versión de MicronMapper no admitida.** Solo se leen MicronMapper V1.4 (marcadores AXO) y V1.6 (marcadores AHY), y el prefijo de los marcadores debe coincidir con la versión. |
| ↳ other reason | **Variant not supported.** This file uses a variant DDT Xchange doesn't read. | **Variante no admitida.** Este archivo usa una variante que DDT Xchange no lee. |
| `TEXT_ENCODING` · `invalid` | **Unreadable text.** The file isn't valid UTF-8 text (or UTF-16 with a byte-order mark). Save it again as UTF-8. | **Texto ilegible.** El archivo no es texto UTF-8 válido (ni UTF-16 con marca de orden de bytes). Guárdalo de nuevo como UTF-8. |
| ↳ `nul` | **Binary data in a text file.** The file holds binary data where text was expected. It may be damaged or of another type. | **Datos binarios en un archivo de texto.** El archivo trae datos binarios donde se esperaba texto. Puede estar dañado o ser de otro tipo. |
| `NUMBER_INVALID` | **Invalid number.** A value that must be a number isn't one{loc}. Check the file or export it again. | **Número no válido.** Un valor que debe ser un número no lo es{loc}. Revisa el archivo o expórtalo de nuevo. |
| `COORDINATE_OUT_OF_RANGE` | **Coordinate out of range.** A coordinate is beyond 100 m{loc}. The file is damaged or not in millimeters. | **Coordenada fuera de rango.** Una coordenada supera los 100 m{loc}. El archivo está dañado o no está en milímetros. |
| `TOO_MANY_TRIANGLES` {limit, count} | **Too many triangles.** This mesh has {count} triangles; the limit for {purposeA} is {limit}. Reduce it (decimate) in your software and try again. | **Demasiados triángulos.** Esta malla tiene {count} triángulos; el límite para {purposeA} es de {limit}. Redúcela (diezmar) en tu software y vuelve a intentarlo. |
| ↳ without `count` | **Too many triangles.** This mesh has more than {limit} triangles, the limit for {purposeA}. Reduce it (decimate) in your software and try again. | **Demasiados triángulos.** Esta malla tiene más de {limit} triángulos, el límite para {purposeA}. Redúcela (diezmar) en tu software y vuelve a intentarlo. |
| `TOO_MANY_VERTICES` {limit} | **Too many vertices.** This mesh has more than {limit} vertices, the limit for {purposeA}. Reduce it (decimate) in your software and try again. | **Demasiados vértices.** Esta malla tiene más de {limit} vértices, el límite para {purposeA}. Redúcela (diezmar) en tu software y vuelve a intentarlo. |
| `TOO_MANY_POSITIONS` {limit} | **Too many implant positions.** The file lists more than {limit} positions. Check that it is a position file, or split it. | **Demasiadas posiciones.** El archivo trae más de {limit} posiciones. Revisa que sea un archivo de posiciones o divídelo. |
| `TOO_MANY_COMPONENTS` {limit, count} | **Too many separate bodies.** The capture splits into {count} separate bodies; up to {limit} are supported. Is it a full jaw scan instead of a capture of the scan bodies? | **Demasiados cuerpos separados.** La captura se divide en {count} cuerpos separados; se admiten hasta {limit}. ¿Es un escaneo completo de la arcada en lugar de una captura de los scan bodies? |
| ↳ `shells` | **Mesh in too many pieces.** The mesh breaks into more than {limit} pieces, usually scan noise. Clean it in your software and try again. | **Malla en demasiados pedazos.** La malla se divide en más de {limit} pedazos, normalmente ruido del escaneo. Límpiala en tu software y vuelve a intentarlo. |
| `MESH_TRUNCATED` | **The file is cut short.** It ends before all its data{loc}. Copy or export it again. | **El archivo está incompleto.** Termina antes de tiempo{loc}. Cópialo o expórtalo de nuevo. |
| `MESH_MALFORMED` {format, reason, line} | **Damaged {FORMAT} file.** The file doesn't follow the {FORMAT} format{loc}. Export it again from your software. | **Archivo {FORMAT} dañado.** El archivo no sigue el formato {FORMAT}{loc}. Expórtalo de nuevo desde tu software. |
| `MESH_INDEX_OUT_OF_RANGE` | **Broken face.** A face points to a vertex that doesn't exist{loc}. The file is damaged; export it again. | **Cara rota.** Una cara apunta a un vértice que no existe{loc}. El archivo está dañado; expórtalo de nuevo. |
| `MESH_EMPTY` {dropped} | **No surface in the file.** It has no usable triangles{dropped}. Point clouds aren't supported: export a mesh. `{dropped}` = " ({n} empty ones skipped)" when > 0 | **El archivo no tiene superficie.** No tiene triángulos útiles{dropped}. No se admiten nubes de puntos: exporta una malla. `{dropped}` = " (se omitieron {n} vacíos)" si > 0 |
| `POSITIONS_MALFORMED` {format, reason, row} | **Unexpected layout.** The file was read as {formatName} but doesn't follow its layout{loc}. | **Estructura inesperada.** El archivo se leyó como {formatName}, pero no sigue su estructura{loc}. |
| ↳ `columns` | **Columns not recognized.** Use one name column (name, label, position, toothnumber or marker) plus Mat0–Mat3, m00–m33, or origin, axis and indexed columns, and nothing else{loc}. | **Columnas no reconocidas.** Usa una columna de nombre (name, label, position, toothnumber o marker) más Mat0–Mat3, m00–m33, o columnas origin, axis e indexed, y nada más{loc}. |
| ↳ `json` | **The JSON can't be read.** It has a syntax error. Export it again. | **No se puede leer el JSON.** Tiene un error de sintaxis. Expórtalo de nuevo. |
| ↳ `applicationMissing`, `applicationRepeated` | **MicronMapper header problem.** The "Application:" line must appear exactly once. | **Problema en el encabezado de MicronMapper.** La línea "Application:" debe aparecer exactamente una vez. |
| ↳ `matrixOrderMissing`, `matrixOrder` | **Matrix order not stated.** The file must say that its matrices are row-major (for example matrixOrder = "row-major"). | **Orden de matriz no indicado.** El archivo debe indicar que sus matrices son por filas (por ejemplo matrixOrder = "row-major"). |
| ↳ `endpointMissing`, `endpointRepeated` | **Incomplete iCam point.** Each implant needs exactly one _Origin, _X, _Y and _Z line{loc}. | **Punto de iCam incompleto.** Cada implante necesita exactamente una línea _Origin, _X, _Y y _Z{loc}. |
| `POSITIONS_EMPTY` | **No positions found.** The file was read, but it holds no implant positions. | **No hay posiciones.** El archivo se leyó, pero no contiene posiciones de implantes. |
| `POSITIONS_AMBIGUOUS` | **Ambiguous separator.** The table reads differently with different separators (comma, semicolon, tab, bar, space). Save it with a single separator, for example as comma-separated CSV. | **Separador ambiguo.** La tabla se lee distinto según el separador (coma, punto y coma, tabulador, barra, espacio). Guárdala con un solo separador, por ejemplo como CSV separado por comas. |
| `LABEL_INVALID` {row} | **Invalid implant label.** A label is empty, too long or uses unsupported characters{loc}. Labels have 1 to 40 letters, digits, spaces, dots, dashes or underscores. | **Etiqueta de implante no válida.** Una etiqueta está vacía, es muy larga o usa caracteres no admitidos{loc}. Las etiquetas tienen de 1 a 40 letras, dígitos, espacios, puntos, guiones o guiones bajos. |
| `LABEL_DUPLICATE` {row} | **Repeated implant label.** Two positions share the same label{loc}. Each implant needs its own label. | **Etiqueta de implante repetida.** Dos posiciones tienen la misma etiqueta{loc}. Cada implante necesita su propia etiqueta. |
| ↳ `crossFile` (raised by the UI merge) | **Same implant, two positions.** Two of the selected files give different positions for the same implant label. Import them one at a time to see which one you need. | **Mismo implante, dos posiciones.** Dos de los archivos elegidos dan posiciones distintas para la misma etiqueta de implante. Impórtalos de uno en uno para ver cuál necesitas. |
| `UNITS_MISSING` {row} | **Units missing.** The file must state its units as millimeters (for example units: "mm"){loc}. | **Faltan las unidades.** El archivo debe indicar sus unidades en milímetros (por ejemplo units: "mm"){loc}. |
| `UNITS_NOT_MM` {row} | **Units must be millimeters.** The file uses other units{loc}. DDT Xchange never converts units, to avoid silent scale errors. Export in millimeters. | **Las unidades deben ser milímetros.** El archivo usa otras unidades{loc}. DDT Xchange nunca convierte unidades, para evitar errores de escala silenciosos. Exporta en milímetros. |
| `XML_MALFORMED` {reason, offset} | **Damaged XML.** The XML isn't well formed{loc}. Export it again. | **XML dañado.** El XML no está bien formado{loc}. Expórtalo de nuevo. |
| `XML_FORBIDDEN` {reason, offset} | **XML feature refused.** The XML holds a DOCTYPE, an entity or a processing instruction, which are refused for security. Export a plain XML file. | **Elemento XML rechazado.** El XML trae un DOCTYPE, una entidad o una instrucción de procesamiento, que se rechazan por seguridad. Exporta un XML simple. |
| `MATRIX_INVALID` {reason, row} | **Invalid matrix.** A position matrix isn't 16 valid numbers{loc}. | **Matriz no válida.** Una matriz de posición no tiene 16 números válidos{loc}. |
| `MATRIX_NOT_RIGID` {reason, row} | **Not a rigid position.** The matrix{loc} isn't just a rotation plus a translation: {reasonText}. | **No es una posición rígida.** La matriz{loc} no es solo una rotación más una traslación: {reasonText}. |
| ↳ `{reasonText}` | `lastRow` its last row isn't 0 0 0 1 · `notOrthonormal` its axes are scaled or not perpendicular · `reflection` it mirrors the geometry · `translationRange` its position is out of range · `axisLength` its axes have different lengths · other: it fails the check | `lastRow` su última fila no es 0 0 0 1 · `notOrthonormal` sus ejes están escalados o no son perpendiculares · `reflection` refleja la geometría como un espejo · `translationRange` su posición está fuera de rango · `axisLength` sus ejes tienen longitudes distintas · otra: no pasa la verificación |
| `DEGENERATE_GEOMETRY` {reason} | **Unusable geometry.** The geometry is flat or has no area, so it can't be used. Check the file. | **Geometría inutilizable.** La geometría es plana o no tiene área, así que no se puede usar. Revisa el archivo. |
| `INSUFFICIENT_DATA` | **Not enough data.** There isn't enough data for this step. | **Datos insuficientes.** No hay datos suficientes para este paso. |
| ↳ `noJaw` | **No jaw scan.** Load the jaw scan first. | **Sin escaneo.** Primero carga el escaneo de la arcada. |
| ↳ `noParts`, `noTriangles` | **No implant surfaces.** There are no implant surfaces to align. Give every implant a geometry, or choose other surfaces to match. | **Sin superficies de implantes.** No hay superficies de implantes para alinear. Asigna una geometría a cada implante o elige otras superficies a comparar. |
| `REFERENCE_NO_MATCH` {reason} | **This scan body can't be used.** The file has no surface area, so it can't be fitted. Load the STL of the scan body that appears in the capture. | **Este scan body no se puede usar.** El archivo no tiene área, así que no se puede ajustar. Carga el STL del scan body que aparece en la captura. |
| `ALIGNMENT_FAILED` {reason} | **The surfaces don't match.** No starting position found enough matching points between the implants and the jaw scan. Check that the jaw scan shows these scan bodies and that the surfaces to match are right, or use guided points. | **Las superficies no coinciden.** Ninguna posición inicial encontró suficientes puntos en común entre los implantes y el escaneo. Revisa que el escaneo muestre estos scan bodies y que las superficies a comparar sean las correctas, o usa los puntos guiados. |
| `LANDMARKS_INVALID` · `none` | **No points placed.** Place at least one point on the jaw scan. | **No hay puntos.** Coloca al menos un punto en el escaneo. |
| ↳ `coincident` | **Points on top of each other.** The points are too close together. Spread them along the arch. | **Puntos superpuestos.** Los puntos están demasiado juntos. Repártelos a lo largo de la arcada. |
| ↳ `nonFinite` | **A point couldn't be read.** Place it again. | **No se pudo leer un punto.** Colócalo de nuevo. |
| `WORKER_FAILED` · `start` | **The calculation engine didn't start.** This browser blocked it or couldn't start it. Update the browser, or use a recent Chrome, Edge, Firefox or Safari. | **El motor de cálculo no arrancó.** Este navegador lo bloqueó o no pudo iniciarlo. Actualiza el navegador o usa Chrome, Edge, Firefox o Safari recientes. |
| ↳ `crashed` | **The calculation stopped.** The browser stopped it, usually for lack of memory. Your case is still here: try again, close other tabs, or use a lighter jaw scan. | **El cálculo se detuvo.** El navegador lo detuvo, normalmente por falta de memoria. Tu caso sigue aquí: inténtalo de nuevo, cierra otras pestañas o usa un escaneo más liviano. |
| `EXPORT_GEOMETRY_MISSING` {site} (`{label}` = `sites[site].label`) | **Implant without geometry.** Implant {label} has no replacement geometry. Give it one in step 2. | **Implante sin geometría.** El implante {label} no tiene geometría de reemplazo. Asígnale una en el paso 2. |
| `EXPORT_NAME_INVALID` {index} | **Unsafe file name.** A file name inside the ZIP couldn't be made safe (entry {n}). Contact us and mention the code below. | **Nombre de archivo no seguro.** Un nombre de archivo dentro del ZIP no se pudo volver seguro (entrada {n}). Contáctanos e indica el código de abajo. |
| `EXPORT_TOO_LARGE` {limitBytes, bytes} | **Export too large.** The ZIP would be {size} MB; the limit is {limit} MB. Use a lighter (decimated) jaw scan and try again. | **Exportación demasiado grande.** El ZIP pesaría {size} MB; el límite es de {limit} MB. Usa un escaneo más liviano (diezmado) y vuelve a intentarlo. |
| ↳ `entries` {limit, count} | **Too many files.** The ZIP would hold {count} files; the limit is {limit}. | **Demasiados archivos.** El ZIP tendría {count} archivos; el límite es de {limit}. |

UI-only codes (`ui.*`, raised by the interface, same alert anatomy):

| Key | EN | ES |
|---|---|---|
| `ui.oneMesh` | **One capture mesh at a time.** Import a single capture mesh, alone or together with position files. | **Una malla de captura a la vez.** Importa una sola malla de captura, sola o junto con archivos de posiciones. |
| `ui.readFailed` | **The file couldn't be read.** The browser couldn't open it (it may have moved, or access was denied). Choose it again. | **No se pudo leer el archivo.** El navegador no pudo abrirlo (puede haberse movido o no se dio acceso). Elígelo de nuevo. |
| `ui.assemblyCount` {bodies, sites} | **Bodies and implants don't match.** This file holds {bodies} bodies but the capture has {sites} implants. Load a single body, or one body per implant. | **Los cuerpos no coinciden con los implantes.** Este archivo trae {bodies} cuerpos, pero la captura tiene {sites} implantes. Carga un solo cuerpo o un cuerpo por implante. |
| `ui.notAligned` | **Align before exporting.** With a jaw scan, the replacements must be aligned first or they won't line up in Exocad. Align them, or remove the jaw scan in step 3 to export in the capture's coordinates. | **Alinea antes de exportar.** Con un escaneo de la arcada, primero hay que alinear los reemplazos o no coincidirán en Exocad. Alinéalos o quita el escaneo en el paso 3 para exportar en las coordenadas de la captura. |
| `ui.webglUnavailable` | **3D isn't available.** This browser can't show 3D (WebGL 2 is off or not supported). Turn on hardware acceleration, or use a recent Chrome, Edge, Firefox or Safari. | **El 3D no está disponible.** Este navegador no puede mostrar 3D (WebGL 2 está desactivado o no es compatible). Activa la aceleración por hardware o usa Chrome, Edge, Firefox o Safari recientes. |
| `ui.storageUnavailable` (note) | **Geometries won't be kept.** This browser blocks local storage (private mode or site-data settings). Your geometries work for this visit only. | **Las geometrías no se guardarán.** Este navegador bloquea el almacenamiento local (modo privado o configuración de datos del sitio). Tus geometrías funcionan solo durante esta visita. |
| `ui.storageFull` | **Browser storage is full.** There's no room to save this geometry. Remove geometries you don't use, or export them as a backup and clean up. | **El almacenamiento del navegador está lleno.** No hay espacio para guardar esta geometría. Elimina geometrías que no uses, o expórtalas como respaldo y haz limpieza. |
| `ui.libraryFull` {limit} | **Library full.** You can keep up to {limit} geometries. Remove one to add another. | **Biblioteca llena.** Puedes guardar hasta {limit} geometrías. Elimina una para agregar otra. |
| `ui.libraryFileInvalid` | **Not a geometry file from DDT Xchange.** Import a file made with "Export geometries". | **No es un archivo de geometrías de DDT Xchange.** Importa un archivo creado con «Exportar geometrías». |
| `ui.libraryFileTooLarge` {limit} | **Library file too large.** The limit is {limit} MB. | **Archivo de biblioteca demasiado grande.** El límite es de {limit} MB. |
| `ui.librarySkipped` {count} (warning) | one: 1 geometry in the file couldn't be read and was skipped. · other: {count} geometries in the file couldn't be read and were skipped. | one: 1 geometría del archivo no se pudo leer y se omitió. · other: {count} geometrías del archivo no se pudieron leer y se omitieron. |
| `ui.copyFailed` | The link couldn't be copied. Copy it from the address bar. | No se pudo copiar el enlace. Cópialo desde la barra de direcciones. |
| `err.code` (`{reason}` = " · id" when present) | Code: {code}{reason} | Código: {code}{reason} |
| `err.dismiss` | Dismiss | Cerrar |

### 12.10 Shared phrases

| Key | EN | ES |
|---|---|---|
| `purpose.jaw` | a jaw scan | un escaneo de la arcada |
| `purpose.capture` | a capture mesh | una malla de captura |
| `purpose.positions` | a position file | un archivo de posiciones |
| `purpose.geometry` | a geometry | una geometría |
| `purpose.library` | a library file | un archivo de biblioteca |
| `accepted.capture` | MicronMapper CSV, ScanAdaptor XML, iCam TXT, matrix tables (CSV/TXT), JSON, ImplantPositions XML, or an STL, PLY or OBJ mesh | CSV de MicronMapper, XML de ScanAdaptor, TXT de iCam, tablas de matrices (CSV/TXT), JSON, XML ImplantPositions o una malla STL, PLY u OBJ |
| `accepted.jaw` | STL or PLY | STL o PLY |
| `accepted.geometry` | STL, PLY or OBJ | STL, PLY u OBJ |
| `accepted.library` | a .json file made with "Export geometries" | un archivo .json creado con «Exportar geometrías» |
| `loc.row` | (entry {n}) | (entrada {n}) |
| `loc.line` | (line {n}) | (línea {n}) |
| `loc.triangle` | (triangle {n}) | (triángulo {n}) |
| `loc.vertex` | (vertex {n}) | (vértice {n}) |
| `loc.face` | (face {n}) | (cara {n}) |
| `loc.offset` | (near character {n}) | (cerca del carácter {n}) |
| `format.micronmapper-csv` | MicronMapper CSV | CSV de MicronMapper |
| `format.scanadaptor-xml` | ScanAdaptor XML | XML de ScanAdaptor |
| `format.matrix-table` | matrix table | tabla de matrices |
| `format.positions-json` | JSON positions | posiciones en JSON |
| `format.matrix-xml` | ImplantPositions XML | XML ImplantPositions |
| `format.icam-txt` | iCam TXT | TXT de iCam |
| `format.stl` / `.ply` / `.obj` | STL / PLY / OBJ | STL / PLY / OBJ |
| `format.demo` | Sample | Ejemplo |

`{loc}` renders with a leading space (" (line 12)") from the first detail present in the order row, line, triangle,
vertex, face, offset, and is empty when none is present. `row` and `line` are already 1-based; `triangle`, `vertex`,
`face`, `offset`, `site` and `index` are 0-based in the engine and are shown + 1.

---

## 13. Site dictionary keys

Only these go into `src/i18n/en.js` and `es.js` (same shape in both, so `npm run test:i18n` passes; no identical
strings over 25 characters):

```js
// en.js
meta: {
  // …existing keys…
  xchange: 'DDT Xchange: free implant geometry exchange',
  xchangeDesc: 'Free browser tool for labs and clinics: put library geometry on implant positions, align to the jaw scan and export for Exocad. Files never leave your computer.',
},
footer: {
  // …existing keys…
  xchange: 'DDT Xchange (free tool)',
},
pages: {
  libraries: {
    // …existing keys…
    xchange: {
      pill: 'Free tool',
      title: 'Positions and jaw scan that won’t line up?',
      text: 'DDT Xchange puts your library geometry on every implant position, aligns it to the jaw scan and exports a ZIP for Exocad. Free, in your browser.',
      cta: 'Open DDT Xchange',
    },
  },
},

// es.js
meta: {
  xchange: 'DDT Xchange: geometrías de implantes, gratis',
  xchangeDesc: 'Herramienta gratis para laboratorios y clínicas: geometría de librería en las posiciones de implantes, alineada al escaneo y lista para Exocad. Sin subir archivos.',
},
footer: {
  xchange: 'DDT Xchange (herramienta gratis)',
},
pages: {
  libraries: {
    xchange: {
      pill: 'Herramienta gratis',
      title: '¿Posiciones y escaneo que no coinciden?',
      text: 'DDT Xchange coloca la geometría de tu librería en cada posición de implante, la alinea con el escaneo de la arcada y exporta un ZIP para Exocad. Gratis y en tu navegador.',
      cta: 'Abrir DDT Xchange',
    },
  },
},
```

Lengths checked against `scripts/check-dist.mjs`: titles 57 (EN) and 58 (ES) characters with " · Experts DDT",
descriptions 160 and 163 (limits 70 and 170). Everything else on the page comes from `src/xchange/ui/i18n` (§12).

---

## 14. Implementation map and acceptance

### 14.1 Files

Suggested split; merge freely, but keep each file under ~400 lines.

| Path | Role |
|---|---|
| `src/pages/ddt-xchange.astro`, `src/pages/es/ddt-xchange.astro` | Page (sections, server-rendered panels and `<template>`s, page-scoped styles for hero/help/FAQ) and the one-line wrapper |
| `src/layouts/Base.astro` | Footer link (§1) |
| `src/pages/exocad-libraries.astro` | Band (§2.6) |
| `src/scripts/motion.js` | The two-line `scroll-lock` / `scroll-to` bridge (§3.3) |
| `src/xchange/ui/xchange.css` | Tool styles and the §3.1 tokens |
| `src/xchange/ui/i18n/types.ts`, `en.ts`, `es.ts`, `format.ts` | Typed copy (§12), interpolation, plurals, `{loc}`, error → message |
| `src/xchange/ui/main.ts` | `mount`/`dispose`, leave guard, lazy viewer, small-screen and WebGL checks, floats toggle |
| `src/xchange/ui/wizard.ts` | Stepper, gating, panel transitions, focus, announcements |
| `src/xchange/ui/step-capture.ts`, `step-geometry.ts`, `step-jaw.ts`, `step-align.ts`, `export.ts` | One per step |
| `src/xchange/ui/library-list.ts`, `email-gate.ts`, `demo.ts`, `toast.ts`, `dialogs.ts`, `motion.ts` | Shared UI pieces; `motion.ts` wraps GSAP with the reduced-motion switch |
| `src/xchange/state/case.ts` | `CaseState`, actions, invalidation (§5.2), cross-file merge, alignment parts |
| `src/xchange/state/library.ts` | IndexedDB (§7) |
| `src/xchange/state/jobs.ts`, `jobs.worker.ts` | Jobs worker and its client (FIFO, cancel = terminate, the `AlignClient` pattern) |
| `src/xchange/state/lead.ts` | Email storage state machine and POST (§9) |
| `src/xchange/viewer/viewer.ts`, `controls.ts`, `presets.ts`, `manipulate.ts`, `overlay.ts`, `colormap.ts` | Scene and render-on-demand, exocad controls, preset table, set drag/pad, labels/crosshair/readout, LUT and legend |

Jobs worker protocol (sketch; errors cross as `toErrorPayload` / `fromErrorPayload`, results transfer their buffers):
`readCapture { files: { bytes, extension }[] }` → `{ sites, sources, warnings, mesh?, components?, normals? }` ·
`detect { mesh, reference }` → `RecoverResult` · `readGeometry { bytes, extension, sites, captureMesh? }` →
`{ mesh, normals, plan, layout?, warnings }` · `readJaw { bytes, extension }` → `{ mesh, normals, originalBytes,
format, warnings }` · `export { request }` → `ExportBundle` (zip transferred) · `libraryOut { entries }` → `Uint8Array`
· `libraryIn { bytes }` → `{ entries, skipped }`.

### 14.2 Engine API per UI action

| UI action | Runs in | Engine API |
|---|---|---|
| Classify a capture file | jobs | `detectMeshFormat(bytes)` |
| Read a position file | jobs | `parsePositions(bytes, { extension })` |
| Read any mesh (+ display normals) | jobs | `parseMesh(bytes, purpose, hint)`, `computeVertexNormals(mesh)` |
| Split a capture mesh | jobs | `splitComponents(mesh)` |
| Find positions in a capture mesh | jobs | `recoverSitesFromMesh(mesh, { mesh: reference })` |
| Link a position file to a capture mesh | jobs | `linkSitesToComponents(sites, components)` |
| Merge several position files | jobs | `maxAbsDiff(a, b) ≤ 1e-7` (core/mat4) |
| Load a replacement geometry | jobs | `parseMesh(…, 'geometry')`, `planAssembly(mesh, sites)`, `verifyAssemblyLayout(captureMesh, mesh)` |
| Build alignment parts | main | `transformMesh(geometry.mesh, site.matrix)` or `components[site.componentIndex].mesh` |
| Load the jaw | jobs → align | `parseMesh(…, 'jaw')` → `alignClient.setJaw(mesh)` |
| Auto align, refine | align worker | `alignClient.autoAlign(parts, { initial? }, { signal, onProgress })` |
| Guided points | main → align | `orderSitesAlongArch(sites)`, `guidePoint(site, body)`, `alignClient.alignFromLandmarks(parts, pairs, {}, { signal, onProgress })` |
| Re-measure after a move or a surfaces change | align worker | `alignClient.measure(parts, assembly)` |
| Color map | align worker | `alignClient.deviation(parts, assembly)` |
| Status thresholds in copy and per-site status | main | `DEFAULT_QUALITY` (re-exported by `align/multistart`) |
| Export | jobs | `buildBundle(request)` |
| Library file out / in | jobs | `writeBinarySTL(mesh)` / `parseMesh(bytes, 'geometry')` |
| Sample case | main (lazy) | `makeSyntheticCase`, `encodeMicronMapperCSV`, `writeBinarySTL`, then the normal pipeline |
| Any error | everywhere | `isXchangeError`, `toErrorPayload`, `fromErrorPayload` |

### 14.3 Acceptance checklist

1. **Identity** (1280×800, light and dark): the workspace header, card, buttons, pills, fields and dialogs are
   indistinguishable from the other sections; no color outside §3.1, no new font.
2. **Flow**: the sample case end to end with the mouse; again with the keyboard only (guided points through the
   crosshair); NVDA or VoiceOver smoke test: step changes, results and errors are announced.
3. **Motion**: with reduced motion on (the developer default) nothing moves except essential state; emulated
   `no-preference` shows every row of §3.2.
4. **Lenis**: the wheel over the stage zooms and the page does not scroll; over the panel it scrolls the page; with a
   dialog open the page cannot scroll; closing it resumes smooth scroll.
5. **ClientRouter**: ten round trips to /services/ → one canvas, no WebGL context warning, stable heap, no worker
   threads left, `window.__xchMounts` = visits; leaving with a case asks the native "Leave site?" prompt; after an export
   it does not.
6. **Theme**: toggling mid-case restyles stage, materials, labels and chips at once; the color map does not change.
7. **Network and privacy**: during the whole flow the only request is the n8n POST (plus GA if accepted); offline, the
   whole flow including export works and the lead stays pending; no input file name appears in the DOM, IndexedDB,
   localStorage, the console, the POST body or the ZIP (`grep` the ZIP for the original names).
8. **CSP**: no violations in the console with the production policy (test on staging, or with the same policy in a
   `<meta http-equiv>` on a local build), including after removing `'unsafe-inline'` from `script-src`.
9. **Widths** 1280, 1180, 1024, 960, 800, 768: layouts per §4. 767 with touch emulation and 599 with a mouse show
   the larger-screen card; 640 with a mouse (or 1280 at 200 % zoom) keeps the one-column workspace; rotating a tablet
   mounts the 3D without losing anything.
10. **Accessibility scan**: axe (DevTools extension) on every step, light and dark, 0 violations; keyboard-only and
    screen-reader passes as in item 2.
11. **Export**: the ZIP opens; entries and order per CONTRACTS §5; `jaw.*` byte-identical to the input (SHA-256);
    `report.alignment.matchesExport` is `true`.
12. **Email gate**: shown only before the first export; a failing webhook still downloads, keeps `pending` and
    retries on the next visit; the payload has exactly four keys.
13. **Commands**: `npm run test:i18n`, `npm test`, `npm run typecheck:xchange`, `npm run build`, `npm run test:dist`
    pass (one h1, title ≤ 70, description ≤ 170).

### 14.4 Tests to add (Vitest, pure logic, synthetic data)

- `ui/i18n`: EN and ES have the same keys; every `ERROR_CODES` and `WARNING_CODES` entry has text; no EN string over
  25 characters is identical in ES (the `check-i18n` rule, ignoring strings made only of tokens, numbers and units,
  such as `ex.sum.alignmentValue`); every string has the same `{token}` set in both languages.
- `ui/i18n/format`: `{loc}` priority and +1 offsets; MB rounding; plural pairs; reason fallback.
- `state/case`: cross-file merge (identical within 1e-7 kept once, different → `LABEL_DUPLICATE crossFile`, ids
  re-numbered, merged count limit); invalidation table of §5.2; guided target picking (n = 1…8); per-site status from
  `DEFAULT_QUALITY`; export gating.
- `state/lead`: state machine (none → pending → sent; failure keeps pending; unset webhook → sent; honeypot).
- `viewer/colormap`: LUT endpoints equal the three stops; OKLab lightness strictly decreasing from 0 to 100 µm.
- `viewer/presets`: each preset's up vector is perpendicular to its view direction; Occlusal flips with the arch; Bottom
  is the upper arch's occlusal view; `viewForKey` (number row by code, keypad with NumLock only, symbols win, 7 and 9
  nothing, one key per view).
- `test/ux/controls-keys.ux.test.ts` (controls on stand-ins): view keys never stop their tween; arrows pan, Shift +
  arrows and PageUp/PageDown turn; Ctrl/⌘ + drag anywhere turns the set in step 4; Home at the pointer or the center;
  touch & hold with fake timers; every modified middle click; camera input clears the pressed view; Stage hide/show
  all and the keyboard view announcement.

DOM, WebGL and workers are verified by hand with the checklist above (Playwright would be a new dev dependency; not
needed for v1).

---

## 15. Decisions and open questions

### 15.1 Decisions (the ones that shape the build)

1. `/ddt-xchange/` + `/es/ddt-xchange/`, built only from site section types: page-hero → workspace → help (mist) →
   FAQ → site `<Cta>`. Linked from the footer ("Doctor portal" column) and a band on /exocad-libraries/; not in the
   main nav, not on /services/.
2. Tool copy lives in typed `src/xchange/ui/i18n/{en,es}.ts` (`Record<ErrorCode>` / `Record<WarningCode>`, so
   `typecheck:xchange` enforces coverage); the site dictionaries only get `meta.xchange`, `meta.xchangeDesc`,
   `footer.xchange`, `pages.libraries.xchange`. American English and Latin American Spanish with *tú*, like the site.
3. Layout: a site `.card` shell with a horizontal 4-step stepper, a 340 px panel that grows with the page (no inner
   scroll) and a sticky 3D stage; one column on tablets and on zoomed or narrow desktop windows down to 600 px; on
   touch screens under 768 px (and anything under 600 px) no WebGL and a "larger screen" card.
4. Motion: page sections only through motion.js attributes; the tool card enters through a single-child `data-stagger`
   wrapper so no transform is left on it; inside, GSAP/CSS with the site eases (`expo.out`, `power3.inOut`,
   `power3.out`, `back.out`), dialogs via `@starting-style`, no ScrollTrigger; reduced motion makes everything instant.
5. Lenis: `data-lenis-prevent` on the stage, dialogs, popover and scrolling lists; a two-line `scroll-lock` /
   `scroll-to` event bridge in motion.js, because the Lenis instance is private.
6. Lifecycle: idempotent mount on `astro:page-load`, full dispose on `astro:before-swap`; leave guard =
   `beforeunload` + `preventDefault()` on `astro:before-preparation` (Astro 7.3 then does a full navigation and the
   browser asks).
7. Performance: render on demand, pause off-screen, adaptive pixel ratio while interacting, buffers built once,
   three.js lazy-loaded near the workspace; a new jobs worker for parsing, detection, assembly planning, export and
   the library file, next to the existing `AlignClient` worker.
8. Step 1: mesh-only captures pick a "capture scan body" and detection runs on pick; provisional positions must be
   confirmed or left out; position files merge with re-numbered ids and the 1e-7 cross-file label rule; one mesh max.
9. Step 2: apply on pick to All or the selected implant, with an Undo toast; picking for All auto-advances (said
   beforehand in the step text); `planAssembly` handles single, normalized, fixed and count-mismatch files.
10. Alignment surfaces default to the replacement geometry (the body the jaw scan shows in Fernando's case), with
    captured bodies as an option; loading the jaw starts auto align; with a jaw, export is blocked until an alignment
    is applied; weak, ambiguous and manual results only warn.
11. Guided points: at most four spread targets in `orderSitesAlongArch` order (all when ≤ 4), alignment runs after the
    last one; the keyboard path is the center crosshair + arrows/Shift/±/Enter.
12. Viewer: custom exocad-mapped controller, implant-set drag, Ctrl/⌘-drag arcball rotation, pad with 30°/5° and
    1/0.1 mm steps, flip over / turn around, move to jaw, undo ×20, reset; re-measure and color map 250 ms after every
    move; presets in world axes, assumption to verify.
13. Color map: OKLab LUT `#86efac` → `#fbbf24` → `#dc2626` at 0/50/100+ µm with falling lightness, legend 0–100+,
    exact values in the readout and the per-implant table; status chips always icon + word.
14. Library: IndexedDB `ddt-xchange` v1 with separate `meta`/`mesh` stores, 50 entries, user-given names (never file
    names), favorites first, inline rename and remove confirm, export/import as JSON with base64 binary STLs,
    case-only entries for the sample and positioned assemblies.
15. Email gate: a required email before the first export only (LibraryDownload recipe, honeypot, privacy link in a new
    tab); the POST `{ source: 'ddt-xchange', email, lang, page }` never blocks the download; localStorage keeps only
    "sent" (or the pending email until sent). The sample case (an upper All-on-4 arch) is generated in the browser by
    `sample/` and runs through the real pipeline.

### 15.2 Site follow-ups outside the tool

- motion.js: add the `scroll-lock` / `scroll-to` bridge (required by this design). Optionally `LibraryDownload` can use
  `scroll-lock` too (today its dialog does not stop Lenis).
- motion.js under reduced motion still animates `data-reveal` movement, `data-split`, `data-parallax`, `data-lit` and
  counters (`global.css` only forces opacity). Site-wide fix: when `reduced`, set the end state instead of tweening.
- `docs/n8n/web-leads.workflow.json`: add the `ddt-xchange` branch → Google Sheets; `docs/DEPLOY.md` lists the three
  sources.
- `scripts/smoke.mjs`: add `/ddt-xchange/` and `/es/ddt-xchange/`.

### 15.3 Open questions for Fernando (the UI already has a default)

| # | Question | Default in this design |
|---|---|---|
| P5 | RMS and coverage that count as good/acceptable; block export on a weak fit? | `DEFAULT_QUALITY` interpolated into the copy; weak/ambiguous only warn |
| P8 | Scanner axis conventions for the view presets (three real exports: upper, lower, one PLY) | LPS-like table of §6.3 |
| P3 | Round scan body + indexed replacement: warn, block, or ask for the rotation? | Warn (chip, note, report) |
| P12/P13 | Approval of the consent text and of the "not a clinical validation" wording | §12.6 and §12.5 texts |
| P9 | Typical and maximum implant count per case | Guided targets: all up to 4, four spread above |
| — | Nav placement after launch | Footer + /exocad-libraries/ band only |

### 15.4 Not in v1 (on purpose)

Project save/open, XLSX reading, a CSV template download, a grid floor, a right-click context menu, analytics events,
signed deviation, Boolean union or trimming in `combined.stl`, File System Access folder handles, several capture
meshes at once, moving the implant set without a jaw, Playwright end-to-end tests.

