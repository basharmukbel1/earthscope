import type { BBox, GibsLayerMeta } from "@/types/domain";

/* ==========================================================================
   NASA GIBS (Global Imagery Browse Services) — WMS GetMap in EPSG:4326.
   Layer metadata (valid date ranges, legends) is generated from the GIBS
   capabilities document by scripts/build-gibs-meta.mjs. GIBS returns a tiny
   transparent PNG for out-of-range dates, so times are always clamped to
   the documented range.
   ========================================================================== */

export const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

type LayerJson = GibsLayerMeta & { verified?: boolean; verifiedEnd?: string };

const layerModules = import.meta.glob<{ default: LayerJson[] }>("../data/gibs-layers.json", { eager: true });
/** Layers with the advertised end date replaced by the last date verified to render. */
export const GIBS_LAYERS: LayerJson[] = (Object.values(layerModules)[0]?.default ?? []).map((l) =>
  l.verified === false && l.verifiedEnd ? { ...l, end: l.verifiedEnd, verified: true } : l,
);

export const getGibsLayer = (id?: string) => (id ? GIBS_LAYERS.find((l) => l.id === id) : undefined);

/** Data layers that were verified to return imagery at build time. */
export const DATA_LAYERS = GIBS_LAYERS.filter((l) => l.category !== "base" && l.verified !== false);

const ym = (d: string) => d.slice(0, 7);

/** Clamp a desired "YYYY-MM" into the layer's valid range; returns an ISO date for TIME=. */
export function clampTime(layer: GibsLayerMeta, desired?: string): string | undefined {
  if (!layer.start || !layer.end) return undefined;
  const want = desired ?? ym(layer.end);
  const lo = ym(layer.start);
  const hi = ym(layer.end);
  const m = want < lo ? lo : want > hi ? hi : want;
  if (layer.period === "P1M" || !layer.period) return `${m}-01`;
  // daily/8-day layers: use the 15th (or the end date when clamped to the last month)
  return m === hi ? layer.end.slice(0, 10) : m === lo ? layer.start.slice(0, 10) : `${m}-15`;
}

export function gibsWmsUrl(
  layerId: string,
  opts: { time?: string; bbox?: BBox; width?: number; height?: number; format?: "image/png" | "image/jpeg" } = {},
): string {
  const b = opts.bbox ?? { west: -180, south: -90, east: 180, north: 90 };
  const width = opts.width ?? 2048;
  const height = opts.height ?? Math.round((width * (b.north - b.south)) / Math.max(1e-6, b.east - b.west));
  const q = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layerId,
    STYLES: "",
    CRS: "EPSG:4326",
    // WMS 1.3.0 + EPSG:4326 → axis order is lat,lon
    BBOX: `${b.south},${b.west},${b.north},${b.east}`,
    WIDTH: String(width),
    HEIGHT: String(Math.max(1, height)),
    FORMAT: opts.format ?? "image/png",
    TRANSPARENT: "TRUE",
  });
  if (opts.time) q.set("TIME", opts.time);
  return `${GIBS_WMS}?${q.toString()}`;
}

/** List YYYY-MM months available for a monthly layer (newest first, capped). */
export function availableMonths(layer: GibsLayerMeta, max = 240): string[] {
  if (!layer.start || !layer.end) return [];
  const [y0, m0] = layer.start.split("-").map(Number);
  const [y1, m1] = layer.end.split("-").map(Number);
  const out: string[] = [];
  let y = y1,
    m = m1;
  while ((y > y0 || (y === y0 && m >= m0)) && out.length < max) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}
