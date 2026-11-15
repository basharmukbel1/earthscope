/**
 * Theil–Sen slope estimator with the Gilbert (1987) non-parametric
 * confidence interval.
 *
 * @module stats/sen
 */
import type { SenResult } from "../types/domain";
import { normalQuantile } from "./distributions";
import { InsufficientDataError } from "./errors";
import { mkVarianceS } from "./mannKendall";
import { isValidValue, median, type MaybeNumber } from "./series";

/** Options for {@link senSlope}. */
export interface SenOptions {
  /**
   * How the fractional CI ranks M1 and M2 are turned into slopes:
   *  - "interpolate" (default): linear interpolation between adjacent ordered
   *    slopes at the fractional rank.
   *  - "nearest": round to the nearest integer rank (as `scipy.stats.theilslopes`
   *    and R `trend::sens.slope` do).
   */
  rankMethod?: "interpolate" | "nearest";
}

/** {@link SenResult} plus details of the CI construction. */
export type SenSlopeResult = SenResult & {
  alpha: number;
  /** Number of pairwise slopes N′. */
  nSlopes: number;
  /** Ties-corrected Var(S) used for the CI. */
  varS: number;
};

/**
 * Value at a 1-based (possibly fractional) rank of an ascending array,
 * clamped to [1, N].
 */
function atRank(sorted: Float64Array, rank: number, method: "interpolate" | "nearest"): number {
  const N = sorted.length;
  let r = Math.min(Math.max(rank, 1), N);
  if (method === "nearest") r = Math.min(Math.max(Math.round(r), 1), N);
  const lo = Math.floor(r);
  const f = r - lo;
  if (lo >= N || f === 0) return sorted[lo - 1];
  return sorted[lo - 1] + f * (sorted[lo] - sorted[lo - 1]);
}

/**
 * Theil–Sen slope (Theil 1950; Sen 1968, JASA 63:1379–1389): the median of
 * all pairwise slopes (v_j − v_i)/(t_j − t_i), i < j, using the ACTUAL time
 * coordinate t (decimal years → units per year), so gaps are handled
 * correctly. Pairs with equal t are skipped; missing v are ignored.
 *
 * Confidence interval after Gilbert (1987), "Statistical Methods for
 * Environmental Pollution Monitoring", §16.4.3:
 *   C = z_{1−α/2} · √Var(S)    (Var(S) ties-corrected, as in Mann–Kendall)
 *   M1 = (N′ − C)/2,  M2 = (N′ + C)/2 + 1
 * and the limits are the M1-th and M2-th smallest of the N′ ordered slopes
 * (1-based ranks; fractional ranks interpolated by default, clamped to [1, N′]).
 *
 * Intercept (Conover 1980): median(v) − slope · median(t).
 *
 * With unit-spaced t (0, 1, 2, …) the slope and intercept equal
 * `pymannkendall.sens_slope`; with rankMethod "nearest" the CI equals
 * `scipy.stats.theilslopes`.
 *
 * @throws InsufficientDataError with fewer than 3 valid points.
 */
export function senSlope(
  t: ArrayLike<MaybeNumber>,
  v: ArrayLike<MaybeNumber>,
  alpha = 0.05,
  opts: SenOptions = {},
): SenSlopeResult {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  if (t.length !== v.length) throw new RangeError(`t and v must have the same length (${t.length} vs ${v.length})`);
  const ts: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i < v.length; i++) {
    const a = t[i];
    const b = v[i];
    if (isValidValue(a) && isValidValue(b)) {
      ts.push(a);
      vs.push(b);
    }
  }
  const n = vs.length;
  if (n < 3) throw new InsufficientDataError(`Sen's slope needs at least 3 valid points (got ${n})`, 3, n);
  const buf = new Float64Array((n * (n - 1)) / 2);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = ts[j] - ts[i];
      if (dt !== 0) buf[k++] = (vs[j] - vs[i]) / dt;
    }
  }
  if (k === 0) throw new InsufficientDataError("Sen's slope needs at least two distinct time values", 3, n);
  const slopes = buf.subarray(0, k).sort();
  const N = slopes.length;
  const h = N >> 1;
  const slope = N % 2 === 1 ? slopes[h] : 0.5 * (slopes[h - 1] + slopes[h]);
  const varS = mkVarianceS(vs);
  const C = normalQuantile(1 - alpha / 2) * Math.sqrt(Math.max(0, varS));
  const method = opts.rankMethod ?? "interpolate";
  const ciLow = atRank(slopes, (N - C) / 2, method);
  const ciHigh = atRank(slopes, (N + C) / 2 + 1, method);
  return {
    method: "sen",
    n,
    slope,
    intercept: median(vs) - slope * median(ts),
    ciLow,
    ciHigh,
    alpha,
    nSlopes: N,
    varS,
  };
}
