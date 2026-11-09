/**
 * Shared data types for DDT Xchange.
 *
 * Conventions (every module):
 * - Units are millimetres. Nothing is ever converted.
 * - Mat4 is a 4x4 ROW-MAJOR rigid transform acting on column vectors: p' = M·[p; 1].
 *   Element (row r, column c) is m[r * 4 + c]; the translation is m[3], m[7], m[11].
 * - Implant frame: origin = connection point, +Z = implant axis (from the connection towards
 *   the top of the body), +X = indexed direction, +Y = Z × X. Columns 0/1/2 of an implant
 *   matrix are the frame's X/Y/Z axes in capture coordinates, column 3 is the origin.
 * - No type below carries a file name. Keep it that way (privacy: names can hold patient data).
 */

export type Vec3 = [number, number, number];

/** 4x4 row-major rigid transform, length 16. */
export type Mat4 = Float64Array;

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** Indexed triangle mesh. Producers never alias the input file buffer. */
export interface TriMesh {
  /** x, y, z per vertex (mm). */
  positions: Float32Array;
  /** 3 vertex indices per triangle, counter-clockwise seen from outside. */
  indices: Uint32Array;
  /** Optional r, g, b per vertex (0-255); same vertex count as positions. */
  colors?: Uint8Array;
}

export type Arch = 'upper' | 'lower';

export type MeshFormat = 'stl' | 'ply' | 'obj';

/** What an imported mesh is for. Selects limits and allowed formats (core/limits.ts). */
export type MeshPurpose = 'jaw' | 'capture' | 'geometry';

export type PositionFormat =
  | 'micronmapper-csv' // MicronMapper V1.4 / V1.6 native CSV, marker rows of one family (AXO#, AHY#, BTH#...)
  | 'scanadaptor-xml' // <ScanAdaptor><ToothNumber/><Mat0..Mat3/></ScanAdaptor>
  | 'matrix-table' // generic CSV/TXT table: Mat0..Mat3, m00..m33 or marker+origin/axis/indexed
  | 'positions-json' // named row-major mm matrices in JSON
  | 'matrix-xml' // <ImplantPositions><Position><Matrix4x4/></Position></ImplantPositions>
  | 'icam-txt'; // iCam TransformedPoints: <name>_Origin/_X/_Y/_Z lines

export type CaptureFormat = PositionFormat | MeshFormat | 'demo';

export interface SiteFlags {
  /** Rotation about +Z is unknown (rotationally symmetric body). Reported, never hidden. */
  indexAmbiguous?: boolean;
  /** Frame recovered by a fit that did not pass every check; the user must confirm it. */
  provisional?: boolean;
}

export interface ImplantSite {
  /** Stable id within a case: 'site-1', 'site-2', ... in source order. */
  id: string;
  /** Marker id / tooth number read from the file (1-40 chars), or 'Implant N'. Never a file name. */
  label: string;
  /** Implant frame -> capture coordinates. Always passed through validateRigid. */
  matrix: Mat4;
  source: CaptureFormat;
  flags: SiteFlags;
  /** Index into detect.splitComponents(capture.mesh) of the component holding this body's scan. */
  componentIndex?: number;
}

export interface Capture {
  arch: Arch;
  sites: ImplantSite[];
  /** Scanned scan bodies as one mesh, capture coordinates (mesh captures, or a mesh sent with a position file). */
  mesh?: TriMesh;
  format: CaptureFormat;
}

/** A body whose mesh is expressed in the implant frame (see header). */
export interface ReferenceBody {
  mesh: TriMesh;
}

/** Library geometry placed at every implant it is assigned to. */
export interface ReplacementGeometry extends ReferenceBody {
  id: string;
  /** Name the user gave the library entry. */
  name: string;
}

export interface JawScan {
  mesh: TriMesh;
  /** The imported file, byte for byte; exported unchanged as jaw.stl / jaw.ply. */
  originalBytes: Uint8Array;
  format: 'stl' | 'ply';
}

/** The surface that represents one implant during alignment, in capture coordinates. */
export interface AssemblyPart {
  siteId: string;
  mesh: TriMesh;
}

/** One guided click: a point on the assembly (capture coords) and where it lies on the jaw (jaw coords). */
export interface LandmarkPair {
  source: Vec3;
  target: Vec3;
}

export type AlignmentStatus = 'good' | 'acceptable' | 'weak' | 'ambiguous' | 'failed';

export type AlignmentMethod = 'auto' | 'landmarks' | 'manual';

export type AlignmentFlag =
  | 'visualCheckRequired' // always set: a surface fit is not a clinical validation
  | 'notConverged'
  | 'ambiguousAlternative' // another pose, more than the tolerance away, scored almost as well
  | 'symmetricSource' // the assembly surface is (nearly) rotationally symmetric
  | 'fewCorrespondences'
  | 'landmarkTranslationOnly' // 1 landmark, no surface refinement
  | 'landmarkAxisFree' // 2 or collinear landmarks: roll about their line is free
  | 'manualPose'; // metrics measured on a pose the user placed by hand

/**
 * Metrics on the part of the bodies the jaw scan can judge (align/metrics.ts): a sample more than 3 tolerances
 * behind the scanned surface (under the gum) is hidden and left out; one in front of it counts as a miss.
 */
export interface SiteFit {
  siteId: string;
  /** RMS of the visible samples' distances, each capped at 3 tolerances. */
  rmsMm: number;
  /** Fraction (0-1) of this site's visible samples within AlignmentResult.toleranceMm of the jaw. */
  coverage: number;
  /** Fraction (0-1) of this site's samples that are visible (not hidden behind the scan). */
  visible: number;
  samples: number;
}

export interface AlignmentResult {
  /** capture -> jaw coordinates. The jaw never moves. */
  transform: Mat4;
  method: AlignmentMethod;
  /** On the visible samples of every site, as SiteFit. */
  rmsMm: number;
  p95Mm: number;
  /** Fraction (0-1) of the visible samples within toleranceMm of the jaw surface. */
  coverage: number;
  /** Fraction (0-1) of all samples that are visible. */
  visible: number;
  toleranceMm: number;
  perSite: SiteFit[];
  status: AlignmentStatus;
  flags: AlignmentFlag[];
}

export interface ExportRequest {
  arch: Arch;
  captureFormat: CaptureFormat;
  sites: readonly ImplantSite[];
  /** Replacement geometry for every site id. */
  geometryBySite: Readonly<Record<string, ReplacementGeometry>>;
  /** capture -> output coordinates: capture->jaw with a jaw; identity without one unless the user moved the assembly. */
  assemblyTransform: Mat4;
  jaw?: JawScan;
  /** Last alignment shown to the user, if any. */
  alignment?: AlignmentResult;
  /** ISO 8601 time written to report.json (passed in so bundles are reproducible). */
  createdAt: string;
  appVersion: string;
}
