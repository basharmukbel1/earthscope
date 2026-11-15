import { useEffect, useMemo, useState } from "react";
import { Dices, ExternalLink, Scale } from "lucide-react";
import type { Point, TimeSeries } from "@/types/domain";
import { useInvestigation } from "@/store/investigation";
import { useEntries, isReady, type ReadyEntry } from "@/hooks/useEntries";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { NoInvestigation } from "@/components/scientific/NoInvestigation";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { AnomalyChart } from "@/components/charts/AnomalyChart";
import { SeasonalCycleChart } from "@/components/charts/SeasonalCycleChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Panel } from "@/components/ui/Panel";
import { Badge, TrendBadge } from "@/components/ui/Badge";
import { Segmented, Stat } from "@/components/ui/Controls";
import { Button } from "@/components/ui/Button";
import { analyzeSeries, compareMethods, monthlyClimatology, movingAverage, simulateMonthlySeries, std, type MethodComparisonRow } from "@/stats";
import { annualTrendOverlay, pctPerDecade, resultAnnualUnit } from "@/utils/trend";
import { fmt, fmtP, fmtPct, fmtSigned } from "@/utils/format";
import { RESOURCES } from "@/data/resources";
import { plainSentence } from "@/utils/plainSentence";
import { cn } from "@/utils/cn";

type MethodTab = "mk-sen" | "ols-ar1" | "seasonal";

const EXPLAINERS: Record<MethodTab, { title: string; what: string; how: string[]; assumptions: string; when: string }> = {
  "mk-sen": {
    title: "Mann-Kendall test + Sen's slope",
    what: "A non-parametric test for a monotonic (consistently rising or falling) trend, paired with a robust estimate of its rate.",
    how: [
      "Compare every pair of years: count +1 when the later value is larger, −1 when smaller. The sum is S.",
      "If there were no trend, S would be close to 0. Its variance (corrected for tied values) gives a z-score and a p-value.",
      "Sen's slope is the median of the slopes between all pairs of years; Gilbert's method gives its 95% confidence interval.",
    ],
    assumptions: "Values are independent from year to year (annual values usually are); no assumption of normality or of a straight line.",
    when: "The default for environmental data: robust to outliers, skewed data such as rainfall, and missing years.",
  },
  "ols-ar1": {
    title: "Linear regression with an autocorrelation correction",
    what: "Fits the best straight line through the deseasonalised monthly anomalies and tests its slope with a t-test.",
    how: [
      "Remove the seasonal cycle: subtract each calendar month's long-term average.",
      "Fit y = a + b·t by least squares; b is the trend per year.",
      "Neighbouring months are correlated, so the effective sample size is reduced: n_eff = n(1−r₁)/(1+r₁) (Santer et al. 2000). The t-test and CI use n_eff.",
    ],
    assumptions: "Residuals are roughly normal with lag-1 (AR1) autocorrelation; the trend is linear.",
    when: "Good for smooth, approximately normal variables like temperature; gives R² (share of variance explained by the trend).",
  },
  seasonal: {
    title: "Seasonal Kendall test",
    what: "Mann-Kendall applied within each calendar month, then combined (Hirsch et al. 1982).",
    how: [
      "Januaries are compared only with Januaries, Februaries with Februaries, and so on.",
      "The 12 S statistics and their variances are summed into one test.",
      "The seasonal Sen slope is the median of all within-month pairwise slopes.",
    ],
    assumptions: "Months are treated as independent of each other (inter-season covariance ignored), which can understate uncertainty for slowly varying variables.",
    when: "Monthly data with a strong seasonal cycle where you want to use every month without averaging to years.",
  },
};

