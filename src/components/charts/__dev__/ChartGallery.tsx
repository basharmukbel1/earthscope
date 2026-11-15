/* ==========================================================================
   CHART QA GALLERY — renders every chart in the kit with SYNTHETIC data.
   Every value on this page comes from a seeded pseudo-random generator; none
   of it is an observation. Mount at a dev-only route.
   ========================================================================== */

import { useMemo, useState } from "react";
import type { Point } from "../../../types/domain";
import {
  AnomalyChart,
  ChartFrame,
  CorrelationMatrix,
  ForestPlot,
  LagChart,
  ScatterChart,
  SeasonalCycleChart,
  Sparkline,
  TimeSeriesChart,
  formatDecimalYear,
  formatP,
  formatPerDecade,
  formatValue,
  type ForestRow,
  type LagRow,
  type SeasonalPeriod,
  type TrendOverlay,
} from "../index";
import "./gallery.css";

/* ------------------------------------------------------------ seeded RNG */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number) {
  const u = mulberry32(seed);
  const normal = () => {
    let a = 0;
    let b = 0;
    while (a === 0) a = u();
    while (b === 0) b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  return { u, normal };
}

/* ------------------------------------------------------- tiny statistics */

/** Two-sided p from a z / large-df t statistic (Abramowitz–Stegun erf). */
function pFromZ(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return Math.max(1e-12, 1 - erf);
}

function ols(ts: number[], vs: number[], ar1Inflate = 1) {
  const n = ts.length;
  const mt = ts.reduce((a, b) => a + b, 0) / n;
  const mv = vs.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (ts[i] - mt) ** 2;
    sxy += (ts[i] - mt) * (vs[i] - mv);
  }
  const slope = sxy / sxx;
  const intercept = mv - slope * mt;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (vs[i] - (intercept + slope * ts[i])) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx) * ar1Inflate;
  const crit = n > 60 ? 1.96 : 2.02;
  return { slope, intercept, se, ciLow: slope - crit * se, ciHigh: slope + crit * se, p: pFromZ(slope / se), meanT: mt };
}

function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  const r = sab / Math.sqrt(saa * sbb);
  return { r, p: pRfromN(r, n) };
}

function pRfromN(r: number, n: number) {
  const t = r * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
  return pFromZ(t);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function movingAverage(points: Point[], window: number, minValid: number): Point[] {
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - half), Math.min(points.length, i + half + (window % 2)));
    const vals = slice.map((s) => s.v).filter((v): v is number => v != null);
    return { ...p, v: vals.length >= minValid ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
}

/* --------------------------------------------------------- sample data */

