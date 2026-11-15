import { describe, expect, it } from "vitest";
import type { Point } from "../../types/domain";
import {
  annualAggregate,
  completeMonthlyGrid,
  daysInMonth,
  decimalYear,
  deseasonalize,
  detrend,
  formatMonth,
  lag1Autocorrelation,
  mean,
  median,
  missingStats,
  monthlyClimatology,
  monthlyMeansFromDaily,
  movingAverage,
  parseMonth,
  quantile,
  rankAverage,
  std,
  trimMissing,
  yearMonthOf,
} from "../series";
import { simulateMonthlySeries } from "../simulate";
import { close } from "./helpers";

/** Monthly points for whole years, value from a function of (year, month). */
function monthly(startYear: number, years: number, f: (y: number, m: number) => number | null): Point[] {
  const out: Point[] = [];
  for (let y = startYear; y < startYear + years; y++) {
    for (let m = 1; m <= 12; m++) out.push({ t: decimalYear(y, m), date: formatMonth(y, m), v: f(y, m) });
  }
  return out;
}

describe("calendar helpers", () => {
  it("decimalYear uses mid-month", () => {
    expect(decimalYear(2001, 1)).toBe(2001 + 0.5 / 12);
    expect(decimalYear(2001, 12)).toBe(2001 + 11.5 / 12);
  });

  it("parseMonth accepts YYYY-MM and YYYY-MM-DD and rejects junk", () => {
    expect(parseMonth("1998-07")).toEqual({ year: 1998, month: 7 });
    expect(parseMonth("2020-02-29")).toEqual({ year: 2020, month: 2 });
    expect(() => parseMonth("2020-13")).toThrow(RangeError);
    expect(() => parseMonth("July 2020")).toThrow(RangeError);
  });

  it("yearMonthOf falls back to t when the date is not parseable", () => {
    expect(yearMonthOf({ t: decimalYear(2005, 9), date: "", v: 1 })).toEqual({ year: 2005, month: 9 });
    for (let m = 1; m <= 12; m++) expect(yearMonthOf({ t: decimalYear(1999, m), date: "x", v: 0 }).month).toBe(m);
  });

  it("daysInMonth handles leap years (incl. century rule)", () => {
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2023, 4)).toBe(30);
    expect(daysInMonth(2023, 12)).toBe(31);
  });
});

describe("descriptive statistics", () => {
  it("mean/std/median/quantile ignore nulls", () => {
    const v = [1, null, 2, 3, NaN, 4];
    expect(mean(v)).toBe(2.5);
    close(std(v), Math.sqrt(5 / 3), 1e-15);
    expect(median(v)).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(Number.isNaN(mean([null, null]))).toBe(true);
  });

  it("rankAverage gives average ranks to ties", () => {
    expect(rankAverage([10, 20, 20, 5, 30])).toEqual([2, 3.5, 3.5, 1, 5]);
  });

  it("lag1Autocorrelation equals the standard estimator without gaps", () => {
    const x = [1.2, 0.4, -0.3, 0.9, 1.7, 0.2, -1.1, 0.5];
    const m = x.reduce((a, b) => a + b) / x.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < x.length; i++) den += (x[i] - m) ** 2;
    for (let i = 0; i < x.length - 1; i++) num += (x[i] - m) * (x[i + 1] - m);
    close(lag1Autocorrelation(x), num / den, 1e-14);
  });

  it("lag1Autocorrelation recovers a simulated AR(1) phi, also with gaps", () => {
    const pts = simulateMonthlySeries({ startYear: 1, years: 600, trendPerDecade: 0, noiseSd: 1, ar1: 0.7, seed: 11 });
    const r1 = lag1Autocorrelation(pts.map((p) => p.v));
    expect(Math.abs(r1 - 0.7)).toBeLessThan(0.03);
    const gappy = simulateMonthlySeries({ startYear: 1, years: 600, trendPerDecade: 0, noiseSd: 1, ar1: 0.7, seed: 11, missingFraction: 0.3 });
    const r1g = lag1Autocorrelation(gappy.map((p) => p.v));
    expect(Math.abs(r1g - 0.7)).toBeLessThan(0.03);
    // naive approach (drop nulls, treat as adjacent) would be biased low (≈ 0.7·(0.7) mix)
    const naive = lag1Autocorrelation(gappy.map((p) => p.v).filter((v) => v !== null));
    expect(naive).toBeLessThan(r1g - 0.05);
  });

  it("lag1Autocorrelation returns 0 for degenerate input", () => {
    expect(lag1Autocorrelation([1, 1, 1, 1])).toBe(0);
    expect(lag1Autocorrelation([1, null, 2, null, 3])).toBe(0);
    expect(lag1Autocorrelation([1, 2])).toBe(0);
  });
});

