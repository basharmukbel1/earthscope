import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { BrainCircuit, FileText, FileUp, PanelLeftClose, PanelLeftOpen, RefreshCw, Square } from "lucide-react";
import { useInvestigation } from "@/store/investigation";
import { useEntries, isReady, type Entry } from "@/hooks/useEntries";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { NoInvestigation } from "@/components/scientific/NoInvestigation";
import { ResultCard } from "@/components/scientific/ResultCard";
import { ProvenancePanel } from "@/components/scientific/ProvenancePanel";
import { AnalystBlocks } from "@/components/scientific/AnalystBlocks";
import { ImportDialog } from "@/components/scientific/ImportDialog";
import { RegionMap, viewExtent } from "@/components/maps/RegionMap";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { Button, ButtonLink } from "@/components/ui/Button";
import { AIBadge, SourceBadge, TrendBadge } from "@/components/ui/Badge";
import { Segmented, Tabs } from "@/components/ui/Controls";
import { AcquisitionLoader, ErrorState } from "@/components/ui/States";
import { interpret } from "@/services/analyst";
import { clampTime, getGibsLayer, gibsWmsUrl } from "@/services/gibs";
import { movingAverage } from "@/stats";
import { annualTrendOverlay, resultAnnualUnit } from "@/utils/trend";
import { fmtDateKey } from "@/utils/format";
import { cn } from "@/utils/cn";

type View = "annual" | "monthly" | "anomalies";

