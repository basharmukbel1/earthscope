# EARTHSCOPE — Developer Guide

How the project is built, how data flows through it, and the conventions to keep when you change it.
For a product overview and quick start, see the [README](../README.md).

---

## 1. Project rules

1. **Never fabricate data.** Every number comes from (a) live NASA POWER, (b) a bundled real-data snapshot with a retrieval date, or (c) a user-imported file. The only synthetic data is the Trend Lab *Significance simulator*, labelled `SIMULATION · synthetic data`. Guided demos never state results in advance — results are computed when the demo runs.
2. **Never claim “live” when it isn't.** `TimeSeries.provenance.mode` ∈ `live | snapshot | import | simulation`, shown in the UI by `SourceBadge`.
3. **Significance is never shown by colour alone** — always glyph (▲ ▼ ◇) + label + solid/dashed/hollow.
4. **Colours have fixed meanings:** cyan = data/interaction, ice = selection, violet = AI output only, green ▲ = increasing, coral ▼ = decreasing, slate dashed/hollow = not significant. Anomaly charts use neutral clay/ice.
5. **Evidence ≠ hypothesis.** The analyst only states computed numbers; explanations are labelled “Possible explanation — untested”. Correlation ≠ causation is stated in the Relationship Lab.
6. **Don't edit generated data by hand** (`src/data/atlas/*`, `src/data/external/*`, `src/data/gibs-layers.json`, `public/snapshots/*`, `public/textures/*`) — regenerate with the scripts in §8.
7. Not an official NASA product: no NASA logo; keep the disclaimer and AI-use disclosure (footer + Resources page).

---

## 2. Commands

```bash
npm install                # .npmrc points at registry.yarnpkg.com (same packages as npmjs)
npm run dev                # Vite dev server → http://localhost:5173
npm run build              # tsc -b + vite build + scripts/postbuild.mjs (creates dist/404.html)
npm run preview            # serve dist/
npm test                   # Vitest: 697 tests (677 for the statistics engine in src/stats)
npm run typecheck          # tsc -b
node scripts/verify-ui.mjs <baseUrl> [--widths=1440,390] [--routes=/,/explorer]
                           # Edge screenshots of every route → .verify/, fails on console errors
npm run deploy:netlify     # build + deploy dist/ to Netlify (primary host)
npm run deploy             # build + deploy dist/ to Vercel (mirror)
npm run guide:pdf          # re-render docs/EARTHSCOPE-Guide-AR.pdf from docs/guide-ar/guide.html
npm run data:textures | data:gibs | data:atlas | data:external | data:snapshots   # regenerate real-data assets
```

Tool versions: Vite 8, React 19, React Router 8, TypeScript 7 (native `tsc`), Tailwind 4, Motion (`motion/react`), three.js, Vitest, playwright-core (drives the installed Microsoft Edge via `channel: "msedge"`; no browser download).

---

## 3. Architecture (how data flows)

```
User question ──► questionParser (keywords → variables, gazetteer → regions)
      │
Wizard / Explorer / Discovery ──► store/investigation.ts  run(config)
                                       │
                         services/series.ts fetchRegionSeries(region, vars, start, end)
                           ├─ services/geo.ts buildSamplePlan(): POWER grid cells (0.5°×0.625°) inside
                           │   the country polygon (Natural Earth 50m) or bbox; ≤32 cells = all, else
                           │   systematic every-k-th cell; weights = cos(lat)
                           ├─ services/power.ts fetchPowerPoint(): 1 request per cell, all parameters at once,
                           │   ≤3 concurrent, retry + backoff, in-flight dedupe, IndexedDB cache (services/cache.ts)
                           ├─ services/aggregate.ts aggregatePoints(): weighted monthly mean (needs ≥50% weight)
                           └─ on network failure → public/snapshots/<seriesId>.json (real, dated)
                                       │
                         stats/analyze.ts analyzeSeries(series, {annualAgg, annualSumFactor, primary, alpha})
                                       │ → AnalysisResult (+annualUnit etc.)
                                       ▼
   Pages read via hooks/useEntries.ts (series + result + variable + region joined)
   Workspace · Trend Lab · Compare · Relationships · AI Scientist (services/analyst.ts) · Reports
```

