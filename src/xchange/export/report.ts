/**
 * report.json (schema v1, CONTRACTS.md section 5) and README.txt (Spanish, then English, CRLF).
 * Both are built from whitelisted request fields only, so nothing a caller attaches to the request
 * objects (a file name, say) can reach them.
 *
 * Throws INVALID_ARGUMENT {reason}: 'arch' | 'createdAt' | 'appVersion' | 'noSites' |
 * 'duplicateSiteId' (+ site index) | 'jawFormat' | 'jawBytes' | 'alignmentWithoutJaw' |
 * 'alignmentSite' (+ perSite index) | 'files' (placed/files do not match the request).
 */
import { XchangeError } from '../core/errors';
import { identity, maxAbsDiff, toRowMajorArray } from '../core/mat4';
import { countTriangles } from '../core/mesh';
import type { AlignmentFlag, AlignmentMethod, AlignmentStatus, Arch, CaptureFormat, ExportRequest } from '../core/types';
import type { PlacedReplacement } from './placement';
import { crc32, type BundleFile } from './zip';

export type CoordinateFrame = 'jaw' | 'capture' | 'capture-adjusted';

export interface ExportReport {
  schema: 'ddt-xchange-report';
  schemaVersion: 1;
  application: 'DDT Xchange';
  appVersion: string;
  createdAt: string;
  units: 'mm';
  matrixConvention: string;
  implantFrame: string;
  arch: Arch;
  /** jaw present -> 'jaw'; otherwise identity assembly -> 'capture', moved -> 'capture-adjusted'. */
  coordinateFrame: CoordinateFrame;
  captureToOutput: number[];
  capture: { format: CaptureFormat; siteCount: number };
  alignment: {
    method: AlignmentMethod;
    status: AlignmentStatus;
    rmsMm: number;
    p95Mm: number;
    coverage: number;
    toleranceMm: number;
    flags: AlignmentFlag[];
    /** The exported pose is the measured one (max element difference <= 1e-9). */
    matchesExport: boolean;
    perSite: { siteId: string; label: string; rmsMm: number; coverage: number; samples: number }[];
  } | null;
  sites: {
    id: string;
    label: string;
    source: CaptureFormat;
    indexAmbiguous: boolean;
    provisional: boolean;
    implantToCapture: number[];
    implantToOutput: number[];
    geometry: { id: string; name: string };
    file: string;
  }[];
  jaw: {
    file: string;
    format: 'stl' | 'ply';
    preservation: 'exact-original-bytes';
    bytes: number;
    crc32: string;
    triangles: number;
  } | null;
  /** Every bundle entry except report.json and README.txt. */
  files: { name: string; bytes: number; crc32: string }[];
  notes: string[];
}

/** Two matrices closer than this (per element; mm for translations) are the same transform. */
const SAME_TRANSFORM = 1e-9;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

const NOTES = {
  shells:
    'combined.stl and replacements.stl concatenate independent shells: no Boolean union, no trimming of the scanned bodies; overlaps are possible.',
  visual: 'Check every implant visually against the scans before using these files.',
  indexAmbiguous:
    'At least one implant has an ambiguous index (indexAmbiguous): its rotation about the implant axis is arbitrary.',
  provisional:
    'At least one implant frame is provisional (provisional): it comes from a fit that did not pass every check.',
  adjusted: 'No jaw scan: the output is in capture coordinates moved by the manual adjustment (captureToOutput).',
  poseChanged:
    'The exported pose is not the measured alignment pose (matchesExport false): the alignment metrics do not describe these files.',
  clinical:
    'A geometric fit is not a clinical validation: confirm units, connection, index and the result before any clinical or manufacturing use.',
} as const;

function invalid(reason: string, extra: Record<string, number> = {}): XchangeError {
  return new XchangeError('INVALID_ARGUMENT', { reason, ...extra });
}

function checkRequest({ arch, createdAt, appVersion, sites, jaw, alignment }: ExportRequest): void {
  if (arch !== 'upper' && arch !== 'lower') throw invalid('arch');
  if (!ISO_TIME.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) throw invalid('createdAt');
  if (!APP_VERSION.test(appVersion)) throw invalid('appVersion');
  if (sites.length === 0) throw invalid('noSites');
  const ids = new Set<string>();
  sites.forEach((site, index) => {
    if (ids.has(site.id)) throw invalid('duplicateSiteId', { site: index });
    ids.add(site.id);
  });
  if (jaw && jaw.format !== 'stl' && jaw.format !== 'ply') throw invalid('jawFormat');
  if (jaw && !(jaw.originalBytes.length > 0)) throw invalid('jawBytes');
  if (alignment && !jaw) throw invalid('alignmentWithoutJaw');
  alignment?.perSite.forEach((fit, index) => {
    if (!ids.has(fit.siteId)) throw invalid('alignmentSite', { index });
  });
}

