import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { Point, Region, TimeSeries } from "@/types/domain";
import { useInvestigation } from "@/store/investigation";
import { LIVE_VARIABLES, getVariable } from "@/data/catalog";
import { fetchRegionSeries } from "@/services/series";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { NoInvestigation } from "@/components/scientific/NoInvestigation";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ScatterChart } from "@/components/charts/ScatterChart";
import { LagChart } from "@/components/charts/LagChart";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import { Select, Switch } from "@/components/ui/Controls";
import { AcquisitionLoader, ErrorState } from "@/components/ui/States";
import { Panel } from "@/components/ui/Panel";
import { correlationMatrix, deseasonalize, detrend, lagCorrelation, linearFit, mean, pearson, std } from "@/stats";
import { fmt, fmtP } from "@/utils/format";
import { cn } from "@/utils/cn";

const PAIRS: Record<string, string[]> = {
  precip: ["soil-root", "soil-surface", "evap"],
  "soil-root": ["precip", "t2m"],
  "soil-surface": ["precip", "t2m"],
  t2m: ["soil-surface", "water-vapor"],
  "water-vapor": ["t2m", "precip"],
  aod: ["soil-surface", "precip"],
};

const COLORS = ["var(--color-ice)", "var(--color-cyan)", "#f5c56b", "#c9a7ff"];

