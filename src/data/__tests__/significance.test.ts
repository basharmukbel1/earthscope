import { describe, expect, it } from "vitest";
import manifest from "@/data/atlas/manifest.json";
import { benjaminiHochberg } from "@/stats";
import { ATLAS_FDR_Q } from "@/data/significance";

type AtlasFile = { variableId: string; fdrAlpha: number; method: string; points: { p: number; sig: boolean; slope: number }[] };
const layers = import.meta.glob<{ default: AtlasFile }>("../atlas/*.json", { eager: true });

describe("one significance policy for the Trend Atlas", () => {
  const files = Object.entries(layers)
    .filter(([path]) => !path.endsWith("manifest.json"))
    .map(([, mod]) => mod.default);

  it("every atlas layer was built with the app's FDR level", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.fdrAlpha, f.variableId).toBe(ATLAS_FDR_Q);
      expect(f.method, f.variableId).toContain(`q=${ATLAS_FDR_Q.toFixed(2)}`);
    }
    expect(manifest.method.multipleTesting).toContain(`q=${ATLAS_FDR_Q}`);
  });

  it("each point's 'significant' flag is Benjamini–Hochberg at that level, and the published counts match", () => {
    for (const f of files) {
      const expected = benjaminiHochberg(f.points.map((p) => p.p), ATLAS_FDR_Q);
      expect(f.points.map((p) => p.sig), f.variableId).toEqual(expected);
      const m = manifest.variables.find((v) => v.variableId === f.variableId)!;
      expect(f.points.filter((p) => p.sig && p.slope > 0).length, `${f.variableId} increasing`).toBe(m.significantIncreasing);
      expect(f.points.filter((p) => p.sig && p.slope < 0).length, `${f.variableId} decreasing`).toBe(m.significantDecreasing);
    }
  });
});
