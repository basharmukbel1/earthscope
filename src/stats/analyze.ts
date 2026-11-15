/**
 * End-to-end trend analysis of one time series: anomalies, annual values,
 * OLS (AR(1)-adjusted), Mann–Kendall + Sen, seasonal Kendall, detectability,
 * and a plain-language summary; plus a method-comparison table.
 *
 * @module stats/analyze
 */
import type { AnalysisResult, OlsResult, Point, TimeSeries, TrendDirection, TrendSummary } from "../types/domain";
import { weatherheadYearsToDetect } from "./detect";
import { InsufficientDataError, isInsufficientDataError } from "./errors";
import { hamedRaoMannKendall, mannKendall, type HamedRaoResult } from "./mannKendall";
import { linearResiduals, ols, olsAR1 } from "./ols";
import { seasonalKendall } from "./seasonalKendall";
import { senSlope } from "./sen";
import {
  annualAggregate,
  completeMonthlyGrid,
  DAYS_PER_YEAR,
  deseasonalize,
  isValidValue,
  mean,
  monthlyClimatology,
  monthlyMeansFromDaily,
  sortByTime,
  trimMissing,
  yearMonthOf,
} from "./series";

/** Which test/estimator drives the headline summary. */
export type PrimaryMethod = "mk-sen" | "ols-ar1";

/** Options for {@link analyzeSeries}. */
export interface AnalyzeOptions {
  /** Significance level (default 0.05). */
  alpha?: number;
  /** Annual aggregation: "mean" (default) or "sum" (e.g. precipitation). */
  annualAgg?: "mean" | "sum";
  /** With annualAgg = "sum": "daysInMonth" converts mm/day monthly means into totals. */
  annualSumFactor?: "daysInMonth";
  /** Minimum valid months for a year to count (default 10). */
  minMonthsPerYear?: number;
  /** Headline method (default "mk-sen"). */
  primary?: PrimaryMethod;
  /** Minimum number of valid annual values (default 8). */
  minYears?: number;
}

/** Labels used in summaries and comparison tables. */
export const METHOD_LABELS = {
  "mk-sen": "Mann-Kendall + Sen's slope (annual)",
  "ols-ar1": "OLS on monthly anomalies, AR(1)-adjusted (Santer et al. 2000)",
  "ols-naive": "OLS on monthly anomalies, no autocorrelation adjustment",
  "ols-annual": "OLS on annual values (AR(1)-adjusted if r1 > 0)",
  "mk-hamed-rao": "Mann-Kendall with Hamed-Rao autocorrelation correction (annual)",
  "seasonal-kendall": "Seasonal Kendall test + seasonal Sen slope (monthly)",
} as const;

/**
 * {@link AnalysisResult} plus extra, clearly-typed details. It is assignable to
 * AnalysisResult, so callers that only know the shared domain type still work.
 */
export interface AnalysisResultExt extends AnalysisResult {
  primary: PrimaryMethod;
  annualAgg: "mean" | "sum";
  /**
   * Unit of `annual` values and of ALL summary / comparison slopes. Equals
   * `unit` for annualAgg = "mean"; for "sum" it is the annual-total unit
   * (e.g. "mm/day" → "mm/yr").
   */
  annualUnit: string;
  /**
   * Factor converting a slope of the monthly series (unit/yr) into a slope of
   * the annual series (annualUnit/yr): 1 for "mean", 12 for "sum",
   * 365.2425 for "sum" with daysInMonth.
   */
  monthlyToAnnualFactor: number;
  /** Mean of the valid annual values (annualUnit). */
  annualMean: number;
  /** Number of years with a valid annual value. */
  nValidYears: number;
  /** OLS on monthly anomalies WITHOUT the AR(1) adjustment (for comparison/teaching). */
  olsNaive: OlsResult;
  /** Hamed & Rao (1998) modified Mann–Kendall on the annual values (rank-ACF lags 1–3, Var(S) never reduced). */
  mkHamedRao: HamedRaoResult | null;
  /** Residual standard error of the anomaly trend fit = σN used for Weatherhead. */
  residualSd: number;
}

