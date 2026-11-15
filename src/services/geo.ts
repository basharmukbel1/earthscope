import { geoArea, geoBounds, geoCentroid, geoContains } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature as topoFeature } from "topojson-client";
import type { BBox, Region } from "@/types/domain";
import { NAMED_REGIONS, parseCoordinates } from "@/data/regions";
import { POWER_GRID, snapToPowerGrid } from "./power";

/* ==========================================================================
   Geography: country polygons (Natural Earth 1:50m via world-atlas), place
   search, and the spatial sampling plan used to build regional means.
   ========================================================================== */

export type CountryFeature = Feature<Geometry, { name: string }> & { id: string };

let countriesPromise: Promise<CountryFeature[]> | null = null;

export function loadCountries(): Promise<CountryFeature[]> {
  if (!countriesPromise) {
    countriesPromise = import("world-atlas/countries-50m.json").then((mod) => {
      const topo = (mod as { default?: unknown }).default ?? mod;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fc = topoFeature(topo as any, (topo as any).objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
      const seen = new Set<string>();
      return fc.features
        .filter((f) => f.geometry && f.properties?.name)
        .map((f) => {
          // world-atlas reuses ISO numeric ids for some territories (e.g. 036 = Australia and
          // Ashmore & Cartier Is.) — make ids unique so selection and React keys are exact.
          let id = String(f.id ?? f.properties.name);
          if (seen.has(id)) id = `${id}-${f.properties.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          seen.add(id);
          return { ...f, id } as CountryFeature;
        });
    });
    // Never cache a failure (e.g. a dropped connection): the next call retries.
    countriesPromise.catch(() => {
      countriesPromise = null;
    });
  }
  return countriesPromise;
}

/** The country polygon for a region: by id, then by name, then the country containing its centre. */
export function matchCountry(region: Region, countries: CountryFeature[]): CountryFeature | undefined {
  if (region.kind !== "country") return undefined;
  return (
    countries.find((c) => c.id === region.countryId) ??
    countries.find((c) => c.properties.name === region.name) ??
    countries.find((c) => geoContains(c, region.center))
  );
}

/**
 * Bounding box to fit a map view on. Countries with far-flung islands across the
 * 180° meridian (USA, Russia, New Zealand, Fiji…) have a world-spanning box, so we
 * fit on their largest polygon (the mainland) instead.
 */
export function viewBBoxFor(f: CountryFeature): BBox {
  const full = featureBBox(f);
  const span = (full.east < full.west ? full.east + 360 : full.east) - full.west;
  if (f.geometry.type !== "MultiPolygon" || (full.east >= full.west && span <= 180)) return full;
  let best: Feature | null = null;
  let bestArea = -1;
  for (const coordinates of f.geometry.coordinates) {
    const part: Feature = { type: "Feature", geometry: { type: "Polygon", coordinates }, properties: {} };
    const a = geoArea(part);
    if (a > bestArea) (bestArea = a), (best = part);
  }
  return best ? featureBBox(best) : full;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Common aliases → Natural Earth names. */
const ALIASES: Record<string, string> = {
  usa: "United States of America",
  "united states": "United States of America",
  us: "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  drc: "Dem. Rep. Congo",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "congo kinshasa": "Dem. Rep. Congo",
  "south korea": "South Korea",
  "north korea": "North Korea",
  "ivory coast": "Côte d'Ivoire",
  "czech republic": "Czechia",
  uae: "United Arab Emirates",
  "saudi": "Saudi Arabia",
  "bosnia": "Bosnia and Herz.",
  "central african republic": "Central African Rep.",
  "south sudan": "S. Sudan",
  "dominican republic": "Dominican Rep.",
  "equatorial guinea": "Eq. Guinea",
  burma: "Myanmar",
};

export async function findCountry(name: string): Promise<CountryFeature | undefined> {
  const countries = await loadCountries();
  const target = norm(ALIASES[norm(name)] ?? name);
  return countries.find((c) => norm(c.properties.name) === target);
}

export function featureBBox(f: Feature): BBox {
  const [[west, south], [east, north]] = geoBounds(f);
  return { west, south, east, north };
}

export function countryToRegion(c: CountryFeature): Region {
  const bbox = featureBBox(c);
  const [lon, lat] = geoCentroid(c);
  return {
    id: `country-${c.id}`,
    name: c.properties.name,
    kind: "country",
    bbox,
    center: [lon, lat],
    countryId: c.id,
  };
}

export async function countryFeatureFor(region: Region): Promise<CountryFeature | undefined> {
  if (region.kind !== "country" || !region.countryId) return undefined;
  const countries = await loadCountries();
  return countries.find((c) => c.id === region.countryId);
}

export async function countryAtPoint(lon: number, lat: number): Promise<CountryFeature | undefined> {
  const countries = await loadCountries();
  return countries.find((c) => geoContains(c, [lon, lat]));
}

/** Search countries + named regions + raw coordinates. */
export async function searchPlaces(query: string, limit = 8): Promise<Region[]> {
  const q = norm(query);
  if (!q) return [];
  const coord = parseCoordinates(query);
  const out: Region[] = coord ? [coord] : [];
  const countries = await loadCountries();
  const alias = ALIASES[q];
  const scored: { r: Region; s: number }[] = [];
  for (const c of countries) {
    const n = norm(c.properties.name);
    let s = -1;
    if (alias && c.properties.name === alias) s = 100;
    else if (n === q) s = 90;
    else if (n.startsWith(q)) s = 70;
    else if (n.includes(q)) s = 40;
    if (s > 0) scored.push({ r: countryToRegion(c), s });
  }
  for (const r of NAMED_REGIONS) {
    const n = norm(r.name);
    const ctx = norm(r.context ?? "");
    let s = -1;
    if (n === q) s = 85;
    else if (n.startsWith(q)) s = 65;
    else if (n.includes(q)) s = 45;
    else if (q.length > 3 && ctx.includes(q)) s = 20;
    if (s > 0) scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name));
  return [...out, ...scored.map((x) => x.r)].slice(0, limit);
}

/* --------------------------- sampling plan -------------------------------- */

export interface SamplePoint {
  lon: number;
  lat: number;
  /** area weight ∝ cos(latitude) */
  w: number;
}

export interface SamplePlan {
  points: SamplePoint[];
  /** Number of POWER grid cells (0.5° × 0.625°) whose centres fall inside the region. */
  cellsTotal: number;
  method: "all-cells" | "systematic" | "nearest-cell";
  /** Sampling stride in grid cells (1 = every cell). */
  stride: number;
  description: string;
}

export const MAX_SAMPLE_POINTS = 32;

/** Normalised east bound so that east >= west (adds 360 across the antimeridian). */
const unwrapEast = (b: BBox) => (b.east < b.west ? b.east + 360 : b.east);

/**
 * Build the spatial sampling plan for a region: every POWER grid cell inside
 * the region when there are ≤ MAX_SAMPLE_POINTS, otherwise a systematic
 * (regular-stride) subsample of the cells. Points are area-weighted by
 * cos(latitude) when averaged.
 */
export function buildSamplePlan(region: Region, feature?: Feature): SamplePlan {
  const b = region.bbox;
  const east = unwrapEast(b);
  const toRad = Math.PI / 180;
  const meanLat = (b.south + b.north) / 2;
  const cellSolidAngle = POWER_GRID.dLat * toRad * POWER_GRID.dLon * toRad * Math.max(0.05, Math.cos(meanLat * toRad));

  // Estimated cells inside the region (exact for bbox regions up to rounding).
  let estCells: number;
  if (feature) estCells = Math.max(1, Math.round(geoArea(feature) / cellSolidAngle));
  else estCells = Math.max(1, Math.round(((b.north - b.south) / POWER_GRID.dLat) * ((east - b.west) / POWER_GRID.dLon)));

  const stride = Math.max(1, Math.ceil(Math.sqrt(estCells / MAX_SAMPLE_POINTS)));
  const latStart = Math.ceil(b.south / POWER_GRID.dLat) * POWER_GRID.dLat;
  const lonStart = Math.ceil(b.west / POWER_GRID.dLon) * POWER_GRID.dLon;

  const pts: SamplePoint[] = [];
  const latOffset = stride > 1 ? Math.floor(stride / 2) * POWER_GRID.dLat : 0;
  const lonOffset = stride > 1 ? Math.floor(stride / 2) * POWER_GRID.dLon : 0;
  for (let lat = latStart + latOffset; lat <= b.north + 1e-9; lat += POWER_GRID.dLat * stride) {
    for (let lonU = lonStart + lonOffset; lonU <= east + 1e-9; lonU += POWER_GRID.dLon * stride) {
      const lon = lonU > 180 ? lonU - 360 : lonU;
      if (feature && !geoContains(feature, [lon, lat])) continue;
      pts.push({ lon: +lon.toFixed(4), lat: +lat.toFixed(4), w: Math.cos(lat * toRad) });
    }
  }

  if (pts.length === 0) {
    const [lon, lat] = snapToPowerGrid(region.center[0], region.center[1]);
    return {
      points: [{ lon, lat, w: 1 }],
      cellsTotal: estCells,
      method: "nearest-cell",
      stride: 1,
      description: "Region is smaller than one 0.5° × 0.625° grid cell — using the nearest cell to its centre.",
    };
  }
  const exactAll = stride === 1;
  return {
    points: pts,
    cellsTotal: exactAll ? pts.length : estCells,
    method: exactAll ? "all-cells" : "systematic",
    stride,
    description: exactAll
      ? `Area-weighted mean of all ${pts.length} grid cells (0.5° × 0.625°) inside the region.`
      : `Area-weighted mean of ${pts.length} grid cells sampled systematically (every ${stride}th cell) out of ≈${estCells} inside the region.`,
  };
}
