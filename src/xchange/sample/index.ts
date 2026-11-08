/**
 * In-browser sample case (UI-DESIGN §10): an edentulous upper arch restored All-on-4 style (two straight anterior
 * implants, two posterior ones tilted 30° distally), each carrying a scan body that was "scanned" standing in the
 * gingiva. Synthetic and deterministic: no network, no patient. It reaches the app as files, through the real parsers:
 * a MicronMapper V1.4 CSV (capture coordinates) and a binary PLY with per-vertex colors (scanner coordinates of an
 * upper arch: occlusal toward -Z, anterior toward -Y, the patient's left toward +X, as viewer/presets.ts expects).
 * The replacement of step 2 is the same scan body as clean CAD; the scanned ones carry 5 µm noise, so auto align ends
 * at a few µm RMS. The scan body is our own generic shape (cylinder, full-height index flat on +X, chamfered top).
 * Upper rather than lower: Fernando's cases are upper arches, and the palate (vault, rugae, papilla) is what makes a
 * scan read as a mouth at a glance, where an edentulous lower arch is a bare horseshoe. Units: mm.
 */
import { fromAxes, fromAxisAngle, getColumn, inverseRigid, multiply, transformDirection, transformPoint } from '../core/mat4';
import { createRng, gaussian, hash3 } from '../core/sampling';
import type { Arch, Mat4, TriMesh, Vec3 } from '../core/types';
import { add, cross, dot, normalize, scale, sub } from '../core/vec3';

export interface Sample {
  arch: Arch;
  /** MicronMapper V1.4 CSV: the four implant positions in capture coordinates. */
  csv: Uint8Array;
  /** Binary little-endian PLY with per-vertex colors: gingiva and the four scanned scan bodies, jaw coordinates. */
  jaw: Uint8Array;
  /** Replacement geometry of step 2: the scan body as clean CAD, in the implant frame. */
  body: TriMesh;
  /** Ground truth for tests: implant -> jaw frames in file order, and the capture -> jaw transform alignment must find. */
  truth: { frames: Mat4[]; captureToJaw: Mat4 };
}

/* ---------------- scan body ---------------- */

// flatDepth puts the flat's edges on the 96-segment grid of the CAD body (cos 41.25°): its corners are exact, so a
// scan of the same body never sticks out of it there.
const BODY = { radius: 2.4, height: 10, flatDepth: 2.4 * (1 - Math.cos((11 * Math.PI) / 48)), chamfer: 0.8 } as const;

/** Surface of revolution about +Z from an (r, z) profile walked counterclockwise (outward normals); x is clamped to
 * the index flat. A profile point with r = 0 is a pole (one vertex). */
function lathe(profile: ReadonlyArray<readonly [number, number]>, segments: number, pos: number[], idx: number[]): void {
  const flatX = BODY.radius - BODY.flatDepth;
  const first: number[] = [];
  for (const [r, z] of profile) {
    first.push(pos.length / 3);
    if (r === 0) pos.push(0, 0, z);
    else for (let j = 0; j < segments; j++) {
      const a = (2 * Math.PI * j) / segments;
      pos.push(Math.min(r * Math.cos(a), flatX), r * Math.sin(a), z);
    }
  }
  const pole = (k: number): boolean => profile[k]![0] === 0;
  const v = (k: number, j: number): number => first[k]! + (pole(k) ? 0 : j % segments);
  for (let k = 0; k + 1 < profile.length; k++) {
    for (let j = 0; j < segments; j++) {
      const a = v(k, j), b = v(k, j + 1), c = v(k + 1, j + 1), d = v(k + 1, j);
      if (!pole(k)) idx.push(a, b, c);
      if (!pole(k + 1)) idx.push(a, c, d);
    }
  }
}

const steps = (n: number, f: (t: number) => readonly [number, number]): (readonly [number, number])[] =>
  Array.from({ length: n + 1 }, (_, k) => f(k / n));

