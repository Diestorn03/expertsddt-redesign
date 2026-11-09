/**
 * Mesh import: content-based detection (never the file name) and STL / PLY / OBJ parsing into an
 * indexed TriMesh, with the limits of the mesh's purpose enforced before anything is allocated.
 *
 * Error details: FILE_EMPTY; FILE_TOO_LARGE {limitBytes, bytes}; FORMAT_UNKNOWN;
 * FORMAT_NOT_ALLOWED {format, purpose}; plus the parser errors listed in stl.ts, ply.ts, obj.ts.
 */
import { XchangeError, type XchangeWarning } from '../../core/errors';
import { LIMITS, MESH_FORMATS_BY_PURPOSE, PLAUSIBLE_EXTENT_MM } from '../../core/limits';
import { computeBounds } from '../../core/mesh';
import type { MeshFormat, MeshPurpose, TriMesh } from '../../core/types';
import { looksLikeOBJ, parseOBJ } from './obj';
import { isPLY, parsePLY } from './ply';
import { isBinarySTL, looksAsciiSTL, parseSTL } from './stl';

export { parseOBJ } from './obj';
export { parsePLY } from './ply';
export { parseSTL } from './stl';

export interface ParsedMesh {
  mesh: TriMesh;
  format: MeshFormat;
  warnings: XchangeWarning[];
}

export interface MeshParseLimits {
  maxBytes: number;
  maxTriangles: number;
}

const DETECT_WINDOW_BYTES = 1024 * 1024;

const PARSERS: Readonly<Record<MeshFormat, (bytes: Uint8Array, limits: MeshParseLimits) => ParsedMesh>> = {
  stl: parseSTL,
  ply: parsePLY,
  obj: parseOBJ,
};

/** Content sniffing only (never the file name). Never throws; null when nothing matches. */
export function detectMeshFormat(bytes: Uint8Array): MeshFormat | null {
  if (isBinarySTL(bytes)) return 'stl';
  if (isPLY(bytes)) return 'ply';
  const window = Math.min(bytes.length, DETECT_WINDOW_BYTES);
  if (looksAsciiSTL(bytes, window)) return 'stl';
  if (looksLikeOBJ(bytes, window)) return 'obj';
  return null;
}

/** Size check, detect, allowed-format check, parse with LIMITS[purpose], then add warnings. */
export function parseMesh(bytes: Uint8Array, purpose: MeshPurpose, hint?: MeshFormat): ParsedMesh {
  const limits = LIMITS[purpose];
  if (bytes.byteLength === 0) throw new XchangeError('FILE_EMPTY');
  if (bytes.byteLength > limits.maxBytes) {
    throw new XchangeError('FILE_TOO_LARGE', { limitBytes: limits.maxBytes, bytes: bytes.byteLength });
  }
  // The hint (e.g. the extension) only picks the parser whose specific error the user sees when nothing matched.
  const format = detectMeshFormat(bytes) ?? (hint !== undefined && Object.hasOwn(PARSERS, hint) ? hint : null);
  if (!format) throw new XchangeError('FORMAT_UNKNOWN');
  if (!MESH_FORMATS_BY_PURPOSE[purpose].includes(format)) throw new XchangeError('FORMAT_NOT_ALLOWED', { format, purpose });

  const parsed = PARSERS[format](bytes, limits);
  const triangles = parsed.mesh.indices.length / 3;
  if (purpose === 'jaw' && triangles > LIMITS.jaw.warnTriangles) parsed.warnings.push({ code: 'MESH_LARGE', details: { triangles } });
  const { min, max } = computeBounds(parsed.mesh);
  const extent = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const plausible = PLAUSIBLE_EXTENT_MM[purpose];
  if (!(extent >= plausible.min && extent <= plausible.max)) {
    parsed.warnings.push({ code: 'MESH_UNITS_SUSPECT', details: { extentMm: Math.round(extent * 1000) / 1000 } });
  }
  return parsed;
}
