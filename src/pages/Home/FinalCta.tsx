import { ArrowRight, Globe2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/layout/Reveal";
import { Eyebrow } from "@/components/ui/Panel";

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-[var(--color-line)] py-[calc(var(--space-section)*1.2)]">
      {/* planetary limb */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[62%] -z-10 aspect-square w-[160vw] max-w-[2200px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_50%_50%,#0b1830_0%,#060c1a_55%,transparent_70%)]" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[62%] -z-10 aspect-square w-[160vw] max-w-[2200px] -translate-x-1/2 rounded-full shadow-[0_-30px_120px_-10px_rgb(80_170_255/.35)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_14%)] border-t border-[rgb(168_216_255/.4)]" />
      <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.35]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="orbit" x1="0" x2="1">
            <stop offset="0" stopColor="#38e1ff" stopOpacity="0" />
            <stop offset=".5" stopColor="#38e1ff" stopOpacity=".6" />
            <stop offset="1" stopColor="#38e1ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <ellipse cx="50%" cy="78%" rx="46%" ry="18%" fill="none" stroke="url(#orbit)" strokeWidth="1" />
      </svg>
      <div className="container-x text-center">
        <Reveal>
          <Eyebrow index="05" className="justify-center">
            Start exploring
          </Eyebrow>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="display-xl mx-auto mt-8 max-w-[16ch] text-[clamp(2.6rem,6.4vw,6rem)]">
            What will you <span className="text-[var(--color-ice)]">discover?</span>
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-[48ch] text-[var(--color-ink-2)] text-pretty">
            Pick a place you care about and a variable that matters to it. In under a minute EARTHSCOPE will tell you what changed, by how much,
            and whether it's significant.
          </p>
        </Reveal>
        <Reveal delay={0.18}>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink to="/investigate" variant="primary" size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
              Start Your Investigation
            </ButtonLink>
            <ButtonLink to="/discover" variant="secondary" size="lg" icon={<Globe2 className="h-4 w-4" />}>
              Browse variables
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
