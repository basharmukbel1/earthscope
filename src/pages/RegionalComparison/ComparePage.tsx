import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Plus } from "lucide-react";
import type { Region } from "@/types/domain";
import { useInvestigation, newId } from "@/store/investigation";
import { useEntries, isReady, type ReadyEntry } from "@/hooks/useEntries";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { NoInvestigation } from "@/components/scientific/NoInvestigation";
import { ForestPlot } from "@/components/charts/ForestPlot";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { PlaceSearch } from "@/components/maps/PlaceSearch";
import { RegionMap } from "@/components/maps/RegionMap";
import { Panel } from "@/components/ui/Panel";
import { TrendBadge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Controls";
import { AcquisitionLoader, ErrorState } from "@/components/ui/States";
import { annualTrendOverlay, resultAnnualUnit } from "@/utils/trend";
import { fmt, fmtP, fmtSigned } from "@/utils/format";
import { normalQuantile } from "@/stats";
import { cn } from "@/utils/cn";

const REGION_COLORS = ["var(--color-ice)", "var(--color-cyan)", "#f5c56b", "#c9a7ff"];

export default function ComparePage() {
  const entries = useEntries().filter(isReady);
  const config = useInvestigation((s) => s.config);
  const status = useInvestigation((s) => s.status);
  const progress = useInvestigation((s) => s.progress);
  const error = useInvestigation((s) => s.error);
  const run = useInvestigation((s) => s.run);
  const variableIds = useMemo(() => [...new Set(entries.map((e) => e.variable.id))], [entries]);
  const [varId, setVarId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!varId || !variableIds.includes(varId)) setVarId(variableIds[0]);
  }, [variableIds, varId]);
  const group = entries.filter((e) => e.variable.id === varId);

  const addRegion = (r: Region) => {
    if (!config || config.regions.some((x) => x.id === r.id)) return;
    void run({ ...config, id: newId(), regions: [...config.regions, r].slice(-4), question: config.question });
  };
  const removeRegion = (id: string) => {
    if (!config) return;
    const regions = config.regions.filter((r) => r.id !== id);
    if (regions.length) void run({ ...config, id: newId(), regions });
  };

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <div className="container-x py-8">
        <header className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="label-mono mb-2 text-[var(--color-cyan)]">Regional comparison</div>
            <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.8rem)] leading-tight tracking-[-0.03em]">Same variable. Different places.</h1>
            <p className="mt-2 max-w-[62ch] text-sm text-[var(--color-ink-3)]">
              A process can push one region up and its neighbour down. Each region is averaged over its own grid cells and tested independently.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {variableIds.length > 1 && (
              <Select label="Variable" value={varId} onChange={(e) => setVarId(e.target.value)} className="w-56">
                {variableIds.map((id) => (
                  <option key={id} value={id}>
                    {entries.find((e) => e.variable.id === id)?.variable.name}
                  </option>
                ))}
              </Select>
            )}
            {config && (
              <div className="w-72">
                <span className="label-mono mb-1.5 flex items-center gap-1.5">
                  <Plus className="h-3 w-3" /> Add a region (max 4)
                </span>
                <PlaceSearch onSelect={addRegion} placeholder="e.g. Iraq, Sahel, 30.0, 31.2" />
              </div>
            )}
          </div>
        </header>

        {status === "loading" && progress && (
          <div className="panel mb-6">
            <AcquisitionLoader message={progress.message} done={progress.done} total={progress.total} />
          </div>
        )}
        {status === "error" && <ErrorState className="mb-6" message={error} onRetry={config ? () => void run(config) : undefined} />}
        {status !== "loading" && group.length === 0 && (
          <div className="panel">
            <NoInvestigation title="Nothing to compare yet" body="Run an investigation with two or more regions — for example Jordan, Saudi Arabia and Iraq — or start the comparison demo." />
          </div>
        )}
        {group.length > 0 && status !== "loading" && <Comparison group={group} onRemove={removeRegion} />}
      </div>
    </div>
  );
}

