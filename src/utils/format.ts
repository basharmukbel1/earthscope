/* Number / date formatting for scientific UI. */

export function fmt(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 10 ** -decimals || abs >= 1e6)) return v.toExponential(2);
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtSigned(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = fmt(Math.abs(v), decimals);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}

export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${fmtSigned(v, decimals)}%`;
}

/** Choose sensible decimals from magnitude. */
export function autoDecimals(v: number, min = 0, max = 4): number {
  const a = Math.abs(v);
  if (a === 0 || !Number.isFinite(a)) return min;
  const d = Math.ceil(-Math.log10(a)) + 2;
  return Math.max(min, Math.min(max, d));
}

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
}
export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number) => MONTHS[(m - 1 + 12) % 12];

export function fmtDateKey(date: string): string {
  const [y, m] = date.split("-");
  return m ? `${monthName(+m)} ${y}` : y;
}

/** Annual-unit label for a variable: mm/day monthly → mm/yr annual totals. */
export function annualUnit(unit: string, agg: "mean" | "sum", sumFactor?: string): string {
  if (agg === "sum" && sumFactor === "daysInMonth" && unit.endsWith("/day")) return unit.replace("/day", "/yr");
  if (agg === "sum") return `${unit} (annual total)`;
  return unit;
}

export function plural(n: number, word: string, pluralWord?: string) {
  return `${n} ${n === 1 ? word : (pluralWord ?? word + "s")}`;
}
