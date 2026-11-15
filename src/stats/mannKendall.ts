/**
 * Mann–Kendall non-parametric trend test (Mann 1945; Kendall 1975) and the
 * Hamed & Rao (1998) variance correction for autocorrelated data.
 *
 * Results match `pymannkendall.original_test` and
 * `pymannkendall.hamed_rao_modification_test` (Hussain & Mahmud 2019, JOSS
 * 4(39):1556), except that two-sided p-values here are computed as
 * 2·normalSf(|Z|) via erfc, which stays accurate for very small p where
 * pymannkendall's 2·(1 − Φ(|Z|)) underflows to 0.
 *
 * @module stats/mannKendall
 */
import type { MannKendallResult } from "../types/domain";
import { normalQuantile, normalSf } from "./distributions";
import { InsufficientDataError } from "./errors";
import { isValidValue, rankAverage, type MaybeNumber } from "./series";

/**
 * Mann–Kendall score S = Σ_{i<j} sign(x_j − x_i) for values in time order.
 * Tied pairs contribute 0.
 */
export function mkScore(x: readonly number[]): number {
  let s = 0;
  const n = x.length;
  for (let i = 0; i < n - 1; i++) {
    const xi = x[i];
    for (let j = i + 1; j < n; j++) {
      const d = x[j] - xi;
      if (d > 0) s++;
      else if (d < 0) s--;
    }
  }
  return s;
}

/**
 * Variance of S under H0 with the correction for tied groups (Kendall 1975;
 * Gilbert 1987 eq. 16.4):
 *   Var(S) = [n(n−1)(2n+5) − Σ_p t_p(t_p−1)(2t_p+5)] / 18
 * where t_p is the size of the p-th group of exactly equal values.
 */
export function mkVarianceS(x: readonly number[]): number {
  const n = x.length;
  const counts = new Map<number, number>();
  for (const v of x) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tie = 0;
  counts.forEach((t) => {
    if (t > 1) tie += t * (t - 1) * (2 * t + 5);
  });
  return (n * (n - 1) * (2 * n + 5) - tie) / 18;
}

/**
 * Standardised MK statistic with continuity correction:
 *   Z = (S − 1)/√Var(S) if S > 0;  0 if S = 0;  (S + 1)/√Var(S) if S < 0.
 * Returns 0 when Var(S) = 0 (all values tied).
 */
export function mkZ(s: number, varS: number): number {
  if (!(varS > 0) || s === 0) return 0;
  return s > 0 ? (s - 1) / Math.sqrt(varS) : (s + 1) / Math.sqrt(varS);
}

/** Two-sided normal p-value 2·P(Z > |z|), computed via erfc (no cancellation). */
export function twoSidedNormalP(z: number): number {
  return Math.min(1, 2 * normalSf(Math.abs(z)));
}

/** {@link MannKendallResult} plus the significance decision at `alpha`. */
export type MannKendallTestResult = MannKendallResult & {
  alpha: number;
  /** p < alpha */
  significant: boolean;
};

function checkAlpha(alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
}

/**
 * Original Mann–Kendall trend test (Mann 1945, Econometrica 13:245–259;
 * Kendall 1975, "Rank Correlation Methods"; Gilbert 1987, "Statistical Methods
 * for Environmental Pollution Monitoring", §16.4).
 *
 * Missing values (null/NaN) are dropped and the remaining values are used in
 * their original (time) order. Computes S, the ties-corrected Var(S), the
 * continuity-corrected Z, the two-sided p = 2·P(N(0,1) > |Z|) and Kendall's
 * tau = S / (n(n−1)/2) — identical to `pymannkendall.original_test`.
 *
 * Assumes serially independent data; see {@link hamedRaoMannKendall} for an
 * autocorrelation-robust variant.
 *
 * @throws InsufficientDataError with fewer than 3 valid values.
 */
export function mannKendall(values: ArrayLike<MaybeNumber>, alpha = 0.05): MannKendallTestResult {
  checkAlpha(alpha);
  const x: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isValidValue(v)) x.push(v);
  }
  const n = x.length;
  if (n < 3) throw new InsufficientDataError(`Mann-Kendall needs at least 3 valid values (got ${n})`, 3, n);
  const s = mkScore(x);
  const varS = mkVarianceS(x);
  const z = mkZ(s, varS);
  const p = twoSidedNormalP(z);
  return { method: "mann-kendall", n, s, varS, z, p, tau: s / ((n * (n - 1)) / 2), alpha, significant: p < alpha };
}

/** Result of {@link hamedRaoMannKendall}. `varS` is the CORRECTED variance. */
export interface HamedRaoResult extends Omit<MannKendallResult, "method"> {
  method: "mann-kendall-hamed-rao";
  /** Uncorrected (ties-corrected only) Var(S). */
  varSOriginal: number;
  /** Variance inflation factor n/n*_s = 1 + 2/(n(n−1)(n−2)) Σ (n−i)(n−i−1)(n−i−2) ρ_s(i). */
  correction: number;
  /** Lags whose rank autocorrelation was significant and therefore included. */
  significantLags: number[];
  /** Sen slope (units per time unit of `t`) used for detrending. */
  detrendSlope: number;
  alpha: number;
  significant: boolean;
  /** True if the correction came out ≤ 0 (pathological) and was reset to 1. */
  correctionReset: boolean;
}

