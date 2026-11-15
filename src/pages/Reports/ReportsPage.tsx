import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Download, FileJson, FileText, Printer, Trash2 } from "lucide-react";
import type { AnalysisResult, Region } from "@/types/domain";
import { useInvestigation, newId, type SavedReport } from "@/store/investigation";
import { useEntries, isReady } from "@/hooks/useEntries";
import { getVariable } from "@/data/catalog";
import { interpret, type AnalystBlock } from "@/services/analyst";
import { compareMethods } from "@/stats";
import { InvestigationRail } from "@/components/scientific/InvestigationRail";
import { AnalystBlocks } from "@/components/scientific/AnalystBlocks";
import { NoInvestigation } from "@/components/scientific/NoInvestigation";
import { RegionMap } from "@/components/maps/RegionMap";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ForestPlot } from "@/components/charts/ForestPlot";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { annualTrendOverlay, pctPerDecade, resultAnnualUnit } from "@/utils/trend";
import { fmt, fmtP, fmtPct, fmtSigned } from "@/utils/format";
import { cn } from "@/utils/cn";
import { plainSentence } from "@/utils/plainSentence";

const METHOD_REFS = [
  "Mann, H. B. (1945). Nonparametric tests against trend. Econometrica, 13(3), 245–259.",
  "Kendall, M. G. (1975). Rank Correlation Methods (4th ed.). Charles Griffin, London.",
  "Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. Journal of the American Statistical Association, 63(324), 1379–1389.",
  "Gilbert, R. O. (1987). Statistical Methods for Environmental Pollution Monitoring. Van Nostrand Reinhold, New York.",
  "Hirsch, R. M., Slack, J. R., & Smith, R. A. (1982). Techniques of trend analysis for monthly water quality data. Water Resources Research, 18(1), 107–121.",
  "Hamed, K. H., & Rao, A. R. (1998). A modified Mann-Kendall trend test for autocorrelated data. Journal of Hydrology, 204, 182–196.",
  "Santer, B. D., et al. (2000). Statistical significance of trends and trend differences in layer-average atmospheric temperature time series. Journal of Geophysical Research, 105(D6), 7337–7356.",
  "Weatherhead, E. C., et al. (1998). Factors affecting the detection of trends: Statistical considerations and applications to environmental data. Journal of Geophysical Research, 103(D14), 17149–17161.",
  "Wilks, D. S. (2016). “The stippling shows statistically significant grid points”: How research results are routinely overstated and overinterpreted. Bulletin of the American Meteorological Society, 97(12), 2263–2273.",
];

const DATA_REFS: Record<string, string> = {
  power: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program. https://power.larc.nasa.gov/",
  merra: "Gelaro, R., et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). Journal of Climate, 30(14), 5419–5454. doi:10.1175/JCLI-D-16-0758.1",
  nsidc: "Fetterer, F., Knowles, K., Meier, W. N., Savoie, M., & Windnagel, A. K. Sea Ice Index (G02135). NSIDC: National Snow and Ice Data Center, Boulder, Colorado USA.",
  gibs: "Imagery from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
  seawifs: "Time-Series Analysis of Remotely-Sensed SeaWiFS Chlorophyll in River-Influenced Coastal Regions. NASA Technical Reports Server, 20090042747.",
};

