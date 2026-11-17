# EARTHSCOPE — Data & Service Contracts

EARTHSCOPE runs without a custom backend: it calls public NASA services from the browser and computes all statistics client-side. This document records every external contract the app depends on, the typed service layer that wraps them, and the endpoints a future backend should implement to extend it (e.g. Earthdata-authenticated Giovanni / GLDAS / IMERG access).

All shared types live in [`src/types/domain.ts`](../src/types/domain.ts).

---

## 1. External services used today

### 1.1 NASA POWER — time series (live, in-browser)

| | |
|---|---|
| Endpoint | `GET https://power.larc.nasa.gov/api/temporal/monthly/point` |
| Auth / CORS | none · `Access-Control-Allow-Origin: *` |
| Query | `parameters=T2M,PRECTOTCORR,…` (≤ 20), `community=AG`, `latitude`, `longitude`, `start=YYYY`, `end=YYYY`, `format=JSON` |
| Response | `properties.parameter[PARAM]["YYYYMM"] = number`; `MM = 13` is the annual value (ignored); `-999` = missing |
| Client | [`src/services/power.ts`](../src/services/power.ts) — ≤ 3 concurrent requests, exponential back-off with jitter on 429/5xx, in-flight de-duplication, IndexedDB cache ([`cache.ts`](../src/services/cache.ts)) |

Parameters used: `T2M`, `TS`, `PRECTOTCORR`, `GWETTOP`, `GWETROOT`, `TQV`, `TO3`, `AOD_55` (from 2001), `EVLAND`, `SNODP`.

**Regional means** ([`src/services/geo.ts`](../src/services/geo.ts) `buildSamplePlan`): POWER grid cells (0.5° × 0.625°) whose centres fall inside the country polygon (Natural Earth 1:50m) or bounding box. If ≤ 32 cells, all are used; otherwise a systematic every-k-th-cell subsample. Monthly values are area-weighted by cos(latitude); a month is kept only when ≥ 50 % of the total weight has data ([`aggregate.ts`](../src/services/aggregate.ts)).

### 1.2 NASA GIBS — imagery (live, in-browser)

| | |
|---|---|
| Endpoint | `GET https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi` (WMS 1.3.0 `GetMap`) |
| Auth / CORS | none · `Access-Control-Allow-Origin: *` |
| Query | `LAYERS`, `CRS=EPSG:4326`, `BBOX=south,west,north,east` (lat-lon axis order), `WIDTH`, `HEIGHT`, `FORMAT=image/png|jpeg`, `TIME=YYYY-MM-DD` |
| Gotcha | An out-of-range `TIME` returns HTTP 200 with a ~200-byte transparent PNG. Times are clamped to ranges in [`src/data/gibs-layers.json`](../src/data/gibs-layers.json), generated from `WMTSCapabilities.xml` and verified by `scripts/build-gibs-meta.mjs`. |

GIBS imagery is **context only** — no statistic is computed from pixels.

### 1.3 Bundled real-data snapshots (no network at runtime)

| File | Source | Retrieved |
|---|---|---|
| `src/data/atlas/*.json` | NASA POWER monthly, 640 equal-area points, Mann-Kendall + Sen + Benjamini–Hochberg FDR (q = 0.10) | 2026-11-15 |
| `src/data/external/sea-ice-extent-*.json` | NSIDC Sea Ice Index G02135 v4.0 | 2026-11-15 |
| `src/data/external/ndvi-*-monthly.json` | ORNL DAAC MODIS MOD13Q1 v061, good-quality pixels | 2026-11-15 |
| `src/data/external/gistemp-global-monthly.json` | NASA GISS GISTEMP v4 | 2026-11-15 |
| `public/snapshots/*.json` | NASA POWER regional series for every guided demo (offline fallback) | 2026-11-15 |
| `public/textures/*.jpg` | GIBS Blue Marble Next Generation / VIIRS Black Marble | 2026-11-15 |

Regenerate with `npm run data:textures`, `data:gibs`, `data:atlas`, `data:external`, `data:snapshots`.

