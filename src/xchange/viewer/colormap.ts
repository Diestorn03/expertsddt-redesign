/**
 * Deviation color map (UI-DESIGN §6.5): 0 µm #86efac -> 50 µm #fbbf24 -> 100+ µm #dc2626, interpolated in
 * OKLab so lightness falls monotonically (reads in grayscale and for red-green color blindness).
 * The LUT is built once; the GPU copy is linear sRGB because three treats vertex colors as linear.
 * A vertex the scan cannot see (NaN from partDeviations: under the gum) takes MAP_HIDDEN, a cool grey apart from
 * every stop, the jaw and the parts: the map colours exactly what the quality label measures.
 */
export const MAP_STOPS = ['#86efac', '#fbbf24', '#dc2626'] as const;
export const MAP_HIDDEN = '#94a3b8';
export const MAP_MAX_UM = 100;
export const LUT_SIZE = 256;

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function srgbToOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab -> linear sRGB, clamped. */
function oklabToLinear([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

/** LUT_SIZE entries over 0..MAP_MAX_UM µm: `linear` for the GPU, `srgb` (0-255) for CSS and checks. */
export function buildLut(): { linear: Float32Array; srgb: Uint8Array } {
  const labs = MAP_STOPS.map((h) => srgbToOklab(hex(h)));
  const linear = new Float32Array(LUT_SIZE * 3), srgb = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * 2; // 0..2 across the two segments
    const k = t < 1 ? 0 : 1, f = t - k;
    const a = labs[k]!, b = labs[k + 1]!;
    const lin = oklabToLinear([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    for (let c = 0; c < 3; c++) {
      linear[3 * i + c] = lin[c]!;
      srgb[3 * i + c] = Math.round(toSrgb(lin[c]!) * 255);
    }
  }
  return { linear, srgb };
}

export const lutIndex = (um: number): number => Math.min(LUT_SIZE - 1, Math.max(0, Math.round((um / MAP_MAX_UM) * (LUT_SIZE - 1))));

const HIDDEN_LINEAR = hex(MAP_HIDDEN).map(toLinear);

/** Fills `out` (linear rgb per vertex) from µm values; NaN (not seen by the scan) -> MAP_HIDDEN. */
export function colorize(um: Float32Array, lut: Float32Array, out: Float32Array): void {
  for (let i = 0; i < um.length; i++) {
    const v = um[i]!, j = 3 * lutIndex(v);
    const hidden = Number.isNaN(v);
    out[3 * i] = hidden ? HIDDEN_LINEAR[0]! : lut[j]!;
    out[3 * i + 1] = hidden ? HIDDEN_LINEAR[1]! : lut[j + 1]!;
    out[3 * i + 2] = hidden ? HIDDEN_LINEAR[2]! : lut[j + 2]!;
  }
}
