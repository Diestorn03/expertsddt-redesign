/**
 * Case state of the wizard (UI-DESIGN §5.1) and the pure rules around it: cross-file merge, gating,
 * alignment parts, guided targets, per-site status, the re-measure method rule and export gating.
 * No DOM, no workers: everything here is unit-tested.
 */
import { XchangeError } from '../core/errors';
import { LIMITS } from '../core/limits';
import { identity, maxAbsDiff } from '../core/mat4';
import { transformMesh } from '../core/mesh';
import type { AlignmentFlag, AlignmentResult, Arch, AssemblyPart, CaptureFormat, ImplantSite, JawScan, Mat4, ReplacementGeometry, SiteFit, TriMesh } from '../core/types';
import { DEFAULT_QUALITY, type QualityThresholds } from '../align/metrics';
import { orderSitesAlongArch } from '../align/landmarks';

export type Step = 1 | 2 | 3 | 4;
export type Surfaces = 'replacement' | 'capture';

/** One imported source, never with a name. */
export interface Source {
  kind: 'positions' | 'mesh' | 'sample';
  format: CaptureFormat;
  count: number;
}

/** A geometry that lives only in this case (sample body, positioned assembly). */
export interface CaseGeometry extends ReplacementGeometry {
  kind: 'sample' | 'assembly';
  /** Assembly entries of one file share a group and show as one library row. */
  group: string;
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
    jawColors: false, jawSkipped: false, surfaces: 'replacement', assembly: identity(), alignment: null, lastAttempt: null,
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

/** Guided targets 1-2-3-4: all sites when 4 or fewer, else four spread along the arch. */
export function guidedTargets(sites: readonly ImplantSite[]): ImplantSite[] {
  const ordered = orderSitesAlongArch(sites);
  const n = ordered.length;
  if (n <= 4) return ordered;
  const picks = [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return [...new Set(picks)].map((i) => ordered[i]!);
}

export type SiteStatus = 'good' | 'acceptable' | 'weak' | 'poor';
export function siteStatus(fit: Pick<SiteFit, 'rmsMm' | 'coverage'>, q: QualityThresholds = DEFAULT_QUALITY): SiteStatus {
  if (fit.coverage < q.usableCoverage) return 'poor';
  if (fit.rmsMm <= q.goodRmsMm && fit.coverage >= q.goodCoverage) return 'good';
  if (fit.rmsMm <= q.acceptableRmsMm && fit.coverage >= q.acceptableCoverage) return 'acceptable';
  return 'weak';
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