const hex = (crc: number): string => crc.toString(16).padStart(8, '0');

/**
 * `placed` = placeReplacements(...) for request.sites; `files` = the data entries in bundle order:
 * combined.stl, replacements.stl, one STL per site (site order), then the jaw entry holding
 * request.jaw.originalBytes itself.
 */
export function buildReport(
  request: ExportRequest,
  placed: readonly PlacedReplacement[],
  files: readonly BundleFile[],
): ExportReport {
  checkRequest(request);
  const { sites, jaw, alignment, assemblyTransform } = request;
  const jawEntry = jaw ? files[2 + sites.length] : undefined;
  if (
    placed.length !== sites.length ||
    placed.some((p, i) => p.siteId !== sites[i]!.id) ||
    files.length !== 2 + sites.length + (jaw ? 1 : 0) ||
    (jaw && (jawEntry?.name !== `jaw.${jaw.format}` || jawEntry.bytes !== jaw.originalBytes))
  ) {
    throw invalid('files');
  }
  // ponytail: zipStore computes these CRCs again (~0.7 s for a 300 MB bundle); pass them through if that matters.
  const fileInfo = files.map((f) => ({ name: f.name, bytes: f.bytes.length, crc32: hex(crc32(f.bytes)) }));
  const coordinateFrame: CoordinateFrame = jaw
    ? 'jaw'
    : maxAbsDiff(assemblyTransform, identity()) <= SAME_TRANSFORM
      ? 'capture'
      : 'capture-adjusted';
  const matchesExport = alignment ? maxAbsDiff(alignment.transform, assemblyTransform) <= SAME_TRANSFORM : false;
  const labelOf = new Map(sites.map((s) => [s.id, s.label]));

  const notes: string[] = [NOTES.shells, NOTES.visual];
  if (sites.some((s) => s.flags.indexAmbiguous === true)) notes.push(NOTES.indexAmbiguous);
  if (sites.some((s) => s.flags.provisional === true)) notes.push(NOTES.provisional);
  if (coordinateFrame === 'capture-adjusted') notes.push(NOTES.adjusted);
  if (alignment && !matchesExport) notes.push(NOTES.poseChanged);
  notes.push(NOTES.clinical);

  return {
    schema: 'ddt-xchange-report',
    schemaVersion: 1,
    application: 'DDT Xchange',
    appVersion: request.appVersion,
    createdAt: request.createdAt,
    units: 'mm',
    matrixConvention: "4x4 row-major, column vectors: p' = M·p",
    implantFrame: 'origin = connection, +Z = implant axis, +X = indexed direction',
    arch: request.arch,
    coordinateFrame,
    captureToOutput: toRowMajorArray(assemblyTransform),
    capture: { format: request.captureFormat, siteCount: sites.length },
    alignment: alignment
      ? {
          method: alignment.method,
          status: alignment.status,
          rmsMm: alignment.rmsMm,
          p95Mm: alignment.p95Mm,
          coverage: alignment.coverage,
          toleranceMm: alignment.toleranceMm,
          flags: [...alignment.flags],
          matchesExport,
          perSite: alignment.perSite.map((fit) => ({
            siteId: fit.siteId,
            label: labelOf.get(fit.siteId)!,
            rmsMm: fit.rmsMm,
            coverage: fit.coverage,
            samples: fit.samples,
          })),
        }
      : null,
    sites: sites.map((site, i) => ({
      id: site.id,
      label: site.label,
      source: site.source,
      indexAmbiguous: site.flags.indexAmbiguous === true,
      provisional: site.flags.provisional === true,
      implantToCapture: toRowMajorArray(site.matrix),
      implantToOutput: toRowMajorArray(placed[i]!.matrix),
      geometry: { id: placed[i]!.geometryId, name: placed[i]!.geometryName },
      file: files[2 + i]!.name,
    })),
    jaw: jaw
      ? {
          file: `jaw.${jaw.format}`,
          format: jaw.format,
          preservation: 'exact-original-bytes',
          bytes: jaw.originalBytes.length,
          crc32: fileInfo[2 + sites.length]!.crc32,
          triangles: countTriangles(jaw.mesh),
        }
      : null,
    files: fileInfo,
    notes,
  };
}

