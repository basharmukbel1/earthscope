import { describe, expect, it } from "vitest";
import type { TimeSeries } from "@/types/domain";
import { getVariable } from "@/data/catalog";
import { analyzeSeries, simulateMonthlySeries } from "@/stats";
import { plainSentence } from "@/utils/plainSentence";

function result(variableId: string, trendPerDecade: number, noiseSd: number, seed: number) {
  const v = getVariable(variableId)!;
  const series: TimeSeries = {
    id: "t",
    variableId,
    regionId: "r",
    label: "test",
    unit: v.unit,
    resolution: "monthly",
    points: simulateMonthlySeries({ startYear: 1981, years: 45, trendPerDecade, noiseSd, seasonalAmplitude: 1, seed, baseline: 20 }),
    provenance: { source: "test fixture", mode: "simulation" },
  };
  return { r: analyzeSeries(series, { alpha: 0.05 }), v };
}

describe("plainSentence", () => {
  it("states a significant warming plainly, with the computed numbers", () => {
    const { r, v } = result("t2m", 0.4, 0.1, 1);
    expect(r.summary.significant).toBe(true);
    const s = plainSentence(r, v, "Cameroon");
    expect(s).toMatch(/^Cameroon is warming by about \d+\.\d+ °C every decade — a statistically significant trend \(p/);
    expect(s).toContain(Math.abs(r.summary.perDecade).toFixed(v.decimals));
  });

  it("never states a non-significant trend as a fact", () => {
    const { r, v } = result("t2m", 0.01, 2, 2);
    expect(r.summary.significant).toBe(false);
    const s = plainSentence(r, v, "Tanzania");
    expect(s).toMatch(/estimate .* but this is not statistically significant .* could be natural variation/);
    expect(s).not.toMatch(/is (warming|cooling)/);
  });
});