function buildSamples() {
  const rng = makeRng(2026);
  const START = 1981;
  const END = 2025;

  // Monthly temperature-like anomaly with AR(1) noise, a warming drift and a gap.
  const monthly: Point[] = [];
  let ar = 0;
  for (let y = START; y <= END; y++)
    for (let m = 0; m < 12; m++) {
      const t = y + (m + 0.5) / 12;
      ar = 0.55 * ar + rng.normal() * 0.28;
      let v: number | null = -0.42 + 0.024 * (t - START) + ar + 0.12 * Math.sin((t - START) / 3.6);
      if ((y === 1994 && m >= 2 && m <= 6) || rng.u() < 0.008) v = null;
      monthly.push({ t, date: `${y}-${pad2(m + 1)}`, v });
    }
  const obs = monthly.filter((p) => p.v != null) as { t: number; v: number; date: string }[];
  const fitM = ols(obs.map((p) => p.t), obs.map((p) => p.v), 1.85);
  const trendMonthly: TrendOverlay = {
    slopePerYear: fitM.slope,
    intercept: fitM.intercept,
    ciLow: fitM.ciLow,
    ciHigh: fitM.ciHigh,
    significant: fitM.p < 0.05,
    direction: fitM.slope > 0 ? "increasing" : "decreasing",
    label: `${formatPerDecade(fitM.slope, "°C")} · ${formatP(fitM.p)}`,
  };
  const ma12 = movingAverage(monthly, 12, 9);

  // Annual precipitation totals: weak, non-significant decline.
  const annual: Point[] = [];
  for (let y = START; y <= END; y++) {
    const v = 640 - 0.9 * (y - START) + rng.normal() * 62 + 30 * Math.sin((y - START) / 2.7);
    annual.push({ t: y + 0.5, date: String(y), v: y === 2003 ? null : v });
  }
  const aObs = annual.filter((p) => p.v != null) as { t: number; v: number }[];
  const fitA = ols(aObs.map((p) => p.t), aObs.map((p) => p.v));
  const trendAnnual: TrendOverlay = {
    slopePerYear: fitA.slope,
    intercept: fitA.intercept,
    ciLow: fitA.ciLow,
    ciHigh: fitA.ciHigh,
    significant: fitA.p < 0.05,
    direction: fitA.p < 0.05 ? (fitA.slope > 0 ? "increasing" : "decreasing") : fitA.slope > 0 ? "increasing" : "decreasing",
    label: `${formatPerDecade(fitA.slope, "mm", 0)} · ${formatP(fitA.p)}`,
  };

  // Three peer regions (vegetation index) + a dimmed context mean.
  const regionSeries = ["Region A", "Region B", "Region C"].map((name, k) => {
    const pts: Point[] = [];
    let e = 0;
    for (let y = 2001; y <= 2025; y++) {
      e = 0.5 * e + rng.normal() * 0.012;
      pts.push({ t: y + 0.5, date: String(y), v: 0.42 + k * 0.09 + (k === 1 ? -0.0028 : 0.0021 + k * 0.0006) * (y - 2001) + e });
    }
    return { id: `r${k}`, label: name, points: pts };
  });
  const contextMean: Point[] = regionSeries[0].points.map((p, i) => ({
    ...p,
    v: regionSeries.reduce((s, r) => s + (r.points[i].v as number), 0) / regionSeries.length,
  }));

  // Annual anomalies (bars) from the monthly series.
  const annualAnom: Point[] = [];
  for (let y = START; y <= END; y++) {
    const vals = monthly.filter((p) => Math.floor(p.t) === y && p.v != null).map((p) => p.v as number);
    annualAnom.push({ t: y + 0.5, date: String(y), v: vals.length >= 8 ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
  }
  const annualAnomMa = movingAverage(annualAnom, 5, 3);

  // Seasonal climatologies.
  const clim = (shift: number, amp: number, base: number): (number | null)[] =>
    Array.from({ length: 12 }, (_, m) =>
      Math.max(0.5, base + amp * Math.max(0, Math.cos(((m - 7 - shift) / 12) * 2 * Math.PI)) ** 1.6 + rng.normal() * 2.5),
    );
  const early = clim(0, 118, 6);
  const late = clim(0.55, 104, 4);
  const periods: SeasonalPeriod[] = [
    { id: "p1", label: "1981–1990", values: early },
    {
      id: "p2",
      label: "2016–2025",
      values: late,
      low: late.map((v) => (v == null ? null : Math.max(0, v - 9 - v * 0.18))),
      high: late.map((v) => (v == null ? null : v + 9 + v * 0.18)),
    },
  ];
  const periods3: SeasonalPeriod[] = [
    { id: "q1", label: "1981–1995", values: Array.from({ length: 12 }, (_, m) => 8 + 12 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + rng.normal() * 0.3) },
    { id: "q2", label: "1996–2010", values: Array.from({ length: 12 }, (_, m) => 8.5 + 12.2 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + rng.normal() * 0.3) },
    { id: "q3", label: "2011–2025", values: Array.from({ length: 12 }, (_, m) => 9.3 + 12.5 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + rng.normal() * 0.3) },
  ];

  // Scatter: rainfall vs vegetation response.
  const scatter = Array.from({ length: 216 }, (_, i) => {
    const x = Math.max(4, 40 + rng.normal() * 22 + (i % 12 < 4 ? 18 : 0));
    const y = 0.18 + 0.0058 * x + rng.normal() * 0.075;
    const yr = 2008 + Math.floor(i / 12);
    return { x, y, label: `${formatDecimalYear(yr + ((i % 12) + 0.5) / 12)}` };
  });
  const sFit = ols(scatter.map((d) => d.x), scatter.map((d) => d.y));
  const sR = pearson(scatter.map((d) => d.x), scatter.map((d) => d.y));

  // Correlation matrix from latent factors.
  const labels = ["Air temp.", "Precip.", "Soil moist.", "NDVI", "Aerosol OD"];
  const N = 45;
  const latent = Array.from({ length: N }, () => [rng.normal(), rng.normal()]);
  const loadings = [
    [0.9, -0.1],
    [-0.35, 0.85],
    [-0.25, 0.75],
    [-0.1, 0.7],
    [0.3, 0.05],
  ];
  const vars = loadings.map(([a, b]) => latent.map(([f1, f2]) => a * f1 + b * f2 + rng.normal() * 0.45));
  const rM = labels.map((_, i) => labels.map((__, j) => (i === j ? 1 : pearson(vars[i], vars[j]).r)));
  const pM = labels.map((_, i) => labels.map((__, j) => (i === j ? 0 : pearson(vars[i], vars[j]).p)));

  // Lagged correlation, peak near +2 months.
  const lagRows: LagRow[] = Array.from({ length: 25 }, (_, k) => {
    const lag = k - 12;
    const r = 0.56 * Math.exp(-((lag - 2) ** 2) / 14) - 0.12 * Math.exp(-((lag + 8) ** 2) / 10) + rng.normal() * 0.04;
    const p = pRfromN(r, 44);
    return { lag, r, p, significant: p < 0.05 };
  });

  // Regional trend comparison (forest plot) — generic region names.
  const forest: ForestRow[] = [
    { id: "a", label: "Region A", sublabel: "Semi-arid belt · Sen's slope", estimate: 0.31, ciLow: 0.14, ciHigh: 0.47, significant: true, direction: "increasing", unit: "mm/day per decade" },
    { id: "b", label: "Region B", sublabel: "Winter-rain coast", estimate: -0.22, ciLow: -0.36, ciHigh: -0.07, significant: true, direction: "decreasing", unit: "mm/day per decade" },
    { id: "c", label: "Region C", sublabel: "Tropical basin", estimate: 0.06, ciLow: -0.11, ciHigh: 0.24, significant: false, direction: "no-trend", unit: "mm/day per decade" },
    { id: "d", label: "Region D", sublabel: "Continental interior", estimate: -0.09, ciLow: -0.24, ciHigh: 0.05, significant: false, direction: "decreasing", unit: "mm/day per decade" },
    { id: "e", label: "Region E", sublabel: "Monsoon margin", estimate: 0.18, ciLow: 0.03, ciHigh: 0.33, significant: true, direction: "increasing", unit: "mm/day per decade" },
    { id: "f", label: "Region F", sublabel: "Temperate maritime", estimate: 0.02, ciLow: -0.07, ciHigh: 0.12, significant: false, direction: "no-trend", unit: "mm/day per decade" },
  ];

  // Sparkline tiles.
  const tiles = [
    { label: "Air temperature", value: "+0.24", unit: "°C/decade", trend: "increasing" as const, sig: true, pts: annualAnom.map((p) => p.v) },
    { label: "Precipitation", value: "−9", unit: "mm/decade", trend: "decreasing" as const, sig: false, pts: annual.map((p) => p.v) },
    { label: "Vegetation index", value: "+0.021", unit: "per decade", trend: "increasing" as const, sig: true, pts: regionSeries[2].points.map((p) => p.v) },
    { label: "Snow cover", value: "−1.8", unit: "%/decade", trend: "decreasing" as const, sig: true, pts: Array.from({ length: 30 }, (_, i) => 40 - i * 0.18 + rng.normal() * 1.4) },
  ];

  return {
    monthly,
    ma12,
    trendMonthly,
    annual,
    trendAnnual,
    regionSeries,
    contextMean,
    annualAnom,
    annualAnomMa,
    periods,
    periods3,
    scatter,
    scatterFit: { slope: sFit.slope, intercept: sFit.intercept, r: sR.r, p: sR.p, n: scatter.length },
    labels,
    rM,
    pM,
    lagRows,
    forest,
    tiles,
  };
}

/* -------------------------------------------------------------- gallery */

const PROVENANCE = "Synthetic sample · seeded RNG (mulberry32, seed 2026) · not an observation";

export default function ChartGallery() {
  const d = useMemo(buildSamples, []);
  const [hoverT, setHoverT] = useState<number | null>(null);

  return (
    <main className="g-page">
      <header className="g-head">
        <div className="g-kicker">
          <span className="g-dot" /> EARTHSCOPE · Chart kit · QA gallery
        </div>
        <h1 className="g-title">SYNTHETIC SAMPLE — chart QA only</h1>
        <p className="g-lede">
          Every number on this page is produced by a seeded pseudo-random generator to exercise the charts. None of it is NASA data or
          an observation of any real place. Region names are placeholders.
        </p>
        <div className="g-banner" role="note">
          <span className="g-banner-tag">Synthetic</span>
          Hover or focus any chart (Tab, then ← / →, Esc) to test the crosshair, tooltip and screen-reader readout.
        </div>
      </header>

      <section className="g-grid">
        <ChartFrame
          className="g-span-12"
          eyebrow="Fig. 1 · Time series · synthetic"
          title="Monthly temperature anomaly with fitted trend"
          subtitle="Raw monthly values (ice), 12-month running mean (white), OLS trend with a 95% confidence fan on the slope. Hatched band = missing months."
          unit="°C"
          caption={
            <>
              {PROVENANCE}. Crosshair readout:{" "}
              <span className="num" style={{ color: "var(--color-ink-2)" }}>
                {hoverT == null ? "—" : formatDecimalYear(hoverT)}
              </span>
            </>
          }
        >
          <TimeSeriesChart
            series={[{ id: "anom", label: "Monthly anomaly", points: d.monthly }]}
            movingAverage={d.ma12}
            movingAverageLabel="12-month running mean"
            trend={d.trendMonthly}
            markers={[{ t: 2001.0, label: "Instrument change" }]}
            yLabel="Anomaly vs 1991–2020"
            unit="°C"
            decimals={2}
            height={340}
            zeroLine
            showMissing
            onHoverDate={setHoverT}
            ariaLabel="Synthetic monthly temperature anomaly, 1981 to 2025, with a significant increasing linear trend"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 2 · Annual totals · synthetic"
          title="Annual precipitation — trend not significant"
          subtitle="Dashed line and hollow end-marker: the fitted decline cannot be distinguished from zero."
          unit="mm"
          caption={PROVENANCE}
        >
          <TimeSeriesChart
            series={[{ id: "pr", label: "Annual total", points: d.annual, variant: "bars" }]}
            trend={d.trendAnnual}
            yLabel="Precipitation"
            unit="mm"
            decimals={0}
            height={280}
            showMissing
            ariaLabel="Synthetic annual precipitation totals with a non-significant decreasing trend"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 3 · Comparison · synthetic"
          title="Vegetation index in three regions"
          subtitle="Peer series take the validated categorical slots; the all-region mean is drawn as quiet context."
          unit="NDVI"
          caption={PROVENANCE}
        >
          <TimeSeriesChart
            series={[
              { id: "ctx", label: "All-region mean", points: d.contextMean, dimmed: true, color: "var(--color-ink-3)" },
              ...d.regionSeries.map((s, i) => ({ ...s, variant: i === 0 ? ("area" as const) : ("line" as const) })),
            ]}
            yLabel="NDVI"
            unit="index"
            decimals={3}
            height={280}
            ariaLabel="Synthetic vegetation index for three placeholder regions, 2001 to 2025"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-7"
          eyebrow="Fig. 4 · Anomalies · synthetic"
          title="Monthly anomalies around the baseline"
          subtitle="Warm clay above, cool ice below — a neutral pair, deliberately not the trend colors."
          unit="°C"
          caption={PROVENANCE}
        >
          <AnomalyChart
            points={d.monthly}
            movingAverage={d.ma12}
            movingAverageLabel="12-month running mean"
            yLabel="Anomaly"
            unit="°C"
            baselineLabel="1991–2020 mean"
            showMissing
            height={270}
            ariaLabel="Synthetic monthly temperature anomalies relative to a 1991 to 2020 baseline"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-5"
          eyebrow="Fig. 5 · Annual anomalies · synthetic"
          title="Annual mean anomaly"
          subtitle="5-year running mean overlay."
          unit="°C"
          caption={PROVENANCE}
        >
          <AnomalyChart
            points={d.annualAnom}
            movingAverage={d.annualAnomMa}
            movingAverageLabel="5-year mean"
            yLabel="Anomaly"
            unit="°C"
            height={270}
            ariaLabel="Synthetic annual temperature anomalies with a five-year running mean"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-7"
          eyebrow="Fig. 6 · Seasonal cycle · synthetic"
          title="Has the rainy season shifted?"
          subtitle="Monthly climatology for two decades. Shading shows where the recent decade sits above (clay) or below (ice) the early one; band = ±1 SD."
          unit="mm/month"
          caption={PROVENANCE}
        >
          <SeasonalCycleChart
            periods={d.periods}
            yLabel="Precipitation"
            unit="mm/month"
            decimals={0}
            showDifference
            spreadLabel="±1 SD across years (2016–2025)"
            height={290}
            ariaLabel="Synthetic monthly precipitation climatology, 1981 to 1990 versus 2016 to 2025"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-5"
          eyebrow="Fig. 7 · Seasonal cycle · 3 periods"
          title="Ordinal periods step from slate to ice"
          unit="°C"
          caption={PROVENANCE}
        >
          <SeasonalCycleChart
            periods={d.periods3}
            yLabel="Temperature"
            unit="°C"
            height={290}
            ariaLabel="Synthetic monthly temperature climatology for three fifteen-year periods"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 8 · Relationship · synthetic"
          title="Rainfall vs vegetation response"
          subtitle="Point opacity adapts to local density; fit annotation sits in the emptiest corner."
          caption={PROVENANCE}
        >
          <ScatterChart
            points={d.scatter}
            fit={d.scatterFit}
            xLabel="Precipitation"
            xUnit="mm/month"
            yLabel="NDVI"
            yUnit="index"
            xDecimals={0}
            yDecimals={3}
            height={330}
            ariaLabel="Synthetic scatter of monthly precipitation against vegetation index"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 9 · Correlation · synthetic"
          title="Correlation matrix (annual values, n = 45)"
          subtitle="Diverging clay ↔ ice around zero. Bold value + dot = significant at α = 0.05."
          caption={PROVENANCE}
        >
          <CorrelationMatrix labels={d.labels} r={d.rM} p={d.pM} alpha={0.05} ariaLabel="Synthetic correlation matrix of five placeholder variables" />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 10 · Lagged correlation · synthetic"
          title="Does rainfall lead vegetation?"
          subtitle="Filled bars are significant; outlined bars are not."
          caption={PROVENANCE}
        >
          <LagChart
            rows={d.lagRows}
            leadLabels={{ negative: "Vegetation leads", positive: "Rainfall leads" }}
            note={
              <>
                A positive lag correlates this month&apos;s vegetation with rainfall <strong>k months earlier</strong>. Correlation at a lag is
                consistent with — but does not prove — a delayed response.
              </>
            }
            ariaLabel="Synthetic lagged correlation between rainfall and vegetation index, lags minus 12 to plus 12 months"
          />
        </ChartFrame>

        <ChartFrame
          className="g-span-6"
          eyebrow="Fig. 11 · Regional comparison · synthetic"
          title="Trend by region with 95% intervals"
          subtitle="Color = direction (▲ rise / ▼ fall); hollow marker + dashed whisker = not significant."
          unit="mm/day / decade"
          caption={PROVENANCE}
        >
          <ForestPlot rows={d.forest} xLabel="Precipitation trend" ariaLabel="Synthetic precipitation trend estimates for six placeholder regions" />
        </ChartFrame>

        <div className="g-span-12 g-tiles">
          {d.tiles.map((t) => (
            <div key={t.label} className="g-tile">
              <div className="g-tile-label">{t.label}</div>
              <div className="g-tile-row">
                <div>
                  <div className="g-tile-value">
                    <span className="g-tile-glyph" style={{ color: t.sig ? (t.trend === "increasing" ? "var(--color-rise)" : "var(--color-fall)") : "var(--color-flat)" }}>
                      {t.trend === "increasing" ? "▲" : "▼"}
                    </span>
                    {t.value}
                  </div>
                  <div className="g-tile-unit">
                    {t.unit} · {t.sig ? "significant" : "not significant"}
                  </div>
                </div>
                <Sparkline points={t.pts} trend={t.trend} significant={t.sig} width={112} height={34} ariaLabel={`${t.label} synthetic sparkline`} />
              </div>
            </div>
          ))}
        </div>

        <ChartFrame className="g-span-4" eyebrow="State · loading" title="Fetching NASA POWER series…" status="loading" stateHeight={200} />
        <ChartFrame className="g-span-4" eyebrow="State · empty" title="No observations" unit="°C" status="empty" stateHeight={200} emptyMessage="This region has no valid observations between 1981 and 1985. Try widening the date range." />
        <ChartFrame
          className="g-span-4"
          eyebrow="State · error"
          title="Request failed"
          status="error"
          stateHeight={200}
          errorMessage="The data service did not respond (synthetic error for QA)."
          onRetry={() => undefined}
        />
      </section>

      <footer className="g-foot">
        Values formatted with {formatValue(-0.5, "°C", 1)} style minus signs and tabular mono numerals. {PROVENANCE}.
      </footer>
    </main>
  );
}
