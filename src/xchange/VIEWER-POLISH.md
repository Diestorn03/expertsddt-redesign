# DDT Xchange · Viewer polish (clean-room exocad conventions)

Spec for making the 3D viewer of `/ddt-xchange/` look and behave like the dental CAD its users already know, while it
stays a section of expertsddt.com. Written 2026-11-08 on `ddt-xchange` at b03dd97, after Diego's review: the viewer
looks nothing like exocad and looks cheap. Spec only: no code changes with this file.

Order of work: **1** the look panel's base commit (z-fight, preset keys) → **2** the winning look merged →
**3** slice A (navigation) → **4** slice B (tools and picking). Slices change behaviour, never the look. All four steps
are done: Diego chose look A "Fiel a exocad" on 2026-11-08 and it is merged with grafts and the judges' fixes (§3.1,
§3.5); slice A (§4.14) and slice B (§5.10) followed the same day. The findings of the UX and adversarial reviews of the
finished viewer were fixed on 2026-11-09 (§5.11).

Contents: 0 Why it looks cheap · 1 Sources · 2 Gap table · 3 Look · 4 Slice A · 5 Slice B · 6 Integration notes

**Terms.** MUST: the slice is not done without it. SHOULD: done if the slice still fits its budget, otherwise it stays
here as To do. WON'T: decided against, reason given. Status values: `Exists` (in b03dd97) · `Handled (look base)` ·
`Look` (the winning look decides) · `Done (look A)` (merged with the look, §3.5) · `Done (slice A)` (§4.14) ·
`Done (slice B)` (§5.10) · `Fixed (review)` (a review finding fixed, §5.11) · `Slice A` · `Slice B` · `To do` · `Won't`. **< 960 px**: the one-column workspace
(tablets in portrait, narrow or zoomed desktop windows down to 600 px, UI-DESIGN §4). Under 768 px on touch and under
600 px on anything the workspace is replaced by the larger-screen card (UI-DESIGN §2.5): no viewer feature runs there.

**Rules for both slices** (from the brief; they override anything below):

- Clean room. Behave and render like a professional dental CAD, but never download, install, open or inspect exocad
  software or files, and never copy its logo, icons, artwork, UI text or exact screen layout. Icons are our own inline
  SVG. Key choices below are conventions, documented from public pages (§1).
- Site identity. Chrome uses the site tokens in both themes (`html[data-theme]`), Poppins, the site radii, the site
  easing (`--ease-out: cubic-bezier(.16,1,.3,1)`, GSAP `expo.out`) through the `ui/motion.ts` helpers, Lenis kept out
  with `data-lenis-prevent` and the `scroll-lock` event, mount on `astro:page-load`, full dispose on
  `astro:before-swap`, `prefers-reduced-motion` respected.
- No new npm dependency; procedural only (no textures, no HDR files); nothing is fetched; patient files never leave
  the browser.
- Every new string in `ui/i18n/en.ts` and `es.ts` (same keys, same `{tokens}`, natural Spanish with the existing terms).
- WCAG 2.2 AA: names and tooltips on icon buttons, a keyboard path for every pointer action, visible focus, 4.5:1 text,
  3:1 non-text, in both themes.
- Tests: existing assertions are never weakened; new logic gets Vitest tests. Behaviour pinned today and kept:
  one-finger drag only turns the view, a tap places a guided point or selects an implant
  (`test/ux/controls-touch.ux.test.ts`); T, C and Backspace act once after a viewer restart, a set drag commits the
  pose on release, pad steps start from the committed pose (`test/adversarial/viewer-export.adversarial.test.ts`);
  preset up ⟂ direction, Occlusal flips with the arch (`viewer/viewer.test.ts`); EN/ES same keys and tokens
  (`ui/i18n/i18n.test.ts`); impersonal Spanish around `{name}` (`test/ux/copy.ux.test.ts`); toolbar contrast
  (`test/ux/contrast.ux.test.ts`). So: new `ControlCallbacks` members are optional (`onX?()`), `pickSurface(x, y,
  jawOnly)` keeps its signature, and `ControlMode` only grows.

---

## 0. Why it looks cheap (what Diego saw)

Screenshots of the sample case in step 4, light and dark, 2026-11-07:

1. The in-browser sample jaw is a smooth pink tube: `ui/demo.ts` reuses the test fixture generator. It is not a mouth.
2. Z-fighting: each replacement scan body coincides with the scanned scan body inside the jaw scan and renders as
   green and pink "pinwheel" stripes.
3. Basic lighting and materials: matte clay, no specular, no depth; a radial gradient behind it.
4. The chrome is text buttons ("Fit Occlusal Front Back Left Right Top") and loose arrow glyphs on the pad, not a CAD
   view widget.

(1), (3) and (4) are the look (§3). (2) and the preset-key bug are fixed in the look panel's base commit (§3.4). The
behaviour gaps against exocad's conventions are slices A and B.

## 1. Sources

| Id | Source | Used for |
|---|---|---|
| HK | exocad wiki, "Hotkeys" (releases from 2025 on), https://wiki.exocad.com/wiki/index.php/Hotkeys | Mouse, keys, numpad views, Home, PageUp/PageDown, Ctrl+R/P/D, Alt, middle-click variants |
| OV | exocad wiki, "DentalCAD - overview", https://wiki.exocad.com/wiki/index.php/DentalCAD_-_overview | Navigation, touch gestures, view arrows and cube, Show all / Alt |
| WV | exocad wiki, "Viewing a scene in exocad webview", https://wiki.exocad.com/wiki/index.php/Viewing_a_scene_in_exocad_webview | Group selector top-left, standard-view arrows lower right, Default view |
| SV | exocad wiki, "Sectional view", https://wiki.exocad.com/wiki/index.php/Sectional_view | Cut plane slider, Invert, Rotate, several planes |
| CV | exocad wiki, "Using the Cut View feature", https://wiki.exocad.com/wiki/index.php/Using_the_Cut_View_feature | 2D cut window (not adopted) |
| MT | exocad wiki, "Measurement Tool", https://wiki.exocad.com/wiki/index.php/Measurement_Tool | Distance by start/end clicks, drag to redo, 0.01 mm |
| AL | exocad wiki, "Adjust Light", https://wiki.exocad.com/wiki/index.php/Adjust_Light | Light from the view direction, moves with the camera; flat shading, wireframe |
| UI | exocad wiki, "User interface", https://wiki.exocad.com/wiki/index.php/User_interface | Light/Dark theme, background preset colours |
| AS | App Store listing "exocad webview" 1.6.22 (2026-09-02), https://apps.apple.com/us/app/exocad-webview/id1206866034 | Touch & Hold rotation point, orthographic/perspective, flat/smooth, transparency |
| F1 | Fernando's screen recordings of 2026-11-05 showing exocad webview 1.6.2 (client folder, contact sheets `work/sheets/v01_01.jpg`, `v01_02.jpg`; frames at 22 s and 40 s of v01) | The visual facts of §3.2. Colours were sampled from a compressed recording: approximate, for direction only |
| F2 | Fernando's narration in the same recordings (v01, v02) | Rotation must be easy; FOV 1 "like exocad"; transparency and colour toggles; Ctrl + drag to rotate; he liked guided points 1-2-3-4 |
| B | Viewer bench, 2026-11-07: the real Viewer, parser and BVH on a synthetic 3 M-triangle jaw | §5.0 |
| Z | Z-fight probe, 2026-11-07 | §3.4 |
| K | Preset-key probe, 2026-11-07 | §3.4 |

Wiki pages and the store listing were read as documentation (2026-11-07/08). The recordings and contact sheets show
names in exocad and in file dialogs: none is written anywhere. B, Z and K are scripts outside the repo, in the session
scratchpad `C:\Users\Diestorn\AppData\Local\Temp\claude\C--Users-Diestorn-Desktop\84cb56f0-6a4f-4b0e-b909-161c4bd844eb\scratchpad\viewer-polish\`
(`bench.ts` + `run-bench.mjs` + `serve.mjs` + `gen-jaw.mjs` + `jaw-3m.stl`, `zfight.ts` + `run-zfight.mjs`,
`probe-keys2.mjs`, `shots.mjs`). They import playwright-core read-only from
`expertsddt-sitefix/tools/qa/node_modules/playwright-core/index.mjs` and drive system Chrome with
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`; every timing is reported with its WebGL renderer string.

## 2. Gap table

"Now" is b03dd97. Rows marked "(not exocad)" are rendering or motion gaps with no exocad source.

| # | exocad convention | Source | Now | Decision | Status |
|---|---|---|---|---|---|
| G1 | Right-drag rotates about the rotation center (the center of the scene objects by default) | OV, HK | Right-drag, or left-drag on empty space, turns a free trackball about the orbit target | Keep | Exists |
| G2 | Webview: click and drag rotates the view | WV | Left-drag on empty space or on the jaw turns the view | Keep | Exists |
| G3 | Both buttons drag = move the view | OV, HK | Left + right drag pans; so do middle-drag and Shift + drag | Keep | Exists; both buttons Fixed (review): it never fired (§5.11) |
| G4 | Cursor keys move (translate) the view | HK, OV | Arrows turn 10°; Shift + arrows pan | Arrows pan; Shift + arrows turn | Done (slice A): A4 |
| G5 | PageUp / PageDown rotate horizontally about the pivot | HK | Not handled: the page scrolls | Turn 10° about the screen's vertical axis | Done (slice A): A4 |
| G6 | Wheel zooms, centered on the mouse position | OV, HK | Same, 12 % per notch | Keep | Exists |
| G7 | Middle click centers the view and sets the rotation point | OV, HK | Same, but the pick is a linear raycast: 243–401 ms on a 3 M-triangle jaw | Keep; GPU pick | Done (slice B): B1 |
| G8 | Home sets the rotation pivot at the cursor | HK | Home = Fit | Rotation center at the pointer, or at the crosshair from the keyboard | Done (slice A): A6 |
| G9 | Numpad views: 1 Front, 2 Bottom, 3 Back, 4 Left, 5 Fit, 6 Right, 8 Top | HK | 0/Home Fit, 1 Occlusal, 2 Front, 3 Back, 4 Left, 5 Right, 6 Top; no Bottom; with motion on the keys never move the camera (bug) | exocad's map on the keypad and the number row; 0 = Default view (occlusal) | Done (slice A): A2; bug Handled (look base) |
| G10 | Six view arrows plus a cube that fits (DentalCAD); arrows lower right plus "Default view" (webview) | OV, WV, F1 | Seven text buttons in a top toolbar | View buttons: Default view, Fit, six directions | Done (look A): views dial; Done (slice A): A7 (keys) |
| G11 | View arrows follow the scene axes, not anatomy | OV | Presets assume +Z occlusal on the lower arch, −Y anterior (UI-DESIGN P8, open) | Keep; P8 stays open | Exists |
| G12 | Touch (DentalCAD on Windows): 3 fingers rotate, 2 move or pinch, 1 selects | OV | 1 finger turns, 2 pinch and pan, a tap selects or places, a double tap fits | Keep ours: iPadOS owns three-finger swipes and pinches (undo, redo, copy, paste) | Won't |
| G13 | Webview app: Touch & Hold sets the rotation point | AS | Nothing | Long-press 500 ms | Done (slice A): A8 |
| G14 | Shift + middle click toggles the transparency of the object under the pointer | HK | Ctrl or Shift + middle click toggles the jaw, whatever is under the pointer | Per object (jaw scan, replacements) | Done (slice A): A9 |
| G15 | Ctrl + middle click hides the object under the pointer; Ctrl + Shift + middle click shows it again | HK | Nothing | Same | Done (slice A): A9 |
| G16 | Hold Alt to show all objects for a moment; "Show all" button | HK, OV | Nothing | S shows what was hidden (Alt reaches the browser menu on Windows) | Done (slice A): A9 |
| G17 | No inertia documented | OV, HK | No inertia | Keep none | Exists |
| G18 | Ctrl+P Sectional View: a slider moves a cut plane in; Invert; Rotate keeps it at its depth while you turn; several planes, one colour each | HK, SV | Nothing | One plane: P (Ctrl+P prints), Position slider, Show the other side, Follow the view (SHOULD) | Done (slice B): B2 |
| G19 | Cut View: a 2D section window with its own measuring, set by clicks, follows the cursor, auto-rotation | CV | Nothing | Not adopted | Won't |
| G20 | Ctrl+R Measurement tool: distance from a start and an end click, drag a point to redo it, 0.01 mm | HK, MT | Nothing | R (Ctrl+R reloads), two clicks, Enter at the crosshair, drag (SHOULD), two decimals | Done (slice B): B3 |
| G21 | Angle, thickness, nearest, orthogonal, plane distance, object size | MT | Nothing | Not adopted | Won't |
| G22 | Ctrl+D Show distances | HK | C toggles the color map (distance to the jaw scan) | D toggles it too (Ctrl+D bookmarks) | Done (slice B): B4 |
| G23 | F11 full screen | HK | Full screen button (the stage only) | Keep the button; F11 stays the browser's | Exists |
| G24 | Ctrl+Z / Ctrl+Y undo and redo | HK | Ctrl/⌘ + Z undoes implant-set moves (20 steps) | Keep; no redo stack | Exists; redo Won't |
| G25 | Custom views (Ctrl+F1/F2), screenshot (Ctrl+Shift+Q), kiosk and remote-view modes | HK | Nothing | Not adopted (browser keys, out of scope) | Won't |
| G26 | Light from the view direction that moves with the camera; ambient, diffuse, specular, shine; flat shading; wireframe | AL | Headlight parented to the camera plus a hemisphere light | The headlight stays; values and any flat/wireframe toggle are the look's | Done (look A) |
| G27 | Background preset colours; Light / Dark UI theme | UI | Radial gradient per site theme (`--xch-stage`) | Background tokens per site theme | Done (look A) |
| G28 | Scans shown in their scanner colours (Color/Texture) | F1, WV | PLY colours shown when present ("Jaw color (PLY)" switch) | Keep; the sample jaw must carry colours (L1) | Done (look A) |
| G29 | Library parts warm beige-gold with a soft specular; scanned scan bodies grey | F1 | Parts site blue `#046bd2`, roughness .35; captured bodies slate at 35 % | Jaw, part and capture materials | Done (look A) |
| G30 | Orthographic or perspective; flat or smooth shading; transparency per object | AS, WV | Field of view 1–60°, default 1°; jaw and geometry opacity sliders | Keep 1° (Fernando works at FOV 1) | Exists |
| G31 | Group selector top-left: show/hide per object, mesh view, transparency slider | WV, OV | Display popover under the Display button | Where it sits is the look's; the behaviour exists | Done (look A): Display in the icon bar |
| G32 | (Fernando, not exocad) rotate the implant set with Ctrl + drag | F2 | Only when the drag starts on an implant | Anywhere on the canvas in step 4 | Done (slice A): A5 |
| G33 | (not exocad) coincident surfaces | Z | Pinwheel stripes where a replacement coincides with a scanned scan body | 20 µm depth bias toward the camera on replacements and captured bodies | Handled (look base) |
| G34 | (not exocad) view changes | — | .7 s `power3.inOut` | .7 s `expo.out` (= `--ease-out`) | Done (look A): A3 |

