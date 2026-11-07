/**
 * Shape check shared by geometry/ and detect/.
 * Errors: INVALID_ARGUMENT reason 'shape' (array lengths) | 'index' (index without a vertex).
 */
import { XchangeError } from '../core/errors';
import type { TriMesh } from '../core/types';

/** Throws unless every array has a whole number of records and every index addresses a vertex. Returns the vertex count. */
export function checkMesh(mesh: TriMesh): number {
  const { positions, indices, colors } = mesh;
  if (positions.length % 3 !== 0 || indices.length % 3 !== 0 || (colors && colors.length !== positions.length)) {
    throw new XchangeError('INVALID_ARGUMENT', { reason: 'shape' });
  }
  const vertexCount = positions.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i]! >= vertexCount) throw new XchangeError('INVALID_ARGUMENT', { reason: 'index' });
  }
  return vertexCount;
}
