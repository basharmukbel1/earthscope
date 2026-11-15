import { describe, expect, it } from "vitest";
import { InsufficientDataError } from "../errors";
import { hamedRaoMannKendall, mannKendall, mkScore, mkVarianceS, mkZ } from "../mannKendall";
import { seasonalKendall, seasonalKendallBySeason } from "../seasonalKendall";
import { senSlope } from "../sen";
import { close, fixtures, toPoints } from "./helpers";

describe("Mann-Kendall vs pymannkendall.original_test", () => {
  it.each(fixtures.mk)("$name", (f) => {
    const r = mannKendall(f.values, f.alpha);
    expect(r.n).toBe(f.n);
    expect(r.s).toBe(f.s);
    close(r.varS, f.varS, 1e-14, 0, "varS");
    close(r.z, f.z, 1e-13, 1e-15, "z");
    close(r.tau, f.tau, 1e-14, 0, "tau");
    close(r.p, f.pSf, 1e-12, 1e-300, "p (vs 2·norm.sf)");
    expect(r.significant).toBe(r.p < f.alpha);
    if (f.pmk) {
      expect(r.s).toBe(f.pmk.s);
      close(r.varS, f.pmk.varS, 1e-14, 0, "pmk varS");
      close(r.z, f.pmk.z, 1e-13, 1e-15, "pmk z");
      close(r.tau, f.pmk.tau, 1e-14, 0, "pmk tau");
      // pymannkendall computes 2·(1 − Φ(|z|)), accurate only in absolute terms
      close(r.p, f.pmk.p, 0, 1e-14, "pmk p");
      // Sen slope with unit-spaced index time equals pymannkendall.sens_slope
      const idx = f.values.map((_, i) => i);
      const sen = senSlope(idx, f.values, f.alpha);
      close(sen.slope, f.pmk.slope, 1e-12, 1e-15, "pmk sen slope");
      close(sen.intercept, f.pmk.intercept, 1e-12, 1e-12, "pmk sen intercept");
    }
  });

  it("keeps precision for extremely small p where 1 − Φ underflows", () => {
    const f = fixtures.mk.find((x) => x.name === "strong-trend-60")!;
    const r = mannKendall(f.values);
    expect(f.pmk?.p).toBe(0); // pymannkendall's 2(1 − Φ) underflows
    expect(r.p).toBeGreaterThan(0);
    close(r.p, f.pSf, 1e-12);
  });

  it("ties correction and continuity correction (hand-computed)", () => {
    // x = 1, 2, 2, 3: pairs (+,+,+,0,+,+) → S = 5; one tie group of 2:
    // Var = [4·3·13 − 2·1·9]/18 = (156 − 18)/18 = 7.6667
    const x = [1, 2, 2, 3];
    expect(mkScore(x)).toBe(5);
    close(mkVarianceS(x), 138 / 18, 1e-15);
    close(mkZ(5, 138 / 18), 4 / Math.sqrt(138 / 18), 1e-15);
    expect(mkZ(0, 5)).toBe(0);
    expect(mkZ(-3, 4)).toBe(-1);
    expect(mkZ(3, 0)).toBe(0);
  });

  it("all-tied input gives S = 0, Var = 0, p = 1 (no NaN)", () => {
    const r = mannKendall([4, 4, 4, 4, 4]);
    expect(r.s).toBe(0);
    expect(r.varS).toBe(0);
    expect(r.z).toBe(0);
    expect(r.p).toBe(1);
  });

  it("throws InsufficientDataError for fewer than 3 valid values", () => {
    expect(() => mannKendall([1, null, 2])).toThrow(InsufficientDataError);
  });
});

describe("Hamed-Rao modified Mann-Kendall", () => {
  it.each(fixtures.hamedRao)("$name", (f) => {
    const r = hamedRaoMannKendall(f.values, f.alpha);
    expect(r.n).toBe(f.n);
    expect(r.s).toBe(f.s);
    close(r.varS, f.varS, 1e-11, 0, "varS");
    close(r.correction, f.correction, 1e-11, 1e-14, "correction");
    close(r.z, f.z, 1e-11, 1e-14, "z");
    close(r.p, f.p, 1e-9, 1e-300, "p");
    close(r.tau, f.tau, 1e-14, 0, "tau");
    if (f.pmk) {
      close(r.varS, f.pmk.varS, 1e-11, 0, "pmk varS");
      close(r.z, f.pmk.z, 1e-11, 1e-14, "pmk z");
      close(r.p, f.pmk.p, 0, 1e-12, "pmk p");
    }
  });

  it("inflates Var(S) for positively autocorrelated data and leaves white noise alone", () => {
    const ar = fixtures.hamedRao.find((x) => x.name === "trend-ar08-80")!;
    const r = hamedRaoMannKendall(ar.values);
    expect(r.correction).toBeGreaterThan(1);
    expect(r.p).toBeGreaterThan(mannKendall(ar.values).p);
    const w = fixtures.hamedRao.find((x) => x.name === "white-50")!;
    const rw = hamedRaoMannKendall(w.values);
    expect(rw.correction).toBe(1);
    expect(rw.significantLags).toEqual([]);
    close(rw.p, mannKendall(w.values).p, 1e-15);
  });

  it("accepts an explicit time axis (decimal years)", () => {
    const f = fixtures.hamedRao.find((x) => x.name === "ar06-nans-50")!;
    const t = f.values.map((_, i) => 1970.5 + i); // shifted unit spacing → identical ranks
    const r = hamedRaoMannKendall(f.values, 0.05, { t });
    close(r.z, f.z, 1e-11, 1e-14);
  });
});