/** Clean CAD: 96 segments, separate vertices at every crease (crisp shading), rings every ~0.5 mm for the color map. */
export function makeScanBodyCad(): TriMesh {
  const { radius: R, height: H, chamfer: c } = BODY;
  const pos: number[] = [], idx: number[] = [];
  lathe([[0, 0], [R, 0]], 96, pos, idx);
  lathe(steps(19, (t) => [R, t * (H - c)]), 96, pos, idx);
  lathe(steps(8, (t) => [R - t * c, H - c + t * c]), 96, pos, idx); // fine rings where the flat cuts the chamfer
  lathe([[R - c, H], [0, H]], 96, pos, idx);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** The same body as an intraoral scanner meshes it: ~0.17 mm triangles, one shared surface (edges come out rounded). */
function scannedBody(): TriMesh {
  const { radius: R, height: H, chamfer: c } = BODY;
  const s = 0.17, n = (len: number): number => Math.ceil(len / s), hub = 0.5; // innermost cap ring
  const profile = [
    [0, 0] as const,
    ...steps(n(R - hub), (t) => [hub + t * (R - hub), 0]),
    ...steps(n(H - c), (t) => [R, t * (H - c)]).slice(1),
    ...steps(n(c * Math.SQRT2), (t) => [R - t * c, H - c + t * c]).slice(1),
    ...steps(n(R - c - hub), (t) => [R - c - t * (R - c - hub), H]).slice(1),
    [0, H] as const,
  ];
  const pos: number[] = [], idx: number[] = [];
  lathe(profile, 88, pos, idx);
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/* ---------------- noise ---------------- */

const lattice = (x: number, y: number, seed: number): number => hash3(x, y, 0x5eed, seed) / 2147483647.5 - 1;

/** Value noise in [-1, 1], lattice step 1, C1 smooth. */
function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = lattice(xi, yi, seed), b = lattice(xi + 1, yi, seed), c = lattice(xi, yi + 1, seed), d = lattice(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const sigmoid = (v: number): number => 1 / (1 + Math.exp(-v));
const bell = (v: number): number => Math.exp(-v * v);

/* ---------------- arch ---------------- */

// Ridge crest of the upper arch seen from below, origin in the palate: y = Y0 + A2·x² + A4·x⁴ for |x| <= X_END,
// central incisor area at y = Y0, tuberosities at the ends. Angles are taken around the origin, 0 = anterior (-Y),
// positive toward the patient's left (+X).
const Y0 = -31, A2 = 0.034, A4 = 6e-5, X_END = 24;
const crestY = (x: number): number => Y0 + A2 * x * x + A4 * x ** 4;
const crestSlope = (x: number): number => 2 * A2 * x + 4 * A4 * x ** 3;
const angleOf = (x: number, y: number): number => Math.atan2(x, -y);
const PHI_END = angleOf(X_END, crestY(X_END));
/** Posterior end of the scan (vibrating line area), y. */
const Y_POST = 14.5;
const DEG = Math.PI / 180;

/** Piecewise-linear in |angle| (degrees). */
function byAngle(points: ReadonlyArray<readonly [number, number]>): (phi: number) => number {
  return (phi) => {
    const d = Math.abs(phi) / DEG;
    let i = 1;
    while (i < points.length - 1 && points[i]![0] < d) i++;
    const [d0, v0] = points[i - 1]!, [d1, v1] = points[i]!;
    const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
    return v0 + (v1 - v0) * t;
  };
}

// Cross-section of the ridge (mm): vestibule depth, palatal and buccal slope widths, fold and border distances. The
// vault depth goes by position: shallow behind the incisors, deepest from the premolars back.
const VEST = byAngle([[0, 10.5], [35, 9.6], [70, 8.3], [110, 7.4], [180, 7.4]]);
const WP = byAngle([[0, 9.5], [30, 7.8], [60, 6.2], [110, 6.6], [180, 7]]);
const WB = byAngle([[0, 4], [60, 4.1], [110, 4.6], [180, 4.6]]);
const FOLD = byAngle([[0, 9], [60, 8.4], [100, 7.6], [180, 7.4]]);
const BORDER = byAngle([[0, 12.6], [60, 11.4], [95, 10], [120, 9], [180, 9]]);
const LIP = 4;
const vaultDepth = (y: number): number => 6.6 + 4.2 * sigmoid((y + 20) / 4.5);

const N_PHI = 2048;
const F_RHO = 0, F_A = 1, F_BUMP = 2, F_V = 3, F_WP = 4, F_WB = 5, F_FOLD = 6, F_TB = 7, F_CB = 8, FIELDS = 9;

/** Per-angle ridge parameters, interpolated per vertex: crest radius, ridge presence (fades past the tuberosities),
 * crest relief, cross-section. */
function buildLut(): Float64Array {
  // the crest polynomial continues past the tuberosities as a virtual crest, so every iso-line stays smooth
  const xs = 6001, xMax = 30, sx = new Float64Array(xs), sphi = new Float64Array(xs);
  for (let i = 0; i < xs; i++) {
    const x = -xMax + (2 * xMax * i) / (xs - 1);
    sx[i] = x;
    sphi[i] = angleOf(x, crestY(x));
  }
  const phiMax = sphi[xs - 1]!, rhoMax = Math.hypot(xMax, crestY(xMax));
  const slope = (rhoMax - Math.hypot(sx[xs - 2]!, crestY(sx[xs - 2]!))) / (phiMax - sphi[xs - 2]!);
  const lut = new Float64Array((N_PHI + 1) * FIELDS);
  for (let i = 0; i <= N_PHI; i++) {
    const phi = -Math.PI + (2 * Math.PI * i) / N_PHI;
    const a = Math.abs(phi);
    let rho: number;
    if (a <= phiMax) {
      let lo = 0, hi = xs - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sphi[mid]! <= phi) lo = mid; else hi = mid; }
      const t = (phi - sphi[lo]!) / (sphi[hi]! - sphi[lo]! || 1);
      const x = sx[lo]! + (sx[hi]! - sx[lo]!) * t;
      rho = Math.hypot(x, crestY(x));
    } else rho = rhoMax + slope * (a - phiMax);
    rho += 0.55 * noise(phi * 5.5, 0.5, 11); // the crest line meanders
    // ridge presence: full along the arch, rounded off slowly behind the tuberosities
    const past = (a - PHI_END) / DEG;
    const presence = past < -3 ? 1 : past > 25 ? 0 : 0.5 + 0.5 * Math.cos(((past + 3) / 28) * Math.PI);
    // tuberosity: the ridge swells and widens toward its ends
    const tuber = bell(((a - PHI_END) / DEG + 7) / 9);
    const bump = 0.32 * noise(phi * 6, 2.5, 12) + 0.14 * noise(phi * 19, 4.5, 13) + 0.95 * tuber;
    const o = i * FIELDS;
    lut[o + F_RHO] = rho;
    lut[o + F_A] = presence;
    lut[o + F_BUMP] = bump;
    lut[o + F_V] = VEST(phi);
    lut[o + F_WP] = WP(phi) * (1 + 0.25 * tuber);
    lut[o + F_WB] = WB(phi) * (1 + 0.25 * tuber);
    lut[o + F_FOLD] = FOLD(phi);
    lut[o + F_TB] = BORDER(phi) + 1.5 * noise(phi * 8.5, 7.5, 14);
    lut[o + F_CB] = 1.9 + 0.8 * tuber; // half-width of the crest plateau, buccal side
  }
  return lut;
}

// Former teeth (healed sockets: shallow dimples on the crest) and frena, by angle.
const SOCKETS = [7, 20, 34, 48, 63, 80, 96].flatMap((d) => [d * DEG, -d * DEG]);
const FRENA = [0, 62 * DEG, -62 * DEG];
// Rugae: wavy transverse folds behind the incisive papilla, y = Y + K·|x| + wave, from |x| = 1.4 to END.
const RUGAE = [
  { y: Y0 + 7.4, k: 0.24, end: 8.5, a: 0.62 },
  { y: Y0 + 10.2, k: 0.3, end: 10.5, a: 0.72 },
  { y: Y0 + 13.1, k: 0.36, end: 11.8, a: 0.66 },
  { y: Y0 + 16.2, k: 0.42, end: 12.6, a: 0.5 },
];
const PAPILLA_Y = Y0 + 4.4;

// sRGB albedo of the tissues (scanner texture colors).
const COL = {
  palate: [214, 146, 142],
  attached: [226, 158, 150],
  mucosa: [190, 88, 92],
  fold: [160, 64, 72],
  lip: [204, 110, 94],
  soft: [204, 110, 112],
  sulcus: [150, 58, 64],
  body: [186, 184, 178],
} as const;

interface Implant {
  /** Emergence point on the gingiva (jaw coordinates) and axis (unit, out of the gum). */
  e: Vec3;
  axis: Vec3;
}

/** Where (x, y) sits on the arch: distance from the origin, angle, and the LUT row to interpolate (offset, weight). */
interface Polar {
  rho: number;
  phi: number;
  o: number;
  w: number;
}

function polar(x: number, y: number, out: Polar): Polar {
  out.rho = Math.sqrt(x * x + y * y);
  out.phi = angleOf(x, y);
  const f = (out.phi + Math.PI) * (N_PHI / (2 * Math.PI)), i0 = Math.min(N_PHI - 1, f | 0);
  out.o = i0 * FIELDS;
  out.w = f - i0;
  return out;
}

const field = (lut: Float64Array, p: Polar, k: number): number => lut[p.o + k]! + (lut[p.o + FIELDS + k]! - lut[p.o + k]!) * p.w;

/** mm inside the scanned area (negative outside): the ragged buccal border and the ragged posterior border. */
function margin(lut: Float64Array, x: number, y: number, p: Polar): number {
  let buccal = field(lut, p, F_TB) - (p.rho - field(lut, p, F_RHO));
  if (Math.abs(buccal) < 1) buccal += 0.5 * noise(x / 0.9, y / 0.9, 41) + 0.16 * noise(x / 0.33, y / 0.33, 44); // jagged edge; far from it only the sign matters
  const back = y < Y_POST - 3 ? Infinity : Y_POST + 1.3 * noise(x / 4, 7.7, 42) + 0.45 * noise(x / 0.8, y / 0.8, 43) + 0.16 * noise(x / 0.33, y / 0.33, 45) - y;
  return Math.min(buccal, back);
}

/** Tissue height (toward occlusal, mm; jaw z = -h) at (x, y) and, when `rgb` is given, its albedo (sRGB 0-255). */
function tissue(lut: Float64Array, x: number, y: number, p: Polar, implants: readonly Implant[], rgb: Float64Array | null): number {
  const { rho, phi } = p;
  const presence = field(lut, p, F_A), P = vaultDepth(y), fold = field(lut, p, F_FOLD);
  const t = rho - field(lut, p, F_RHO); // signed distance from the crest, + buccal, - palatal

  // ridge cross-section: rounded plateau, buccal slope into the vestibule fold and back out on the lip mucosa,
  // palatal slope up into the vault
  let ridge: number;
  if (t >= 0) {
    const u = Math.max(0, t - field(lut, p, F_CB)) / field(lut, p, F_WB);
    ridge = -field(lut, p, F_V) * (1 - Math.exp(-u * u)) + LIP * (sigmoid((t - fold) / 1.5) - sigmoid(-fold / 1.5));
  } else {
    const u = Math.max(0, -t - 1.5) / field(lut, p, F_WP);
    ridge = -P * (1 - Math.exp(-u * u));
  }
  if (t > -12 && t < 12) ridge += field(lut, p, F_BUMP) * bell(t / 4) - 0.035 * t * t * bell(t / 3);
  let h = presence * ridge + (1 - presence) * -P;

  // palate: shallow dome, gentle undulation, the soft palate dropping at the back
  const inside = t < 6 ? sigmoid(-(t + 3) / 1.5) : 0;
  if (inside > 0.003) {
    h += inside * (-1.3 * bell(rho / 13) + 0.32 * noise(x / 7, y / 7, 21));
    if (y > 0) h += 1.7 * sigmoid((y - 9) / 2.2) * inside;
  }
  // incisive papilla, midline raphe, rugae
  const ax = Math.abs(x);
  const papilla = ax < 7 && Math.abs(y - PAPILLA_Y) < 9 ? 1.05 * bell(x / 2.1) * bell((y - PAPILLA_Y) / 3) : 0;
  h += papilla;
  if (ax < 3 && inside > 0.003) h += 0.28 * bell(x / 0.8) * sigmoid((y - PAPILLA_Y - 3) / 1.5) * sigmoid((8 - y) / 2) * inside;
  let ruga = 0;
  if (y > Y0 + 4 && y < Y0 + 24 && ax > 1.4 && ax < 14.1) {
    for (let k = 0; k < RUGAE.length; k++) {
      const r = RUGAE[k]!;
      if (ax > r.end + 1.5) continue;
      const cy = r.y + r.k * ax + 0.55 * Math.sin(0.75 * ax + 1.7 * k + (x < 0 ? 0.6 : 0));
      if (Math.abs(y - cy) > 2.5) continue;
      const taper = Math.min(1, (ax - 1.4) / 1.2) * Math.min(1, (r.end + 1.5 - ax) / 2.5);
      ruga += r.a * taper * bell((y - cy) / 0.75);
    }
    h += ruga;
  }
  // frena cross the vestibule as thin folds; healed sockets leave dimples on the crest
  if (t > 0) {
    const vest = sigmoid((t - 3) / 0.8) * sigmoid((field(lut, p, F_TB) - 1 - t) / 0.8);
    for (let k = 0; k < FRENA.length; k++) {
      const fp = FRENA[k]!, arc = rho * (phi - fp);
      if (vest > 0.003 && Math.abs(arc) < 4) h += (fp === 0 ? 1.6 : 1.1) * bell(arc / (fp === 0 ? 0.95 : 1.1)) * vest;
    }
  }
  if (t > -5 && t < 5) {
    const crest = bell(t / 2.2);
    for (let k = 0; k < SOCKETS.length; k++) {
      const arc = rho * (phi - SOCKETS[k]!);
      if (Math.abs(arc) < 5) h -= 0.26 * bell(arc / 1.7) * crest;
    }
  }
  // natural relief and the scanner's fine orange-peel texture
  const n1 = noise(x / 3.5, y / 3.5, 22), n2 = noise(x / 1.6, y / 1.6, 24);
  h += 0.07 * n1 + 0.035 * n2 + 0.024 * noise(x / 0.7, y / 0.7, 23);

  // tissue cuff hugging each scan body, sulcus in its shadow
  let sulcus = 0;
  for (let k = 0; k < implants.length; k++) {
    const imp = implants[k]!, dx = x - imp.e[0], dy = y - imp.e[1];
    if (dx * dx + dy * dy > 30) continue;
    const dz = -h - imp.e[2], along = dx * imp.axis[0] + dy * imp.axis[1] + dz * imp.axis[2];
    const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
    h += 0.5 * bell((r - BODY.radius - 0.15) / 0.65);
    sulcus = Math.max(sulcus, bell((r - BODY.radius - 0.1) / 0.45));
  }

  if (rgb) {
    const wa = t > -10 && t < 10 ? bell(t / 3) : 0;
    const wm = t > -6 ? sigmoid((t - 3.2) / 1) : 0;
    const wf = wm > 0.003 ? bell((t - fold) / 1.6) * wm : 0;
    const wl = t > fold - 6 ? sigmoid((t - fold - 1.6) / 1) : 0;
    const ws = y > 0 && inside > 0.003 ? sigmoid((y - 9) / 1.8) * inside : 0;
    for (let c = 0; c < 3; c++) {
      let v = COL.palate[c]!;
      v += (COL.attached[c]! - v) * 0.8 * wa;
      v += (COL.mucosa[c]! - v) * wm;
      v += (COL.fold[c]! - v) * wf;
      v += (COL.lip[c]! - v) * wl;
      v += (COL.soft[c]! - v) * ws;
      v += (COL.sulcus[c]! - v) * 0.85 * sulcus;
      rgb[c] = v;
    }
    // blotchy pigmentation, paler rugae and papilla crests, darker deep folds
    const blotch = 0.7 * noise(x / 5.5, y / 5.5, 31) + 0.3 * n1, hue = n2;
    const k = (1 + 0.09 * blotch) * (1 + 0.05 * ruga) * (1 - 0.1 * wf);
    rgb[0] = rgb[0]! * k * (1 + 0.025 * hue);
    rgb[1] = rgb[1]! * k * (1 - 0.035 * hue) * (1 - 0.05 * papilla);
    rgb[2] = rgb[2]! * k * (1 - 0.02 * hue);
  }
  return h;
}

/* ---------------- meshes ---------------- */

const GRID = 0.165;
const BOX = { x0: -38.5, x1: 38.5, y0: -46, y1: 17 } as const;

/** Gingiva as a scanner exports it: a height field with ~0.165 mm triangles, ragged border, noise and colors. */
function gingiva(lut: Float64Array, implants: readonly Implant[], seed: number): TriMesh {
  const nx = Math.round((BOX.x1 - BOX.x0) / GRID) + 1, ny = Math.round((BOX.y1 - BOX.y0) / GRID) + 1;
  const n = nx * ny;
  const pos = new Float32Array(3 * n), col = new Uint8Array(3 * n), margins = new Float32Array(n);
  const rgb = new Float64Array(3), p: Polar = { rho: 0, phi: 0, o: 0, w: 0 };
  const rng = createRng(seed);
  for (let j = 0; j < ny; j++) {
    const y = BOX.y0 + j * GRID;
    for (let i = 0; i < nx; i++) {
      const x = BOX.x0 + i * GRID, v = j * nx + i;
      polar(x, y, p);
      const m = (margins[v] = margin(lut, x, y, p));
      if (m <= 0) continue;
      const h = tissue(lut, x, y, p, implants, rgb);
      pos[3 * v] = x;
      pos[3 * v + 1] = y;
      pos[3 * v + 2] = -h + 0.012 * (rng() + rng() + rng() - 1.5); // ~6 µm scan noise
      // scanners lose color confidence toward the border; plus per-point speckle
      const k = (1 - 0.2 * bell(m / 0.9)) * (1 + 0.05 * (rng() - 0.5));
      for (let c = 0; c < 3; c++) col[3 * v + c] = Math.min(255, Math.round(rgb[c]! * k));
    }
  }
  // the grid's staircase would read as pixels up close: every vertex next to the outside moves onto the border line
  // (margin 0) toward its outside neighbours, so the edge is exactly as ragged as the noise
  const around = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1];
  for (let j = 1; j + 1 < ny; j++) {
    for (let i = 1; i + 1 < nx; i++) {
      const v = j * nx + i, m = margins[v]!;
      if (m <= 0) continue;
      let sx = 0, sy = 0, k = 0;
      for (const d of around) {
        const mu = margins[v + d]!;
        if (mu > 0) continue;
        const f = m / (m - mu), ux = BOX.x0 + ((v + d) % nx) * GRID, uy = BOX.y0 + Math.floor((v + d) / nx) * GRID;
        sx += BOX.x0 + i * GRID + f * (ux - BOX.x0 - i * GRID);
        sy += BOX.y0 + j * GRID + f * (uy - BOX.y0 - j * GRID);
        k++;
      }
      if (!k) continue;
      const x = sx / k, y = sy / k;
      pos[3 * v] = x;
      pos[3 * v + 1] = y;
      pos[3 * v + 2] = -tissue(lut, x, y, polar(x, y, p), implants, null) + 0.012 * (rng() + rng() + rng() - 1.5);
    }
  }
  // triangles whose corners are all on the scanned area; occlusal side (-Z) outward
  const idx = new Uint32Array(6 * (nx - 1) * (ny - 1));
  let t = 0;
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
      const ia = margins[a]! > 0, ib = margins[b]! > 0, ic = margins[c]! > 0, id = margins[d]! > 0;
      if ((i + j) & 1) {
        if (ia && ic && ib) { idx[t++] = a; idx[t++] = c; idx[t++] = b; }
        if (ia && id && ic) { idx[t++] = a; idx[t++] = d; idx[t++] = c; }
      } else {
        if (ia && id && ib) { idx[t++] = a; idx[t++] = d; idx[t++] = b; }
        if (ib && id && ic) { idx[t++] = b; idx[t++] = d; idx[t++] = c; }
      }
    }
  }
  return compact(pos, col, idx.subarray(0, t));
}

