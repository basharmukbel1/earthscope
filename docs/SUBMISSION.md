# EARTHSCOPE — NASA Space Apps 2026 submission (copy into the project form)

## Project Summary

**Project Name**

EARTHSCOPE: Discover Earth's Hidden Changes

**Summary** (≈190 words, under 1,500 characters)

EARTHSCOPE turns a simple question — "Is precipitation decreasing in Jordan?" — into a statistically tested answer built from real NASA data. Users pick one of 19 Earth-science variables, each explained in plain language, and any country, region or drawn area. EARTHSCOPE fetches 45 years of monthly NASA POWER data (MERRA-2 / CERES) for every grid cell inside the region, builds an area-weighted time series and tests it with the Mann-Kendall test, Sen's slope with 95% confidence intervals, autocorrelation-corrected regression and the Seasonal Kendall test. Every result comes with one plain sentence, the rate of change per decade and whether it is statistically significant; non-significant trends are shown too, with the number of years of data needed to detect them. Users can compare regions (opposite trends are only claimed when both are significant), explore a 3D globe of 640 trend tests per variable, relate variables with lagged correlations, ask a rule-based AI Scientist that only uses computed numbers, and export a scientific report. It covers all four challenge steps and helps students tell real environmental change from noise.

## Project Links

**Project Demonstration** (7 slides, public PDF)

https://earthscope-space-apps.netlify.app/EARTHSCOPE-demo.pdf

**Project** (live web app — no login)

https://earthscope-space-apps.netlify.app

Source code: https://github.com/basharmukbel1/earthscope

## Project Details

**What it does**
EARTHSCOPE is a web app that lets students act as Earth-system trend detectives. You ask a question about a place and a variable, and EARTHSCOPE answers three things with real NASA data: what changed, by how much, and whether the change is statistically real or could be natural year-to-year variation.

**How it works — the four challenge steps**
1. Identify variables: a catalog of 19 Earth-science variables (air and land temperature, precipitation, soil moisture, evapotranspiration, water vapor, aerosol optical depth, ozone, snow, sea surface temperature, sea ice, NDVI and more), each with a plain-language definition, why it matters, and the NASA mission or model behind it.
2. Acquire data for a region: choose a country, named region, drawn box or coordinates. EARTHSCOPE samples every NASA POWER grid cell (0.5° × 0.625°) inside the real country border (large countries are sampled systematically), weights cells by area and builds a monthly regional mean for 1981–2025. Requests are cached on the device; the guided demos use bundled real-data snapshots so they open instantly.
3. Time series: annual values with the trend line and its 95% confidence band, the full monthly record with a 12-month moving average, deseasonalised anomalies, and a seasonal-cycle comparison of the first and last decade.
4. Rate of change and significance: the headline uses the Mann-Kendall test with Sen's slope (Gilbert 95% CI) on annual values; it is checked against OLS regression on monthly anomalies with an AR(1) effective-sample-size correction (Santer et al. 2000), the Hamed–Rao modified test and the Seasonal Kendall test. EARTHSCOPE also estimates how many years of data would be needed to detect the trend (Weatherhead et al. 1998).

**Features**
- One plain sentence for every result, built only from the computed numbers (e.g. "Cameroon is warming by about 0.36 °C every decade — a statistically significant trend (p < 0.001)").
- Regional comparison: a forest plot of trends with confidence intervals; "opposite trends" are only claimed when both regions are significant with opposite signs.
- Earth Explorer: a 3D globe that unfolds into a map, with 640 trend tests per variable (Benjamini–Hochberg FDR q = 0.05) and NASA GIBS imagery layers.
- Relationship Lab: anomaly overlay, scatter plot, lagged correlation (±12 months, autocorrelation-adjusted) and a correlation matrix, with a clear "correlation is not causation" warning.
- AI Scientist: a deterministic, rule-based analyst that answers only from computed results, states false premises first, refuses to answer a question about one variable with another variable's data, and labels every explanation as an untested hypothesis.
- Scientific report export (print/PDF, CSV, JSON) with methods, figures, uncertainty, limitations and references; CSV import for Giovanni, AppEEARS, Hydrology Time Series, NOAA CDO and KNMI exports.

**Benefits and impact**
EARTHSCOPE shows students how scientists decide whether a change is real. It never hides a non-significant result: it explains why a trend can be real but not yet detectable, and that statistical significance is not the same as practical importance. Example: Jordan's yearly rainfall fell by about 1.90 mm/yr per decade (1981–2025), but p = 0.63 — the data are consistent with no trend, and about 94 years of data would be needed to detect a trend that small.

