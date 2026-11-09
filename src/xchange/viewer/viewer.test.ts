import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../core/types';
import { buildLut, LUT_SIZE, MAP_STOPS, srgbToOklab } from './colormap';
import { decodePick, PICK_CAPTURE, PICK_JAW, PICK_PART } from './pick';
import { presetView, VIEW_KEYS, viewForKey, type Preset } from './presets';
import { sectionPlane } from './section';

describe('color map', () => {
  const { srgb } = buildLut();
  const at = (i: number): string => '#' + [0, 1, 2].map((c) => srgb[3 * i + c]!.toString(16).padStart(2, '0')).join('');
  it('LUT endpoints and midpoint equal the three stops', () => {
    expect(at(0)).toBe(MAP_STOPS[0]);
    expect(at(LUT_SIZE - 1)).toBe(MAP_STOPS[2]);
    expect(at((LUT_SIZE - 1) / 2 | 0).slice(0, 3)).toBe(MAP_STOPS[1].slice(0, 3));
  });
  it('OKLab lightness strictly decreases from 0 to 100 µm', () => {
    let last = Infinity;
    for (let i = 0; i < LUT_SIZE; i += 8) {
      const L = srgbToOklab([srgb[3 * i]! / 255, srgb[3 * i + 1]! / 255, srgb[3 * i + 2]! / 255])[0];
      expect(L).toBeLessThan(last);
      last = L;
    }
  });
});

describe('view presets', () => {
  const all: Preset[] = ['occlusal', 'front', 'back', 'left', 'right', 'top', 'bottom'];
  it('up is perpendicular to the view direction', () => {
    for (const p of all) for (const arch of ['upper', 'lower'] as const) {
      const { from, up } = presetView(p, arch);
      expect(from[0] * up[0] + from[1] * up[1] + from[2] * up[2]).toBe(0);
    }
  });
  it('occlusal flips with the arch', () => {
    expect(presetView('occlusal', 'lower').from[2]).toBe(1);
    expect(presetView('occlusal', 'upper').from[2]).toBe(-1);
  });
  it('top and bottom look along the occlusal axis from both sides, whatever the arch', () => {
    for (const arch of ['upper', 'lower', null] as const) {
      expect(presetView('top', arch).from).toEqual([0, 0, 1]);
      expect(presetView('bottom', arch).from).toEqual([0, 0, -1]);
    }
  });
  it('bottom is the occlusal view of an upper arch, anterior (−Y) at the top', () => {
    expect(presetView('bottom', null)).toEqual(presetView('occlusal', 'upper'));
    expect(presetView('bottom', 'lower').up).toEqual([0, -1, 0]);
  });
});

describe('view keys: exocad numpad map on the number row and the keypad', () => {
  const map: Record<string, Preset | 'fit' | null> = { '1': 'front', '2': 'bottom', '3': 'back', '4': 'left', '5': 'fit', '6': 'right', '7': null, '8': 'top', '9': null, '0': 'occlusal' };
  it('number row by code, keypad by code with NumLock on (key = its digit)', () => {
    for (const [d, view] of Object.entries(map)) {
      expect(viewForKey(`Digit${d}`, d), `Digit${d}`).toBe(view);
      expect(viewForKey(`Numpad${d}`, d), `Numpad${d}`).toBe(view);
    }
  });
  it('the number row works whatever the layout types there (AZERTY), Shift included', () => {
    expect(viewForKey('Digit1', '&')).toBe('front');
    expect(viewForKey('Digit2', 'é')).toBe('bottom');
    expect(viewForKey('Digit0', 'à')).toBe('occlusal');
    expect(viewForKey('Digit8', '*')).toBe('top'); // Shift + 8 on a US layout
  });
  it('with NumLock off the keypad keeps the meaning of the key it sends', () => {
    expect(viewForKey('Numpad2', 'ArrowDown')).toBeNull();
    expect(viewForKey('Numpad7', 'Home')).toBeNull();
    expect(viewForKey('Numpad9', 'PageUp')).toBeNull();
    expect(viewForKey('Numpad5', 'Clear')).toBeNull();
  });
  it('a symbol wins (Swiss and Czech layouts type + on the 1 key; ? opens the shortcuts)', () => {
    for (const k of ['+', '-', '=', '_', '?']) expect(viewForKey('Digit1', k), k).toBeNull();
    expect(viewForKey('NumpadAdd', '+')).toBeNull();
    expect(viewForKey('NumpadSubtract', '-')).toBeNull();
  });
  it('other keys are no view; an event without a code goes by its digit', () => {
    for (const [code, key] of [['KeyF', 'f'], ['Enter', 'Enter'], ['Home', 'Home'], ['', ''], ['', 'a'], ['KeyA', '1']]) expect(viewForKey(code!, key!), `${code}/${key}`).toBeNull();
    expect(viewForKey('', '6')).toBe('right');
  });
  it('every view and Fit has exactly one key (the tooltips and aria-keyshortcuts read it)', () => {
    const views = Object.values(VIEW_KEYS);
    expect(new Set(views).size).toBe(views.length);
    expect([...views].sort()).toEqual(['back', 'bottom', 'fit', 'front', 'left', 'occlusal', 'right', 'top']);
  });
});

