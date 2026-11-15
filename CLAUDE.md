# CLAUDE.md — EARTHSCOPE (read this first)

> Context file for AI agents/new chats. It explains **what the project is, what has been done, how it works, and the traps to avoid**. Keep it updated when you change something important (append to the History log at the bottom).

---

## 1. TL;DR

**EARTHSCOPE** is a React web app built for the **NASA Space Apps Challenge 2026 — “Be An Earth System Trend Detective!”**.

**Core idea (one sentence):** the user asks a question like *“Is precipitation decreasing in Jordan?”* → the app fetches **real NASA data** for that region (45 years, monthly) → plots it → runs **statistical trend tests** (Mann-Kendall, Sen's slope, regression with confidence intervals) → says **what changed, where, how much, and whether it is statistically significant** — in simple language for students.

The challenge's 4 required elements, all implemented:
1. Identify Earth-science variables (catalog of 19 variables with plain-language definitions).
2. Acquire data for a region (live NASA POWER API, area-averaged over grid cells inside the country/box).
3. Generate and visualize a time series (annual, monthly, anomalies).
4. Rate of change + significance test (MK, Sen + Gilbert CI, OLS t-test with AR(1) correction, Seasonal Kendall).

**Status: COMPLETE, deployed, verified.** Build passes, 677 stats tests pass, every route clean (0 console errors) at 1440/1280/834/390 px.

| Thing | Value |
|---|---|
| **Live site (use this)** | https://earthscope-space-apps.netlify.app |
| Mirror | https://earthscope-two.vercel.app (blocked on the user's network — see §4) |
| Arabic 10-page guide (PDF) | `docs/EARTHSCOPE-Guide-AR.pdf` (copy also on the user's Desktop) |
| Human docs | `README.md`, `docs/API_CONTRACTS.md` |
| Local dev | `npm run dev` → http://localhost:5173 |

---

## 2. Golden rules (do not break)

1. **Never fabricate data.** Every number comes from (a) live NASA POWER, (b) a bundled real-data snapshot with a retrieval date, or (c) a user-imported file. The **only** synthetic data is the Trend Lab “Significance simulator”, labelled `SIMULATION · synthetic data`. Demo narration never states results in advance — results are computed when the demo runs.
2. **Never claim “live” when it isn't.** `TimeSeries.provenance.mode` ∈ `live | snapshot | import | simulation` and the UI shows it via `SourceBadge`.
3. **Significance is never shown by color alone** — always glyph (▲ ▼ ◇) + label + solid/dashed/hollow.
4. **Colors have fixed meanings:** cyan = data/interaction, ice = selection, **violet = AI only**, green ▲ = increasing, coral ▼ = decreasing, slate dashed/hollow = not significant. Anomaly charts use neutral clay/ice (not green/coral).
5. **Evidence ≠ hypothesis.** The AI/analyst only states computed numbers; explanations are labelled “Possible explanation — untested”. Correlation ≠ causation is stated in the Relationship Lab.
6. **Don't edit generated data by hand** (`src/data/atlas/*`, `src/data/external/*`, `src/data/gibs-layers.json`, `public/snapshots/*`, `public/textures/*`) — regenerate with the scripts (§9).
7. Not an official NASA product: no NASA logo; keep the disclaimer + AI-use disclosure (footer + Resources page).

---

## 3. Commands

```bash
npm install                # registry is set to registry.yarnpkg.com in .npmrc (see §4)
npm run dev                # Vite dev server :5173
npm run build              # tsc -b + vite build + scripts/postbuild.mjs (creates dist/404.html)
npm run preview            # serve dist (use --port 4317; 4173 is taken on this machine)
npm test                   # vitest: 677 stats tests (src/stats/__tests__)
npm run typecheck          # tsc -b
node scripts/verify-ui.mjs <baseUrl> [--widths=1440,390] [--routes=/,/explorer]
                           # Edge screenshots of every route → .verify/, fails on console errors
npm run deploy:netlify     # build + deploy dist to Netlify production (PRIMARY host)
npm run deploy             # build + deploy dist to Vercel production (scripts/deploy-vercel.mjs)
npm run guide:pdf          # re-render docs/EARTHSCOPE-Guide-AR.pdf from docs/guide-ar/guide.html
npm run dev:ai             # optional Claude proxy (needs ANTHROPIC_API_KEY), then run app with VITE_AI_ENDPOINT=/api/interpret
npm run data:textures | data:gibs | data:atlas | data:external | data:snapshots   # regenerate real-data assets
```

---

## 4. Environment quirks — READ BEFORE RUNNING ANYTHING

Windows 11, Node 24, npm 11, Git Bash + PowerShell, Python 3.13 (+ SciPy, pymannkendall, pypdf), Microsoft Edge + Chrome installed.

| Problem | Cause | Fix / rule |
|---|---|---|
| `npm install` hangs / ECONNRESET | `registry.npmjs.org` is reset by the network | Project `.npmrc` uses `registry=https://registry.yarnpkg.com/` (same packages). Keep it. |
| `*.vercel.app` → ERR_CONNECTION_CLOSED | The user's network blocks the **name** `vercel.app` (SNI-based; same Vercel IPs work with other names) | Use **Netlify** as primary host. Vercel deploy is fine for other networks. A custom domain on Vercel would also work. |
| `vercel build` fails (EPERM symlink) | Windows symlink permission | Don't use `vercel build`. `scripts/deploy-vercel.mjs` builds locally, copies `.vercel/project.json` + a static `vercel.json` into `dist/`, then `vercel deploy --prod` from `dist`. |
| Netlify site showed 401 “Login Redirect” | Team-level “Netlify login” protection (`sso_login`) was ON by default | Already disabled via API: `npx netlify-cli api updateSite --data '{"site_id":"a70019b0-62f6-4deb-a2bf-97181e1defea","body":{"sso_login":false}}'`. If a new site is created, check this again. |
| spaceappschallenge.org TLS error | Server sends incomplete chain (SSL.com intermediate) | Fetch with `NODE_EXTRA_CA_CERTS` = intermediate from `http://cert.ssl.com/SSL.com-TLS-I-RSA-R1.cer`. **Never disable TLS verification.** |
| Git Bash turns `/` args into `C:/Program Files/Git/` | MSYS path conversion | Prefix with `MSYS_NO_PATHCONV=1`. |
| Port 4173 already used by another app | Unrelated local server | Use `vite preview --port 4317 --strictPort`. |
| Headless WebGL | No GPU in CI | Launch Edge with `--enable-unsafe-swiftshader --use-angle=swiftshader --ignore-gpu-blocklist` (already in `scripts/verify-ui.mjs`). Use `reducedMotion: "reduce"` for deterministic screenshots (charts animate in). |
| Mobile overflow check lies | Mobile browsers widen layout viewport | Compare `document.documentElement.scrollWidth` to **390**, not `innerWidth`. |
| Long `node -e '…'` with apostrophes | Shell quoting | Write a small script file (e.g. `.verify/*.cjs`) instead. |
| TypeScript 7 | `paths` must be relative | `tsconfig.app.json` uses `"@/*": ["./src/*"]` (no `baseUrl`). |

Tool versions in use: Vite 8, React 19, React Router 8, TypeScript 7 (native tsc), Tailwind 4, Motion 14 (`motion/react`), three 0.187, Vitest 5, playwright-core 1.65 (uses installed Edge via `channel: "msedge"`, no browser download).

---

## 5. Architecture (how data flows)

```
User question ──► questionParser (keywords → variables, gazetteer → regions)
      │
Wizard / Explorer / Discovery ──► store/investigation.ts  run(config)
                                       │
                         services/series.ts fetchRegionSeries(region, vars, start, end)
                           ├─ services/geo.ts buildSamplePlan(): POWER grid cells (0.5°×0.625°) inside
                           │   the country polygon (Natural Earth 50m) or bbox; ≤32 cells = all, else
                           │   systematic every-k-th cell; weights = cos(lat)
                           ├─ services/power.ts fetchPowerPoint(): 1 request per cell, ALL params at once,
                           │   ≤3 concurrent, retry+backoff, in-flight dedupe, IndexedDB cache (services/cache.ts)
                           ├─ services/aggregate.ts aggregatePoints(): weighted monthly mean (needs ≥50% weight)
                           └─ on network failure → public/snapshots/<seriesId>.json (real, dated)
                                       │
                         stats/analyze.ts analyzeSeries(series, {annualAgg, annualSumFactor, primary, alpha})
                                       │ → AnalysisResult (+annualUnit etc.)
                                       ▼
   Pages read via hooks/useEntries.ts (series + result + variable + region joined)
   Workspace · Trend Lab · Compare · Relationships · AI Scientist (services/analyst.ts) · Reports
```

- **State:** `zustand` store `src/store/investigation.ts`. Persisted to localStorage: `config`, `history`, `reports`, `primary`, `alpha` (NOT series). On reload, `AppShell` auto re-runs the persisted config on analysis pages (fast thanks to IndexedDB cache).
- **Routing:** `src/app/router.tsx` — every page `React.lazy` (code-split). Static-host SPA fallback: `dist/404.html` (postbuild), `public/_redirects` (Netlify), `vercel.json` rewrites.
- **No backend required.** Optional `server/ai-proxy.mjs` (Claude) only for LLM answers.

---

## 6. File map

```
index.html, vite.config.ts (manualChunks; /api proxy → :8787), tsconfig*.json, vercel.json, netlify.toml, .npmrc
src/
  main.tsx, app/App.tsx (MotionConfig reducedMotion="user"), app/router.tsx (routes table)
  types/domain.ts          ★ shared contract: Variable, Region, BBox, Point, TimeSeries, AnalysisResult, AtlasLayer, GibsLayerMeta…
  styles/tokens.css        ★ design tokens (@theme for Tailwind 4) + --chart-* + --map-* vars
  styles/globals.css       base, .panel/.glass/.label-mono/.skeleton, .theme-paper (light report theme), print rules
  data/catalog.ts          ★ 19 variables: definition, dataset, connector (power|bundled|import), products, gibsLayer, annualAgg, intervalScale
  data/regions.ts          named regions gazetteer (+ arctic/antarctic/global, sahel/rondonia MODIS pixels), parseCoordinates, bboxRegion
  data/demos.ts            6 guided demos (questions only — no pre-written results)
  data/glossary.ts, data/resources.ts (all 13 challenge resources + how each is used)
  data/atlas/*.json        GENERATED Trend Atlas (640 pts × t2m/precip/soil-surface/water-vapor) + manifest
  data/external/*.json     GENERATED real snapshots: NSIDC sea ice, MODIS NDVI (Sahel, Rondônia), GISTEMP
  data/gibs-layers.json    GENERATED GIBS layer list w/ verified date ranges + legends
  services/
    power.ts (POWER client) · geo.ts (countries, search, sampling plan) · aggregate.ts · series.ts
    cache.ts (IndexedDB) · gibs.ts (WMS URL builder, clampTime, DATA_LAYERS) · atlas.ts
    importers.ts (Giovanni/AppEEARS/CDO/KNMI/generic CSV → TimeSeries) · questionParser.ts
    analyst.ts (rule-based AI Scientist + optional remote LLM)
  stats/                   ★ pure TS statistics (agent-built, 677 tests, cross-checked vs SciPy/pymannkendall)
    distributions, series, ols (olsAR1), mannKendall (+hamedRao), sen (Gilbert CI), seasonalKendall,
    correlation (pearson/spearman/Bretherton nEff/lagCorrelation/correlationMatrix), detect (Weatherhead),
    fdr (Benjamini–Hochberg), simulate (seeded), analyze (analyzeSeries, compareMethods), index
  store/investigation.ts   run / cancel / addSeries / loadBundled / setPrimary / setAlpha / saveReport
  hooks/useEntries.ts, hooks/useWebGLSupport.ts
  utils/ cn, format (fmt, fmtP, fmtSigned…), trend (annualTrendOverlay, resultAnnualUnit, pctPerDecade), sun (subsolar point)
  components/
    ui/        Button(+ButtonLink, IconButton), Badge(TrendBadge, SourceBadge, AIBadge), Panel(+Eyebrow, KeyValue),
               Controls(Tabs, Segmented, Select, TextInput, Switch, InfoTip, Dialog, CountUp, Stat), States
    navigation/ TopNav (+“Labs” menu, local “My workspace”), Footer, Logo
    layout/    AppShell (page transitions, titles, auto-restore), GlobeSlot (lazy Globe + poster + ErrorBoundary), Reveal
    earth/     ★ EarthEngine.ts (three.js), Globe.tsx, GlobeFallback.tsx (SVG), shaders.ts, countries.ts, geo.ts, types.ts
    charts/    ★ custom SVG kit: TimeSeriesChart, AnomalyChart, SeasonalCycleChart, ScatterChart, CorrelationMatrix,
               LagChart, ForestPlot, Sparkline, ChartFrame, ChartTooltip, axes, palette, charts.css, index.ts
    maps/      RegionMap (d3-geo SVG + GIBS underlay + click/draw), PlaceSearch (combobox)
    scientific/ ResultCard, ProvenancePanel, AnalystBlocks, InvestigationRail, NoInvestigation, ImportDialog
  pages/  Home/(HomePage + Challenge/Discovery/Science/Investigation sections + FinalCta), Discovery/, Investigation/,
          Workspace/, TrendLab/, EarthExplorer/, RegionalComparison/ComparePage, RelationshipLab/RelationshipPage,
          AIScientist/, Reports/, Resources/, NotFound
public/ textures/ (Blue/Black Marble from GIBS), snapshots/ (demo offline fallbacks), _redirects, favicon.svg
scripts/ build-*.{mjs,ts} (data), lib/http.mjs, postbuild.mjs, verify-ui.mjs, deploy-vercel.mjs, gen-stats-fixtures.py
server/ai-proxy.mjs   optional Claude proxy (official @anthropic-ai/sdk, model claude-opus-5-5, effort medium, server-side fallbacks)
docs/ API_CONTRACTS.md, EARTHSCOPE-Guide-AR.pdf, guide-ar/ (guide.html, capture*.mjs, render.mjs, img/, preview/)
.verify/ throwaway QA scripts + screenshots (gitignored)
```

---

## 7. Pages (routes)

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing: 3D globe hero (precip atlas markers, significant only), live sub-solar telemetry, 5-part scroll story | Science section computes NSIDC Sept Arctic ice trend live (≈ −0.72 M km²/decade, p<0.001) |
| `/discover` | Discovery Studio: 19 variables, search/filter, detail drawer (GIBS preview, products, access tools), missions, CSA partners | `?v=<variableId>` opens a card |
| `/investigate` | 6-step wizard (question → variables → region → time → methods → review); NL parser; **“Watch a demo”** autoplay | `?demo=<id>`, `?v=<id>` |
| `/workspace` | 3-column research view: details/provenance · map (satellite/variable/outline + sample cells) + charts · result card, all tests, interpretation; CSV import | |
| `/trend-lab` | Stat cards, method switcher + comparison table, CI fan, moving averages, anomalies, seasonal shift, explainers, significance vs importance, **simulator** | |
| `/explorer` | Full-screen globe ⇄ map unfold, atlas filters, GIBS monthly layers, search, click/draw regions, legend, investigate/compare | `?layer=<gibsId>` |
| `/compare` | Forest plot (opposing-trend bracket), shared-axis small multiples, anomalies, pairwise differences, availability | |
| `/relationships` | Anomaly overlay, scatter+fit, lag correlation (±12 mo, Bonferroni), correlation matrix, causation warning | fetches extra vars itself |
| `/ai-scientist` | Chat grounded in computed results; evidence vs hypothesis cards; suggested prompts; engine badge | |
| `/reports` | Academic report in light `.theme-paper` (9 sections + refs), print/PDF, CSV, JSON; saved locally | `?new=1` generates |
| `/resources` | All 13 challenge resources + integrated services, glossary, disclaimers | |

Analysis pages share `InvestigationRail` (sticky sub-nav: Workspace · Trend Lab · Compare · Relationships · AI Scientist · Report).

---

## 8. Key domain conventions (easy to get wrong)

- **Time:** `Point.t` = decimal year at mid-month (`year + (month-0.5)/12`); `date` = `"YYYY-MM"` (monthly) or `"YYYY"` (annual). Missing = `v: null` (never fill values).
- **Slopes:** internal per year; UI shows **per decade**. Summary slopes are in the **annual unit** (`result.annualUnit` via `resultAnnualUnit()`): precipitation/evaporation (`annualAgg:"sum"`, `annualSumFactor:"daysInMonth"`) → mm/day becomes **mm/yr annual totals**.
- **Imports with a different unit** than the catalog (e.g. IMERG mm/hr) are analysed with `annualAgg:"mean"` (see `analyse()` in the store).
- **`intervalScale: true`** (t2m, lst, sst, global-temp): hide “% of mean” (meaningless for °C). Use `pctPerDecade(result, variable)` from `utils/trend.ts`.
- **Direction vs significance are separate:** `summary.direction` = sign of headline slope; `summary.significant` = p < α. Non-significant trends are still shown (dashed/hollow).
- **Headline method:** default `"mk-sen"` (Mann-Kendall + Sen on annual values); alternative `"ols-ar1"` (OLS on deseasonalised monthly anomalies, Santer AR(1) effective n). Store `setPrimary` recomputes.
- **Trend line on charts:** `annualTrendOverlay(result)` (Sen intercept or centroid) — plot it on the **annual** series only.
- **Region ids:** countries = `country-<id>` where `<id>` is world-atlas numeric id **made unique** (duplicates like `036` get `-<name>` suffix) — same rule in `services/geo.ts` and `scripts/build-snapshots.ts`. Named regions use `NAMED_REGION_BY_ID`.
- **Series id:** `${regionId}__${variableId}__${start}-${end}` (also the snapshot filename).
- **Variable connectors:** `power` (live, parameter + startYear; AOD_55 starts 2001), `bundled` (snapshotIds in `src/data/external`), `import` (tools list).
- **GIBS:** WMS 1.3.0 EPSG:4326 → `BBOX=south,west,north,east`. Out-of-range TIME returns a blank 200 PNG → always `clampTime()`; layers with `verifiedEnd` use it as end.
- **Maps:** `RegionMap` fits using a corner **MultiPoint** (not a polygon) so GIBS underlays align exactly.

---

## 9. Data sources & generated assets (all real, retrieved 2026-11-15)

| Asset | Source | Script |
|---|---|---|
| Live series | NASA POWER monthly point API (MERRA-2/CERES), CORS `*`, no key | runtime `services/power.ts` |
| Live imagery | NASA GIBS WMS (CORS `*`) | runtime `services/gibs.ts` |
| `public/textures/*` | GIBS BlueMarble_NextGeneration + VIIRS_Black_Marble (4k & 2k) | `npm run data:textures` |
| `src/data/gibs-layers.json` | GIBS WMTS capabilities, each layer verified with a real GetMap | `npm run data:gibs` |
| `src/data/atlas/*` | NASA POWER, 640 Fibonacci points, 1981–2025, MK+Sen on annual values, BH-FDR q=0.10 (t2m: 461▲/33▼ significant; precip: 89▲/112▼) | `npm run data:atlas` (cache in `data-raw/`) |
| `src/data/external/*` | NSIDC Sea Ice Index G02135 v4; ORNL DAAC MODIS MOD13Q1 NDVI (good-quality pixels; Sahel shows re-greening, **Rondônia pixel shows NO deforestation signal**); NASA GISTEMP v4 | `npm run data:external` |
| `public/snapshots/*` | Real POWER regional series for every demo (offline fallback, same sampling code) | `npm run data:snapshots` |

Earthdata-login products (IMERG, GLDAS, GRACE, MODIS area averages, chlorophyll) are **not** fetched live — analysed via CSV import (Giovanni/AppEEARS/Hydrology/CDO/KNMI). Backend contract for adding them: `docs/API_CONTRACTS.md`.

---

## 10. Subsystem notes

**Statistics (`src/stats`)** — never change without running `npm test`. Fixtures from `scripts/gen-stats-fixtures.py` (SciPy + pymannkendall). Notable choices: Hamed–Rao in `analyzeSeries` uses `{lag:3, minCorrection:1}`; missing months in usable years are anomaly-filled for annual sums; years-to-detect uses detrended anomaly SD; `formatP` shows 3 decimals < 0.1; lagCorrelation uses Bretherton nEff by default.

**Earth engine (`src/components/earth`)** — one 256×128 plane mesh; vertex shader morphs sphere ⇄ equirectangular (constant-arc-length unroll, centred on view longitude). Borders/regions/markers/overlay share the GLSL morph chunk. Analytic picking (ray–sphere / ray–plane, disabled mid-morph). Render-on-demand, DPR cap, full dispose + `forceContextLoss`, StrictMode-safe, SVG fallback on no WebGL/context loss. Props in `types.ts` (`GlobeProps`). Known: fixed “studio” sun (not real UTC sun); `focus` is compared by value (set `null` first to re-fly).

**Charts (`src/components/charts`)** — custom SVG on d3-scale/shape. All colors via CSS vars → automatically re-theme inside `.theme-paper`. Every chart: role="img", aria-label, hidden data table, keyboard crosshair. Reveal animations (pathLength/clip) — screenshot with reduced motion or wait ≥2 s.

**AI Scientist (`services/analyst.ts`)** — deterministic rule engine: intents (opposite trends, significance, years-to-detect, suggestions, hypotheses, glossary, summary). Uses only `AnalysisResult` numbers; hypotheses from a vetted mechanism table. If `VITE_AI_ENDPOINT` is set, narrative comes from `server/ai-proxy.mjs` (Claude) and local evidence blocks are still shown. Engine is always labelled (`AIBadge`).

**Design system** — tokens in `src/styles/tokens.css`. Fonts: Space Grotesk (display), Inter (UI), JetBrains Mono (numbers/labels) via @fontsource. Dark “mission control” look; `.theme-paper` light theme only for reports/print.

---

## 11. Deployment

- **Primary: Netlify** — site `earthscope-space-apps` (id `a70019b0-62f6-4deb-a2bf-97181e1defea`), linked in `.netlify/state.json`. Deploy: `npm run deploy:netlify` (static `dist`, `public/_redirects` handles SPA routes). Visitor protection (`sso_login`) is OFF — keep it off.
- **Mirror: Vercel** — project `earthscope`, linked in `.vercel/project.json`. Deploy: `npm run deploy` (never `vercel build`, see §4). Aliases: `earthscope-two.vercel.app`.
- CLI auth for both is already stored on this machine (logins done by the user). Deploying = publishing publicly: only do it when the user asks.
- The AI proxy is **not** deployed; the live site uses the rule-based analyst.

---

## 12. Verification workflow (do this after changes)

1. `npm test` (677 pass) and `npm run build` (must be clean).
2. `npx vite preview --port 4317 --strictPort` then `node scripts/verify-ui.mjs http://localhost:4317` → all routes ✓ at 4 widths.
3. For journeys, see `.verify/journey.mjs`, `.verify/compare.mjs`, `.verify/report.mjs` (demo → workspace → trend lab → AI → report). Real results to sanity-check against:
   - Jordan precip 1981–2025: Sen −1.90 mm/yr/decade, CI −8.93…+5.78, p 0.63, 28 cells, years-to-detect ≈94.
   - Levant compare: Iraq +8.92 (p 0.03, significant ▲), Jordan −1.90 (p 0.63), Saudi −1.48 (p 0.69; 23 of ≈547 cells).
   - Svalbard t2m: +0.72 °C/decade, p<0.001, 6/6 methods significant.
   - Jordan precip ↔ root-zone soil moisture: r 0.49 (lag 0), peak r 0.61 at +1 month.
4. Read the screenshots in `.verify/` — don't trust “no errors” alone.

---

## 13. Known limitations / backlog

- Regional means = POWER grid-cell samples (systematic subsample for big countries), not full-resolution satellite averages; POWER = reanalysis.
- No live Earthdata products (needs a backend; contract in `docs/API_CONTRACTS.md`).
- Trend Atlas is a coarse 640-point snapshot; linear trends only.
- Globe lighting is a fixed studio sun; deep map zoom is soft (no tiled imagery).
- No user accounts — investigations/reports live in browser localStorage.
- Ideas: Earthdata backend, per-pixel trend maps, **full Arabic UI** (user is Arabic-speaking), custom domain, demo video, testing with students.

---

## 14. User context & preferences

- The user is a Space Apps participant; writes in **Arabic and English** — answer chat in the user's language (Arabic when they write Arabic). Code/docs stay English unless asked.
- Wants **speed and autonomy** (“full bypass”, “be fast”); give short progress updates and time estimates when asked; share the localhost/live link early.
- They asked for a plain explanation of the idea once — keep explanations simple (see §1 one-sentence idea; analogy: coin flips → “is the change bigger than chance?”).

---

## 15. History log (what was done, in order)

1. **2026-11-15 — Research:** fetched the official challenge page (TLS intermediate fix) and all 13 resources; verified NASA POWER + GIBS work from the browser (CORS `*`); Data Rods/Giovanni need Earthdata login.
2. **Plan + architecture critique** (globe morph, AR(1)-corrected stats, POWER sampling, GIBS silent-blank PNGs, FDR on atlas).
3. **Scaffold:** Vite/React/TS/Tailwind; npm mirror fix; tokens, types, catalog (19 vars), regions, demos, glossary, resources.
4. **Parallel agents built:** stats engine + 677 tests; data scripts (textures, GIBS meta, atlas, NSIDC/MODIS/GISTEMP); three.js Earth engine with unfold; SVG chart kit.
5. **App built:** services (POWER, geo sampling, cache, importers, analyst), store, shell/nav, all 11 pages, optional Claude proxy, README + API contracts.
6. **QA fixes:** map fit (MultiPoint), duplicate country ids, report StrictMode double-generation, “% of mean” hidden for °C, reload auto-restore, paper theme for maps/hypotheses, mobile overflow (grid `min-w-0`, chart headers wrap), nav CTA on mobile, offline snapshots for demos.
7. **Arabic guide PDF** (10 pages, HTML→PDF via Edge, screenshots in `docs/guide-ar/img`).
8. **Deploy:** Vercel (works, but `vercel.app` blocked on user network) → added Netlify (primary), disabled Netlify login protection, verified live site (all routes + live Jordan journey).
9. **CLAUDE.md** created (this file).
