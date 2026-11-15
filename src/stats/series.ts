/**
 * Time-series utilities: calendar helpers, climatology, deseasonalised
 * anomalies, annual aggregation, smoothing, missing-data diagnostics and basic
 * descriptive statistics.
 *
 * Conventions (shared by the whole stats engine):
 *  - Monthly points use t = year + (month − 0.5)/12 (decimal year, mid-month).
 *  - Annual points use t = year + 0.5 and date "YYYY".
 *  - Missing values are `null`; non-finite numbers (NaN, ±Infinity) are also
 *    treated as missing everywhere.
 *  - Slopes are always computed against t (decimal years), never the array
 *    index, so gaps do not distort trends.
 *
 * @module stats/series
 */
import type { Point } from "../types/domain";

/** Numeric input that may contain missing values. */
export type MaybeNumber = number | null | undefined;

/** True when `v` is a finite number (i.e. not null/undefined/NaN/±Infinity). */
export function isValidValue(v: MaybeNumber): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/* ------------------------------------------------------------ calendar ---- */

/**
 * Decimal-year time coordinate at mid-month: year + (month − 0.5)/12.
 * E.g. decimalYear(2001, 1) = 2001.041666…, decimalYear(2001, 12) = 2001.958333….
 */
export function decimalYear(year: number, month: number): number {
  return year + (month - 0.5) / 12;
}

/** A calendar year–month pair (month is 1–12). */
export interface YearMonth {
  year: number;
  month: number;
}

/**
 * Parse an ISO month "YYYY-MM" (a trailing "-DD" day part is accepted and
 * ignored). Throws `RangeError` for malformed input or month outside 1–12.
 */
export function parseMonth(date: string): YearMonth {
  const m = /^\s*(-?\d{1,6})-(\d{1,2})(?:-\d{1,2})?/.exec(date);
  if (!m) throw new RangeError(`Invalid month string "${date}" (expected "YYYY-MM")`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!(month >= 1 && month <= 12)) throw new RangeError(`Month out of range in "${date}"`);
  return { year, month };
}

/** Format a year/month as "YYYY-MM". */
export function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** True for Gregorian leap years. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a Gregorian calendar month (handles leap-year February). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Mean Gregorian year length in days (365.2425). */
export const DAYS_PER_YEAR = 365.2425;

/**
 * Year and calendar month of a point. Uses the `date` string when it parses;
 * otherwise derives them from the decimal-year `t` (mid-month convention).
 */
export function yearMonthOf(p: Point): YearMonth {
  try {
    return parseMonth(p.date);
  } catch {
    const year = Math.floor(p.t);
    const month = Math.min(12, Math.max(1, Math.floor((p.t - year) * 12) + 1));
    return { year, month };
  }
}

/** Return a copy of the points sorted by time `t` (stable). */
export function sortByTime(points: readonly Point[]): Point[] {
  return points.map((p, i) => ({ p, i })).sort((a, b) => a.p.t - b.p.t || a.i - b.i).map((x) => x.p);
}

/** Drop leading and trailing points whose value is missing (interior gaps are kept). */
export function trimMissing(points: readonly Point[]): Point[] {
  let a = 0;
  let b = points.length - 1;
  while (a <= b && !isValidValue(points[a].v)) a++;
  while (b >= a && !isValidValue(points[b].v)) b--;
  return points.slice(a, b + 1);
}

/* ------------------------------------------------- descriptive statistics -- */

/** Collect the finite values of an array (nulls/NaN removed). */
export function validValues(values: ArrayLike<MaybeNumber>): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isValidValue(v)) out.push(v);
  }
  return out;
}

/** Arithmetic mean of the finite values (NaN if there are none). */
export function mean(values: ArrayLike<MaybeNumber>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isValidValue(v)) {
      s += v;
      n++;
    }
  }
  return n > 0 ? s / n : NaN;
}

/**
 * Variance of the finite values using a two-pass algorithm.
 * @param ddof delta degrees of freedom: 1 = sample variance (default), 0 = population.
 * @returns NaN when fewer than ddof + 1 values.
 */
export function variance(values: ArrayLike<MaybeNumber>, ddof = 1): number {
  const xs = validValues(values);
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return ss / (n - ddof);
}

/** Standard deviation of the finite values (sample, ddof = 1 by default). */
export function std(values: ArrayLike<MaybeNumber>, ddof = 1): number {
  return Math.sqrt(variance(values, ddof));
}

/** Median of the finite values (NaN if there are none). */
export function median(values: ArrayLike<MaybeNumber>): number {
  const xs = validValues(values).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return NaN;
  const h = n >> 1;
  return n % 2 === 1 ? xs[h] : 0.5 * (xs[h - 1] + xs[h]);
}

