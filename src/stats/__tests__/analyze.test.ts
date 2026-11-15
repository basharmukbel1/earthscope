import { describe, expect, it } from "vitest";
import type { AnalysisResult, Point, TimeSeries } from "../../types/domain";
import { analyzeSeries, compareMethods, METHOD_LABELS } from "../analyze";
import { InsufficientDataError } from "../errors";
import { mannKendall } from "../mannKendall";
import { ols } from "../ols";
import { senSlope } from "../sen";
import { daysInMonth, decimalYear, formatMonth } from "../series";
import { simulateMonthlySeries, type SimulationOptions } from "../simulate";
import { close } from "./helpers";

function ts(points: Point[], extra: Partial<TimeSeries> = {}): TimeSeries {
  return {
    id: "test-series",
    variableId: "t2m",
    regionId: "test-region",
    label: "Synthetic test series",
    unit: "°C",
    resolution: "monthly",
    points,
    provenance: { source: "simulation", mode: "simulation" },
    ...extra,
  };
}

const BASE: SimulationOptions = {
  startYear: 1981,
  years: 40,
  trendPerDecade: 0.25,
  noiseSd: 0.4,
  seasonalAmplitude: 6,
  ar1: 0.5,
  seed: 2026,
  baseline: 14,
};

describe("analyzeSeries end-to-end (monthly)", () => {
  const res = analyzeSeries(ts(simulateMonthlySeries(BASE)));

  it("produces the documented structure", () => {
    expect(res.seriesId).toBe("test-series");
    expect(res.startYear).toBe(1981);
    expect(res.endYear).toBe(2020);
    expect(res.nMonths).toBe(480);
    expect(res.nMissing).toBe(0);
    expect(res.missingPct).toBe(0);
    expect(res.anomalies).toHaveLength(480);
    expect(res.annual).toHaveLength(40);
    expect(res.annual[0]).toMatchObject({ t: 1981.5, date: "1981" });
    expect(res.climatology).toHaveLength(12);
    // climatology reproduces the injected seasonal cycle (July peak ≈ +6, January ≈ −6 around the mean)
    const cm = res.climatology.reduce((a, b) => a + b, 0) / 12;
    expect(res.climatology[6] - cm).toBeGreaterThan(5.5);
    expect(res.climatology[0] - cm).toBeLessThan(-5.5);
    expect(res.ols.adjusted).toBe(true);
    expect(res.seasonalKendall).toBeDefined();
    expect(res.summary.method).toBe("Mann-Kendall + Sen's slope (annual)");
    expect(typeof res.computedAt).toBe("string");
    expect(res.annualUnit).toBe("°C");
  });

  it("recovers the injected trend within the reported CI and flags it significant", () => {
    const s = res.summary;
    expect(s.direction).toBe("increasing");
    expect(s.significant).toBe(true);
    expect(s.p).toBeLessThan(0.05);
    expect(s.perDecadeCi[0]).toBeLessThan(0.25);
    expect(s.perDecadeCi[1]).toBeGreaterThan(0.25);
    expect(Math.abs(s.perDecade - 0.25)).toBeLessThan(0.08);
    close(s.totalChange, (s.perDecade / 10) * 40, 1e-12);
    close(s.pctPerDecade as number, (s.perDecade / Math.abs(res.annualMean)) * 100, 1e-12);
    expect(s.yearsToDetect).not.toBeNull();
    expect(s.yearsToDetect as number).toBeGreaterThan(3);
    expect(s.yearsToDetect as number).toBeLessThan(40);
  });

  it("summary numbers are exactly the Sen slope / MK p of the annual series", () => {
    const t = res.annual.map((p) => p.t);
    const v = res.annual.map((p) => p.v);
    const sen = senSlope(t, v);
    close(res.summary.perDecade, sen.slope * 10, 1e-14);
    close(res.summary.perDecadeCi[0], sen.ciLow * 10, 1e-14);
    close(res.summary.p, mannKendall(v).p, 1e-14);
    close(res.olsAnnual.slope, ols(t, v).slope, 1e-12);
  });

  it("primary = ols-ar1 switches the headline to the AR(1)-adjusted OLS", () => {
    const r = analyzeSeries(ts(simulateMonthlySeries(BASE)), { primary: "ols-ar1" });
    expect(r.summary.method).toBe(METHOD_LABELS["ols-ar1"]);
    close(r.summary.perDecade, r.ols.slope * 10, 1e-14);
    close(r.summary.p, r.ols.p, 1e-14);
    expect(r.summary.perDecadeCi[0]).toBeLessThan(0.25);
    expect(r.summary.perDecadeCi[1]).toBeGreaterThan(0.25);
  });

  it("a strong trend gives p < 1e-6 with every method", () => {
    const r = analyzeSeries(ts(simulateMonthlySeries({ ...BASE, trendPerDecade: 2, seed: 7 })));
    expect(r.mk.p).toBeLessThan(1e-6);
    expect(r.ols.p).toBeLessThan(1e-6);
    expect(r.olsAnnual.p).toBeLessThan(1e-6);
    expect(r.seasonalKendall!.p).toBeLessThan(1e-6);
    expect(r.summary.significant).toBe(true);
  });

  it("a decreasing trend is reported as decreasing", () => {
    const r = analyzeSeries(ts(simulateMonthlySeries({ ...BASE, trendPerDecade: -1, seed: 9 })));
    expect(r.summary.direction).toBe("decreasing");
    expect(r.summary.perDecade).toBeLessThan(0);
    expect(r.summary.totalChange).toBeLessThan(0);
  });

  it("direction is reported even when not significant; 'no-trend' only for an exactly flat series", () => {
    const flat = analyzeSeries(ts(simulateMonthlySeries({ ...BASE, trendPerDecade: 0, noiseSd: 0, seasonalAmplitude: 2 })));
    expect(flat.summary.direction).toBe("no-trend");
    expect(flat.summary.p).toBe(1);
    expect(flat.summary.significant).toBe(false);
    expect(flat.summary.yearsToDetect).toBeNull();
    for (const v of [flat.ols.p, flat.ols.slope, flat.sen.slope, flat.mk.z]) expect(Number.isNaN(v)).toBe(false);
    // a weak trend in noise: direction set, significance false
    const weak = analyzeSeries(ts(simulateMonthlySeries({ ...BASE, trendPerDecade: 0.01, noiseSd: 1.5, seed: 31 })));
    expect(["increasing", "decreasing"]).toContain(weak.summary.direction);
    expect(weak.summary.significant).toBe(weak.summary.p < 0.05);
  });
});