- **State:** `zustand` store `src/store/investigation.ts`. Persisted to localStorage: `config`, `history`, `reports`, `primary`, `alpha` (not series). On reload, `AppShell` re-runs the persisted config on analysis pages (fast thanks to the IndexedDB cache).
- **Routing:** `src/app/router.tsx` — every page is `React.lazy` (code-split). Static-host SPA fallback: `dist/404.html` (postbuild), `public/_redirects` (Netlify), `vercel.json` rewrites.
- **No backend required.** An optional language-model endpoint can be plugged in through the `/api/interpret` contract (see [API_CONTRACTS.md](API_CONTRACTS.md)).

---

## 4. File map

```
index.html, vite.config.ts, tsconfig*.json, netlify.toml, vercel.json, .npmrc
src/
  main.tsx, app/App.tsx (MotionConfig reducedMotion="user"), app/router.tsx (routes table)
  types/domain.ts          shared contract: Variable, Region, BBox, Point, TimeSeries, AnalysisResult, AtlasLayer…
  styles/tokens.css        design tokens (@theme for Tailwind 4) + --chart-* + --map-* variables
  styles/globals.css       base, .panel/.glass/.label-mono/.skeleton, .theme-paper (light report theme), print rules
  data/catalog.ts          19 variables: definition, dataset, connector (power | bundled | import), products, gibsLayer…
  data/regions.ts          named-region gazetteer, parseCoordinates, bboxRegion
  data/demos.ts            guided demos (questions only — no pre-written results)
  data/glossary.ts, data/resources.ts (all 13 challenge resources + how each is used)
  data/atlas/*.json        GENERATED Trend Atlas (640 points × t2m / precip / soil-surface / water-vapor)
  data/external/*.json     GENERATED real snapshots: NSIDC sea ice, MODIS NDVI (Sahel, Rondônia), GISTEMP
  data/gibs-layers.json    GENERATED GIBS layer list with verified date ranges + legends
  services/                power · geo · aggregate · series · cache (IndexedDB) · gibs · atlas ·
                           importers (Giovanni / AppEEARS / CDO / KNMI / generic CSV) · questionParser · analyst
  stats/                   pure-TS statistics, cross-checked against SciPy / pymannkendall:
                           distributions, series, ols (olsAR1), mannKendall (+ Hamed–Rao), sen (Gilbert CI),
                           seasonalKendall, correlation, detect (Weatherhead), fdr (Benjamini–Hochberg),
                           simulate (seeded), analyze (analyzeSeries, compareMethods)
  store/investigation.ts   run / cancel / addSeries / loadBundled / setPrimary / setAlpha / saveReport
  hooks/, utils/           useEntries, useWebGLSupport · format, trend, sun, plainSentence
  components/
    ui/          Button, Badge (TrendBadge, SourceBadge, AIBadge), Panel, Controls (Tabs, Select, Dialog…), States
    navigation/  TopNav, Footer, Logo
    layout/      AppShell (page transitions, titles, auto-restore), GlobeSlot, Reveal
    earth/       EarthEngine.ts (three.js), Globe.tsx, GlobeFallback.tsx (SVG), shaders, countries, geo
    charts/      custom SVG kit: TimeSeries, Anomaly, SeasonalCycle, Scatter, CorrelationMatrix, Lag, ForestPlot…
    maps/        RegionMap (d3-geo SVG + GIBS underlay + click/draw), PlaceSearch
    scientific/  ResultCard, ProvenancePanel, AnalystBlocks, InvestigationRail, ImportDialog
  pages/         Home, Discovery, Investigation, Workspace, TrendLab, EarthExplorer, RegionalComparison,
                 RelationshipLab, AIScientist, Reports, Resources, Guide, NotFound
public/          textures/ (Blue/Black Marble from GIBS), snapshots/ (offline demo fallbacks), guide/ (images),
                 EARTHSCOPE-demo.pdf / .mp4, _redirects, favicon.svg
scripts/         build-* (data), lib/http.mjs, postbuild.mjs, verify-ui.mjs, deploy-vercel.mjs, gen-stats-fixtures.py
docs/            DEVELOPMENT.md (this file), API_CONTRACTS.md, SUBMISSION.md, EARTHSCOPE-Guide-AR.pdf,
                 guide-ar/ (guide source + screenshots), demo/ (demo deck + video sources), presentation/ (.pptx decks)
```