describe("climatology and anomalies", () => {
  const pts = monthly(2000, 3, (y, m) => (m === 2 ? null : 10 * m + (y - 2000)));

  it("monthlyClimatology averages each calendar month; NaN when a month has no data", () => {
    const c = monthlyClimatology(pts);
    expect(c).toHaveLength(12);
    expect(c[0]).toBe(11); // Jan: 10, 11, 12
    expect(Number.isNaN(c[1])).toBe(true); // Feb never observed
    expect(c[11]).toBe(121);
  });

  it("monthlyClimatology respects a baseline period", () => {
    const c = monthlyClimatology(pts, { startYear: 2001, endYear: 2001 });
    expect(c[0]).toBe(11);
    expect(c[2]).toBe(31);
  });

  it("deseasonalize removes the seasonal cycle and keeps nulls", () => {
    const a = deseasonalize(pts);
    expect(a).toHaveLength(pts.length);
    expect(a[0].v).toBe(-1); // Jan 2000: 10 − 11
    expect(a[1].v).toBeNull(); // Feb: no data
    expect(a[24].v).toBe(1); // Jan 2002
    expect(a[0].t).toBe(pts[0].t);
  });
});

describe("annualAggregate", () => {
  it("mean of complete years, t = year + 0.5, date YYYY", () => {
    const pts = monthly(2001, 2, (y, m) => m + (y - 2001) * 100);
    const a = annualAggregate(pts);
    expect(a.map((p) => p.date)).toEqual(["2001", "2002"]);
    expect(a[0].t).toBe(2001.5);
    expect(a[0].v).toBe(6.5);
    expect(a[1].v).toBe(106.5);
  });

  it("precipitation: sum with daysInMonth converts mm/day to mm/yr (leap years respected)", () => {
    const pts = monthly(2000, 2, () => 2); // 2 mm/day every month
    const a = annualAggregate(pts, { agg: "sum", sumFactor: "daysInMonth" });
    expect(a[0].v).toBe(2 * 366); // 2000 is a leap year
    expect(a[1].v).toBe(2 * 365);
    // seasonal rates: monthly total = rate × days
    const seasonal = monthly(2001, 1, (_y, m) => m / 10);
    let expected = 0;
    for (let m = 1; m <= 12; m++) expected += (m / 10) * daysInMonth(2001, m);
    close(annualAggregate(seasonal, { agg: "sum", sumFactor: "daysInMonth" })[0].v as number, expected, 1e-14);
    // plain sum without factor
    expect(annualAggregate(pts, { agg: "sum" })[0].v).toBe(24);
  });

  it("infills a missing month with climatology + that year's mean anomaly", () => {
    // 2001–2002 follow rate(m); in 2003 every observed month is rate(m) + 1 and July is
    // missing. Climatology (all years) = rate(m) + 1/3 except July = rate(7), so 2003's
    // mean anomaly over its 11 valid months is +2/3 and July is infilled as clim + 2/3.
    const rate = (m: number) => 1 + Math.sin((Math.PI * m) / 6) + 0.5 * m; // mm/day
    const pts = monthly(2001, 3, (y, m) => (y === 2003 ? (m === 7 ? null : rate(m) + 1) : rate(m)));
    const clim = monthlyClimatology(pts);
    close(clim[0], rate(1) + 1 / 3, 1e-14);
    const a = annualAggregate(pts, { agg: "sum", sumFactor: "daysInMonth" });
    let expected = 0;
    for (let m = 1; m <= 12; m++) {
      const v = m === 7 ? rate(7) + 2 / 3 : rate(m) + 1;
      expected += v * daysInMonth(2003, m);
    }
    close(a[2].v as number, expected, 1e-13);
    // climatology in July comes from 2001–2002 only: rate(7)
    close(clim[6], rate(7), 1e-14);
    // The naive "none" fill sums only 11 months (biased low).
    const naive = annualAggregate(pts, { agg: "sum", sumFactor: "daysInMonth", fill: "none" });
    expect(naive[2].v as number).toBeLessThan(expected - 30);
    // mean aggregation with the same infill
    const am = annualAggregate(pts, { agg: "mean" });
    let em = 0;
    for (let m = 1; m <= 12; m++) em += m === 7 ? rate(7) + 2 / 3 : rate(m) + 1;
    close(am[2].v as number, em / 12, 1e-14);
  });

  it("years with fewer than minMonths valid months are null; missing years are kept as null rows", () => {
    const pts = monthly(2001, 3, (y, m) => (y === 2002 && m > 9 ? null : 1));
    const a = annualAggregate(pts, { minMonths: 10 });
    expect(a[1].v).toBeNull(); // only 9 months
    expect(annualAggregate(pts, { minMonths: 9 })[1].v).toBe(1);
    const withHole = [...monthly(2001, 1, () => 1), ...monthly(2003, 1, () => 3)];
    const b = annualAggregate(withHole);
    expect(b.map((p) => p.date)).toEqual(["2001", "2002", "2003"]);
    expect(b[1].v).toBeNull();
  });
});

