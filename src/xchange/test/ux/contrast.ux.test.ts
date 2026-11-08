/**
 * UX review, WCAG 2.2 AA text contrast (1.4.3) of the workspace's small text, computed from the real CSS: the site
 * tokens in src/styles/global.css, the tool tokens and rules in src/xchange/ui/xchange.css, light and dark. Each pair
 * is a text rule on the background it actually sits on in the page (checked in Chrome on the sample case).
 * Tests named "BUG:" fail until the CSS is fixed.
 */
import { describe, expect, it } from 'vitest';

// node:fs through a computed specifier: the tool's tsconfig has no Node types and this is the only file read
const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: URL, encoding: 'utf8'): string };
const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const SITE = read('../../../styles/global.css');
const TOOL = read('../../ui/xchange.css');

/* ---------- a tiny cascade: top-level rules only (no @media / @starting-style), last declaration wins ---------- */
type Rule = { selectors: string[]; decls: Record<string, string> };
const splitTop = (s: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean);
};
function rules(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{;]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: splitTop(sel!, ','),
    decls: Object.fromEntries(splitTop(body!, ';').map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; })),
  }));
}
const ALL = [...rules(SITE), ...rules(TOOL)];
const declsOf = (selector: string): Record<string, string> => Object.assign({}, ...ALL.filter((r) => r.selectors.includes(selector)).map((r) => r.decls));

type Theme = 'light' | 'dark';
const DARK = '[data-theme="dark"]';
const tokens = (theme: Theme): Record<string, string> => {
  const t = { ...declsOf(':root'), ...declsOf('.xch') };
  if (theme === 'dark') Object.assign(t, declsOf(DARK), declsOf(`${DARK} :is(.xch, .xch-dialog, .xch__toasts)`));
  return Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith('--')));
};
/** A property of `selector` in `theme` (the dark rule `[data-theme="dark"] <selector>` overrides). */
const prop = (selector: string, name: string, theme: Theme): string | undefined =>
  (theme === 'dark' ? declsOf(`${DARK} ${selector}`)[name] : undefined) ?? declsOf(selector)[name];

function resolve(v: string, t: Record<string, string>, extra: Record<string, string> = {}): string {
  for (let i = 0; i < 10 && v.includes('var('); i++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, k: string, fb?: string) => extra[k] ?? t[k] ?? fb ?? '');
  return v;
}

/* ---------- colors ---------- */
type RGBA = { r: number; g: number; b: number; a: number };
function color(v: string): RGBA {
  v = v.trim();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%\s*,\s*transparent\)$/.exec(v);
  if (mix) { const c = color(mix[1]!); return { ...c, a: c.a * Number(mix[2]) / 100 }; }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) { const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }; }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) { const p = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 }; }
  throw new Error(`color? ${v}`);
}
/** Every color stop of a background (a gradient gives several candidates). */
const layer = (v: string): RGBA[] => (/gradient\(/.test(v) ? [...v.matchAll(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)/gi)].map((m) => color(m[0])) : [color(v)]);
const over = (t: RGBA, b: RGBA): RGBA => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
const lum = (c: RGBA): number => { const f = (x: number): number => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a: RGBA, b: RGBA): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Worst contrast of `fg` over a stack of background layers (top first), every gradient stop tried. */
function worst(fg: string, layersTopFirst: string[]): number {
  let under: RGBA[] = [{ r: 255, g: 255, b: 255, a: 1 }];
  for (const l of [...layersTopFirst].reverse()) under = layer(l).flatMap((c) => under.map((u) => over(c, u)));
  const f = color(fg);
  return Math.min(...under.map((b) => ratio(over(f, b), b)));
}

