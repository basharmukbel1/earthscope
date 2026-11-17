# EARTHSCOPE — Discover Earth's Hidden Changes

An Earth-system trend detection and investigation platform built for the **NASA Space Apps Challenge 2026 — “Be An Earth System Trend Detective!”**.

| | |
|---|---|
| **Live app** | https://earthscope-space-apps.netlify.app |
| Mirror | https://earthscope-two.vercel.app (some networks block `*.vercel.app` — use the Netlify link there) |
| 30-second demo | [video](public/EARTHSCOPE-demo.mp4) · [slides (PDF)](public/EARTHSCOPE-demo.pdf) |
| Arabic guide (10 pages) | [docs/EARTHSCOPE-Guide-AR.pdf](docs/EARTHSCOPE-Guide-AR.pdf) |

EARTHSCOPE lets students and curious scientists:
1. **Find** an Earth-science variable, with a plain-language definition and the NASA mission or model behind it.
2. **Pick** a region (country, named region, drawn box or coordinates).
3. **Build** a long monthly time series from real NASA data.
4. **Test** whether it is changing, by how much, and whether the change is statistically significant (Mann-Kendall, Sen's slope, regression with t-test and confidence intervals).

Every number shown is computed from real data — live from NASA POWER, from bundled real-data snapshots (labelled with their retrieval date), or from files you import. The only synthetic data in the app is the Trend Lab's teaching simulator, which is labelled **SIMULATION · synthetic data**.

---

## Run it

Requirements: Node 20+ (tested on Node 24), a modern browser with WebGL (an SVG map is used automatically without it).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build → dist/ (includes 404.html SPA fallback)
npm run preview      # serve dist/ on http://localhost:4173
npm test             # 697 tests (677 for the statistics engine, cross-checked against SciPy / pymannkendall)
```

No API keys or backend are needed: NASA POWER and NASA GIBS are called directly from the browser. The AI Scientist is a built-in rule-based analyst (it always says which engine answered); an optional language-model backend can be plugged in through the `/api/interpret` contract in [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md).

Data regeneration (not needed to run the app; outputs are committed):

```bash
npm run data:textures   # Blue Marble / Black Marble textures from NASA GIBS
npm run data:gibs       # GIBS layer date ranges + legend URLs (verified)
npm run data:atlas      # 640-point global Trend Atlas from NASA POWER
npm run data:external   # NSIDC sea ice, ORNL MODIS NDVI, NASA GISTEMP
npm run data:snapshots  # offline real-data fallbacks for the guided demos
node scripts/verify-ui.mjs http://localhost:4173   # screenshots + console-error check in Edge
```

---

## Pages

| Route | Page | What it does |
|---|---|---|
| `/` | Home | Cinematic 3D Earth with real precipitation-trend markers, live sub-solar point, scroll story (challenge → discovery → science → investigation → CTA) |
| `/discover` | Discovery Studio | 19 variables in 4 spheres; definition, why it matters, dataset, unit, resolution, time range, coverage, satellite products, live GIBS preview, access route |
| `/investigate` | Investigation wizard | Question (natural-language parser) → variables → region (map/search/box/coords) → time range → methods → review; **“Watch a demo”** autoplay |
| `/workspace` | Workspace | Study area map (satellite / variable layer / outline + sampled grid cells), time series (annual trend / monthly / anomalies), result card, all tests, interpretation, data quality & provenance, CSV import |
| `/trend-lab` | Trend Lab | Method switcher + comparison table, CI fan, moving averages, anomalies, seasonal-cycle shift, method explainers, significance vs importance, significance simulator |
| `/explorer` | Earth Explorer | Globe ⇄ map unfold, Trend Atlas filters, GIBS data layers by month, search, click/draw regions, legend, investigate/compare |
| `/compare` | Regional Comparison | Forest plot with opposing-trend detection, shared-axis small multiples, anomalies, pairwise differences, data availability |
| `/relationships` | Relationship Lab | Anomaly overlay, scatter + fit, lagged correlation (−12…+12 months), correlation matrix, causation caveat |
| `/ai-scientist` | AI Scientist | Conversation grounded in computed results; evidence vs hypothesis cards, suggested variables, glossary, sources |
| `/reports` | Reports | Academic report (question, study area, data, methods, results, interpretation, uncertainty, limitations, references) — print/PDF, CSV, JSON |
| `/resources` | Resources & Methods | All 13 challenge resources + integrated NASA services, glossary, disclaimers |

---

## How the challenge resources are used

| Challenge resource | In EARTHSCOPE |
|---|---|
| Giovanni | Linked from every relevant variable; Giovanni time-series CSVs import directly |
| Hydrology Time Series | Route for GLDAS runoff / soil moisture / ET; exports import |
| AppEEARS | Route for MODIS NDVI / LST / SMAP; point CSVs import |
| NOAA Climate Data Online | Station data for validation; CSVs import |
| SeaWiFS chlorophyll time-series paper (NTRS) | Cited in Trend Lab and reports |
| KNMI Climate Explorer | Validation tool; text series import |
| Trend-test article / Statsig significance guide | Linked from method explainers and glossary |
| CSA: RCM, Geo.ca, SWOT, ecosystem monitoring, SAR tutorial | Discovery Studio partner section; SWOT and RCM catalogued as products |

---

## Design decisions

- **Visual identity** — “mission control for Earth science”: near-black space, hairline instrument framing, a cinematic Earth, Space Grotesk display type, Inter for UI, JetBrains Mono telemetry. Light only as atmosphere; no neon, no particle fields.
- **Semantic colour, never colour alone** — increasing ▲ green, decreasing ▼ coral, not significant ◇ hollow/dashed slate, violet only for AI output, cyan for data/interaction. Charts use a colour-blind-validated palette.
- **Signature Earth** — one three.js mesh whose vertex shader morphs between a sphere and an equirectangular map (constant-arc-length unroll centred on your view); borders, region outlines, atlas markers and data layers share the same morph so they stay glued through the transition. Analytic picking on sphere/plane, render-on-demand, full GPU disposal, SVG fallback on no WebGL / context loss, reduced-motion crossfade.
- **Honest statistics** — headline: Mann-Kendall + Sen's slope (Gilbert CI) on annual values; regression on deseasonalised monthly anomalies with an AR(1) effective-sample-size correction; Hamed–Rao and Seasonal Kendall alongside; Weatherhead years-to-detect; Benjamini–Hochberg FDR for the map. Precipitation is tested as annual totals; “% of mean” is hidden for interval-scale variables like °C.
- **Light paper theme** only for reports (screen + print), via the same design tokens.

## Technology

React 19 · TypeScript 7 · Vite 8 · React Router 8 · Tailwind CSS 4 · Motion · three.js · d3 (geo/scale/shape/array) · topojson-client + world-atlas · zustand · lucide-react · Fontsource (Space Grotesk, Inter, JetBrains Mono) · Vitest · playwright-core (verification, uses installed Edge).

## Project structure

```
src/
  pages/        one folder per route (Home, Discovery, Investigation, Workspace, TrendLab, …)
  components/   ui · navigation · layout · earth (three.js globe) · charts (SVG) · maps · scientific
  services/     NASA POWER client, region sampling, GIBS, cache, CSV importers, question parser, analyst
  stats/        statistics engine (Mann-Kendall, Sen, OLS + AR(1), Seasonal Kendall, FDR…) + tests
  data/         variable catalog, regions, demos, glossary + generated real-data snapshots
  store/        investigation state (zustand)
public/         Earth textures, offline demo snapshots, demo video/PDF, guide images
scripts/        data generation, build helpers, UI verification, deploy
docs/           developer guide, API contracts, submission text, Arabic guide, demo + presentation sources
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Architecture, data flow, file map, conventions, data sources, verification, deployment |
| [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) | Typed service interfaces and the contracts for optional backends |
| [docs/SUBMISSION.md](docs/SUBMISSION.md) | Space Apps project submission text |
| [docs/EARTHSCOPE-Guide-AR.pdf](docs/EARTHSCOPE-Guide-AR.pdf) | 10-page illustrated guide in Arabic (source: `docs/guide-ar/`) |
| [docs/presentation/](docs/presentation/) | Judge presentation decks (full, 10-minute, 5-minute) |
| [docs/demo/](docs/demo/) | Sources for the demo slides and the 30-second video |

## Data & demonstration content

- **Live**: NASA POWER (MERRA-2 / CERES) monthly series; NASA GIBS imagery.
- **Bundled real snapshots (retrieved 2026-11-15)**: Trend Atlas (NASA POWER, 640 points × 4 variables), NSIDC Sea Ice Index (Arctic/Antarctic), MODIS NDVI (Sahel and Rondônia pixels, ORNL DAAC), NASA GISTEMP v4, offline fallbacks for every guided demo.
- **Synthetic**: Trend Lab significance simulator only (labelled).

## Limitations

- Regional means are area-weighted averages of POWER grid cells (systematically subsampled in very large regions), not full-resolution satellite averages.
- POWER variables are MERRA-2 reanalysis; observing-system changes can create artificial shifts (flagged for ozone).
- IMERG, GLDAS, GRACE, MODIS area averages and chlorophyll need an Earthdata login, so they are analysed via CSV import rather than fetched live (see `docs/API_CONTRACTS.md` for the backend that would add them).
- The Trend Atlas is a coarse 640-point snapshot; the globe's lighting uses a fixed “studio” sun.
- Linear trends only; non-linear and abrupt changes are not modelled.
- No user accounts: investigations and reports are stored in the browser.

## Credits & disclosures

Data: NASA LaRC POWER Project; NASA GIBS / ESDIS; NSIDC; ORNL DAAC; NASA GISS. EARTHSCOPE is an independent Space Apps project, not an official NASA product, and implies no endorsement. AI coding assistants helped build this software; the in-app AI Scientist is rule-based unless an LLM endpoint is configured, and labels which engine answered.