/**
 * Quantile of the finite values with linear interpolation between order
 * statistics (Hyndman & Fan 1996 type 7, the NumPy / R default).
 */
export function quantile(values: ArrayLike<MaybeNumber>, q: number): number {
  const xs = validValues(values).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0 || !(q >= 0 && q <= 1)) return NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}

/**
 * Ranks (1-based) with ties assigned their average rank — the convention of
 * `scipy.stats.rankdata(method="average")` and Spearman's rho.
 */
export function rankAverage(values: readonly number[]): number[] {
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const r = (i + j + 2) / 2; // average of 1-based ranks i+1 … j+1
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  return ranks;
}

/**
 * Lag-1 autocorrelation of an EVENLY SPACED sequence that may contain gaps
 * (null/NaN). Only adjacent pairs where both values are present contribute to
 * the lag-1 covariance; the mean and variance use all present values:
 *
 *   r1 = [Σ_pairs (x_i − x̄)(x_{i+1} − x̄)] · ((n − 1)/n_pairs) / Σ (x_i − x̄)²
 *
 * With no gaps this is exactly the standard (biased) ACF estimator
 * Σ_{i=1}^{n−1}(x_i − x̄)(x_{i+1} − x̄) / Σ(x_i − x̄)² (Box & Jenkins 1976;
 * as used by Santer et al. 2000). The (n−1)/n_pairs factor rescales the
 * numerator when gaps remove pairs. Result is clamped to [−1, 1].
 *
 * @returns 0 when it cannot be estimated (fewer than 3 values, no adjacent
 * pairs, or zero variance).
 */
export function lag1Autocorrelation(values: ArrayLike<MaybeNumber>): number {
  const m = mean(values);
  let n = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (isValidValue(v)) {
      n++;
      den += (v - m) * (v - m);
    }
  }
  let num = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < values.length; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (isValidValue(a) && isValidValue(b)) {
      num += (a - m) * (b - m);
      pairs++;
    }
  }
  if (n < 3 || pairs === 0 || !(den > 0)) return 0;
  const r1 = (num * ((n - 1) / pairs)) / den;
  return Math.max(-1, Math.min(1, r1));
}

/**
 * Least-squares line through (x, y) pairs where both are finite (centered
 * sums for numerical stability with decimal-year x). Minimal helper; see
 * `ols()` in ols.ts for full inference.
 * @returns slope and intercept (NaN when fewer than 2 points or constant x).
 */
export function linearFit(x: ArrayLike<MaybeNumber>, y: ArrayLike<MaybeNumber>): { slope: number; intercept: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i];
    const b = y[i];
    if (isValidValue(a) && isValidValue(b)) {
      xs.push(a);
      ys.push(b);
    }
  }
  const n = xs.length;
  if (n < 2) return { slope: NaN, intercept: NaN };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0)) return { slope: NaN, intercept: NaN };
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * Remove the least-squares linear trend (fitted against t) from a series.
 * Missing values stay null.
 */
export function detrend(points: readonly Point[]): Point[] {
  const { slope, intercept } = linearFit(
    points.map((p) => p.t),
    points.map((p) => p.v),
  );
  return points.map((p) => ({
    t: p.t,
    date: p.date,
    v: isValidValue(p.v) && Number.isFinite(slope) ? p.v - (intercept + slope * p.t) : null,
  }));
}

/* ---------------------------------------------------- missing-data stats -- */

/** Summary of data completeness. */
export interface MissingStats {
  /** Total number of points. */
  n: number;
  nValid: number;
  nMissing: number;
  /** Percentage (0–100) of points that are missing. */
  missingPct: number;
  /** Longest run of consecutive missing points. */
  longestGap: number;
  /** Index of the first / last valid point (−1 if none). */
  firstValidIndex: number;
  lastValidIndex: number;
}

/** Count missing values, the longest run of consecutive gaps and the valid span. */
export function missingStats(points: readonly Point[]): MissingStats {
  let nValid = 0;
  let run = 0;
  let longestGap = 0;
  let first = -1;
  let last = -1;
  points.forEach((p, i) => {
    if (isValidValue(p.v)) {
      nValid++;
      run = 0;
      if (first < 0) first = i;
      last = i;
    } else {
      run++;
      longestGap = Math.max(longestGap, run);
    }
  });
  const n = points.length;
  return {
    n,
    nValid,
    nMissing: n - nValid,
    missingPct: n > 0 ? (100 * (n - nValid)) / n : 0,
    longestGap,
    firstValidIndex: first,
    lastValidIndex: last,
  };
}

/* ------------------------------------------------- climatology/anomalies -- */

/** Optional reference period for a climatology, inclusive years. */
export interface BaselinePeriod {
  startYear: number;
  endYear: number;
}

