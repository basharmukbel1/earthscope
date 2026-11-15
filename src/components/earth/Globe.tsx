/* ==========================================================================
   EARTHSCOPE — <Globe/>: React wrapper around EarthEngine.

   Meant to be React.lazy()-loaded:
     const Globe = lazy(() => import("@/components/earth/Globe"));
   The engine (three.js) is itself split into its own chunk and only fetched
   when WebGL is available; otherwise (or after an unrecoverable context loss)
   the SVG <GlobeFallback/> renders with the same props.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BBox } from "../../types/domain";
import { useWebGLSupport } from "../../hooks/useWebGLSupport";
import { GlobeFallback } from "./GlobeFallback";
import type { EarthEngine } from "./EarthEngine";
import type { GlobeProps, PickInfo } from "./types";

export type { GlobeProps, PickInfo } from "./types";

const CONTEXT_RESTORE_GRACE_MS = 3000;

const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function fmtLat(v: number) {
  return `${Math.abs(v).toFixed(1)}°${v >= 0 ? "N" : "S"}`;
}
function fmtLon(v: number) {
  return `${Math.abs(v).toFixed(1)}°${v >= 0 ? "E" : "W"}`;
}

function describePick(info: PickInfo): string {
  const where = `${fmtLat(info.lat)}, ${fmtLon(info.lon)}`;
  const parts = [info.countryName ? `${info.countryName}, ${where}` : where];
  const p = info.atlasPoint;
  if (p) {
    const dir = !p.sig ? "no significant trend" : p.slope > 0 ? "significant increase" : "significant decrease";
    parts.push(`trend marker: ${dir}`);
  }
  return `Selected ${parts.join(" — ")}`;
}

export function Globe(props: GlobeProps) {
  const webgl = useWebGLSupport();
  const [failed, setFailed] = useState(false);
  if (!webgl || failed) return <GlobeFallback {...props} />;
  return <GlobeWebGL {...props} onFatal={() => setFailed(true)} />;
}

export default Globe;

function GlobeWebGL(props: GlobeProps & { onFatal: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<EarthEngine | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- engine lifecycle (StrictMode-safe: every mount creates + disposes its own context) ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let instance: EarthEngine | null = null;
    let lostTimer = 0;
    const p = propsRef.current;
    import("./EarthEngine")
      .then(({ EarthEngine }) => {
        if (cancelled) return;
        try {
          instance = new EarthEngine(host, {
            mode: p.mode,
            interactive: p.interactive ?? true,
            autoRotate: p.autoRotate ?? false,
            framing: p.framing ?? "center",
            overlay: p.overlay ?? null,
            atlas: p.atlas ?? null,
            atlasFilter: p.atlasFilter,
            regions: p.regions ?? [],
            showBorders: p.showBorders ?? true,
            showGraticule: p.showGraticule ?? false,
            showNight: p.showNight ?? true,
            showClouds: p.showClouds ?? true,
            showAtmosphere: p.showAtmosphere ?? true,
            showStars: p.showStars ?? true,
            focus: p.focus ?? null,
            drawMode: p.drawMode ?? false,
            quality: p.quality ?? "auto",
            ariaLabel: p.ariaLabel,
            textureBaseUrl: p.textureBaseUrl ?? `${import.meta.env.BASE_URL ?? "/"}textures/`,
            onHover: (info) => propsRef.current.onHover?.(info),
            onSelect: (info) => {
              setAnnouncement(describePick(info));
              propsRef.current.onSelect?.(info);
            },
            onBoxSelect: (b: BBox) => {
              setAnnouncement(`Selected box ${fmtLat(b.south)} to ${fmtLat(b.north)}, ${fmtLon(b.west)} to ${fmtLon(b.east)}`);
              propsRef.current.onBoxSelect?.(b);
            },
            onReady: () => propsRef.current.onReady?.(),
            onError: (err) => propsRef.current.onError?.(err),
            onContextLost: () => {
              window.clearTimeout(lostTimer);
              lostTimer = window.setTimeout(() => {
                propsRef.current.onError?.(new Error("WebGL context lost and not restored — switched to the 2D map"));
                propsRef.current.onFatal();
              }, CONTEXT_RESTORE_GRACE_MS);
            },
            onContextRestored: () => window.clearTimeout(lostTimer),
          });
          if (import.meta.env.DEV) (window as unknown as { __earthEngine?: EarthEngine }).__earthEngine = instance;
          setEngine(instance);
        } catch (err) {
          propsRef.current.onError?.(err instanceof Error ? err : new Error("WebGL initialisation failed"));
          propsRef.current.onFatal();
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        propsRef.current.onError?.(err instanceof Error ? err : new Error("Failed to load the Earth engine"));
        propsRef.current.onFatal();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(lostTimer);
      instance?.dispose();
      instance = null;
      setEngine(null);
    };
  }, []);

  // ---- prop → engine sync (setters diff internally, so identity churn is cheap) ----
  const { mode, interactive, autoRotate, framing, overlay, atlas, atlasFilter, regions, showBorders, showGraticule, showNight, showClouds, showAtmosphere, showStars, focus, drawMode, quality, ariaLabel } = props;
  useEffect(() => void engine?.setMode(mode), [engine, mode]);
  useEffect(() => void engine?.setInteractive(interactive ?? true), [engine, interactive]);
  useEffect(() => void engine?.setAutoRotate(autoRotate ?? false), [engine, autoRotate]);
  useEffect(() => void engine?.setFraming(framing ?? "center"), [engine, framing]);
  useEffect(() => void engine?.setOverlay(overlay ?? null), [engine, overlay?.url, overlay?.opacity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void engine?.setAtlas(atlas ?? null), [engine, atlas]);
  useEffect(() => void engine?.setAtlasFilter(atlasFilter ?? { direction: "all", significance: "all" }), [engine, atlasFilter?.direction, atlasFilter?.significance]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void engine?.setRegions(regions ?? []), [engine, regions]);
  useEffect(() => void engine?.setShowBorders(showBorders ?? true), [engine, showBorders]);
  useEffect(() => void engine?.setShowGraticule(showGraticule ?? false), [engine, showGraticule]);
  useEffect(() => void engine?.setShowNight(showNight ?? true), [engine, showNight]);
  useEffect(() => void engine?.setShowClouds(showClouds ?? true), [engine, showClouds]);
  useEffect(() => void engine?.setShowAtmosphere(showAtmosphere ?? true), [engine, showAtmosphere]);
  useEffect(() => void engine?.setShowStars(showStars ?? true), [engine, showStars]);
  useEffect(() => void engine?.setFocus(focus ?? null), [engine, focus?.lon, focus?.lat, focus?.distance]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void engine?.setDrawMode(drawMode ?? false), [engine, drawMode]);
  useEffect(() => void engine?.setQuality(quality ?? "auto"), [engine, quality]);
  useEffect(() => void engine?.setAriaLabel(ariaLabel), [engine, ariaLabel]);

  return (
    <div ref={hostRef} className={`es-globe${props.className ? ` ${props.className}` : ""}`} style={hostStyle}>
      <div role="status" aria-live="polite" aria-atomic="true" style={srOnly}>
        {announcement}
      </div>
    </div>
  );
}

const hostStyle: CSSProperties = { position: "relative", overflow: "hidden", isolation: "isolate" };

let hostStyleInjected = false;
if (typeof document !== "undefined" && !hostStyleInjected) {
  hostStyleInjected = true;
  const s = document.createElement("style");
  s.setAttribute("data-earthscope-globe-host", "");
  // in @layer base so Tailwind utilities in className (e.g. h-[70vh]) win
  s.textContent = "@layer base{.es-globe{width:100%;height:100%;min-height:200px}}";
  document.head.appendChild(s);
}
