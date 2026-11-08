/**
 * View presets in world (scanner) axes (UI-DESIGN §6.3). ASSUMPTION to check against real exports (P8):
 * +Z toward the occlusal side of the lower arch, -Y toward anterior. This table is the only thing to
 * change if real files differ.
 */
import type { Arch, Vec3 } from '../core/types';

export type Preset = 'occlusal' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export const PRESET_KEYS: Readonly<Record<string, Preset>> = { '1': 'occlusal', '2': 'front', '3': 'back', '4': 'left', '5': 'right', '6': 'top' };

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