---

## 5. Pages (routes)

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing: 3D globe hero (significant precipitation-trend markers), sub-solar telemetry, scroll story, one-click finished demos | Science section computes the NSIDC September Arctic sea-ice trend live |
| `/discover` | Discovery Studio: 19 variables, search/filter, detail drawer (GIBS preview, products, access tools), missions, partner agencies | `?v=<variableId>` opens a card |
| `/investigate` | 6-step wizard (question → variables → region → time → methods → review); natural-language parser; “Watch a demo” autoplay | `?demo=<id>`, `?v=<id>` |
| `/workspace` | Details/provenance · map (satellite / variable / outline + sample cells) + charts · result card, all tests, interpretation | CSV import |
| `/trend-lab` | Stat cards, method switcher + comparison table, CI fan, moving averages, anomalies, seasonal shift, explainers, significance simulator | |
| `/explorer` | Full-screen globe ⇄ map unfold, atlas filters, GIBS monthly layers, search, click/draw regions, legend | `?layer=<gibsId>` |
| `/compare` | Forest plot (opposing-trend bracket), shared-axis small multiples, anomalies, pairwise differences, availability | |
| `/relationships` | Anomaly overlay, scatter + fit, lag correlation (±12 months, Bonferroni), correlation matrix, causation warning | fetches extra variables itself |
| `/ai-scientist` | Chat grounded in computed results; evidence vs hypothesis cards; suggested prompts; engine badge | |
| `/reports` | Academic report in the light paper theme (9 sections + references), print/PDF, CSV, JSON; saved locally | `?new=1` generates |
| `/guide` | “How to use EARTHSCOPE” walkthrough for first-time visitors | |
| `/resources` | All 13 challenge resources + integrated services, glossary, disclaimers | |

Analysis pages share `InvestigationRail` (sticky sub-nav: Workspace · Trend Lab · Compare · Relationships · AI Scientist · Report).

---

## 6. Domain conventions (easy to get wrong)

- **Time:** `Point.t` = decimal year at mid-month (`year + (month − 0.5)/12`); `date` = `"YYYY-MM"` (monthly) or `"YYYY"` (annual). Missing = `v: null` — never fill values.
- **Slopes:** stored per year; the UI shows **per decade**. Summary slopes are in the **annual unit** (`result.annualUnit` via `resultAnnualUnit()`): precipitation/evaporation (`annualAgg: "sum"`, `annualSumFactor: "daysInMonth"`) turn mm/day into **mm/yr annual totals**.
- **Imports** with a different unit than the catalog (e.g. IMERG mm/hr) are analysed with `annualAgg: "mean"` (see `analyse()` in the store).
- **`intervalScale: true`** (t2m, lst, sst, global-temp): hide “% of mean” (meaningless for °C). Use `pctPerDecade(result, variable)` from `utils/trend.ts`.
- **Direction vs significance are separate:** `summary.direction` = sign of the headline slope; `summary.significant` = p < α. Non-significant trends are still shown (dashed/hollow).
- **Headline method:** default `"mk-sen"` (Mann-Kendall + Sen on annual values); alternative `"ols-ar1"` (OLS on deseasonalised monthly anomalies, Santer AR(1) effective n). `setPrimary` recomputes.
- **Trend line on charts:** `annualTrendOverlay(result)` (Sen intercept or centroid) — plot it on the **annual** series only.
- **Region ids:** countries = `country-<id>` where `<id>` is the world-atlas numeric id made unique (duplicates get a `-<name>` suffix) — same rule in `services/geo.ts` and `scripts/build-snapshots.ts`. Named regions use `NAMED_REGION_BY_ID`.
- **Series id:** `${regionId}__${variableId}__${start}-${end}` (also the snapshot filename).
- **Variable connectors:** `power` (live; parameter + startYear, AOD_55 starts 2001), `bundled` (snapshot ids in `src/data/external`), `import` (tools list).
- **GIBS:** WMS 1.3.0 EPSG:4326 → `BBOX=south,west,north,east`. An out-of-range `TIME` returns a blank 200 PNG → always `clampTime()`; layers with `verifiedEnd` use it as the end.
- **Maps:** `RegionMap` fits using a corner **MultiPoint** (not a polygon) so GIBS underlays align exactly.

