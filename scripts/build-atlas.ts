/* EARTHSCOPE — Trend Atlas builder.
 *
 * REAL global trend markers from the NASA POWER API (MERRA-2 reanalysis,
 * monthly). For ~640 equal-area (Fibonacci-sphere) points over lat −85..85 we
 * download monthly T2M, PRECTOTCORR, GWETTOP and TQV for 1981–2025, build
 * annual series, run Mann-Kendall + Sen's slope per point, then control the
 * false discovery rate across points with Benjamini–Hochberg (q = 0.05).
 *
 *   npx tsx scripts/build-atlas.ts               # fetch (cached) + compute
 *   npx tsx scripts/build-atlas.ts --fetch-only  # just populate data-raw/atlas
 *
 * Raw responses are cached gzipped in data-raw/atlas/ so the script is resumable.
 * Output: src/data/atlas/<variableId>.json (AtlasLayer) + manifest.json.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
// @ts-ignore — plain ESM helper module
import { ROOT, RAW_DIR, cachedFetch, limiter, writeJson, todayIso } from "./lib/http.mjs";

const N_POINTS = 640;
const LAT_MAX = 85;
const START_YEAR = 1981;
const END_YEAR = 2025;
const MIN_YEARS = 40;
const FDR_Q = 0.05;
const ALPHA = 0.05; // nominal per-test alpha passed to MK / Sen CI (raw p is stored)
const CONCURRENCY = 3;
const PARAMS = ["T2M", "PRECTOTCORR", "GWETTOP", "TQV"] as const;
type Param = (typeof PARAMS)[number];

// Overrides exist only for dry runs (e.g. writing to a scratch dir); defaults are the real paths.
const OUT_DIR = process.env.ATLAS_OUT_DIR ? resolve(process.env.ATLAS_OUT_DIR) : resolve(ROOT, "src/data/atlas");
const STATS_MODULE = process.env.ATLAS_STATS_MODULE ? resolve(process.env.ATLAS_STATS_MODULE) : resolve(ROOT, "src/stats/index.ts");
const CACHE_DIR = resolve(RAW_DIR, "atlas");

const API = "https://power.larc.nasa.gov/api/temporal/monthly/point";
const powerUrl = (lat: number, lon: number) =>
  `${API}?parameters=${PARAMS.join(",")}&community=AG&longitude=${lon}&latitude=${lat}&start=${START_YEAR}&end=${END_YEAR}&format=JSON`;

interface VarSpec {
  variableId: string;
  parameter: Param;
  agg: "mean" | "sum";
  sumFactor?: "daysInMonth";
  annualUnit: string;
  landOnly: boolean;
  /** decimals for slope / mean in output */
  dSlope: number;
  dMean: number;
}

const VARS: VarSpec[] = [
  { variableId: "t2m", parameter: "T2M", agg: "mean", annualUnit: "°C", landOnly: false, dSlope: 3, dMean: 2 },
  { variableId: "precip", parameter: "PRECTOTCORR", agg: "sum", sumFactor: "daysInMonth", annualUnit: "mm", landOnly: false, dSlope: 1, dMean: 0 },
  { variableId: "soil-surface", parameter: "GWETTOP", agg: "mean", annualUnit: "1 (0–1 wetness fraction)", landOnly: true, dSlope: 4, dMean: 3 },
  { variableId: "water-vapor", parameter: "TQV", agg: "mean", annualUnit: "kg m⁻²", landOnly: false, dSlope: 3, dMean: 2 },
];

/* ------------------------------------------------------------------------ */
/* Points                                                                    */
/* ------------------------------------------------------------------------ */

interface SitePoint {
  i: number;
  lat: number;
  lon: number;
  land: boolean;
}

/** Equal-area Fibonacci lattice restricted to the band |lat| <= LAT_MAX. */
function fibonacciPoints(n: number, latMax: number): { lat: number; lon: number }[] {
  const golden = Math.PI * (3 - Math.sqrt(5)); // golden angle (rad)
  const zMax = Math.sin((latMax * Math.PI) / 180);
  const pts: { lat: number; lon: number }[] = [];
  for (let i = 0; i < n; i++) {
    const z = zMax * (1 - (2 * (i + 0.5)) / n); // uniform in z → equal area
    const lat = (Math.asin(z) * 180) / Math.PI;
    let lon = ((i * golden * 180) / Math.PI) % 360;
    if (lon > 180) lon -= 360;
    pts.push({ lat: round(lat, 2), lon: round(lon, 2) });
  }
  return pts;
}

