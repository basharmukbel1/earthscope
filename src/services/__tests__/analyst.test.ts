import { describe, expect, it } from "vitest";
import type { Region, TimeSeries } from "@/types/domain";
import { getVariable } from "@/data/catalog";
import { analyzeSeries, simulateMonthlySeries } from "@/stats";
import { answerLocally, suggestedPrompts, type AnalystBlock, type AnalystContext } from "@/services/analyst";

/* Test fixtures: seeded synthetic series analysed with the real statistics engine
   (synthetic data exists only in tests, never in the app). */
function region(id: string, name: string): Region {
  return { id, name, kind: "country", bbox: { west: 0, south: 0, east: 1, north: 1 }, center: [0.5, 0.5] };
}

function entry(variableId: string, r: Region, trendPerDecade: number, seed: number, noiseSd = 0.3) {
  const variable = getVariable(variableId)!;
  const series: TimeSeries = {
    id: `${r.id}__${variableId}`,
    variableId,
    regionId: r.id,
    label: `${variable.name} · ${r.name}`,
    unit: variable.unit,
    resolution: "monthly",
    points: simulateMonthlySeries({ startYear: 1981, years: 45, trendPerDecade, noiseSd, seasonalAmplitude: 1, ar1: 0.2, seed, baseline: 10 }),
    provenance: { source: "test fixture", mode: "simulation" },
  };
  const result = analyzeSeries(series, { alpha: 0.05, annualAgg: "mean" });
  return { series, result, variable, region: r };
}

const jordan = region("jo", "Jordan");
const iraq = region("iq", "Iraq");
const evidenceTitles = (blocks: AnalystBlock[]) => blocks.filter((b): b is Extract<AnalystBlock, { type: "evidence" }> => b.type === "evidence").map((b) => b.title);
const allText = (blocks: AnalystBlock[]) => blocks.map((b) => ("text" in b ? b.text : "") + ("title" in b ? ` ${b.title}` : "")).join(" ");

describe("AI Scientist — answers the question that was asked", () => {
  it("never answers a precipitation question with temperature data (variable not in the case)", () => {
    const ctx: AnalystContext = { entries: [entry("t2m", jordan, 0.4, 1), entry("t2m", iraq, 0.3, 2)] };
    const res = answerLocally("Why are these two regions showing opposite precipitation trends?", ctx);
    expect(res.kind).toBe("out-of-case");
    expect(evidenceTitles(res.blocks)).toHaveLength(0);
    expect(allText(res.blocks)).toMatch(/doesn't include precipitation/);
    expect(allText(res.blocks)).not.toMatch(/°C/);
    // …and offers to add it with one click.
    const action = res.blocks.find((b) => b.type === "action");
    expect(action && action.type === "action" && action.variableId).toBe("precip");
  });

  it("uses only the variable the question names when the case has several", () => {
    const ctx: AnalystContext = { entries: [entry("t2m", jordan, 0.4, 3), entry("precip", jordan, -0.05, 4)] };
    const res = answerLocally("Is the precipitation trend statistically significant?", ctx);
    const titles = evidenceTitles(res.blocks);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => t.startsWith("Precipitation"))).toBe(true);
  });

  it("states a false premise first: 'opposite trends' that the results do not show", () => {
    // Both regions rise significantly — not opposite.
    const ctx: AnalystContext = { entries: [entry("precip", jordan, 0.5, 5, 0.1), entry("precip", iraq, 0.4, 6, 0.1)] };
    expect(ctx.entries.every((e) => e.result.summary.significant && e.result.summary.direction === "increasing")).toBe(true);
    const res = answerLocally("Why are these two regions showing opposite precipitation trends?", ctx);
    expect(res.blocks[0].type).toBe("caution");
    expect((res.blocks[0] as { text: string }).text).toMatch(/assumes opposite precipitation trends/);
    // …then shows what the data do show.
    expect(evidenceTitles(res.blocks)).toContain("Measured: Precipitation by region");
    expect(res.blocks.some((b) => b.type === "hypothesis")).toBe(false);
  });

  it("states a false premise first: a direction the results do not support", () => {
    const ctx: AnalystContext = { entries: [entry("t2m", jordan, 0.5, 7, 0.1)] };
    expect(ctx.entries[0].result.summary.significant && ctx.entries[0].result.summary.direction === "increasing").toBe(true);
    const res = answerLocally("Why is it cooling in Jordan?", ctx);
    expect(res.blocks[0].type).toBe("caution");
    expect((res.blocks[0] as { text: string }).text).toMatch(/assumes a decrease.*opposite/);
  });

  it("declines out-of-scope questions instead of inventing an answer", () => {
    const ctx: AnalystContext = { entries: [entry("t2m", jordan, 0.4, 8)] };
    const res = answerLocally("Who won the football world cup?", ctx);
    expect(res.kind).toBe("out-of-scope");
    expect(evidenceTitles(res.blocks)).toHaveLength(0);
    expect(allText(res.blocks)).toMatch(/can only answer questions about this investigation/);
  });

  it("builds suggestion chips from the case, and every chip is answerable", () => {
    const single: AnalystContext = { entries: [entry("t2m", jordan, 0.4, 9)] };
    const chips = suggestedPrompts(single);
    expect(chips.join(" ")).not.toMatch(/opposite|precipitation/i);
    expect(chips[0]).toMatch(/air temperature trend in Jordan/i);
    for (const c of chips) {
      const res = answerLocally(c, single);
      expect(res.kind, c).toBe("answer");
      expect(allText(res.blocks), c).not.toMatch(/assumes|doesn't include/);
    }
  });

  it("only offers an 'opposite trends' chip when the results really are opposite and significant", () => {
    const opposite: AnalystContext = { entries: [entry("precip", jordan, 0.5, 10, 0.1), entry("precip", iraq, -0.5, 11, 0.1)] };
    expect(suggestedPrompts(opposite).some((c) => /opposite/.test(c))).toBe(true);
    const same: AnalystContext = { entries: [entry("precip", jordan, 0.5, 12, 0.1), entry("precip", iraq, 0.4, 13, 0.1)] };
    expect(suggestedPrompts(same).some((c) => /opposite/.test(c))).toBe(false);
  });

  it("offers definitions only when there is no investigation yet", () => {
    for (const c of suggestedPrompts({ entries: [] })) {
      const res = answerLocally(c, { entries: [] });
      expect(res.blocks[0].type, c).toBe("glossary");
    }
  });
});
