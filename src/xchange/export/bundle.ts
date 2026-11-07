/**
 * The export ZIP. Entries, in order: combined.stl, replacements.stl, replacement_<label>.stl per site
 * (site order), jaw.stl | jaw.ply (the imported bytes, unchanged), report.json, README.txt.
 * Shells are concatenated: no Boolean union, no cutting.
 *
 * Throws EXPORT_GEOMETRY_MISSING / MATRIX_* (placement.ts), EXPORT_NAME_INVALID / EXPORT_TOO_LARGE
 * (zip.ts; the size is checked before any large allocation), INVALID_ARGUMENT (report.ts, or core
 * checkMesh for a malformed jaw or geometry mesh: checked after the size, before anything is written).
 */
import { checkMesh, countTriangles } from '../core/mesh';
import { writeBinarySTL } from '../core/stl-writer';
import type { ExportRequest } from '../core/types';
import { placeReplacements, siteGeometries } from './placement';
import { buildReadme, buildReport, type ExportReport } from './report';
import { entryViews, safeFilename, zipStore, zipStoreSize, type BundleFile } from './zip';

export { safeFilename } from './zip';

export interface ExportBundle {
  zipName: string; // `DDT-Xchange_${arch}_export.zip`
  zip: Uint8Array;
  /** Every entry in ZIP order. bytes are views into `zip`: one copy of the data, never the caller's buffers. */
  files: BundleFile[];
  report: ExportReport;
}

const stlBytes = (triangles: number): number => 84 + 50 * triangles;
const utf8 = new TextEncoder();

export function buildBundle(request: ExportRequest): ExportBundle {
  const { sites, jaw } = request;
  const used = new Set<string>();
  const siteFiles = sites.map((site, i) => {
    const stem = `replacement_${safeFilename(site.label, `implant_${i + 1}`)}`;
    let name = `${stem}.stl`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${stem}_${k}.stl`;
    used.add(name.toLowerCase());
    return name;
  });
  const jawEntry: BundleFile | null = jaw ? { name: `jaw.${jaw.format}`, bytes: jaw.originalBytes } : null;

  // Exact size of everything except the report and README text (zipStore re-checks the true total),
  // from triangle counts alone: an oversize bundle is refused before any mesh or STL is allocated.
  const siteTriangles = siteGeometries(sites, request.geometryBySite).map((g) => countTriangles(g.mesh));
  const replacementTriangles = siteTriangles.reduce((sum, n) => sum + n, 0);
  zipStoreSize([
    { name: 'combined.stl', size: stlBytes(replacementTriangles + (jaw ? countTriangles(jaw.mesh) : 0)) },
    { name: 'replacements.stl', size: stlBytes(replacementTriangles) },
    ...siteFiles.map((name, i) => ({ name, size: stlBytes(siteTriangles[i]!) })),
    ...(jawEntry ? [{ name: jawEntry.name, size: jawEntry.bytes.length }] : []),
    { name: 'report.json', size: 0 },
    { name: 'README.txt', size: 0 },
  ]);

  if (jaw) checkMesh(jaw.mesh); // re-serialised into combined.stl: same guard as the geometries in placement
  const placed = placeReplacements(sites, request.geometryBySite, request.assemblyTransform);
  const meshes = placed.map((p) => p.mesh);
  const replacements = writeBinarySTL(meshes);
  const data: BundleFile[] = [
    { name: 'combined.stl', bytes: jaw ? writeBinarySTL([jaw.mesh, ...meshes]) : replacements },
    { name: 'replacements.stl', bytes: replacements },
    ...meshes.map((mesh, i) => ({ name: siteFiles[i]!, bytes: writeBinarySTL(mesh) })),
    ...(jawEntry ? [jawEntry] : []),
  ];
  const report = buildReport(request, placed, data);
  const entries: BundleFile[] = [
    ...data,
    { name: 'report.json', bytes: utf8.encode(JSON.stringify(report, null, 2)) },
    // UTF-8 BOM: older Windows Notepad shows the Spanish accents correctly with it.
    { name: 'README.txt', bytes: utf8.encode(String.fromCharCode(0xfeff) + buildReadme(report)) },
  ];
  // ponytail: the whole ZIP is built in memory (peak ~2x the bundle, <= 512 MB by LIMITS). If big jaws hit
  // browser memory limits, hand the entries to a Blob or a File System Access stream instead of one buffer.
  const zip = zipStore(entries);
  return { zipName: `DDT-Xchange_${request.arch}_export.zip`, zip, files: entryViews(zip, entries), report };
}