function useRelationshipData(region: Region | undefined, varIds: string[], start: number, end: number) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; series: TimeSeries[]; msg: string; done: number; total: number }>({ loading: false, error: null, series: [], msg: "", done: 0, total: 1 });
  const key = `${region?.id}|${varIds.join(",")}|${start}-${end}`;
  useEffect(() => {
    if (!region || varIds.length < 2) return;
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchRegionSeries(region, varIds, start, end, { signal: ac.signal, onProgress: (p) => setState((s) => ({ ...s, msg: p.message, done: p.done, total: p.total })) })
      .then((r) => setState({ loading: false, error: null, series: r.series, msg: "", done: 1, total: 1 }))
      .catch((e) => (e as Error).name !== "AbortError" && setState((s) => ({ ...s, loading: false, error: (e as Error).message })));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** Align series on common monthly dates; return anomalies (optionally detrended). */
function alignAnomalies(series: TimeSeries[], removeTrend: boolean) {
  const anoms = series.map((s) => {
    let a = deseasonalize(s.points);
    if (removeTrend) a = detrend(a);
    return new Map(a.map((p) => [p.date, p]));
  });
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const t = new Map(series.flatMap((s) => s.points.map((p) => [p.date, p.t] as const)));
  const values = anoms.map((m) => dates.map((d) => m.get(d)?.v ?? null));
  return { dates, t: dates.map((d) => t.get(d)!), values };
}

export default function RelationshipPage() {
  const config = useInvestigation((s) => s.config);
  const regions = config?.regions ?? [];
  const [regionId, setRegionId] = useState<string | undefined>(regions[0]?.id);
  useEffect(() => {
    if (!regions.find((r) => r.id === regionId)) setRegionId(regions[0]?.id);
  }, [regions, regionId]);
  const region = regions.find((r) => r.id === regionId);

  const initialVars = useMemo(() => {
    const live = (config?.variableIds ?? []).filter((id) => getVariable(id)?.connector.kind === "power");
    const base = live[0] ?? "precip";
    const set = new Set([...live, ...(PAIRS[base] ?? ["t2m"]).slice(0, live.length >= 2 ? 0 : 2 - live.length)]);
    return [...set].slice(0, 4);
  }, [config?.variableIds]);
  const [varIds, setVarIds] = useState<string[]>(initialVars);
  useEffect(() => setVarIds(initialVars), [initialVars]);
  const [removeTrend, setRemoveTrend] = useState(true);
  const [xId, setXId] = useState<string | undefined>();
  const [yId, setYId] = useState<string | undefined>();
  useEffect(() => {
    setXId(varIds[0]);
    setYId(varIds[1]);
  }, [varIds]);

  const start = Math.max(config?.startYear ?? 1981, ...varIds.map((id) => (getVariable(id)?.connector as { startYear?: number })?.startYear ?? 1981));
  const end = config?.endYear ?? 2025;
  const data = useRelationshipData(region, varIds, start, end);

  const analysis = useMemo(() => {
    if (data.series.length < 2) return null;
    const ordered = varIds.map((id) => data.series.find((s) => s.variableId === id)).filter((s): s is TimeSeries => !!s);
    const al = alignAnomalies(ordered, removeTrend);
    const idx = (id?: string) => ordered.findIndex((s) => s.variableId === id);
    const xi = idx(xId),
      yi = idx(yId);
    if (xi < 0 || yi < 0 || xi === yi) return { ordered, al, pair: null };
    const x = al.values[xi],
      y = al.values[yi];
    const corr = pearson(x, y, { effectiveN: "bretherton" });
    const pts = x.map((xv, i) => ({ x: xv, y: y[i], label: al.dates[i] })).filter((p): p is { x: number; y: number; label: string } => p.x !== null && p.y !== null);
    const fit = linearFit(pts.map((p) => p.x), pts.map((p) => p.y));
    const lags = lagCorrelation(x, y, 12, { alpha: 0.05, effectiveN: "bretherton" });
    const z = (vals: (number | null)[]): Point[] => {
      const m = mean(vals),
        s = std(vals) || 1;
      return vals.map((v, i) => ({ t: al.t[i], date: al.dates[i], v: v === null ? null : (v - m) / s }));
    };
    const matrix = correlationMatrix(
      ordered.map((s, i) => ({ label: getVariable(s.variableId)?.shortName ?? s.variableId, values: al.values[i] })),
      { effectiveN: "bretherton" },
    );
    return { ordered, al, pair: { xi, yi, corr, pts, fit, lags, zx: z(x), zy: z(y), matrix } };
  }, [data.series, varIds, removeTrend, xId, yId]);

  const toggle = (id: string) => setVarIds((ids) => (ids.includes(id) ? (ids.length > 2 ? ids.filter((x) => x !== id) : ids) : ids.length < 4 ? [...ids, id] : ids));

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <div className="container-x py-8">
        <header className="mb-6">
          <div className="label-mono mb-2 text-[var(--color-cyan)]">Earth System Relationship Lab</div>
          <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.8rem)] leading-tight tracking-[-0.03em]">How do variables move together?</h1>
          <p className="mt-2 max-w-[64ch] text-sm text-[var(--color-ink-3)]">
            Compare monthly anomalies of two or more variables in the same region — rainfall and soil moisture, temperature and humidity — including time lags.
          </p>
        </header>

        <div className="mb-6 flex gap-3 rounded-[var(--radius-lg)] border border-[rgb(245_197_107/.3)] bg-[rgb(245_197_107/.06)] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warn)]" />
          <p className="text-sm text-[var(--color-ink-2)]">
            <strong className="font-medium text-[var(--color-ink)]">Correlation does not establish causation.</strong> Two variables can move together because one drives the other, because a third
            factor drives both, or by chance. Shared seasonal cycles and long-term trends create strong but misleading correlations — EARTHSCOPE removes the seasonal cycle and (by default) the trends first, and
            corrects p-values for autocorrelation (Bretherton et al. 1999).
          </p>
        </div>

        {!regions.length ? (
          <div className="panel">
            <NoInvestigation title="Choose a region first" body="Run an investigation to set a study region; then relate any NASA POWER variables over it." />
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[300px_1fr]">
            <aside className="space-y-4">
              <Panel eyebrow="Setup" title="Region & variables">
                <Select label="Region" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <div className="label-mono mb-2 mt-4">Variables (2–4)</div>
                <div className="space-y-1.5">
                  {LIVE_VARIABLES.map((v) => {
                    const on = varIds.includes(v.id);
                    return (
                      <button key={v.id} onClick={() => toggle(v.id)} aria-pressed={on} className={cn("flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)]" : "border-[var(--color-line)] text-[var(--color-ink-3)] hover:text-[var(--color-ink)]")}>
                        <span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded-sm border", on ? "border-[var(--color-cyan)] bg-[var(--color-cyan)] text-[#021018]" : "border-[var(--color-line-bright)]")}>{on && <Check className="h-2.5 w-2.5" />}</span>
                        {v.name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <Switch checked={removeTrend} onChange={setRemoveTrend} label="Remove long-term trends first" />
                </div>
                <p className="mt-3 text-[11px] text-[var(--color-ink-4)]">
                  Period {start}–{end}. Data from NASA POWER (cached after first load).
                </p>
              </Panel>
              {analysis && analysis.ordered.length >= 2 && (
                <Panel eyebrow="Pair" title="Scatter & lag pair">
                  <div className="grid gap-3">
                    <Select label="X (driver candidate)" value={xId} onChange={(e) => setXId(e.target.value)}>
                      {varIds.map((id) => (
                        <option key={id} value={id}>
                          {getVariable(id)?.name}
                        </option>
                      ))}
                    </Select>
                    <Select label="Y (response candidate)" value={yId} onChange={(e) => setYId(e.target.value)}>
                      {varIds.map((id) => (
                        <option key={id} value={id}>
                          {getVariable(id)?.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </Panel>
              )}
            </aside>

            <section className="min-w-0 space-y-6">
              {data.loading && (
                <div className="panel">
                  <AcquisitionLoader message={data.msg || "Fetching variables…"} done={data.done} total={data.total} />
                </div>
              )}
              {data.error && <ErrorState message={data.error} />}
              {!data.loading && analysis?.pair && (() => {
                const p = analysis.pair;
                const vx = getVariable(analysis.ordered[p.xi].variableId)!;
                const vy = getVariable(analysis.ordered[p.yi].variableId)!;
                const best = [...p.lags].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
                return (
                  <>
                    <div className="grid gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
                      {[
                        { k: "Pearson r (lag 0)", v: fmt(p.corr.r, 2) },
                        { k: "p-value (autocorr.-adjusted)", v: fmtP(p.corr.p) },
                        { k: "Effective n", v: `${Math.round(p.corr.nEff)} of ${p.corr.n}` },
                        { k: "Strongest lag", v: best ? `${best.lag > 0 ? "+" : ""}${best.lag} mo · r = ${fmt(best.r, 2)}` : "—" },
                      ].map((s) => (
                        <div key={s.k} className="bg-[var(--color-abyss)] p-4">
                          <div className="label-mono mb-1">{s.k}</div>
                          <div className="num font-display text-xl">{s.v}</div>
                        </div>
                      ))}
                    </div>
                    <ChartFrame eyebrow="Fig. 1 · Anomaly comparison" title={`${vx.name} vs ${vy.name}`} subtitle="Standardised monthly anomalies (z-scores)" unit="σ">
                      <TimeSeriesChart
                        height={280}
                        series={[
                          { id: "x", label: vx.name, points: p.zx, color: COLORS[0], variant: "line" },
                          { id: "y", label: vy.name, points: p.zy, color: COLORS[2], variant: "line" },
                        ]}
                        zeroLine
                        showLegend
                        yLabel="Standardised anomaly"
                        unit="σ"
                        decimals={2}
                        ariaLabel={`Standardised anomalies of ${vx.name} and ${vy.name}`}
                      />
                    </ChartFrame>
                    <div className="grid gap-6 xl:grid-cols-2">
                      <ChartFrame eyebrow="Fig. 2 · Scatter" title="Monthly anomaly pairs" unit={`${vy.unit} vs ${vx.unit}`}>
                        <ScatterChart
                          height={300}
                          points={p.pts}
                          xLabel={`${vx.name} anomaly`}
                          yLabel={`${vy.name} anomaly`}
                          xUnit={vx.unit}
                          yUnit={vy.unit}
                          xDecimals={vx.decimals}
                          yDecimals={vy.decimals}
                          fit={{ slope: p.fit.slope, intercept: p.fit.intercept, r: p.corr.r, p: p.corr.p, n: p.corr.n }}
                          ariaLabel={`Scatter plot of ${vy.name} against ${vx.name} anomalies`}
                        />
                      </ChartFrame>
                      <ChartFrame eyebrow="Fig. 3 · Time-lag comparison" title="Does one lead the other?" subtitle={`Positive lag: ${vy.name} follows ${vx.name}`}>
                        <LagChart
                          height={300}
                          rows={p.lags.map((l) => ({ lag: l.lag, r: l.r, p: l.pBonferroni, significant: l.significant }))}
                          lagUnit="mo"
                          leadLabels={{ negative: `${vy.name} leads`, positive: `${vx.name} leads` }}
                          note="Significance is Bonferroni-corrected across the 25 lags tested and uses autocorrelation-adjusted sample sizes."
                          ariaLabel="Lagged correlation from −12 to +12 months"
                        />
                      </ChartFrame>
                    </div>
                    {analysis.ordered.length > 2 && (
                      <ChartFrame eyebrow="Fig. 4 · Correlation matrix" title="All selected variables" subtitle="Pearson r of monthly anomalies; marked cells are significant (autocorrelation-adjusted)">
                        <CorrelationMatrix labels={p.matrix.labels} r={p.matrix.r} p={p.matrix.p} alpha={0.05} triangle="lower" ariaLabel="Correlation matrix of selected variables" method="Pearson, anomalies" />
                      </ChartFrame>
                    )}
                    <Panel eyebrow="Reading this" title="What the numbers can and can't tell you">
                      <ul className="space-y-2 text-sm text-[var(--color-ink-2)]">
                        <li>• r = {fmt(p.corr.r, 2)}: {Math.abs(p.corr.r) < 0.2 ? "a weak" : Math.abs(p.corr.r) < 0.5 ? "a moderate" : "a strong"} {p.corr.r >= 0 ? "positive" : "negative"} association between monthly anomalies {p.corr.p < 0.05 ? "(significant)" : "(not significant)"}.</li>
                        <li>• r² = {fmt(p.corr.r * p.corr.r, 2)}: about {Math.round(p.corr.r * p.corr.r * 100)}% of the month-to-month variance is shared.</li>
                        <li>• A peak at a positive lag is consistent with — but does not prove — {vx.name.toLowerCase()} influencing {vy.name.toLowerCase()} later.</li>
                      </ul>
                    </Panel>
                  </>
                );
              })()}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
