/**
 * Input limits (spec 7.4). Check file size and every declared count against these BEFORE
 * allocating memory for it. Values are a starting point until Fernando sends real sizes (P11).
 */
import type { MeshFormat, MeshPurpose } from './types';

const MB = 1024 * 1024;

export const LIMITS = {
  jaw: { maxBytes: 150 * MB, maxTriangles: 3_000_000, warnTriangles: 1_500_000 },
  capture: { maxBytes: 50 * MB, maxTriangles: 1_000_000, maxComponents: 64 },
  geometry: { maxBytes: 25 * MB, maxTriangles: 500_000 },
  positions: { maxBytes: 2 * MB, maxPositions: 128 },
  bundle: { maxBytes: 512 * MB },
} as const;

/** An indexed mesh never needs more than 3 vertices per triangle. */
export function maxVertices(purpose: MeshPurpose): number {
  return 3 * LIMITS[purpose].maxTriangles;
}

export const MESH_FORMATS_BY_PURPOSE: Readonly<Record<MeshPurpose, readonly MeshFormat[]>> = {
  jaw: ['stl', 'ply'], // jaw.* is exported byte for byte, so only formats exocad reads as a jaw
  capture: ['stl', 'ply', 'obj'],
  geometry: ['stl', 'ply', 'obj'],
};

/** Hard sanity bound on any coordinate (mm). Float32 still resolves ~8 µm at this magnitude. */
export const MAX_ABS_COORDINATE_MM = 1e5;

/** Bounding-box diagonal outside this range suggests wrong units: warn (MESH_UNITS_SUSPECT), never convert. */
export const PLAUSIBLE_EXTENT_MM = { min: 2, max: 250 } as const;

/** Default validateRigid tolerance: scanner files round axes to 6 decimals. */
export const RIGID_TOLERANCE = 1e-4;

/** Format-level parser limits. */
export const PARSE_LIMITS = {
  plyMaxHeaderBytes: 64 * 1024,
  plyMaxElementCount: 5_000_000,
  maxPolygonCorners: 256,
  maxLineChars: 1024 * 1024,
  xmlMaxElements: 50_000,
  xmlMaxDepth: 64,
  tableMaxRows: 10_000,
  tableMaxColumns: 256,
  labelMaxChars: 40,
} as const;
