import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Globe2, Layers, Map as MapIcon, SlidersHorizontal, SquareDashedMousePointer, X } from "lucide-react";
import type { AtlasLayer, AtlasPoint, InvestigationConfig, Region } from "@/types/domain";
import { GlobeSlot } from "@/components/layout/GlobeSlot";
import { PlaceSearch } from "@/components/maps/PlaceSearch";
import { Segmented, Select, Switch } from "@/components/ui/Controls";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ATLAS_VARIABLES, availableAtlasIds, loadAtlas } from "@/services/atlas";
import { DATA_LAYERS, availableMonths, clampTime, getGibsLayer, gibsWmsUrl } from "@/services/gibs";
import { countryAtPoint, countryToRegion } from "@/services/geo";
import { bboxRegion } from "@/data/regions";
import { getVariable } from "@/data/catalog";
import { newId, useInvestigation } from "@/store/investigation";
import { fmtDateKey, fmtLat, fmtLon, fmtP, fmtSigned } from "@/utils/format";
import { cn } from "@/utils/cn";

interface HoverInfo {
  lon: number;
  lat: number;
  countryName?: string;
  atlasPoint?: AtlasPoint;
  screen: { x: number; y: number };
}

export default function EarthExplorerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const run = useInvestigation((s) => s.run);

  const [mode, setMode] = useState<"globe" | "map">("globe");
  const [panelOpen, setPanelOpen] = useState(true);
  const [atlasVar, setAtlasVar] = useState<string>("t2m");
  const [atlas, setAtlas] = useState<AtlasLayer | null>(null);
  const [showAtlas, setShowAtlas] = useState(true);
  const [direction, setDirection] = useState<"all" | "increasing" | "decreasing">("all");
  // Readable by default: significant trends only; the filter below reveals the rest.
  const [significance, setSignificance] = useState<"all" | "significant" | "not-significant">("significant");
  const initialLayer = params.get("layer");
  const [layerId, setLayerId] = useState<string>(initialLayer && getGibsLayer(initialLayer) ? initialLayer : "");
  const layer = getGibsLayer(layerId);
  const months = useMemo(() => (layer ? availableMonths(layer, 300) : []), [layer]);
  const [month, setMonth] = useState<string>("");
  const [opacity, setOpacity] = useState(0.55);
  const [borders, setBorders] = useState(true);
  const [night, setNight] = useState(true);
  const [regions, setRegions] = useState<Region[]>([]);
  const [focus, setFocus] = useState<{ lon: number; lat: number; distance?: number } | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const atlasIds = useMemo(() => availableAtlasIds(), []);

  useEffect(() => {
    let alive = true;
    loadAtlas(atlasVar).then((a) => alive && setAtlas(a));
    return () => {
      alive = false;
    };
  }, [atlasVar]);
  useEffect(() => {
    if (layer) setMonth(months[0] ?? "");
  }, [layerId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode === "globe") setDrawMode(false);
  }, [mode]);

  const overlay = layer ? { url: gibsWmsUrl(layer.id, { time: clampTime(layer, month || undefined), width: 2048, height: 1024 }), opacity } : null;
  const atlasVariable = getVariable(atlasVar);

  const addRegion = (r: Region) => {
    setRegions((rs) => (rs.some((x) => x.id === r.id) ? rs : [...rs, r].slice(-4)));
    setFocus({ lon: r.center[0], lat: r.center[1] });
  };

  const investigate = (rs: Region[]) => {
    const variableId = atlasVariable?.connector.kind === "power" ? atlasVar : "t2m";
    const config: InvestigationConfig = {
      id: newId(),
      question: `How has ${getVariable(variableId)?.name.toLowerCase()} changed in ${rs.map((r) => r.name).join(" vs ")}?`,
      variableIds: [variableId],
      regions: rs,
      startYear: getVariable(variableId)?.connector.kind === "power" ? Math.max(1981, (getVariable(variableId)!.connector as { startYear: number }).startYear) : 1981,
      endYear: 2025,
      resolution: "monthly",
      methods: ["mann-kendall", "sen", "ols", "ci", "seasonal"],
      alpha: 0.05,
      createdAt: new Date().toISOString(),
    };
    void run(config);
    navigate(rs.length > 1 ? "/compare" : "/workspace");
  };

  const sigCounts = atlas ? { up: atlas.points.filter((p) => p.sig && p.slope > 0).length, down: atlas.points.filter((p) => p.sig && p.slope < 0).length, n: atlas.points.length } : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[var(--color-void)]">
      <h1 className="sr-only">Earth Explorer — interactive globe and map</h1>
      <div className="absolute inset-0">
        <GlobeSlot
          mode={mode}
          interactive
          autoRotate={false}
          framing="center"
          overlay={overlay}
          atlas={showAtlas ? atlas : null}
          atlasFilter={{ direction, significance }}
          regions={regions.map((r) => ({ id: r.id, bbox: r.bbox, countryId: r.countryId }))}
          showBorders={borders}
          showGraticule
          showNight={night && mode === "globe"}
          showAtmosphere
          showClouds={!layer}
          focus={focus}
          drawMode={drawMode}
          onHover={(h) => setHover(h ? { lon: h.lon, lat: h.lat, countryName: h.countryName, atlasPoint: h.atlasPoint, screen: h.screen } : null)}
          onSelect={async (h) => {
            if (drawMode) return;
            const c = await countryAtPoint(h.lon, h.lat);
            if (c) addRegion(countryToRegion(c));
          }}
          onBoxSelect={(b) => {
            addRegion(bboxRegion(b));
            setDrawMode(false);
          }}
          className="h-full w-full"
          posterClassName="h-full w-full"
        />
      </div>

      {/* Hover tooltip */}
      {hover && (hover.atlasPoint || hover.countryName) && (
        <div className="glass pointer-events-none fixed z-[var(--z-tooltip)] max-w-xs rounded-[var(--radius-md)] px-3 py-2.5 text-xs shadow-[var(--shadow-float)]" style={{ left: hover.screen.x + 16, top: hover.screen.y + 16 }}>
          <div className="num font-mono text-[10.5px] text-[var(--color-ink-3)]">
            {fmtLat(hover.lat)} {fmtLon(hover.lon)}
          </div>
          {hover.countryName && <div className="mt-0.5 text-sm text-[var(--color-ink)]">{hover.countryName}</div>}
          {hover.atlasPoint && atlas && (
            <div className="mt-1.5 border-t border-[var(--color-line)] pt-1.5">
              <div className="label-mono mb-0.5">Nearest atlas point · {atlasVariable?.name}</div>
              <div className="num font-mono text-[var(--color-ink)]">
                {fmtSigned(hover.atlasPoint.slope, 2)} {atlas.unit}
              </div>
              <div className="text-[var(--color-ink-3)]">
                p = {fmtP(hover.atlasPoint.p)} · {hover.atlasPoint.sig ? "significant (FDR)" : "not significant"} · {atlas.startYear}–{atlas.endYear}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mode switch (top center) */}
      <div className="absolute left-1/2 top-[calc(var(--nav-h)+1rem)] z-20 -translate-x-1/2">
        <div className="glass flex items-center gap-1 rounded-full p-1 shadow-[var(--shadow-float)]">
          {(["globe", "map"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-medium transition-colors",
                mode === m ? "bg-[var(--color-cyan)] text-[#021018]" : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
              )}
            >
              {m === "globe" ? <Globe2 className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
              {m === "globe" ? "Globe" : "Unfold to map"}
            </button>
          ))}
          {mode === "map" && (
            <button
              onClick={() => setDrawMode((d) => !d)}
              aria-pressed={drawMode}
              className={cn("ml-1 inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-medium", drawMode ? "bg-[var(--color-ice)] text-[#021018]" : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]")}
            >
              <SquareDashedMousePointer className="h-4 w-4" /> {drawMode ? "Drag a box…" : "Draw region"}
            </button>
          )}
        </div>
      </div>

      {/* Control panel (left) */}
      <AnimatePresence>
        {panelOpen ? (
          <motion.aside
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass absolute bottom-4 left-4 top-[calc(var(--nav-h)+1rem)] z-20 flex w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-[var(--shadow-float)]"
            aria-label="Explorer controls"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[var(--color-cyan)]" />
                <span className="font-display text-sm">Mission control</span>
              </div>
              <button onClick={() => setPanelOpen(false)} aria-label="Hide controls" className="rounded-md p-1 text-[var(--color-ink-3)] hover:bg-white/5 hover:text-[var(--color-ink)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <PlaceSearch onSelect={addRegion} placeholder="Search a place to fly to…" />

              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label-mono">Trend atlas · NASA POWER</span>
                  <Switch checked={showAtlas} onChange={setShowAtlas} label="" />
                </div>
                <Select aria-label="Atlas variable" value={atlasVar} onChange={(e) => setAtlasVar(e.target.value)}>
                  {ATLAS_VARIABLES.filter((a) => atlasIds.includes(a.id)).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
                <div className="mt-3 space-y-2">
                  <Segmented size="sm" ariaLabel="Trend direction" value={direction} onChange={setDirection} options={[{ value: "all", label: "All" }, { value: "increasing", label: "▲ Rising" }, { value: "decreasing", label: "▼ Falling" }]} />
                  <Segmented size="sm" ariaLabel="Significance" value={significance} onChange={setSignificance} options={[{ value: "all", label: "All" }, { value: "significant", label: "Significant" }, { value: "not-significant", label: "Not sig." }]} />
                </div>
                {atlas && sigCounts && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
                    {sigCounts.n} points · <span className="text-[var(--color-rise)]">▲ {sigCounts.up}</span> / <span className="text-[var(--color-fall)]">▼ {sigCounts.down}</span> significant · {atlas.startYear}–{atlas.endYear} · {atlas.method}
                  </p>
                )}
                {!atlas && <p className="mt-2 text-[11px] text-[var(--color-ink-4)]">Trend atlas not bundled in this build.</p>}
              </section>

              <section>
                <div className="label-mono mb-2 flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5" /> Imagery layer · NASA GIBS
                </div>
                <Select aria-label="Imagery layer" value={layerId} onChange={(e) => setLayerId(e.target.value)}>
                  <option value="">None — natural color Earth</option>
                  {DATA_LAYERS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {getVariable(l.variableId ?? "")?.name ?? l.title}
                    </option>
                  ))}
                </Select>
                {layer && (
                  <div className="mt-3 space-y-3">
                    <Select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {fmtDateKey(m)}
                        </option>
                      ))}
                    </Select>
                    <label className="block">
                      <span className="label-mono mb-1 flex justify-between">
                        <span>Opacity</span>
                        <span className="num">{Math.round(opacity * 100)}%</span>
                      </span>
                      <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} className="w-full accent-[var(--color-cyan)]" />
                    </label>
                    <p className="text-[11px] leading-relaxed text-[var(--color-ink-4)]">{layer.title}. Context imagery from GIBS — trends are computed from the atlas, not from these pixels.</p>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="label-mono mb-1">Display</div>
                <Switch checked={borders} onChange={setBorders} label="Country borders" />
                <Switch checked={night} onChange={setNight} label="Night lights (globe)" />
              </section>

              <Legend layerLegend={layer?.legendUrl} />
            </div>
          </motion.aside>
        ) : (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setPanelOpen(true)}
            className="glass absolute left-4 top-[calc(var(--nav-h)+1rem)] z-20 inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs"
          >
            <SlidersHorizontal className="h-4 w-4 text-[var(--color-cyan)]" /> Controls
          </motion.button>
        )}
      </AnimatePresence>

      {/* Selected regions (right) */}
      <AnimatePresence>
        {regions.length > 0 && (
          <motion.aside
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="glass absolute bottom-4 right-4 z-20 w-[min(320px,calc(100vw-2rem))] rounded-[var(--radius-xl)] p-4 shadow-[var(--shadow-float)]"
            aria-label="Selected regions"
          >
            <div className="label-mono mb-2">Selected regions</div>
            <ul className="space-y-1.5">
              {regions.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-sm">
                  <button className="truncate text-left hover:text-[var(--color-cyan)]" onClick={() => { setFocus(null); requestAnimationFrame(() => setFocus({ lon: r.center[0], lat: r.center[1] })); }}>
                    {r.name}
                  </button>
                  <button aria-label={`Remove ${r.name}`} onClick={() => setRegions((rs) => rs.filter((x) => x.id !== r.id))} className="rounded p-1 text-[var(--color-ink-4)] hover:text-[var(--color-ink)]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="primary" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => investigate(regions.slice(0, 1))}>
                Investigate {atlasVariable?.name.toLowerCase() ?? "trend"} · {regions[0].name}
              </Button>
              {regions.length > 1 && (
                <Button variant="secondary" size="sm" onClick={() => investigate(regions)}>
                  Compare {regions.length} regions
                </Button>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Hint */}
      {regions.length === 0 && (
        <div className="pointer-events-none absolute bottom-6 right-6 z-10 hidden max-w-xs text-right text-xs text-[var(--color-ink-3)] md:block">
          <Badge tone="neutral" className="mb-2">Interactive</Badge>
          <p>Drag to rotate · scroll to zoom · click a country to select it · unfold to the map to draw a box.</p>
        </div>
      )}
    </div>
  );
}

function Legend({ layerLegend }: { layerLegend?: string }) {
  return (
    <section aria-label="Legend" className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
      <div className="label-mono mb-2">Legend</div>
      <ul className="space-y-1.5 text-xs text-[var(--color-ink-2)]">
        <li className="flex items-center gap-2">
          <span className="flex w-8 items-end justify-center gap-0.5 text-[var(--color-ink-3)]">
            <span className="text-[8px] leading-none">▲</span>
            <span className="text-[13px] leading-none">▲</span>
          </span>
          Triangle size = size of the trend
        </li>
        <li className="flex items-center gap-2">
          <span className="w-8 text-center">
            <span className="text-[var(--color-rise)]">▲</span> <span className="text-[var(--color-fall)]">▼</span>
          </span>
          Colour = direction: rising · falling
        </li>
        <li className="flex items-center gap-2">
          <span className="flex w-8 justify-center">
            <span className="h-1.5 w-1.5 rounded-full border border-[var(--color-flat)] opacity-70" />
          </span>
          Faint dot = not significant (shown with “All”)
        </li>
        <li className="flex items-center gap-2">
          <span className="flex w-8 justify-center">
            <span className="h-0.5 w-4 bg-[var(--color-ice)] shadow-[0_0_6px_var(--color-ice)]" />
          </span>
          Selected region
        </li>
      </ul>
      {layerLegend && (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <div className="label-mono mb-1.5">Imagery scale (GIBS)</div>
          <img src={layerLegend} alt="Color scale for the selected GIBS layer" className="w-full rounded bg-white/90 p-1" loading="lazy" />
        </div>
      )}
    </section>
  );
}