/** Drops the vertices no triangle uses (numbered by first use). */
function compact(pos: Float32Array, col: Uint8Array, idx: Uint32Array): TriMesh {
  const map = new Int32Array(pos.length / 3).fill(-1);
  let used = 0;
  for (let k = 0; k < idx.length; k++) if (map[idx[k]!] === -1) map[idx[k]!] = used++;
  const positions = new Float32Array(3 * used), colors = new Uint8Array(3 * used), indices = new Uint32Array(idx.length);
  for (let v = 0; v < map.length; v++) {
    const m = map[v]!;
    if (m < 0) continue;
    for (let c = 0; c < 3; c++) {
      positions[3 * m + c] = pos[3 * v + c]!;
      colors[3 * m + c] = col[3 * v + c]!;
    }
  }
  for (let k = 0; k < idx.length; k++) indices[k] = map[idx[k]!]!;
  return { positions, indices, colors };
}

/** A scanned body placed by `frame`: 5 µm noise, light warm grey, darker where it leaves the gingiva. */
function placeScanned(body: TriMesh, frame: Mat4, depth: number, rng: () => number): TriMesh {
  const p = body.positions, out = new Float32Array(p.length), colors = new Uint8Array(p.length);
  for (let v = 0; v < p.length; v += 3) {
    const q = transformPoint(frame, [p[v]!, p[v + 1]!, p[v + 2]!]);
    for (let c = 0; c < 3; c++) out[v + c] = q[c]! + 0.005 * gaussian(rng);
    const z = p[v + 2]!, rim = bell((z - depth - 0.3) / 0.7);
    const k = (1 - 0.18 * rim) * (1 + 0.04 * (rng() - 0.5));
    colors[v] = Math.round(COL.body[0] * k);
    colors[v + 1] = Math.round(COL.body[1] * k * (1 - 0.06 * rim));
    colors[v + 2] = Math.round(COL.body[2] * k * (1 - 0.08 * rim));
  }
  return { positions: out, indices: body.indices, colors };
}