## 3. Look

### 3.1 How the look is chosen

The look (stage background, jaw/part/capture materials, lights, and how the chrome is drawn: icon bar, view buttons,
model list, pad) was chosen by Diego on 2026-11-08 from a three-way look panel (three variants on one base commit,
scored by three judges): **look A "Fiel a exocad"** (`look-exocad` 1b15b65), merged into `ddt-xchange` with grafts
from the other two and the judges' fixes (§3.5). Slices A and B reuse its tokens, components and icon style for
anything they add (Section and Distance buttons in the icon bar, the section popover, the distance overlay) and never
restyle what the look decided.

The base commit shared by the three variants fixes the z-fight and the preset-key bug (§3.4), and is set to replace
the tube with a realistic in-browser sample (an edentulous upper arch with palate and scanner colours,
`src/xchange/sample/`, in progress in this worktree while this spec was written). Whatever ships, L1 below is
required.

### 3.2 exocad visual facts

| Fact | Source |
|---|---|
| Flat background in a deep indigo-violet (≈ `#473b6b` sampled), no gradient, no grid, no floor, no cast shadows | F1 |
| The background colour is a user preset in DentalCAD (Settings, "+" adds preset colours); the UI theme is Light or Dark | UI |
| Jaw scans keep their scanner colours (red-pink gingiva, darker reds in the crevices); webview toggles Color/Texture | F1, WV |
| Scanned scan bodies read grey: their scanned colour | F1 |
| Library parts (healing caps in the recording) are warm beige-gold (≈ `#d8ad77` sampled), smoothly shaded, with a soft specular highlight | F1 |
| Scenes are lit from the front (the view direction) by default and the light moves with the camera unless detached; ambient, diffuse, specular and shine are adjustable; flat shading and wireframe are toggles | AL |
| Orthographic or perspective projection; flat or smooth shading; per-mesh transparency | AS |
| Webview: group selector (show/hide, mesh view, transparency slider) top-left; standard-view arrows lower right with "Default view"; Settings for language, texture, shading | WV |
| Webview 1.6.2 adds a dark vertical icon bar on the right edge | F1 |
| DentalCAD: six view arrows plus a cube that frames the scene; the arrows are not anatomical | OV |
| Fernando inspects at FOV 1 | F1, F2 |

### 3.3 Acceptance checks every look must pass

| # | Check | How |
|---|---|---|
| L1 | The sample jaw reads as a mouth (gingiva, ridge, scanned scan bodies) in its own vertex colours; it is generated in the browser with no request | Screenshots at Default view and Front, light and dark; network log of the sample flow has page assets only; the "Jaw color (PLY)" switch is shown and on |
| L2 | No z-fighting where a replacement coincides with a scanned scan body | Z probe: cap and wall 100 % replacement pixels at 1° FOV; sample screenshot at Fit and at 4× zoom without stripes |
| L3 | Jaw, replacements and captured bodies are told apart in both themes; the selected implant and the current guided target stay distinct from the part colour (with gold parts an amber emissive alone disappears: use an outline, a rim or a clearly different hue) | Screenshots; ΔE (OKLab) ≥ .10 between highlighted and plain part pixels |
| L4 | With the color map on, parts show the LUT colours faithfully (no tinted lights; specular never hides the 0/50/100 µm stops); the legend and readout stay authoritative | Sample at step 4 with the map on, both themes |
| L5 | The light comes from the view direction: whatever faces the camera is lit, at any orientation | Turn 180° on each axis: no dark front |
| L6 | Background, materials and chrome come from tokens in `ui/xchange.css` for light and dark (`html[data-theme]`); the canvas stays transparent | `contrast.ux.test.ts` passes with no lowered threshold (selectors follow any renamed class); chrome text ≥ 4.5:1, icons and the focus ring ≥ 3:1 over the glass and the background |
| L7 | Site identity and clean room: Poppins, site tokens and radii, motion through `ui/motion.ts`, own inline SVG icons; no exocad logo, icon, artwork, UI text or exact layout | Review; `grep` the diff for copied strings |
| L8 | Performance: the look adds ≤ 1 ms to the 3 M-triangle orbit p95 (GPU-synced); no post-processing (no extra pass, render target or full-screen quad), shadow maps, transmission or refraction; an environment map only if procedural (three's `RoomEnvironment` + PMREM, inside `three/addons`) and inside this budget. Stencil draws inside the one scene render are allowed (look A's highlight ring: the highlighted part redrawn into the stencil and as 16 shifted copies, nothing else) | Bench §5.0, renderer string reported |
| L9 | A theme switch mid-case restyles stage, materials, labels and chips at once (one MutationObserver), no reload | Toggle the site theme in step 4 |
| L10 | Dispose: `renderer.info.memory` geometries and textures at 0 after dispose, environment maps and PMREM targets included | UI-DESIGN §3.4 round trips |
| L11 | Privacy and CSP: nothing fetched (no texture, HDR or font), no new worker, no inline script | Network log; CSP check of UI-DESIGN §14.3 item 8 |
| L12 | Labels, pins, readout and legend stay readable over the new background in both themes (text ≥ 4.5:1) | Screenshots, contrast of the glass pills |
| L13 | No stage overlay overlaps another (toolbar or icon bar, view buttons, pad, legend, readout, Ctrl chip, popovers) | `getBoundingClientRect` probe at 1280×800, 960×700 and 768×1024 with touch emulation, EN and ES, pad shown and hidden |
| L14 | Reduced motion: nothing moves except essential state; `no-preference` shows the motion of UI-DESIGN §3.2 | Playwright `reducedMotion` both ways (the developer PC forces reduce) |

### 3.4 Handled by the look panel's base commit

| Item | Cause (measured 2026-11-07) | Fix shape | Status |
|---|---|---|---|
| Z-fight (G33) | A replacement coincides with the scanned scan body of the jaw (different tessellation). Z probe, 24-bit depth, MSAA 4, near/far 641.9/750.3: no offset → 0 % replacement pixels on cap and wall; `polygonOffset(-1, -1)` → 15 %; units −2000 (≈ 13 µm) → 100 %; 20 µm (≈ 3096 units here) → 100 % | Replacements and captured bodies drawn 20 µm nearer the camera: `polygonOffset` factor −1, units converted from 20 µm to 24-bit depth units for each mesh's distance and the frame's near/far, so the bias stays 20 µm at every zoom | Handled (look base) |
| Preset keys (G9) | With motion on, 1–6, 0 and Home never move the camera: the stage keydown runs `cb.onPreset()` (starts the .7 s tween) and then `touchInput()`, whose `viewer.stopCameraTween()` kills it. Reduced motion hid it (instant). Toolbar buttons work. K probe: `key2MovesCamera` false with `no-preference`, true with `reduce` | Only keys that move the camera themselves (arrows, zoom) stop a running tween; view keys and toggles no longer do | Handled (look base) |

Both are re-checked by the slices: A1 and A2 (keys, both motion settings) and B5 (z-fight with the cut on).

### 3.5 Look A as merged (2026-11-08)

Look A ("Fiel a exocad", `look-exocad` 1b15b65) fast-forwarded `ddt-xchange`, then took the grafts and the judges'
fixes below. Look B ("Estudio premium", `look-studio` 84dbe61) and look C ("Precisión clínica", `look-clinical`
0c52af1) stay on their branches; nothing else of theirs is merged. The panel's scores, judges' notes and screenshots
are in the session scratchpad (`viewer-polish/looks/`: `LOOKS.md`, `panel-result.json`, one folder per variant).

**Tokens** (`ui/xchange.css`; the 3D colors are read by `viewer.ts` and follow `html[data-theme]` live):

| Token | Light theme | Dark theme | Use |
|---|---|---|---|
| `--xch-stage` | radial `#433d7f` → `#39336f` → `#2f2a60` | radial `#37316c` → `#2d2860` → `#231f4e` | The stage: a deep indigo-violet between a dental CAD's backdrop and the site navy, dark in both themes |
| `--xch-on-stage`, `--xch-on-stage-quiet` | `#f1f0fb`, `#c4c1e6` | same | Text drawn on the stage itself (empty state) |
| `--xch-glass`, `--xch-glass-line` | `rgba(255,255,255,.92)`, `rgba(29,50,115,.12)` | `rgba(11,22,48,.9)`, `rgba(143,193,255,.18)` | Icon bar, views dial, pad, legend, scale bar, labels: the site's light or dark glass |
| `--xch-float` | `0 12px 32px -16px rgba(14,10,52,.75)` | `0 12px 32px -14px rgba(0,0,0,.7)` | Shadow of the floating chrome |
| `--xch-jaw` | `#d9d1c4` | same | Stone: a scan without colors (PLY colors are shown as scanned) |
| `--xch-part` | `#d8ad77` | same | Library parts, warm beige-gold |
| `--xch-capture` | `#b8b5b0` | same | Scanned scan bodies and positions without geometry, grey |
| `--xch-active` | `#f59e0b` | `#fbbf24` | Highlight ring, guided pins, active labels |
| `--xch-cut` | `#3d9ad4` | same (inherited) | B2's cut faces: 3.06:1 (light) and 3.72:1 (dark) against every stage stop, OKLab L .207 under `--xch-jaw`; `contrast.ux.test.ts` checks both |
| `--xch-map-0`, `-50`, `-100` | `#86efac`, `#fbbf24`, `#dc2626` | same | Color map stops (OKLab LUT, unchanged) |

