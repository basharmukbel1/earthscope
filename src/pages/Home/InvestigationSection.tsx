import { Link } from "react-router";
import { ArrowUpRight, Crosshair, FlaskConical, Layers, MessageSquareText, Play } from "lucide-react";
import { DEMOS } from "@/data/demos";
import { getVariable } from "@/data/catalog";
import { Reveal } from "@/components/layout/Reveal";
import { Eyebrow } from "@/components/ui/Panel";

const STEPS = [
  { icon: MessageSquareText, title: "Ask a question", body: "“Is precipitation decreasing in Jordan?” — EARTHSCOPE suggests matching variables and finds the region." },
  { icon: Layers, title: "Choose variables", body: "Plain-language definitions, the NASA mission or model behind each one, units, resolution and record length." },
  { icon: Crosshair, title: "Select a region", body: "Click a country, search a place, draw a box, or type coordinates. Every grid cell inside is sampled." },
  { icon: FlaskConical, title: "Test the trend", body: "Time series, anomalies, Mann-Kendall, Sen's slope, regression with confidence intervals — and what it means." },
];

export function InvestigationSection() {
  return (
    <section className="relative border-t border-[var(--color-line)] py-[var(--space-section)]">
      <div className="container-x">
        <Reveal>
          <Eyebrow index="04">The investigation</Eyebrow>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="mt-6 max-w-[20ch] font-display text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] tracking-[-0.035em]">
            Become a data detective in four moves.
          </h2>
        </Reveal>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={0.06 * i} className="relative bg-[var(--color-void)] p-7">
              <div className="flex items-center justify-between">
                <s.icon className="h-5 w-5 text-[var(--color-cyan)]" />
                <span className="font-mono text-xs text-[var(--color-ink-4)]">STEP 0{i + 1}</span>
              </div>
              <h3 className="mt-12 font-display text-xl tracking-[-0.015em]">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-3)]">{s.body}</p>
            </Reveal>
          ))}
        </ol>

        <div className="mt-20 flex items-end justify-between gap-6">
          <Reveal>
            <div>
              <div className="label-mono mb-2">Guided demonstrations</div>
              <p className="max-w-[52ch] text-sm text-[var(--color-ink-3)]">
                Watch EARTHSCOPE run a full investigation step by step. Results are computed live from NASA data when the demo runs — nothing is pre-written.
              </p>
            </div>
          </Reveal>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DEMOS.map((d, i) => (
            <Reveal key={d.id} delay={0.04 * i}>
              <Link
                to={`/investigate?demo=${d.id}`}
                className="group relative flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]/50 p-5 transition-[border-color,background] hover:border-[var(--color-line-bright)] hover:bg-[var(--color-surface)]"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-cyan)]">
                    <Play className="h-3 w-3" /> Demo {String(i + 1).padStart(2, "0")}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-[var(--color-ink-4)] transition-colors group-hover:text-[var(--color-cyan)]" />
                </div>
                <h3 className="mt-6 font-display text-lg leading-snug tracking-[-0.01em]">{d.title}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--color-ink-3)]">{d.why}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {d.variableIds.map((v) => (
                    <span key={v} className="rounded-full border border-[var(--color-line-strong)] px-2 py-0.5 text-[11px] text-[var(--color-ink-2)]">
                      {getVariable(v)?.name}
                    </span>
                  ))}
                  <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--color-ink-3)]">
                    {d.startYear}–{d.endYear}
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
