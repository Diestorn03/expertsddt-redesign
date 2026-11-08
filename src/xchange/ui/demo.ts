/**
 * Sample case (UI-DESIGN §10): generated in the browser, deterministic, no network, no patient. It goes through
 * the real pipeline (parsePositions on the CSV bytes, parseMesh on the STL bytes, real alignment and export).
 * ponytail: reuses the pure test generators; move them to a runtime module if test and sample needs diverge.
 */
import { writeBinarySTL } from '../core/stl-writer';
import type { TriMesh } from '../core/types';
import { makeSyntheticCase } from '../test/fixtures';
import { encodeMicronMapperCSV } from '../test/fixtures/positions';

export interface Sample {
  csv: Uint8Array;
  jaw: Uint8Array;
  body: TriMesh;
}

export function makeSample(): Sample {
  const c = makeSyntheticCase({ arch: 'lower', implants: 4, noiseSigmaMm: 0.01, seed: 3 });
  return { csv: new TextEncoder().encode(encodeMicronMapperCSV(c.frames)), jaw: writeBinarySTL(c.jaw), body: c.body };
}