/** Text color of `sel` and the backgrounds under it (selectors whose `background` is the ground), resolved for a theme. */
function pair(theme: Theme, text: string, grounds: string[]): number {
  const t = tokens(theme);
  const fg = resolve(prop(text, 'color', theme) ?? 'var(--slate)', t);
  return worst(fg, grounds.map((s) => resolve(prop(s, 'background', theme) ?? prop(s, 'background-color', theme) ?? 'transparent', t)));
}
/** A status chip of `tone` ('' = neutral): text in its token on a 10 % tint of it, over `grounds`. */
function chip(theme: Theme, tone: string, grounds: string[]): number {
  const t = tokens(theme);
  const c = resolve(prop(tone ? `.xch-chip--${tone}` : '.xch-chip', '--c', theme)!, t);
  const tint = resolve(prop('.xch-chip', 'background', theme)!, t, { '--c': c });
  return worst(c, [tint, ...grounds.map((s) => resolve(prop(s, 'background', theme)!, t))]);
}

const AA = 4.5; // all of these are under 18.66 px bold / 24 px

describe('small text on the --mist sub-cards (drop zones, library, guided list, result card, alerts)', () => {
  const cases: [string, string, string[]][] = [
    ['formats line in the drop zones (steps 1 and 3)', '.xch__formats', ['.xch__drop']],
    ['"or" in the drop zones', '.xch__or', ['.xch__drop']],
    ['"Excel? Save it as CSV first." note in the step 1 drop zone', '.note', ['.xch__drop']],
    ['library group titles (Favorites · All geometries · This case only)', '.xch__libgroup', ['.xch__sub']],
    ['guided list state (● Now · ○ Next · Skipped)', '.xch__gpstate', ['.xch__gplist li']],
    ['metric labels under RMS / 95 % within / Within 100 µm', '.xch__metric span', ['.xch__result']],
    ['"Code: …" line of an alert', '.xch-alert__code', ['.xch-alert']],
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const [what, text, grounds] of cases) {
      const r = pair(theme, text, grounds);
      it(`${r < AA ? 'BUG: ' : ''}${theme}: ${what} reaches 4.5:1 (computed ${r.toFixed(2)}:1)`, () => expect(r).toBeGreaterThanOrEqual(AA));
    }
  }
});

describe('status chips where they are rendered (always icon + word, but the word must be readable)', () => {
  const cases: [string, string, string[]][] = [
    ['info chip "Sample" in the Imported sources row', 'info', ['.xch__sources']],
    ['info chip "Acceptable" in the result card', 'info', ['.xch__result']],
    ['neutral chip "From file" in an implant row', '', ['.xch__rowbtn']],
    ['neutral chip "Measuring…" in the result card', '', ['.xch__result']],
    ['ok chip "Good fit" in the result card', 'ok', ['.xch__result']],
    ['warn chip "Check" in an implant row', 'warn', ['.xch__rowbtn']],
    ['bad chip "No usable fit" in the result card', 'bad', ['.xch__result']],
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const [what, tone, grounds] of cases) {
      const r = chip(theme, tone, grounds);
      it(`${r < AA ? 'BUG: ' : ''}${theme}: ${what} reaches 4.5:1 (computed ${r.toFixed(2)}:1)`, () => expect(r).toBeGreaterThanOrEqual(AA));
    }
  }
});

describe('3D view toolbar (glass over the stage gradient)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const t = tokens(theme);
    const sel = '.xch__tool[aria-pressed="true"]';
    const pressedDark = theme === 'dark' ? declsOf(`${DARK} .xch__tool[aria-pressed="true"]`) : {};
    const fg = resolve(pressedDark.color ?? prop(sel, 'color', theme)!, t);
    const bg = resolve(pressedDark.background ?? prop(sel, 'background', theme)!, t);
    const r = worst(fg, [bg, resolve(prop('.xch__toolbar', 'background', theme)!, t), resolve('var(--xch-stage)', t)]);
    it(`${r < AA ? 'BUG: ' : ''}${theme}: the pressed view preset / open Display button reaches 4.5:1 (computed ${r.toFixed(2)}:1)`, () => expect(r).toBeGreaterThanOrEqual(AA));
  }
});
