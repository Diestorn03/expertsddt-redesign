/**
 * Deterministic SYNTHETIC test data. Never load real patient files in tests: generate them here.
 * Bodies are built in the implant frame: origin = connection (z = 0), +Z = axis, +X = indexed side.
 */
import { fromAxes, fromAxisAngle, multiply, transformDirection } from '../../core/mat4';
import { mergeMeshes, transformMesh } from '../../core/mesh';
import { createRng, gaussian } from '../../core/sampling';
import type { Arch, AssemblyPart, ImplantSite, Mat4, TriMesh, Vec3 } from '../../core/types';
import { cross, dot, normalize, scale, sub } from '../../core/vec3';

export interface ScanBodyOptions {
  radius?: number;
  height?: number;
  /** Vertices around the circumference. */
  segments?: number;
  /** Planar flat on the +X side: breaks rotational symmetry so the +X index is recoverable. */
  flat?: boolean;
  flatDepth?: number;
  /** 45° chamfer at the top, so top and bottom differ and +Z is recoverable. */
  chamfer?: number;
  /** Rings along the straight part. */
  heightSegments?: number;
}

/** Closed scan-body-like cylinder, outward normals, connection at the origin, axis +Z. */
export function makeScanBody(options: ScanBodyOptions = {}): TriMesh {
  const { radius = 2.5, height = 6.6, segments = 48, flat = true, flatDepth = 0.5, chamfer = 0.6, heightSegments = 4 } = options;
  const rings: Array<[number, number]> = [];
  const straight = height - chamfer;
  for (let k = 0; k <= heightSegments; k++) rings.push([(straight * k) / heightSegments, radius]);
  if (chamfer > 0) rings.push([height, radius - chamfer]);
  const flatX = radius - flatDepth;

  const ringCount = rings.length;
  const positions = new Float32Array(3 * (ringCount * segments + 2));
  rings.forEach(([z, r], k) => {
    for (let j = 0; j < segments; j++) {
      const theta = (2 * Math.PI * j) / segments;
      const x = r * Math.cos(theta);
      const o = 3 * (k * segments + j);
      positions[o] = flat ? Math.min(x, flatX) : x;
      positions[o + 1] = r * Math.sin(theta);
      positions[o + 2] = z;
    }
  });
  const bottom = ringCount * segments, top = bottom + 1;
  positions[3 * top + 2] = height;

  const indices: number[] = [];
  const v = (k: number, j: number): number => k * segments + (j % segments);
  for (let k = 0; k + 1 < ringCount; k++) {
    for (let j = 0; j < segments; j++) {
      indices.push(v(k, j), v(k, j + 1), v(k + 1, j + 1), v(k, j), v(k + 1, j + 1), v(k + 1, j));
    }
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottom, v(0, j + 1), v(0, j));
    indices.push(top, v(ringCount - 1, j), v(ringCount - 1, j + 1));
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/** Same body without the flat: rotationally symmetric about +Z (index ambiguous by design). */
export function makeRevolutionBody(options: Omit<ScanBodyOptions, 'flat'> = {}): TriMesh {
  return makeScanBody({ ...options, flat: false });
}

export interface ArchOptions {
  halfWidthMm?: number;
  depthMm?: number;
  ridgeWidthMm?: number;
  ridgeHeightMm?: number;
  segmentsAlong?: number;
  segmentsAcross?: number;
}

const ARCH_DEFAULTS: Required<ArchOptions> = {
  halfWidthMm: 23,
  depthMm: 38,
  ridgeWidthMm: 9,
  ridgeHeightMm: 5,
  segmentsAlong: 96,
  segmentsAcross: 12,
};

/** Parabolic arch centre line, s in [0, 1]: point and unit tangent (XY plane). */
function archCurve(s: number, o: Required<ArchOptions>): { x: number; y: number; tx: number; ty: number } {
  const g = 2 * s - 1;
  const dx = 2 * o.halfWidthMm, dy = -4 * o.depthMm * g;
  const len = Math.hypot(dx, dy);
  return { x: o.halfWidthMm * g, y: o.depthMm * (1 - g * g), tx: dx / len, ty: dy / len };
}

/** Ridge height (lower-arch orientation) with irregular relief: no symmetry, no flat regions. */
function ridge(s: number, u: number, o: Required<ArchOptions>): number {
  const bump = 1 - u * u;
  return (
    o.ridgeHeightMm * bump +
    0.6 * Math.sin(7.1 * s + 0.4) * bump +
    0.35 * Math.cos(13.3 * s - 1.2 * u) +
    0.2 * Math.sin(4.7 * u + 9.1 * s * s)
  );
}

function archPoint(s: number, u: number, o: Required<ArchOptions>): Vec3 {
  const c = archCurve(s, o);
  const half = o.ridgeWidthMm / 2;
  return [c.x + u * half * c.ty, c.y - u * half * c.tx, ridge(s, u, o)];
}

/** Gingiva-like open strip along a dental arch. Lower: ridge and normals face +Z; upper: mirrored to -Z. */
export function makeArch(arch: Arch = 'lower', options: ArchOptions = {}): TriMesh {
  const o = { ...ARCH_DEFAULTS, ...options };
  const along = o.segmentsAlong, across = o.segmentsAcross;
  const zSign = arch === 'lower' ? 1 : -1;
  const positions = new Float32Array(3 * (along + 1) * (across + 1));
  for (let i = 0; i <= along; i++) {
    for (let j = 0; j <= across; j++) {
      const [x, y, z] = archPoint(i / along, -1 + (2 * j) / across, o);
      const k = 3 * (i * (across + 1) + j);
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = zSign * z;
    }
  }
  const indices: number[] = [];
  const v = (i: number, j: number): number => i * (across + 1) + j;
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j + 1), d = v(i + 1, j);
      if (arch === 'lower') indices.push(a, b, c, a, c, d);
      else indices.push(a, c, b, a, d, c);
    }
  }
  return { positions, indices: Uint32Array.from(indices) };
}