/** Options for {@link hamedRaoMannKendall}. */
export interface HamedRaoOptions {
  /**
   * Time coordinate aligned with `values` (same length) used to estimate the
   * Sen slope for detrending. Default: the array index 0, 1, 2, … (so gaps
   * keep their position), which matches pymannkendall for gap-free data.
   */
  t?: ArrayLike<number>;
  /**
   * Maximum lag of the rank ACF to consider. Default: all lags (n − 1), as in
   * pymannkendall; Hamed & Rao suggest 3 as an alternative.
   */
  lag?: number;
  /**
   * Lower bound for the variance correction n/n*_s. Default: none (as in
   * pymannkendall, so spurious negative rank autocorrelations may SHRINK
   * Var(S)). Use 1 to only ever inflate Var(S).
   */
  minCorrection?: number;
}

/** Average ranks where values closer than `eps` to their group's first value count as ties. */
function rankAverageWithTolerance(values: readonly number[], eps: number): number[] {
  if (!(eps > 0)) return rankAverage(values);
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] - values[idx[i]] <= eps) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  return ranks;
}

/** Median of pairwise slopes (Theil–Sen) for internal detrending. */
function senMedian(t: number[], x: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) {
      const dt = t[j] - t[i];
      if (dt !== 0) slopes.push((x[j] - x[i]) / dt);
    }
  }
  if (slopes.length === 0) return 0;
  slopes.sort((a, b) => a - b);
  const h = slopes.length >> 1;
  return slopes.length % 2 === 1 ? slopes[h] : 0.5 * (slopes[h - 1] + slopes[h]);
}

/**
 * Modified Mann–Kendall test of Hamed & Rao (1998), "A modified Mann-Kendall
 * trend test for autocorrelated data", J. Hydrology 204:182–196.
 *
 * The series is detrended with the Sen slope, ranked, and the significant
 * lag-i autocorrelations ρ_s(i) of the ranks (outside ±z_{1−α/2}/√n) inflate
 * Var(S) by n/n*_s = 1 + 2/(n(n−1)(n−2)) Σ_i (n−i)(n−i−1)(n−i−2) ρ_s(i).
 * Z and p are then recomputed with the corrected variance. Follows
 * `pymannkendall.hamed_rao_modification_test` (same S, tau, Var(S), Z for
 * gap-free input); with gaps, detrending uses the original time positions.
 *
 * Caution (our Monte-Carlo check, 1000 white-noise series of n = 40): with the
 * pymannkendall defaults (all lags, correction may be < 1) the test rejects
 * ≈ 7.6 % at α = 0.05, because sampling-noise "significant" lags can shrink
 * Var(S). With `{ lag: 3, minCorrection: 1 }` the white-noise rate is ≈ 3.7 %
 * (same as the original test) and the false-positive inflation under AR(1)
 * noise is reduced the most (φ = 0.5: 22 % → 14 %); `analyzeSeries` uses that
 * setting. No variant fully removes the inflation for short, strongly
 * autocorrelated series.
 *
 * @throws InsufficientDataError with fewer than 3 valid values.
 */
export function hamedRaoMannKendall(values: ArrayLike<MaybeNumber>, alpha = 0.05, opts: HamedRaoOptions = {}): HamedRaoResult {
  checkAlpha(alpha);
  if (opts.t && opts.t.length !== values.length) throw new RangeError("t and values must have the same length");
  const x: number[] = [];
  const tt: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const ti = opts.t ? opts.t[i] : i;
    if (isValidValue(v) && isValidValue(ti)) {
      x.push(v);
      tt.push(ti);
    }
  }
  const n = x.length;
  if (n < 3) throw new InsufficientDataError(`Mann-Kendall needs at least 3 valid values (got ${n})`, 3, n);
  const s = mkScore(x);
  const varSOriginal = mkVarianceS(x);
  const tau = s / ((n * (n - 1)) / 2);

  const slope = senMedian(tt, x);
  // Detrend relative to the first time (shift-invariant). The Sen slope is the
  // slope between a median pair of points, so that pair's detrended values are
  // mathematically tied; snap rounding-level differences to exact ties so the
  // ranks do not depend on floating-point noise.
  const t0 = tt[0];
  const detrended = x.map((v, i) => v - slope * (tt[i] - t0));
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(x[i]), Math.abs(slope * (tt[i] - t0)));
  const ranks = rankAverageWithTolerance(detrended, 1e-12 * scale);
  const rm = ranks.reduce((a, b) => a + b, 0) / n;
  const y = ranks.map((r) => r - rm);
  let c0 = 0;
  for (const v of y) c0 += v * v;
  const maxLag = Math.min(n - 1, opts.lag ?? n - 1);
  const bound = normalQuantile(1 - alpha / 2) / Math.sqrt(n);
  let sum = 0;
  const significantLags: number[] = [];
  if (c0 > 0) {
    for (let k = 1; k <= maxLag; k++) {
      let ck = 0;
      for (let i = 0; i + k < n; i++) ck += y[i] * y[i + k];
      const rho = ck / c0;
      if (rho > bound || rho < -bound) {
        significantLags.push(k);
        sum += (n - k) * (n - k - 1) * (n - k - 2) * rho;
      }
    }
  }
  let correction = 1 + (2 / (n * (n - 1) * (n - 2))) * sum;
  let correctionReset = false;
  if (!(correction > 0)) {
    correction = 1;
    correctionReset = true;
  }
  if (opts.minCorrection !== undefined) correction = Math.max(correction, opts.minCorrection);
  const varS = varSOriginal * correction;
  const z = mkZ(s, varS);
  const p = twoSidedNormalP(z);
  return {
    method: "mann-kendall-hamed-rao",
    n,
    s,
    varS,
    z,
    p,
    tau,
    varSOriginal,
    correction,
    significantLags,
    detrendSlope: slope,
    alpha,
    significant: p < alpha,
    correctionReset,
  };
}
