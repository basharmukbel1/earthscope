import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Database, ExternalLink, Satellite, Search, Server, X } from "lucide-react";
import type { Category, Variable } from "@/types/domain";
import { CATEGORIES, MISSIONS, TOOL_INFO, VARIABLES, getVariable } from "@/data/catalog";
import { RESOURCES } from "@/data/resources";
import { clampTime, getGibsLayer, gibsWmsUrl } from "@/services/gibs";
import { listBundledSeries } from "@/services/series";
import { useInvestigation } from "@/store/investigation";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { EmptyState } from "@/components/ui/States";
import { Reveal } from "@/components/layout/Reveal";
import { cn } from "@/utils/cn";
import { fmtDateKey } from "@/utils/format";

function ConnectorBadge({ v }: { v: Variable }) {
  if (v.connector.kind === "power") return <Badge tone="cyan" title="Fetched live from NASA POWER in-app">● Analyse in-app · POWER</Badge>;
  if (v.connector.kind === "bundled") return <Badge tone="ice" title="Real data snapshot bundled with EARTHSCOPE">◆ Bundled real data</Badge>;
  return <Badge tone="neutral" title="Export a CSV from the linked tool and import it">↥ Import from {TOOL_INFO[v.connector.tools[0]].label}</Badge>;
}

function VariableCard({ v, active, onOpen }: { v: Variable; active: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group relative flex h-full flex-col rounded-[var(--radius-lg)] border p-5 text-left transition-[border-color,background,transform] duration-300",
        active ? "border-[var(--color-cyan)] bg-[var(--color-surface)]" : "border-[var(--color-line)] bg-[var(--color-surface)]/40 hover:-translate-y-0.5 hover:border-[var(--color-line-bright)] hover:bg-[var(--color-surface)]",
      )}
      aria-pressed={active}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="label-mono">{CATEGORIES.find((c) => c.id === v.category)?.code} · {v.shortName}</span>
        <span className="font-mono text-[11px] text-[var(--color-ink-3)]">{v.unit}</span>
      </div>
      <h3 className="mt-4 font-display text-lg leading-snug tracking-[-0.015em]">{v.name}</h3>
      <p className="mt-2 line-clamp-3 flex-1 text-[13px] leading-relaxed text-[var(--color-ink-3)]">{v.definition}</p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--color-line)] pt-3 text-[11px]">
        <dt className="text-[var(--color-ink-4)]">Source</dt>
        <dd className="truncate text-right text-[var(--color-ink-2)]">{v.dataset.mission}</dd>
        <dt className="text-[var(--color-ink-4)]">Temporal</dt>
        <dd className="truncate text-right text-[var(--color-ink-2)]">{v.dataset.temporal}</dd>
        <dt className="text-[var(--color-ink-4)]">Range</dt>
        <dd className="num truncate text-right font-mono text-[var(--color-ink-2)]">{v.dataset.timeRange}</dd>
      </dl>
      <div className="mt-4">
        <ConnectorBadge v={v} />
      </div>
    </button>
  );
}

