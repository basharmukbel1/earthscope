import { useEffect, useState } from "react";
import { CloudSun, Droplets, Mountain, Waves } from "lucide-react";
import { CATEGORIES, MISSIONS, VARIABLES } from "@/data/catalog";
import { loadAtlasManifest, type AtlasManifest } from "@/services/atlas";
import { Reveal } from "@/components/layout/Reveal";
import { CountUp } from "@/components/ui/Controls";
import { Eyebrow } from "@/components/ui/Panel";

const ICONS = { atmosphere: CloudSun, land: Mountain, water: Droplets, ocean: Waves } as const;

export function ChallengeSection() {
  const [manifest, setManifest] = useState<AtlasManifest | null>(null);
  useEffect(() => {
    loadAtlasManifest().then(setManifest);
  }, []);
  const tests = manifest?.variables.reduce((s, v) => s + v.points, 0) ?? 0;
  const years = manifest?.variables[0]?.endYear && manifest.variables[0].startYear ? manifest.variables[0].endYear - manifest.variables[0].startYear + 1 : 45;

  return (
    <section id="challenge" className="relative py-[var(--space-section)]">
      <div className="container-x">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <Reveal>
              <Eyebrow index="01">The challenge</Eyebrow>
            </Reveal>
            <Reveal delay={0.05}>
              <h2 className="mt-6 font-display text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] tracking-[-0.035em] text-balance">
                One planet.
                <br />
                <span className="text-[var(--color-ink-3)]">Millions of environmental signals.</span>
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-8 max-w-[52ch] text-[var(--color-ink-2)] leading-relaxed text-pretty">
                Change is always occurring in Earth's interconnected system. When it runs in a consistent direction — rising or falling, thickening
                or thinning — the measured variables reflect it. But the same process can push one region up and its neighbour down, and there are
                thousands of variables to choose from.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <p className="mt-4 max-w-[52ch] text-[var(--color-ink-3)] leading-relaxed text-pretty">
                EARTHSCOPE turns that complexity into a detective workflow: find a variable, choose a region, build the time series, and test whether
                the change is what scientists call <em className="not-italic text-[var(--color-ice)]">significant</em>.
              </p>
            </Reveal>
          </div>

          <div className="grid content-start gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
            {[
              { n: VARIABLES.length, label: "Earth-science variables catalogued", sub: "with plain-language definitions" },
              { n: MISSIONS.length, label: "Missions & models referenced", sub: "MODIS · OMI · AIRS · GPM · MERRA-2 · GLDAS …" },
              { n: years, label: "Years of monthly record", sub: "NASA POWER · MERRA-2 reanalysis" },
              { n: tests, label: "Trend tests in the global atlas", sub: "Mann-Kendall + FDR, computed from real data" },
            ].map((s, i) => (
              <Reveal key={s.label} delay={0.05 * i} className="bg-[var(--color-abyss)] p-7">
                <div className="font-display text-[3.2rem] leading-none tracking-[-0.04em] text-[var(--color-ink)]">
                  <CountUp value={s.n} />
                </div>
                <div className="mt-3 text-sm text-[var(--color-ink-2)]">{s.label}</div>
                <div className="mt-1 text-xs text-[var(--color-ink-4)]">{s.sub}</div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c, i) => {
            const Icon = ICONS[c.id];
            const count = VARIABLES.filter((v) => v.category === c.id).length;
            return (
              <Reveal key={c.id} delay={0.06 * i}>
                <div className="group relative h-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-gradient-to-b from-[var(--color-surface)] to-transparent p-6 transition-colors hover:border-[var(--color-line-strong)]">
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-[var(--color-ice)]" />
                    <span className="label-mono">{c.code}</span>
                  </div>
                  <h3 className="mt-10 font-display text-2xl tracking-[-0.02em]">{c.label}</h3>
                  <p className="mt-2 text-sm text-[var(--color-ink-3)]">{c.blurb}</p>
                  <div className="label-mono mt-6 text-[var(--color-cyan)]">{count} variables</div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