describe("gaps, grids and smoothing", () => {
  it("missingStats counts gaps", () => {
    const pts = monthly(2000, 1, (_y, m) => (m >= 3 && m <= 5) || m === 9 ? null : m);
    expect(missingStats(pts)).toEqual({
      n: 12,
      nValid: 8,
      nMissing: 4,
      missingPct: (100 * 4) / 12,
      longestGap: 3,
      firstValidIndex: 0,
      lastValidIndex: 11,
    });
  });

  it("trimMissing drops only leading/trailing nulls", () => {
    const pts = monthly(2000, 1, (_y, m) => (m <= 2 || m === 12 || m === 6 ? null : m));
    const t = trimMissing(pts);
    expect(t[0].date).toBe("2000-03");
    expect(t[t.length - 1].date).toBe("2000-11");
    expect(t.some((p) => p.v === null)).toBe(true);
  });

  it("completeMonthlyGrid inserts absent months as nulls and sorts", () => {
    const pts: Point[] = [
      { t: decimalYear(2000, 3), date: "2000-03", v: 3 },
      { t: decimalYear(2000, 1), date: "2000-01", v: 1 },
      { t: decimalYear(2000, 6), date: "2000-06", v: 6 },
    ];
    const g = completeMonthlyGrid(pts);
    expect(g.map((p) => p.date)).toEqual(["2000-01", "2000-02", "2000-03", "2000-04", "2000-05", "2000-06"]);
    expect(g.map((p) => p.v)).toEqual([1, null, 3, null, null, 6]);
  });

  it("2×12 centred moving average preserves a linear trend and removes a pure seasonal cycle", () => {
    const pts = monthly(2000, 4, (y, m) => 2 * decimalYear(y, m) + 5 * Math.cos((2 * Math.PI * m) / 12));
    const ma = movingAverage(pts, 12);
    for (let i = 0; i < pts.length; i++) {
      if (i < 6 || i > pts.length - 7) expect(ma[i].v).toBeNull();
      else close(ma[i].v as number, 2 * pts[i].t, 1e-12);
    }
  });

  it("odd centred and trailing windows; gaps are skipped with renormalised weights", () => {
    const pts = monthly(2000, 1, (_y, m) => m);
    const c3 = movingAverage(pts, 3);
    expect(c3[0].v).toBeNull();
    expect(c3[1].v).toBe(2);
    const tr = movingAverage(pts, 3, false);
    expect(tr[1].v).toBeNull();
    expect(tr[2].v).toBe(2);
    const gappy = pts.map((p, i) => (i === 4 ? { ...p, v: null } : p));
    expect(movingAverage(gappy, 3)[4].v).toBe(5); // (4 + 6) / 2
    const sparse = pts.map((p, i) => (i === 3 || i === 5 ? { ...p, v: null } : p));
    expect(movingAverage(sparse, 3, true, 0.5)[4].v).toBeNull(); // only 1/3 of weight present
  });

  it("detrend removes an exact linear trend", () => {
    const pts = monthly(2000, 2, (y, m) => 3 + 0.5 * decimalYear(y, m));
    for (const p of detrend(pts)) expect(Math.abs(p.v as number)).toBeLessThan(1e-9);
  });

  it("monthlyMeansFromDaily averages days and requires coverage", () => {
    const days: Point[] = [];
    for (let d = 1; d <= 31; d++) days.push({ t: 2001 + d / 365, date: `2001-01-${String(d).padStart(2, "0")}`, v: d });
    for (let d = 1; d <= 10; d++) days.push({ t: 2001.1 + d / 365, date: `2001-02-${String(d).padStart(2, "0")}`, v: 1 });
    const m = monthlyMeansFromDaily(days);
    expect(m[0]).toEqual({ t: decimalYear(2001, 1), date: "2001-01", v: 16 });
    expect(m[1].v).toBeNull(); // 10 of 28 days < 50 %
  });
});
