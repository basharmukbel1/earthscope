import type { Region, TimeSeries } from "@/types/domain";
import type { DemoInvestigation } from "@/data/demos";
import { NAMED_REGION_BY_ID } from "@/data/regions";
import { buildSamplePlan, countryFeatureFor, countryToRegion, findCountry, type SamplePlan } from "./geo";
import { loadSnapshot, seriesId } from "./series";

/* ==========================================================================
   Precomputed guided demos. Every demo series is real NASA POWER data,
   fetched by scripts/build-snapshots.ts with the same sampling code and
   shipped in public/snapshots/, so a demo opens instantly. The sampling plan
   (the grid-cell dots on the map) is deterministic and rebuilt locally.
   ========================================================================== */

export async function resolveDemoRegions(refs: DemoInvestigation["regions"]): Promise<Region[]> {
  const out: Region[] = [];
  for (const r of refs) {
    if (r.kind === "named") {
      const n = NAMED_REGION_BY_ID[r.ref];
      if (n) out.push(n);
    } else {
      const c = await findCountry(r.ref);
      if (c) out.push(countryToRegion(c));
    }
  }
  return out;
}

/** All series of a demo from the bundled snapshots, or null if any is missing (then fetch live). */
export async function loadDemoSnapshots(demo: DemoInvestigation, regions: Region[]): Promise<{ series: TimeSeries[]; plans: Record<string, SamplePlan> } | null> {
  const wanted = regions.flatMap((r) => demo.variableIds.map((v) => seriesId(r.id, v, demo.startYear, demo.endYear)));
  const loaded = await Promise.all(wanted.map((id) => loadSnapshot(id)));
  if (loaded.some((s) => !s?.length)) return null;
  const series = loaded.flatMap((list) =>
    list!.map((s) => ({
      ...s,
      provenance: {
        ...s.provenance,
        notes: [
          ...(s.provenance.notes ?? []).filter((n) => !/could not be reached/i.test(n)),
          `Precomputed demo: real NASA POWER data retrieved ${s.provenance.retrieved?.slice(0, 10) ?? ""} and bundled with EARTHSCOPE so the demo opens instantly.`,
        ],
      },
    })),
  );
  const plans: Record<string, SamplePlan> = {};
  for (const r of regions) plans[r.id] = buildSamplePlan(r, await countryFeatureFor(r));
  // Same deterministic sampling code as the snapshot build, so its description is exact
  // (and uses the current wording, e.g. correct ordinals).
  for (const s of series) if (plans[s.regionId]) s.provenance = { ...s.provenance, sampling: plans[s.regionId].description };
  return { series, plans };
}
