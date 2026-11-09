/**
 * View presets per case (UI-DESIGN §6.3; P8 answered by Fernando's 8 real arches: they come in at least two frames,
 * occlusal toward ±Z and the front toward ±X, so no world table fits). The presets follow the arch's own frame
 * (archFrame): occlusal from the implants (their mean axis, connection -> top, points occlusally on either arch, evened
 * out with the plane through the connections, since distal implants lean back), anterior from the implant arch (across
 * the line through the two implants farthest apart, toward the others). Implants that do not sit on the jaw scan (not
 * aligned yet), or too few for an arch, leave the frame to the jaw scan (its mean normal; the main axis of its outline,
 * the front at its narrow end). With nothing to go on: the world table, +Z occlusal on the lower arch, -Y anterior.
 */
import { pointPca } from '../align/metrics';
import type { Arch, Vec3 } from '../core/types';
import { add, cross, dot, length, normalize, scale, sub } from '../core/vec3';

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

/** The arch's axes in world coordinates: `occlusal` = where the occlusal view looks from, `anterior` ⟂ it. Unit. */
export interface ArchFrame {
  occlusal: Vec3;
  anterior: Vec3;
}

/** The world table's frame: the lower arch's occlusal side +Z (an upper's -Z), anterior -Y. */
export const worldFrame = (arch: Arch | null): ArchFrame => ({ occlusal: arch === 'upper' ? [0, 0, -1] : [0, 0, 1], anterior: [0, -1, 0] });

/**
 * `from`: unit direction from the target to the camera; `up`: camera up. In `frame` (default: the world table):
 * superior = occlusal on a lower arch (or none), -occlusal on an upper; the patient's left = superior × anterior.
 */
export function presetView(preset: Preset, arch: Arch | null, frame: ArchFrame | null = null): { from: Vec3; up: Vec3 } {
  const { occlusal, anterior } = frame ?? worldFrame(arch);
  const plus0 = (v: Vec3): Vec3 => [v[0] + 0, v[1] + 0, v[2] + 0]; // -0 + 0 = +0: the table's axes stay exact
  const neg = (v: Vec3): Vec3 => plus0(scale(v, -1));
  const superior = arch === 'upper' ? neg(occlusal) : occlusal;
  const left = plus0(cross(superior, anterior));
  switch (preset) {
    case 'occlusal':
      return { from: occlusal, up: anterior };
    case 'front':
      return { from: anterior, up: superior };
    case 'back':
      return { from: neg(anterior), up: superior };
    case 'left': // patient's left
      return { from: left, up: superior };
    case 'right':
      return { from: neg(left), up: superior };
    case 'top':
      return { from: superior, up: anterior };
    case 'bottom': // the occlusal side of an upper arch, anterior at the top
      return { from: neg(superior), up: anterior };
  }
}

/** What archFrame needs from the jaw scan: its mean vertex normal (its length says how coherent) and some of its points. */
export interface JawShape {
  normal: Vec3;
  points: Float32Array;
}

export function jawShape(positions: ArrayLike<number>, normals: ArrayLike<number>, maxPoints = 20_000): JawShape {
  const n = Math.floor(positions.length / 3), step = Math.max(1, Math.ceil(n / maxPoints));
  const points = new Float32Array(3 * Math.ceil(n / step));
  let nx = 0, ny = 0, nz = 0;
  for (let v = 0; v < n; v++) {
    nx += normals[3 * v] ?? 0; ny += normals[3 * v + 1] ?? 0; nz += normals[3 * v + 2] ?? 0;
    if (v % step === 0) for (let c = 0; c < 3; c++) points[3 * (v / step) + c] = positions[3 * v + c]!;
  }
  return { normal: n ? [nx / n, ny / n, nz / n] : [0, 0, 0], points };
}

/** Implants whose connections lie this close to the jaw scan (median over the set) sit on it: aligned, or arrived in place. */
const ON_JAW_MM = 6;
/** Implants this far off the line through the two end ones make an arch (a straight row has no front). */
const ARCH_OFFSET_MM = 3;
/** Below this mean-normal length the jaw scan has no clear outside (a closed or folded mesh). */
const JAW_COHERENCE = 0.2;
/** The jaw outline's main axis needs this variance ratio over the next one (a nearly round outline has none). */
const OUTLINE_RATIO = 1.2;
/** The narrow end must be this much narrower (fraction of the width) to tell the front from the back. */
const NARROW_END = 0.05;

const inPlane = (v: Vec3, n: Vec3): Vec3 | null => {
  const w = sub(v, scale(n, dot(v, n)));
  return length(w) > 1e-6 ? normalize(w) : null;
};

