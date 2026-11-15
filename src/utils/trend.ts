import type { AnalysisResult, Variable } from "@/types/domain";
import type { TrendOverlay } from "@/components/charts/TimeSeriesChart";
import { annualUnit } from "./format";

/** % of long-term mean per decade, or null for interval-scale variables such as °C. */
export function pctPerDecade(r: AnalysisResult, v: Variable): number | null {
  return v.intervalScale ? null : r.summary.pctPerDecade;
}

/** Annual-value unit for a result (e.g. mm/day → mm/yr for precipitation totals). */
export function resultAnnualUnit(r: AnalysisResult, v: Variable): string {
  return (r as AnalysisResult & { annualUnit?: string }).annualUnit ?? annualUnit(v.unit, v.annualAgg, v.annualSumFactor);
}

/**
 * Trend line for the ANNUAL series using the headline (summary) slope.
 * Sen: intercept from Sen (median-based). Otherwise the line passes through
 * the centroid of the annual values (exact for OLS).
 */
export function annualTrendOverlay(r: AnalysisResult, label?: string): TrendOverlay {
  const s = r.summary;
  const slope = s.perDecade / 10;
  const valid = r.annual.filter((p) => p.v !== null) as { t: number; v: number }[];
  const meanT = valid.reduce((a, p) => a + p.t, 0) / Math.max(1, valid.length);
  const meanV = valid.reduce((a, p) => a + p.v, 0) / Math.max(1, valid.length);
  const usesSen = /sen/i.test(s.method);
  const intercept = usesSen ? r.sen.intercept : meanV - slope * meanT;
  return {
    slopePerYear: slope,
    intercept,
    ciLow: s.perDecadeCi[0] / 10,
    ciHigh: s.perDecadeCi[1] / 10,
    significant: s.significant,
    label: label ?? (usesSen ? "Sen's slope" : "OLS trend"),
    direction: s.direction,
    meanT: usesSen ? undefined : meanT,
  };
}