function buildReport(config: NonNullable<ReturnType<typeof useInvestigation.getState>["config"]>, entries: ReturnType<typeof useEntries>, primary: SavedReport["primary"]): SavedReport {
  const ready = entries.filter(isReady);
  const interpretation = ready.flatMap((e) =>
    interpret(e.result, e.variable, e.region)
      .filter((b): b is Extract<AnalystBlock, { type: "text" | "caution" }> => b.type === "text" || b.type === "caution")
      .map((b) => b.text),
  );
  return {
    id: newId(),
    title: config.question,
    createdAt: new Date().toISOString(),
    config,
    series: ready.map((e) => e.series),
    analyses: ready.map((e) => e.result),
    interpretation,
    primary,
  };
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(r: SavedReport): string {
  const dates = [...new Set(r.series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const cols = r.series.map((s) => `${s.label} [${s.unit}]`.replace(/"/g, "'"));
  const maps = r.series.map((s) => new Map(s.points.map((p) => [p.date, p.v])));
  const lines = [`date,${cols.map((c) => `"${c}"`).join(",")}`];
  for (const d of dates) lines.push(`${d},${maps.map((m) => (m.get(d) ?? "")).join(",")}`);
  return lines.join("\n");
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const config = useInvestigation((s) => s.config);
  const primary = useInvestigation((s) => s.primary);
  const reports = useInvestigation((s) => s.reports);
  const saveReport = useInvestigation((s) => s.saveReport);
  const deleteReport = useInvestigation((s) => s.deleteReport);
  const entries = useEntries();
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const canGenerate = !!config && entries.some(isReady);

  const generatedRef = useRef(false);
  useEffect(() => {
    if (params.get("new") && canGenerate && config && !generatedRef.current) {
      generatedRef.current = true;
      const r = buildReport(config, entries, primary);
      saveReport(r);
      setSelectedId(r.id);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canGenerate]);

  const selected = reports.find((r) => r.id === selectedId) ?? reports[0];

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <InvestigationRail />
      <div className="container-x py-8">
        <header className="no-print mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="label-mono mb-2 text-[var(--color-cyan)]">Scientific reports</div>
            <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.8rem)] leading-tight tracking-[-0.03em]">Publish your findings</h1>
            <p className="mt-2 max-w-[60ch] text-sm text-[var(--color-ink-3)]">Reports freeze the data and results of an investigation so they can be printed, exported and reproduced.</p>
          </div>
          <Button
            variant="primary"
            icon={<FileText className="h-4 w-4" />}
            disabled={!canGenerate}
            onClick={() => {
              if (!config) return;
              const r = buildReport(config, entries, primary);
              saveReport(r);
              setSelectedId(r.id);
            }}
          >
            Generate from current investigation
          </Button>
        </header>

        {!reports.length ? (
          <div className="panel">{canGenerate ? <EmptyState icon={<FileText className="h-6 w-6" />} title="No reports yet" body="Generate a report from your current investigation." /> : <NoInvestigation title="No reports yet" />}</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="no-print space-y-2" aria-label="Saved reports">
              <div className="label-mono mb-2">Saved locally ({reports.length})</div>
              {reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn("w-full rounded-[var(--radius-md)] border p-3 text-left transition-colors", selected?.id === r.id ? "border-[var(--color-cyan)] bg-[var(--color-cyan-soft)]" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)]")}
                >
                  <div className="line-clamp-2 text-sm">{r.title}</div>
                  <div className="mt-1 font-mono text-[10.5px] text-[var(--color-ink-4)]">{new Date(r.createdAt).toLocaleString()}</div>
                </button>
              ))}
            </aside>
            {selected && (
              <div>
                <div className="no-print mb-3 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
                    Print / Save as PDF
                  </Button>
                  <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => download(`earthscope-report-${selected.id}.csv`, toCsv(selected), "text/csv")}>
                    Data (CSV)
                  </Button>
                  <Button variant="ghost" size="sm" icon={<FileJson className="h-4 w-4" />} onClick={() => download(`earthscope-report-${selected.id}.json`, JSON.stringify(selected, null, 2), "application/json")}>
                    Full report (JSON)
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => {
                      deleteReport(selected.id);
                      setSelectedId(null);
                      if (reports.length === 1) navigate("/reports");
                    }}
                  >
                    Delete
                  </Button>
                </div>
                <ReportDocument report={selected} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ n, title, children, className }: { n: number; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("avoid-break mt-10", className)}>
      <h2 className="mb-3 flex items-baseline gap-3 border-b border-[var(--color-line)] pb-2 font-display text-xl tracking-[-0.015em]">
        <span className="font-mono text-sm text-[var(--color-cyan)]">{n}</span>
        {title}
      </h2>
      <div className="text-[14px] leading-relaxed text-[var(--color-ink-2)]">{children}</div>
    </section>
  );
}

function ReportDocument({ report }: { report: SavedReport }) {
  const items = useMemo(
    () =>
      report.series
        .map((s, i) => ({ series: s, result: report.analyses[i] as AnalysisResult, variable: getVariable(s.variableId)!, region: report.config.regions.find((r) => r.id === s.regionId) as Region | undefined }))
        .filter((x) => x.variable && x.result),
    [report],
  );
  const vars = [...new Set(items.map((i) => i.variable))];
  const usesPower = items.some((i) => i.series.provenance.mode === "live" || /POWER/.test(i.series.provenance.source));
  const usesNsidc = items.some((i) => /NSIDC/.test(i.series.provenance.source));
  const multiRegion = new Set(items.map((i) => i.series.regionId)).size > 1;

  return (
    <article className="theme-paper print-area rounded-[var(--radius-lg)] border border-[var(--color-line)] px-6 py-10 shadow-[var(--shadow-float)] md:px-14">
      <header className="border-b-2 border-[var(--color-ink)] pb-6">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
          <span>EARTHSCOPE · Scientific investigation report</span>
          <span>{new Date(report.createdAt).toISOString().slice(0, 10)}</span>
        </div>
        <h1 className="mt-6 font-display text-[clamp(1.6rem,3vw,2.4rem)] leading-tight tracking-[-0.025em] text-[var(--color-ink)]">{report.title}</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-3)]">
          Study period {report.config.startYear}–{report.config.endYear} · {report.config.regions.map((r) => r.name).join(", ")} · α = {report.config.alpha} · Report ID {report.id}
        </p>
      </header>

      <Section n={1} title="Research question">
        <p>{report.config.question}</p>
      </Section>

      <Section n={2} title="Study area">
        {report.config.regions.some((r) => !(r.kind === "bbox" && r.bbox.west === -180)) && (
          <RegionMap regions={report.config.regions.filter((r) => !(r.kind === "bbox" && r.bbox.west === -180))} height={260} fit="regions" className="mb-3" />
        )}
        <ul className="space-y-1">
          {report.config.regions.map((r) => (
            <li key={r.id}>
              <strong className="font-medium text-[var(--color-ink)]">{r.name}</strong> ({r.kind}) — bounding box {fmt(r.bbox.south, 1)}° to {fmt(r.bbox.north, 1)}° latitude, {fmt(r.bbox.west, 1)}° to {fmt(r.bbox.east, 1)}° longitude.
              {r.context ? ` ${r.context}` : ""}
            </li>
          ))}
        </ul>
      </Section>

      <Section n={3} title="Data">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-line-strong)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
              <th className="py-1.5 font-medium">Variable</th>
              <th className="py-1.5 font-medium">Dataset</th>
              <th className="py-1.5 font-medium">Resolution</th>
              <th className="py-1.5 font-medium">Unit</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((v) => (
              <tr key={v.id} className="border-b border-[var(--color-line)] align-top">
                <td className="py-1.5 pr-3">{v.name}</td>
                <td className="py-1.5 pr-3">{v.dataset.product}<br /><span className="text-[11px] text-[var(--color-ink-4)]">{v.dataset.source}</span></td>
                <td className="py-1.5 pr-3">{v.dataset.temporal}, {v.dataset.spatial}</td>
                <td className="py-1.5">{v.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 space-y-1 text-[13px]">
          {items.map((i) => (
            <li key={i.series.id}>
              <em>{i.series.label}</em>: {i.series.provenance.source}
              {i.series.provenance.retrieved ? `, retrieved ${i.series.provenance.retrieved.slice(0, 10)}` : ""}. {i.series.provenance.sampling ?? ""}
            </li>
          ))}
        </ul>
      </Section>

      <Section n={4} title="Methodology">
        <p>
          Monthly values were converted to deseasonalised anomalies by subtracting each calendar month's mean. Annual values were formed as {vars.some((v) => v.annualAgg === "sum") ? "totals (for accumulated variables such as precipitation) or " : ""}means of months, requiring at least
          10 valid months per year. Trends were estimated and tested with: (i) the Mann-Kendall test with tie correction and Sen's slope with Gilbert (1987) confidence intervals on annual values; (ii) ordinary least squares on monthly anomalies with a
          lag-1 autocorrelation adjustment of the effective sample size (Santer et al. 2000); (iii) the Hamed–Rao modified Mann-Kendall test; and (iv) the Seasonal Kendall test (Hirsch et al. 1982). The headline result uses{" "}
          {report.primary === "mk-sen" ? "Mann-Kendall + Sen's slope" : "the autocorrelation-adjusted regression"}. Significance was assessed at α = {report.config.alpha}. The number of years needed to detect a trend of the observed size was estimated following Weatherhead et al. (1998).
        </p>
      </Section>

      <Section n={5} title="Results">
        <ul className="mb-4 space-y-1">
          {items.map((i) => (
            <li key={i.series.id}>{plainSentence(i.result, i.variable, i.region?.name)}</li>
          ))}
        </ul>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line-strong)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
                <th className="py-1.5 font-medium">Series</th>
                <th className="py-1.5 text-right font-medium">Trend / decade</th>
                <th className="py-1.5 text-right font-medium">95% CI</th>
                <th className="py-1.5 text-right font-medium">p</th>
                <th className="py-1.5 text-right font-medium">% mean / dec</th>
                <th className="py-1.5 text-right font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const s = i.result.summary;
                return (
                  <tr key={i.series.id} className="border-b border-[var(--color-line)]">
                    <td className="py-1.5 pr-2">{i.series.label}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtSigned(s.perDecade, i.variable.decimals)} {resultAnnualUnit(i.result, i.variable)}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtSigned(s.perDecadeCi[0], i.variable.decimals)} … {fmtSigned(s.perDecadeCi[1], i.variable.decimals)}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtP(s.p)}</td>
                    <td className="num py-1.5 text-right font-mono">{fmtPct(pctPerDecade(i.result, i.variable))}</td>
                    <td className="py-1.5 text-right">{s.significant ? (s.direction === "increasing" ? "▲ increasing" : "▼ decreasing") : "◇ not significant"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {multiRegion && (
          <div className="mt-6">
            <ForestPlot
              rows={items.map((i) => ({
                id: i.series.id,
                label: `${i.region?.name ?? ""} · ${i.variable.shortName}`,
                estimate: i.result.summary.perDecade,
                ciLow: i.result.summary.perDecadeCi[0],
                ciHigh: i.result.summary.perDecadeCi[1],
                significant: i.result.summary.significant,
                direction: i.result.summary.direction,
                unit: `${resultAnnualUnit(i.result, i.variable)}/decade`,
              }))}
              ariaLabel="Trend per decade by series with confidence intervals"
            />
          </div>
        )}
        {items.map((i, k) => (
          <figure key={i.series.id} className="avoid-break mt-6">
            <TimeSeriesChart
              height={240}
              series={[{ id: "a", label: "Annual", points: i.result.annual, variant: "line" }]}
              trend={annualTrendOverlay(i.result)}
              yLabel={i.variable.name}
              unit={resultAnnualUnit(i.result, i.variable)}
              decimals={i.variable.decimals}
              ariaLabel={`Figure ${k + 1}: annual ${i.variable.name} in ${i.region?.name}`}
            />
            <figcaption className="mt-1 text-[12px] text-[var(--color-ink-3)]">
              Figure {k + 1}. Annual {i.variable.name.toLowerCase()} ({resultAnnualUnit(i.result, i.variable)}), {i.region?.name}, {i.result.startYear}–{i.result.endYear}, with the {i.result.summary.method} trend and its 95% confidence band.
            </figcaption>
          </figure>
        ))}
      </Section>

      <Section n={6} title="Scientific interpretation">
        {items.map((i) => (
          <div key={i.series.id} className="mb-4">
            <AnalystBlocks dense blocks={interpret(i.result, i.variable, i.region)} />
          </div>
        ))}
        <p className="text-[12px] text-[var(--color-ink-4)]">Interpretation generated by the EARTHSCOPE rule-based analyst from the computed statistics. Hypotheses are untested explanations, not conclusions.</p>
      </Section>

      <Section n={7} title="Uncertainty">
        <ul className="list-disc space-y-1.5 pl-5">
          {items.map((i) => {
            const rows = compareMethods(i.result);
            const sigs = rows.filter((r) => r.significant).length;
            return (
              <li key={i.series.id}>
                <em>{i.series.label}</em>: {sigs} of {rows.length} methods find a significant trend; the 95% interval of the headline slope spans {fmtSigned(i.result.summary.perDecadeCi[0], i.variable.decimals)} to {fmtSigned(i.result.summary.perDecadeCi[1], i.variable.decimals)}{" "}
                {resultAnnualUnit(i.result, i.variable)} per decade; {fmt(i.result.missingPct, 1)}% of months are missing
                {i.result.summary.yearsToDetect ? `; detecting a trend of this size would need ≈${Math.round(i.result.summary.yearsToDetect)} years of data (record: ${i.result.endYear - i.result.startYear + 1})` : ""}.
              </li>
            );
          })}
        </ul>
      </Section>

      <Section n={8} title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5">
          {usesPower && <li>NASA POWER values derive from the MERRA-2 reanalysis, which blends models and observations; changes in the observing system over time can introduce artificial shifts.</li>}
          {usesPower && <li>Regional means are area-weighted averages of 0.5° × 0.625° grid cells inside each region (systematically subsampled for very large regions), not full-resolution satellite averages.</li>}
          <li>Linear trends summarise change over the whole period; non-linear changes, abrupt shifts and multi-decadal cycles are not modelled.</li>
          <li>Statistical significance describes evidence against “no trend”; it does not establish the cause of a change or its practical importance.</li>
          <li>With many tests (variables × regions × methods), some “significant” results are expected by chance alone.</li>
        </ul>
      </Section>

      <Section n={9} title="References">
        <ol className="list-decimal space-y-1.5 pl-5 text-[12.5px]">
          {usesPower && <li>{DATA_REFS.power}</li>}
          {usesPower && <li>{DATA_REFS.merra}</li>}
          {usesNsidc && <li>{DATA_REFS.nsidc}</li>}
          <li>{DATA_REFS.gibs}</li>
          {METHOD_REFS.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>{DATA_REFS.seawifs}</li>
        </ol>
      </Section>
    </article>
  );
}
