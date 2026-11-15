import type { AnalysisResult, TimeSeries, Variable } from "@/types/domain";
import { SourceBadge } from "@/components/ui/Badge";
import { KeyValue } from "@/components/ui/Panel";
import { fmt } from "@/utils/format";

/** Data quality + provenance for one series. */
export function ProvenancePanel({ series, result, variable }: { series: TimeSeries; result?: AnalysisResult; variable: Variable }) {
  const p = series.provenance;
  const valid = series.points.filter((x) => x.v !== null).length;
  return (
    <div className="min-w-0 space-y-3">
      <SourceBadge provenance={p} />
      <div className="divide-y divide-[var(--color-line)]">
        <KeyValue k="Dataset" v={<span className="font-sans text-xs">{variable.dataset.product}</span>} mono={false} />
        <KeyValue k="Resolution" v={`${variable.dataset.temporal} · ${variable.dataset.spatial}`} />
        <KeyValue k="Months" v={`${valid} valid / ${series.points.length}`} />
        {result && <KeyValue k="Missing" v={`${fmt(result.missingPct, 1)}%`} />}
        {p.cellsUsed !== undefined && <KeyValue k="Grid cells used" v={`${p.cellsUsed}${p.cellsTotal ? ` of ≈${p.cellsTotal}` : ""}`} />}
        {p.retrieved && <KeyValue k="Retrieved" v={p.retrieved.slice(0, 10)} />}
      </div>
      {p.sampling && <p className="text-xs leading-relaxed text-[var(--color-ink-3)]">{p.sampling}</p>}
      {p.notes && p.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-[var(--color-warn)]/90">
          {p.notes.map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span>•</span>
              <span className="text-[var(--color-ink-3)]">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {p.url && (
        <a href={p.url} target="_blank" rel="noreferrer" className="block max-w-full truncate font-mono text-[10.5px] text-[var(--color-ice)] hover:underline" title={p.url}>
          {p.url}
        </a>
      )}
    </div>
  );
}