async function landFeature() {
  const topo = JSON.parse(await readFile(resolve(ROOT, "node_modules/world-atlas/land-50m.json"), "utf8"));
  return feature(topo, topo.objects.land) as any;
}

function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/* ------------------------------------------------------------------------ */
/* Fetch                                                                     */
/* ------------------------------------------------------------------------ */

const cachePathFor = (p: { lat: number; lon: number }) =>
  resolve(CACHE_DIR, `power_${p.lat.toFixed(2)}_${p.lon.toFixed(2)}.json.gz`);

function validatePower(body: Buffer, status: number): boolean {
  if (status !== 200) return false;
  try {
    const j = JSON.parse(body.toString("utf8"));
    return PARAMS.every((k) => j?.properties?.parameter?.[k] && Object.keys(j.properties.parameter[k]).length > 100);
  } catch {
    return false;
  }
}

async function fetchAll(points: SitePoint[]) {
  const limit = limiter(CONCURRENCY);
  let done = 0;
  let fetched = 0;
  const failures: { point: SitePoint; error: string }[] = [];
  const results = new Map<number, any>();
  const t0 = Date.now();
  await Promise.all(
    points.map((p) =>
      limit(async () => {
        try {
          const r = await cachedFetch(powerUrl(p.lat, p.lon), cachePathFor(p), {
            validate: validatePower,
            timeoutMs: 180_000,
            retries: 6,
            baseDelayMs: 3000,
          });
          if (!r.fromCache) fetched++;
          results.set(p.i, JSON.parse(r.body.toString("utf8")));
        } catch (e: any) {
          failures.push({ point: p, error: String(e.message).slice(0, 300) });
        }
        done++;
        if (done % 20 === 0 || done === points.length) {
          const s = (Date.now() - t0) / 1000;
          console.log(`  ${done}/${points.length} (network ${fetched}, failed ${failures.length}) ${s.toFixed(0)} s`);
        }
      }),
    ),
  );
  return { results, failures };
}

/* ------------------------------------------------------------------------ */
/* Compute                                                                   */
/* ------------------------------------------------------------------------ */

interface MonthPoint {
  t: number;
  date: string;
  v: number | null;
}