/** Median distance (mm) from the points to the nearest of `cloud` (xyz flat). */
function medianDistance(points: readonly Vec3[], cloud: Float32Array): number {
  const d = points.map((p) => {
    let best = Infinity;
    for (let i = 0; i + 2 < cloud.length; i += 3) best = Math.min(best, (cloud[i]! - p[0]) ** 2 + (cloud[i + 1]! - p[1]) ** 2 + (cloud[i + 2]! - p[2]) ** 2);
    return Math.sqrt(best);
  }).sort((a, b) => a - b);
  return d[(d.length - 1) >> 1] ?? Infinity;
}

/** Anterior from the implant arch, or null without one: across the line through the two farthest apart, toward the others. */
function implantArch(origins: readonly Vec3[], occlusal: Vec3): Vec3 | null {
  if (origins.length < 3) return null;
  const flat = origins.map((p) => sub(p, scale(occlusal, dot(p, occlusal))));
  let ends: [number, number] = [0, 1], far = -1;
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
    const d = length(sub(flat[i]!, flat[j]!));
    if (d > far) { far = d; ends = [i, j]; }
  }
  const a = flat[ends[0]]!, b = flat[ends[1]]!;
  const across = normalize(cross(occlusal, sub(b, a))), mid = scale(add(a, b), 0.5);
  const offsets = flat.filter((_, i) => i !== ends[0] && i !== ends[1]).map((p) => dot(sub(p, mid), across));
  if (Math.max(...offsets.map(Math.abs)) < ARCH_OFFSET_MM) return null;
  return offsets.reduce((s, o) => s + o, 0) < 0 ? scale(across, -1) : across;
}

/** Anterior from the jaw's outline on the occlusal plane, or null when it is too round or too even to tell. */
function jawAnterior(points: Float32Array, occlusal: Vec3): Vec3 | null {
  const pca = pointPca(points);
  // the two axes nearest the occlusal plane, by variance (the third is the scan's thickness)
  const flat = pca.axes.map((ax, i) => ({ ax, v: pca.variances[i]! })).sort((p, q) => Math.abs(dot(p.ax, occlusal)) - Math.abs(dot(q.ax, occlusal))).slice(0, 2).sort((p, q) => q.v - p.v);
  const main = inPlane(flat[0]!.ax, occlusal);
  if (!main || flat[0]!.v < OUTLINE_RATIO * flat[1]!.v) return null;
  const across = normalize(cross(occlusal, main));
  // the posterior half spans the full width (two legs, or the palate), the anterior half narrows to the incisors
  const front: number[] = [], back: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const p = sub([points[i]!, points[i + 1]!, points[i + 2]!], pca.centroid);
    (dot(p, across) >= 0 ? front : back).push(dot(p, main));
  }
  const width = (xs: number[]): number => {
    xs.sort((p, q) => p - q);
    return xs.length ? xs[Math.floor(0.95 * (xs.length - 1))]! - xs[Math.floor(0.05 * (xs.length - 1))]! : 0;
  };
  const wf = width(front), wb = width(back), score = (wb - wf) / Math.max(wf, wb, 1e-9);
  return Math.abs(score) < NARROW_END ? null : score > 0 ? across : scale(across, -1);
}

/**
 * The case's frame for the view presets (world coordinates: implants already moved by the set's pose), or null with
 * nothing to go on. Implants count when no jaw is shown or when they sit on it (median connection within ON_JAW_MM of
 * the scan's points).
 */
export function archFrame(implants: readonly { origin: Vec3; axis: Vec3 }[], jaw: JawShape | null): ArchFrame | null {
  const origins = implants.map((i) => i.origin);
  const onJaw = implants.length > 0 && (!jaw || medianDistance(origins, jaw.points) <= ON_JAW_MM);
  let occlusal: Vec3 | null = null;
  if (onJaw) {
    const mean = implants.reduce<Vec3>((s, i) => add(s, normalize(i.axis)), [0, 0, 0]);
    if (length(mean) > 0.5 * implants.length) {
      occlusal = normalize(mean);
      if (implantArch(origins, occlusal)) {
        const plane = pointPca(origins.flat()).axes[2];
        occlusal = normalize(add(occlusal, dot(plane, occlusal) < 0 ? scale(plane, -1) : plane));
      }
    }
  }
  if (!occlusal && jaw && length(jaw.normal) >= JAW_COHERENCE) occlusal = normalize(jaw.normal);
  if (!occlusal) return null;
  const anterior = (onJaw ? implantArch(origins, occlusal) : null)
    ?? (jaw ? jawAnterior(jaw.points, occlusal) : null)
    ?? inPlane([0, -1, 0], occlusal) ?? inPlane([0, 0, 1], occlusal)!;
  return { occlusal, anterior };
}