/**
 * n implant frames (implant -> capture coordinates) on the ridge of makeArch(arch, options):
 * origin 1 mm below the crest, axis pointing out of the gum (+Z lower, -Z upper) tilted up to
 * ~11°, and a pseudo-random clocking of +X. Deterministic for a seed.
 */
export function makeFrames(n: number, arch: Arch = 'lower', seed = 7, options: ArchOptions = {}): Mat4[] {
  const o = { ...ARCH_DEFAULTS, ...options };
  const rng = createRng(seed);
  const zSign = arch === 'lower' ? 1 : -1;
  const frames: Mat4[] = [];
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? 0.5 : 0.15 + (0.7 * k) / (n - 1);
    const c = archCurve(s, o);
    const tangent: Vec3 = [c.tx, c.ty, 0];
    const lateral: Vec3 = [c.ty, -c.tx, 0];
    const origin: Vec3 = [c.x, c.y, zSign * (ridge(s, 0, o) - 1)];
    const tilt = multiply(fromAxisAngle(lateral, (rng() * 2 - 1) * 0.15), fromAxisAngle(tangent, (rng() * 2 - 1) * 0.2));
    const z = normalize(transformDirection(tilt, [0, 0, zSign]));
    const xRef = normalize(sub(tangent, scale(z, dot(tangent, z))));
    const x = normalize(transformDirection(fromAxisAngle(z, rng() * 2 * Math.PI), xRef));
    frames.push(fromAxes(x, cross(z, x), z, origin));
  }
  return frames;
}

/** One copy of `body` per frame, merged (body i occupies triangles [i·T, (i+1)·T)). */
export function placeBodies(frames: readonly Mat4[], body: TriMesh): TriMesh {
  return mergeMeshes(frames.map((f) => transformMesh(body, f)));
}

/** Gaussian noise (sigma in mm) on every vertex coordinate; returns a new mesh. */
export function addNoise(mesh: TriMesh, sigmaMm: number, seed: number): TriMesh {
  const rng = createRng(seed);
  const positions = Float32Array.from(mesh.positions, (v) => v + sigmaMm * gaussian(rng));
  const out: TriMesh = { positions, indices: mesh.indices.slice() };
  if (mesh.colors) out.colors = mesh.colors.slice();
  return out;
}

/** Random proper rigid transform: uniform axis, angle in [0, maxAngleRad], translation in [-max, max]^3. */
export function randomRigid(seed: number, maxAngleRad = Math.PI, maxTranslationMm = 20): Mat4 {
  const rng = createRng(seed);
  const m = fromAxisAngle([gaussian(rng), gaussian(rng), gaussian(rng)], rng() * maxAngleRad);
  m[3] = (2 * rng() - 1) * maxTranslationMm;
  m[7] = (2 * rng() - 1) * maxTranslationMm;
  m[11] = (2 * rng() - 1) * maxTranslationMm;
  return m;
}

export interface SyntheticCaseOptions {
  arch?: Arch;
  implants?: number;
  /** false = revolution bodies (index ambiguous). */
  flat?: boolean;
  /** Gaussian noise added to the jaw, mm (e.g. 0.01 = 10 µm). */
  noiseSigmaMm?: number;
  seed?: number;
  maxAngleRad?: number;
  maxTranslationMm?: number;
  archOptions?: ArchOptions;
}

export interface SyntheticCase {
  arch: Arch;
  /** Scan body in the implant frame. */
  body: TriMesh;
  /** Implant -> capture frames, one per site. */
  frames: Mat4[];
  sites: ImplantSite[];
  /** Bodies in capture coordinates, one per site (site i = component i of captureMesh). */
  parts: AssemblyPart[];
  captureMesh: TriMesh;
  /** Gingiva strip in capture coordinates. */
  archMesh: TriMesh;
  /** (arch + bodies) moved by captureToJaw, plus noise. */
  jaw: TriMesh;
  /** Ground truth that alignment must recover. */
  captureToJaw: Mat4;
}

/** A complete synthetic case: capture, jaw scan and the true capture -> jaw transform. */
export function makeSyntheticCase(options: SyntheticCaseOptions = {}): SyntheticCase {
  const arch = options.arch ?? 'lower';
  const seed = options.seed ?? 1;
  const flat = options.flat ?? true;
  const body = makeScanBody({ flat });
  const frames = makeFrames(options.implants ?? 4, arch, seed + 1, options.archOptions);
  const sites: ImplantSite[] = frames.map((matrix, i) => ({
    id: `site-${i + 1}`,
    label: `S${i + 1}`,
    matrix,
    source: 'demo',
    flags: flat ? {} : { indexAmbiguous: true },
    componentIndex: i,
  }));
  const parts = frames.map((f, i) => ({ siteId: sites[i]!.id, mesh: transformMesh(body, f) }));
  const captureMesh = mergeMeshes(parts.map((p) => p.mesh));
  const archMesh = makeArch(arch, options.archOptions);
  const captureToJaw = randomRigid(seed + 2, options.maxAngleRad ?? Math.PI / 3, options.maxTranslationMm ?? 15);
  const moved = transformMesh(mergeMeshes([archMesh, captureMesh]), captureToJaw);
  const noise = options.noiseSigmaMm ?? 0;
  const jaw = noise > 0 ? addNoise(moved, noise, seed + 3) : moved;
  return { arch, body, frames, sites, parts, captureMesh, archMesh, jaw, captureToJaw };
}