function annualUnitFor(unit: string, agg: "mean" | "sum", factor?: "daysInMonth"): string {
  if (agg === "mean") return unit;
  if (factor === "daysInMonth") {
    const m = /^(.*)\s*\/\s*(day|d)$/i.exec(unit.trim());
    if (m) return `${m[1].trim()}/yr`;
    return `${unit} × days (annual total)`;
  }
  return `${unit} (annual sum)`;
}

function residualStandardError(points: Point[], fit: OlsResult): number {
  const res = linearResiduals(points, fit);
  let ss = 0;
  let n = 0;
  for (const p of res) {
    if (isValidValue(p.v)) {
      ss += p.v * p.v;
      n++;
    }
  }
  return n > 2 ? Math.sqrt(ss / (n - 2)) : NaN;
}

function directionOf(slope: number): TrendDirection {
  if (slope > 0) return "increasing";
  if (slope < 0) return "decreasing";
  return "no-trend";
}

/**
 * Run the full EARTHSCOPE trend analysis on one series.
 *
 * Steps (monthly input; daily input is first averaged to monthly means):
 *  1. Sort, put on a complete month grid, trim leading/trailing gaps.
 *  2. climatology = monthly means; anomalies = value − climatology (deseasonalised).
 *  3. annual = calendar-year aggregation (mean, or sum with optional
 *     days-in-month factor; years with < minMonthsPerYear valid months = null).
 *  4. ols = OLS on monthly anomalies with Santer et al. (2000) AR(1) adjustment;
 *     olsAnnual = OLS on annual values (AR(1)-adjusted when r1 > 0);
 *     mk + sen = Mann–Kendall test and Sen slope (Gilbert CI) on annual values;
 *     seasonalKendall on the monthly values (Hirsch et al. 1982).
 *  5. summary: headline slope/CI/p from the primary method ("mk-sen" by
 *     default: p = MK p, slope & CI = Sen; or "ols-ar1"), expressed per decade
 *     in `annualUnit`. `direction` is the sign of the slope and is reported even
 *     when not significant; `significant` (p < alpha) is separate.
 *     totalChange = slope × (endYear − startYear + 1);
 *     pctPerDecade = perDecade / |mean of annual values| × 100 (null when that
 *     mean is ~0; note % change is not physically meaningful for interval-scale
 *     quantities such as °C);
 *     yearsToDetect = Weatherhead et al. (1998) n* using the residual standard
 *     deviation and lag-1 autocorrelation of the detrended monthly anomalies and
 *     the OLS slope (null for a zero slope or noise-free data).
 *
 * Annual-resolution input skips the seasonal steps (climatology = 12 × NaN,
 * anomalies = departures from the series mean, no seasonal Kendall).
 *
 * @throws InsufficientDataError when fewer than `minYears` (default 8) valid
 * annual values are available.
 */