---

## 7. Subsystems

**Statistics (`src/stats`)** — never change without running `npm test`. Fixtures come from `scripts/gen-stats-fixtures.py` (SciPy + pymannkendall). Notable choices: Hamed–Rao in `analyzeSeries` uses `{lag: 3, minCorrection: 1}`; missing months in usable years are anomaly-filled for annual sums; years-to-detect uses the detrended anomaly SD; `formatP` shows 3 decimals below 0.1; `lagCorrelation` uses the Bretherton effective n by default.

**Earth engine (`src/components/earth`)** — one 256×128 plane mesh; the vertex shader morphs sphere ⇄ equirectangular (constant-arc-length unroll, centred on the view longitude). Borders, regions, markers and overlays share the GLSL morph chunk. Analytic picking (ray–sphere / ray–plane, disabled mid-morph). Render-on-demand, DPR cap, full dispose + `forceContextLoss`, StrictMode-safe, SVG fallback on no WebGL / context loss. Known: fixed “studio” sun; `focus` is compared by value (set `null` first to re-fly).

**Charts (`src/components/charts`)** — custom SVG on d3-scale/shape. All colours come from CSS variables, so they re-theme inside `.theme-paper`. Every chart has `role="img"`, an aria-label, a hidden data table and a keyboard crosshair. Reveal animations (pathLength/clip) — screenshot with reduced motion or wait ≥ 2 s.

**AI Scientist (`services/analyst.ts`)** — deterministic rule engine: intents (opposite trends, significance, years-to-detect, suggestions, hypotheses, glossary, summary). Uses only `AnalysisResult` numbers; hypotheses come from a vetted mechanism table. If `VITE_AI_ENDPOINT` is set, the narrative comes from that endpoint (contract in `docs/API_CONTRACTS.md`) and the local evidence blocks are still shown. The engine is always labelled (`AIBadge`).

**Design system** — tokens in `src/styles/tokens.css`. Fonts: Space Grotesk (display), Inter (UI), JetBrains Mono (numbers/labels) via Fontsource. Dark “mission control” look; `.theme-paper` light theme only for reports/print.

---

## 8. Data sources & generated assets (all real, retrieved 2026-11-15)

| Asset | Source | Script |
|---|---|---|
| Live series | NASA POWER monthly point API (MERRA-2 / CERES), CORS `*`, no key | runtime `services/power.ts` |
| Live imagery | NASA GIBS WMS (CORS `*`) | runtime `services/gibs.ts` |
| `public/textures/*` | GIBS BlueMarble_NextGeneration + VIIRS_Black_Marble (4k & 2k) | `npm run data:textures` |
| `src/data/gibs-layers.json` | GIBS WMTS capabilities, each layer verified with a real GetMap | `npm run data:gibs` |
| `src/data/atlas/*` | NASA POWER, 640 Fibonacci points, 1981–2025, Mann-Kendall + Sen on annual values, Benjamini–Hochberg FDR q = 0.05 per variable. Significant ▲/▼: t2m 443/29 · water vapour 405/12 · precip 67/75 · surface soil (163 land points) 24/32 | `npm run data:atlas` (cache in `data-raw/`) |
| `src/data/external/*` | NSIDC Sea Ice Index G02135 v4; ORNL DAAC MODIS MOD13Q1 NDVI (good-quality pixels; the Sahel shows re-greening, the Rondônia pixel shows no deforestation signal); NASA GISTEMP v4 | `npm run data:external` |
| `public/snapshots/*` | Real POWER regional series for every demo (offline fallback, same sampling code) | `npm run data:snapshots` |