function Comparison({ group, onRemove }: { group: ReadyEntry[]; onRemove: (id: string) => void }) {
  const v = group[0].variable;
  const unit = resultAnnualUnit(group[0].result, v);
  const rows = group.map((e) => ({
    id: e.series.id,
    label: e.region?.name ?? e.series.regionId,
    sublabel: `n = ${e.result.annual.filter((p) => p.v !== null).length} yr · p = ${fmtP(e.result.summary.p)}`,
    estimate: e.result.summary.perDecade,
    ciLow: e.result.summary.perDecadeCi[0],
    ciHigh: e.result.summary.perDecadeCi[1],
    significant: e.result.summary.significant,
    direction: e.result.summary.direction,
    unit: `${unit}/decade`,
  }));
  const ups = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "increasing");
  const downs = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "decreasing");
  const opposing = ups.length > 0 && downs.length > 0;

  // shared y-domain so small multiples are visually comparable
  const yDomain = useMemo<[number, number]>(() => {
    const vals = group.flatMap((e) => e.result.annual.map((p) => p.v).filter((x): x is number => x !== null));
    const lo = Math.min(...vals),
      hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || 1;
    return [lo - pad, hi + pad];
  }, [group]);

  // standardised annual anomalies on one chart
  const anomalies = group.map((e, i) => {
    const valid = e.result.annual.filter((p) => p.v !== null) as { v: number }[];
    const m = valid.reduce((a, p) => a + p.v, 0) / Math.max(1, valid.length);
    return { id: e.series.id, label: e.region?.name ?? "", color: REGION_COLORS[i % REGION_COLORS.length], points: e.result.annual.map((p) => ({ ...p, v: p.v === null ? null : p.v - m })), variant: "line" as const };
  });

  const z = normalQuantile(0.975);
  const pairs: { a: ReadyEntry; b: ReadyEntry; diff: number; lo: number; hi: number }[] = [];
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i],
        b = group[j];
      const seA = (a.result.summary.perDecadeCi[1] - a.result.summary.perDecadeCi[0]) / (2 * z);
      const seB = (b.result.summary.perDecadeCi[1] - b.result.summary.perDecadeCi[0]) / (2 * z);
      const diff = a.result.summary.perDecade - b.result.summary.perDecade;
      const half = z * Math.sqrt(seA ** 2 + seB ** 2);
      pairs.push({ a, b, diff, lo: diff - half, hi: diff + half });
    }

  const allYears = useMemo(() => {
    const ys = group.flatMap((e) => e.series.points.map((p) => +p.date.slice(0, 4)));
    const y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    return Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  }, [group]);

  return (
    <div className="space-y-6">
      {opposing && (
        <div className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line-strong)] bg-gradient-to-r from-[var(--color-rise-soft)] via-transparent to-[var(--color-fall-soft)] p-5">
          <div className="flex items-start gap-3">
            <ArrowLeftRight className="mt-0.5 h-5 w-5 text-[var(--color-ice)]" />
            <div>
              <div className="label-mono mb-1 text-[var(--color-ice)]">Opposing trends detected</div>
              <p className="text-sm text-[var(--color-ink)]">
                <span className="text-[var(--color-rise)]">▲ {ups.map((e) => e.region?.name).join(", ")}</span> and{" "}
                <span className="text-[var(--color-fall)]">▼ {downs.map((e) => e.region?.name).join(", ")}</span> show statistically significant trends in opposite directions for {v.name.toLowerCase()}.
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-3)]">Correlation of timing does not establish a shared cause — ask the AI Scientist for testable hypotheses.</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <ChartFrame eyebrow="Fig. 1 · Trend rates" title={`${v.name}: trend per decade with 95% CI`} subtitle={`Filled = significant (p < ${group[0].result.summary.alpha} for that region's own series); hollow = not significant. Opposite-signed significant trends are bracketed.`} unit={`${unit}/decade`}>
          <ForestPlot rows={rows} ariaLabel={`Trend per decade of ${v.name} by region with confidence intervals`} decimals={v.decimals} highlightOpposing />
        </ChartFrame>
        <ChartFrame eyebrow="Fig. 2 · Study areas" title="Regions compared">
          <RegionMap regions={group.map((e) => e.region).filter((r): r is Region => !!r && !(r.kind === "bbox" && r.bbox.west === -180))} height={300} fit="regions" />
        </ChartFrame>
      </div>

      <ChartFrame eyebrow="Fig. 3 · Anomalies" title="Annual anomalies on a common axis" subtitle="Each region's annual value minus its own long-term mean" unit={unit}>
        <TimeSeriesChart height={300} series={anomalies} zeroLine yLabel={`${v.name} anomaly`} unit={unit} decimals={v.decimals} showLegend ariaLabel={`Annual anomalies of ${v.name} for each region`} />
      </ChartFrame>

      <div>
        <div className="label-mono mb-3">Individual time series · shared y-axis</div>
        <div className={cn("grid gap-4", group.length > 2 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
          {group.map((e, i) => (
            <ChartFrame
              key={e.series.id}
              title={<span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: REGION_COLORS[i % REGION_COLORS.length] }} />{e.region?.name}</span>}
              subtitle={`${fmtSigned(e.result.summary.perDecade, v.decimals)} ${unit}/decade · p = ${fmtP(e.result.summary.p)}`}
              actions={
                <div className="flex items-center gap-2">
                  <TrendBadge direction={e.result.summary.direction} significant={e.result.summary.significant} compact />
                  {group.length > 1 && e.region && (
                    <button onClick={() => onRemove(e.region!.id)} className="text-[11px] text-[var(--color-ink-4)] hover:text-[var(--color-ink)]">
                      Remove
                    </button>
                  )}
                </div>
              }
              caption={e.series.provenance.sampling}
            >
              <TimeSeriesChart
                height={220}
                series={[{ id: "a", label: "Annual", points: e.result.annual, variant: "line", color: REGION_COLORS[i % REGION_COLORS.length] }]}
                trend={annualTrendOverlay(e.result)}
                yDomain={yDomain}
                yLabel={v.name}
                unit={unit}
                decimals={v.decimals}
                ariaLabel={`Annual ${v.name} in ${e.region?.name}`}
              />
            </ChartFrame>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel eyebrow="Differences between regions" title="Is one region changing faster?">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="label-mono border-b border-[var(--color-line)] text-[10px]">
                <th className="py-2 font-normal">Pair</th>
                <th className="py-2 text-right font-normal">Δ trend / decade</th>
                <th className="py-2 text-right font-normal">≈95% CI</th>
                <th className="py-2 text-right font-normal">Distinct?</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => {
                const distinct = p.lo > 0 || p.hi < 0;
                return (
                  <tr key={`${p.a.series.id}-${p.b.series.id}`} className="border-b border-[var(--color-line)]">
                    <td className="py-2 text-[var(--color-ink-2)]">
                      {p.a.region?.name} − {p.b.region?.name}
                    </td>
                    <td className="num py-2 text-right font-mono">{fmtSigned(p.diff, v.decimals)}</td>
                    <td className="num py-2 text-right font-mono text-[var(--color-ink-3)]">
                      {fmtSigned(p.lo, v.decimals)} … {fmtSigned(p.hi, v.decimals)}
                    </td>
                    <td className="py-2 text-right">{distinct ? "Yes" : <span className="text-[var(--color-ink-4)]">No</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-4)]">
            Approximate: standard errors are recovered from each 95% CI and assumed independent. “Distinct” means the CI of the difference excludes zero.
          </p>
        </Panel>

        <Panel eyebrow="Data availability" title="Valid months per year">
          <div className="overflow-x-auto">
            <div className="min-w-[480px] space-y-1.5">
              {group.map((e) => {
                const byYear = new Map<number, number>();
                for (const p of e.series.points) if (p.v !== null) byYear.set(+p.date.slice(0, 4), (byYear.get(+p.date.slice(0, 4)) ?? 0) + 1);
                return (
                  <div key={e.series.id} className="grid grid-cols-[110px_1fr] items-center gap-2">
                    <span className="truncate text-xs text-[var(--color-ink-2)]">{e.region?.name}</span>
                    <div className="flex h-4 gap-px">
                      {allYears.map((y) => {
                        const n = byYear.get(y) ?? 0;
                        return (
                          <div
                            key={y}
                            title={`${y}: ${n}/12 months`}
                            className={cn("flex-1 rounded-[1px]", n === 0 && "hatch-missing")}
                            style={{ background: n ? `rgb(56 225 255 / ${0.15 + (n / 12) * 0.7})` : undefined }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <span />
                <div className="flex justify-between font-mono text-[10px] text-[var(--color-ink-4)]">
                  <span>{allYears[0]}</span>
                  <span>{allYears[allYears.length - 1]}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {group.map((e) => (
              <div key={e.series.id} className="flex justify-between rounded border border-[var(--color-line)] px-2 py-1">
                <span className="truncate text-[var(--color-ink-3)]">{e.region?.name}</span>
                <span className="num font-mono">{fmt(e.result.missingPct, 1)}% missing</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