function merge(meshes: readonly TriMesh[]): TriMesh {
  const nv = meshes.reduce((s, m) => s + m.positions.length, 0), ni = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(nv), colors = new Uint8Array(nv), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    colors.set(m.colors!, vo);
    for (let k = 0; k < m.indices.length; k++) indices[io + k] = m.indices[k]! + vo / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices, colors };
}

/* ---------------- implants ---------------- */

// All-on-4 by x on the crest, in MicronMapper marker order (patient's right to left): posterior tilted 30° distally,
// anterior near-straight with the ridge's labial inclination. depth = connection below the gingiva along the axis.
const LAYOUT = [
  { x: -18.6, tilt: 30, depth: 3 },
  { x: -9.2, tilt: 0, depth: 2.6 },
  { x: 9.2, tilt: 0, depth: 2.6 },
  { x: 18.6, tilt: 30, depth: 3 },
] as const;

function implantFrames(lut: Float64Array, rng: () => number): { frames: Mat4[]; implants: Implant[] } {
  const frames: Mat4[] = [], implants: Implant[] = [];
  const occlusal: Vec3 = [0, 0, -1];
  for (const site of LAYOUT) {
    // emergence on the crest line (the meandering one of the LUT)
    const phi = angleOf(site.x, crestY(site.x));
    const f = (phi + Math.PI) * (N_PHI / (2 * Math.PI)), i0 = f | 0;
    const rho = lut[i0 * FIELDS + F_RHO]! + (lut[(i0 + 1) * FIELDS + F_RHO]! - lut[i0 * FIELDS + F_RHO]!) * (f - i0);
    const ex = rho * Math.sin(phi), ey = -rho * Math.cos(phi);
    const e: Vec3 = [ex, ey, -tissue(lut, ex, ey, polar(ex, ey, { rho: 0, phi: 0, o: 0, w: 0 }), [], null)];
    const slope = crestSlope(site.x);
    const outward = normalize([slope, -1, 0]); // buccal, in the occlusal plane
    const distal = normalize([Math.sign(site.x), Math.abs(slope), 0]);
    const jitter = (deg: number): number => (rng() * 2 - 1) * deg * DEG;
    let axis = site.tilt
      ? add(scale(occlusal, Math.cos(site.tilt * DEG)), scale(distal, Math.sin(site.tilt * DEG)))
      : normalize([outward[0] * 0.14, outward[1] * 0.14, -1]);
    axis = normalize(rotate(rotate(axis, outward, jitter(2.5)), distal, jitter(2.5)));
    const x0 = normalize(sub(outward, scale(axis, dot(outward, axis))));
    const x = rotate(x0, axis, jitter(12));
    frames.push(fromAxes(x, cross(axis, x), axis, sub(e, scale(axis, site.depth))));
    implants.push({ e, axis });
  }
  return { frames, implants };
}