describe("gaps and missing data", () => {
  it("handles 15 % random gaps, a missing year and absent rows", () => {
    const pts = simulateMonthlySeries({ ...BASE, missingFraction: 0.15, seed: 99 });
    // blank out all of 1995 and physically remove 1996-03 … 1996-05 from the array
    const holed = pts
      .map((p) => (p.date.startsWith("1995") ? { ...p, v: null } : p))
      .filter((p) => !["1996-03", "1996-04", "1996-05"].includes(p.date));
    const r = analyzeSeries(ts(holed));
    expect(r.nMonths).toBe(480); // absent months were put back on the grid
    expect(r.nMissing).toBe(holed.filter((p) => p.v === null).length + 3);
    close(r.missingPct, (100 * r.nMissing) / 480, 1e-12);
    expect(r.annual.find((p) => p.date === "1995")!.v).toBeNull();
    // anomalies keep nulls where data is missing
    expect(r.anomalies.find((p) => p.date === "1995-06")!.v).toBeNull();
    expect(r.anomalies.find((p) => p.date === "1996-04")!.v).toBeNull();
    expect(r.summary.perDecadeCi[0]).toBeLessThan(0.25);
    expect(r.summary.perDecadeCi[1]).toBeGreaterThan(0.25);
  });

  it("trims leading/trailing gaps before computing the record length", () => {
    const pts = simulateMonthlySeries({ ...BASE, years: 42, startYear: 1980 }).map((p) =>
      p.t < 1981 || p.t >= 2021 ? { ...p, v: null } : p,
    );
    const r = analyzeSeries(ts(pts));
    expect(r.startYear).toBe(1981);
    expect(r.endYear).toBe(2020);
    expect(r.nMonths).toBe(480);
  });

  it("throws InsufficientDataError with fewer than 8 valid years", () => {
    const pts = simulateMonthlySeries({ ...BASE, years: 7 });
    expect(() => analyzeSeries(ts(pts))).toThrow(InsufficientDataError);
    // 10 calendar years but 3 of them have only 9 valid months → 7 valid years
    const sparse = simulateMonthlySeries({ ...BASE, years: 10 }).map((p) => {
      const y = Math.floor(p.t);
      const m = Number(p.date.slice(5));
      return y < 1984 && m > 9 ? { ...p, v: null } : p;
    });
    expect(() => analyzeSeries(ts(sparse))).toThrow(/at least 8 years/);
    expect(analyzeSeries(ts(sparse), { minMonthsPerYear: 9 }).annual.filter((p) => p.v !== null)).toHaveLength(10);
    expect(() => analyzeSeries(ts([]))).toThrow(InsufficientDataError);
  });
});

