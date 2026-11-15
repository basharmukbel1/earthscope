import { describe, expect, it } from "vitest";
import { brethertonNEff, correlationMatrix, lagCorrelation, pearson, spearman } from "../correlation";
import { InsufficientDataError } from "../errors";
import { lag1Autocorrelation } from "../series";
import { gaussian, mulberry32, simulateMonthlySeries } from "../simulate";
import { close, fixtures } from "./helpers";

describe("pearson / spearman vs scipy.stats", () => {
  it.each(fixtures.correlation)("$name", (f) => {
    const p = pearson(f.x, f.y);
    expect(p.n).toBe(f.n);
    expect(p.df).toBe(f.n - 2);
    close(p.r, f.pearsonR, 1e-12, 1e-15, "pearson r");
    close(p.p, f.pearsonP, 1e-9, 1e-300, "pearson p");
    const s = spearman(f.x, f.y);
    close(s.r, f.spearmanR, 1e-12, 1e-15, "spearman r");
    close(s.p, f.spearmanP, 1e-9, 1e-300, "spearman p");
  });

  it("perfect correlation gives p = 0 without NaN; zero variance throws", () => {
    const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
    close(r.r, 1, 1e-15);
    expect(r.p).toBe(0);
    expect(() => pearson([1, 1, 1, 1], [1, 2, 3, 4])).toThrow(InsufficientDataError);
    expect(() => pearson([1, 2], [1, 2])).toThrow(InsufficientDataError);
  });
});

describe("Bretherton et al. (1999) effective sample size", () => {
  it("matches n(1 − r1x·r1y)/(1 + r1x·r1y)", () => {
    const a = simulateMonthlySeries({ startYear: 2000, years: 20, trendPerDecade: 0, noiseSd: 1, ar1: 0.6, seed: 3 }).map((p) => p.v);
    const b = simulateMonthlySeries({ startYear: 2000, years: 20, trendPerDecade: 0, noiseSd: 1, ar1: 0.5, seed: 4 }).map((p) => p.v);
    const r1a = lag1Autocorrelation(a);
    const r1b = lag1Autocorrelation(b);
    const n = 240;
    close(brethertonNEff(a, b), (n * (1 - r1a * r1b)) / (1 + r1a * r1b), 1e-12);
    const adj = pearson(a, b, { effectiveN: "bretherton" });
    const raw = pearson(a, b);
    close(adj.r, raw.r, 1e-15);
    expect(adj.nEff).toBeLessThan(raw.nEff);
    expect(adj.p).toBeGreaterThan(raw.p);
    close(adj.df, adj.nEff - 2, 1e-15);
  });

  it("is clamped to [3, n]", () => {
    const x = [1, -1, 1, -1, 1, -1, 1, -1];
    const y = [1, 1, -1, -1, 1, 1, -1, -1];
    expect(brethertonNEff(x, x)).toBeLessThanOrEqual(8); // r1² > 0 but bounded by n
    const smooth = Array.from({ length: 30 }, (_, i) => i);
    expect(brethertonNEff(smooth, smooth)).toBeGreaterThanOrEqual(3);
    expect(pearson(x, y, { effectiveN: 1 }).nEff).toBe(3);
  });

  it("controls false positives between independent autocorrelated series", () => {
    let naive = 0;
    let adjusted = 0;
    const trials = 300;
    for (let s = 0; s < trials; s++) {
      const a = simulateMonthlySeries({ startYear: 2000, years: 20, trendPerDecade: 0, noiseSd: 1, ar1: 0.8, seed: 1000 + s }).map((p) => p.v);
      const b = simulateMonthlySeries({ startYear: 2000, years: 20, trendPerDecade: 0, noiseSd: 1, ar1: 0.8, seed: 5000 + s }).map((p) => p.v);
      if (pearson(a, b).p < 0.05) naive++;
      if (pearson(a, b, { effectiveN: "bretherton" }).p < 0.05) adjusted++;
    }
    expect(naive / trials).toBeGreaterThan(0.2); // badly inflated
    expect(adjusted / trials).toBeLessThan(0.1); // close to nominal 5 %
  });
});

describe("lagCorrelation", () => {
  it("finds the lag at which y follows x (positive lag = y lags x)", () => {
    const rng = mulberry32(42);
    const n = 300;
    const x = Array.from({ length: n }, () => gaussian(rng));
    const y = x.map((_, i) => (i >= 3 ? x[i - 3] : 0) + 0.3 * gaussian(rng));
    const rows = lagCorrelation(x, y, 6);
    expect(rows).toHaveLength(13);
    expect(rows.map((r) => r.lag)).toEqual([-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
    const best = rows.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
    expect(best.lag).toBe(3);
    expect(best.significant).toBe(true);
    expect(best.n).toBe(n - 3);
    close(best.pBonferroni, Math.min(1, best.p * 13), 1e-15);
    // manual check of the pairing convention at lag 3: x[i] with y[i+3]
    const manual = pearson(x.slice(0, n - 3), y.slice(3), { effectiveN: "bretherton" });
    close(best.r, manual.r, 1e-14);
    close(best.p, manual.p, 1e-12);
    // negative lag pairs x[i] with y[i−k]
    const neg = rows.find((r) => r.lag === -2)!;
    close(neg.r, pearson(x.slice(2), y.slice(0, n - 2)).r, 1e-14);
  });

  it("handles lags without enough data gracefully", () => {
    const rows = lagCorrelation([1, 2, 3, 4], [2, 1, 4, 3], 3, { effectiveN: "none" });
    expect(rows.find((r) => r.lag === 3)!.significant).toBe(false);
    expect(Number.isNaN(rows.find((r) => r.lag === 3)!.r)).toBe(true);
  });
});

describe("correlationMatrix", () => {
  it("is symmetric with unit diagonal and pairwise-complete n", () => {
    const m = correlationMatrix({
      a: [1, 2, 3, 4, 5, null],
      b: [2, 4, 5, 4, 5, 7],
      c: [5, 3, 2, 2, 1, 0],
      flat: [1, 1, 1, 1, 1, 1],
    });
    expect(m.labels).toEqual(["a", "b", "c", "flat"]);
    expect(m.r[0][0]).toBe(1);
    expect(m.r[0][1]).toBe(m.r[1][0]);
    expect(m.n[0][1]).toBe(5);
    expect(m.n[1][2]).toBe(6);
    close(m.r[0][1], pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]).r, 1e-15);
    expect(Number.isNaN(m.r[0][3])).toBe(true); // zero variance → undefined
    const sm = correlationMatrix([{ label: "x", values: [1, 2, 3, 4] }, { label: "y", values: [1, 3, 2, 4] }], { method: "spearman" });
    close(sm.r[0][1], spearman([1, 2, 3, 4], [1, 3, 2, 4]).r, 1e-15);
  });
});