**Tools and technology**
React 19, TypeScript, Vite, Tailwind CSS, Motion, three.js (custom globe-to-map shader), d3 (geo, scales), topojson / world-atlas, zustand, Vitest (697 automated tests; the statistics engine is cross-checked against SciPy and pymannkendall), Playwright with Microsoft Edge for visual checks. Hosted on Netlify; no backend required — NASA POWER and GIBS are called directly from the browser.

**Creativity**
A single 3D Earth that unfolds into a flat map, a question box that understands plain English, guided demos that open instantly, and an AI assistant designed to say "the data don't show that" instead of inventing an answer.

**What we considered**
Scientific honesty: only real data (every series shows its source and retrieval date; no fabricated numbers), one significance policy everywhere (p < 0.05 for one series, FDR q < 0.05 for maps), significance never shown by colour alone (▲ ▼ ◇ glyphs, labels and line styles), accessibility (keyboard use, contrast), and mobile layouts. Limitations: regional means are grid-cell samples of a reanalysis (MERRA-2), not full-resolution satellite averages; trends are linear; Earthdata-login products (IMERG, GLDAS, GRACE) are analysed through CSV import.

**AI use**
AI coding assistants (Claude) helped write the code, documentation and the demo slides. The in-app AI Scientist is rule-based (not a language model) and labels which engine answered. Screenshots in the demo are real captures of the app.

## Use of Super Intelligence (SI)

Select the options for **code** and **text / documentation** (whatever the form calls them). We did not use SI to generate images, video or audio.

## NASA Data (Link Text → Link URL)

| Link Text | Link URL |
|---|---|
| NASA POWER API (MERRA-2 / CERES monthly data) | https://power.larc.nasa.gov/ |
| NASA GIBS — Global Imagery Browse Services | https://nasa-gibs.github.io/gibs-api-docs/ |
| MERRA-2 reanalysis (NASA GMAO) | https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/ |
| NASA GISTEMP v4 | https://data.giss.nasa.gov/gistemp/ |
| MODIS NDVI (MOD13Q1) via ORNL DAAC | https://modis.ornl.gov/ |
| NSIDC Sea Ice Index (G02135) | https://nsidc.org/data/g02135 |
| Giovanni (NASA GES DISC) | https://giovanni.gsfc.nasa.gov/ |
| Hydrology Time Series (NASA GES DISC) | https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series |
| AppEEARS (NASA LP DAAC) | https://appeears.earthdatacloud.nasa.gov/ |
| SeaWiFS chlorophyll time-series analysis (NASA NTRS) | https://ntrs.nasa.gov/api/citations/20090042747/downloads/20090042747.pdf |

## Space Agency Partner & Other Data (Link Text → Link URL)

| Link Text | Link URL |
|---|---|
| CSA — RADARSAT Constellation Mission data | https://donnees-data.asc-csa.gc.ca/en/dataset/rcm |
| CSA — SWOT mission | https://www.asc-csa.gc.ca/eng/satellites/swot/ |
| CSA — Monitoring and protecting our ecosystems from space | https://www.asc-csa.gc.ca/eng/satellites/everyday-lives/monitoring-and-protecting-our-ecosystems-from-space.asp |
| CSA — Synthetic Aperture Radar Python tutorial | https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial |
| Geo.ca | http://geo.ca/ |
| NOAA Climate Data Online | https://www.ncei.noaa.gov/cdo-web/ |
| KNMI Climate Explorer | https://climexp.knmi.nl/ |
| Natural Earth country boundaries (via world-atlas) | https://github.com/topojson/world-atlas |
| Statistical test methods to detect trends (article) | https://medium.com/@snp.kriss/statistical-test-methods-to-detect-trends-in-time-series-data-b361a0ec530b |
| Statsig — guide to statistical significance | https://www.statsig.com/perspectives/a-comprehensive-guide-to-statistical-significance |
| Open-source libraries used (package.json) | https://github.com/basharmukbel1/earthscope/blob/main/package.json |
| Fonts: Space Grotesk, Inter, JetBrains Mono (SIL Open Font License) | https://fonts.google.com/ |

## Project Submission Verification

Tick both boxes (terms, and original work), then press **Save Progress**, then **Submit for Judging** before 23:59 local time.
