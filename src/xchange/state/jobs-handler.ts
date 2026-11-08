/**
 * Jobs worker logic (UI-DESIGN §14.1): parsing, detection, linking, assembly planning, display normals,
 * export and the library file. Testable in Node without a Worker. Errors cross as XchangeErrorPayload;
 * capture errors also carry `file` / `files` (1-based position, count) so the UI can say "File 2 of 3".
 * File names never reach this module: only bytes and a lowercase extension.
 */
import { toErrorPayload, XchangeError, type XchangeErrorPayload, type XchangeWarning } from '../core/errors';
import { computeVertexNormals } from '../core/mesh';
import type { CaptureFormat, ExportRequest, ImplantSite, MeshFormat, TriMesh } from '../core/types';
import { planAssembly, verifyAssemblyLayout, type AssemblyPlan } from '../detect/assembly';
import { linkSitesToComponents, recoverSitesFromMesh, splitComponents } from '../detect/sites';
import { buildBundle } from '../export/bundle';
import { detectMeshFormat, parseMesh } from '../io/mesh/index';
import { parsePositions } from '../io/positions/index';
import { mergePositionFiles, type Source } from './case';
import { decodeLibraryFile, encodeLibraryFile, LibraryFileError, type LibraryFileEntry } from './library-file';

export interface InFile {
  bytes: Uint8Array;
  /** Lowercase extension without the dot; '' when none. Only used as a format hint and for refusals. */
  extension: string;
}

/** A mesh plus its display normals. */
export interface ShownMesh {
  mesh: TriMesh;
  normals: Float32Array;
}

export interface CaptureResult {
  sites: ImplantSite[];
  sources: Source[];
  format: CaptureFormat;
  warnings: XchangeWarning[];
  mesh?: TriMesh;
  /** splitComponents(mesh), indexed like site.componentIndex; fragments flagged. */
  components?: (ShownMesh & { fragment: boolean })[];
}

export interface DetectResult {
  sites: ImplantSite[];
  unresolved: number[];
  warnings: XchangeWarning[];
}

export interface GeometryResult extends ShownMesh {
  format: MeshFormat;
  plan: AssemblyPlan;
  /** verifyAssemblyLayout(capture, mesh).compatible for positioned assemblies with a capture mesh. */
  layoutCompatible?: boolean;
  warnings: XchangeWarning[];
}

export interface JawResult extends ShownMesh {
  originalBytes: Uint8Array;
  format: 'stl' | 'ply';
  warnings: XchangeWarning[];
}

export type JobRequest =
  | { type: 'readCapture'; files: InFile[] }
  | { type: 'detect'; mesh: TriMesh; reference: TriMesh }
  | { type: 'readGeometry'; file: InFile; sites: ImplantSite[]; captureMesh?: TriMesh }
  | { type: 'readJaw'; file: InFile }
  | { type: 'export'; request: ExportRequest }
  | { type: 'libraryOut'; entries: LibraryFileEntry[] }
  | { type: 'libraryIn'; bytes: Uint8Array };

export interface ExportResult {
  zipName: string;
  zip: Uint8Array;
}

export type JobResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: XchangeErrorPayload | { code: 'ui'; key: string } };

const MESH_EXT = new Set(['stl', 'ply', 'obj']);
const meshHint = (ext: string): MeshFormat | undefined => (MESH_EXT.has(ext) ? (ext as MeshFormat) : undefined);
const shown = (mesh: TriMesh): ShownMesh => ({ mesh, normals: computeVertexNormals(mesh) });

/** Adds the file position to an engine error. */
function inFile(error: unknown, n: number, total: number): XchangeError {
  const p = toErrorPayload(error);
  return new XchangeError(p.code, { ...p.details, file: n, files: total });
}