### 1.4 User imports (no network)

[`src/services/importers.ts`](../src/services/importers.ts) parses Giovanni area-averaged CSV, AppEEARS point CSV, NOAA CDO CSV, KNMI Climate Explorer text and generic `date,value` files. Daily / 8-day / 16-day values are averaged to monthly means. Files never leave the browser.

---

## 2. Internal service interfaces (TypeScript)

```ts
// src/services/series.ts
fetchRegionSeries(region: Region, variableIds: string[], start: number, end: number,
  opts?: { signal?: AbortSignal; onProgress?: (p: FetchProgress) => void; allowSnapshot?: boolean }
): Promise<{ series: TimeSeries[]; plan: SamplePlan | null; usedSnapshot: boolean; warnings: string[] }>;
loadBundledSeries(snapshotId: string): Promise<TimeSeries | null>;

// src/stats/analyze.ts
analyzeSeries(series: TimeSeries, opts?: AnalyzeOptions): AnalysisResultExt;
compareMethods(result: AnalysisResult): MethodComparisonRow[];

// src/services/geo.ts
searchPlaces(query: string): Promise<Region[]>;     // countries, named regions, "lat, lon"
buildSamplePlan(region: Region, feature?: Feature): SamplePlan;

// src/services/analyst.ts
answer(question: string, ctx: AnalystContext): Promise<AnalystResponse>; // local engine, optional remote LLM
interpret(result: AnalysisResult, variable: Variable, region?: Region): AnalystBlock[];
```

---

## 3. Optional AI endpoint (any language-model backend)

`POST /api/interpret` — enabled in the UI only when the app is built/run with `VITE_AI_ENDPOINT=/api/interpret`.

Request:
```json
{
  "question": "Why are these two regions showing opposite precipitation trends?",
  "results": [
    {
      "variable": "Precipitation", "unit": "mm/day", "region": "Jordan",
      "years": "1981-2025", "source": "NASA POWER API — MERRA-2 bias-corrected precipitation",
      "trendPerDecade": -1.9, "ci95": [-8.93, 5.78], "p": 0.63, "significant": false,
      "method": "Mann-Kendall + Sen's slope (annual)", "pctPerDecade": -1.8,
      "mkTau": -0.051, "olsAr1": { "slopePerDecade": -3.3, "p": 0.27, "r2": 0.002 },
      "yearsToDetect": 94, "missingPct": 0
    }
  ]
}
```
Response `200`: `{ "answer": "…", "model": "<model id>" }` · errors: `{ "error": "…" }` with 400 / 401 / 413 / 429 / 502.

Only computed statistics are sent — never raw data or personal information. The UI always shows the locally computed evidence next to the model's text and labels it "AI (LLM)".

---

## 4. Endpoints a future backend should add

These extend EARTHSCOPE to datasets that require an Earthdata Login. Each should return the same `TimeSeries` shape so the existing analysis, charts, AI and reports work unchanged.

| Endpoint | Purpose | Upstream |
|---|---|---|
| `GET /api/series?product=GPM_3IMERGM&var=precipitation&bbox=w,s,e,n&start=YYYY-MM&end=YYYY-MM` | Area-averaged satellite series | Giovanni / GES DISC OPeNDAP |
| `GET /api/series?product=GLDAS_NOAH025_M&var=SoilMoi0_10cm_inst&…` | Land-model hydrology | GES DISC Hydrology Data Rods |
| `GET /api/series?product=MOD13C2&var=NDVI&…` | Area-averaged MODIS | AppEEARS task API |
| `GET /api/series?product=GRACE_MASCON&…` | Water storage | PO.DAAC |
| `GET /api/trend-map?var=…&bbox=…` | Per-pixel trend grids for the globe | server-side Mann-Kendall over gridded data |
| `POST /api/reports` / `GET /api/reports/:id` | Shareable reports | storage of the frozen `SavedReport` JSON |

Contract rules: `points[].v = null` for missing data (never fill values), `provenance` must name the product, version, URL and retrieval time, and `mode` must be `"live"` only for data fetched at request time.
