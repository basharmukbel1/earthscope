/* ==========================================================================
   EARTHSCOPE — Earth component public types (shared by the WebGL engine,
   the React wrapper and the SVG fallback). Type-only module: safe to import
   from anywhere without pulling three.js into a bundle.
   ========================================================================== */

import type { AtlasLayer, AtlasPoint, BBox } from "../../types/domain";

export type EarthMode = "globe" | "map";
export type EarthFraming = "center" | "hero-right";
export type EarthQuality = "auto" | "high" | "low";

export interface OverlaySpec {
  /** Equirectangular EPSG:4326 image (-180..180 lon, -90..90 lat), e.g. a GIBS WMS GetMap PNG. */
  url: string;
  /** 0..1 */
  opacity: number;
}

export interface AtlasFilter {
  direction: "all" | "increasing" | "decreasing";
  significance: "all" | "significant" | "not-significant";
}

export interface GlobeRegion {
  id: string;
  bbox: BBox;
  /** world-atlas numeric id (as string). When set, the country polygon is outlined instead of the bbox. */
  countryId?: string;
  /** CSS hex color (#rrggbb). Defaults to ice #a8d8ff. */
  color?: string;
}

export interface FocusSpec {
  lon: number;
  lat: number;
  /**
   * Camera altitude above the surface in Earth radii (globe: 1 ≈ "one Earth radius away";
   * map: 1 ≈ a ~50° wide view on a 16:10 viewport). Omit to keep the current zoom.
   */
  distance?: number;
}

export interface PickInfo {
  lon: number;
  lat: number;
  countryId?: string;
  countryName?: string;
  atlasPoint?: AtlasPoint;
  /** Pointer position in CSS px, relative to the Globe container's top-left corner. */
  screen: { x: number; y: number };
}

export interface GlobeProps {
  mode: EarthMode;
  className?: string;
  interactive?: boolean;
  autoRotate?: boolean;
  framing?: EarthFraming;
  overlay?: OverlaySpec | null;
  atlas?: AtlasLayer | null;
  atlasFilter?: AtlasFilter;
  regions?: GlobeRegion[];
  showBorders?: boolean;
  showGraticule?: boolean;
  showNight?: boolean;
  showClouds?: boolean;
  showAtmosphere?: boolean;
  /** Very sparse static star points behind the globe (globe mode only). Default true. */
  showStars?: boolean;
  focus?: FocusSpec | null;
  drawMode?: boolean;
  quality?: EarthQuality;
  /** Accessible name of the interactive canvas. */
  ariaLabel?: string;
  /** Where earth-day-{2k,4k}.jpg / earth-night-*.jpg live. Default: `${import.meta.env.BASE_URL}textures/`. */
  textureBaseUrl?: string;
  onHover?: (info: PickInfo | null) => void;
  onSelect?: (info: PickInfo) => void;
  onBoxSelect?: (bbox: BBox) => void;
  onReady?: () => void;
  onError?: (err: Error) => void;
}

/** Design tokens used by the earth renderers (mirrors src/styles/tokens.css). */
export const EARTH_COLORS = {
  void: "#04060c",
  cyan: "#38e1ff",
  ice: "#a8d8ff",
  rise: "#5fd3a0",
  fall: "#ff8a6b",
  flat: "#8a97b1",
  line: "#94b4ff", // rgb(148 180 255)
} as const;

export const DEFAULT_ATLAS_FILTER: AtlasFilter = { direction: "all", significance: "all" };

/** Classify an atlas point the same way in every renderer. */
export function atlasKind(p: AtlasPoint): "rise" | "fall" | "flat" {
  if (!p.sig || p.slope === 0) return "flat";
  return p.slope > 0 ? "rise" : "fall";
}

export function atlasPasses(p: AtlasPoint, f: AtlasFilter | undefined): boolean {
  if (!f) return true;
  if (f.direction === "increasing" && !(p.slope > 0)) return false;
  if (f.direction === "decreasing" && !(p.slope < 0)) return false;
  if (f.significance === "significant" && !p.sig) return false;
  if (f.significance === "not-significant" && p.sig) return false;
  return true;
}

/** Robust |slope| scale (95th percentile) used to size markers consistently across renderers. */
export function atlasSlopeScale(points: readonly AtlasPoint[]): number {
  const v = points.map((p) => Math.abs(p.slope)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 1;
  const q = v[Math.min(v.length - 1, Math.floor(v.length * 0.95))];
  return q > 0 ? q : v[v.length - 1] || 1;
}

/** Marker diameter in CSS px. */
export function atlasMarkerSize(p: AtlasPoint, scale: number): number {
  if (atlasKind(p) === "flat") return 6;
  const s = Math.min(1, Math.abs(p.slope) / (scale || 1));
  return 7 + 8 * Math.sqrt(s);
}

/** Normalizes a BBox: wraps lon into [-180,180], clamps lat, orders south/north. */
export function normalizeBBox(b: BBox): BBox {
  const wrap = (l: number) => ((((l + 180) % 360) + 360) % 360) - 180;
  const south = Math.max(-90, Math.min(b.south, b.north));
  const north = Math.min(90, Math.max(b.south, b.north));
  const span = b.east - b.west;
  if (Math.abs(span) >= 360) return { west: -180, east: 180, south, north };
  let west = wrap(b.west);
  let east = wrap(b.east);
  if (east === -180 && span > 0) east = 180;
  if (west === 180) west = -180;
  return { west, south, east, north };
}
