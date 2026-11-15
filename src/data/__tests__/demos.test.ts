import { describe, expect, it } from "vitest";
import type { AnalysisResult, TimeSeries } from "@/types/domain";
import { DEMOS, type DemoInvestigation } from "@/data/demos";
import { resolveDemoRegions } from "@/services/demoCase";
import { seriesId } from "@/services/aggregate";
import { analyse } from "@/store/investigation";

/* Every guided demo claim is checked against the result EARTHSCOPE actually
   computes from the demo's bundled real data (public/snapshots), with the same
   analysis the app runs (store.analyse, headline Mann-Kendall + Sen, α = 0.05). */

type Results = Map<string, AnalysisResult>; // key: `${regionName}|${variableId}`
const snapshots = import.meta.glob<{ default: TimeSeries[] }>("../../../public/snapshots/*.json", { eager: true });
const snapshot = (id: string) => Object.entries(snapshots).find(([path]) => path.endsWith(`/${id}.json`))?.[1].default;

async function computeDemo(d: DemoInvestigation): Promise<Results> {
  const out: Results = new Map();
  for (const r of await resolveDemoRegions(d.regions)) {
    for (const v of d.variableIds) {
      const file = seriesId(r.id, v, d.startYear, d.endYear);
      const series = snapshot(file)?.[0];
      expect(series, `snapshot ${file}`).toBeDefined();
      const entry = analyse(series!, "mk-sen", 0.05);
      expect(entry.result, `${d.id}: ${r.name} ${v}`).toBeDefined();
      out.set(`${r.name}|${v}`, entry.result!);
    }
  }
  return out;
}

/** Words that assert a pattern when a title is not a neutral yes/no question. */
const PATTERN = /\b(opposite|oppos\w+|warming|cooling|drying|drier|wetter|rising|falling|increasing|decreasing|declin\w+|melting|greening|browning)\b/i;
const NEUTRAL_QUESTION = /^(is|are|do|does|has|have|did|can)\b.*\?$/i;

describe("guided demos never claim a pattern the statistics do not support", () => {
  for (const d of DEMOS) {
    it(`${d.id}: “${d.title}”`, async () => {
      const results = await computeDemo(d);

      // 1. Wording: a title that names a pattern must either be a neutral yes/no question
      //    or carry claims that are verified below.
      if (PATTERN.test(d.title) && !NEUTRAL_QUESTION.test(d.title.trim())) {
        expect(d.claims?.length ?? 0, `“${d.title}” asserts a pattern but declares no claim to verify`).toBeGreaterThan(0);
      }
      if (/\boppos/i.test(d.title) && !NEUTRAL_QUESTION.test(d.title.trim())) {
        expect(d.claims?.some((c) => c.kind === "opposite-significant"), `“${d.title}” asserts opposite trends`).toBe(true);
      }

      // 2. Every claim must hold in the computed result.
      for (const c of d.claims ?? []) {
        if (c.kind === "significant-trend") {
          const s = results.get(`${c.region}|${c.variableId}`)!.summary;
          expect(s.significant, `${c.region} ${c.variableId} must be significant (p = ${s.p})`).toBe(true);
          expect(s.direction).toBe(c.direction);
        } else {
          const [a, b] = c.regions.map((r) => results.get(`${r}|${c.variableId}`)!.summary);
          expect(a.significant && b.significant, `both regions must be significant (p = ${a.p}, ${b.p})`).toBe(true);
          expect(Math.sign(a.perDecade)).toBe(-Math.sign(b.perDecade));
        }
      }
    }, 60000);
  }

  it("Sahel vs Iberia: the computed rainfall trends are not opposite, so the title is a question", async () => {
    const d = DEMOS.find((x) => x.id === "sahel-vs-iberia")!;
    const r = await computeDemo(d);
    const sahel = r.get("Western Sahel|precip")!.summary;
    const iberia = r.get("Iberian Peninsula|precip")!.summary;
    const opposite = sahel.significant && iberia.significant && Math.sign(sahel.perDecade) === -Math.sign(iberia.perDecade);
    expect(opposite).toBe(false);
    expect(NEUTRAL_QUESTION.test(d.title)).toBe(true);
  }, 60000);
});
