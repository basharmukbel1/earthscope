/**
 * Correlation analysis: Pearson and Spearman coefficients with t-test
 * p-values, the Bretherton et al. (1999) effective sample size for
 * autocorrelated series, lagged cross-correlation and correlation matrices.
 *
 * All functions take ALIGNED arrays (same time grid, same length) in which
 * missing values are null; only pairs where both values are present are used.
 *
 * @module stats/correlation
 */
import { studentTTwoSidedP } from "./distributions";
import { InsufficientDataError, isInsufficientDataError } from "./errors";
import { isValidValue, lag1Autocorrelation, rankAverage, type MaybeNumber } from "./series";

/** Result of a correlation test. */
export interface CorrelationResult {
  method: "pearson" | "spearman";
  /** Correlation coefficient in [−1, 1]. */
  r: number;
  /** Number of complete (x, y) pairs. */
  n: number;
  /** t statistic r·√(df/(1 − r²)). */
  t: number;
  /** Degrees of freedom: n − 2, or n_eff − 2 when an effective N is used. */
  df: number;
  /** Two-sided p-value from Student's t with `df`. */
  p: number;
  /** Effective sample size used for the test (= n when unadjusted). */
  nEff: number;
}

/** Options for {@link pearson} / {@link spearman}. */
export interface CorrelationOptions {
  /**
   * Effective sample size for the significance test:
   *  - a number: used directly (clamped to [3, n]);
   *  - "bretherton": n_eff from {@link brethertonNEff} (lag-1 autocorrelations);
   *  - undefined (default): n (assumes independent pairs).
   */
  effectiveN?: number | "bretherton";
}

function completePairs(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): { xs: number[]; ys: number[] } {
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

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (!(sxx > 0) || !(syy > 0)) throw new InsufficientDataError("Correlation is undefined when a series has zero variance", 3, n);
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

/** Copy x with null wherever the (x, y) pair is incomplete. */
function maskIncomplete(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    out.push(isValidValue(a) && isValidValue(y[i]) ? a : null);
  }
  return out;
}

/**
 * Effective sample size for the correlation of two autocorrelated series,
 * Bretherton et al. (1999), "The effective number of spatial degrees of
 * freedom of a time-varying field", J. Climate 12:1990–2009, eq. 31:
 *   n_eff = n (1 − r1x·r1y) / (1 + r1x·r1y)
 * where r1x, r1y are lag-1 autocorrelations (computed on the complete-pair
 * sequences, gap-aware). Clamped to [3, n] (so df ≥ 1 and never above n).
 */
export function brethertonNEff(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): number {
  const mx = maskIncomplete(x, y);
  const my = maskIncomplete(y, x);
  const n = mx.filter((v) => v !== null).length;
  const prod = lag1Autocorrelation(mx) * lag1Autocorrelation(my);
  const raw = prod >= 1 ? 3 : (n * (1 - prod)) / (1 + prod);
  return Math.min(n, Math.max(3, raw));
}

function testR(method: "pearson" | "spearman", r: number, n: number, nEff: number): CorrelationResult {
  const df = nEff - 2;
  let t: number;
  let p: number;
  if (Math.abs(r) >= 1) {
    t = r > 0 ? Infinity : -Infinity;
    p = 0;
  } else {
    t = r * Math.sqrt(df / (1 - r * r));
    p = studentTTwoSidedP(t, df);
  }
  return { method, r, n, t, df, p, nEff };
}

function resolveNEff(opts: CorrelationOptions, n: number, x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): number {
  if (opts.effectiveN === undefined) return n;
  if (opts.effectiveN === "bretherton") return brethertonNEff(x, y);
  return Math.min(n, Math.max(3, opts.effectiveN));
}

/**
 * Pearson product-moment correlation with a two-sided t-test
 * (t = r√(df/(1−r²)), df = n − 2; identical to `scipy.stats.pearsonr`).
 * With `effectiveN` the test uses df = n_eff − 2 instead (e.g. Bretherton
 * et al. 1999 for autocorrelated series), which is essential for monthly
 * climate anomalies.
 *
 * @throws InsufficientDataError with < 3 complete pairs or zero variance.
 */
export function pearson(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>, opts: CorrelationOptions = {}): CorrelationResult {
  const { xs, ys } = completePairs(x, y);
  const n = xs.length;
  if (n < 3) throw new InsufficientDataError(`Correlation needs at least 3 complete pairs (got ${n})`, 3, n);
  return testR("pearson", pearsonR(xs, ys), n, resolveNEff(opts, n, x, y));
}

/**
 * Spearman rank correlation (Spearman 1904): Pearson correlation of average
 * ranks (ties share their mean rank), with the same t-test approximation as
 * `scipy.stats.spearmanr` (df = n − 2, or n_eff − 2 with `effectiveN`).
 *
 * @throws InsufficientDataError with < 3 complete pairs or all-tied input.
 */
export function spearman(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>, opts: CorrelationOptions = {}): CorrelationResult {
  const { xs, ys } = completePairs(x, y);
  const n = xs.length;
  if (n < 3) throw new InsufficientDataError(`Correlation needs at least 3 complete pairs (got ${n})`, 3, n);
  const r = pearsonR(rankAverage(xs), rankAverage(ys));
  return testR("spearman", r, n, resolveNEff(opts, n, x, y));
}