/** POWER monthly dict {"YYYYMM": value} → Point[] (MM=13 annual value dropped, -999 → null). */
function monthlyPoints(dict: Record<string, number>, fill: number): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (const [k, raw] of Object.entries(dict)) {
    const y = Number(k.slice(0, 4));
    const m = Number(k.slice(4, 6));
    if (m < 1 || m > 12) continue; // 13 = annual
    const v = raw === fill || raw === -999 || raw == null || !Number.isFinite(raw) ? null : raw;
    out.push({ t: y + (m - 0.5) / 12, date: `${y}-${String(m).padStart(2, "0")}`, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function main() {
  const fetchOnly = process.argv.includes("--fetch-only");
  const land = await landFeature();
  const points: SitePoint[] = fibonacciPoints(N_POINTS, LAT_MAX).map((p, i) => ({
    i,
    ...p,
    land: geoContains(land, [p.lon, p.lat]),
  }));
  console.log(`Points: ${points.length} (land ${points.filter((p) => p.land).length}, ocean ${points.filter((p) => !p.land).length})`);
  console.log(`Fetching NASA POWER monthly ${PARAMS.join(",")} ${START_YEAR}-${END_YEAR} (≤${CONCURRENCY} concurrent, cache ${CACHE_DIR})`);

  const { results, failures } = await fetchAll(points);
  if (failures.length) {
    console.warn(`WARNING: ${failures.length} points failed:`);
    for (const f of failures.slice(0, 10)) console.warn(`  ${f.point.lat},${f.point.lon}: ${f.error}`);
  }
  if (fetchOnly) {
    console.log(`Fetch-only complete: ${results.size}/${points.length} points cached.`);
    if (failures.length) process.exitCode = 2;
    return;
  }
  if (failures.length) throw new Error("Refusing to compute the atlas with failed points; re-run to resume.");

  // Statistics library written in parallel (src/stats/index.ts).
  const stats: any = await import(pathToFileURL(STATS_MODULE).href);
  for (const fn of ["mannKendall", "senSlope", "annualAggregate", "benjaminiHochberg"]) {
    if (typeof stats[fn] !== "function") throw new Error(`src/stats/index.ts does not export ${fn}()`);
  }

  // Provenance from one response.
  const sample = results.get(0);
  const header = sample.header;
  const paramMeta = sample.parameters;
  const fill = header?.fill_value ?? -999;
  const retrieved = todayIso();

  const manifestVars: any[] = [];

  for (const spec of VARS) {
    type Row = { p: SitePoint; slope: number; pval: number; mean: number; nYears: number; y0: number; y1: number };
    const rows: Row[] = [];
    let skippedOcean = 0;
    let skippedShort = 0;
    const skippedConstant: { lat: number; lon: number; value: number }[] = [];
    for (const p of points) {
      if (spec.landOnly && !p.land) {
        skippedOcean++;
        continue;
      }
      const j = results.get(p.i);
      const dict = j.properties.parameter[spec.parameter] as Record<string, number>;
      const monthly = monthlyPoints(dict, fill);
      const annual: MonthPoint[] = stats.annualAggregate(monthly, {
        agg: spec.agg,
        sumFactor: spec.sumFactor,
        minMonths: 12,
      });
      const valid = annual.filter((a) => a.v != null && Number.isFinite(a.v));
      if (valid.length < MIN_YEARS) {
        skippedShort++;
        continue;
      }
      const t = valid.map((a) => Math.floor(a.t));
      const v = valid.map((a) => a.v as number);
      // Zero-variance series (e.g. GWETTOP ≡ 1 on MERRA-2 land-ice cells such as Antarctica
      // and Greenland, where there is no soil): Mann-Kendall is undefined → excluded, listed in manifest.
      const monthlyVals = monthly.filter((m) => m.v != null).map((m) => m.v as number);
      if (Math.min(...monthlyVals) === Math.max(...monthlyVals)) {
        skippedConstant.push({ lat: p.lat, lon: p.lon, value: monthlyVals[0] });
        continue;
      }
      const mk = stats.mannKendall(v, ALPHA);
      const sen = stats.senSlope(t, v, ALPHA);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      rows.push({ p, slope: sen.slope * 10, pval: mk.p, mean, nYears: v.length, y0: t[0], y1: t[t.length - 1] });
    }

    const bh = stats.benjaminiHochberg(
      rows.map((r) => r.pval),
      FDR_Q,
    );
    const sigFlags: boolean[] = normalizeBh(bh, rows.length);

    const atlasPoints = rows.map((r, k) => ({
      lon: r.p.lon,
      lat: r.p.lat,
      slope: round(r.slope, spec.dSlope),
      p: Number(r.pval.toPrecision(3)),
      sig: sigFlags[k],
      mean: round(r.mean, spec.dMean),
      land: r.p.land,
    }));
    const startYear = Math.min(...rows.map((r) => r.y0));
    const endYear = Math.max(...rows.map((r) => r.y1));
    const unitLabel = spec.parameter === "GWETTOP" ? "fraction (0–1)" : spec.annualUnit;
    const layer = {
      variableId: spec.variableId,
      parameter: spec.parameter,
      unit: `${unitLabel} per decade`,
      startYear,
      endYear,
      method: `Mann-Kendall + Sen's slope on annual values; Benjamini–Hochberg FDR q=${FDR_Q.toFixed(2)}`,
      fdrAlpha: FDR_Q,
      retrieved,
      source: "NASA POWER API (MERRA-2 reanalysis), monthly",
      points: atlasPoints,
    };
    await writeJson(resolve(OUT_DIR, `${spec.variableId}.json`), layer, { pretty: false });

    const sigUp = atlasPoints.filter((x) => x.sig && x.slope > 0).length;
    const sigDown = atlasPoints.filter((x) => x.sig && x.slope < 0).length;
    const rawSig = rows.filter((r) => r.pval < ALPHA).length;
    console.log(
      `${spec.variableId.padEnd(13)} n=${rows.length} (skipped ocean ${skippedOcean}, short ${skippedShort}, constant ${skippedConstant.length}) ` +
        `FDR-sig ↑${sigUp} ↓${sigDown} (raw p<0.05: ${rawSig}) years ${startYear}-${endYear}`,
    );
    manifestVars.push({
      variableId: spec.variableId,
      parameter: spec.parameter,
      longname: paramMeta?.[spec.parameter]?.longname,
      powerUnits: paramMeta?.[spec.parameter]?.units,
      annualAggregation:
        spec.agg === "sum" ? "annual total = Σ (monthly mean mm/day × days in month)" : "annual mean of 12 monthly means",
      annualUnit: spec.annualUnit,
      slopeUnit: layer.unit,
      landOnly: spec.landOnly,
      file: `${spec.variableId}.json`,
      points: rows.length,
      skippedOcean,
      skippedInsufficientYears: skippedShort,
      skippedConstantSeries: skippedConstant.length,
      ...(skippedConstant.length
        ? {
            skippedConstantNote:
              "Series constant over the whole record (Mann-Kendall undefined). For GWETTOP these are MERRA-2 land-ice cells (value ≡ 1), e.g. Antarctica/Greenland, where no soil exists.",
            skippedConstantPoints: skippedConstant,
          }
        : {}),
      startYear,
      endYear,
      significantIncreasing: sigUp,
      significantDecreasing: sigDown,
      significantTotal: sigUp + sigDown,
      rawPBelow005: rawSig,
    });
  }

  const manifest = {
    title: "EARTHSCOPE Trend Atlas — per-point trends from NASA POWER (MERRA-2)",
    retrieved,
    source: "NASA POWER API (MERRA-2 reanalysis), monthly",
    api: {
      urlPattern: `${API}?parameters=${PARAMS.join(",")}&community=AG&longitude={lon}&latitude={lat}&start=${START_YEAR}&end=${END_YEAR}&format=JSON`,
      header,
      parameters: paramMeta,
    },
    sampling: {
      design: `Fibonacci (golden-angle) equal-area lattice, ${N_POINTS} points, latitude −${LAT_MAX}..${LAT_MAX}`,
      totalPoints: points.length,
      landPoints: points.filter((p) => p.land).length,
      landMask: "d3-geo geoContains on world-atlas land-50m (Natural Earth 1:50m)",
      note: "POWER returns the native MERRA-2 grid cell (0.5° × 0.625°) containing each point.",
    },
    method: {
      annual: "Calendar-year aggregation of monthly values; a year is used only when all 12 months are present (missing = POWER fill −999).",
      minYears: MIN_YEARS,
      exclusions:
        "soil-surface (GWETTOP) uses land points only (world-atlas land mask); any series that is constant over the whole record is skipped because Mann-Kendall is undefined (see skippedConstantPoints).",
      trendTest: "Mann-Kendall (two-sided) on annual values; raw p stored per point",
      slope: "Sen's slope of annual values, ×10 to give units per decade",
      multipleTesting: `Benjamini–Hochberg FDR at q=${FDR_Q} across points, separately per variable (sig flag)`,
      statsLibrary: "src/stats/index.ts (mannKendall, senSlope, annualAggregate, benjaminiHochberg)",
    },
    variables: manifestVars,
    caveats: [
      "Values are MERRA-2 reanalysis (model + assimilated observations), not direct satellite retrievals; each point is one ~50 km grid cell.",
      "Reanalysis trends in data-sparse polar regions can be affected by changes in the observing system. Example found while checking this build: the raw POWER T2M series at 71.43°N, 97.38°W (Canadian Arctic) drops abruptly by ~2–3 °C in annual mean between the early 2000s and 2005, producing a significant cooling trend there; treat isolated polar cooling markers with caution.",
      "Significance (sig) controls the false discovery rate across points; it does not account for serial correlation in the annual values.",
    ],
  };
  await writeJson(resolve(OUT_DIR, "manifest.json"), manifest);
  console.log(`Wrote ${VARS.length} layers + manifest to ${OUT_DIR}`);
}

/** Accept either boolean[] or { rejected|significant: boolean[] } or adjusted q-values. */
function normalizeBh(bh: any, n: number): boolean[] {
  if (Array.isArray(bh) && bh.length === n && typeof bh[0] === "boolean") return bh;
  for (const key of ["rejected", "significant", "reject", "sig"]) {
    if (bh && Array.isArray(bh[key]) && bh[key].length === n) return bh[key].map(Boolean);
  }
  if (Array.isArray(bh) && bh.length === n && typeof bh[0] === "number") return bh.map((q: number) => q <= FDR_Q);
  for (const key of ["adjusted", "qValues", "q", "adjustedP"]) {
    if (bh && Array.isArray(bh[key]) && bh[key].length === n) return bh[key].map((q: number) => q <= FDR_Q);
  }
  if (n === 0) return [];
  throw new Error(`Unrecognised benjaminiHochberg() return shape: ${JSON.stringify(bh).slice(0, 200)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