interface ReadmeText {
  title: (arch: Arch) => string;
  created: (at: string, version: string) => string;
  decimal: string;
  headings: { files: string; frame: string; alignment: string; limits: string };
  combined: { jaw: string; noJaw: string };
  replacements: string;
  perSite: string;
  jaw: (file: string) => string;
  report: string;
  readme: string;
  frame: Record<CoordinateFrame, string>;
  units: string;
  matrices: string;
  method: Record<AlignmentMethod, string>;
  status: Record<AlignmentStatus, string>;
  fit: (rms: string, p95: string, coverage: string, tolerance: string) => string;
  noAlignment: string;
  poseChanged: string;
  limits: { shells: string; colors: string; visual: string; indexAmbiguous: string; provisional: string; clinical: string };
  privacy: string;
}

const ES: ReadmeText = {
  title: (arch) => `DDT Xchange: exportación de la arcada ${arch === 'upper' ? 'superior' : 'inferior'}`,
  created: (at, version) => `Creado el ${at} con DDT Xchange ${version}.`,
  decimal: ',',
  headings: { files: 'Archivos', frame: 'Coordenadas', alignment: 'Alineación', limits: 'Límites' },
  combined: {
    jaw: 'combined.stl: superficie del escaneo de la arcada más todas las geometrías de reemplazo colocadas.',
    noJaw: 'combined.stl: todas las geometrías de reemplazo colocadas; sin escaneo de la arcada es igual a replacements.stl.',
  },
  replacements: 'replacements.stl: todas las geometrías de reemplazo colocadas, sin el escaneo.',
  perSite: 'Un archivo por implante, en el orden de la captura:',
  jaw: (file) => `${file}: copia exacta, byte a byte, del escaneo de la arcada importado.`,
  report: 'report.json: datos de colocación (matriz 4x4 de cada implante, alineación, CRC-32 de cada archivo).',
  readme: 'README.txt: este archivo.',
  frame: {
    jaw: 'Coordenadas del escaneo de la arcada: el escaneo no se movió y las geometrías se colocaron con captureToOutput (report.json).',
    capture: 'Coordenadas de la captura: no se importó un escaneo de la arcada.',
    'capture-adjusted':
      'Coordenadas de la captura movidas por el ajuste manual (captureToOutput en report.json): no se importó un escaneo de la arcada.',
  },
  units: 'Unidades: milímetros. No se convirtió ni se escaló nada; el formato STL no guarda unidades.',
  matrices:
    "Matrices 4x4 por filas (row-major), p' = M·p. Marco del implante: origen en la conexión, +Z en el eje del implante, +X hacia la dirección indexada.",
  method: { auto: 'Alineación automática', landmarks: 'Alineación por puntos guiados', manual: 'Alineación manual' },
  status: { good: 'buena', acceptable: 'aceptable', weak: 'débil', ambiguous: 'ambigua', failed: 'fallida' },
  fit: (rms, p95, coverage, tolerance) =>
    `RMS ${rms} mm, p95 ${p95} mm; el ${coverage} % de la superficie alineada queda a ${tolerance} mm o menos del escaneo.`,
  noAlignment: 'Sin alineación registrada.',
  poseChanged: 'La posición exportada no es la de esta alineación: sus métricas no describen estos archivos.',
  limits: {
    shells:
      'combined.stl y replacements.stl concatenan superficies independientes: no hay unión booleana ni recorte de los cuerpos escaneados, y puede haber solapes.',
    colors: 'El formato STL no guarda colores, texturas ni el mapa de desviación.',
    visual: 'Revise visualmente cada implante contra los escaneos antes de usar estos archivos.',
    indexAmbiguous:
      'Al menos un implante tiene el índice ambiguo: su giro alrededor del eje es arbitrario (indexAmbiguous en report.json).',
    provisional:
      'Al menos un marco de implante es provisional: viene de un ajuste que no pasó todas las comprobaciones (provisional en report.json).',
    clinical:
      'Un ajuste geométrico no es una validación clínica ni de fabricación. Confirme unidades, conexión, índice y resultado antes de cualquier uso clínico.',
  },
  privacy: 'Privacidad: este paquete se creó en su navegador; ningún archivo salió de su equipo y no se guardó ningún nombre de archivo.',
};