export function analyzeSeries(series: TimeSeries, opts: AnalyzeOptions = {}): AnalysisResultExt {
  const alpha = opts.alpha ?? 0.05;
  if (!(alpha > 0 && alpha < 1)) throw new RangeError(`alpha must be in (0, 1), got ${alpha}`);
  const agg = opts.annualAgg ?? "mean";
  const sumFactor = agg === "sum" ? opts.annualSumFactor : undefined;
  const minMonths = opts.minMonthsPerYear ?? 10;
  const minYears = opts.minYears ?? 8;
  const primary: PrimaryMethod = opts.primary ?? "mk-sen";
  const isAnnual = series.resolution === "annual";

  let pts: Point[];
  if (isAnnual) {
    pts = trimMissing(sortByTime(series.points));
  } else {
    const monthly = series.resolution === "daily" ? monthlyMeansFromDaily(series.points) : series.points;
    pts = trimMissing(completeMonthlyGrid(monthly));
  }
  const nValidPts = pts.filter((p) => isValidValue(p.v)).length;
  if (nValidPts === 0) throw new InsufficientDataError("Series has no valid values", minYears, 0);

  const climatology = isAnnual ? new Array<number>(12).fill(NaN) : monthlyClimatology(pts);
  const annual: Point[] = isAnnual
    ? pts.map((p) => ({ t: p.t, date: p.date, v: isValidValue(p.v) ? p.v : null }))
    : annualAggregate(pts, { agg, sumFactor, minMonths });
  const nValidYears = annual.filter((p) => isValidValue(p.v)).length;
  if (nValidYears < minYears) {
    throw new InsufficientDataError(
      `Trend analysis needs at least ${minYears} years with data` +
        (isAnnual ? "" : ` (≥ ${minMonths} valid months each)`) +
        `; found ${nValidYears}`,
      minYears,
      nValidYears,
    );
  }

  const seriesMean = mean(pts.map((p) => p.v));
  const anomalies: Point[] = isAnnual
    ? pts.map((p) => ({ t: p.t, date: p.date, v: isValidValue(p.v) ? p.v - seriesMean : null }))
    : deseasonalize(pts, climatology);

  const olsRes = olsAR1(anomalies, alpha);
  const olsNaive = ols(
    anomalies.map((p) => p.t),
    anomalies.map((p) => p.v),
    alpha,
  );
  const olsAnnual = olsAR1(annual, alpha);
  const annualT = annual.map((p) => p.t);
  const annualV = annual.map((p) => p.v);
  const mkRaw = mannKendall(annualV, alpha);
  const senRaw = senSlope(annualT, annualV, alpha);
  const mk = { method: mkRaw.method, n: mkRaw.n, s: mkRaw.s, varS: mkRaw.varS, z: mkRaw.z, p: mkRaw.p, tau: mkRaw.tau };
  const sen = {
    method: senRaw.method,
    n: senRaw.n,
    slope: senRaw.slope,
    intercept: senRaw.intercept,
    ciLow: senRaw.ciLow,
    ciHigh: senRaw.ciHigh,
  };
  // Lags 1–3 and no variance shrinkage: keeps nominal size on white noise (see hamedRaoMannKendall).
  const mkHamedRao = hamedRaoMannKendall(annualV, alpha, { t: annualT, lag: 3, minCorrection: 1 });

  let seasonal: AnalysisResult["seasonalKendall"];
  if (!isAnnual) {
    try {
      const sk = seasonalKendall(pts, alpha);
      seasonal = { method: sk.method, n: sk.n, s: sk.s, varS: sk.varS, z: sk.z, p: sk.p, slope: sk.slope };
    } catch (e) {
      if (!isInsufficientDataError(e)) throw e;
    }
  }

  const factor = isAnnual || agg === "mean" ? 1 : sumFactor === "daysInMonth" ? DAYS_PER_YEAR : 12;
  const annualUnit = isAnnual ? series.unit : annualUnitFor(series.unit, agg, sumFactor);

  // Headline numbers (annualUnit per year).
  let slope: number;
  let ciLo: number;
  let ciHi: number;
  let p: number;
  if (primary === "ols-ar1") {
    slope = olsRes.slope * factor;
    ciLo = olsRes.ciLow * factor;
    ciHi = olsRes.ciHigh * factor;
    p = olsRes.p;
  } else {
    slope = sen.slope;
    ciLo = sen.ciLow;
    ciHi = sen.ciHigh;
    p = mk.p;
  }

  const firstValid = pts.find((q) => isValidValue(q.v)) as Point;
  const lastValid = [...pts].reverse().find((q) => isValidValue(q.v)) as Point;
  const startYear = isAnnual ? Math.floor(firstValid.t) : yearMonthOf(firstValid).year;
  const endYear = isAnnual ? Math.floor(lastValid.t) : yearMonthOf(lastValid).year;

  const annualVals = annual.filter((q) => isValidValue(q.v)).map((q) => q.v as number);
  const annualMean = mean(annualVals);
  const maxAbs = annualVals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const perDecade = slope * 10;
  const pctPerDecade =
    Number.isFinite(annualMean) && Math.abs(annualMean) > 1e-6 * maxAbs && Math.abs(annualMean) > 1e-12
      ? (perDecade / Math.abs(annualMean)) * 100
      : null;

  const residualSd = residualStandardError(anomalies, olsRes);
  // Noise at floating-point rounding level (an exactly deterministic series) makes
  // Weatherhead's n* meaningless, so report null rather than a spurious number.
  const dataScale = pts.reduce((m, q) => (isValidValue(q.v) ? Math.max(m, Math.abs(q.v)) : m), 0);
  const yearsToDetect =
    residualSd > 1e-10 * dataScale
      ? weatherheadYearsToDetect(olsRes.slope, residualSd, olsRes.r1 ?? 0, isAnnual ? 1 : 12)
      : null;

  const summary: TrendSummary = {
    direction: directionOf(slope),
    significant: p < alpha,
    alpha,
    perDecade,
    perDecadeCi: [ciLo * 10, ciHi * 10],
    totalChange: slope * (endYear - startYear + 1),
    pctPerDecade,
    p,
    method: METHOD_LABELS[primary],
    yearsToDetect,
  };

  const nMissing = pts.length - nValidPts;
  return {
    seriesId: series.id,
    variableId: series.variableId,
    regionId: series.regionId,
    unit: series.unit,
    startYear,
    endYear,
    nMonths: pts.length,
    nMissing,
    missingPct: pts.length > 0 ? (100 * nMissing) / pts.length : 0,
    mean: seriesMean,
    anomalies,
    annual,
    climatology,
    ols: olsRes,
    olsAnnual,
    mk,
    sen,
    seasonalKendall: seasonal,
    summary,
    computedAt: new Date().toISOString(),
    primary,
    annualAgg: isAnnual ? "mean" : agg,
    annualUnit,
    monthlyToAnnualFactor: factor,
    annualMean,
    nValidYears,
    olsNaive,
    mkHamedRao,
    residualSd,
  };
}