export default function TrendLabPage() {
  const entries = useEntries().filter(isReady);
  const status = useInvestigation((s) => s.status);
  const setPrimary = useInvestigation((s) => s.setPrimary);
  const primary = useInvestigation((s) => s.primary);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<MethodTab>(primary);
  useEffect(() => {
    if (!entries.find((e) => e.series.id === activeId)) setActiveId(entries[0]?.series.id ?? null);
  }, [entries, activeId]);
  const active = entries.find((e) => e.series.id === activeId) ?? entries[0];

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <div className="container-x py-8">
        <header className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="label-mono mb-2 text-[var(--color-cyan)]">Trend Lab</div>
            <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.8rem)] leading-tight tracking-[-0.03em]">How sure are we that it's changing?</h1>
            <p className="mt-2 max-w-[62ch] text-sm text-[var(--color-ink-3)]">
              Switch between methods, see how each one reaches its verdict, and learn the difference between a statistically significant change and an important one.
            </p>
          </div>
          {entries.length > 1 && (
            <select
              aria-label="Series"
              value={active?.series.id}
              onChange={(e) => setActiveId(e.target.value)}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 text-sm"
            >
              {entries.map((e) => (
                <option key={e.series.id} value={e.series.id}>
                  {e.variable.name} · {e.region?.name ?? e.series.regionId}
                </option>
              ))}
            </select>
          )}
        </header>

        {active ? (
          <ActiveLab entry={active} tab={tab} setTab={(t) => { setTab(t); if (t !== "seasonal") setPrimary(t); }} />
        ) : (
          status !== "loading" && (
            <div className="panel mb-10">
              <NoInvestigation title="No series to analyse yet" body="Run an investigation to analyse real NASA data here — or experiment with the significance simulator below." />
            </div>
          )
        )}

        <Simulator />
      </div>
    </div>
  );
}

