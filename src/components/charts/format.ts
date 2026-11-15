/* ==========================================================================
   Chart number & date formatting. Typographic minus (U+2212), thin rules for
   units, decimal-year → "Mar 2004".
   ========================================================================== */

export const MINUS = "−";
export const EN_DASH = "–";
export const THIN_SPACE = " ";

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(decimals: number, grouping = true): Intl.NumberFormat {
  const key = `${decimals}|${grouping}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouping,
    });
    nfCache.set(key, f);
  }
  return f;
}

export interface NumberFormatOptions {
  /** Prefix "+" on positive values (deltas, anomalies, slopes). */
  signed?: boolean;
  /** Use thousands grouping (default true). */
  grouping?: boolean;
}

/** 1234.5 → "1,234.5"; −0.21 → "−0.21" (typographic minus). */
export function formatNumber(v: number | null | undefined, decimals = 1, opts: NumberFormatOptions = {}): string {
  if (v == null || !Number.isFinite(v)) return EN_DASH;
  const d = Math.max(0, Math.min(10, decimals));
  // Avoid "−0.0": round first, then treat ±0 as 0.
  const factor = 10 ** d;
  let x = Math.round(v * factor) / factor;
  if (Object.is(x, -0) || x === 0) x = 0;
  const body = nf(d, opts.grouping ?? true).format(Math.abs(x));
  if (x < 0) return MINUS + body;
  if (opts.signed && x > 0) return "+" + body;
  return body;
}

/** Significant-figure formatting: formatSig(0.0058123, 3) → "0.00581". */
export function formatSig(v: number | null | undefined, digits = 3, opts: NumberFormatOptions = {}): string {
  if (v == null || !Number.isFinite(v)) return EN_DASH;
  if (v === 0) return "0";
  const d = Math.max(0, Math.min(8, digits - 1 - Math.floor(Math.log10(Math.abs(v)))));
  return formatNumber(v, d, opts);
}

/** Units that attach without a space (25°C, 40%). */
const TIGHT_UNITS = new Set(["%", "°", "°C", "°F", "‰", "′", "″"]);

export function unitJoin(unit?: string): string {
  if (!unit) return "";
  return TIGHT_UNITS.has(unit) ? unit : `${THIN_SPACE}${unit}`;
}

/** formatValue(0.42, "°C", 2, {signed:true}) → "+0.42°C" */
export function formatValue(
  v: number | null | undefined,
  unit?: string,
  decimals = 1,
  opts: NumberFormatOptions = {},
): string {
  if (v == null || !Number.isFinite(v)) return EN_DASH;
  return formatNumber(v, decimals, opts) + unitJoin(unit);
}

/** Compact axis numbers: 12,000 → "12K", 3.4e6 → "3.4M". */
export function formatCompact(v: number, decimals = 1): string {
  const a = Math.abs(v);
  const sign = v < 0 ? MINUS : "";
  const trim = (s: string) => s.replace(/\.0+$/, "");
  if (a >= 1e9) return sign + trim((a / 1e9).toFixed(decimals)) + "B";
  if (a >= 1e6) return sign + trim((a / 1e6).toFixed(decimals)) + "M";
  if (a >= 1e4) return sign + trim((a / 1e3).toFixed(decimals)) + "K";
  return formatNumber(v, 0);
}

/** Decimals needed to print ticks at a given step without noise. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const d = Math.ceil(-Math.log10(step) - 1e-9);
  // 0.25 / 2.5 steps need one more digit
  const extra = Math.abs(step * 10 ** Math.max(0, d) - Math.round(step * 10 ** Math.max(0, d))) > 1e-6 ? 1 : 0;
  return Math.max(0, Math.min(6, d + extra));
}

/** Axis tick label: compact over 10k, otherwise grouped with step-derived decimals. */
export function formatTick(v: number, step: number): string {
  if (Math.abs(v) >= 1e4) return formatCompact(v);
  return formatNumber(v, decimalsForStep(step));
}

/* ---------------------------------- time --------------------------------- */

/** Split a decimal year (mid-month convention ok) into year + month index. */
export function decimalYearParts(t: number): { year: number; month: number } {
  let year = Math.floor(t + 1e-9);
  let month = Math.floor((t - year) * 12 + 1e-6);
  if (month > 11) {
    month = 0;
    year += 1;
  }
  return { year, month: Math.max(0, month) };
}

/** 2004.208 → "Mar 2004"; resolution "year" → "2004". */
export function formatDecimalYear(t: number, resolution: "month" | "year" = "month"): string {
  const { year, month } = decimalYearParts(t);
  return resolution === "year" ? String(year) : `${MONTHS_SHORT[month]} ${year}`;
}

/** Point.date ("YYYY", "YYYY-MM", "YYYY-MM-DD") → "2004", "Mar 2004", "12 Mar 2004". */
export function formatDateString(date: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  if (!mo) return y;
  const name = MONTHS_SHORT[Math.max(0, Math.min(11, Number(mo) - 1))];
  return d ? `${Number(d)} ${name} ${y}` : `${name} ${y}`;
}

export function formatYearRange(a: number, b: number): string {
  return `${a}${EN_DASH}${b}`;
}

/* ------------------------------- statistics ------------------------------ */

/** p-values the way a referee expects them. */
export function formatP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return `p ${EN_DASH}`;
  if (p < 0.001) return "p < 0.001";
  if (p < 0.01) return `p = ${p.toFixed(3)}`;
  return `p = ${p.toFixed(2)}`;
}

/** Correlation coefficient: "−0.42". */
export function formatR(r: number | null | undefined, decimals = 2): string {
  return formatNumber(r, decimals);
}

/** Slope per year → per decade string: "+0.21°C / decade". */
export function formatPerDecade(slopePerYear: number, unit?: string, decimals = 2): string {
  return `${formatValue(slopePerYear * 10, unit, decimals, { signed: true })} / decade`;
}
