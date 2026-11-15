import { ExternalLink } from "lucide-react";
import { CHALLENGE_DISCLAIMER, RESOURCES, RESOURCE_GROUPS } from "@/data/resources";
import { GLOSSARY } from "@/data/glossary";
import { Reveal } from "@/components/layout/Reveal";

export default function ResourcesPage() {
  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <div className="container-x py-14">
        <div className="label-mono mb-3 text-[var(--color-cyan)]">Resources & methods</div>
        <h1 className="max-w-[20ch] font-display text-[clamp(2rem,4.4vw,3.6rem)] leading-[1.04] tracking-[-0.03em]">Data sources, challenge resources and how EARTHSCOPE uses them</h1>
        <p className="mt-4 max-w-[64ch] text-[var(--color-ink-2)]">
          Every resource listed for the NASA Space Apps 2026 challenge “Be An Earth System Trend Detective!”, plus the NASA services EARTHSCOPE calls directly.
        </p>

        {RESOURCE_GROUPS.map((g) => (
          <section key={g.id} className="mt-14" aria-labelledby={`g-${g.id}`}>
            <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-3">
              <h2 id={`g-${g.id}`} className="font-display text-2xl tracking-[-0.02em]">{g.label}</h2>
              <span className="label-mono">{g.note}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {RESOURCES.filter((r) => r.group === g.id).map((r, i) => (
                <Reveal key={r.url} delay={0.03 * i} y={10}>
                  <article className="flex h-full flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]/40 p-5">
                    <div className="label-mono mb-2">{r.provider}</div>
                    <a href={r.url} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-2 font-display text-lg leading-snug tracking-[-0.01em] hover:text-[var(--color-cyan)]">
                      {r.title}
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 opacity-50 group-hover:opacity-100" />
                    </a>
                    <p className="mt-2 text-sm text-[var(--color-ink-3)]">{r.description}</p>
                    <p className="mt-auto pt-4 text-sm text-[var(--color-ink-2)]">
                      <span className="text-[var(--color-ice)]">In EARTHSCOPE · </span>
                      {r.usage}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-16" aria-labelledby="glossary">
          <h2 id="glossary" className="mb-5 border-b border-[var(--color-line)] pb-3 font-display text-2xl tracking-[-0.02em]">Glossary</h2>
          <dl className="grid gap-x-10 gap-y-6 md:grid-cols-2">
            {Object.entries(GLOSSARY).map(([id, g]) => (
              <div key={id} id={`term-${id}`}>
                <dt className="font-display text-base text-[var(--color-ink)]">{g.term}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-[var(--color-ink-3)]">{g.long}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16 rounded-[var(--radius-lg)] border border-[var(--color-line)] p-6 text-sm text-[var(--color-ink-3)]">
          <div className="label-mono mb-2">Disclaimers</div>
          <p>{CHALLENGE_DISCLAIMER}</p>
          <p className="mt-3">
            EARTHSCOPE is an independent NASA Space Apps Challenge project and is not an official NASA product. NASA POWER data: “These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied
            Science Program.” Imagery courtesy of NASA GIBS / ESDIS. Sea-ice data courtesy of NSIDC.
          </p>
          <p className="mt-3">
            AI disclosure: AI coding assistants were used to help build this software. The in-app AI Scientist is a deterministic rule-based analyst by default; when an LLM endpoint is configured, answers are labelled as model-generated.
          </p>
        </section>
      </div>
    </div>
  );
}