/**
 * Monthly climatology: the mean of all valid values for each calendar month
 * (index 0 = January … 11 = December). A month with no data is NaN.
 * Optionally restricted to a baseline period (e.g. WMO 1991–2020 normals).
 */
export function monthlyClimatology(points: readonly Point[], baseline?: BaselinePeriod): number[] {
  const sum = new Array<number>(12).fill(0);
  const cnt = new Array<number>(12).fill(0);
  for (const p of points) {
    if (!isValidValue(p.v)) continue;
    const { year, month } = yearMonthOf(p);
    if (baseline && (year < baseline.startYear || year > baseline.endYear)) continue;
    sum[month - 1] += p.v;
    cnt[month - 1]++;
  }
  return sum.map((s, i) => (cnt[i] > 0 ? s / cnt[i] : NaN));
}

/**
 * Deseasonalised anomalies: each value minus its calendar month's
 * climatological mean. Removes the mean seasonal cycle so trends are not
 * aliased by it. Missing values (or months with no climatology) stay null.
 *
 * @param climatology defaults to {@link monthlyClimatology} of the same points.
 */
export function deseasonalize(points: readonly Point[], climatology: readonly number[] = monthlyClimatology(points)): Point[] {
  return points.map((p) => {
    if (!isValidValue(p.v)) return { t: p.t, date: p.date, v: null };
    const c = climatology[yearMonthOf(p).month - 1];
    return { t: p.t, date: p.date, v: Number.isFinite(c) ? p.v - c : null };
  });
}

/** Options for {@link annualAggregate}. */
export interface AnnualAggregateOptions {
  /** "mean" (e.g. temperature) or "sum" (e.g. precipitation totals). Default "mean". */
  agg?: "mean" | "sum";
  /**
   * With agg = "sum": "daysInMonth" multiplies each monthly value by the number
   * of days in that month (leap years respected), converting a monthly-mean
   * daily rate such as mm/day into a monthly total before summing to mm/yr.
   */
  sumFactor?: "daysInMonth";
  /** Years with fewer valid months than this get v = null. Default 10. */
  minMonths?: number;
  /**
   * How months missing inside an otherwise sufficiently complete year are handled:
   *  - "anomaly" (default): infill each missing month with its climatological
   *    mean plus that year's mean anomaly over its valid months. Equivalent to
   *    "annual anomaly + climatological annual value" and removes the seasonal
   *    bias of averaging (or summing) an incomplete set of months.
   *  - "none": plain mean (or plain sum) of the valid months only. A "sum" of
   *    an incomplete year is then biased low.
   * Years with all months present are identical under both options.
   */
  fill?: "anomaly" | "none";
}

/**
 * Aggregate a monthly series to calendar-year values (t = year + 0.5,
 * date "YYYY"). Every year from the first to the last year of the input is
 * returned (years without enough data are v = null), so the result is an
 * evenly spaced annual series.
 *
 * Calendar months that have no data anywhere in the record (NaN climatology)
 * are excluded from every year, consistently, under the "anomaly" fill.
 */
export function annualAggregate(points: readonly Point[], opts: AnnualAggregateOptions = {}): Point[] {
  const agg = opts.agg ?? "mean";
  const minMonths = opts.minMonths ?? 10;
  const fill = opts.fill ?? "anomaly";
  if (points.length === 0) return [];
  const clim = monthlyClimatology(points);

  // Average duplicates within the same year-month, then group by year.
  const byYear = new Map<number, Map<number, { s: number; c: number }>>();
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const p of points) {
    const { year, month } = yearMonthOf(p);
    minYear = Math.min(minYear, year);
    maxYear = Math.max(maxYear, year);
    if (!isValidValue(p.v)) continue;
    let months = byYear.get(year);
    if (!months) byYear.set(year, (months = new Map()));
    const cell = months.get(month) ?? { s: 0, c: 0 };
    cell.s += p.v;
    cell.c++;
    months.set(month, cell);
  }

  const factor = (year: number, month: number) =>
    agg === "sum" && opts.sumFactor === "daysInMonth" ? daysInMonth(year, month) : 1;

  const out: Point[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    const months = byYear.get(year);
    const nValid = months ? months.size : 0;
    let v: number | null = null;
    if (months && nValid >= minMonths) {
      const val = new Map<number, number>();
      months.forEach((cell, m) => val.set(m, cell.s / cell.c));
      if (fill === "anomaly") {
        let anomSum = 0;
        let anomN = 0;
        val.forEach((x, m) => {
          if (Number.isFinite(clim[m - 1])) {
            anomSum += x - clim[m - 1];
            anomN++;
          }
        });
        const meanAnom = anomN > 0 ? anomSum / anomN : 0;
        let acc = 0;
        let used = 0;
        for (let m = 1; m <= 12; m++) {
          if (!Number.isFinite(clim[m - 1])) continue; // month never observed in the record
          const x = val.has(m) ? (val.get(m) as number) : clim[m - 1] + meanAnom;
          acc += agg === "sum" ? x * factor(year, m) : x;
          used++;
        }
        v = agg === "sum" ? acc : acc / used;
      } else {
        let acc = 0;
        val.forEach((x, m) => {
          acc += agg === "sum" ? x * factor(year, m) : x;
        });
        v = agg === "sum" ? acc : acc / nValid;
      }
    }
    out.push({ t: year + 0.5, date: String(year).padStart(4, "0"), v });
  }
  return out;
}