describe("precipitation-style 'sum' aggregation", () => {
  // 3.0 mm/day + trend 0.01 mm/day per year, seasonal cycle, no noise
  const rate = (y: number, m: number) => 3 + 0.01 * (decimalYear(y, m) - 1990) + 1.5 * Math.cos((2 * Math.PI * (m - 1)) / 12);
  const pts: Point[] = [];
  for (let y = 1990; y < 2020; y++) for (let m = 1; m <= 12; m++) pts.push({ t: decimalYear(y, m), date: formatMonth(y, m), v: rate(y, m) });
  const r = analyzeSeries(ts(pts, { unit: "mm/day", variableId: "prectot" }), { annualAgg: "sum", annualSumFactor: "daysInMonth" });

  it("annual totals are Σ rate × days (mm/yr) with leap years", () => {
    for (const a of r.annual) {
      const y = Math.floor(a.t);
      let tot = 0;
      for (let m = 1; m <= 12; m++) tot += rate(y, m) * daysInMonth(y, m);
      close(a.v as number, tot, 1e-12);
    }
    expect(r.annualUnit).toBe("mm/yr");
    expect(r.unit).toBe("mm/day");
    expect(r.monthlyToAnnualFactor).toBe(365.2425);
  });

  it("all methods agree on the annual-total trend (≈ 0.01 mm/day/yr × 365.25 days)", () => {
    const expectedPerDecade = 0.01 * 365.2425 * 10; // ≈ 36.5 mm/yr per decade
    const rows = compareMethods(r);
    expect(rows.map((x) => x.id)).toEqual(["ols-ar1", "ols-naive", "ols-annual", "mk-sen", "mk-hamed-rao", "seasonal-kendall"]);
    for (const row of rows) {
      // leap-year day counts make annual totals slightly non-linear; allow 1 %
      expect(Math.abs(row.slopePerDecade - expectedPerDecade) / expectedPerDecade).toBeLessThan(0.01);
    }
    expect(Math.abs(r.summary.perDecade - expectedPerDecade) / expectedPerDecade).toBeLessThan(0.01);
    close(r.mean, 3 + 0.01 * 15, 1e-9); // monthly mean in mm/day
    expect(r.annualMean).toBeGreaterThan(1000);
    close(r.summary.pctPerDecade as number, (r.summary.perDecade / r.annualMean) * 100, 1e-12);
  });
});

describe("other resolutions", () => {
  it("annual input skips seasonal steps", () => {
    const pts: Point[] = [];
    for (let y = 1990; y < 2010; y++) pts.push({ t: y + 0.5, date: String(y), v: 5 + 0.03 * (y - 1990) + (y % 3 === 0 ? 0.05 : -0.02) });
    const r = analyzeSeries(ts(pts, { resolution: "annual" }));
    expect(r.seasonalKendall).toBeUndefined();
    expect(r.climatology.every((c) => Number.isNaN(c))).toBe(true);
    expect(r.annual).toHaveLength(20);
    expect(r.startYear).toBe(1990);
    expect(r.endYear).toBe(2009);
    close(r.olsAnnual.slope, r.ols.slope, 1e-12);
    expect(r.summary.direction).toBe("increasing");
    expect(r.summary.yearsToDetect).not.toBeNull();
  });

  it("daily input is averaged to monthly first", () => {
    const pts: Point[] = [];
    for (let y = 2000; y < 2010; y++)
      for (let m = 1; m <= 12; m++)
        for (let d = 1; d <= daysInMonth(y, m); d++)
          pts.push({ t: decimalYear(y, m), date: `${formatMonth(y, m)}-${String(d).padStart(2, "0")}`, v: 0.1 * (y - 2000) + m + (d % 2) });
    const r = analyzeSeries(ts(pts, { resolution: "daily" }));
    expect(r.nMonths).toBe(120);
    expect(r.annual).toHaveLength(10);
    close(r.ols.slope, 0.1, 0.02);
  });
});

describe("compareMethods", () => {
  it("returns comparable rows with exactly one primary method", () => {
    const r = analyzeSeries(ts(simulateMonthlySeries(BASE)));
    const rows = compareMethods(r);
    expect(rows.filter((x) => x.primary).map((x) => x.id)).toEqual(["mk-sen"]);
    const mk = rows.find((x) => x.id === "mk-sen")!;
    close(mk.slopePerDecade, r.summary.perDecade, 1e-14);
    expect(mk.ci).toEqual(r.summary.perDecadeCi);
    const naive = rows.find((x) => x.id === "ols-naive")!;
    const ar1 = rows.find((x) => x.id === "ols-ar1")!;
    close(naive.slopePerDecade, ar1.slopePerDecade, 1e-12); // same fit…
    expect(ar1.p).toBeGreaterThan(naive.p); // …but honest uncertainty
    expect((ar1.ci as [number, number])[1] - (ar1.ci as [number, number])[0]).toBeGreaterThan(
      (naive.ci as [number, number])[1] - (naive.ci as [number, number])[0],
    );
    for (const row of rows) {
      expect(row.significant).toBe(row.p < 0.05);
      expect(row.notes.length).toBeGreaterThan(0);
      expect(Number.isFinite(row.slopePerDecade)).toBe(true);
    }
  });

  it("works on a plain AnalysisResult (without the extended fields)", () => {
    const full = analyzeSeries(ts(simulateMonthlySeries(BASE)));
    const { olsNaive: _a, mkHamedRao: _b, monthlyToAnnualFactor: _c, primary: _d, ...plain } = full;
    const rows = compareMethods(plain as AnalysisResult);
    expect(rows.map((x) => x.id)).toEqual(["ols-ar1", "ols-annual", "mk-sen", "seasonal-kendall"]);
    expect(rows.find((x) => x.id === "mk-sen")!.primary).toBe(true);
  });
});