/** One row of a lagged cross-correlation analysis. */
export interface LagCorrelationRow {
  /** Lag in time steps. POSITIVE lag = y LAGS x (x[i] is paired with y[i + lag]). */
  lag: number;
  r: number;
  /** Complete pairs at this lag. */
  n: number;
  /** Effective sample size used for p. */
  nEff: number;
  /** Two-sided p-value at this lag. */
  p: number;
  /** Bonferroni-adjusted p = min(1, p × number of lags tested). */
  pBonferroni: number;
  /** pBonferroni < alpha. */
  significant: boolean;
}

/** Options for {@link lagCorrelation}. */
export interface LagCorrelationOptions {
  alpha?: number;
  method?: "pearson" | "spearman";
  /** "bretherton" (default) adjusts each lag's test for autocorrelation; "none" assumes independence. */
  effectiveN?: "bretherton" | "none";
}

/**
 * Lagged cross-correlation for lags −maxLag … +maxLag on two aligned, evenly
 * spaced series. Sign convention: at lag k > 0, x[i] is paired with y[i + k],
 * i.e. y LAGS x by k steps (x leads). A peak at positive lag therefore suggests
 * x changes first.
 *
 * Each lag's p-value uses (by default) the Bretherton et al. (1999) effective
 * sample size, and the family of 2·maxLag + 1 tests is controlled with a
 * Bonferroni correction (`pBonferroni`, `significant`). Lags with fewer than 3
 * complete pairs or zero variance give r = NaN, p = NaN, significant = false.
 */
export function lagCorrelation(
  x: ArrayLike<MaybeNumber>,
  y: ArrayLike<MaybeNumber>,
  maxLag = 12,
  opts: LagCorrelationOptions = {},
): LagCorrelationRow[] {
  if (x.length !== y.length) throw new RangeError(`x and y must have the same length (${x.length} vs ${y.length})`);
  const alpha = opts.alpha ?? 0.05;
  const method = opts.method ?? "pearson";
  const eff = opts.effectiveN ?? "bretherton";
  const L = Math.max(0, Math.floor(maxLag));
  const nTests = 2 * L + 1;
  const len = x.length;
  const rows: LagCorrelationRow[] = [];
  for (let lag = -L; lag <= L; lag++) {
    const xs: MaybeNumber[] = [];
    const ys: MaybeNumber[] = [];
    for (let i = Math.max(0, -lag); i < len && i + lag < len; i++) {
      xs.push(x[i]);
      ys.push(y[i + lag]);
    }
    try {
      const fn = method === "spearman" ? spearman : pearson;
      const res = fn(xs, ys, eff === "bretherton" ? { effectiveN: "bretherton" } : {});
      const pB = Math.min(1, res.p * nTests);
      rows.push({ lag, r: res.r, n: res.n, nEff: res.nEff, p: res.p, pBonferroni: pB, significant: pB < alpha });
    } catch (e) {
      if (!isInsufficientDataError(e)) throw e;
      const n = completePairs(xs, ys).xs.length;
      rows.push({ lag, r: NaN, n, nEff: NaN, p: NaN, pBonferroni: NaN, significant: false });
    }
  }
  return rows;
}

/** Correlation matrix output (row/column order = `labels`). */
export interface CorrelationMatrix {
  labels: string[];
  /** r[i][j]; diagonal = 1 (NaN if undefined). */
  r: number[][];
  /** p[i][j]; diagonal = 0. NaN where undefined. */
  p: number[][];
  /** Complete pairs n[i][j]. */
  n: number[][];
}

/**
 * Pairwise correlation matrix of several aligned series (pairwise-complete
 * observations). Undefined entries (too few pairs, zero variance) are NaN.
 *
 * @param series either a record { label: values } or an array of { label, values }.
 */
export function correlationMatrix(
  series: Record<string, ArrayLike<MaybeNumber>> | ReadonlyArray<{ label: string; values: ArrayLike<MaybeNumber> }>,
  opts: CorrelationOptions & { method?: "pearson" | "spearman" } = {},
): CorrelationMatrix {
  const list = Array.isArray(series)
    ? (series as ReadonlyArray<{ label: string; values: ArrayLike<MaybeNumber> }>)
    : Object.entries(series as Record<string, ArrayLike<MaybeNumber>>).map(([label, values]) => ({ label, values }));
  const k = list.length;
  const r = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  const p = Array.from({ length: k }, () => new Array<number>(k).fill(NaN));
  const n = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const fn = opts.method === "spearman" ? spearman : pearson;
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const cnt = completePairs(list[i].values, list[j].values).xs.length;
      n[i][j] = n[j][i] = cnt;
      if (i === j) {
        r[i][i] = cnt >= 2 ? 1 : NaN;
        p[i][i] = cnt >= 2 ? 0 : NaN;
        continue;
      }
      try {
        const res = fn(list[i].values, list[j].values, { effectiveN: opts.effectiveN });
        r[i][j] = r[j][i] = res.r;
        p[i][j] = p[j][i] = res.p;
      } catch (e) {
        if (!isInsufficientDataError(e)) throw e;
      }
    }
  }
  return { labels: list.map((s) => s.label), r, p, n };
}
