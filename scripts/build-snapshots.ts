/**
 * Builds offline fallbacks for the guided demos: for every demo region ×
 * variable, fetch the REAL NASA POWER data with exactly the same sampling plan
 * and area-weighting the browser uses, and save the regional monthly series to
 * public/snapshots/<seriesId>.json (provenance.mode = "snapshot").
 *
 * The app only uses these when the live POWER request fails, and labels them
 * "Real-data snapshot · <retrieval date>".
 *
 * Run: npx tsx --tsconfig tsconfig.app.json scripts/build-snapshots.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature as topoFeature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Region, TimeSeries } from "../src/types/domain";
import { DEMOS } from "../src/data/demos";
import { NAMED_REGION_BY_ID } from "../src/data/regions";
import { getVariable } from "../src/data/catalog";
import { fetchPowerPoint, POWER_BASE } from "../src/services/power";
import { buildSamplePlan, countryToRegion, type CountryFeature } from "../src/services/geo";
import { aggregatePoints, seriesId } from "../src/services/aggregate";

const require = createRequire(import.meta.url);
const topo = require("world-atlas/countries-50m.json");

// Same id-uniqueness rule as services/geo.ts → identical region ids.
const seen = new Set<string>();
const fc = topoFeature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
const countries: CountryFeature[] = fc.features
  .filter((f) => f.geometry && f.properties?.name)
  .map((f) => {
    let id = String(f.id ?? f.properties.name);
    if (seen.has(id)) id = `${id}-${f.properties.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    seen.add(id);
    return { ...f, id } as CountryFeature;
  });

function resolve(ref: { kind: "country" | "named"; ref: string }): { region: Region; feature?: Feature } {
  if (ref.kind === "named") return { region: NAMED_REGION_BY_ID[ref.ref] };
  const c = countries.find((x) => x.properties.name === ref.ref);
  if (!c) throw new Error(`Country not found: ${ref.ref}`);
  return { region: countryToRegion(c), feature: c };
}

mkdirSync("public/snapshots", { recursive: true });
const retrieved = new Date().toISOString();
const index: { id: string; label: string; cells: number }[] = [];

for (const demo of DEMOS) {
  for (const ref of demo.regions) {
    const { region, feature } = resolve(ref);
    const vars = demo.variableIds.map((id) => getVariable(id)!).filter((v) => v.connector.kind === "power");
    const plan = buildSamplePlan(region, feature);
    const params = vars.map((v) => (v.connector as { parameter: string }).parameter);
    const fetchStart = Math.min(...vars.map((v) => Math.max(demo.startYear, (v.connector as { startYear: number }).startYear)));
    console.log(`▸ ${demo.id} · ${region.name}: ${plan.points.length} cells (${plan.method}) · ${params.join(",")}`);
    const results = await Promise.all(
      plan.points.map(async (pt) => ({ w: pt.w, data: await fetchPowerPoint({ lat: pt.lat, lon: pt.lon, parameters: params, start: fetchStart, end: demo.endYear }) })),
    );
    for (const v of vars) {
      const p = (v.connector as { parameter: string }).parameter;
      const vStart = Math.max(demo.startYear, (v.connector as { startYear: number }).startYear);
      const id = seriesId(region.id, v.id, demo.startYear, demo.endYear);
      const series: TimeSeries = {
        id,
        variableId: v.id,
        regionId: region.id,
        label: `${v.name} · ${region.name}`,
        unit: v.unit,
        resolution: "monthly",
        points: aggregatePoints(
          results.map((r) => ({ w: r.w, values: r.data[p] ?? {} })),
          vStart,
          demo.endYear,
        ),
        provenance: {
          source: `NASA POWER API — ${v.dataset.product}`,
          mode: "snapshot",
          retrieved,
          url: `${POWER_BASE}?parameters=${p}&community=AG&start=${vStart}&end=${demo.endYear}&format=JSON`,
          sampling: plan.description,
          cellsUsed: plan.points.length,
          cellsTotal: plan.cellsTotal,
          notes: [...(v.caveats ?? []), "Bundled real-data snapshot used because NASA POWER could not be reached."],
        },
      };
      writeFileSync(`public/snapshots/${id}.json`, JSON.stringify([series]));
      index.push({ id, label: series.label, cells: plan.points.length });
    }
  }
}
writeFileSync("public/snapshots/index.json", JSON.stringify({ retrieved, series: index }, null, 2));
console.log(`\nWrote ${index.length} snapshots to public/snapshots/`);
