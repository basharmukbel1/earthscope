/* ==========================================================================
   EARTHSCOPE chart palette — every color a chart may use, by the JOB it does.

   Brand / semantic colors are referenced through the design tokens in
   src/styles/tokens.css (var(--color-…), var(--chart-…)) so the theme stays
   single-sourced. The few chart-only roles the token file does not define
   (validated categorical slots, the ordinal ramp and the neutral diverging
   pair) live here as hex, because the correlation heat-map has to interpolate
   them numerically.

   Validated with the dataviz six-checks validator (OKLab ΔE×100, Machado 2009
   CVD simulation) against the EARTHSCOPE panel surface #0e1628, dark mode:
     CATEGORICAL  adjacent: CVD ΔE ≥ 10.1, normal-vision ΔE ≥ 18.8, all ≥ 3:1
                  first three, all-pairs (scatter-safe): CVD ΔE ≥ 14.3
     ORDINAL      monotone L, ΔL ≥ 0.06, darkest step 3.4:1 vs surface, 1 hue
     DIVERGING    cool↔warm poles: CVD ΔE 15.7, normal ΔE 17.6, both ≥ 3:1
     rise↔fall    CVD ΔE 6.9 (deutan) → floor band: ALWAYS paired with ▲/▼
                  glyphs and solid/dashed + filled/hollow encodings.
   ========================================================================== */

import type { TrendDirection } from "../../types/domain";

/** Brand / semantic roles (CSS variables, resolved by the browser). */
export const C = {
  ink: "var(--color-ink)",
  ink2: "var(--color-ink-2)",
  ink3: "var(--color-ink-3)",
  ink4: "var(--color-ink-4)",
  label: "var(--chart-label)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  band: "var(--chart-band)",
  line: "var(--color-line)",
  lineStrong: "var(--color-line-strong)",
  lineBright: "var(--color-line-bright)",
  surface: "var(--color-surface)",
  surface2: "var(--color-surface-2)",
  void: "var(--color-void)",
  /** Primary / emphasised observation series. */
  primary: "var(--chart-series)",
  /** Active interaction (crosshair, focus). */
  active: "var(--color-cyan)",
  rise: "var(--color-rise)",
  fall: "var(--color-fall)",
  flat: "var(--color-flat)",
  missing: "var(--color-missing)",
  warn: "var(--color-warn)",
} as const;

/**
 * Categorical identity slots — assigned in this fixed order, never cycled.
 * sky · amber · mulberry · teal. (Violet is reserved for AI, green/coral for
 * trend direction, yellow for warnings, so none of those hues appear here.)
 * Past four peer series: fold into "Other" or facet into small multiples.
 */
export const CATEGORICAL = ["#5995dd", "#c4822f", "#a9527f", "#00aaa6"] as const;

/** Ordinal ice ramp: older periods recede, the most recent period is ice. */
export const ORDINAL_DARK = "#4f6d99";
export const ORDINAL_LIGHT = "#a8d8ff";

/**
 * Neutral diverging pair (polarity around a baseline). Deliberately NOT the
 * rise/fall trend colors: an anomaly or a correlation sign is not a trend.
 * Positive = warm clay, negative = cool ice, midpoint = neutral slate.
 */
export const DIVERGING = {
  warm: "#d39b78",
  cool: "#7fb5e8",
  mid: "#243049",
} as const;

/** Glyphs that always accompany trend-direction color (never color alone). */
export const TREND_GLYPH: Record<TrendDirection, string> = {
  increasing: "▲",
  decreasing: "▼",
  "no-trend": "◆",
};

export function trendColor(direction: TrendDirection): string {
  return direction === "increasing" ? C.rise : direction === "decreasing" ? C.fall : C.flat;
}

/**
 * Default color for series i of n. A single series is the emphasised primary
 * (ice); peers take categorical slots in fixed order. Pass an explicit color
 * on the series to pin identity across filters (color follows the entity).
 */
export function seriesColor(index: number, count: number, explicit?: string): string {
  if (explicit) return explicit;
  if (count <= 1) return C.primary;
  return CATEGORICAL[Math.min(index, CATEGORICAL.length - 1)];
}

/* ---------------------------- OKLab helpers ------------------------------ */

type Vec3 = [number, number, number];

function hexToRgb(hex: string): Vec3 {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as Vec3;
}
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

function rgbToOklab([r0, g0, b0]: Vec3): Vec3 {
  const r = toLin(r0), g = toLin(g0), b = toLin(b0);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, a, b]: Vec3): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return "#" + rgb.map((c) => Math.round(toGamma(c) * 255).toString(16).padStart(2, "0")).join("");
}

/** Perceptual (OKLab) mix of two hex colors. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  const k = Math.max(0, Math.min(1, t));
  return oklabToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** N ordinal steps (older → newer). Two periods: slate-ice → ice. */
export function ordinalRamp(n: number): string[] {
  if (n <= 1) return [ORDINAL_LIGHT];
  return Array.from({ length: n }, (_, i) => mixOklab(ORDINAL_DARK, ORDINAL_LIGHT, i / (n - 1)));
}

/** Diverging color for a value in [-1, 1] (e.g. a correlation coefficient). */
export function divergingColor(v: number): string {
  const t = Math.max(-1, Math.min(1, v));
  // Slight ease so weak values stay quiet and strong values separate.
  const k = Math.sign(t) * Math.abs(t) ** 0.85;
  return k >= 0 ? mixOklab(DIVERGING.mid, DIVERGING.warm, k) : mixOklab(DIVERGING.mid, DIVERGING.cool, -k);
}

/** Relative luminance (WCAG) of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Label color for text set INSIDE a fill: deep void on light fills, ink on dark. */
export function textOnFill(hex: string): string {
  return luminance(hex) > 0.28 ? "#04060c" : "#eef3ff";
}