describe("Sen's slope with Gilbert (1987) CI", () => {
  it.each(fixtures.sen)("$name", (f) => {
    const r = senSlope(f.t, f.v, f.alpha);
    close(r.slope, f.slope, 1e-12, 1e-15, "slope");
    close(r.intercept, f.intercept, 1e-12, 1e-12, "intercept");
    close(r.ciLow, f.ciLow, 1e-12, 1e-15, "ciLow (interpolated ranks)");
    close(r.ciHigh, f.ciHigh, 1e-12, 1e-15, "ciHigh (interpolated ranks)");
    expect(r.nSlopes).toBe(f.nSlopes);
    close(r.varS, f.varS, 1e-14, 0, "varS");
    expect(r.ciLow).toBeLessThanOrEqual(r.slope);
    expect(r.ciHigh).toBeGreaterThanOrEqual(r.slope);
    if (f.scipy) {
      // nearest-rank CI is exactly scipy.stats.theilslopes
      const s = senSlope(f.t, f.v, f.alpha, { rankMethod: "nearest" });
      close(s.slope, f.scipy.slope, 1e-12, 1e-15, "scipy slope");
      close(s.intercept, f.scipy.intercept, 1e-12, 1e-12, "scipy intercept");
      close(s.ciLow, f.scipy.low, 1e-12, 1e-15, "scipy low");
      close(s.ciHigh, f.scipy.high, 1e-12, 1e-15, "scipy high");
    }
    if (f.pmk) {
      close(r.slope, f.pmk.slope, 1e-12, 1e-15, "pmk slope");
      close(r.intercept, f.pmk.intercept, 1e-12, 1e-12, "pmk intercept");
    }
  });

  it("is robust to an outlier, unlike OLS", () => {
    const t = Array.from({ length: 20 }, (_, i) => 2000.5 + i);
    const v = t.map((x) => 0.1 * (x - 2000));
    v[10] = 100;
    close(senSlope(t, v).slope, 0.1, 1e-12);
  });

  it("uses actual time, so gaps do not change the slope", () => {
    const t = [2000.5, 2001.5, 2002.5, 2007.5, 2008.5, 2009.5];
    close(senSlope(t, t.map((x) => 2 * x)).slope, 2, 1e-12);
  });

  it("throws on fewer than 3 valid points", () => {
    expect(() => senSlope([1, 2, 3], [1, null, 3])).toThrow(InsufficientDataError);
  });
});

describe("Seasonal Kendall vs pymannkendall.seasonal_test", () => {
  it.each(fixtures.seasonal)("$name", (f) => {
    const r = seasonalKendall(toPoints(f.t, f.values, f.dates), f.alpha);
    expect(r.n).toBe(f.n);
    expect(r.s).toBe(f.s);
    close(r.varS, f.varS, 1e-13, 0, "varS");
    close(r.z, f.z, 1e-13, 1e-15, "z");
    close(r.p, f.pSf, 1e-12, 1e-300, "p");
    close(r.slope, f.slope, 1e-12, 1e-15, "seasonal Sen slope");
    if (f.pmk) {
      expect(r.s).toBe(f.pmk.s);
      close(r.varS, f.pmk.varS, 1e-13, 0, "pmk varS");
      close(r.z, f.pmk.z, 1e-13, 1e-15, "pmk z");
      close(r.p, f.pmk.p, 0, 1e-14, "pmk p");
      // pymannkendall uses integer year steps; we use decimal-year differences
      close(r.slope, f.pmk.slope, 1e-9, 1e-12, "pmk slope");
    }
  });

  it("per-season breakdown sums to the overall statistics", () => {
    const f = fixtures.seasonal[0];
    const pts = toPoints(f.t, f.values, f.dates);
    const by = seasonalKendallBySeason(pts);
    expect(by).toHaveLength(12);
    expect(by.reduce((a, b) => a + b.s, 0)).toBe(f.s);
    close(
      by.reduce((a, b) => a + b.varS, 0),
      f.varS,
      1e-13,
    );
    expect(by.reduce((a, b) => a + b.n, 0)).toBe(f.n);
  });

  it("is not fooled by a strong seasonal cycle", () => {
    // Pure seasonal cycle, no trend → S = 0 for every month
    const pts = [];
    for (let y = 2000; y < 2010; y++)
      for (let m = 1; m <= 12; m++) pts.push({ t: y + (m - 0.5) / 12, date: `${y}-${String(m).padStart(2, "0")}`, v: 10 * Math.sin(m) });
    const r = seasonalKendall(pts);
    expect(r.s).toBe(0);
    expect(r.p).toBe(1);
    expect(r.slope).toBe(0);
  });
});
