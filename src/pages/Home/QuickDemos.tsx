import { useNavigate } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { DEMO_BY_ID, demoPath } from "@/data/demos";
import { getVariable } from "@/data/catalog";
import { useInvestigation } from "@/store/investigation";
import { Reveal } from "@/components/layout/Reveal";

const PICKS = ["jordan-precip", "arctic-warming", "amazon-soil"];

/** One click opens a finished guided investigation (precomputed real NASA data). */
export function QuickDemos() {
  const navigate = useNavigate();
  const openDemo = useInvestigation((s) => s.openDemo);
  const demos = PICKS.map((id) => DEMO_BY_ID[id]).filter(Boolean);
  return (
    <section className="relative py-14" aria-labelledby="quick-demos">
      <div className="container-x">
        <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <h2 id="quick-demos" className="label-mono">
            Open a finished investigation
          </h2>
          <p className="text-xs text-[var(--color-ink-3)]">Real NASA data, precomputed so it opens instantly. Every number is computed by the same tests you can run yourself.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {demos.map((d, i) => (
            <Reveal key={d.id} delay={0.04 * i}>
              <button
                type="button"
                onClick={() => {
                  void openDemo(d);
                  navigate(demoPath(d));
                }}
                className="group relative flex h-full w-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]/50 p-5 text-left transition-[border-color,background] hover:border-[var(--color-line-bright)] hover:bg-[var(--color-surface)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-cyan)]">Finished case · {d.startYear}–{d.endYear}</span>
                  <ArrowUpRight className="h-4 w-4 text-[var(--color-ink-4)] transition-colors group-hover:text-[var(--color-cyan)]" />
                </div>
                <h3 className="mt-5 font-display text-lg leading-snug tracking-[-0.01em]">{d.title}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--color-ink-3)]">{d.why}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {d.variableIds.map((v) => (
                    <span key={v} className="rounded-full border border-[var(--color-line-strong)] px-2 py-0.5 text-[11px] text-[var(--color-ink-2)]">
                      {getVariable(v)?.name}
                    </span>
                  ))}
                </div>
                <span className="mt-4 text-xs font-medium text-[var(--color-ice)]">Open the results →</span>
              </button>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
