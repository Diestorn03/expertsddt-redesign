/**
 * GPU picking (VIEWER-POLISH B1): one render of what can be picked into a 1×1 float target framed on the clicked pixel.
 * The pick shader writes the world position in rgb and an object code in a; viewer.ts runs the pass, this file holds the
 * shader and the decode (pure, tested).
 */
import type { Vec3 } from '../core/types';

/** What a modified middle click acts on: the jaw scan, a replacement or a captured scan body. */
export type SceneObject = 'jaw' | 'part' | 'capture';

/** Object codes in alpha: 0 nothing (the clear), 1 the jaw scan, 2 a captured scan body, 3 + i the implant drawn i-th. */
export const PICK_JAW = 1;
export const PICK_CAPTURE = 2;
export const PICK_PART = 3;

export interface Pick {
  point: Vec3;
  object: SceneObject;
  /** The implant's site id (replacements only). */
  siteId: string | null;
}

/** `rgba` as read from the target; `sites[i]` is the site id drawn with code PICK_PART + i. */
export function decodePick(rgba: ArrayLike<number>, sites: readonly string[]): Pick | null {
  const code = Math.round(rgba[3] ?? 0);
  const point: Vec3 = [rgba[0] ?? NaN, rgba[1] ?? NaN, rgba[2] ?? NaN];
  if (code < PICK_JAW || !point.every(Number.isFinite)) return null;
  if (code === PICK_JAW) return { point, object: 'jaw', siteId: null };
  if (code === PICK_CAPTURE) return { point, object: 'capture', siteId: null };
  return { point, object: 'part', siteId: sites[code - PICK_PART] ?? null };
}

/** World position out, clipped by the cut like the meshes it stands for (three's clipping chunks). */
export const PICK_VS = `#include <clipping_planes_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
export const PICK_FS = `#include <clipping_planes_pars_fragment>
uniform float code;
varying vec3 vWorld;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(vWorld, code);
}`;
