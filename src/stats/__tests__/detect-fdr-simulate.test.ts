import { describe, expect, it } from "vitest";
import { weatherheadTrendSd, weatherheadYearsToDetect } from "../detect";
import { benjaminiHochberg, benjaminiHochbergAdjust } from "../fdr";
import { olsAR1 } from "../ols";
import { lag1Autocorrelation, mean, std } from "../series";
import { gaussian, mulberry32, simulateMonthlySeries } from "../simulate";
import { close, fixtures } from "./helpers";

describe("Weatherhead et al. (1998) years to detect", () => {
  it("matches the closed form", () => {
    // ω0 = 0.02/yr, σN = 0.5, φ = 0.6: (3.3·0.5/0.02)·√(1.6/0.4) = 165 → 165^(2/3)
    close(weatherheadYearsToDetect(0.02, 0.5, 0.6) as number, Math.cbrt(165 * 165), 1e-14);
    close(weatherheadYearsToDetect(-0.02, 0.5, 0.6) as number, Math.cbrt(165 * 165), 1e-14);
    close(weatherheadYearsToDetect(0.1, 1, 0) as number, Math.cbrt(33 * 33), 1e-14);
    // annual data: σ scaled by √12
    close(weatherheadYearsToDetect(0.1, 1, 0, 1) as number, Math.cbrt(33 * 33 * 12), 1e-14);
    close(weatherheadTrendSd(1, 0, 8), 1 / Math.pow(8, 1.5), 1e-15);
  });

  it("returns null for undefined cases", () => {
    expect(weatherheadYearsToDetect(0, 1, 0.3)).toBeNull();
    expect(weatherheadYearsToDetect(0.1, 0, 0.3)).toBeNull();
    expect(weatherheadYearsToDetect(0.1, 1, 1)).toBeNull();
    expect(weatherheadYearsToDetect(NaN, 1, 0.3)).toBeNull();
  });

  it("more noise or more autocorrelation → more years needed", () => {
    const base = weatherheadYearsToDetect(0.02, 0.5, 0.3) as number;
    expect(weatherheadYearsToDetect(0.02, 1.0, 0.3) as number).toBeGreaterThan(base);
    expect(weatherheadYearsToDetect(0.02, 0.5, 0.7) as number).toBeGreaterThan(base);
    expect(weatherheadYearsToDetect(0.04, 0.5, 0.3) as number).toBeLessThan(base);
  });

  it("Monte Carlo: after n* years a trend is detected most of the time (design target 90 %)", () => {
    const trendPerYear = 0.03;
    const sd = 0.5;
    const phi = 0.5;
    const years = Math.ceil(weatherheadYearsToDetect(trendPerYear, sd, phi) as number);
    let hits = 0;
    const trials = 200;
    for (let s = 0; s < trials; s++) {
      const pts = simulateMonthlySeries({ startYear: 1, years, trendPerDecade: trendPerYear * 10, noiseSd: sd, ar1: phi, seed: 777 + s });
      if (olsAR1(pts).p < 0.05) hits++;
    }
    expect(hits / trials).toBeGreaterThan(0.75);
  });
});

describe("Benjamini-Hochberg FDR vs scipy.stats.false_discovery_control", () => {
  it.each(fixtures.fdr)("$name at alpha $alpha", (f) => {
    const adj = benjaminiHochbergAdjust(f.p);
    adj.forEach((q, i) => close(q, f.adjusted[i], 1e-12, 1e-15, `q[${i}]`));
    expect(benjaminiHochberg(f.p, f.alpha)).toEqual(f.reject);
  });

  it("step-up rule: rejects every p up to the largest k with p_(k) <= k·alpha/m", () => {
    // m = 5, alpha = 0.05: thresholds 0.01, 0.02, 0.03, 0.04, 0.05.
    // p_(3) = 0.025 <= 0.03 → reject the 3 smallest, even though p_(2) = 0.021 > 0.02.
    expect(benjaminiHochberg([0.3, 0.025, 0.005, 0.021, 0.2], 0.05)).toEqual([false, true, true, true, false]);
  });

  it("missing p-values are excluded and never significant; default alpha is 0.1 (Wilks 2016)", () => {
    const res = benjaminiHochberg([0.001, null, 0.04, NaN, 0.5]);
    expect(res).toEqual([true, false, true, false, false]);
    const q = benjaminiHochbergAdjust([0.001, null, 0.04]);
    close(q[0], 0.002, 1e-15);
    expect(Number.isNaN(q[1])).toBe(true);
    close(q[2], 0.04, 1e-15);
  });
});

describe("simulate", () => {
  it("mulberry32 is deterministic and uniform-ish", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const xs = Array.from({ length: 10000 }, () => a());
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(Math.abs(mean(xs) - 0.5)).toBeLessThan(0.01);
  });

  it("gaussian has mean 0 and sd 1", () => {
    const rng = mulberry32(9);
    const xs = Array.from({ length: 20000 }, () => gaussian(rng));
    expect(Math.abs(mean(xs))).toBeLessThan(0.03);
    expect(Math.abs(std(xs) - 1)).toBeLessThan(0.03);
  });

  it("simulateMonthlySeries has the requested structure", () => {
    const pts = simulateMonthlySeries({
      startYear: 1990,
      years: 300,
      trendPerDecade: 0.5,
      noiseSd: 0.8,
      seasonalAmplitude: 0,
      ar1: 0.6,
      seed: 5,
      baseline: 10,
    });
    expect(pts).toHaveLength(3600);
    expect(pts[0].date).toBe("1990-01");
    expect(pts[11].date).toBe("1990-12");
    close(pts[0].t, 1990 + 0.5 / 12, 1e-15);
    const fit = olsAR1(pts);
    close(fit.slope, 0.05, 0.05);
    const resid = pts.map((p) => (p.v as number) - (fit.intercept + fit.slope * p.t));
    expect(Math.abs(std(resid) - 0.8)).toBeLessThan(0.05);
    expect(Math.abs(lag1Autocorrelation(resid) - 0.6)).toBeLessThan(0.04);
    close(fit.intercept + fit.slope * 1990, 10, 0, 0.15);
  });

  it("seasonal cycle peaks in July; gaps use their own RNG stream", () => {
    const pts = simulateMonthlySeries({ startYear: 2000, years: 1, trendPerDecade: 0, noiseSd: 0, seasonalAmplitude: 3, seed: 1 });
    expect(pts[6].v).toBeCloseTo(3, 12);
    expect(pts[0].v).toBeCloseTo(-3, 12);
    const full = simulateMonthlySeries({ startYear: 2000, years: 10, trendPerDecade: 1, noiseSd: 1, seed: 8 });
    const gappy = simulateMonthlySeries({ startYear: 2000, years: 10, trendPerDecade: 1, noiseSd: 1, seed: 8, missingFraction: 0.2 });
    const nNull = gappy.filter((p) => p.v === null).length;
    expect(nNull).toBeGreaterThan(5);
    gappy.forEach((p, i) => {
      if (p.v !== null) expect(p.v).toBe(full[i].v);
    });
    expect(() => simulateMonthlySeries({ startYear: 2000, years: 1, trendPerDecade: 0, noiseSd: 1, ar1: 1 })).toThrow(RangeError);
  });
});