export function readCapture(files: readonly InFile[]): CaptureResult {
  const total = files.length;
  const isMesh = files.map((f) => detectMeshFormat(f.bytes) !== null || MESH_EXT.has(f.extension));
  if (isMesh.filter(Boolean).length > 1) throw new UiError('oneMesh');
  const positionSets: ImplantSite[][] = [];
  const sources: Source[] = [];
  const warnings: XchangeWarning[] = [];
  let format: CaptureFormat | null = null;
  let mesh: TriMesh | undefined;
  let meshFormat: MeshFormat | undefined;
  files.forEach((f, i) => {
    try {
      if (isMesh[i]) {
        const parsed = parseMesh(f.bytes, 'capture', meshHint(f.extension));
        mesh = parsed.mesh;
        meshFormat = parsed.format;
        warnings.push(...parsed.warnings);
      } else {
        const parsed = parsePositions(f.bytes, { extension: f.extension });
        positionSets.push(parsed.sites);
        sources.push({ kind: 'positions', format: parsed.format, count: parsed.sites.length });
        warnings.push(...parsed.warnings);
        format ??= parsed.format;
      }
    } catch (error) {
      throw inFile(error, i + 1, total);
    }
  });
  let sites: ImplantSite[] = [];
  try {
    sites = positionSets.length ? mergePositionFiles(positionSets) : [];
  } catch (error) {
    throw inFile(error, (toErrorPayload(error).details.file as number) || total, total);
  }
  const result: CaptureResult = { sites, sources, format: format ?? meshFormat ?? 'stl', warnings };
  if (mesh) {
    const components = splitComponents(mesh);
    const bodies = components.filter((c) => !c.fragment).length;
    sources.push({ kind: 'mesh', format: meshFormat!, count: bodies });
    const fragments = components.length - bodies;
    if (fragments) warnings.push({ code: 'COMPONENT_FRAGMENTS', details: { count: fragments } });
    if (sites.length) result.sites = linkSitesToComponents(sites, components);
    result.mesh = mesh;
    result.components = components.map((c) => ({ ...shown(c.mesh), fragment: c.fragment }));
  }
  return result;
}

export function detect(mesh: TriMesh, reference: TriMesh): DetectResult {
  const r = recoverSitesFromMesh(mesh, { mesh: reference });
  return { sites: r.sites, unresolved: r.unresolved, warnings: r.warnings };
}

export function readGeometry(file: InFile, sites: readonly ImplantSite[], captureMesh?: TriMesh): GeometryResult {
  const parsed = parseMesh(file.bytes, 'geometry', meshHint(file.extension));
  const plan = sites.length ? planAssembly(parsed.mesh, sites) : ({ kind: 'single' } as const);
  const out: GeometryResult = { ...shown(parsed.mesh), format: parsed.format, plan, warnings: parsed.warnings };
  if (plan.kind === 'fixed' && captureMesh) out.layoutCompatible = verifyAssemblyLayout(captureMesh, parsed.mesh).compatible;
  return out;
}

export function readJaw(file: InFile): JawResult {
  const parsed = parseMesh(file.bytes, 'jaw', meshHint(file.extension));
  if (parsed.format === 'obj') throw new XchangeError('FORMAT_NOT_ALLOWED', { format: 'obj', purpose: 'jaw' });
  return { ...shown(parsed.mesh), originalBytes: file.bytes, format: parsed.format, warnings: parsed.warnings };
}

/** UI-only failures (copy keys under ui.*). */
export class UiError extends Error {
  constructor(readonly key: string) {
    super(key);
  }
}

/** Runs one job; `transfer` collects the buffers the response may move. */
export function runJob(job: JobRequest, transfer: Transferable[]): unknown {
  switch (job.type) {
    case 'readCapture': {
      const r = readCapture(job.files);
      if (r.mesh) transfer.push(r.mesh.positions.buffer, r.mesh.indices.buffer);
      for (const c of r.components ?? []) transfer.push(c.mesh.positions.buffer, c.mesh.indices.buffer, c.normals.buffer);
      return r;
    }
    case 'detect':
      return detect(job.mesh, job.reference);
    case 'readGeometry': {
      const r = readGeometry(job.file, job.sites, job.captureMesh);
      transfer.push(r.normals.buffer);
      return r;
    }
    case 'readJaw': {
      const r = readJaw(job.file);
      transfer.push(r.mesh.positions.buffer, r.mesh.indices.buffer, r.normals.buffer, r.originalBytes.buffer);
      if (r.mesh.colors) transfer.push(r.mesh.colors.buffer);
      return r;
    }
    case 'export': {
      const b = buildBundle(job.request);
      transfer.push(b.zip.buffer);
      return { zipName: b.zipName, zip: b.zip } satisfies ExportResult;
    }
    case 'libraryOut': {
      const bytes = encodeLibraryFile(job.entries);
      transfer.push(bytes.buffer);
      return bytes;
    }
    case 'libraryIn':
      return decodeLibraryFile(job.bytes);
  }
}

export function createJobsHandler(post: (message: JobResponse, transfer: Transferable[]) => void): (message: { id: number; job: JobRequest }) => void {
  return ({ id, job }) => {
    const transfer: Transferable[] = [];
    try {
      const result = runJob(job, transfer);
      post({ id, ok: true, result }, [...new Set(transfer)]);
    } catch (error) {
      const ui = error instanceof UiError ? error.key : error instanceof LibraryFileError ? error.code : null;
      post({ id, ok: false, error: ui ? { code: 'ui', key: ui } : toErrorPayload(error) }, []);
    }
  };
}
