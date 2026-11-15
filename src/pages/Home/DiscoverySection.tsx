import { useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { DATA_LAYERS, clampTime, gibsWmsUrl } from "@/services/gibs";
import { getVariable } from "@/data/catalog";
import { Reveal } from "@/components/layout/Reveal";
import { Eyebrow } from "@/components/ui/Panel";
import { cn } from "@/utils/cn";
import { fmtDateKey } from "@/utils/format";

const PREFERRED = ["t2m", "precip", "ndvi", "aod", "sst", "water-storage"];

function LayerTile({ id, title, variableId, time, big }: { id: string; title: string; variableId?: string; time?: string; big?: boolean }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const v = variableId ? getVariable(variableId) : undefined;
  return (
    <figure className={cn("group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[#050913]", big && "md:col-span-2 md:row-span-2")}>
      <div className="relative aspect-[2/1] w-full">
        <img src="/textures/earth-night-2k.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-30 saturate-0" loading="lazy" />
        <img
          src={gibsWmsUrl(id, { time, width: big ? 1440 : 720, height: big ? 720 : 360 })}
          alt={`${title} — NASA GIBS imagery${time ? ` for ${fmtDateKey(time.slice(0, 7))}` : ""}`}
          className={cn("absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-700 group-hover:scale-[1.03]", state === "ok" ? "opacity-100" : "opacity-0")}
          loading="lazy"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
        />
        {state === "loading" && <div className="skeleton absolute inset-0 rounded-none opacity-40" />}
        {state === "error" && <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-ink-3)]">GIBS imagery unavailable right now</div>}
        <div className="absolute inset-0 bg-gradient-to-t from-[rgb(4_6_12/.96)] via-[rgb(4_6_12/.45)] to-transparent" />
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="label-mono mb-1 text-[var(--color-cyan)]">{v?.category ?? "layer"}</div>
          <div className="truncate font-display text-lg tracking-[-0.01em]">{v?.name ?? title}</div>
          <div className="truncate font-mono text-[10.5px] text-[var(--color-ink-3)]">
            {title}
            {time ? ` · ${fmtDateKey(time.slice(0, 7))}` : ""}
          </div>
        </div>
        {v && (
          <Link to={`/explorer?layer=${id}`} aria-label={`Open ${v.name} in Earth Explorer`} className="rounded-full border border-[var(--color-line-strong)] p-2 text-[var(--color-ink-2)] transition-colors hover:border-[var(--color-cyan)] hover:text-[var(--color-cyan)]">
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </figcaption>
    </figure>
  );
}

export function DiscoverySection() {
  const layers = PREFERRED.map((vid) => DATA_LAYERS.find((l) => l.variableId === vid)).filter((l): l is NonNullable<typeof l> => !!l);
  return (
    <section className="relative border-t border-[var(--color-line)] py-[var(--space-section)]">
      <div className="container-x">
        <div className="mb-14 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Reveal>
              <Eyebrow index="02">The discovery</Eyebrow>
            </Reveal>
            <Reveal delay={0.05}>
              <h2 className="mt-6 max-w-[18ch] font-display text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] tracking-[-0.035em]">
                Every layer is a measurement of a changing world.
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            <p className="max-w-[40ch] text-[var(--color-ink-3)] text-pretty">
              Real NASA imagery streamed from GIBS — the most recent month available for each layer. Each one maps to a variable you can investigate.
            </p>
          </Reveal>
        </div>
        {layers.length ? (
          <div className="grid gap-4 md:grid-cols-4 md:grid-rows-2">
            {layers.map((l, i) => (
              <Reveal key={l.id} delay={0.05 * i} className={cn(i === 0 && "md:col-span-2 md:row-span-2")}>
                <LayerTile id={l.id} title={l.title} variableId={l.variableId} time={clampTime(l)} big={i === 0} />
              </Reveal>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-3)]">GIBS layer metadata is not bundled in this build.</p>
        )}
      </div>
    </section>
  );
}
