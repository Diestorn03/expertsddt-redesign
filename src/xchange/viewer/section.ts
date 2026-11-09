/** Section plane maths (VIEWER-POLISH B2), pure. three removes what has dot(normal, p) + constant < 0. */
import type { Vec3 } from '../core/types';
import { add, dot, normalize, scale } from '../core/vec3';

export interface PlaneEq {
  normal: Vec3;
  constant: number;
}

/**
 * The cut through `target + offset · d`, d = `viewDir` normalized (camera → scene), facing away from the camera: what lies
 * between the plane and the camera gets a negative signed distance (removed), so you look into the cut; positive offsets
 * go deeper. `flipped` keeps that half and removes the other one (exocad's Invert).
 */
export function sectionPlane(viewDir: Vec3, target: Vec3, offset: number, flipped: boolean): PlaneEq {
  const d = normalize(viewDir);
  const normal = flipped ? scale(d, -1) : d;
  return { normal, constant: -dot(normal, add(target, scale(d, offset))) };
}
