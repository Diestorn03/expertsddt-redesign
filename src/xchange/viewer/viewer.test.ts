import { describe, expect, it } from 'vitest';
import { buildLut, LUT_SIZE, MAP_STOPS, srgbToOklab } from './colormap';
import { presetView, VIEW_KEYS, viewForKey, type Preset } from './presets';

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
