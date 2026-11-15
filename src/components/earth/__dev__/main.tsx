/* Dev-only harness for <Globe/>. Query params drive the state so screenshots are reproducible:
   ?mode=globe|map &framing=center|hero-right &interactive=0|1 &overlay=mock|gibs &atlas=1 &regions=1
   &graticule=1 &borders=0 &night=0 &clouds=0 &atmo=0 &quality=high|low &morph=0.5 &ui=0 &fallback=1
   &tex=/nope/ (missing textures) &rotate=1 &hero=1 (landing copy) &focus=lon,lat,dist */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Globe from "../Globe";
import { GlobeFallback } from "../GlobeFallback";
import type { GlobeProps, PickInfo, GlobeRegion } from "../types";
import type { AtlasLayer, AtlasPoint, BBox } from "../../../types/domain";

const q = new URLSearchParams(location.search);
const flag = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== "0" : d);

declare global {
  interface Window {
    __esReady?: boolean;
    __esErrors?: string[];
    __esEvents?: string[];
  }
}
window.__esErrors = [];
window.__esEvents = [];

function mockAtlas(): AtlasLayer {
  const points: AtlasPoint[] = [];
  for (let lat = -57.5; lat <= 72.5; lat += 5) {
    for (let lon = -177.5; lon <= 177.5; lon += 5) {
      const s = 0.35 * Math.sin((lat / 180) * Math.PI * 3 + 0.6) + 0.25 * Math.cos((lon / 180) * Math.PI * 2) + 0.18 * Math.sin(((lon + lat) / 90) * Math.PI);
      const p = Math.abs(s) > 0.22 ? 0.004 : 0.3;
      points.push({ lon, lat, slope: s, p, sig: p < 0.05, mean: 15, land: true });
    }
  }
  return { variableId: "t2m", parameter: "T2M", unit: "°C/decade", startYear: 1981, endYear: 2024, method: "Sen + MK", fdrAlpha: 0.05, retrieved: "2026-11-15", source: "mock", points };
}