const EN: ReadmeText = {
  title: (arch) => `DDT Xchange: ${arch} arch export`,
  created: (at, version) => `Created ${at} with DDT Xchange ${version}.`,
  decimal: '.',
  headings: { files: 'Files', frame: 'Coordinates', alignment: 'Alignment', limits: 'Limits' },
  combined: {
    jaw: 'combined.stl: the jaw scan surface plus every placed replacement geometry.',
    noJaw: 'combined.stl: every placed replacement geometry; without a jaw scan it equals replacements.stl.',
  },
  replacements: 'replacements.stl: every placed replacement geometry, without the scan.',
  perSite: 'One file per implant, in capture order:',
  jaw: (file) => `${file}: exact byte-for-byte copy of the imported jaw scan.`,
  report: 'report.json: placement data (4x4 matrix of every implant, alignment, CRC-32 of every file).',
  readme: 'README.txt: this file.',
  frame: {
    jaw: 'Jaw scan coordinates: the scan was not moved and the geometries were placed with captureToOutput (report.json).',
    capture: 'Capture coordinates: no jaw scan was imported.',
    'capture-adjusted':
      'Capture coordinates moved by the manual adjustment (captureToOutput in report.json): no jaw scan was imported.',
  },
  units: 'Units: millimeters. Nothing was converted or scaled; STL files do not store units.',
  matrices:
    "Matrices: 4x4 row-major, p' = M·p. Implant frame: origin at the connection, +Z along the implant axis, +X towards the indexed direction.",
  method: { auto: 'Automatic alignment', landmarks: 'Guided-point alignment', manual: 'Manual alignment' },
  status: { good: 'good', acceptable: 'acceptable', weak: 'weak', ambiguous: 'ambiguous', failed: 'failed' },
  fit: (rms, p95, coverage, tolerance) =>
    `RMS ${rms} mm, p95 ${p95} mm; ${coverage} % of the aligned surface lies within ${tolerance} mm of the scan.`,
  noAlignment: 'No alignment recorded.',
  poseChanged: "The exported pose is not this alignment's pose: its metrics do not describe these files.",
  limits: {
    shells:
      'combined.stl and replacements.stl concatenate independent surfaces: no Boolean union, no trimming of the scanned bodies, and overlaps are possible.',
    colors: 'STL files do not store colors, textures or the deviation map.',
    visual: 'Check every implant visually against the scans before using these files.',
    indexAmbiguous:
      'At least one implant has an ambiguous index: its rotation about the implant axis is arbitrary (indexAmbiguous in report.json).',
    provisional:
      'At least one implant frame is provisional: it comes from a fit that did not pass every check (provisional in report.json).',
    clinical:
      'A geometric fit is not a clinical or manufacturing validation. Confirm units, connection, index and the result before any clinical use.',
  },
  privacy: 'Privacy: this bundle was created in your browser; no file left your computer and no file name was stored.',
};

function readmeSection(t: ReadmeText, r: ExportReport): string[] {
  const num = (value: number, digits: number): string =>
    Number.isFinite(value) ? value.toFixed(digits).replace('.', t.decimal) : '-';
  const title = t.title(r.arch);
  const a = r.alignment;
  const limits = [
    t.limits.shells,
    t.limits.colors,
    t.limits.visual,
    ...(r.sites.some((s) => s.indexAmbiguous) ? [t.limits.indexAmbiguous] : []),
    ...(r.sites.some((s) => s.provisional) ? [t.limits.provisional] : []),
    t.limits.clinical,
  ];
  return [
    title,
    '='.repeat(title.length),
    t.created(r.createdAt, r.appVersion),
    '',
    t.headings.files,
    `- ${r.jaw ? t.combined.jaw : t.combined.noJaw}`,
    `- ${t.replacements}`,
    `- ${t.perSite}`,
    ...r.sites.map((s) => `    ${s.file}`),
    ...(r.jaw ? [`- ${t.jaw(r.jaw.file)}`] : []),
    `- ${t.report}`,
    `- ${t.readme}`,
    '',
    t.headings.frame,
    t.frame[r.coordinateFrame],
    t.units,
    t.matrices,
    '',
    t.headings.alignment,
    a
      ? `${t.method[a.method]}: ${t.status[a.status]}. ${t.fit(num(a.rmsMm, 3), num(a.p95Mm, 3), num(a.coverage * 100, 1), num(a.toleranceMm, 3))}`
      : t.noAlignment,
    ...(a && !a.matchesExport ? [t.poseChanged] : []),
    '',
    t.headings.limits,
    ...limits.map((line) => `- ${line}`),
    '',
    t.privacy,
  ];
}

/** README.txt text: Spanish, then English, CRLF line endings. Uses only report fields. */
export function buildReadme(report: ExportReport): string {
  return [...readmeSection(ES, report), '', '', ...readmeSection(EN, report), ''].join('\r\n');
}
