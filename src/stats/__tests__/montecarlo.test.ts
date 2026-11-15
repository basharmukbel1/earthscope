/* Monte-Carlo sanity checks: false-positive rates under H0 and CI coverage.
   All seeds are fixed, so results are deterministic. Binomial bounds are
   wide (≈ ±3.5 SE) so the tests check calibration, not luck. */
import { describe, expect, it } from "vitest";
import type { Point } from "../../types/domain";
import { analyzeSeries } from "../analyze";
import { hamedRaoMannKendall, mannKendall } from "../mannKendall";
import { ols, olsAR1 } from "../ols";
import { seasonalKendall } from "../seasonalKendall";
import { gaussian, mulberry32, simulateMonthlySeries } from "../simulate";

function whiteNoiseAnnual(seed: number, n = 40): { t: number[]; v: number[] } {
  const rng = mulberry32(seed);
  const t = Array.from({ length: n }, (_, i) => 1980.5 + i);
  return { t, v: t.map(() => gaussian(rng)) };
}

describe("type-I error under pure noise (nominal 5 %)", () => {
  const trials = 1000;

  it("Mann-Kendall, OLS and Hamed-Rao (lags 1-3, no shrinkage) reject ≈ 5 % of white-noise series", () => {
    let mk = 0;
    let lin = 0;
    let hr = 0;
    for (let s = 0; s < trials; s++) {
      const { t, v } = whiteNoiseAnnual(10_000 + s);
      if (mannKendall(v).p < 0.05) mk++;
      if (ols(t, v).p < 0.05) lin++;
      if (hamedRaoMannKendall(v, 0.05, { lag: 3, minCorrection: 1 }).p < 0.05) hr++;
    }
    expect(mk / trials).toBeGreaterThan(0.025);
    expect(mk / trials).toBeLessThan(0.075);
    expect(lin / trials).toBeGreaterThan(0.03);
    expect(lin / trials).toBeLessThan(0.075);
    expect(hr / trials).toBeGreaterThan(0.025);
    expect(hr / trials).toBeLessThan(0.075);
  });

  it("Hamed-Rao reduces the false-positive inflation of Mann-Kendall under AR(1) noise", () => {
    let mk = 0;
    let hr = 0;
    const n = 500;
    for (let s = 0; s < n; s++) {
      const rng = mulberry32(70_000 + s);
      const v: number[] = [];
      let e = gaussian(rng);
      for (let i = 0; i < 40; i++) {
        if (i > 0) e = 0.5 * e + Math.sqrt(0.75) * gaussian(rng);
        v.push(e);
      }
      if (mannKendall(v).p < 0.05) mk++;
      if (hamedRaoMannKendall(v, 0.05, { lag: 3, minCorrection: 1 }).p < 0.05) hr++;
    }
    expect(mk / n).toBeGreaterThan(0.12); // the original test is badly over-confident here
    expect(hr / n).toBeLessThan(mk / n - 0.04);
  });

  it("AR(1) monthly noise: naive OLS is badly over-confident, Santer-adjusted OLS is not", () => {
    let naive = 0;
    let adjusted = 0;
    const n = 300;
    for (let s = 0; s < n; s++) {
      const pts = simulateMonthlySeries({ startYear: 1981, years: 40, trendPerDecade: 0, noiseSd: 1, ar1: 0.6, seed: 20_000 + s });
      if (ols(pts.map((p) => p.t), pts.map((p) => p.v)).p < 0.05) naive++;
      if (olsAR1(pts).p < 0.05) adjusted++;
    }
    expect(naive / n).toBeGreaterThan(0.15);
    expect(adjusted / n).toBeLessThan(0.1);
  });

  it("seasonal Kendall on seasonal white noise rejects ≈ 5 %", () => {
    let k = 0;
    const n = 300;
    for (let s = 0; s < n; s++) {
      const pts = simulateMonthlySeries({ startYear: 1990, years: 25, trendPerDecade: 0, noiseSd: 1, seasonalAmplitude: 10, seed: 30_000 + s });
      if (seasonalKendall(pts).p < 0.05) k++;
    }
    expect(k / n).toBeLessThan(0.1);
    expect(k / n).toBeGreaterThan(0.01);
  });

  it("analyzeSeries headline (MK on annual means) false-positive rate ≈ 5 %", () => {
    let fp = 0;
    const n = 300;
    for (let s = 0; s < n; s++) {
      const pts = simulateMonthlySeries({ startYear: 1981, years: 40, trendPerDecade: 0, noiseSd: 0.5, seasonalAmplitude: 4, ar1: 0.4, seed: 40_000 + s });
      if (analyzeSeries({ id: "x", variableId: "x", regionId: "x", label: "x", unit: "u", resolution: "monthly", points: pts, provenance: { source: "sim", mode: "simulation" } }).summary.significant) fp++;
    }
    expect(fp / n).toBeLessThan(0.1);
    expect(fp / n).toBeGreaterThan(0.01);
  });
});

describe("power and CI coverage", () => {
  it("strong trends are detected with p < 1e-6", () => {
    for (let s = 0; s < 20; s++) {
      const pts = simulateMonthlySeries({ startYear: 1981, years: 40, trendPerDecade: 1.5, noiseSd: 0.5, ar1: 0.5, seed: 50_000 + s });
      expect(olsAR1(pts).p).toBeLessThan(1e-6);
      expect(mannKendall(analyzeSeriesAnnual(pts)).p).toBeLessThan(1e-6);
    }
  });

  it("95 % CIs from analyzeSeries cover the injected trend ≈ 95 % of the time", () => {
    const n = 200;
    const truth = 0.3;
    let senCover = 0;
    let olsCover = 0;
    for (let s = 0; s < n; s++) {
      const pts = simulateMonthlySeries({ startYear: 1981, years: 40, trendPerDecade: truth, noiseSd: 0.5, seasonalAmplitude: 3, ar1: 0.5, seed: 60_000 + s });
      const series = { id: "x", variableId: "x", regionId: "x", label: "x", unit: "u", resolution: "monthly" as const, points: pts, provenance: { source: "sim", mode: "simulation" as const } };
      const a = analyzeSeries(series);
      if (a.summary.perDecadeCi[0] <= truth && truth <= a.summary.perDecadeCi[1]) senCover++;
      const o = analyzeSeries(series, { primary: "ols-ar1" });
      if (o.summary.perDecadeCi[0] <= truth && truth <= o.summary.perDecadeCi[1]) olsCover++;
    }
    expect(senCover / n).toBeGreaterThan(0.88);
    expect(olsCover / n).toBeGreaterThan(0.88);
    expect(senCover / n).toBeLessThan(0.995);
    expect(olsCover / n).toBeLessThan(0.995);
  });
});

/** Annual means of a complete monthly series (helper for the power test). */
function analyzeSeriesAnnual(pts: Point[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 12 <= pts.length; i += 12) out.push(pts.slice(i, i + 12).reduce((a, p) => a + (p.v as number), 0) / 12);
  return out;
}