function mockOverlay(): string {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(1024, 512);
  for (let j = 0; j < 512; j++) {
    const lat = 90 - (j / 512) * 180;
    for (let i = 0; i < 1024; i++) {
      const lon = (i / 1024) * 360 - 180;
      const v = 0.5 + 0.5 * Math.cos((lat / 90) * Math.PI * 0.95) * 0.8 + 0.12 * Math.sin((lon / 180) * Math.PI * 3) * Math.cos((lat / 90) * Math.PI);
      const t = Math.max(0, Math.min(1, v - 0.1));
      // perceptual-ish "thermal" ramp: deep blue → teal → yellow → orange
      const r = Math.round(255 * Math.min(1, Math.max(0, 1.6 * t - 0.45)));
      const g = Math.round(255 * Math.min(1, Math.max(0, Math.sin(t * Math.PI) * 0.9 + 0.1 * t)));
      const b = Math.round(255 * Math.min(1, Math.max(0, 1.0 - 1.3 * t + 0.25)));
      const k = (j * 1024 + i) * 4;
      const transparent = Math.abs(lat) > 70;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = transparent ? 0 : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

const GIBS =
  "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_Land_Surface_Temp_Day&STYLES=&CRS=EPSG%3A4326&BBOX=-90%2C-180%2C90%2C180&WIDTH=2048&HEIGHT=1024&FORMAT=image%2Fpng&TRANSPARENT=true&TIME=2024-07-01";

const DEMO_REGIONS: GlobeRegion[] = [
  { id: "brazil", countryId: "076", bbox: { west: -74, south: -34, east: -34, north: 5 } },
  { id: "sahel", bbox: { west: -18, south: 10, east: 32, north: 18 } },
  { id: "fiji-am", bbox: { west: 170, south: -24, east: -172, north: -10 }, color: "#38e1ff" },
];

function App() {
  const [mode, setMode] = useState<GlobeProps["mode"]>((q.get("mode") as GlobeProps["mode"]) ?? "globe");
  const [overlayOn, setOverlayOn] = useState(q.get("overlay") ?? "");
  const [atlasOn, setAtlasOn] = useState(flag("atlas", false));
  const [drawMode, setDrawMode] = useState(flag("draw", false));
  const [graticule, setGraticule] = useState(flag("graticule", false));
  const [borders, setBorders] = useState(flag("borders", true));
  const [night, setNight] = useState(flag("night", true));
  const [regions, setRegions] = useState<GlobeRegion[]>(flag("regions", false) ? DEMO_REGIONS : []);
  const [hover, setHover] = useState<PickInfo | null>(null);
  const [filter, setFilter] = useState<"all" | "increasing" | "decreasing">("all");
  const [focus, setFocus] = useState<GlobeProps["focus"]>(() => {
    const f = q.get("focus");
    if (!f) return null;
    const [lon, lat, d] = f.split(",").map(Number);
    return { lon, lat, distance: Number.isFinite(d) ? d : undefined };
  });
  const atlas = useMemo(() => (atlasOn ? mockAtlas() : null), [atlasOn]);
  const overlayUrl = useMemo(() => (overlayOn === "mock" ? mockOverlay() : overlayOn === "gibs" ? GIBS : null), [overlayOn]);
  const overlay = overlayUrl ? { url: overlayUrl, opacity: 0.85 } : null;
  const ui = flag("ui", true);
  const hero = flag("hero", false);

  const common: GlobeProps = {
    mode,
    interactive: flag("interactive", true),
    autoRotate: flag("rotate", false),
    framing: (q.get("framing") as GlobeProps["framing"]) ?? "center",
    overlay,
    atlas,
    atlasFilter: { direction: filter, significance: "all" },
    regions,
    showBorders: borders,
    showGraticule: graticule,
    showNight: night,
    showClouds: flag("clouds", true),
    showAtmosphere: flag("atmo", true),
    focus,
    drawMode,
    quality: (q.get("quality") as GlobeProps["quality"]) ?? "auto",
    textureBaseUrl: q.get("tex") ?? undefined,
    onHover: setHover,
    onSelect: (i) => window.__esEvents!.push(`select ${i.lon.toFixed(2)},${i.lat.toFixed(2)} ${i.countryName ?? ""} ${i.atlasPoint ? "atlas" : ""}`),
    onBoxSelect: (b: BBox) => {
      window.__esEvents!.push(`box ${JSON.stringify(b)}`);
      setRegions((r) => [...r.filter((x) => x.id !== "drawn"), { id: "drawn", bbox: b, color: "#38e1ff" }]);
    },
    onReady: () => {
      window.__esReady = true;
      const m = q.get("morph");
      if (m != null) {
        const eng = (window as unknown as { __earthEngine?: { debugSetMorph(v: number): void } }).__earthEngine;
        eng?.debugSetMorph(Number(m));
      }
    },
    onError: (e) => window.__esErrors!.push(e.message),
  };

  return (
    <div style={{ position: "relative", height: "100%" }}>
      {hero && (
        <div className="hero-copy">
          <small>NASA SPACE APPS 2026 · EARTH SYSTEM TRENDS</small>
          <h1>Detect the trend. Prove it.</h1>
          <p>Forty years of NASA observations, tested with real statistics — on a living, unfolding Earth.</p>
        </div>
      )}
      {flag("fallback", false) ? <GlobeFallback {...common} /> : <Globe {...common} />}
      {hover && ui && (
        <div className="tip" style={{ left: hover.screen.x, top: hover.screen.y }}>
          {hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}° {hover.countryName ? `· ${hover.countryName}` : ""}
          {hover.atlasPoint ? ` · slope ${hover.atlasPoint.slope.toFixed(2)} ${hover.atlasPoint.sig ? "sig" : "n.s."}` : ""}
        </div>
      )}
      {ui && (
        <div className="panel">
          <button aria-pressed={mode === "map"} onClick={() => setMode(mode === "globe" ? "map" : "globe")}>
            {mode === "globe" ? "Unfold → map" : "Fold → globe"}
          </button>
          <button aria-pressed={!!overlayOn} onClick={() => setOverlayOn(overlayOn ? "" : "mock")}>overlay</button>
          <button aria-pressed={atlasOn} onClick={() => setAtlasOn(!atlasOn)}>atlas</button>
          <button onClick={() => setFilter(filter === "all" ? "increasing" : filter === "increasing" ? "decreasing" : "all")}>filter: {filter}</button>
          <button aria-pressed={regions.length > 0} onClick={() => setRegions(regions.length ? [] : DEMO_REGIONS)}>regions</button>
          <button aria-pressed={graticule} onClick={() => setGraticule(!graticule)}>graticule</button>
          <button aria-pressed={borders} onClick={() => setBorders(!borders)}>borders</button>
          <button aria-pressed={night} onClick={() => setNight(!night)}>night</button>
          <button aria-pressed={drawMode} onClick={() => setDrawMode(!drawMode)}>draw box</button>
          <button onClick={() => setFocus({ lon: 139.7, lat: 35.7, distance: mode === "map" ? 0.6 : 1.4 })}>fly → Tokyo</button>
          <button onClick={() => setFocus({ lon: -47.9, lat: -15.8 })}>fly → Brasília</button>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