const rotate = (v: Vec3, axis: Vec3, angle: number): Vec3 => transformDirection(fromAxisAngle(axis, angle), v);

/* ---------------- files ---------------- */

function encodePly(mesh: TriMesh): Uint8Array {
  const nv = mesh.positions.length / 3, nf = mesh.indices.length / 3;
  const header = new TextEncoder().encode(
    ['ply', 'format binary_little_endian 1.0', 'comment DDT Xchange sample case: synthetic data, no patient', `element vertex ${nv}`,
      'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue',
      `element face ${nf}`, 'property list uchar int vertex_indices', 'end_header', ''].join('\n'),
  );
  const out = new Uint8Array(header.length + 15 * nv + 13 * nf);
  out.set(header);
  const view = new DataView(out.buffer);
  const p = mesh.positions, c = mesh.colors!, idx = mesh.indices;
  let o = header.length;
  for (let v = 0; v < nv; v++, o += 15) {
    view.setFloat32(o, p[3 * v]!, true);
    view.setFloat32(o + 4, p[3 * v + 1]!, true);
    view.setFloat32(o + 8, p[3 * v + 2]!, true);
    out[o + 12] = c[3 * v]!;
    out[o + 13] = c[3 * v + 1]!;
    out[o + 14] = c[3 * v + 2]!;
  }
  for (let f = 0; f < nf; f++, o += 13) {
    out[o] = 3;
    view.setInt32(o + 1, idx[3 * f]!, true);
    view.setInt32(o + 5, idx[3 * f + 1]!, true);
    view.setInt32(o + 9, idx[3 * f + 2]!, true);
  }
  return out;
}

