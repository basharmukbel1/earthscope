/**
 * Seasonal Kendall trend test and seasonal Kendall slope estimator
 * (Hirsch, Slack & Smith 1982).
 *
 * @module stats/seasonalKendall
 */
import type { Point, SeasonalKendallResult } from "../types/domain";
import { InsufficientDataError } from "./errors";
import { mkScore, mkVarianceS, mkZ, twoSidedNormalP } from "./mannKendall";
import { isValidValue, yearMonthOf } from "./series";

/** Per-calendar-month Mann–Kendall statistics. */
export interface SeasonStats {
  /** Calendar month 1–12. */
  month: number;
  /** Number of valid values for this month. */
  n: number;
  s: number;
  varS: number;
  /** Theil–Sen slope of this month alone (units per year), NaN if n < 2. */
  slope: number;
}

function groupByMonth(points: readonly Point[]): { t: number[]; v: number[] }[] {
  const groups = Array.from({ length: 12 }, () => [] as { t: number; v: number }[]);
  for (const p of points) {
    if (!isValidValue(p.v) || !isValidValue(p.t)) continue;
    groups[yearMonthOf(p).month - 1].push({ t: p.t, v: p.v });
  }
  return groups.map((g) => {
    g.sort((a, b) => a.t - b.t);
    return { t: g.map((x) => x.t), v: g.map((x) => x.v) };
  });
}

function pairwiseSlopes(t: number[], v: number[], out: number[]): void {
  for (let i = 0; i < v.length - 1; i++) {
    for (let j = i + 1; j < v.length; j++) {
      const dt = t[j] - t[i];
      if (dt !== 0) out.push((v[j] - v[i]) / dt);
    }
  }
}

function medianSorted(xs: number[]): number {
  if (xs.length === 0) return NaN;
  xs.sort((a, b) => a - b);
  const h = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[h] : 0.5 * (xs[h - 1] + xs[h]);
}

/**
 * Mann–Kendall statistics and Sen slope for each calendar month separately
 * (useful for showing which seasons drive a trend).
 */
export function seasonalKendallBySeason(monthlyPoints: readonly Point[]): SeasonStats[] {
  return groupByMonth(monthlyPoints).map((g, i) => {
    const slopes: number[] = [];
    pairwiseSlopes(g.t, g.v, slopes);
    return {
      month: i + 1,
      n: g.v.length,
      s: g.v.length >= 2 ? mkScore(g.v) : 0,
      varS: g.v.length >= 2 ? mkVarianceS(g.v) : 0,
      slope: medianSorted(slopes),
    };
  });
}

/** {@link SeasonalKendallResult} plus the significance decision. */
export type SeasonalKendallTestResult = SeasonalKendallResult & {
  alpha: number;
  significant: boolean;
  /** Number of calendar months that contributed (n ≥ 2). */
  nSeasons: number;
};

/**
 * Seasonal Kendall test of Hirsch, Slack & Smith (1982), "Techniques of trend
 * analysis for monthly water quality data", Water Resources Research
 * 18(1):107–121.
 *
 * Values are grouped by calendar month (from `date`, or from t), a
 * Mann–Kendall S and ties-corrected Var(S) are computed within each month (in
 * time order), and both are summed over the 12 months:
 *   S = Σ_m S_m,  Var(S) = Σ_m Var(S_m),  Z = (S ∓ 1)/√Var(S) (continuity
 *   corrected),  p = 2·P(N(0,1) > |Z|).
 * The seasonal Kendall slope is the median of all WITHIN-month pairwise
 * slopes (v_j − v_i)/(t_j − t_i) using actual decimal-year t (units per year).
 *
 * Note: this is the original 1982 form, which ignores covariance BETWEEN
 * seasons (it assumes the 12 monthly sub-series are mutually independent).
 * With strong serial correlation the p-value can be too small; Hirsch & Slack
 * (1984, WRR 20(6):727–732) give a covariance-corrected variant.
 * Matches `pymannkendall.seasonal_test(x, period=12)` for series that start
 * in January.
 *
 * @throws InsufficientDataError when no calendar month has at least 2 values.
 */
export function seasonalKendall(monthlyPoints: readonly Point[], alpha = 0.05): SeasonalKendallTestResult {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  const groups = groupByMonth(monthlyPoints);
  let s = 0;
  let varS = 0;
  let n = 0;
  let nSeasons = 0;
  const slopes: number[] = [];
  for (const g of groups) {
    n += g.v.length;
    if (g.v.length < 2) continue;
    nSeasons++;
    s += mkScore(g.v);
    varS += mkVarianceS(g.v);
    pairwiseSlopes(g.t, g.v, slopes);
  }
  if (nSeasons === 0 || slopes.length === 0) {
    throw new InsufficientDataError("Seasonal Kendall needs at least 2 years of data for some calendar month", 2, 0);
  }
  const z = mkZ(s, varS);
  const p = twoSidedNormalP(z);
  return {
    method: "seasonal-kendall",
    n,
    s,
    varS,
    z,
    p,
    slope: medianSorted(slopes),
    alpha,
    significant: p < alpha,
    nSeasons,
  };
}