function Detail({ v, onClose }: { v: Variable; onClose: () => void }) {
  const navigate = useNavigate();
  const loadBundled = useInvestigation((s) => s.loadBundled);
  const [bundled, setBundled] = useState<string[]>([]);
  const layer = getGibsLayer(v.gibsLayer);
  const time = layer ? clampTime(layer) : undefined;
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  useEffect(() => {
    listBundledSeries().then(setBundled);
    setImgOk(null);
  }, [v.id]);
  const snapshots = v.connector.kind === "bundled" ? v.connector.snapshotIds.filter((id) => bundled.includes(id)) : [];

  return (
    <motion.aside
      key={v.id}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      className="panel sticky top-[calc(var(--nav-h)+1rem)] max-h-[calc(100dvh-var(--nav-h)-2rem)] overflow-y-auto"
      aria-label={`${v.name} details`}
    >
      <div className="relative aspect-[2/1] w-full overflow-hidden rounded-t-[var(--radius-lg)] bg-[#050913]">
        <img src="/textures/earth-night-2k.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-25 saturate-0" />
        {layer && (
          <img
            src={gibsWmsUrl(layer.id, { time, width: 800, height: 400 })}
            alt={`${layer.title} — NASA GIBS${time ? `, ${fmtDateKey(time.slice(0, 7))}` : ""}`}
            className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", imgOk ? "opacity-100" : "opacity-0")}
            onLoad={() => setImgOk(true)}
            onError={() => setImgOk(false)}
          />
        )}
        {layer && imgOk === null && <div className="skeleton absolute inset-0 rounded-none opacity-40" />}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgb(4_6_12/.9)] to-transparent p-3">
          <div className="truncate font-mono text-[10px] text-[var(--color-ink-3)]">
            {layer ? `GIBS · ${layer.title}${time ? ` · ${fmtDateKey(time.slice(0, 7))}` : ""}` : "No global imagery layer for this variable"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close details" className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-[var(--color-ink-2)] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <div className="label-mono mb-1">{CATEGORIES.find((c) => c.id === v.category)?.label}</div>
          <h2 className="font-display text-2xl tracking-[-0.02em]">{v.name}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{v.definition}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-3)]">
            <span className="text-[var(--color-ice)]">Why it matters · </span>
            {v.whyItMatters}
          </p>
        </div>
        <div>
          <div className="label-mono mb-2">In-app dataset</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {[
              ["Product", v.dataset.product],
              ["Source", v.dataset.source],
              ["Unit", v.unit],
              ["Temporal", v.dataset.temporal],
              ["Spatial", v.dataset.spatial],
              ["Time range", v.dataset.timeRange],
              ["Coverage", v.dataset.coverage],
            ].map(([k, val]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--color-ink-4)]">{k}</dt>
                <dd className="text-[var(--color-ink-2)]">{val}</dd>
              </div>
            ))}
          </dl>
          {v.connector.note && <p className="mt-2 text-xs text-[var(--color-warn)]">{v.connector.note}</p>}
        </div>
        <div>
          <div className="label-mono mb-2">Missions & products that measure it</div>
          <ul className="space-y-2">
            {v.products.map((p) => (
              <li key={p.product} className="rounded-md border border-[var(--color-line)] p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[var(--color-ink)]">{p.product}</span>
                  <Badge tone={p.kind === "satellite" ? "ice" : "neutral"}>{p.kind}</Badge>
                </div>
                <div className="mt-1 text-[var(--color-ink-3)]">
                  {p.mission} · {p.temporal} · {p.spatial} · <span className="font-mono">{p.timeRange}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3">
                  {p.access.map((a) => (
                    <a key={a} href={TOOL_INFO[a].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--color-ice)] hover:underline">
                      {TOOL_INFO[a].label} <ExternalLink className="h-3 w-3" />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {v.caveats && (
          <ul className="space-y-1 text-xs text-[var(--color-ink-3)]">
            {v.caveats.map((c) => (
              <li key={c}>⚠ {c}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-4">
          {v.connector.kind === "power" && (
            <ButtonLink to={`/investigate?v=${v.id}`} variant="primary" iconRight={<ArrowRight className="h-4 w-4" />}>
              Start Investigation
            </ButtonLink>
          )}
          {snapshots.map((id) => (
            <Button
              key={id}
              variant={v.connector.kind === "power" ? "secondary" : "primary"}
              icon={<Database className="h-4 w-4" />}
              onClick={async () => {
                await loadBundled(id, v.id);
                navigate("/workspace");
              }}
            >
              Analyse bundled: {id.replace(/-/g, " ")}
            </Button>
          ))}
          {v.connector.kind !== "power" && (
            <ButtonLink to="/workspace" variant="secondary" icon={<Server className="h-4 w-4" />}>
              Import a {v.connector.tools.map((t) => TOOL_INFO[t].label).join(" / ")} CSV
            </ButtonLink>
          )}
          {layer && (
            <ButtonLink to={`/explorer?layer=${layer.id}`} variant="ghost" icon={<Satellite className="h-4 w-4" />}>
              View layer on the globe
            </ButtonLink>
          )}
        </div>
      </div>
    </motion.aside>
  );
}

export default function DiscoveryPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | Category>("all");
  const [access, setAccess] = useState<"all" | "live">("all");
  const selectedId = params.get("v");
  const selected = selectedId ? getVariable(selectedId) : undefined;

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return VARIABLES.filter((v) => (cat === "all" || v.category === cat) && (access === "all" || v.connector.kind === "power")).filter(
      (v) =>
        !qq ||
        v.name.toLowerCase().includes(qq) ||
        v.shortName.toLowerCase().includes(qq) ||
        v.definition.toLowerCase().includes(qq) ||
        v.keywords.some((k) => k.includes(qq)) ||
        v.products.some((p) => p.product.toLowerCase().includes(qq) || p.mission.toLowerCase().includes(qq)),
    );
  }, [q, cat, access]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("v", id);
    else next.delete("v");
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-dvh pt-[var(--nav-h)]">
      <section className="relative overflow-hidden border-b border-[var(--color-line)]">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="container-x relative py-14 md:py-20">
          <div className="label-mono mb-4 flex items-center gap-2">
            <span className="text-[var(--color-cyan)]">Discovery Studio</span>
            <span className="h-px w-8 bg-[var(--color-line-bright)]" />
            <span>{VARIABLES.length} variables · {MISSIONS.length} missions & models</span>
          </div>
          <h1 className="max-w-[18ch] font-display text-[clamp(2.2rem,5vw,4.2rem)] leading-[1.02] tracking-[-0.035em]">What can you investigate?</h1>
          <p className="mt-4 max-w-[58ch] text-[var(--color-ink-2)]">
            Each variable is something a NASA satellite measures or a NASA model computes. Read what it means, where it comes from, and how to analyse it.
          </p>
          <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1 md:max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-3)]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search variables, missions, keywords — e.g. drought, MODIS, ozone"
                aria-label="Search variables"
                className="h-12 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)]/80 pl-11 pr-4 text-sm backdrop-blur placeholder:text-[var(--color-ink-4)] focus:border-[var(--color-cyan)] focus:outline-none"
              />
            </div>
            <Segmented
              ariaLabel="Category"
              value={cat}
              onChange={setCat}
              options={[{ value: "all", label: "All" }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
            />
            <Segmented ariaLabel="Availability" value={access} onChange={setAccess} options={[{ value: "all", label: "Any source" }, { value: "live", label: "Live in-app" }]} />
          </div>
        </div>
      </section>

      <div className="container-x py-10">
        <div className={cn("grid gap-6", selected && "lg:grid-cols-[1fr_420px]")}>
          <div>
            {filtered.length === 0 ? (
              <EmptyState icon={<Search className="h-6 w-6" />} title="No variables match" body="Try a broader word like “water”, “heat” or a mission name such as MODIS." />
            ) : (
              (cat === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.id === cat)).map((c) => {
                const vs = filtered.filter((v) => v.category === c.id);
                if (!vs.length) return null;
                return (
                  <section key={c.id} className="mb-12" aria-labelledby={`cat-${c.id}`}>
                    <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] pb-3">
                      <h2 id={`cat-${c.id}`} className="font-display text-xl uppercase tracking-[0.12em]">
                        {c.label}
                      </h2>
                      <span className="hidden text-xs text-[var(--color-ink-3)] sm:block">{c.blurb}</span>
                    </div>
                    <div className={cn("grid gap-4 sm:grid-cols-2", selected ? "xl:grid-cols-2 2xl:grid-cols-3" : "lg:grid-cols-3 xl:grid-cols-4")}>
                      {vs.map((v, i) => (
                        <Reveal key={v.id} delay={0.03 * i} y={12}>
                          <VariableCard v={v} active={v.id === selectedId} onOpen={() => open(v.id)} />
                        </Reveal>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
          <AnimatePresence mode="wait">{selected && <Detail v={selected} onClose={() => open(null)} />}</AnimatePresence>
        </div>

        <section className="mt-8 border-t border-[var(--color-line)] pt-12" aria-labelledby="missions">
          <div className="label-mono mb-3">Missions & models</div>
          <h2 id="missions" className="mb-6 font-display text-2xl tracking-[-0.02em]">Where the data come from</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {MISSIONS.map((m) => (
              <div key={m.name} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-lg">{m.name}</span>
                  <span className="font-mono text-[10.5px] text-[var(--color-ink-4)]">{m.since}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-ink-3)]">{m.agency} · {m.kind}</div>
                <p className="mt-2 text-xs text-[var(--color-ink-2)]">{m.measures}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12" aria-labelledby="partners">
          <div className="label-mono mb-3">Space agency partner resources</div>
          <h2 id="partners" className="mb-6 font-display text-2xl tracking-[-0.02em]">Canadian Space Agency & partners</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {RESOURCES.filter((r) => r.group === "csa" || r.group === "partner-general").map((r) => (
              <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="group rounded-[var(--radius-md)] border border-[var(--color-line)] p-4 transition-colors hover:border-[var(--color-line-bright)]">
                <div className="label-mono mb-1">{r.provider}</div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-[var(--color-ink)]">{r.title}</span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ink-4)] group-hover:text-[var(--color-ice)]" />
                </div>
                <p className="mt-1.5 line-clamp-3 text-xs text-[var(--color-ink-3)]">{r.description}</p>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