/**
 * Aggregate a daily series to monthly means (t at mid-month, date "YYYY-MM").
 * A month is null when fewer than `minValidFraction` of its days are valid.
 */
export function monthlyMeansFromDaily(points: readonly Point[], minValidFraction = 0.5): Point[] {
  const cells = new Map<string, { year: number; month: number; s: number; c: number }>();
  for (const p of points) {
    const { year, month } = yearMonthOf(p);
    const key = formatMonth(year, month);
    const cell = cells.get(key) ?? { year, month, s: 0, c: 0 };
    if (isValidValue(p.v)) {
      cell.s += p.v;
      cell.c++;
    }
    cells.set(key, cell);
  }
  return [...cells.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((c) => ({
      t: decimalYear(c.year, c.month),
      date: formatMonth(c.year, c.month),
      v: c.c >= minValidFraction * daysInMonth(c.year, c.month) && c.c > 0 ? c.s / c.c : null,
    }));
}

/* ------------------------------------------------------------ smoothing ---- */

/**
 * Moving average of an evenly spaced series, tolerant of gaps.
 *
 *  - centered = true, odd window w: equal weights over i − (w−1)/2 … i + (w−1)/2.
 *  - centered = true, even window w: the standard "2×w" centred moving average
 *    (w + 1 points, half weight at both ends) so the result is properly centred
 *    on each time step (e.g. the classic 2×12 MA for monthly data).
 *  - centered = false: trailing average over i − w + 1 … i.
 *
 * Missing values are skipped and the weights renormalised; the output is null
 * when the window extends past either end of the series or when the present
 * values carry less than `minValidFraction` of the total weight.
 */
export function movingAverage(points: readonly Point[], window: number, centered = true, minValidFraction = 0.5): Point[] {
  const w = Math.max(1, Math.floor(window));
  let offsets: number[];
  let weights: number[];
  if (!centered) {
    offsets = Array.from({ length: w }, (_, k) => k - (w - 1));
    weights = offsets.map(() => 1);
  } else if (w % 2 === 1) {
    const h = (w - 1) / 2;
    offsets = Array.from({ length: w }, (_, k) => k - h);
    weights = offsets.map(() => 1);
  } else {
    const h = w / 2;
    offsets = Array.from({ length: w + 1 }, (_, k) => k - h);
    weights = offsets.map((o) => (Math.abs(o) === h ? 0.5 : 1));
  }
  const totalW = weights.reduce((a, b) => a + b, 0);
  const n = points.length;
  return points.map((p, i) => {
    if (i + offsets[0] < 0 || i + offsets[offsets.length - 1] > n - 1) return { t: p.t, date: p.date, v: null };
    let s = 0;
    let ws = 0;
    for (let k = 0; k < offsets.length; k++) {
      const v = points[i + offsets[k]].v;
      if (isValidValue(v)) {
        s += weights[k] * v;
        ws += weights[k];
      }
    }
    return { t: p.t, date: p.date, v: ws > 0 && ws >= minValidFraction * totalW ? s / ws : null };
  });
}

/**
 * Put a monthly series on a complete, regular month grid from its first to
 * its last month: months absent from the input become explicit null points,
 * duplicate entries for the same month are averaged, and output is sorted.
 * Lag-based statistics (AR(1) adjustment, lag correlation) assume this
 * regular spacing.
 */
export function completeMonthlyGrid(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  const cells = new Map<number, { s: number; c: number }>();
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const { year, month } = yearMonthOf(p);
    const key = year * 12 + (month - 1);
    lo = Math.min(lo, key);
    hi = Math.max(hi, key);
    const cell = cells.get(key) ?? { s: 0, c: 0 };
    if (isValidValue(p.v)) {
      cell.s += p.v;
      cell.c++;
    }
    cells.set(key, cell);
  }
  const out: Point[] = [];
  for (let key = lo; key <= hi; key++) {
    const year = Math.floor(key / 12);
    const month = key - year * 12 + 1;
    const cell = cells.get(key);
    out.push({ t: decimalYear(year, month), date: formatMonth(year, month), v: cell && cell.c > 0 ? cell.s / cell.c : null });
  }
  return out;
}