`LOOK` in `viewer/viewer.ts`: a head light (2.25) parented to the camera just above-left of the eye, a hemisphere fill
(1.25, `#fff6ee` over `#a29cc8`) whose sky is the screen's up, Neutral tone mapping, Blinn-Phong surfaces (specular /
shininess: jaw .035/24, parts .1/42, color map .02/30, grey bodies .08/36), the 2.5 px highlight ring (.4 where the scan
hides the part), and `frame` .8 (the share of the stage the default view fills). DPR capped at 2, 1.5 on touch.

**Grafted**, by hand from the other branches:

- From C: the 3D view's `IntersectionObserver` reads the last entry of a batch (it read the first, which left the view
  blank once after a scroll), with its test; the legend's ticks at their exact values, "µm" in the title and "100+"
  last; the 1-2-5 mm scale bar at the bottom center (exact at the orbit target's depth, which the 1° view makes the
  whole scene; it follows the zoom); Color map (C) and Jaw transparency (T) buttons in the icon bar, through the same
  `Stage.toggleMap()` / `toggleJawOpacity()` as the keys; the pad's click/Shift hint hidden on touch screens; "1 mm" and
  "0.1 mm" kept together with no-break spaces.
- From B: `EASE_OUT = 'expo.out'` exported once from `ui/motion.ts` and used by every camera tween and the alignment
  pose tween (A3 done; the distance also interpolates geometrically).

**Judges' must-fix items, done:**

- The legend follows the map whatever turns it off: the Display switch went through `Stage.setDisplay()`, which never
  hid it; `Stage.syncControls()` now owns it.
- Labels never cover their part: each sits 6 px past the part's screen box, beyond its free end when the axis shows on
  screen (below the parts in the front view), else outward from the set (occlusal view) (`labelSpot`, tested).
- "Try a sample case" at 1440 × 900 brings the whole stage into view: at ≥ 960 px it scrolls to the stage, not to the
  workspace top, so the views dial ends at 866 px instead of 949 px.
- Views dial: Fit in the hub and the six directions at the ends of three view axes (vertical, horizontal and the depth
  diagonal) instead of a ring that looked lopsided; 32 px discs on a 50 px radius, at least 6 px apart (44 px discs on
  66 px on touch); the discs carry a tint and a hairline so they read on the light glass.
- Adjust pad icons: solid strokes at the icon bar's size and weight (20 px, 1.8 on the 24 grid). The far half of a
  turn is drawn faint instead of dashed (the dashes blurred into dots at 1x), and moves are arrows leaving a bar
  (↥ ↧ ↤ ↦), which no longer read as "<-0" and "0->".
- Highlight ring: where the scan hides the part (the buried side of a guided target) the ring is drawn at 40 %, so
  the silhouette stays complete and nothing looks offset over the gum.
- Default view and Fit frame the visible bounding box, every corner checked in camera space, at 80 % of the stage on
  its limiting side (the bounding sphere left the arch at about half the stage). "Show in the view" keeps the sphere.
- Clean room: the Occlusal pill's tooltip says "Initial view (occlusal)" / "Vista inicial (oclusal)", not the label
  exocad shows in that place; its visible text and accessible name stay "Occlusal" / "Oclusal".

**Not done here:** the exocad view keys (A2), done in slice A: tooltips and `aria-keyshortcuts` now read `VIEW_KEYS`
("Front · 1", "Fit · 5", "Initial view (occlusal) · 0").

**Checks** (2026-11-08): `typecheck:xchange` clean; `test:xchange` all green (new: `test/ux/viewer-look.ux.test.ts`, the
ring's two sides, the `--xch-cut` contrast); build and `npm test` green. Bench §5.0 on the 3 M-triangle jaw (ANGLE
D3D11, GTX 1080 Ti, 1280 × 800, headless): orbit GPU-synced p50 / p95 / max 1.5 / 2.3 / 3.0 ms (look A as committed:
1.5 / 2.3 / 2.7), with the highlight ring 1.6 / 2.5 / 3.9 (A: 1.5 / 2.5 / 2.9), rAF 144 fps. L13 overlap probe clean at
1280 × 800, 960 × 700, 768 × 1024 and 1024 × 768 touch, EN and ES, pad shown and hidden. On a tablet the 80 % framing
lets the touch-sized views dial cover the arch's outer flange and can cover the label of the implant beside it; the
implant list in the panel carries the same names.

---

## 4. Slice A · navigation, camera, view buttons, transitions, shortcuts, touch

Budget: MUSTs ≈ 48 min, SHOULDs ≈ 22 min. Starts after the look merge. Files: `viewer/presets.ts`,
`viewer/controls.ts`, `viewer/viewer.ts`, `ui/stage.ts`, `ui/motion.ts`, `ui/i18n/{en,es}.ts`, `ui/xchange.css` (only
what the look lacks), `src/pages/ddt-xchange.astro` (§6), UI-DESIGN §3.2/§6.2–6.8/§12.3, tests. Items A1–A11 are
§4.1–§4.11.

