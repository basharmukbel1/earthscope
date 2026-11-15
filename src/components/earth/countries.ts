/* ==========================================================================
   EARTHSCOPE — world-atlas loaders (lazy, cached) + point-in-country lookup.

   - loadCountries("110m" | "50m") → GeoJSON features with `id` (numeric
     world-atlas id as string, e.g. "076") and `properties.name`.
   - countryAt(lon, lat) → feature under a point (sync once 110m is loaded),
     using d3 geoContains (spherical) with a bbox pre-filter that understands
     antimeridian-wrapping bounds (Russia, Fiji, USA at 50m …).
   ========================================================================== */

import { feature, mesh } from "topojson-client";
import { geoBounds, geoContains } from "d3-geo";
import type { Feature, MultiLineString, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110Url from "world-atlas/countries-110m.json?url";
import countries50Url from "world-atlas/countries-50m.json?url";
import land110Url from "world-atlas/land-110m.json?url";

export type CountryGeometry = Polygon | MultiPolygon;
export interface CountryFeature extends Feature<CountryGeometry, { name: string }> {
  id: string;
}
export type AtlasResolution = "110m" | "50m";

export interface CountryData {
  resolution: AtlasResolution;
  topology: Topology;
  features: CountryFeature[];
  byId: Map<string, CountryFeature>;
  /** [west, south, east, north] per feature (west > east ⇒ wraps the antimeridian). */
  bounds: Float64Array;
}

const URLS: Record<AtlasResolution, string> = { "110m": countries110Url, "50m": countries50Url };
const promises = new Map<AtlasResolution, Promise<CountryData>>();
const loaded = new Map<AtlasResolution, CountryData>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Lazily loads (once) and converts world-atlas countries to GeoJSON. */
export function loadCountries(resolution: AtlasResolution = "110m"): Promise<CountryData> {
  let p = promises.get(resolution);
  if (!p) {
    p = fetchJson<Topology>(URLS[resolution]).then((topology) => {
      const obj = topology.objects.countries as GeometryCollection<{ name: string }>;
      const fc = feature(topology, obj);
      const features: CountryFeature[] = [];
      for (const f of fc.features) {
        if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) continue;
        const id = f.id == null ? `x-${features.length}` : String(f.id);
        features.push({ ...(f as Feature<CountryGeometry, { name: string }>), id });
      }
      const bounds = new Float64Array(features.length * 4);
      features.forEach((f, i) => {
        const [[w, s], [e, n]] = geoBounds(f);
        bounds.set([w, s, e, n], i * 4);
      });
      const data: CountryData = {
        resolution,
        topology,
        features,
        byId: new Map(features.map((f) => [f.id, f])),
        bounds,
      };
      loaded.set(resolution, data);
      return data;
    });
    p.catch(() => promises.delete(resolution));
    promises.set(resolution, p);
  }
  return p;
}

/** Synchronous access to an already-loaded dataset (null until loadCountries resolved). */
export function getLoadedCountries(resolution: AtlasResolution = "110m"): CountryData | null {
  return loaded.get(resolution) ?? null;
}

/** Best available loaded dataset (prefers 50m). */
export function getBestLoadedCountries(): CountryData | null {
  return loaded.get("50m") ?? loaded.get("110m") ?? null;
}

function inBounds(b: Float64Array, i: number, lon: number, lat: number): boolean {
  const w = b[i * 4];
  const s = b[i * 4 + 1];
  const e = b[i * 4 + 2];
  const n = b[i * 4 + 3];
  if (lat < s - 1e-9 || lat > n + 1e-9) return false;
  if (w <= e) return lon >= w - 1e-9 && lon <= e + 1e-9;
  return lon >= w - 1e-9 || lon <= e + 1e-9; // wraps the antimeridian
}

/**
 * Country containing (lon, lat), or null. Synchronous: returns null until the
 * 110m dataset is loaded (call loadCountries() early). Pass `data` to query
 * another resolution.
 */
export function countryAt(lon: number, lat: number, data: CountryData | null = loaded.get("110m") ?? null): CountryFeature | null {
  if (!data || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const L = ((((lon + 180) % 360) + 360) % 360) - 180;
  const { features, bounds } = data;
  for (let i = 0; i < features.length; i++) {
    if (!inBounds(bounds, i, L, lat)) continue;
    if (geoContains(features[i], [L, lat])) return features[i];
  }
  return null;
}

/** Async variant that loads the 110m dataset first. */
export async function countryAtAsync(lon: number, lat: number): Promise<CountryFeature | null> {
  const data = await loadCountries("110m");
  return countryAt(lon, lat, data);
}

/** Feature lookup by world-atlas id ("076" and "76" both accepted). */
export function findCountry(id: string, data: CountryData | null = getBestLoadedCountries()): CountryFeature | undefined {
  if (!data) return undefined;
  return data.byId.get(id) ?? data.byId.get(id.padStart(3, "0")) ?? data.byId.get(String(Number(id)));
}

/** Shared borders (a ≠ b) and coastlines (a = b) as MultiLineStrings. */
export function countryMeshes(data: CountryData): { borders: MultiLineString; coasts: MultiLineString } {
  const obj = data.topology.objects.countries as GeometryCollection;
  return {
    borders: mesh(data.topology, obj, (a, b) => a !== b),
    coasts: mesh(data.topology, obj, (a, b) => a === b),
  };
}

let landPromise: Promise<MultiPolygon> | null = null;
/** world-atlas land-110m as a single MultiPolygon (cached). */
export function loadLand(): Promise<MultiPolygon> {
  if (!landPromise) {
    landPromise = fetchJson<Topology>(land110Url).then((topology) => {
      const fc = feature(topology, topology.objects.land as GeometryCollection);
      const polys: MultiPolygon["coordinates"] = [];
      for (const f of fc.features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === "Polygon") polys.push(g.coordinates);
        else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
      }
      return { type: "MultiPolygon", coordinates: polys } as MultiPolygon;
    });
    landPromise.catch(() => (landPromise = null));
  }
  return landPromise;
}
