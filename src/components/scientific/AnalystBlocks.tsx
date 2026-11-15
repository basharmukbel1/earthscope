import { Link } from "react-router";
import { AlertTriangle, BookOpen, FlaskConical, Lightbulb, Ruler } from "lucide-react";
import type { AnalystBlock } from "@/services/analyst";
import { GLOSSARY } from "@/data/glossary";
import { getVariable } from "@/data/catalog";
import { cn } from "@/utils/cn";

/** Renders analyst output with a strict visual separation of evidence vs hypothesis. */
export function AnalystBlocks({ blocks, className, dense }: { blocks: AnalystBlock[]; className?: string; dense?: boolean }) {
  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "text":
            return (
              <p key={i} className={cn("text-pretty text-[var(--color-ink-2)]", dense ? "text-[13px] leading-relaxed" : "text-sm leading-relaxed")}>
                {b.text}
              </p>
            );
          case "evidence":
            return (
              <div key={i} className="rounded-[var(--radius-md)] border border-[rgb(56_225_255/.22)] bg-[rgb(56_225_255/.04)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Ruler className="h-3.5 w-3.5 text-[var(--color-cyan)]" />
                  <span className="label-mono text-[var(--color-cyan)]">Measured evidence</span>
                  <span className="truncate text-xs text-[var(--color-ink-2)]">· {b.title}</span>
                </div>
                <dl className="space-y-1">
                  {b.items.map((it, j) => (
                    <div key={j} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
                      <dt className="text-[var(--color-ink-3)]">
                        {it.label}
                        {it.detail && <span className="block text-[10.5px] text-[var(--color-ink-4)]">{it.detail}</span>}
                      </dt>
                      <dd className="num text-right font-mono text-[var(--color-ink)]">{it.value}</dd>
                    </div>
                  ))}
                </dl>
                {b.source && <div className="mt-2 truncate text-[10.5px] text-[var(--color-ink-4)]">Source: {b.source}</div>}
              </div>
            );
          case "hypothesis":
            return (
              <div key={i} className="rounded-[var(--radius-md)] border border-dashed border-[rgb(155_140_255/.4)] bg-[var(--color-violet-soft)] p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <Lightbulb className="h-3.5 w-3.5 text-[var(--color-violet)]" />
                  <span className="label-mono text-[var(--color-violet)]">{b.title}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--color-ink-2)]">{b.text}</p>
                {b.tests.length > 0 && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--color-ink-3)]">
                      <FlaskConical className="h-3 w-3" /> How you could test it
                    </div>
                    <ul className="space-y-0.5 pl-4 text-[12px] text-[var(--color-ink-3)] [list-style:circle]">
                      {b.tests.map((t, j) => (
                        <li key={j}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          case "suggestion":
            if (!b.items.length) return null;
            return (
              <div key={i} className="rounded-[var(--radius-md)] border border-[var(--color-line-strong)] p-3">
                <div className="label-mono mb-2">{b.title}</div>
                <ul className="space-y-1.5">
                  {b.items.map((it) => {
                    const v = getVariable(it.variableId);
                    return (
                      <li key={it.variableId} className="flex items-start gap-2 text-[13px]">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ice)]" />
                        <span>
                          <Link to={`/discover?v=${it.variableId}`} className="text-[var(--color-ice)] underline-offset-2 hover:underline">
                            {v?.name ?? it.variableId}
                          </Link>{" "}
                          <span className="text-[var(--color-ink-3)]">— {it.reason}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          case "glossary": {
            const g = GLOSSARY[b.termId];
            if (!g) return null;
            return (
              <div key={i} className="rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-white/[0.02] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <BookOpen className="h-3.5 w-3.5 text-[var(--color-ice)]" />
                  <span className="font-display text-sm text-[var(--color-ink)]">{g.term}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-[var(--color-ink-2)]">{g.long}</p>
                {g.link && (
                  <a href={g.link.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs text-[var(--color-ice)] hover:underline">
                    Further reading: {g.link.label} ↗
                  </a>
                )}
              </div>
            );
          }
          case "caution":
            return (
              <div key={i} className="flex gap-2 rounded-[var(--radius-md)] border border-[rgb(245_197_107/.28)] bg-[rgb(245_197_107/.06)] p-3 text-[12.5px] leading-relaxed text-[var(--color-ink-2)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-warn)]" />
                <span>{b.text}</span>
              </div>
            );
        }
      })}
    </div>
  );
}
