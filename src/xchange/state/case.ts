/**
 * Case state of the wizard (UI-DESIGN §5.1) and the pure rules around it: cross-file merge, gating,
 * alignment parts, guided targets, per-site status, the re-measure method rule and export gating.
 * No DOM, no workers: everything here is unit-tested.
 */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { identity, inverseRigid, maxAbsDiff } from '../core/mat4';
import { transformMesh } from '../core/mesh';
import type { AlignmentFlag, AlignmentResult, Arch, AssemblyPart, CaptureFormat, ImplantSite, JawScan, Mat4, MatchedBody, ReplacementGeometry, SiteFit, TriMesh } from '../core/types';
import { DEFAULT_QUALITY, grade, type QualityThresholds } from '../align/metrics';
import { orderSitesAlongArch } from '../align/landmarks';
import { CAPTURE_BODY_ID } from '../export/report';

export type Step = 1 | 2 | 3 | 4;
export type Surfaces = 'replacement' | 'capture';

/** One imported source, never with a name. */
export interface Source {
  kind: 'positions' | 'mesh';
  format: CaptureFormat;
  count: number;
}

/**
 * A geometry that lives only in this case: the sample body, a positioned assembly, or (kind 'capture', "No exchange")
 * a site's own body from the positions file, in its implant frame.
 */
export interface CaseGeometry extends ReplacementGeometry {
  kind: 'sample' | 'assembly' | 'capture';
  /** Assembly entries of one file share a group and show as one library row. */
  group: string;
}

/**
 * The bodies an alignment was made with, and is measured with afterwards (UI-DESIGN §5.2): the surfaces choice and
 * each site's geometry at that moment. A later exchange only changes what is exported.
 */
export interface AlignedWith {
  surfaces: Surfaces;
  geometryBySite: Readonly<Record<string, string>>;
}

export interface CaseState {
  arch: Arch | null;
  sources: Source[];
  format: CaptureFormat | null;
  /** Merged, ids site-1..n. */
  sites: ImplantSite[];
  captureMesh: TriMesh | null;
  /** splitComponents(captureMesh) meshes, indexed like site.componentIndex. */
  components: TriMesh[];
  /** Mesh-only capture still waiting for its capture scan body. */
  needsReference: boolean;
  referenceId: string | null;
  unresolved: number[];
  confirmed: Set<string>;
  excluded: Set<string>;
  /** site id -> geometry id (library or case-only). */
  geometryBySite: Record<string, string>;
  caseGeometries: Map<string, CaseGeometry>;
  jaw: JawScan | null;
  jawColors: boolean;
  jawSkipped: boolean;
  surfaces: Surfaces;
  /** capture -> jaw; identity without a jaw. */
  assembly: Mat4;
  /** Last result applied to `assembly`. */
  alignment: AlignmentResult | null;
  /** The bodies `alignment` was made and is measured with; set and cleared with it. */
  alignedWith: AlignedWith | null;
  /** A failed attempt, shown greyed and never applied. */
  lastAttempt: AlignmentResult | null;
  lastAlignedPose: Mat4 | null;
  undo: Mat4[];
  deviation: Map<string, Float32Array> | null;
  measuring: boolean;
  step: Step;
  sample: boolean;
  exportedSinceChange: boolean;
}

export const UNDO_LIMIT = 20;
export const CROSS_FILE_TOLERANCE = 1e-7;

export function freshCase(arch: Arch | null = null): CaseState {
  return {
    arch, sources: [], format: null, sites: [], captureMesh: null, components: [], needsReference: false, referenceId: null,
    unresolved: [], confirmed: new Set(), excluded: new Set(), geometryBySite: {}, caseGeometries: new Map(), jaw: null,
    jawColors: false, jawSkipped: false, surfaces: 'replacement', assembly: identity(), alignment: null, alignedWith: null, lastAttempt: null,
    lastAlignedPose: null, undo: [], deviation: null, measuring: false, step: 1, sample: false, exportedSinceChange: false,
  };
}

