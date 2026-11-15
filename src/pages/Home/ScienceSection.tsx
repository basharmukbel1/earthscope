import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { AtlasLayer, Point, TimeSeries } from "@/types/domain";
import { loadBundledSeries } from "@/services/series";
import { loadAtlas } from "@/services/atlas";
import { mannKendall, senSlope } from "@/stats";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Reveal } from "@/components/layout/Reveal";
import { Eyebrow } from "@/components/ui/Panel";
import { SourceBadge } from "@/components/ui/Badge";
import { fmtP, fmtSigned } from "@/utils/format";

function useSeptemberIce() {
  const [series, setSeries] = useState<TimeSeries | null | undefined>(undefined);
  useEffect(() => {
    loadBundledSeries("sea-ice-extent-arctic-monthly").then(setSeries);
  }, []);
  return useMemo(() => {
    if (!series) return { series, sept: null as Point[] | null, stats: null };
    const sept = series.points.filter((p) => p.date.endsWith("-09") && p.v !== null).map((p) => ({ ...p, t: Math.floor(p.t) + 0.5, date: p.date.slice(0, 4) }));
    const t = sept.map((p) => p.t);
    const v = sept.map((p) => p.v);
    const mk = mannKendall(v, 0.05);
    const sen = senSlope(t, v, 0.05);
    return { series, sept, stats: { mk, sen } };
  }, [series]);
}

export function ScienceSection() {
  const { series, sept, stats } = useSeptemberIce();
  const [atlas, setAtlas] = useState<AtlasLayer | null>(null);
  useEffect(() => {
    loadAtlas("precip").then(setAtlas);
  }, []);
  const up = atlas?.points.filter((p) => p.sig && p.slope > 0).length ?? 0;
  const down = atlas?.points.filter((p) => p.sig && p.slope < 0).length ?? 0;
  const ns = atlas ? atlas.points.length - up - down : 0;

  return (
    <section className="relative border-t border-[var(--color-line)] bg-[var(--color-abyss)] py-[var(--space-section)]">
      <div className="container-x">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.4fr] lg:gap-16">
          <div>
            <Reveal>
              <Eyebrow index="03">The science</Eyebrow>
            </Reveal>
            <Reveal delay={0.05}>
              <h2 className="mt-6 font-display text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] tracking-[-0.035em]">
                Is it a trend —<br />
                <span className="text-[var(--color-ink-3)]">or just noise?</span>
              </h2>
            </Reveal>
            <div className="mt-10 space-y-8">
              {[
                {
                  k: "Trend detection",
                  t: "Sen's slope measures the typical change per year using every pair of years — robust to outliers and odd values.",
                },
                {
                  k: "Statistical significance",
                  t: "The Mann-Kendall test asks how often random variability alone would produce a trend this consistent. Small p-values mean “unlikely to be chance”.",
                },
                {
                  k: "Regional differences",
                  t: "The same process can raise rainfall in one region and lower it in another — so every region gets its own test.",
                },
              ].map((c, i) => (
                <Reveal key={c.k} delay={0.08 * i}>
                  <div className="grid grid-cols-[2.5rem_1fr] gap-3">
                    <span className="font-mono text-xs text-[var(--color-cyan)]">0{i + 1}</span>
                    <div>
                      <h3 className="font-display text-lg tracking-[-0.01em]">{c.k}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-3)]">{c.t}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <Reveal>
              <ChartFrame
                eyebrow="Fig. 1 · Real satellite record"
                title="Arctic sea-ice extent every September"
                subtitle="End-of-summer minimum, one value per year"
                unit="million km²"
                status={series === undefined ? "loading" : !sept?.length ? "empty" : "ready"}
                emptyMessage="The bundled NSIDC record is not available in this build."
                stateHeight={300}
                caption={
                  series ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <SourceBadge provenance={series.provenance} />
                      <span>NSIDC Sea Ice Index (G02135), passive-microwave satellites. Trend computed in your browser.</span>
                    </span>
                  ) : undefined
                }
              >
                {sept && stats && (
                  <TimeSeriesChart
                    height={300}
                    series={[{ id: "sept", label: "September extent", points: sept, variant: "line" }]}
                    trend={{
                      slopePerYear: stats.sen.slope,
                      intercept: stats.sen.intercept,
                      ciLow: stats.sen.ciLow,
                      ciHigh: stats.sen.ciHigh,
                      significant: stats.mk.p < 0.05,
                      label: "Sen's slope",
                      direction: stats.sen.slope > 0 ? "increasing" : stats.sen.slope < 0 ? "decreasing" : "no-trend",
                    }}
                    yLabel="Extent"
                    unit="million km²"
                    decimals={2}
                    ariaLabel="September Arctic sea-ice extent by year with Sen's slope trend line and confidence interval"
                  />
                )}
              </ChartFrame>
            </Reveal>
            {stats && sept && (
              <Reveal delay={0.1}>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-4">
                  {[
                    { k: "Sen's slope", v: `${fmtSigned(stats.sen.slope * 10, 2)}`, u: "M km² / decade" },
                    { k: "95% CI", v: `${fmtSigned(stats.sen.ciLow * 10, 2)} … ${fmtSigned(stats.sen.ciHigh * 10, 2)}`, u: "M km² / decade" },
                    { k: "Mann-Kendall p", v: fmtP(stats.mk.p), u: stats.mk.p < 0.05 ? "significant" : "not significant" },
                    { k: "Years", v: String(sept.length), u: `${sept[0].date}–${sept[sept.length - 1].date}` },
                  ].map((s) => (
                    <div key={s.k} className="bg-[var(--color-abyss)] p-4">
                      <div className="label-mono mb-1.5">{s.k}</div>
                      <div className="num font-display text-xl tracking-[-0.02em]">{s.v}</div>
                      <div className="text-[11px] text-[var(--color-ink-4)]">{s.u}</div>
                    </div>
                  ))}
                </div>
              </Reveal>
            )}
            {atlas && (
              <Reveal delay={0.15}>
                <div className="panel p-5">
                  <div className="label-mono mb-3">Regional differences · precipitation {atlas.startYear}–{atlas.endYear}</div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    <div style={{ width: `${(up / atlas.points.length) * 100}%` }} className="bg-[var(--color-rise)]" title={`${up} significant increases`} />
                    <div style={{ width: `${(ns / atlas.points.length) * 100}%` }} className="hatch-missing bg-white/[0.03]" title={`${ns} not significant`} />
                    <div style={{ width: `${(down / atlas.points.length) * 100}%` }} className="bg-[var(--color-fall)]" title={`${down} significant decreases`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-ink-3)]">
                    <span><span className="text-[var(--color-rise)]">▲ {up}</span> locations wetter (significant)</span>
                    <span><span className="text-[var(--color-ink-2)]">◇ {ns}</span> no significant change</span>
                    <span><span className="text-[var(--color-fall)]">▼ {down}</span> locations drier (significant)</span>
                  </div>
                  <p className="mt-3 text-xs text-[var(--color-ink-4)]">
                    {atlas.points.length} equal-area sample points, NASA POWER (MERRA-2) annual totals; Mann-Kendall with Benjamini–Hochberg false-discovery control (q = {atlas.fdrAlpha}).{" "}
                    <Link to="/explorer" className="text-[var(--color-ice)] hover:underline">See them on the globe →</Link>
                  </p>
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
