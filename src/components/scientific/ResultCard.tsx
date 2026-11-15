import { motion } from "motion/react";
import type { AnalysisResult, Variable } from "@/types/domain";
import { TrendBadge } from "@/components/ui/Badge";
import { InfoTip } from "@/components/ui/Controls";
import { fmt, fmtP, fmtPct, fmtSigned } from "@/utils/format";
import { pctPerDecade, resultAnnualUnit } from "@/utils/trend";
import { cn } from "@/utils/cn";
import { singleSeriesPolicy } from "@/data/significance";
import { plainSentence } from "@/utils/plainSentence";

/** Primary scientific result: direction, magnitude, CI, p, n — with significance shown by glyph + label + line style. */
export function ResultCard({ result, variable, title, className, regionName }: { result: AnalysisResult; variable: Variable; title?: string; className?: string; regionName?: string }) {
  const s = result.summary;
  const unit = `${resultAnnualUnit(result, variable)} / decade`;
  const tone = !s.significant ? "var(--color-flat)" : s.direction === "increasing" ? "var(--color-rise)" : "var(--color-fall)";
  const ciSpan = Math.max(Math.abs(s.perDecadeCi[0]), Math.abs(s.perDecadeCi[1]), Math.abs(s.perDecade)) * 1.15 || 1;
  const pos = (x: number) => 50 + (x / ciSpan) * 50;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("panel relative overflow-hidden p-4", className)}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${tone}, transparent)` }} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-mono mb-1">{title ?? "Trend finding"}</div>
          <div className="truncate text-sm text-[var(--color-ink-2)]">{variable.name}</div>
        </div>
        <TrendBadge direction={s.direction} significant={s.significant} compact />
      </div>

      <p className="mb-3 text-pretty text-[13px] leading-relaxed text-[var(--color-ink)]">{plainSentence(result, variable, regionName)}</p>

      <div className="flex items-baseline gap-2">
        <span className="num font-display text-[2.1rem] leading-none tracking-[-0.03em]" style={{ color: tone }}>
          {fmtSigned(s.perDecade, variable.decimals)}
        </span>
        <span className="font-mono text-xs text-[var(--color-ink-3)]">{unit}</span>
      </div>
      <div className="mt-1 text-xs text-[var(--color-ink-3)]">
        {pctPerDecade(result, variable) !== null ? `${fmtPct(pctPerDecade(result, variable))} of long-term mean per decade · ` : ""}
        {fmtSigned(s.totalChange, variable.decimals)} over {result.endYear - result.startYear + 1} yrs
      </div>

      {/* CI strip */}
      <div className="mt-4" aria-label={`95% confidence interval from ${fmt(s.perDecadeCi[0], variable.decimals)} to ${fmt(s.perDecadeCi[1], variable.decimals)}`}>
        <div className="relative h-6">
          <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--color-line-strong)]" />
          <div className="absolute top-0 h-6 w-px bg-[var(--color-ink-4)]" style={{ left: "50%" }} title="zero" />
          <div
            className={cn("absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full", !s.significant && "opacity-80")}
            style={{
              left: `${pos(Math.min(...s.perDecadeCi))}%`,
              width: `${Math.max(1, pos(Math.max(...s.perDecadeCi)) - pos(Math.min(...s.perDecadeCi)))}%`,
              background: s.significant ? tone : `repeating-linear-gradient(90deg, ${tone} 0 4px, transparent 4px 7px)`,
            }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{ left: `${pos(s.perDecade)}%`, borderColor: tone, background: s.significant ? tone : "var(--color-void)" }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--color-ink-4)]">
          <span>{fmtSigned(s.perDecadeCi[0], variable.decimals)}</span>
          <span>95% CI</span>
          <span>{fmtSigned(s.perDecadeCi[1], variable.decimals)}</span>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-[var(--color-line)] pt-3">
        <div>
          <dt className="label-mono flex items-center gap-1">
            p-value <InfoTip label="What is a p-value?">Probability of a trend at least this strong if the true trend were zero. Below {s.alpha} = significant.</InfoTip>
          </dt>
          <dd className="num mt-0.5 font-mono text-sm text-[var(--color-ink)]">{fmtP(s.p)}</dd>
        </div>
        <div>
          <dt className="label-mono">Years</dt>
          <dd className="num mt-0.5 font-mono text-sm text-[var(--color-ink)]">{result.endYear - result.startYear + 1}</dd>
        </div>
        <div>
          <dt className="label-mono">Missing</dt>
          <dd className="num mt-0.5 font-mono text-sm text-[var(--color-ink)]">{fmt(result.missingPct, 1)}%</dd>
        </div>
      </dl>
      <div className="mt-3 text-[11px] text-[var(--color-ink-4)]">
        {s.method} · {singleSeriesPolicy(s.alpha)}
      </div>
    </motion.div>
  );
}