/** Tiny observable holder: set() merges a patch and notifies once. */
export class Store<T extends object> {
  private readonly listeners = new Set<(state: T, patch: Partial<T>) => void>();
  constructor(public state: T) {}
  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state, patch);
  }
  subscribe(fn: (state: T, patch: Partial<T>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/**
 * Merges several parsed position files (file order, then row order) and renumbers ids site-1..n.
 * The same label in two files is kept once when the matrices agree within 1e-7, else LABEL_DUPLICATE
 * reason 'crossFile' (`file` = 1-based index of the later file).
 */
export function mergePositionFiles(files: readonly (readonly ImplantSite[])[], limit: number = LIMITS.positions.maxPositions): ImplantSite[] {
  const byLabel = new Map<string, ImplantSite>();
  const out: ImplantSite[] = [];
  files.forEach((sites, f) => {
    for (const site of sites) {
      const seen = byLabel.get(site.label);
      if (seen) {
        if (maxAbsDiff(seen.matrix, site.matrix) <= CROSS_FILE_TOLERANCE) continue;
        throw new XchangeError('LABEL_DUPLICATE', { reason: 'crossFile', file: f + 1 });
      }
      byLabel.set(site.label, site);
      out.push(site);
    }
  });
  if (out.length > limit) throw new XchangeError('TOO_MANY_POSITIONS', { limit });
  return out.map((s, i) => ({ ...s, id: `site-${i + 1}`, flags: { ...s.flags } }));
}

export const activeSites = (s: Pick<CaseState, 'sites' | 'excluded'>): ImplantSite[] => s.sites.filter((x) => !s.excluded.has(x.id));
export const pendingProvisional = (s: Pick<CaseState, 'sites' | 'excluded' | 'confirmed'>): ImplantSite[] =>
  s.sites.filter((x) => x.flags.provisional && !s.confirmed.has(x.id) && !s.excluded.has(x.id));

/** Why step 1 is not done yet (copy key in s1.*), or null. */
export function step1Blocker(s: CaseState): 'needArch' | 'needCapture' | 'needReference' | 'needConfirm' | null {
  if (!s.arch) return 'needArch';
  if (s.needsReference) return 'needReference';
  if (activeSites(s).length === 0) return 'needCapture';
  if (pendingProvisional(s).length) return 'needConfirm';
  return null;
}

/** Active implants without a geometry. */
export const missingGeometry = (s: CaseState): number => activeSites(s).filter((x) => !s.geometryBySite[x.id]).length;
export const step2Done = (s: CaseState): boolean => step1Blocker(s) === null && missingGeometry(s) === 0;

export function reachable(s: CaseState, step: Step): boolean {
  if (step === 1) return true;
  if (step === 2) return step1Blocker(s) === null;
  return step2Done(s);
}

/** True when every active site has a captured shell, so 'capture' surfaces can be matched. */
export const canMatchCapture = (sites: readonly ImplantSite[], components: readonly TriMesh[]): boolean =>
  sites.length > 0 && sites.every((x) => x.componentIndex !== undefined && components[x.componentIndex] !== undefined);

/**
 * The surfaces that stand for each implant during alignment, in capture coordinates: the replacement
 * geometry placed at the site, or the captured shell. Sites without a surface are skipped.
 */
export function alignmentParts(
  sites: readonly ImplantSite[],
  geometryOf: (siteId: string) => TriMesh | undefined,
  components: readonly TriMesh[],
  surfaces: Surfaces,
): AssemblyPart[] {
  const parts: AssemblyPart[] = [];
  for (const site of sites) {
    if (surfaces === 'capture') {
      const mesh = site.componentIndex === undefined ? undefined : components[site.componentIndex];
      if (mesh) parts.push({ siteId: site.id, mesh });
    } else {
      const g = geometryOf(site.id);
      if (g) parts.push({ siteId: site.id, mesh: transformMesh(g, site.matrix) });
    }
  }
  return parts;
}

/** The choice in place now: what the next alignment (auto, refine, guided) is made with. */
export const chosenBodies = (s: Pick<CaseState, 'surfaces' | 'geometryBySite'>): AlignedWith => ({ surfaces: s.surfaces, geometryBySite: s.geometryBySite });
/** What a re-measure and the color map use: the alignment's bodies, else the choice in place (a first pose moved by hand). */
export const measuredBodies = (s: Pick<CaseState, 'surfaces' | 'geometryBySite' | 'alignedWith'>): AlignedWith => s.alignedWith ?? chosenBodies(s);

/** Case-geometry id of a site's own captured body ("No exchange"). */
export const captureGeometryId = (siteId: string): string => `capture:${siteId}`;

/**
 * "No exchange": each site's own body from the positions file, in its implant frame (placed at the site it is the
 * captured shell again), keyed by site id. Sites without a captured body are skipped.
 */
export function capturedBodies(sites: readonly ImplantSite[], components: readonly TriMesh[], name: string): Map<string, CaseGeometry> {
  const out = new Map<string, CaseGeometry>();
  for (const site of sites) {
    const mesh = site.componentIndex === undefined ? undefined : components[site.componentIndex];
    if (mesh) out.set(site.id, { id: captureGeometryId(site.id), name, mesh: transformMesh(mesh, inverseRigid(site.matrix)), kind: 'capture', group: 'capture' });
  }
  return out;
}

type BodyState = Pick<CaseState, 'sites' | 'excluded' | 'geometryBySite' | 'caseGeometries' | 'alignment' | 'alignedWith'>;

/** A geometry id as a body: CAPTURE_BODY_ID for a site's own captured body ("No exchange"), else the id itself. */
export const bodyOf = (s: Pick<CaseState, 'caseGeometries'>, geometryId: string | undefined): string | undefined =>
  geometryId !== undefined && s.caseGeometries.get(geometryId)?.kind === 'capture' ? CAPTURE_BODY_ID : geometryId;

/** The body a site was aligned with (CAPTURE_BODY_ID or a geometry id); undefined without an alignment. */
export function alignedBody(s: BodyState, siteId: string): string | undefined {
  const w = s.alignedWith;
  if (!s.alignment || !w) return undefined;
  return w.surfaces === 'capture' ? CAPTURE_BODY_ID : bodyOf(s, w.geometryBySite[siteId]);
}

/** Active sites whose exported body is not the one they were aligned with: an exchange after the alignment. */
export function exchangedSites(s: BodyState): ImplantSite[] {
  if (!s.alignment || !s.alignedWith) return [];
  return activeSites(s).filter((x) => alignedBody(s, x.id) !== bodyOf(s, s.geometryBySite[x.id]));
}

/**
 * The color map as it can be drawn: on the captured shells after a 'capture' alignment, else on the parts that are
 * still the aligned ones (an exchanged part shows no map). null when nothing is left to draw.
 */
export function shownDeviation(s: BodyState & Pick<CaseState, 'deviation'>): Map<string, Float32Array> | null {
  const dev = s.deviation;
  if (!dev || s.alignedWith?.surfaces === 'capture') return dev;
  const gone = new Set(exchangedSites(s).map((x) => x.id));
  if (!gone.size) return dev;
  const kept = new Map([...dev].filter(([id]) => !gone.has(id)));
  return kept.size ? kept : null;
}

/** report.json alignment.perSite[].matchedWith: per active site, the body its alignment used (the exported one without an alignment). */
export function matchedBodies(s: BodyState, nameOf: (geometryId: string) => string, captureName: string): Record<string, MatchedBody> {
  const out: Record<string, MatchedBody> = {};
  for (const site of activeSites(s)) {
    const id = alignedBody(s, site.id) ?? bodyOf(s, s.geometryBySite[site.id]);
    if (id !== undefined) out[site.id] = { id, name: id === CAPTURE_BODY_ID ? captureName : nameOf(id) };
  }
  return out;
}

/** Where a pick for all implants goes on to: back to step 4 once step 3 is done (a jaw, or export without one), else step 3. */
export const stepAfterGeometry = (s: Pick<CaseState, 'jaw' | 'jawSkipped'>): Step => (s.jaw || s.jawSkipped ? 4 : 3);

/** Guided targets 1-2-3-4: all sites when 4 or fewer, else four spread along the arch. */
export function guidedTargets(sites: readonly ImplantSite[]): ImplantSite[] {
  const ordered = orderSitesAlongArch(sites);
  const n = ordered.length;
  if (n <= 4) return ordered;
  const picks = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return [...new Set(picks)].map((i) => ordered[i]!);
}

export type SiteStatus = 'good' | 'acceptable' | 'weak' | 'poor';
/** One implant's status: the set's grade, 'poor' below siteUsableCoverage. */
export function siteStatus(fit: Pick<SiteFit, 'rmsMm' | 'coverage' | 'visible'>, q: QualityThresholds = DEFAULT_QUALITY): SiteStatus {
  return fit.coverage < q.siteUsableCoverage ? 'poor' : grade(fit, q);
}

const METHOD_FLAGS: readonly AlignmentFlag[] = ['landmarkTranslationOnly', 'landmarkAxisFree', 'ambiguousAlternative', 'notConverged', 'fewCorrespondences'];

/**
 * A re-measure (method 'manual' + 'manualPose') is kept as is only when the pose was moved by hand.
 * Otherwise the previous method and method flags stay and only metrics, perSite, status and
 * 'symmetricSource' come from the measurement, so an automatic pose is never reported as manual.
 */
export function mergeMeasured(previous: AlignmentResult | null, measured: AlignmentResult, poseMoved: boolean): AlignmentResult {
  if (poseMoved || !previous) return measured;
  const flags = new Set<AlignmentFlag>(['visualCheckRequired']);
  for (const f of previous.flags) if (METHOD_FLAGS.includes(f)) flags.add(f);
  if (measured.flags.includes('symmetricSource')) flags.add('symmetricSource');
  const status = previous.status === 'ambiguous' && measured.status !== 'failed' ? 'ambiguous' : measured.status;
  return { ...measured, method: previous.method, flags: [...flags], status };
}

export const pushUndo = (stack: readonly Mat4[], pose: Mat4): Mat4[] => [...stack, Float64Array.from(pose)].slice(-UNDO_LIMIT);

/** Why export is blocked right now, or null. */
export function exportBlocker(s: CaseState): 'geometry' | 'notAligned' | 'measuring' | null {
  if (missingGeometry(s) > 0 || activeSites(s).length === 0) return 'geometry';
  if (s.jaw && !s.alignment) return 'notAligned';
  if (s.measuring) return 'measuring';
  return null;
}

/** The case holds work that would be lost by leaving. */
export const hasWork = (s: CaseState): boolean => s.sites.length > 0 || s.captureMesh !== null;
/** Steps 2-4 hold choices a new capture would clear. */
export const hasDownstreamWork = (s: CaseState): boolean => Object.keys(s.geometryBySite).length > 0 || s.jaw !== null || s.alignment !== null;
