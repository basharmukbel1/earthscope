/**
 * Ordinary least-squares trend estimation with Student-t inference, and the
 * AR(1) effective-sample-size adjustment of Santer et al. (2000) for
 * serially correlated residuals.
 *
 * @module stats/ols
 */
import type { OlsResult, Point } from "../types/domain";
import { studentTQuantile, studentTTwoSidedP } from "./distributions";
import { InsufficientDataError } from "./errors";
import { isValidValue, lag1Autocorrelation, type MaybeNumber } from "./series";

interface FitCore {
  n: number;
  slope: number;
  intercept: number;
  /** Σ(x − x̄)² */
  sxx: number;
  /** Residual sum of squares. */
  sse: number;
  /** Total sum of squares Σ(y − ȳ)². */
  sst: number;
}

function pairs(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): { xs: number[]; ys: number[] } {
  if (x.length !== y.length) throw new RangeError(`x and y must have the same length (${x.length} vs ${y.length})`);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    const b = y[i];
    if (isValidValue(a) && isValidValue(b)) {
      xs.push(a);
      ys.push(b);
    }
  }
  return { xs, ys };
}

function fitCore(xs: number[], ys: number[]): FitCore {
  const n = xs.length;
  if (n < 3) throw new InsufficientDataError(`OLS needs at least 3 valid points (got ${n})`, 3, n);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    sst += dy * dy;
  }
  if (!(sxx > 0)) throw new InsufficientDataError("OLS needs at least two distinct x (time) values", 3, n);
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    sse += r * r;
  }
  return { n, slope, intercept, sxx, sse, sst };
}

/** t statistic, p and CI that never produce NaN (se = 0 handled explicitly). */
function inference(slope: number, se: number, df: number, alpha: number) {
  let t: number;
  let p: number;
  if (se > 0) {
    t = slope / se;
    p = studentTTwoSidedP(t, df);
  } else if (slope === 0) {
    t = 0;
    p = 1;
  } else {
    t = slope > 0 ? Infinity : -Infinity;
    p = 0;
  }
  const q = studentTQuantile(1 - alpha / 2, df);
  const half = se > 0 ? q * se : 0;
  return { t, p, ciLow: slope - half, ciHigh: slope + half };
}

function checkAlpha(alpha: number): void {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
}

/**
 * Ordinary least-squares regression y = intercept + slope·x with classical
 * inference: standard error se = sqrt(SSE/(n−2) / Σ(x−x̄)²), t = slope/se,
 * two-sided p from Student's t with n − 2 df, and a (1 − alpha) confidence
 * interval slope ± t_{1−α/2, n−2}·se (e.g. Wilks 2011, "Statistical Methods
 * in the Atmospheric Sciences", 3rd ed., §7.2). Matches `scipy.stats.linregress`.
 *
 * Pairs where x or y is missing are ignored. When x is time in decimal years
 * the slope is in units per year.
 *
 * @throws InsufficientDataError with fewer than 3 valid pairs or constant x.
 */
export function ols(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>, alpha = 0.05): OlsResult {
  checkAlpha(alpha);
  const { xs, ys } = pairs(x, y);
  const f = fitCore(xs, ys);
  const df = f.n - 2;
  const se = df > 0 ? Math.sqrt(f.sse / df / f.sxx) : 0;
  const inf = inference(f.slope, se, df, alpha);
  return {
    method: "ols",
    n: f.n,
    slope: f.slope,
    intercept: f.intercept,
    se,
    t: inf.t,
    df,
    p: inf.p,
    ciLow: inf.ciLow,
    ciHigh: inf.ciHigh,
    r2: f.sst > 0 ? Math.max(0, 1 - f.sse / f.sst) : 0,
    adjusted: false,
  };
}

/**
 * OLS trend with the AR(1) effective-sample-size correction of Santer et al.
 * (2000), "Statistical significance of trends and trend differences in
 * layer-average atmospheric temperature time series", JGR 105(D6):7337–7356.
 *
 * Procedure:
 *  1. Fit OLS of v on t (decimal years) using the non-null points.
 *  2. r1 = lag-1 autocorrelation of the residuals, computed on the evenly
 *     spaced residual sequence (gaps stay as gaps; only time-adjacent pairs
 *     count — see {@link lag1Autocorrelation}). `points` must therefore be on
 *     a regular grid (e.g. consecutive months, or consecutive years).
 *  3. If r1 > 0: n_eff = n(1 − r1)/(1 + r1), floored at 3 (so df ≥ 1);
 *     se is inflated by sqrt((n − 2)/(n_eff − 2)); df = n_eff − 2 (fractional);
 *     p and the CI use Student's t with that df. If r1 ≤ 0 no adjustment is
 *     made (adjusted = false, n_eff = n).
 *
 * The returned `r1` and `nEff` are always populated.
 *
 * @throws InsufficientDataError with fewer than 3 valid points.
 */
export function olsAR1(points: readonly Point[], alpha = 0.05): OlsResult {
  checkAlpha(alpha);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    if (isValidValue(p.v) && isValidValue(p.t)) {
      xs.push(p.t);
      ys.push(p.v);
    }
  }
  const f = fitCore(xs, ys);
  const n = f.n;
  const residuals = points.map((p) => (isValidValue(p.v) && isValidValue(p.t) ? p.v - (f.intercept + f.slope * p.t) : null));
  const r1 = lag1Autocorrelation(residuals);
  const se0 = Math.sqrt(f.sse / (n - 2) / f.sxx);
  let nEff = n;
  let se = se0;
  let df = n - 2;
  let adjusted = false;
  if (r1 > 0) {
    nEff = Math.min(n, Math.max(3, (n * (1 - r1)) / (1 + r1)));
    se = se0 * Math.sqrt((n - 2) / (nEff - 2));
    df = nEff - 2;
    adjusted = true;
  }
  const inf = inference(f.slope, se, df, alpha);
  return {
    method: "ols",
    n,
    slope: f.slope,
    intercept: f.intercept,
    se,
    t: inf.t,
    df,
    p: inf.p,
    ciLow: inf.ciLow,
    ciHigh: inf.ciHigh,
    r2: f.sst > 0 ? Math.max(0, 1 - f.sse / f.sst) : 0,
    r1,
    nEff,
    adjusted,
  };
}

/** Fitted value of a linear trend result at time t: intercept + slope·t. */
export function predictLinear(fit: { slope: number; intercept: number }, t: number): number {
  return fit.intercept + fit.slope * t;
}

/** Residuals v − (intercept + slope·t) for each point (null where v is missing). */
export function linearResiduals(points: readonly Point[], fit: { slope: number; intercept: number }): Point[] {
  return points.map((p) => ({
    t: p.t,
    date: p.date,
    v: isValidValue(p.v) ? p.v - (fit.intercept + fit.slope * p.t) : null,
  }));
}
