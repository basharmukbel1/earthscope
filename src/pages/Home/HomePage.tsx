import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowRight, Globe2 } from "lucide-react";
import type { AtlasLayer } from "@/types/domain";
import { ButtonLink } from "@/components/ui/Button";
import { GlobeSlot } from "@/components/layout/GlobeSlot";
import { loadAtlas } from "@/services/atlas";
import { subsolarPoint } from "@/utils/sun";
import { fmtLat, fmtLon } from "@/utils/format";
import { ChallengeSection } from "./ChallengeSection";
import { DiscoverySection } from "./DiscoverySection";
import { ScienceSection } from "./ScienceSection";
import { InvestigationSection } from "./InvestigationSection";
import { FinalCta } from "./FinalCta";

function useSubsolar() {
  const [p, setP] = useState(() => ({ ...subsolarPoint(), at: new Date() }));
  useEffect(() => {
    const id = setInterval(() => setP({ ...subsolarPoint(), at: new Date() }), 30_000);
    return () => clearInterval(id);
  }, []);
  return p;
}

function Hero() {
  const [atlas, setAtlas] = useState<AtlasLayer | null>(null);
  const sun = useSubsolar();
  const { scrollY } = useScroll();
  const globeY = useTransform(scrollY, [0, 900], [0, 140]);
  const textY = useTransform(scrollY, [0, 900], [0, -60]);
  const fade = useTransform(scrollY, [0, 600], [1, 0]);

  useEffect(() => {
    loadAtlas("precip").then(setAtlas);
  }, []);

  const lines = ["THE EARTH IS", "ALWAYS CHANGING."];

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-[var(--color-void)]" aria-label="Introduction">
      {/* atmosphere wash */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_70%_at_72%_52%,rgb(40_110_220/.16),transparent_70%)]" />
      <motion.div style={{ y: globeY }} className="absolute inset-0 -z-10">
        <GlobeSlot
          mode="globe"
          framing="hero-right"
          autoRotate
          interactive={false}
          atlas={atlas}
          atlasFilter={{ direction: "all", significance: "significant" }}
          showNight
          showAtmosphere
          showClouds
          showGraticule
          showBorders={false}
          className="h-full w-full"
          posterClassName="absolute inset-y-0 right-[-10%] w-[75%]"
        />
      </motion.div>
      {/* readability gradient for the copy */}
      <div className="pointer-events-none absolute inset-0 -z-[5] bg-[linear-gradient(90deg,rgb(4_6_12/.92)_0%,rgb(4_6_12/.65)_38%,transparent_62%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-[5] h-48 bg-gradient-to-t from-[var(--color-void)] to-transparent" />

      <motion.div style={{ y: textY, opacity: fade }} className="container-x relative flex min-h-[100svh] flex-col justify-center pb-28 pt-[calc(var(--nav-h)+2rem)]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }} className="label-mono mb-8 flex items-center gap-3">
          <span className="text-[var(--color-cyan)]">01</span>
          <span className="h-px w-8 bg-[var(--color-line-bright)]" />
          <span>Earth observation system</span>
        </motion.div>

        <h1 className="display-xl max-w-[13ch] text-[clamp(3rem,6.9vw,7rem)] text-[var(--color-ink)]" aria-label="The Earth is always changing.">
          {lines.map((line, i) => (
            <span key={line} className="block overflow-hidden pb-[0.06em]">
              <motion.span
                className={i === 1 ? "block bg-gradient-to-r from-[var(--color-ink)] via-[#cfe9ff] to-[var(--color-ice)] bg-clip-text text-transparent" : "block"}
                initial={{ y: "105%" }}
                animate={{ y: 0 }}
                transition={{ delay: 0.25 + i * 0.12, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.9 }}
          className="mt-8 max-w-[46ch] text-[1.05rem] leading-relaxed text-[var(--color-ink-2)] text-pretty md:text-lg"
        >
          Explore the hidden patterns of our planet through NASA Earth observation data, advanced statistical analysis, and intelligent scientific
          discovery.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, duration: 0.9 }} className="mt-10 flex flex-wrap gap-3">
          <ButtonLink to="/investigate" variant="primary" size="lg" iconRight={<ArrowRight className="h-4 w-4" />}>
            Start Your Investigation
          </ButtonLink>
          <ButtonLink to="/explorer" variant="secondary" size="lg" icon={<Globe2 className="h-4 w-4" />}>
            Explore the Earth
          </ButtonLink>
        </motion.div>
      </motion.div>

      {/* telemetry strip */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.1, duration: 1 }}
        className="absolute inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[rgb(4_6_12/.55)] backdrop-blur-md"
      >
        <div className="container-x grid grid-cols-2 gap-x-6 gap-y-3 py-4 md:grid-cols-4">
          <Telemetry k="Coverage" v="Global · land, ocean, atmosphere" />
          <Telemetry k="NASA data sources" v="POWER · GIBS · MODIS · MERRA-2" />
          <Telemetry k="Sub-solar point" v={`${fmtLat(sun.lat)} ${fmtLon(sun.lon)}`} hint={`Sun directly overhead · ${sun.at.toISOString().slice(11, 16)} UTC`} />
          <Telemetry
            k="Globe markers"
            v={atlas ? `▲ ${atlas.points.filter((p) => p.sig && p.slope > 0).length} wetter · ▼ ${atlas.points.filter((p) => p.sig && p.slope < 0).length} drier` : "Loading trend atlas…"}
            hint={atlas ? `Significant precipitation trends · NASA POWER ${atlas.startYear}–${atlas.endYear}` : undefined}
          />
        </div>
      </motion.div>

      <a
        href="#challenge"
        className="absolute bottom-24 right-[var(--space-gutter)] hidden items-center gap-2 text-[var(--color-ink-3)] transition-colors hover:text-[var(--color-ink)] md:flex"
        aria-label="Scroll to learn more"
      >
        <span className="label-mono">Scroll</span>
        <ArrowDown className="h-4 w-4 animate-bounce [animation-duration:2.4s]" />
      </a>
    </section>
  );
}

function Telemetry({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <div className="label-mono mb-1 text-[10px]">{k}</div>
      <div className="num truncate font-mono text-[12px] text-[var(--color-ink)]">{v}</div>
      {hint && <div className="truncate text-[10.5px] text-[var(--color-ink-4)]">{hint}</div>}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />
      <ChallengeSection />
      <DiscoverySection />
      <ScienceSection />
      <InvestigationSection />
      <FinalCta />
      <div className="sr-only">
        <Link to="/resources">Data sources and methods</Link>
      </div>
    </>
  );
}