Earthdata-login products (IMERG, GLDAS, GRACE, MODIS area averages, chlorophyll) are not fetched live — they are analysed via CSV import (Giovanni / AppEEARS / Hydrology / CDO / KNMI). The backend contract for adding them is in [API_CONTRACTS.md](API_CONTRACTS.md).

---

## 9. Verification workflow

1. `npm test` (all pass) and `npm run build` (must be clean).
2. `npx vite preview --port 4317 --strictPort`, then `node scripts/verify-ui.mjs http://localhost:4317` → every route ✓ at 1440 / 1280 / 834 / 390 px.
3. Read the screenshots in `.verify/` — don't trust “no errors” alone.
4. Reference results to sanity-check against:
   - Jordan precipitation 1981–2025: Sen −1.90 mm/yr per decade, 95% CI −8.93…+5.78, p = 0.63, 28 cells, years-to-detect ≈ 94.
   - Levant compare: Iraq +8.92 (p = 0.03, significant ▲), Jordan −1.90 (p = 0.63), Saudi Arabia −1.48 (p = 0.69; 23 of ≈ 547 cells).
   - Svalbard t2m: +0.72 °C/decade, p < 0.001, 6/6 methods significant.
   - Jordan precipitation ↔ root-zone soil moisture: r = 0.49 (lag 0), peak r = 0.61 at +1 month.

---

## 10. Deployment

- **Primary: Netlify** — `npm run deploy:netlify` deploys the static `dist/`; `public/_redirects` handles SPA routes. If a newly created site shows a 401 login page, turn off team-level visitor protection in the site settings.
- **Mirror: Vercel** — `npm run deploy`. `scripts/deploy-vercel.mjs` builds locally, copies the project link + a static `vercel.json` into `dist/`, then runs `vercel deploy --prod` from `dist` (avoids `vercel build`, which needs symlink permissions on Windows). Some networks block `*.vercel.app`; use the Netlify link there.
- CLI logins and site links (`.netlify/`, `.vercel/`) stay local and are git-ignored.

---

## 11. Troubleshooting (Windows)

| Problem | Fix |
|---|---|
| `npm install` hangs / ECONNRESET | Keep `.npmrc` → `registry=https://registry.yarnpkg.com/` (same packages). |
| Git Bash turns `/` arguments into `C:/Program Files/Git/` | Prefix the command with `MSYS_NO_PATHCONV=1`. |
| Headless WebGL renders nothing | Launch Edge with `--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist` (already in `scripts/verify-ui.mjs`); use `reducedMotion: "reduce"` for deterministic screenshots. |
| Mobile overflow check passes when it shouldn't | Mobile browsers widen the layout viewport — compare `document.documentElement.scrollWidth` to 390, not `innerWidth`. |
| TypeScript 7 path aliases fail | `paths` must be relative: `"@/*": ["./src/*"]` (no `baseUrl`). |
| Port 4173 already in use | `vite preview --port 4317 --strictPort`. |

---

## 12. Known limitations & ideas

- Regional means are POWER grid-cell samples (systematic subsample for big countries), not full-resolution satellite averages; POWER is reanalysis.
- No live Earthdata products (needs a backend; contract in `API_CONTRACTS.md`).
- The Trend Atlas is a coarse 640-point snapshot; linear trends only.
- Globe lighting is a fixed studio sun; deep map zoom is soft (no tiled imagery).
- No user accounts — investigations and reports live in browser localStorage.
- Ideas: Earthdata backend, per-pixel trend maps, full Arabic UI, custom domain, classroom testing with students.