describe('GPU pick decode (VIEWER-POLISH B1)', () => {
  const sites = ['AXO1', 'AXO2', 'AXO3'];
  it('code 0 (the clear) is nothing, whatever rgb holds', () => {
    expect(decodePick([0, 0, 0, 0], sites)).toBeNull();
    expect(decodePick([5, 6, 7, 0], sites)).toBeNull();
    expect(decodePick([5, 6, 7, 0.4], sites)).toBeNull(); // codes are whole numbers
  });
  it('1 is the jaw scan, 2 a captured scan body, rgb the world point', () => {
    expect(decodePick(new Float32Array([1.5, -2.25, 30.125, PICK_JAW]), sites)).toEqual({ point: [1.5, -2.25, 30.125], object: 'jaw', siteId: null });
    expect(decodePick([-4, 0, 9, PICK_CAPTURE], sites)).toEqual({ point: [-4, 0, 9], object: 'capture', siteId: null });
  });
  it('3 + i is the implant drawn i-th: its site id', () => {
    expect(decodePick([0, 1, 2, PICK_PART], sites)).toEqual({ point: [0, 1, 2], object: 'part', siteId: 'AXO1' });
    expect(decodePick([0, 1, 2, PICK_PART + 2], sites)!.siteId).toBe('AXO3');
    expect(decodePick([0, 1, 2, PICK_PART + 2.0001], sites)!.siteId, 'float noise').toBe('AXO3');
    expect(decodePick([0, 1, 2, PICK_PART + 7], sites)).toEqual({ point: [0, 1, 2], object: 'part', siteId: null });
  });
  it('a non-finite position is no hit', () => {
    expect(decodePick([NaN, 0, 0, PICK_JAW], sites)).toBeNull();
    expect(decodePick([0, Infinity, 0, PICK_PART], sites)).toBeNull();
  });
});

describe('section plane (VIEWER-POLISH B2)', () => {
  /** three removes a point whose signed distance is negative. */
  const signed = (pl: ReturnType<typeof sectionPlane>, p: Vec3): number => pl.normal[0] * p[0] + pl.normal[1] * p[1] + pl.normal[2] * p[2] + pl.constant;
  const view: Vec3 = [0, 0, -3]; // camera at +Z looking down (any length)
  const target: Vec3 = [10, -5, 2];

  it('through the target, facing away from the camera: what lies toward the camera is removed', () => {
    const pl = sectionPlane(view, target, 0, false);
    expect(pl.normal).toEqual([0, 0, -1]);
    expect(signed(pl, target)).toBeCloseTo(0, 12);
    expect(signed(pl, [10, -5, 7])).toBeLessThan(0); // between the plane and the camera
    expect(signed(pl, [10, -5, -3])).toBeGreaterThan(0); // behind it: kept
    expect(signed(pl, [99, 40, 2.01])).toBeLessThan(0); // the plane is infinite
  });
  it('flip swaps the halves, at the same place', () => {
    const pl = sectionPlane(view, target, 0, true);
    expect(signed(pl, [10, -5, 7])).toBeGreaterThan(0);
    expect(signed(pl, [10, -5, -3])).toBeLessThan(0);
    expect(signed(pl, target)).toBeCloseTo(0, 12);
  });
  it('positive offsets go deeper (away from the camera), in mm along the view, flipped or not', () => {
    for (const flipped of [false, true]) {
      const pl = sectionPlane(view, target, 2.5, flipped);
      expect(signed(pl, [0, 0, -0.5]), `flipped ${flipped}`).toBeCloseTo(0, 12);
      expect(Math.abs(signed(pl, target))).toBeCloseTo(2.5, 12);
    }
    expect(signed(sectionPlane(view, target, 2.5, false), target)).toBeLessThan(0); // the target is on the removed side now
  });
  it('any view direction: the normal is the unit view direction', () => {
    const d: Vec3 = [1, -2, 2];
    const pl = sectionPlane(d, [0, 0, 0], 3, false);
    expect(pl.normal.map((x) => +x.toFixed(12))).toEqual([1 / 3, -2 / 3, 2 / 3].map((x) => +x.toFixed(12)));
    expect(signed(pl, [1, -2, 2])).toBeCloseTo(0, 12); // 3 mm along d
  });
});
