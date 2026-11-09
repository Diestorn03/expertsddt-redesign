/**
 * Adversarial template fitting (detect/sites recoverSitesFromMesh). Tests named "BUG:" fail on
 * purpose until the production code is fixed (see the review findings); the others document
 * attacks that hold.
 */
import { describe, expect, it } from 'vitest';
import { fromTranslation, getColumn, multiply, rotationAngleBetween } from '../../core/mat4';
import type { Mat4 } from '../../core/types';
import { distance } from '../../core/vec3';
import { visibleAbove } from '../../align/test-utils';
import { recoverSitesFromMesh, type RecoverResult } from '../../detect/sites';
import { addNoise, makeFrames, makeScanBody, placeBodies } from '../fixtures';

const DEG = Math.PI / 180;

/** Components whose recovered frame is off: origin (µm) and rotation (°). */
function wrongSites(r: RecoverResult, frames: readonly Mat4[], maxMm: number, maxRad: number): string[] {
  return r.sites.flatMap((s) => {
    const f = frames[s.componentIndex!]!;
    const mm = distance(getColumn(s.matrix, 3), getColumn(f, 3)), rad = rotationAngleBetween(s.matrix, f);
    return mm <= maxMm && rad <= maxRad ? [] : [`component ${s.componentIndex}: ${(mm * 1000).toFixed(0)} µm, ${(rad / DEG).toFixed(1)}°`];
  });
}

describe('recoverSitesFromMesh', () => {
  it('BUG: scan bodies whose bottom 2.6 mm was not scanned (under the gum) are left unresolved or flipped although the reference fits them exactly', () => {
    const body = makeScanBody();
    const frames = makeFrames(8, 'lower', 7);
    // Noise-free: at the true pose every shell sample lies on the reference (RMS 0, coverage 1).
    const r = recoverSitesFromMesh(placeBodies(frames, visibleAbove(body, 2.6)), { mesh: body });
    expect({ unresolved: r.unresolved, wrong: wrongSites(r, frames, 0.02, 0.05 * DEG) }).toEqual({ unresolved: [], wrong: [] });
  });

  it('7-fold symmetric bodies are flagged indexAmbiguous; captures 99 km from the origin still fit within 10 µm', () => {
    const heptagon = makeScanBody({ segments: 7, flat: false });
    const frames = makeFrames(4, 'lower', 7);
    const symmetric = recoverSitesFromMesh(placeBodies(frames, heptagon), { mesh: heptagon });
    expect(symmetric.sites.map((s) => s.flags.indexAmbiguous)).toEqual([true, true, true, true]);
    for (const s of symmetric.sites) expect(distance(getColumn(s.matrix, 3), getColumn(frames[s.componentIndex!]!, 3))).toBeLessThan(0.02);

    const body = makeScanBody();
    const far = makeFrames(3, 'lower', 7).map((f) => multiply(fromTranslation([9.9e4, -4.95e4, 3.3e4]), f));
    const r = recoverSitesFromMesh(addNoise(placeBodies(far, body), 0.005, 3), { mesh: body });
    expect(r.fits.map((f) => f.status)).toEqual(['reliable', 'reliable', 'reliable']);
    expect(wrongSites(r, far, 0.01, 0.15 * DEG)).toEqual([]);
  });
});