function ActiveLab({ entry, tab, setTab }: { entry: ReadyEntry; tab: MethodTab; setTab: (t: MethodTab) => void }) {
  const r = entry.result;
  const v = entry.variable;
  const rows = useMemo(() => compareMethods(r), [r]);
  const annualUnit = resultAnnualUnit(r, v);
  const s = r.summary;
  const ma = useMemo(() => movingAverage(entry.series.points, 12, true), [entry.series.points]);
  const ma5 = useMemo(() => movingAverage(r.annual, 5, true), [r.annual]);

  const seasonal = useMemo(() => {
    const pts = entry.series.points;
    const yrs = pts.filter((p) => p.v !== null).map((p) => +p.date.slice(0, 4));
    if (!yrs.length) return null;
    const y0 = Math.min(...yrs),
      y1 = Math.max(...yrs);
    if (y1 - y0 < 15) return null;
    const span = 10;
    const slice = (a: number, b: number): Point[] => pts.filter((p) => +p.date.slice(0, 4) >= a && +p.date.slice(0, 4) <= b);
    const clim = (ps: Point[]) => monthlyClimatology(ps).map((x) => (Number.isFinite(x) ? x : null));
    return [
      { id: "early", label: `${y0}–${y0 + span - 1}`, values: clim(slice(y0, y0 + span - 1)), color: "var(--chart-series-3)" },
      { id: "late", label: `${y1 - span + 1}–${y1}`, values: clim(slice(y1 - span + 1, y1)), color: "var(--color-cyan)" },
    ];
  }, [entry.series.points]);

  const tabRow = (id: MethodComparisonRow["id"]) => rows.find((x) => x.id === id);
  const shownRow = tab === "seasonal" ? tabRow("seasonal-kendall") : tab === "ols-ar1" ? tabRow("ols-ar1") : tabRow("mk-sen");
  const exp = EXPLAINERS[tab];

  return (
    <div className="space-y-6">
      <p className="text-pretty text-sm leading-relaxed text-[var(--color-ink)]">{plainSentence(r, v, entry.region?.name)}</p>
      {/* Statistical result cards */}
      <div className="grid gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-[var(--color-abyss)] p-5">
          <div className="label-mono mb-2">Trend direction</div>
          <TrendBadge direction={s.direction} significant={s.significant} />
          <div className="mt-2 text-xs text-[var(--color-ink-3)]">{v.name} · {entry.region?.name}</div>
        </div>
        <Stat className="bg-[var(--color-abyss)] p-5" label="Sen's slope" value={fmtSigned(r.sen.slope * 10, v.decimals)} unit={`${annualUnit}/dec`} sub={`95% CI ${fmtSigned(r.sen.ciLow * 10, v.decimals)} … ${fmtSigned(r.sen.ciHigh * 10, v.decimals)}`} />
        <Stat className="bg-[var(--color-abyss)] p-5" label="Mann-Kendall p" value={fmtP(r.mk.p)} sub={r.mk.p < s.alpha ? `significant at α = ${s.alpha}` : `not significant at α = ${s.alpha}`} />
        <Stat className="bg-[var(--color-abyss)] p-5" label="R² (anomaly regression)" value={fmt(r.ols.r2, 3)} sub="share of variance explained by a straight line" />
        <Stat className="bg-[var(--color-abyss)] p-5" label="Sample size" value={String(r.annual.filter((p) => p.v !== null).length)} unit="years" sub={`${r.nMonths} months${r.ols.nEff ? ` · effective n ≈ ${Math.round(r.ols.nEff)}` : ""}`} />
        <Stat className="bg-[var(--color-abyss)] p-5" label="Missing data" value={`${fmt(r.missingPct, 1)}%`} sub={`${r.nMissing} of ${r.nMonths} months`} />
        <Stat className="bg-[var(--color-abyss)] p-5" label="Change over record" value={fmtSigned(s.totalChange, v.decimals)} unit={annualUnit} sub={pctPerDecade(r, v) !== null ? `${fmtPct(pctPerDecade(r, v))} of mean per decade` : undefined} />
        <Stat className="bg-[var(--color-abyss)] p-5" label="Years needed to detect" value={s.yearsToDetect ? `≈ ${Math.round(s.yearsToDetect)}` : "—"} sub={`record: ${r.endYear - r.startYear + 1} years (Weatherhead 1998)`} />
      </div>

      {/* Method switcher + comparison */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <ChartFrame
          eyebrow="Fig. 1 · Historical series + trend"
          title="Annual values, regression line and confidence band"
          subtitle={`${tab === "ols-ar1" ? "OLS" : "Sen's slope"} trend with 95% CI fan · 5-year moving average`}
          unit={annualUnit}
          actions={
            <Segmented
              size="sm"
              ariaLabel="Method"
              value={tab}
              onChange={setTab}
              options={[
                { value: "mk-sen", label: "MK + Sen" },
                { value: "ols-ar1", label: "OLS · AR1" },
                { value: "seasonal", label: "Seasonal" },
              ]}
            />
          }
          caption={entry.series.provenance.source}
        >
          <TimeSeriesChart
            height={340}
            series={[{ id: "annual", label: `Annual ${v.annualAgg === "sum" ? "total" : "mean"}`, points: r.annual, variant: "dots" }]}
            trend={annualTrendOverlay(r, tab === "ols-ar1" ? "OLS trend" : "Sen's slope")}
            movingAverage={ma5}
            movingAverageLabel="5-year moving average"
            yLabel={v.name}
            unit={annualUnit}
            decimals={v.decimals}
            showMissing
            ariaLabel={`Annual ${v.name} with trend line and confidence interval`}
          />
        </ChartFrame>

        <Panel eyebrow="Method comparison" title="Do the methods agree?">
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="label-mono border-b border-[var(--color-line)] text-[10px]">
                  <th className="px-1 py-2 font-normal">Method</th>
                  <th className="px-1 py-2 text-right font-normal">/ decade</th>
                  <th className="px-1 py-2 text-right font-normal">95% CI</th>
                  <th className="px-1 py-2 text-right font-normal">p</th>
                  <th className="px-1 py-2 text-right font-normal">Sig.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={cn("border-b border-[var(--color-line)] align-top", row === shownRow && "bg-[var(--color-cyan-soft)]")} title={row.notes}>
                    <td className="px-1 py-2 text-[var(--color-ink-2)]">
                      {row.method}
                      <span className="block text-[10px] text-[var(--color-ink-4)]">{row.data} · n = {row.n}</span>
                    </td>
                    <td className="num px-1 py-2 text-right font-mono">{fmtSigned(row.slopePerDecade, v.decimals)}</td>
                    <td className="num px-1 py-2 text-right font-mono text-[var(--color-ink-3)]">{row.ci ? `${fmtSigned(row.ci[0], v.decimals)}…${fmtSigned(row.ci[1], v.decimals)}` : "—"}</td>
                    <td className="num px-1 py-2 text-right font-mono">{fmtP(row.p)}</td>
                    <td className="px-1 py-2 text-right">{row.significant ? <span className="text-[var(--color-ink)]">●</span> : <span className="text-[var(--color-ink-4)]">○</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-3)]">
            Slopes are per decade in {annualUnit}. ● significant at α = {s.alpha}; ○ not significant. Note how ignoring autocorrelation (“no adjustment”) can make p-values look smaller than they should.
          </p>
        </Panel>
      </div>

      {/* Explainer + significance vs importance */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel eyebrow="How the method works" title={exp.title}>
          <p className="text-sm text-[var(--color-ink-2)]">{exp.what}</p>
          <ol className="mt-4 space-y-2">
            {exp.how.map((h, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm text-[var(--color-ink-2)]">
                <span className="font-mono text-xs text-[var(--color-cyan)]">{i + 1}</span>
                {h}
              </li>
            ))}
          </ol>
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-md border border-[var(--color-line)] p-3">
              <div className="label-mono mb-1">Assumptions</div>
              <p className="text-[var(--color-ink-3)]">{exp.assumptions}</p>
            </div>
            <div className="rounded-md border border-[var(--color-line)] p-3">
              <div className="label-mono mb-1">When to use it</div>
              <p className="text-[var(--color-ink-3)]">{exp.when}</p>
            </div>
          </div>
          {shownRow && (
            <div className="mt-4 rounded-md border border-[rgb(56_225_255/.25)] bg-[rgb(56_225_255/.04)] p-3 text-sm">
              <span className="label-mono text-[var(--color-cyan)]">Applied to your data · </span>
              {fmtSigned(shownRow.slopePerDecade, v.decimals)} {annualUnit} per decade, p = {fmtP(shownRow.p)} → {shownRow.significant ? "significant" : "not significant"}.
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {RESOURCES.filter((x) => /trend|significance|SeaWiFS/i.test(x.title)).map((x) => (
              <a key={x.url} href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-ice)] hover:underline">
                {x.title.length > 52 ? x.title.slice(0, 50) + "…" : x.title} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </Panel>
        <Panel eyebrow="Interpretation" title={<span className="flex items-center gap-2"><Scale className="h-4 w-4 text-[var(--color-ice)]" /> Significant ≠ important</span>}>
          <div className="space-y-3 text-sm text-[var(--color-ink-2)]">
            <p>
              <strong className="font-medium text-[var(--color-ink)]">Statistical significance</strong> asks whether the change is distinguishable from random variability. Here: p = {fmtP(s.p)} → {s.significant ? "yes" : "no"}.
            </p>
            <p>
              <strong className="font-medium text-[var(--color-ink)]">Practical importance</strong> asks whether the size of the change matters: {fmtSigned(s.perDecade, v.decimals)} {annualUnit} per decade
              {pctPerDecade(r, v) !== null ? `, i.e. ${fmtPct(pctPerDecade(r, v))} of the long-term mean each decade` : ""}, or {fmtSigned(s.totalChange, v.decimals)} {annualUnit} over the whole record.
            </p>
            <p className="text-xs text-[var(--color-ink-3)]">
              Long, smooth records can make tiny changes “significant”; short, noisy ones can hide large changes. Whether a change is important depends on the system — e.g. a few % less rain matters a lot in a dry country.
            </p>
          </div>
        </Panel>
      </div>

      {/* Moving averages, anomalies, seasonal */}
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartFrame eyebrow="Fig. 2 · Monthly record" title="Monthly values and 12-month moving average" unit={entry.series.unit}>
          <TimeSeriesChart
            height={280}
            series={[{ id: "m", label: "Monthly", points: entry.series.points, variant: "line", dimmed: true }]}
            movingAverage={ma}
            movingAverageLabel="12-month moving average"
            yLabel={v.name}
            unit={entry.series.unit}
            decimals={v.decimals}
            showMissing
            ariaLabel={`Monthly ${v.name} with moving average`}
          />
        </ChartFrame>
        <ChartFrame eyebrow="Fig. 3 · Anomalies" title="Deseasonalised anomalies" subtitle="Each month minus its long-term average for that calendar month" unit={entry.series.unit}>
          <AnomalyChart
            height={280}
            points={r.anomalies}
            movingAverage={movingAverage(r.anomalies, 12, true)}
            movingAverageLabel="12-month mean"
            yLabel={`${v.name} anomaly`}
            unit={entry.series.unit}
            decimals={v.decimals}
            showMissing
            ariaLabel={`Monthly anomalies of ${v.name}`}
          />
        </ChartFrame>
      </div>
      <ChartFrame
        eyebrow="Fig. 4 · Seasonal patterns"
        title="Has the seasonal cycle shifted?"
        subtitle="Average for each calendar month: first decade vs last decade of the record"
        unit={entry.series.unit}
        status={seasonal ? "ready" : "empty"}
        emptyMessage="Need at least 15 years to compare decades."
        caption={r.seasonalKendall ? `Seasonal Kendall test across all months: p = ${fmtP(r.seasonalKendall.p)} · seasonal Sen slope ${fmtSigned(r.seasonalKendall.slope * 10, v.decimals)} ${entry.series.unit}/decade` : undefined}
      >
        {seasonal && (
          <SeasonalCycleChart height={300} periods={seasonal} yLabel={v.name} unit={entry.series.unit} decimals={v.decimals} showDifference ariaLabel={`Monthly climatology of ${v.name}, first vs last decade`} />
        )}
      </ChartFrame>
    </div>
  );
}

/* ----------------------- Significance simulator -------------------------- */
function Simulator() {
  const [years, setYears] = useState(20);
  const [trend, setTrend] = useState(0.2);
  const [noise, setNoise] = useState(0.6);
  const [ar1, setAr1] = useState(0.3);
  const [seed, setSeed] = useState(7);

  const sim = useMemo(() => {
    const points = simulateMonthlySeries({ startYear: 2000, years, trendPerDecade: trend, noiseSd: noise, seasonalAmplitude: 2, ar1, seed, baseline: 15 });
    const series: TimeSeries = {
      id: "sim",
      variableId: "t2m",
      regionId: "sim",
      label: "Simulated series",
      unit: "units",
      resolution: "monthly",
      points,
      provenance: { source: "EARTHSCOPE simulator (synthetic)", mode: "simulation" },
    };
    try {
      return { series, result: analyzeSeries(series, { alpha: 0.05 }) };
    } catch {
      return { series, result: null };
    }
  }, [years, trend, noise, ar1, seed]);

  const r = sim.result;
  return (
    <section className="mt-14">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl tracking-[-0.02em]">Significance simulator</h2>
        <Badge tone="warn">Simulation · synthetic data</Badge>
      </div>
      <p className="mb-6 max-w-[70ch] text-sm text-[var(--color-ink-3)]">
        Not real observations — a teaching tool. Set a true trend, then see how record length, noise and autocorrelation decide whether the test can detect it. This is why “sometimes all a trend needs to become significant is a longer period of data”.
      </p>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="panel space-y-5 p-5">
          <Slider label="Record length" value={years} min={8} max={60} step={1} unit="years" onChange={setYears} />
          <Slider label="True trend" value={trend} min={-0.6} max={0.6} step={0.05} unit="/decade" onChange={setTrend} />
          <Slider label="Noise (monthly SD)" value={noise} min={0.1} max={2} step={0.05} unit="" onChange={setNoise} />
          <Slider label="Autocorrelation r₁" value={ar1} min={0} max={0.9} step={0.05} unit="" onChange={setAr1} />
          <Button variant="subtle" size="sm" icon={<Dices className="h-4 w-4" />} onClick={() => setSeed((s) => s + 1)}>
            New random noise
          </Button>
          {r && (
            <div className="grid grid-cols-2 gap-3 border-t border-[var(--color-line)] pt-4">
              <Stat label="Estimated trend" value={fmtSigned(r.summary.perDecade, 2)} unit="/dec" />
              <Stat label="p-value" value={fmtP(r.summary.p)} sub={r.summary.significant ? "detected" : "not detected"} />
              <Stat label="Years to detect" value={r.summary.yearsToDetect ? `≈${Math.round(r.summary.yearsToDetect)}` : "—"} />
              <Stat label="Noise SD (anomalies)" value={fmt(std(r.anomalies.map((p) => p.v)), 2)} />
            </div>
          )}
        </div>
        <ChartFrame eyebrow="Simulation" title="Synthetic monthly series and fitted trend" captionLabel="Note" caption="Synthetic data generated in your browser (seeded random noise). Not a measurement.">
          {r && (
            <TimeSeriesChart
              height={320}
              series={[{ id: "sim", label: "Simulated annual mean", points: r.annual, variant: "dots" }]}
              trend={annualTrendOverlay(r)}
              yLabel="Simulated value"
              unit="units"
              decimals={2}
              ariaLabel="Simulated series with trend"
            />
          )}
        </ChartFrame>
      </div>
    </section>
  );
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between">
        <span className="label-mono">{label}</span>
        <span className="num font-mono text-xs text-[var(--color-ink)]">
          {value}
          {unit && ` ${unit}`}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[var(--color-cyan)]" />
    </label>
  );
}