/** One row of the method-comparison table. Slopes are in annualUnit per DECADE. */
export interface MethodComparisonRow {
  id: "ols-ar1" | "ols-naive" | "ols-annual" | "mk-sen" | "mk-hamed-rao" | "seasonal-kendall";
  method: string;
  /** Which data the method was applied to. */
  data: "monthly anomalies" | "annual values" | "monthly values";
  slopePerDecade: number;
  /** Confidence interval per decade, or null when the method has none. */
  ci: [number, number] | null;
  p: number;
  significant: boolean;
  n: number;
  notes: string;
  /** True for the method used in the headline summary. */
  primary: boolean;
}

function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : "n/a";
}

/**
 * Rows for a side-by-side comparison of all trend methods computed by
 * {@link analyzeSeries}. All slopes are converted to the annual unit per
 * decade so rows are directly comparable; `significant` uses the result's
 * alpha. Rows for optional analyses (seasonal Kendall, Hamed–Rao, naive OLS)
 * appear only when present.
 */
export function compareMethods(result: AnalysisResult): MethodComparisonRow[] {
  const ext = result as Partial<AnalysisResultExt> & AnalysisResult;
  const alpha = result.summary.alpha;
  const f = ext.monthlyToAnnualFactor ?? 1;
  const primary = ext.primary ?? (result.summary.method === METHOD_LABELS["ols-ar1"] ? "ols-ar1" : "mk-sen");
  const conv = f !== 1 ? `; monthly slope × ${f === DAYS_PER_YEAR ? "365.2425 days" : f} to annual units` : "";
  const rows: MethodComparisonRow[] = [];
  const o = result.ols;
  rows.push({
    id: "ols-ar1",
    method: METHOD_LABELS["ols-ar1"],
    data: "monthly anomalies",
    slopePerDecade: o.slope * f * 10,
    ci: [o.ciLow * f * 10, o.ciHigh * f * 10],
    p: o.p,
    significant: o.p < alpha,
    n: o.n,
    notes:
      (o.adjusted
        ? `Residual lag-1 autocorrelation r1 = ${fmt(o.r1 ?? NaN)}; effective n = ${fmt(o.nEff ?? NaN, 1)} of ${o.n}`
        : `Residual r1 = ${fmt(o.r1 ?? NaN)} ≤ 0, no adjustment needed`) + conv,
    primary: primary === "ols-ar1",
  });
  if (ext.olsNaive) {
    const q = ext.olsNaive;
    rows.push({
      id: "ols-naive",
      method: METHOD_LABELS["ols-naive"],
      data: "monthly anomalies",
      slopePerDecade: q.slope * f * 10,
      ci: [q.ciLow * f * 10, q.ciHigh * f * 10],
      p: q.p,
      significant: q.p < alpha,
      n: q.n,
      notes: "Treats every month as independent; overstates significance when anomalies are autocorrelated (shown for comparison)" + conv,
      primary: false,
    });
  }
  const a = result.olsAnnual;
  rows.push({
    id: "ols-annual",
    method: METHOD_LABELS["ols-annual"],
    data: "annual values",
    slopePerDecade: a.slope * 10,
    ci: [a.ciLow * 10, a.ciHigh * 10],
    p: a.p,
    significant: a.p < alpha,
    n: a.n,
    notes: a.adjusted
      ? `AR(1)-adjusted: r1 = ${fmt(a.r1 ?? NaN)}, effective n = ${fmt(a.nEff ?? NaN, 1)} of ${a.n}`
      : `Residual r1 = ${fmt(a.r1 ?? NaN)} ≤ 0, plain OLS`,
    primary: false,
  });
  rows.push({
    id: "mk-sen",
    method: METHOD_LABELS["mk-sen"],
    data: "annual values",
    slopePerDecade: result.sen.slope * 10,
    ci: [result.sen.ciLow * 10, result.sen.ciHigh * 10],
    p: result.mk.p,
    significant: result.mk.p < alpha,
    n: result.mk.n,
    notes: `Kendall's tau = ${fmt(result.mk.tau, 3)}, S = ${result.mk.s}; Sen CI after Gilbert (1987); assumes independent years`,
    primary: primary === "mk-sen",
  });
  if (ext.mkHamedRao) {
    const h = ext.mkHamedRao;
    rows.push({
      id: "mk-hamed-rao",
      method: METHOD_LABELS["mk-hamed-rao"],
      data: "annual values",
      slopePerDecade: result.sen.slope * 10,
      ci: null,
      p: h.p,
      significant: h.p < alpha,
      n: h.n,
      notes:
        h.significantLags.length > 0
          ? `Var(S) multiplied by ${fmt(h.correction, 2)} for significant rank autocorrelation at lag(s) ${h.significantLags.join(", ")} (lags 1-3 tested)`
          : "No significant rank autocorrelation at lags 1-3; identical to the original Mann-Kendall test",
      primary: false,
    });
  }
  if (result.seasonalKendall) {
    const s = result.seasonalKendall;
    rows.push({
      id: "seasonal-kendall",
      method: METHOD_LABELS["seasonal-kendall"],
      data: "monthly values",
      slopePerDecade: s.slope * f * 10,
      ci: null,
      p: s.p,
      significant: s.p < alpha,
      n: s.n,
      notes: "Hirsch et al. (1982); compares each calendar month only with itself; ignores covariance between months" + conv,
      primary: false,
    });
  }
  return rows;
}