| Id | Item | Level | Status | Min |
|---|---|---|---|---|
| A1 | Preset keys move the camera with motion on | MUST | Handled (look base); re-checked in slice A | 0 (re-check) |
| A2 | exocad view keys, Bottom view, Default view on 0 | MUST | Done (slice A); AZERTY 6 and 8 Fixed (review) | 10 |
| A3 | Camera transitions with the site easing | MUST | Done (look A); re-checked in slice A | 0 |
| A4 | Arrows pan; Shift + arrows and PageUp/PageDown turn | MUST | Done (slice A) | 8 |
| A5 | Ctrl/⌘ + drag anywhere rotates the implant set | MUST | Done (slice A) | 4 |
| A6 | Home sets the rotation center | MUST | Done (slice A); during a view tween Fixed (review) | 6 |
| A7 | View buttons (behaviour of the look's widget) and tooltips | MUST | Done (look A); keys Done (slice A) | 3 |
| A8 | Touch & hold sets the rotation center | SHOULD | Done (slice A) | 8 |
| A9 | Per-object middle clicks and S | SHOULD | Done (slice A) | 10 |
| A10 | Pressed state follows the camera; keyboard views announced | SHOULD | Done (slice A); Fixed (review) with A6 | 4 |
| A11 | Not in this slice | WON'T | Won't | — |

### A1 · Preset keys move the camera with motion on (MUST, Handled (look base))

- **Behaviour.** A view key starts its tween and nothing in the same keydown stops it (§3.4). The rule holds for every
  key slice A adds: keys that start a camera tween (views, Default view, Fit, Home) never stop it; keys that move the
  camera themselves (arrows, Shift + arrows, PageUp/PageDown, zoom) stop a running tween first.
- **Input.** The view keys of A2. **Copy.** None. **Accessibility.** The keyboard path to the views works again.
- **Reduced motion.** Already worked (instant). **< 960 px.** Same.
- **Acceptance.** K probe (`probe-keys2.mjs`) after A2: `key2MovesCamera` true with `no-preference` and `reduce`. A
  Vitest regression test exists after the slice (the base commit's, or one added here): with a controls stand-in, a
  view key calls `onPreset` and `stopCameraTween` is not called after it.

### A2 · exocad view keys, Bottom view, Default view on 0 (MUST)

- **Behaviour.**
  - `viewer/presets.ts`: `Preset` gains `'bottom'` = camera from −Z, up −Y (the occlusal view of an upper arch,
    anterior at the top). The table stays the single place to change if P8 shows other axes.
  - `PRESET_KEYS` is replaced by one pure function `viewForKey(code: string, key: string): Preset | 'fit' | null`.
  - The **Default view** is `'occlusal'` (occlusal for the case's arch, framed): the view every import ends on
    (UI-DESIGN §6.3, unchanged), and exocad webview's "Default view" [WV].
  - Number row by `code` whatever `key` is (an AZERTY number row types `&é"'…` and still works). Keypad only with
    NumLock on (`key` is the digit); with NumLock off the keypad sends Home, End, arrows and PageUp/PageDown and acts as
    those keys (A4, A6).
  - Symbols win: when `key` is `+`, `-`, `=`, `_` or `?`, `viewForKey` returns null and the key keeps its meaning
    (Swiss and Czech layouts type `+` on the 1 key).
  - Same scope as today: only while the stage itself has focus and no Ctrl, ⌘ or Alt is held (Shift allowed).
- **Input.**

  | Key (`Digit` or `Numpad`) | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 0 | 7, 9 |
  |---|---|---|---|---|---|---|---|---|---|
  | View | Front | Bottom | Back | Left | Fit | Right | Top | Default view | nothing |

  Today's 1 Occlusal and 5 Right move to 0 and 6; Home moves to A6.
- **Copy.** New `view.bottom`, `view.default`; keys rows 4–6 (§4.12). `view.occlusal` is deleted in both languages
  when nothing uses it any more.
- **Accessibility.** Each view button has `aria-keyshortcuts` with its digit; the dialog and the help table list the
  map.
- **Reduced motion.** The camera jumps (A3).
- **< 960 px.** Same keys.
- **Acceptance.** Vitest: `viewForKey` table (Digit and Numpad codes; `Numpad2` with `key: 'ArrowDown'` → null;
  `Digit1` with `key: '&'` → front; `Digit1` with `key: '+'` → null; 7 and 9 → null); `presetView('bottom')` has up ⟂
  direction. Browser probe, motion
  on and reduced: every key 0–6 and 8 moves the camera to its view, on the number row and on the keypad.

### A3 · Camera transitions with the site easing (MUST, Done (look A))

- **Behaviour.**
  - Every camera tween (a view, Fit, Default view, "Show AXO2 in the view", rotation center) eases with `expo.out`,
    GSAP's twin of `--ease-out` (no CustomEase), through `transient()` in the viewer's `gsap.context`.
  - `ui/motion.ts` exports the ease once (`EASE_OUT = 'expo.out'`). The camera tween and the existing alignment pose
    tween use it.
  - Durations unchanged: .7 s for views and Fit, .35 s for the rotation center.
  - Interpolation: orientation slerps and the target lerps. SHOULD: the distance interpolates geometrically
    (`d0 · (d1 / d0)^t`), so a large zoom change does not rush its near end.
  - Interrupt, never queue: camera input (drag, wheel, pinch, keys other than view keys) stops the tween where it is,
    and a new view starts from the in-between pose.
  - Implant-set pose tweens are unchanged: .9 s `expo.out` after alignment, .35 s `power3.out` for pad steps.
- **Input.** Every camera action: view keys and buttons, Fit, double-click and double tap, the per-implant table's
  "Show AXO2 in the view", middle click, Home, touch & hold.
- **Copy.** None.
- **Accessibility.** Motion never carries information: the end state is the same with reduced motion, and A10
  reports the view reached.
- **Reduced motion.** Instant, no intermediate frame (unchanged).
- **< 960 px.** Same.
- **Acceptance.** Vitest with the fake DOM of `test/adversarial/fake-dom.ts` (as viewer-export does): `view('front')`
  with motion on makes one tween with ease `expo.out` and duration .7; `setOrbitCenter` .35; with `reducedMotion` none.
  UI-DESIGN §3.2 row "Camera preset, Fit, focus on an implant" reads `.7 s expo.out`.

### A4 · Arrows pan; Shift + arrows and PageUp/PageDown turn (MUST)

- **Behaviour.** Stage focused:
  - ← → ↑ ↓ pan 5 % of the stage height per press. In exocad the arrow keys translate the camera [HK].
  - Shift + arrows turn 10° about the screen axes, in the directions today's arrows use.
  - PageUp and PageDown turn 10° about the screen's vertical axis, exocad's horizontal rotation about the pivot [HK].
    PageUp turns like Shift + ←.
  - + and − (also = and _) zoom 15 % at the center, unchanged.
  - Held keys repeat at the OS rate, one step per repeat.
  - Every handled key calls `preventDefault()`, so PageUp/PageDown stop scrolling the page while the stage has focus.
  - These keys move the camera only, never the implant set.
- **Input.** ← → ↑ ↓ · Shift + arrows · PageUp / PageDown (also keypad 9 and 3 with NumLock off) · + − = _.
- **Copy.** `view.help`, `gp.keyboard`, `gp.miss`, keys rows 1–2 (§4.12).
- **Accessibility.** Keys stay scoped to the focused stage (WCAG 2.1.4); the stage description and the guided-points
  text say the new mapping.
- **Reduced motion.** Steps are instant (already).
- **< 960 px.** Same.
- **Acceptance.** Vitest stand-in (pattern of `controls-touch.ux.test.ts`): ArrowLeft moves `target` and leaves `q`;
  Shift + ArrowLeft changes `q` and leaves `target`; PageUp changes `q`; PageDown is `defaultPrevented`. Browser:
  keyboard-only guided points on the sample still place four points (UI-DESIGN §14.3 item 2).

### A5 · Ctrl/⌘ + drag anywhere rotates the implant set (MUST)

- **Behaviour.**
  - In `set` mode (step 4 with a jaw, not guided, not measuring), Ctrl or ⌘ + left-drag starting anywhere on the
    canvas rotates the implant set. It is today's Ctrl-drag on an implant: arcball about the set's bounding-box
    center, 0.3°/px × speed/3, + Shift = dominant axis only.
  - A plain left-drag on an implant still moves the set; anywhere else it still turns the view.
  - Store commit, undo and re-measure use the existing `onSetChange` start/move/end path.
  - In other modes Ctrl-drag turns the view (unchanged).
  - Why: Fernando rotates with Ctrl + drag [F2]; starting on a 4 mm scan body is fiddly, and the Ctrl chip already
    promises "Drag to rotate".
- **Input.** Ctrl/⌘ + left-drag (+ Shift).
- **Copy.** keys row 14.
- **Accessibility.** The adjust pad stays the single-pointer and keyboard alternative (WCAG 2.5.7).
- **Reduced motion.** The drag follows the pointer, nothing animates.
- **< 960 px.** Mouse only; touch never drags the set (unchanged).
- **Acceptance.** Vitest stand-in in `set` mode with `pickPart` → null: Ctrl + drag → `onSetChange` start, move, end
  with a rotated pose; the same drag without Ctrl → no `onSetChange` and `q` changed. The adversarial set-drag test
  stays green.

### A6 · Home sets the rotation center (MUST)

- **Behaviour.**
  - Home with the stage focused picks at the pointer if it is over the canvas (last position inside, no
    `pointerleave` since), otherwise at the stage center, where the guided crosshair is.
  - A hit calls `setOrbitCenter(point)` (.35 s, A3): the view centers there and turns about it, like a middle click.
  - A hit from the keyboard announces `say.pivot`; a miss announces `say.pivotMiss`. Mouse paths stay silent.
  - Home no longer fits: Fit is 5, double-click and the Fit button.
  - The pick is `pickSurface` (any visible surface; GPU from B1).
- **Input.** Home (also keypad 7 with NumLock off).
- **Copy.** `say.pivot`, `say.pivotMiss`, keys row 7.
- **Accessibility.** This is the keyboard path the "Rotation center" row lacked ("—" today).
- **Reduced motion.** Instant recentering.
- **< 960 px.** Same; touch has A8.
- **Acceptance.** Vitest stand-in: Home with no pointer → `pickSurface` at the canvas center → `setOrbitCenter` with
  its point; after a `pointermove` inside → at the pointer; a miss → the optional `onPivotMiss`.

### A7 · View buttons and tooltips (MUST, Done (look A); keys Done (slice A))

Status: the look draws and wires all of it: the dial and the Occlusal pill call `Stage.preset()`, one `role="toolbar"` Tab
stop with `roving()`, names, `aria-keyshortcuts`, `view.tip` tooltips (400 ms hover, at once on focus, Esc, never over
their button), 32 px discs 6 px apart (44 px on touch), L13 probe clean at 1280×800, 960×700, 768×1024 and 1024×768
touch, EN and ES. The digits came with A2 (slice A): tooltips and `aria-keyshortcuts` read `VIEW_KEYS` ("Front · 1",
"Fit · 5", "Initial view (occlusal) · 0") with no markup change; Enter or Space on a button announces `say.view` (A10).

- **Behaviour.** The look draws the widget, by default at the bottom-right of the stage as in exocad webview [WV];
  this item owns what it does. If the winning look has none, A7 adds it with the look's glass, radius and icon style.
  - Buttons: **Default view** (occlusal for the arch, framed), **Fit** (keeps the direction, frames everything
    visible), and **Top, Bottom, Front, Back, Left, Right**. Each calls `Stage.preset()` and the camera tween (A3),
    framing everything visible (UI-DESIGN §6.3 distance rule).
  - It is the only preset UI: the toolbar's text presets go, if the look kept them.
  - `role="toolbar"` named by `view.views`, one Tab stop with the existing `roving()` helper (arrows move, Home/End
    jump, Enter/Space activate). The stop sits after the toolbar (or icon bar) and before the pad in UI-DESIGN §11.1
    item 5.
  - Each button has an accessible name (the view name), `aria-keyshortcuts` (its digit), and a tooltip `view.tip`
    ("{name} · {key}"). The tooltip shows after 400 ms of hover and at once on keyboard focus. It hides on pointer
    leave, blur or Esc (WCAG 1.4.13), is `aria-hidden` (the name already carries the text) and never covers its
    button.
  - Icons: our own inline SVG in `currentColor`.
  - Targets: 32 px with a mouse, 44 px on `(pointer: coarse)`.
- **Input.** Click or tap; Enter/Space; digits (A2).
- **Copy.** `view.bottom`, `view.default`, `view.tip`; `view.views` is reused as the group name.
- **Accessibility.** Icons ≥ 3:1 against the widget background; the site focus ring (3 px, `#6fb6ff` in dark);
  `forced-colors` border `CanvasText` like `.xch__toolbar`.
- **Reduced motion.** The camera jumps; the tooltip appears without a fade.
- **< 960 px.** Stays visible; 44 px on touch; never overlaps the pad, legend, readout or popovers (L13). The look
  decides whether the pad moves up or the widget moves left.
- **Acceptance.** Keyboard: Tab reaches the group once, arrows move, Enter on Front frames the front. axe: 0
  violations, light and dark. L13 overlap probe with step 4 (pad shown).

### A8 · Touch & hold sets the rotation center (SHOULD)

- **Behaviour.**
  - One finger held within 8 px for 500 ms picks under the finger and calls `setOrbitCenter` (.35 s). This is the
    exocad webview app's Touch & Hold [AS].
  - Lifting that finger afterwards does nothing else (no tap, no selection, no guided point); moving it turns the view
    as usual.
  - Moving more than 8 px, or a second finger, before 500 ms cancels the hold (rotate or pinch, unchanged).
  - Feedback: a 32 px ring at the finger (`--xch-active` 2 px stroke with a 1 px `#1e293b` halo, the crosshair
    recipe). It appears at 150 ms, grows .6 → 1 until 500 ms (CSS transition on `var(--ease-out)`) and goes on lift.
  - `.xch__stage` gets `-webkit-touch-callout: none` (no iOS callout).
- **Input.** Touch only.
- **Copy.** `keys.touch`, keys row 7.
- **Accessibility.** Home (A6) and the middle click are the alternatives.
- **Reduced motion.** The ring appears at 500 ms without growing.
- **< 960 px.** This is the tablet case.
- **Acceptance.** Vitest stand-in with fake timers: touch down, 520 ms → `setOrbitCenter` once; lift → no `onSelect`
  or `onGuidedPoint`. The existing 30 ms tap tests stay green.

### A9 · Per-object middle clicks and S (SHOULD)

- **Behaviour.** A middle click (≤ 4 px, ≤ 300 ms) with modifiers acts on what is under the pointer:
  `viewer.pickObject(x, y)` returns `'jaw'`, `'part'`, `'capture'` or null.

  | Gesture | Jaw scan | Replacement | Captured scan body | Nothing |
  |---|---|---|---|---|
  | Shift + middle click | Jaw opacity 100 % ↔ last value, 30 % the first time (= T) | Geometry opacity 100 % ↔ 30 % | Nothing (always see-through) | Nothing |
  | Ctrl/⌘ + middle click | Hide the jaw scan (Display switch off) | Hide the replacements | Hide the captured scan bodies | Nothing |
  | Ctrl/⌘ + Shift + middle click, or S | Show again everything hidden this way | same | same | same |

  - Hidden objects are remembered as a set until shown again or a new case starts.
  - In slice A `pickObject` is three's raycast over the visible meshes. It is linear: about 0.4 s on a 3 M-triangle
    jaw, acceptable for a rare modified click. B1 makes it a GPU pick.
  - Today's "Ctrl or Shift + middle click = jaw transparency" changes: Shift keeps it on the jaw; Ctrl now hides.
  - Alt is not used: it reaches the browser menu on Windows, hence S [HK, OV].
- **Input.** Shift / Ctrl / Ctrl + Shift + middle click; S.
- **Copy.** `say.hidden`, `say.shown`, keys rows 8–10.
- **Accessibility.** The Display popover's switches and sliders are the keyboard path to hide; S shows; T toggles jaw
  transparency.
- **Reduced motion.** No animation involved.
- **< 960 px.** Mouse only; tablets use the Display popover.
- **Acceptance.** Vitest stand-in with a `pickObject` stub: each table cell calls its callback (the jaw cell still
  calls `onToggleJawOpacity`; new optional `onToggleOpacity?`, `onHide?`, `onShowAll?`); S → `onShowAll`.

### A10 · Pressed state follows the camera; keyboard views announced (SHOULD)

- **Behaviour.**
  - Manual camera input (drag, wheel, pinch, arrows, PageUp/PageDown, zoom keys) clears `aria-pressed` on the view
    buttons through an optional `onCameraInput?()`; a view key or button sets it again.
  - A view applied from the keyboard (a digit, or Enter/Space on a view button) announces `say.view` politely; mouse
    clicks do not.
- **Input.** Any camera input; digits; Enter/Space on a view button.
- **Copy.** `say.view` ("View: {name}." / "Vista: {name}."), `{name}` = the view's label.
- **Accessibility.** `aria-pressed` stops claiming a view the camera has left; keyboard and screen-reader users hear
  which view they reached.
- **Reduced motion.** Nothing animates. **< 960 px.** Same; touch input also clears the pressed state.
- **Acceptance.** Vitest stand-in: a drag calls `onCameraInput`; a digit does not.

### A11 · Not in this slice (WON'T)

- Three-finger rotate (G12).
- Inertia: exocad documents none, placement must be precise, and reduced motion would need a second path.
- A live axis triad or view cube: exocad has none, and with P8 open its anatomical labels could mislead.
- Roll by two-finger twist: not in exocad; the free trackball already rolls.
- Alt, F11, Ctrl+R/P/D, Ctrl+Shift+Q, Ctrl+F1/F2: browser keys (G16, G18, G20, G22, G23, G25). Slice B maps R, P and D
  without Ctrl.
- Ctrl/⌘ + Y redo: no redo stack.
- A true orthographic camera: 1° already reads orthographic, and one camera path is simpler.
- A pivot that keeps the view still (exocad's Home): ours recenters like the middle click, one camera model (target =
  pivot).

### 4.12 Slice A copy (EN / ES)

| Key | EN | ES |
|---|---|---|
| `view.help` (changed) | Drag or use Shift + the arrow keys to turn the view; the arrow keys or Shift + drag pan; the wheel or + and − zoom. Press ? for every shortcut. | Arrastra o usa Shift + flechas para girar la vista; las flechas o Shift + arrastrar la desplazan; la rueda o + y − acercan. Pulsa ? para ver todos los atajos. |
| `view.bottom` | Bottom | Inferior |
| `view.default` | Initial view (occlusal) | Vista inicial (oclusal) |
| `view.tip` | {name} · {key} | {name} · {key} |
| `gp.keyboard` (changed) | Keyboard: turn the view with Shift + arrows, pan with the arrow keys, zoom with + and −, then press Enter to place the point under the crosshair. | Con teclado: gira la vista con Shift + flechas, desplázala con las flechas, acerca con + y −, y pulsa Enter para colocar el punto bajo la mira. |
| `gp.miss` (changed) | Nothing under the crosshair. Pan (arrow keys) or turn (Shift + arrows) the view until it sits on the top of the scan body, then press Enter. | No hay nada bajo la mira. Desplaza (flechas) o gira (Shift + flechas) la vista hasta que quede sobre la parte superior del scan body y pulsa Enter. |
| `keys.touch` (changed) | On a tablet: one finger turns the view, two fingers zoom and pan, a double tap fits everything, touch and hold sets the rotation center; move the implant set with the adjust panel. | En una tablet: un dedo gira la vista, dos dedos acercan y desplazan, un doble toque encuadra todo y mantener presionado fija el centro de giro; mueve el conjunto con el panel de ajuste. |
| `say.pivot` | Rotation center set. | Centro de giro fijado. |
| `say.pivotMiss` | No surface there. The rotation center did not change. | No hay ninguna superficie ahí. El centro de giro no cambió. |
| `say.hidden` | {name} hidden. Press S to show everything again. | Se ocultó: {name}. Pulsa S para volver a mostrar todo. |
| `say.shown` | Everything you hid is visible again. | Lo que ocultaste vuelve a estar visible. |
| `say.view` | View: {name}. | Vista: {name}. |

The look shipped `view.default` as `view.defaultView` (the Occlusal pill's tooltip) with the wording above: exocad shows
"Default view" in that place, so the label is not reused (L7). The pill's visible text and name stay `view.occlusal`.

`{name}` in `say.hidden` is the Display switch label (`display.jaw`, `display.parts`, `display.capture`); the Spanish
form is impersonal so no participle has to agree with it (`copy.ux.test.ts`).

`keys.rows` after slice A (action · mouse · keyboard; "—" = none; slice B edits rows 11, 17 and 18 and adds two):

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

### 4.13 Slice A tests and acceptance

- **Tests to add** (Vitest, synthetic, no WebGL): `viewForKey` table and the Bottom preset (in `viewer/viewer.test.ts`
  or a new `viewer/presets.test.ts`); a new `test/ux/controls-keys.ux.test.ts` on the `attachControls` stand-in of
  `controls-touch.ux.test.ts` covering A1, A4, A5, A6, A8 (fake timers), A9 and A10; the camera tween ease and
  durations (A3) on the fake DOM.
- **Commands.** `npm run test:xchange` (354 at b03dd97 plus the look's and these; all green, a timing test that fails
  while the machine is busy is rerun alone before it counts), `npm run typecheck:xchange`,
  `MSYS_NO_PATHCONV=1 MSYS2_ENV_CONV_EXCL='*' npm run build`, `MSYS_NO_PATHCONV=1 MSYS2_ENV_CONV_EXCL='*' npm test`.
- **Browser** (built site on `npx astro preview --host 127.0.0.1 --port <free port>`, stopped afterwards; renderer
  string reported): the K probe extended to every view key on the number row and keypad, NumLock on and off;
  arrows, Shift + arrows and PageUp/PageDown; Home at the pointer and at the center; the view buttons by mouse and by
  keyboard; Ctrl-drag from empty space in step 4; touch & hold with CDP touch events; per-object middle clicks.
  Motion `no-preference` and `reduce`, light and dark, EN and ES, at 1280×800, 960×700 and 768×1024 (touch).
- **Still pass.** UI-DESIGN §14.3 items 2 (keyboard-only sample flow), 4 (Lenis), 5 (ten round trips), 10 (axe 0).

### 4.14 Slice A as built (2026-11-08)

On look A (98f2617). A2 and A4–A10 are `Done (slice A)`; A1 and A3 were re-checked (keys with motion on and reduced,
`EASE_OUT` .7 s / .35 s, a new view or any camera input interrupts a running tween). Where the build settles what the
items above left open:

- **Keys (A1, A2).** `VIEW_KEYS` and `viewForKey(code, key)` in `viewer/presets.ts` replace `PRESET_KEYS`; the page's
  tooltips and `aria-keyshortcuts` read the table. An event without a `code` (some virtual keyboards) goes by its digit.
  View keys and Home start their own tween and never stop it; camera keys stop a running one first. Held keys repeat
  only the camera steps: a view key, Home, T, C, S, ? and Enter act once (a held Home would pick on every repeat, a
  held Enter would stack guided points).
- **A4.** ← slides the scene to the right, as a drag to the right does (the direction Shift + arrows panned before);
  keypad 9 and 3 with NumLock off are PageUp and PageDown.
- **A5.** In step 4, Ctrl/⌘ at the press makes any left-drag the set rotation, Shift included (held before or during
  the drag: one axis). Before, Ctrl + Shift at the press panned, though the chip promised "Shift: one axis".
- **A6.** "Over the canvas" is the last mouse `pointermove` on the canvas, cleared by `pointerleave` and checked
  against the canvas box. Keypad 7 with NumLock off is Home. Hit and miss reach `onPivot?()` and `onPivotMiss?()`.
- **A8.** The ring is the stage's own `::after` (`--hold-x`/`--hold-y`, class `is-hold` from 150 ms, `is-held` once the
  center is set), not an element in `.xch__labels`, which the viewer clears on dispose. When the hold fires the drag
  restarts under the finger, so lifting is no tap (nor the first half of a double tap) and jitter under 4 px never stops
  the .35 s tween. Over nothing the ring goes at 500 ms.
- **A9.** `viewer.pickObject(x, y)` is a three raycast over the visible meshes at opacity ≥ 10 %; a replacement or
  captured body within `DEPTH_BIAS_MM` behind the first scan hit counts as on top, as it is drawn. `onToggleOpacity?(object)`
  is called for replacements only (the jaw keeps `onToggleJawOpacity`). `Stage` remembers the Display switches a
  Ctrl/⌘ + middle click turned off; S or Ctrl/⌘ + Shift + middle click turns exactly those back on; a new case shows them
  again silently; a viewer restart keeps them.
- **A10.** `onCameraInput?()` comes from rotate and pan drags, the wheel, pinches, arrows, PageUp/PageDown and the zoom
  keys; never from set drags, view keys, Home or toggles. `onPreset(view, keyboard)` and a keyboard click on a view
  button (`detail === 0`) announce `say.view`.
- **Found while checking.** "Try a sample case" clicked while the workspace was still starting ran `resetCase()` on an
  App whose steps did not exist yet (`app` is assigned before `init()` ends): the sample never loaded and the console
  showed a TypeError. `ui/main.ts` now waits for `start()` there and in New case.

**Checks** (2026-11-08): `typecheck:xchange` clean; `test:xchange` 446/446 (+43: `test/ux/controls-keys.ux.test.ts` 35,
`viewForKey` and Bottom 7 in `viewer/viewer.test.ts`, Home 1 in `test/ux/viewer-camera.ux.test.ts`, whose key test now walks
the new map on both rows; mutation checks on the hold, the drag restart and Ctrl anywhere fail the suite); build and
`npm test` green. Browser, headless system Chrome, renderer ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0,
D3D11), black box (label transforms, stage classes, `#xch-status`): 74/74 at 1280 × 800 EN light, motion
`no-preference` and `reduce` (every view key on the number row and on the keypad with NumLock on, AZERTY `&`, NumLock off,
7, 9 and End, arrows at 5 % of the stage height, Shift + ← = PageUp, PageUp/PageDown without page scroll, Home at the
pointer / at the center / over nothing, the dial by keyboard with its tooltip and announcement, mouse clicks silent,
per-object middle clicks and S, Ctrl + drag from the palate turning the set with the palate pixels unchanged, touch &
hold with CDP touch at 1024 × 768 including guided points); 7/7 in Spanish and dark at 960 × 700, at 768 × 1024 touch
with reduced motion, and ten ClientRouter round trips (one canvas, no WebGL warning, 0 console errors). Keyboard-only
guided points (arrows pan, + zoom, 5 Fit, Enter) place four points and align, Good, RMS 4 µm, motion on and reduced.
14 view transitions with motion on: rAF p50 / p95 / max 6.9 / 7.0 / 7.1–13.9 ms over three runs, no frame over 50 ms, no
`long-animation-frame` entry. `shoot.mjs` on the slice A build (`looks/slice-a`): 12 shots, 0 errors, no external
request, orbit p50 / p95 / max 6.9 / 7.0 / 7.1 ms; against `looks/integrated` s2 and s3 are pixel-identical, s4 shows the
new `gp.keyboard` text, s1 and s7 a sub-pixel framing shift from that run's alignment, s5 the step panel 4 px lower (its
entrance). Playwright's `keyboard.press('Numpad1')` sends NumLock-off keys (`End`), so keypad digits went through CDP. Not run: axe (no axe-core here, nothing installed); slice A adds no markup, only attribute values.

---

## 5. Slice B · section plane, distance, GPU picking, 3 M triangles

Budget: MUSTs ≈ 56 min, SHOULDs ≈ 15 min. Starts after slice A. Files: `viewer/viewer.ts`, a new `viewer/pick.ts` and
`viewer/section.ts` (pure helpers), `viewer/controls.ts`, `ui/stage.ts`, `ui/step-align.ts` (mode exclusivity),
`ui/i18n/{en,es}.ts`, `ui/xchange.css`, `src/pages/ddt-xchange.astro` (§6), UI-DESIGN §6.4–6.8/§12.3, tests. Items
B1–B7 are §5.1–§5.7.

### 5.0 Bench baseline (3 M triangles)

Bench B, 2026-11-07: synthetic lower-arch jaw of 2,998,992 triangles and 1,502,788 vertices (143 MiB binary STL, the
`LIMITS` jaw maximum), 1280×800, DPR 1, renderer ANGLE on Direct3D 11, NVIDIA GTX 1080 Ti, headed and headless.

| Measure | Result |
|---|---|
| Parse / display normals (the jobs worker in the app) | 593–851 ms / 183–298 ms |
| `setJaw` (main thread, once) | 76–120 ms |
| First frame (upload and shader compile, once) | 174–229 ms, 68.7 MB of GPU buffers |
| Warm frame | 2.3–3.7 ms |
| Orbit, GPU-synced per frame | p50 1.4–2.1 ms, p95 2.3–4.8 ms |
| Orbit, `requestAnimationFrame`, headed | 144.2 fps = the display refresh (p50 6.9 ms, max 8.1 ms) |
| Orbit with one clipping plane, GPU-synced | p50 1.2–1.4 ms |
| Click pick, three `Raycaster` (linear) | 243–401 ms: fails the 50 ms task budget |
| Click pick, GPU (1×1 float target, half-pixel offset) | 0.9–2.9 ms; first 22–26 ms (shader compile); 9/9 within 0.05 mm of the raycast |
| Engine BVH (`geometry/bvh.ts`) | Build 3.0–3.7 s on the main thread, 57.2 MB kept, ≈ 160 MB transient heap; query ≤ 0.5 ms; 9/9 agree |
| JS heap after parse | ≈ 218–250 MB, of which 143 MB are the file bytes kept for the export |
| Headless caveat | The first frame after heavy synchronous work stalls 0.75–1.0 s headless only: measure fps headed |

Decision: **GPU picking** (no dependency, no build step, respects clipping). The BVH is not wired.

| Id | Item | Level | Status | Min |
|---|---|---|---|---|
| B1 | GPU picking | MUST | Done (slice B); hover and pick sides Fixed (review) | 15 |
| B2 | Section plane | MUST (Follow the view: SHOULD) | Done (slice B), Follow the view included; open scans, ring, range and first P Fixed (review) | 18 + 4 |
| B3 | Distance | MUST (dragging a point: SHOULD) | Done (slice B), dragging included; keyboard, short lines, double-clicks Fixed (review) | 15 + 6 |
| B4 | D toggles the color map | SHOULD | Done (slice B) | 1 |
| B5 | No z-fight with the cut | MUST | Handled (look base); re-checked in slice B | 0 (re-check) |
| B6 | 3 M-triangle budget | MUST | Done (slice B); first P Fixed (review) | 8 |
| B7 | Not in this slice | WON'T | Won't | — |

### B1 · GPU picking (MUST)

- **Behaviour.**
  - `pickSurface(x, y, jawOnly)` keeps its signature (test stand-ins stub it) and changes inside. `pickObject(x, y)`
    (A9) shares the same pass.
  - One render into a 1×1 `RGBA32F` target. `camera.setViewOffset(w, h, x − left − 0.5, y − top − 0.5, 1, 1)` frames
    the clicked CSS pixel; `scene.overrideMaterial` is one `ShaderMaterial` (`DoubleSide`) writing the world
    position in rgb and an object code in a (1 jaw, 2 captured body, 3 + i implant i, 0 nothing). The code is set per
    mesh in `onBeforeRender` with `uniformsNeedUpdate = true`, together with that mesh's polygon offset (the base
    commit's depth bias), so where a replacement coincides with the scan the pick returns what is drawn on top.
    `readRenderTargetPixels` reads a `Float32Array(4)`.
  - Pickable: meshes on one pick layer (jaw, implant meshes, captured shells; never pins, labels, cut faces or
    helpers), visible, with opacity ≥ 0.1. `jawOnly` (guided points) limits the layer mask to the jaw.
  - The pick material carries the active section planes (B2): a click never lands on a removed part.
  - Afterwards the render target, camera layers and view offset, override material and clear colour/alpha are exactly
    as before, and no frame is scheduled.
  - Warm-up (SHOULD): one pick at the stage center in `requestIdleCallback` (`setTimeout` 200 ms where missing) after
    a jaw loads, so the 22–26 ms compile never lands on a click.
  - Without `EXT_color_buffer_float` the three raycast stays as the fallback, with a `ponytail:` comment naming its
    ceiling (≈ 0.25–0.4 s per click on 3 M triangles) and the upgrade path (RGBA8 depth packing + unproject).
  - Hover (`pickPart`) stays a three raycast over the small part meshes: it needs the hit triangle for the µm readout.
  - The target and the material are disposed in `Viewer.dispose()`.
- **Input (callers).** Middle click, Home, touch & hold, guided points (click, tap, Enter), per-object clicks (A9),
  distance points (B3).
- **Copy.** None.
- **Accessibility, reduced motion, < 960 px.** Nothing visible changes; every pick answers within a frame, taps
  included.
- **Acceptance.** Vitest: the pure decode in `viewer/pick.ts`, `(rgba, codes) → { point, object, siteId } | null`
  (code 0, jaw, implant index → site id, captured body). Bench on the 3 M jaw: click pick p95 ≤ 5 ms and the first
  click after warm-up ≤ 5 ms; 9/9 points within 0.05 mm of the raycast; with a cut on, a click on the removed half
  hits what lies behind it; middle click to tween start ≤ 50 ms.

### B2 · Section plane (MUST; Follow the view SHOULD)

- **Behaviour.**
  - **On and off.** The Section button (in the look's icon bar; `aria-expanded`, `aria-controls="xch-section"`) opens
    the section popover and turns the cut on if it was off. Closing the popover (Esc, outside click, focus leaving it)
    keeps the cut, as exocad does [SV]; the button shows it is on (the look's active style). "Remove the cut" turns it
    off and closes the popover. P (stage focused) toggles the cut without moving focus and announces it.
  - **Start.** Through the orbit target, perpendicular to the view direction, removing everything between the plane
    and the camera: you look into the cut. The plane stays fixed in the scene (exocad's default), so turning the view
    shows the cut from the side.
  - **Position.** Native range from −r to +r mm (r = the visible bounding-sphere radius when the cut started), step
    0.1 mm, `aria-valuetext` "{mm} mm". Shift + wheel over the stage moves it 0.5 mm per notch; read `deltaX` when
    `deltaY` is 0, since Shift turns the wheel horizontal on macOS. With the cut off, Shift + wheel zooms as today.
  - **Show the other side** (switch): removes the other half (exocad's Invert).
  - **Follow the view** (switch, SHOULD; exocad's Rotate): while on, the plane stays perpendicular to the view at its
    depth from the target as you turn.
  - **Cut faces.** While the cut is on, the inner side of every cut surface draws flat and unlit in `--xch-cut`, so
    the section reads as a section rather than a lit inside. It is a second draw of the same geometry with
    `side: BackSide`, a `MeshBasicMaterial` and the same planes, not on the pick layer. Every object uses the same cut
    colour, so coincident cut faces cannot stripe.
  - **What is cut.** Jaw scan, replacements and captured scan bodies. Implant labels whose anchor is removed hide
    (SHOULD). Guided pins and distance points stay.
  - `renderer.localClippingEnabled = true`; the planes go on the jaw, part, capture, cut-face and pick materials.
  - A new case, the sample, Exit sample and a viewer restart remove the cut. Display and Section popovers close each
    other.
- **Input.** P · Section button · Position slider · Shift + wheel · the two switches · Remove the cut.
- **Copy.** `section.*`, `say.sectionOn`, `say.sectionOff`, keys row "Section" (§5.8).
- **Accessibility.** The Display popover pattern: non-modal; Esc closes it and returns focus to the button; focus
  leaving it closes it; opening it focuses Position. Switches use `role="switch"`. `--xch-cut` (defined per theme with
  the look) reaches ≥ 3:1 against the stage background (WCAG 1.4.11) and differs from the jaw tone by ΔL ≥ .2
  (OKLab).
- **Reduced motion.** Nothing animates; the popover's CSS entrance is cut by `global.css`.
- **< 960 px.** Anchored like Display, `max-width: calc(100% - 1.4rem)`, `data-lenis-prevent`.
- **Acceptance.** Vitest: pure `sectionPlane(viewDir, target, offset, flipped)` in `viewer/section.ts` → normal and
  constant. A point between plane and camera gets a negative signed distance (removed), a point behind it a positive
  one, and flip swaps them. Bench on the 3 M jaw with the cut and the cut faces on: orbit GPU-synced p95 ≤ 6 ms.
  Screenshots light and dark, EN and ES: cut on, flipped, seen from the side.

### B3 · Distance (MUST; dragging a point SHOULD)

- **Behaviour.**
  - **On and off.** The Distance button (`aria-pressed`) or R toggles the tool; `ControlMode` gains `'measure'`.
  - **Exclusive.** Not available during guided points: R is ignored and the button is `aria-disabled` with
    `dist.busy`; starting guided points ends the tool. While measuring, the adjust pad hides and set drags pause (a
    left-drag on an implant turns the view). Any change of the implant-set pose (undo, reset, alignment) ends the
    tool, so a number never describes a pose you no longer see.
  - **Points.** A click (≤ 4 px, ≤ 300 ms) or a tap (≤ 500 ms) on any visible surface places point 1; the next one
    places point 2 and shows the value; a third starts a new pair. Picks use B1 and respect the cut. A click on
    nothing does nothing.
  - **Keyboard.** While the stage has keyboard focus the crosshair shows, as in guided mode. Enter places a point at
    the crosshair (a miss announces `dist.miss`), Backspace removes the last point, Esc or R ends the tool.
  - **Value.** Straight-line distance between the two surface points in mm with two decimals (exocad states 0.01 mm
    [MT]), locale separator through `num(lang, d, 2)`: "12.34 mm", "12,34 mm".
  - **Drawing.** In the labels layer, `aria-hidden`, positioned in `placeLabels()` with transforms and SVG attributes
    only (no layout reads): two 12 px dots and a 2 px line in `--xch-active` with a 1 px `#1e293b` halo (the
    crosshair recipe), and the value pill at the midpoint (`--xch-active` fill, `#1e293b` text: 6.8:1 light, 8.8:1
    dark). All of it hides when a point projects off-screen. A hint chip (`dist.hint`) shows at the top center while
    fewer than two points exist.
  - **Drag a point** (SHOULD). Pressing within 12 px of a dot (24 px on touch) drags it along the surfaces: a GPU pick
    under the pointer once per frame; over nothing the point stays. Release announces the new value. The
    single-pointer alternative (WCAG 2.5.7) is clicking two new points.
  - Leaving the tool clears the points.
- **Input.** R · Distance button · click or tap · Enter · Backspace · Esc · drag a dot.
- **Copy.** `dist.*`, `say.distFirst`, `say.distance`, `say.distOff`, keys rows (§5.8).
- **Accessibility.** The stage's `aria-describedby` adds `xch-view-dist` (`dist.keyboard`) while the tool is on, as
  guided mode adds `xch-view-gp`. Every value is announced politely through `#xch-status`. Cursor `crosshair`; targets
  ≥ 24 px.
- **Reduced motion.** Dots and pill appear without a scale-in.
- **< 960 px.** Taps place points; 24 px touch radius for dots; the hint chip wraps.
- **Acceptance.** Vitest stand-in in `measure` mode: two clicks call the optional `onMeasurePoint?` with the
  `pickSurface` results; Enter picks at the canvas center; Backspace and Esc reach the optional `onMeasureKey?`; R is
  ignored in guided mode. Unit: the displayed value equals the Euclidean distance at two decimals in EN and ES. Browser:
  on the 3 M jaw each click answers in ≤ 50 ms; zoomed to ≤ 0.02 mm per pixel, two clicks on two scan-body cap centers
  of the sample read within 0.05 mm of the generator's spacing.

### B4 · D toggles the color map (SHOULD)

- **Behaviour.** D does what C does; exocad's Ctrl+D shows distances [HK], and Ctrl+D itself stays the browser's
  bookmark.
- **Input.** D, stage focused, no modifier. **Copy.** keys row 11.
- **Accessibility.** Same scope rule as C (WCAG 2.1.4). **Reduced motion.** Nothing animates. **< 960 px.** Same.
- **Acceptance.** Stand-in: `d` → `onToggleMap` once.

### B5 · No z-fight with the cut (MUST, Handled (look base))

- **Behaviour.** The base commit's bias (§3.4) also holds with clipping on and with the cut-face pass.
- **Input, copy, accessibility, reduced motion, < 960 px.** None: rendering only.
- **Acceptance.** Z probe after B2: cap and wall 100 % replacement pixels; sample at Fit and at 4× zoom with the cut on
  and off shows no stripes, light and dark.

### B6 · 3 M-triangle budget (MUST)

| Budget (3 M triangles, 1280×800) | Target | Baseline | Before slice B (f7c61f4) · headless / headed | Slice B · headless (3 runs) / headed (3 runs) |
|---|---|---|---|---|
| Orbit, GPU-synced p95, cut and cut faces on | ≤ 6 ms | 2.3–4.8 ms without the cut | no cut: 2.2 / 2.2 ms (no section yet) | 2.7–2.9 / 3.0–5.7 ms (p50 2.0–2.1 / 2.2–2.5); no cut 2.2–2.3 / 2.0–2.4; flipped + Follow the view 2.5–3.0 / 2.4–4.0 |
| Orbit, rAF headed | ≥ 95 % of the display refresh | 144.2 fps on 144 Hz | 144 fps | 144 fps with the cut on (p50 6.9, p95 7.0 ms) in every run |
| Click pick p95 / first click after warm-up | ≤ 5 ms / ≤ 5 ms | 243–401 ms (raycast) | raycast 229.7 / 358.3 ms; first 198.5 / 292.4 ms | GPU 1.5–2.1 / 1.8–3.4 ms; first 1.3, 1.5, 5.1 / 1.4–2.2 ms |
| Middle click to tween start | ≤ 50 ms | ≈ 0.4 s | p95 260.8 / 298.3 ms | p95 1.3–2.0 / 1.3–3.4 ms |
| JS heap after 50 picks | ± 5 MB | — | +0 MB | +0.00–0.01 MB |
| `renderer.info.memory` after dispose | 0 geometries, 0 textures | 0 | 0, 0 | 0, 0 (the pick target, pick and cut materials included) |

- **Kept as is:** hover never touches the jaw; the adaptive pixel ratio while interacting (UI-DESIGN §3.5); parsing
  and normals in the jobs worker; the file bytes kept for the byte-identical `jaw.*` export.
- **Input, copy, accessibility, reduced motion.** None: budgets only. **< 960 px.** The same budgets hold on the
  smaller one-column canvas.
- **Acceptance.** The bench re-run against the slice B code, headed and headless, renderer string and the table
  above filled in the slice's commit message.

### B7 · Not in this slice (WON'T)

- Several planes, a colour per plane, the 2D Cut View window, placing the plane by clicks or by the cursor,
  auto-rotation, a Reset button (Home/End on the slider reach the ends; Remove the cut + P restarts it) [SV, CV].
- Angle, thickness, nearest, orthogonal, plane distance, object size, several distances at once, ΔX/ΔY/ΔZ [MT].
- The engine BVH for picking: 3.0–3.7 s main-thread build, 57 MB kept and ≈ 160 MB transient for what a 1×1 render
  answers in ≤ 3 ms.
- `renderer.compileAsync` for the first frame (174–229 ms once, behind the import) and moving `setJaw`'s bounds work
  to the worker (76–120 ms once).
- Dropping the kept file bytes: the export copies the jaw byte for byte.

### 5.8 Slice B copy (EN / ES)

| Key | EN | ES |
|---|---|---|
| `section.title` | Section | Corte |
| `section.position` | Position | Posición |
| `section.value` | {mm} mm | {mm} mm |
| `section.flip` | Show the other side | Mostrar el otro lado |
| `section.follow` (SHOULD) | Follow the view | Seguir la vista |
| `section.off` | Remove the cut | Quitar el corte |
| `section.hint` | The cut starts facing you; turn the view to see it from the side. Shift + wheel moves it. | El corte empieza de frente a ti; gira la vista para verlo de lado. Shift + rueda lo mueve. |
| `dist.title` | Distance | Distancia |
| `dist.button` | Measure a distance | Medir una distancia |
| `dist.hint` | Click two points on any surface. Drag a point to move it. | Haz clic en dos puntos de cualquier superficie. Arrastra un punto para moverlo. |
| `dist.keyboard` | Keyboard: bring the crosshair onto a point (arrow keys pan, Shift + arrows turn) and press Enter. Backspace removes the last point; Esc ends. | Con teclado: lleva la mira a un punto (las flechas desplazan, Shift + flechas giran) y pulsa Enter. Retroceso quita el último punto; Esc termina. |
| `dist.value` | {mm} mm | {mm} mm |
| `dist.miss` | Nothing under the crosshair. Pan or turn the view until it sits on a surface, then press Enter. | No hay nada bajo la mira. Desplaza o gira la vista hasta que quede sobre una superficie y pulsa Enter. |
| `dist.busy` | Finish the guided points first. | Termina primero los puntos guiados. |
| `say.sectionOn` | Section on. | Corte activado. |
| `say.sectionOff` | Section off. | Corte desactivado. |
| `say.distFirst` | First point placed. Now the second. | Primer punto colocado. Ahora el segundo. |
| `say.distance` | Distance: {mm} mm. | Distancia: {mm} mm. |
| `say.distOff` | Distance tool closed. | Herramienta de distancia cerrada. |

`{mm}` is passed already formatted (`num(lang, value, 2)` or `num(lang, value, 1)` for the slider). `say.measured`
already exists (fit re-measure), hence `say.distance`. Tooltips reuse `view.tip`: "Section · P", "Measure a distance
· R"; the buttons carry `aria-keyshortcuts`.

`keys.rows` changes in slice B:

| # | EN | ES |
|---|---|---|
| 11 (changed) | Color map · Toolbar or Display menu · C or D | Mapa de color · Barra de herramientas o menú Visualización · C o D |
| new, after 11 | Section · Section button · P | Corte · Botón Corte · P |
| new, after it | Measure a distance · Distance button, then click two points · R, then Enter at the crosshair | Medir una distancia · Botón Distancia y luego clic en dos puntos · R y luego Enter sobre la mira |
| 17 (changed) | Remove the last point (guided points, distance) · — · Backspace | Quitar el último punto (puntos guiados, distancia) · — · Retroceso |
| 18 (changed) | Cancel guided points or the distance, close menus · — · Esc | Cancelar los puntos guiados o la distancia, cerrar menús · — · Esc |

### 5.9 Slice B tests and acceptance

- **Tests to add.** `viewer/pick.ts` decode; `viewer/section.ts` plane maths; controls stand-in for P, R, D, Shift +
  wheel with the cut on (`onSectionNudge?`), measure clicks, Enter, Backspace and Esc; distance formatting EN/ES.
- **Commands.** As slice A (§4.13).
- **Browser.** The B6 table filled in from the bench (renderer string); section and distance by mouse, keyboard and
  touch emulation; light and dark, EN and ES; motion both ways; the L13 overlap probe with both popovers.
- **Lifecycle.** Ten round trips to /services/ with the cut and a distance on before leaving: one canvas, no WebGL
  context warning, `renderer.info.memory` at 0 after each dispose (the pick target, pick and cut materials included).

### 5.10 Slice B as built (2026-11-08)

On look A and slice A (f7c61f4). B1–B4 and B6 are `Done (slice B)`, with both SHOULDs of B2 and B3 (Follow the view,
dragging a point); B5 was re-checked. Where the build settles what the items above left open:

- **B1.** `viewer/pick.ts` holds the pick shader (three's clipping chunks, so the cut clips it like the meshes) and the
  pure `decodePick`. `Viewer.pickAt()` serves `pickSurface` and `pickObject`: the jaw on layer 1, replacements and
  captured bodies on layer 2 (only while visible and ≥ 10 % opaque; rings, pins, labels and cut faces never), the pick
  material's `onBeforeRender` copies each mesh's code and polygon offset. Target, clear color and alpha, override
  material, camera layers and view offset end as they were and no frame is scheduled. The warm-up pick runs at the
  stage center in `requestIdleCallback` (timeout 1 s; `setTimeout` 200 ms where missing) after a jaw loads and after
  every cut on/off change: with and without a plane the pick shader is another program, and a warm-up still pending
  when the cut changes runs with the state of that moment. Without `EXT_color_buffer_float` the raycast fallback also
  respects the cut and maps a cut face to its object. Hover (`pickPart`) stays a raycast over the parts.
- **B2.** The Section button sits after Jaw transparency in the icon bar. Its icon is a block on a section line, the
  removed half faint and the kept half hatched (a cut cylinder read as a database icon at 20 px). `aria-expanded`
  says whether the popover is open, so while the cut is on the button keeps the look's pressed style (`.is-on`) and is
  named `section.titleOn` ("Section (on)" / "Corte (activado)"). Opening the popover focuses Position. The slider spans
  ±r rounded up to 0.1 mm and Shift + wheel stays inside it. One `THREE.Plane` is shared by the jaw, the parts, the
  captured bodies, the highlight ring (mask and copies: it outlines what is left of a cut part), the cut faces and the
  pick material. While the cut is on, the jaw and the captured bodies draw their front side only (the parts always do),
  and each cut mesh gets a child `cut` mesh: the same geometry, back side, one `MeshBasicMaterial` in `--xch-cut`
  (not tone mapped), on no pick layer. A label hides when the cut removes its part's center. Follow the view re-aims the
  plane every frame (through the target, along the view, at its offset). A new case, the sample, Exit sample and a
  viewer restart remove the cut silently (`Stage.resetTools()`). While a popover is open, the chips at the top center
  (Ctrl chip, distance hint) wait hidden: at 960 px they would sit under it. On a coarse pointer the rows of both
  popovers (switches, ranges, buttons) are 44 px, and the section hint (half of it is about Shift + wheel) hides so
  Remove the cut stays in view above the views dial with no inner scroll; the Display popover scrolls inside, as before.
- **B3.** `Stage` keeps the points with the implant-set pose they were taken on (`s.assembly`, by identity: only a real
  pose change replaces it). `Stage.update()` ends the tool, and announces it, when that pose changes. Starting the tool
  first completes a running pose tween (`finishPose`). Guided points end it silently; meanwhile the button is
  `aria-disabled`, its tooltip is `dist.busy`, and a click says it. The viewer creates the overlay in the labels
  layer on first use: a 2 px `--xch-active` line over a 4 px `#1e293b` one, 12 px dots with the 1 px halo, and the
  pill. Dots and pill scale in through `--pop` (.45 s `back.out(1.6)`, like a guided pin, in the viewer's GSAP
  context); with reduced motion they just appear. A press within 12 px of a dot (24 px on touch, where no hold starts)
  drags it with one GPU pick per animation frame. The release picks once more and announces the value; over nothing
  the point stays. A press on a dot without moving is a click, so it places a point (a third one starts a new pair).
  R closing the tool says `say.distOff`, as Esc does. `dist.title` was not added: nothing shows it, and the button's
  name is `dist.button`. The live region merges messages within 300 ms, so two quick clicks are heard as one message
  ("First point placed. Now the second. Distance: 17.16 mm.").
- **B4.** D calls `onToggleMap` like C; Ctrl/⌘ + D stays the browser's bookmark.
- **B5.** `zcut.ts` (scratchpad): the real Viewer's bias on an implant coincident with the 3 M jaw's scan body at 1° FOV.
  Cap and wall are 100 % part pixels with the cut off and with the cut on away from the part. With the cut through
  the pair, the wall window is 100 % cut-face blue (no part or stone pixel), and the kept half's cap is 100 % part.
  Control: with the part hidden, 100 % stone. The sample in step 4 with the cut through the four scan bodies, at Fit
  and focused on AXO01, cut on and off, light and dark, shows no stripes.

**Checks** (2026-11-08): `typecheck:xchange` clean; `test:xchange` 494/494 (+48: `test/ux/viewer-tools.ux.test.ts` 23 in
the real Viewer with a recording renderer stand-in, `controls-keys` +13, `viewer/viewer.test.ts` +8 for `decodePick` and
`sectionPlane`, `contrast` +4 for the pill and the hint chip). Timing tests in files this slice does not touch (detect, mesh-io,
privacy) failed in some full runs while other processes held the CPU at 45–100 %; each of those files passes alone. Build and `npm test` green.
Browser, headless system Chrome, renderer ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11): the slice B
probe passes 30/30 with 0 console messages. It covers the section (popover, slider, Shift + wheel, flip, follow, Esc, P,
Remove, popovers exclusive, tooltips) and the distance (button, clicks, value against the scale bar, drag, Enter,
Backspace, Esc, R, pose change, guided points), both with motion on. It also runs reduced motion (no scale-in), Spanish
and dark at 960 × 700 (decimal comma), and taps and a 24 px touch drag at 768 × 1024. L13 is clean at 1280 × 800,
960 × 700, 768 × 1024 touch and 1024 × 768 touch, both languages, plain, with either popover, measuring, and measuring
with the section popover. With touch at 768 × 1024 every popover row is 44 px or more (16–46 px with a mouse, unchanged).
Ten ClientRouter round trips with a cut and a distance on leave one canvas, 11 mounts and no
WebGL warning. An orbit with the cut on runs at rAF p50 / p95 / max 6.9 / 7.0–7.1 / 7.1 ms over two runs, nothing over 50 ms.
`shoot.mjs` (`looks/slice-b`): 12 shots, 0 errors, orbit 6.9 / 7.1 / 7.2 ms. Against slice A, only the icon bar
(two buttons more), the sub-pixel framing of s1 and s7 and the s5 entrance differ, as slice A saw. Bench in the B6 table
above. Every pick agrees with three's raycast within 0.05 mm (9/9, and 9/9 with the cut against a raycast that skips
the removed half). The first rAF window after the benchmark's synchronous loops holds one 0.9–1.1 s stall (0.46–0.52 s
before): the first present after 360 synchronous renders instead of 180, which the app never does; the steady window
is 144 fps. Not run: axe (not installed) and a screen reader.

### 5.11 Review fixes (2026-11-09)

Two reviews of the finished viewer (UX in system Chrome, adversarial in code) left 22 failing "BUG:" tests in
`test/ux-viewer/` and `test/adversarial-viewer/`; all pass now, unchanged. Where a fix changes what an earlier item said,
the item above keeps its text and this table rules.

| Finding | Fix |
|---|---|
| Parts the cut removed could be hovered, grabbed and dragged (`pickPart`) | `pickPart` raycasts the parts and their cut faces and keeps only hits the cut keeps, as the picks do |
| A pose tween started during a set drag (Ctrl + Z with Ctrl held for it, an alignment result) landed after the release: shown ≠ stored ≠ exported | The drag wins: every pose a set drag writes first stops a running pose tween (`Viewer.stopPose`), and the release commits the drag's own last pose, shown again |
| Left + right never panned (the second button only sends a chorded `pointermove`) | A view drag turns into a pan in `pointermove` as soon as both buttons are down |
| The wheel over the icon bar, views dial, pad or legend scrolled the page | The stage takes the wheel bubbling from its chrome (zoom, Shift + wheel); over a popover it scrolls the popover and never the page (`overscroll-behavior: contain`) |
| Tab past a popover's last control jumped to the FAQ | The popovers follow the icon bar in the DOM, and Tab from a popover's last control closes it and goes on to the views dial (the open Display menu hides the dial, so the browser's own next stop was still off the stage); both are `role="group"` named by their title |
| Enter on Distance left focus on the button (the next Enter closed the tool); keys dead on the chrome; R silent during guided points | The Distance button moves focus into the 3D view when the tool turns on; a character key on a chrome button acts as on the stage (the buttons keep Enter, Space, arrows, Home, End; popovers keep every key); R during guided points says `dist.busy` (optional `onMeasureBusy?`) |
| A double-click while measuring or placing guided points refit the view and made a 0.00 mm pair; four Enters at one spot were four guided points; two quick taps on two caps fit | No double-click or double tap fits while clicks place points; a double tap is two taps within 300 ms and 24 px; a distance point on top of the first (< 0.005 mm) and a guided point within 0.5 mm of a placed one are refused and said (`dist.same`, `gp.same`) |
| The value pill hid both dots on short lines | Under 120 px between the dots the pill goes beside the line, 9 px off it, its edge chosen as `labelSpot` does |
| No sub-millimetre adjustment on a tablet (fine steps need Shift) | **Fine** in the pad (`pad.fine`, `aria-pressed`): every click steps 5° · 0.1 mm; each pad button's name and tooltip say the step it makes; the pad is described by its hint (`pad.hint` now "Shift + click: one fine step") |
| The highlight ring vanished when the cut faced the camera through the part | Ring mask and copies draw both sides (all that shows of a cut part is its back side): 1659 → 1392 ring px through the guided target on the GPU (was 350 → 0) |
| Every back face of the open jaw scan was painted as a section, far from the plane | Cut faces only on replacements (closed CAD solids), drawn with the replacement's depth bias so they win over the coincident scanned scan body; the jaw scan and the captured bodies (open scanner surfaces) keep both sides lit with the cut, as without it. With no jaw cut faces the raycast fallback walks the jaw once per pick again |
| The first P froze 70–100 ms (clipped shader variants compiled on the spot) and the next click missed 5 ms | Every clipped material carries the plane all the time; without a cut it keeps everything (1 km away), so P is a uniform change and the pick program warmed with the jaw serves every cut state. 3 M-triangle jaw in the page: first P max frame 20.8 ms, no long animation frame (was 69.5 / 101 ms); Enter at the crosshair right after it 3.8 ms |
| The slider (±r about the target) could not reach the far side once the rotation center sat on a surface; a jaw loaded after the cut kept the small range | `Viewer.sectionReach()`: the farthest corner of what is shown along the cut from where it started, at least the radius; `Stage.update()` widens the slider when more is shown, never narrows it |
| A pick kept the removed jaw alive (≈ 69 MB) until the next one | `pickCode` is cleared after every pick |
| Without a cut the GPU pick rasterized replacements' back faces the frame does not draw | The pick draw takes each mesh's side (`cut ? DoubleSide : material.side`); culling only, the program never changes |
| Labels of replacements hidden from the Display menu stayed frozen on screen | A hidden replacement takes its label along |
| Home or a middle click during a view tween stopped it part-way while the view stayed pressed | A rotation center set during a camera tween keeps the orientation that tween was heading to |
| French AZERTY 6 and 8 zoomed out ("symbols win" took its - and _) | Those two keys go by the digit (the keypad - and the wheel still zoom out); every other symbol still wins (Czech and Slovak + on 1) |
| New case, the sample or Exit sample while measuring said "Distance tool closed." | `App.resetCase()` removes the tools before the new case renders |
| T flipped the transparency with no jaw; Section and Distance acted on an empty stage | T and Shift + middle click wait for a jaw like their button; Section and Distance are `aria-disabled` (server-rendered so) while nothing is shown, and P and R do nothing then |
| The "applied to all" toast sat on the legend and scale bar as the map appeared | Every toast goes when step 4 opens (`Toasts.clear()`) |
| Black corners in full screen | `.xch__stage:fullscreen { border-radius: 0 }` |
| The Display popover scrolled inside at 1440 × 900 and hid half its rows on a tablet | It takes the stage's height; the views dial and the scale bar wait hidden while it is open (as the chips do) |
| On a tablet the chrome hid AXO04's label and covered the arch's flanks | Default view and Fit fill 68 % on a touch screen (`LOOK.frameTouch`); a label that would sit under the chrome goes to the other side of its part (chrome boxes read on resize and when the pad or legend shows or hides, never in a frame) |
| A wide field of view made the scale bar wrong by up to 34 % | The bar hides above 5° |
| Jaw transparency and Section icons looked alike | Jaw transparency is a drop, half hatched |
| Copy | The shortcuts' Section row adds the Position slider and Shift + wheel; "Distance button" → "Measure a distance button"; ES `pad.turnAround` "Girar 180°". "Exocad" keeps its capital: the rest of the site writes it so in 55 places (titles, meta descriptions, other pages this branch does not touch) and the tool in all 13 of its own; lowercase in two strings would read as a typo |

**Tests changed with the spec** (assertions replaced, not loosened): `viewer-tools` "clips every drawn surface" now pins the
permanent plane, the scans' two lit sides without cut faces and the replacements' cut faces with their bias; "warm-up"
pins one warm-up for every cut state and an unchanged pick material version. **New:** `test/ux/review-fixes.ux.test.ts`
(8, Tab out of a popover included), the review-fix block of `controls-keys` (5), pick sides and labels beside the chrome in `viewer-tools` (2), framing
on touch in `viewer-look` (1).

**Checks** (2026-11-09): `typecheck:xchange` clean; `test:xchange` 532/532 (the 1 M-triangle STL parse and the privacy flow
timed out once each in a busy full run and pass alone); build and `npm test` green. Browser, headless system Chrome,
ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11), built site: `probe-fix.mjs` 23/23 (empty stage,
step 1 T, toasts, first P on the sample with no frame over 50 ms and no long animation frame (its longest frame 7.1 to
34.8 ms between runs), removed parts neither hovered nor dragged, both buttons, the wheel
over four overlays with the page still, Tab out of the Section popover onto the views dial, the Display popover without
inner scroll at 1440 × 900, the Distance button by keyboard, Enter twice, a double-click keeping the zoom, a 40 px
distance, Fine, full screen, 1024 × 768 touch with no label under the chrome and no overlap), `probe-3m.mjs` 3/3,
`probe-ring.mjs` 1/1, `probe-tab.mjs` 4/4 (Tab past the last control of either popover lands on the views dial in step 1
and step 4, the page still; before the last fix the open Display menu's hidden dial sent it to the FAQ in step 1 and to the
pad in step 4), `probe-display.mjs` 2/2 (the open Display menu opaque, no inner scroll at 1440 × 900, 636 of 738 px
shown on a 1024 × 768 tablet); 0 console messages, no external request. `shoot.mjs` (`looks/final`): 12 shots, 0 errors, orbit
p50 / p95 / max 6.9 / 7.0 / 7.1 ms. Scripts and results in the session scratchpad (`viewer-polish/fixrev/`).

---

## 6. Integration notes (outside `src/xchange`)

- **`src/pages/ddt-xchange.astro`** (the tool's own page): stage markup only.
  - The view buttons group: done with look A (the views dial and the Occlusal pill, `data-view` for all eight).
  - Section and Distance buttons in the look's icon bar (top right, vertical: Display · Color map · Jaw transparency |
    Shortcuts · Full screen): after Jaw transparency, before the separator, drawn from `ICO` in the page like the others
    (done in slice B, with `aria-keyshortcuts` P and R).
  - The section popover (`id="xch-section"`, server-rendered `hidden`, `data-lenis-prevent`) and the distance hint chip
    (`data-disthint`, `aria-hidden`): done in slice B.
  - The distance overlay (one `<svg>` with the line and its halo, two dots, the value pill) is not page markup: the
    viewer creates it in `.xch__labels` on first use, as it does the labels and pins, and that layer is cleared on
    dispose. Slice A needed no markup: the touch & hold ring is `.xch__stage::after` and the tooltips are the look's CSS
    `data-tip`; `keyOf()` in the page reads `VIEW_KEYS`.
  - `<p id="xch-view-dist" class="sr-only">` for the stage description: done in slice B.
  - The shortcuts dialog and the help-section table render `c.keys.rows` and need no markup change.
- **`src/pages/es/ddt-xchange.astro`**: no change (one-line wrapper).
- **Look merge (2026-11-08):** no site change was needed. "Try a sample case" brings the stage into view through the
  existing `scroll-to` event of `src/scripts/motion.js` (offset −90 px), with the stage as its target at ≥ 960 px.
  For the site motion rework: `src/scripts/motion.js` line 312 reads the first entry of an `IntersectionObserver` batch
  (`([e]) => …`), the bug fixed here in `viewer.ts` and `ui/main.ts`; one callback can carry an enter and a leave, so
  the last entry is the current state.
- **Review fixes (2026-11-09):** no site change was needed. In the tool's own page: both popovers moved right after the
  icon bar (Tab order) with `role="group"`, Section and Distance server-rendered `aria-disabled`, the pad's Fine pill and
  its hint's id (the pad's description), the new Jaw transparency icon.
- **Slice B (2026-11-08):** no site change was needed. The section popover's entrance is the Display popover's CSS
  (`@starting-style`), which `global.css` already cuts under reduced motion; the distance dots and pill animate in the
  viewer's own GSAP context. Nothing new is fetched and no worker was added.
- **Not touched by either slice:** `src/scripts/motion.js` (another branch is reworking the site motion),
  `src/layouts/*`, `src/styles/global.css` and every other global style, other pages, the site dictionaries
  `src/i18n/*`, `public/.htaccess` (nothing new is fetched, no new worker), `package.json` and the lockfile (three
  0.187 core only), `scripts/smoke.mjs`.
- **Lenis.** No new modal, so no new `scroll-lock` use; the section popover carries `data-lenis-prevent`; the stage
  already has it (wheel zooms, Shift + wheel moves the cut).
- **Lifecycle.** Every new listener hangs on the mount or viewer `AbortSignal`; the new GPU resources are disposed in
  `Viewer.dispose()`; mount on `astro:page-load` and dispose on `astro:before-swap` stay as they are (UI-DESIGN §3.4).
- **Full screen.** New popovers and overlays live inside `.xch__stage`, so they show in full screen.
- **Docs inside `src/xchange` to update with each slice:** UI-DESIGN §3.2 (camera row), §6.2–6.4, §6.6 (picking),
  §6.7 (input table), §6.8, §12.3 (copy), §14.4 (tests); README "Estado".
- **Git.** Merge order: look winner → A → B. Local commits only (no push), staged by explicit path: other agents
  commit in this worktree. The bench and probe scripts stay out of the repo (Playwright is not a project dependency,
  UI-DESIGN §15.4).