/** MicronMapper V1.4: AXO marker rows (origin, +Z axis, +X axis; 6 decimals), then the footer rows. */
function encodeMicronMapper(frames: readonly Mat4[]): Uint8Array {
  const rows = frames.map((m, i) => [`AXO${String(i + 1).padStart(2, '0')}`, ...[3, 2, 0].flatMap((c) => getColumn(m, c as 0 | 2 | 3).map((v) => v.toFixed(6)))].join(','));
  rows.push('Camera:,SN-0000', 'Max divergence angle:,0.25', 'Application:,MicronMapper V1.4.2.7');
  return new TextEncoder().encode(rows.join('\r\n') + '\r\n');
}

/* ---------------- the case ---------------- */

/** capture -> jaw: the photogrammetry and the intraoral scanner never share coordinates. */
const CAPTURE_TO_JAW = (() => {
  const m = fromAxisAngle(normalize([0.42, -0.3, 0.86]), 11 * DEG);
  m[3] = 5.5; m[7] = -8.5; m[11] = 12;
  return m;
})();

export function makeSample(): Sample {
  const lut = buildLut();
  const rng = createRng(2026);
  const { frames, implants } = implantFrames(lut, rng);
  const scan = scannedBody();
  const jaw = merge([gingiva(lut, implants, 7), ...frames.map((f, i) => placeScanned(scan, f, LAYOUT[i]!.depth, rng))]);
  const jawToCapture = inverseRigid(CAPTURE_TO_JAW);
  return {
    arch: 'upper',
    csv: encodeMicronMapper(frames.map((f) => multiply(jawToCapture, f))),
    jaw: encodePly(jaw),
    body: makeScanBodyCad(),
    truth: { frames, captureToJaw: Float64Array.from(CAPTURE_TO_JAW) },
  };
}
