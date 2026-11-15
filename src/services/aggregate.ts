import type { Point } from "@/types/domain";

/* Pure helpers shared by the browser services and Node build scripts. */

const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;
export const decimalYear = (y: number, m: number) => y + (m - 0.5) / 12;

export function seriesId(regionId: string, variableId: string, start: number, end: number) {
  return `${regionId}__${variableId}__${start}-${end}`;
}

/** Area-weighted mean per month across sample points (≥ 50 % of total weight required). */
export function aggregatePoints(
  perPoint: { w: number; values: Record<string, number | null> }[],
  start: number,
  end: number,
): Point[] {
  const totalW = perPoint.reduce((s, p) => s + p.w, 0);
  const out: Point[] = [];
  for (let y = start; y <= end; y++) {
    for (let m = 1; m <= 12; m++) {
      const k = monthKey(y, m);
      let sw = 0;
      let sv = 0;
      for (const p of perPoint) {
        const v = p.values[k];
        if (v == null || !Number.isFinite(v)) continue;
        sw += p.w;
        sv += p.w * v;
      }
      out.push({ t: decimalYear(y, m), date: k, v: sw >= 0.5 * totalW && sw > 0 ? sv / sw : null });
    }
  }
  // Drop trailing months that are entirely missing (e.g. a year not yet released).
  while (out.length && out[out.length - 1].v === null) out.pop();
  return out;
}
