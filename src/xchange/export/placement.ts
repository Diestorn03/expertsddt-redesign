/**
 * Puts the replacement geometry of every site in output coordinates:
 * vertex' = assemblyTransform · site.matrix · vertex, as one float64 matrix applied once
 * (a single rounding to float32 per coordinate).
 *
 * Throws EXPORT_GEOMETRY_MISSING {site}; MATRIX_INVALID / MATRIX_NOT_RIGID {reason} for the assembly
 * transform and {reason, site} for a site matrix. `site` is always the index in `sites`.
 * INVALID_ARGUMENT (core checkMesh reasons) for a malformed geometry mesh.
 */
import { XchangeError, isXchangeError } from '../core/errors';
import { multiply, validateRigid } from '../core/mat4';
import { checkMesh, transformMesh } from '../core/mesh';
import type { ImplantSite, Mat4, ReplacementGeometry, TriMesh } from '../core/types';

export interface PlacedReplacement {
  siteId: string;
  label: string;
  geometryId: string;
  geometryName: string;
  /** implant frame -> output coordinates = assemblyTransform · site.matrix */
  matrix: Mat4;
  /** transformMesh(geometry.mesh, matrix) */
  mesh: TriMesh;
}

/** The geometry assigned to each site, in site order. Own keys only: a site id like 'constructor' finds nothing. */
export function siteGeometries(
  sites: readonly ImplantSite[],
  geometryBySite: Readonly<Record<string, ReplacementGeometry>>,
): ReplacementGeometry[] {
  return sites.map((site, index) => {
    const geometry = Object.hasOwn(geometryBySite, site.id) ? geometryBySite[site.id] : undefined;
    if (!geometry) throw new XchangeError('EXPORT_GEOMETRY_MISSING', { site: index });
    return geometry;
  });
}

export function placeReplacements(
  sites: readonly ImplantSite[],
  geometryBySite: Readonly<Record<string, ReplacementGeometry>>,
  assemblyTransform: Mat4,
): PlacedReplacement[] {
  const assembly = validateRigid(assemblyTransform);
  const geometries = siteGeometries(sites, geometryBySite);
  // Every matrix and every geometry mesh (library entries come back from IndexedDB) is checked before
  // the first mesh is allocated: no NaN corner is ever written.
  const matrices = sites.map((site, index) => {
    try {
      return multiply(assembly, validateRigid(site.matrix));
    } catch (error) {
      throw isXchangeError(error) ? new XchangeError(error.code, { ...error.details, site: index }) : error;
    }
  });
  for (const geometry of new Set(geometries)) checkMesh(geometry.mesh);
  return sites.map((site, i) => {
    const geometry = geometries[i]!, matrix = matrices[i]!;
    return {
      siteId: site.id,
      label: site.label,
      geometryId: geometry.id,
      geometryName: geometry.name,
      matrix,
      mesh: transformMesh(geometry.mesh, matrix),
    };
  });
}
