/**
 * View presets in world (scanner) axes (UI-DESIGN §6.3). ASSUMPTION to check against real exports (P8):
 * +Z toward the occlusal side of the lower arch, -Y toward anterior. This table is the only thing to
 * change if real files differ.
 */
import type { Arch, Vec3 } from '../core/types';

export type Preset = 'occlusal' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** exocad's numpad views, on the keypad and the number row; 0 is the Default view (occlusal for the arch), 7 and 9 nothing. */
export const VIEW_KEYS: Readonly<Record<string, Preset | 'fit'>> = { '1': 'front', '2': 'bottom', '3': 'back', '4': 'left', '5': 'fit', '6': 'right', '8': 'top', '0': 'occlusal' };

/** The symbols French AZERTY prints on its number row where they would otherwise win: - on 6 and _ on 8. */
const AZERTY_ROW: Readonly<Record<string, string>> = { Digit6: '-', Digit8: '_' };

/**
 * The view a key asks for. The number row goes by `code`, whatever the layout types there (AZERTY: & é " ' ( - è _ …); the
 * keypad only with NumLock on (`key` is its digit; with NumLock off it sends Home, End, the arrows and PageUp/PageDown, which
 * keep their own meaning). A zoom symbol or ? wins (Czech and Slovak type + on the 1 key), except French AZERTY's - on 6
 * and _ on 8: there the view wins (- still zooms out on the keypad, and the wheel). An event without a `code` (some virtual
 * keyboards) goes by its digit.
 */
export function viewForKey(code: string, key: string): Preset | 'fit' | null {
  if (['+', '-', '=', '_', '?'].includes(key) && AZERTY_ROW[code] !== key) return null;
  const row = /^Digit(\d)$/.exec(code)?.[1], pad = /^Numpad(\d)$/.exec(code)?.[1];
  const digit = row ?? (pad !== undefined ? (pad === key ? pad : null) : !code && /^\d$/.test(key) ? key : null);
  return (digit !== null && VIEW_KEYS[digit]) || null;
}

/** `from`: unit direction from the target to the camera; `up`: camera up. */
export function presetView(preset: Preset, arch: Arch | null): { from: Vec3; up: Vec3 } {
  switch (preset) {
    case 'occlusal':
      return { from: arch === 'upper' ? [0, 0, -1] : [0, 0, 1], up: [0, -1, 0] };
    case 'front':
      return { from: [0, -1, 0], up: [0, 0, 1] };
    case 'back':
      return { from: [0, 1, 0], up: [0, 0, 1] };
    case 'left': // patient's left
      return { from: [1, 0, 0], up: [0, 0, 1] };
    case 'right':
      return { from: [-1, 0, 0], up: [0, 0, 1] };
    case 'top':
      return { from: [0, 0, 1], up: [0, -1, 0] };
    case 'bottom': // the occlusal side of an upper arch, anterior at the top
      return { from: [0, 0, -1], up: [0, -1, 0] };
  }
}