export default function WorkspacePage() {
  const status = useInvestigation((s) => s.status);
  const progress = useInvestigation((s) => s.progress);
  const error = useInvestigation((s) => s.error);
  const warnings = useInvestigation((s) => s.warnings);
  const config = useInvestigation((s) => s.config);
  const plans = useInvestigation((s) => s.plans);
  const primary = useInvestigation((s) => s.primary);
  const alpha = useInvestigation((s) => s.alpha);
  const setPrimary = useInvestigation((s) => s.setPrimary);
  const setAlpha = useInvestigation((s) => s.setAlpha);
  const run = useInvestigation((s) => s.run);
  const cancel = useInvestigation((s) => s.cancel);
  const usedSnapshot = useInvestigation((s) => s.usedSnapshot);
  const entries = useEntries();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("annual");
  const [importOpen, setImportOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);

  useEffect(() => {
    if (!entries.find((e) => e.series.id === activeId)) setActiveId(entries[0]?.series.id ?? null);
  }, [entries, activeId]);
  const active = entries.find((e) => e.series.id === activeId) ?? entries[0];

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} defaultVariable={active?.variable.id} />
      <div className="container-x py-6">
        <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="min-w-0">
            <div className="label-mono mb-2">Investigation workspace</div>
            <h1 className="max-w-[40ch] font-display text-[clamp(1.5rem,2.6vw,2.2rem)] leading-tight tracking-[-0.025em]">{config?.question ?? "No active investigation"}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            {config && status !== "loading" && (
              <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void run({ ...config })}>
                Re-run
              </Button>
            )}
            {entries.length > 0 && (
              <ButtonLink to="/reports?new=1" variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />}>
                Generate report
              </ButtonLink>
            )}
          </div>
        </header>

        {status === "loading" && progress && (
          <div className="panel">
            <AcquisitionLoader message={progress.message} done={progress.done} total={progress.total} />
            <div className="flex justify-center pb-8">
              <Button variant="ghost" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {status === "error" && (
          <ErrorState title="We couldn't complete this investigation" message={error} onRetry={config ? () => void run(config) : undefined}>
            <p className="mt-2 text-xs text-[var(--color-ink-3)]">
              Data are requested live from the NASA POWER API. If you are offline, demo regions fall back to bundled real-data snapshots; you can also import a CSV.
            </p>
          </ErrorState>
        )}
        {status !== "loading" && !entries.length && status !== "error" && (
          <div className="panel">
            <NoInvestigation />
          </div>
        )}

        {entries.length > 0 && status !== "loading" && active && (
          <>
            {(warnings.length > 0 || usedSnapshot) && (
              <div className="mb-4 space-y-1.5">
                {warnings.map((w, i) => (
                  <div key={i} className="rounded-md border border-[rgb(245_197_107/.28)] bg-[rgb(245_197_107/.05)] px-3 py-2 text-xs text-[var(--color-ink-2)]">
                    {w}
                  </div>
                ))}
              </div>
            )}

            {entries.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Series">
                {entries.map((e) => (
                  <button
                    key={e.series.id}
                    role="tab"
                    aria-selected={e.series.id === active.series.id}
                    onClick={() => setActiveId(e.series.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
                      e.series.id === active.series.id ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)] text-[var(--color-ink)]" : "border-[var(--color-line-strong)] text-[var(--color-ink-3)] hover:text-[var(--color-ink)]",
                    )}
                  >
                    {e.variable.name} · {e.region?.name ?? e.series.regionId}
                    {e.result && <span className="font-mono">{e.result.summary.significant ? (e.result.summary.direction === "increasing" ? "▲" : "▼") : "◇"}</span>}
                  </button>
                ))}
              </div>
            )}

            <div className={cn("grid gap-5", leftOpen ? "xl:grid-cols-[280px_minmax(0,1fr)_360px]" : "xl:grid-cols-[44px_minmax(0,1fr)_360px]")}>
              {/* LEFT — configuration & data quality */}
              <aside className="min-w-0 space-y-4" aria-label="Investigation details">
                <button
                  onClick={() => setLeftOpen((o) => !o)}
                  className="hidden h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--color-line)] text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)] xl:flex"
                  aria-label={leftOpen ? "Collapse details panel" : "Expand details panel"}
                >
                  {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                  {leftOpen && "Hide details"}
                </button>
                {leftOpen && <LeftPanels active={active} plansCount={Object.keys(plans).length} primary={primary} alpha={alpha} setPrimary={setPrimary} setAlpha={setAlpha} />}
              </aside>

              {/* CENTER — map + charts */}
              <section className="min-w-0 space-y-5" aria-label="Data visualization">
                <WorkspaceMap entry={active} />
                <WorkspaceCharts entry={active} view={view} setView={setView} />
              </section>

              {/* RIGHT — findings */}
              <aside className="min-w-0 space-y-4" aria-label="Statistical findings">
                {active.result ? (
                  <>
                    <ResultCard result={active.result} variable={active.variable} />
                    <FindingsTable entry={active} />
                    <Panel
                      eyebrow={<span className="text-[#c9c0ff]">Scientific interpretation</span>}
                      title={<span className="flex items-center gap-2">What this means <AIBadge engine="local" /></span>}
                      collapsible
                    >
                      <AnalystBlocks dense blocks={interpret(active.result, active.variable, active.region)} />
                      <ButtonLink to="/ai-scientist" variant="ai" size="sm" className="mt-4 w-full" icon={<BrainCircuit className="h-4 w-4" />}>
                        Ask the AI Scientist
                      </ButtonLink>
                    </Panel>
                  </>
                ) : (
                  <ErrorState title="Not enough data for a trend test" message={active.error} />
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LeftPanels({
  active,
  plansCount,
  primary,
  alpha,
  setPrimary,
  setAlpha,
}: {
  active: Entry;
  plansCount: number;
  primary: "mk-sen" | "ols-ar1";
  alpha: number;
  setPrimary: (p: "mk-sen" | "ols-ar1") => void;
  setAlpha: (a: number) => void;
}) {
  const config = useInvestigation((s) => s.config);
  return (
    <>
      <Panel eyebrow="Study area" title={active.region?.name ?? "Imported area"} collapsible>
        {active.region?.context && <p className="mb-2 text-xs text-[var(--color-ink-3)]">{active.region.context}</p>}
        <div className="divide-y divide-[var(--color-line)]">
          <KeyValue k="Type" v={active.region?.kind ?? "import"} />
          {active.region && active.region.kind !== "bbox" && (
            <KeyValue k="Centre" v={`${active.region.center[1].toFixed(2)}°, ${active.region.center[0].toFixed(2)}°`} />
          )}
          <KeyValue k="Regions in case" v={String(config?.regions.length ?? 1)} />
          {plansCount > 0 && <KeyValue k="Sampling plans" v={String(plansCount)} />}
        </div>
      </Panel>
      <Panel eyebrow="Variable" title={active.variable.name} collapsible>
        <p className="text-xs leading-relaxed text-[var(--color-ink-3)]">{active.variable.definition}</p>
        <div className="mt-2 divide-y divide-[var(--color-line)]">
          <KeyValue k="Short name" v={active.variable.shortName} />
          <KeyValue k="Unit" v={active.series.unit} />
          <KeyValue k="Source" v={<span className="font-sans text-xs">{active.variable.dataset.mission}</span>} mono={false} />
          <KeyValue k="Period" v={`${config?.startYear ?? "—"}–${config?.endYear ?? "—"}`} />
        </div>
        <Link to={`/discover?v=${active.variable.id}`} className="mt-2 inline-block text-xs text-[var(--color-ice)] hover:underline">
          Dataset details →
        </Link>
      </Panel>
      <Panel eyebrow="Analysis configuration" title="Methods" collapsible>
        <div className="label-mono mb-1.5">Headline method</div>
        <Segmented
          size="sm"
          ariaLabel="Headline method"
          value={primary}
          onChange={setPrimary}
          options={[
            { value: "mk-sen", label: "MK + Sen", title: "Mann-Kendall + Sen's slope on annual values" },
            { value: "ols-ar1", label: "OLS · AR1", title: "Regression on monthly anomalies, autocorrelation-adjusted" },
          ]}
        />
        <div className="label-mono mb-1.5 mt-3">Significance level α</div>
        <Segmented
          size="sm"
          ariaLabel="Significance level"
          value={String(alpha)}
          onChange={(v) => setAlpha(+v)}
          options={[
            { value: "0.1", label: "0.10" },
            { value: "0.05", label: "0.05" },
            { value: "0.01", label: "0.01" },
          ]}
        />
      </Panel>
      <Panel eyebrow="Data quality" title="Provenance" collapsible>
        <ProvenancePanel series={active.series} result={active.result} variable={active.variable} />
      </Panel>
    </>
  );
}

function WorkspaceMap({ entry }: { entry: Entry }) {
  const plans = useInvestigation((s) => s.plans);
  const plan = entry.region ? plans[entry.region.id] : undefined;
  const regions = entry.region && entry.region.kind !== "bbox" ? [entry.region] : entry.region?.bbox.west === -180 ? [] : entry.region ? [entry.region] : [];
  const layer = getGibsLayer(entry.variable.gibsLayer);
  const time = layer ? clampTime(layer) : undefined;
  const [imagery, setImagery] = useState<"satellite" | "layer" | "plain">("satellite");
  const extent = useMemo(() => viewExtent(regions, "regions"), [regions]);
  const underlay = !regions.length
    ? null
    : imagery === "satellite"
      ? { url: gibsWmsUrl("BlueMarble_NextGeneration", { bbox: extent, width: 1400, format: "image/jpeg" }), bbox: extent, label: "NASA Blue Marble (true color) · GIBS" }
      : imagery === "layer" && layer
        ? { url: gibsWmsUrl(layer.id, { time, bbox: extent, width: 1200 }), bbox: extent, label: `GIBS · ${layer.title}${time ? ` · ${fmtDateKey(time.slice(0, 7))}` : ""}` }
        : null;
  return (
    <ChartFrame
      eyebrow="Fig. A · Study area"
      title={entry.region?.name ?? "Imported series"}
      subtitle={plan ? plan.description : "Region outline"}
      actions={
        <Segmented
          size="sm"
          ariaLabel="Map underlay"
          value={imagery}
          onChange={setImagery}
          options={[
            { value: "satellite", label: "Satellite" },
            ...(layer ? [{ value: "layer" as const, label: entry.variable.shortName, title: layer.title }] : []),
            { value: "plain", label: "Outline" },
          ]}
        />
      }
      caption={
        imagery === "layer"
          ? "Underlay: NASA GIBS monthly imagery of this variable for context (most recent month) — not the analysed data. Cyan dots: grid cells averaged for the time series."
          : "Cyan dots: NASA POWER grid cells averaged into the regional time series."
      }
    >
      {regions.length ? (
        <RegionMap regions={regions} samplePoints={plan?.points} underlay={underlay} height={300} fit="regions" />
      ) : (
        <div className="flex h-[200px] items-center justify-center text-sm text-[var(--color-ink-3)]">This series was imported; its area is defined by the source tool.</div>
      )}
    </ChartFrame>
  );
}

function WorkspaceCharts({ entry, view, setView }: { entry: Entry; view: View; setView: (v: View) => void }) {
  const r = entry.result;
  const v = entry.variable;
  const monthlyMA = useMemo(() => movingAverage(entry.series.points, 12, true), [entry.series.points]);
  const annualUnit = r ? resultAnnualUnit(r, v) : entry.series.unit;
  return (
    <ChartFrame
      eyebrow="Fig. B · Time series"
      title={`${v.name} · ${entry.region?.name ?? ""}`}
      subtitle={view === "annual" ? "Annual values with headline trend and 95% confidence band" : view === "monthly" ? "Monthly values with 12-month moving average" : "Deseasonalised monthly anomalies"}
      unit={view === "annual" ? annualUnit : entry.series.unit}
      actions={
        <Tabs
          size="sm"
          ariaLabel="Chart view"
          value={view}
          onChange={setView}
          items={[
            { id: "annual", label: "Annual trend" },
            { id: "monthly", label: "Monthly" },
            { id: "anomalies", label: "Anomalies" },
          ]}
          className="border-b-0"
        />
      }
      caption={
        <span className="flex flex-wrap items-center gap-2">
          <SourceBadge provenance={entry.series.provenance} />
          {r && <TrendBadge direction={r.summary.direction} significant={r.summary.significant} />}
          <span>{r?.summary.method}</span>
        </span>
      }
      status={r || view === "monthly" ? "ready" : "empty"}
      emptyMessage="Not enough valid years for annual statistics."
    >
      {view === "annual" && r && (
        <TimeSeriesChart
          height={320}
          series={[{ id: "annual", label: `Annual ${v.annualAgg === "sum" ? "total" : "mean"}`, points: r.annual, variant: "line" }]}
          trend={annualTrendOverlay(r)}
          yLabel={v.name}
          unit={annualUnit}
          decimals={v.decimals}
          showMissing
          ariaLabel={`Annual ${v.name} for ${entry.region?.name ?? "region"} with trend line`}
        />
      )}
      {view === "monthly" && (
        <TimeSeriesChart
          height={320}
          series={[{ id: "monthly", label: "Monthly", points: entry.series.points, variant: "line", dimmed: true }]}
          movingAverage={monthlyMA}
          movingAverageLabel="12-month moving average"
          yLabel={v.name}
          unit={entry.series.unit}
          decimals={v.decimals}
          showMissing
          ariaLabel={`Monthly ${v.name} for ${entry.region?.name ?? "region"}`}
        />
      )}
      {view === "anomalies" && r && (
        <TimeSeriesChart
          height={320}
          series={[{ id: "anom", label: "Monthly anomaly", points: r.anomalies, variant: "bars" }]}
          movingAverage={movingAverage(r.anomalies, 12, true)}
          movingAverageLabel="12-month mean anomaly"
          zeroLine
          yLabel={`${v.name} anomaly`}
          unit={entry.series.unit}
          decimals={v.decimals}
          ariaLabel={`Deseasonalised anomalies of ${v.name}`}
        />
      )}
    </ChartFrame>
  );
}

function FindingsTable({ entry }: { entry: Entry }) {
  if (!isReady(entry)) return null;
  const r = entry.result;
  return (
    <Panel eyebrow="Statistical findings" title="All tests" collapsible defaultOpen>
      <div className="divide-y divide-[var(--color-line)]">
        <KeyValue k="Mann-Kendall S / τ" v={`${r.mk.s} / ${r.mk.tau.toFixed(3)}`} />
        <KeyValue k="Mann-Kendall p" v={r.mk.p < 0.001 ? "< 0.001" : r.mk.p.toFixed(3)} />
        <KeyValue k="Regression R² (anomalies)" v={r.ols.r2.toFixed(3)} />
        <KeyValue k="Regression p (AR1)" v={r.ols.p < 0.001 ? "< 0.001" : r.ols.p.toFixed(3)} />
        {r.ols.nEff && <KeyValue k="Effective sample size" v={`${Math.round(r.ols.nEff)} of ${r.ols.n}`} />}
        {r.seasonalKendall && <KeyValue k="Seasonal Kendall p" v={r.seasonalKendall.p < 0.001 ? "< 0.001" : r.seasonalKendall.p.toFixed(3)} />}
        <KeyValue k="Sample (years · months)" v={`${r.annual.filter((p) => p.v !== null).length} · ${r.nMonths}`} />
        <KeyValue k="Missing observations" v={`${r.nMissing} (${r.missingPct.toFixed(1)}%)`} />
        <KeyValue k="Years to detect" v={r.summary.yearsToDetect ? `≈ ${Math.round(r.summary.yearsToDetect)}` : "—"} />
      </div>
      <Link to="/trend-lab" className="mt-3 inline-block text-xs text-[var(--color-ice)] hover:underline">
        Compare methods in the Trend Lab →
      </Link>
    </Panel>
  );
}
