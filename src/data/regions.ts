import type { Region } from "@/types/domain";

/* ==========================================================================
   Named-region gazetteer (no external geocoder: privacy + no API keys).
   Countries come from world-atlas at runtime (see services/geo.ts); these are
   scientifically interesting regions with hand-checked bounding boxes and a
   one-line physical context used by the question parser and AI Analyst.
   ========================================================================== */

const r = (
  id: string,
  name: string,
  west: number,
  south: number,
  east: number,
  north: number,
  context: string,
): Region => ({
  id,
  name,
  kind: "named",
  bbox: { west, south, east, north },
  center: [(west + east) / 2, (south + north) / 2],
  context,
});

export const NAMED_REGIONS: Region[] = [
  r("amazon-rondonia", "Amazon frontier · Rondônia", -66, -13.5, -60, -8, "Tropical rainforest with active deforestation along the 'arc of deforestation'."),
  r("amazon-central", "Central Amazon basin", -68, -8, -55, -1, "Tropical rainforest; wet season Dec–May."),
  r("sahel-west", "Western Sahel", -12, 12, 4, 17, "Semi-arid belt south of the Sahara; single summer monsoon rainy season."),
  r("mediterranean-iberia", "Iberian Peninsula", -9.5, 36, 3.3, 43.8, "Mediterranean climate: dry summers, winter rain from Atlantic storms."),
  r("levant", "Levant (Eastern Mediterranean)", 34, 29, 39, 36.5, "Semi-arid to arid; winter-rain regime at the edge of the storm track."),
  r("arctic-svalbard", "Svalbard & Barents Sea", 10, 74, 35, 81, "High Arctic; sea-ice retreat region known for very rapid warming."),
  r("indo-gangetic", "Indo-Gangetic Plain", 74, 23, 89, 31, "Densely populated, agricultural plain; heavy aerosol and haze loading."),
  r("tibetan-plateau", "Tibetan Plateau", 80, 28, 100, 37, "High-altitude 'third pole'; snow, glaciers and permafrost."),
  r("us-great-plains", "US Great Plains", -104, 33, -95, 45, "Continental grassland and farmland; irrigated agriculture over the Ogallala aquifer."),
  r("california-central-valley", "California Central Valley", -122.5, 35, -118.8, 40.5, "Irrigated agricultural valley; groundwater pumping during droughts."),
  r("lake-chad", "Lake Chad basin", 12, 11, 16, 15.5, "Shallow Sahelian lake that shrank dramatically after the 1970s."),
  r("aral-sea", "Aral Sea region", 57.5, 43, 62, 47, "Desiccated inland sea after river diversions for irrigation."),
  r("nile-delta", "Nile Delta", 29.5, 30, 32.5, 31.7, "Densely farmed river delta on the arid Mediterranean coast."),
  r("congo-basin", "Congo basin", 15, -5, 28, 4, "Second-largest tropical rainforest; two rainy seasons."),
  r("yakutia", "Eastern Siberia · Yakutia", 115, 58, 135, 67, "Boreal forest on permafrost; extreme continental climate."),
  r("greenland-west", "West Greenland margin", -55, 62, -45, 72, "Ice-sheet margin with summer melt."),
  r("antarctic-peninsula", "Antarctic Peninsula", -68, -70, -55, -62, "Fast-warming peninsula; ice shelves and sea ice."),
  r("murray-darling", "Murray–Darling basin", 140, -37, 152, -25, "Australia's food bowl; recurrent multi-year droughts."),
  r("beijing", "Beijing metropolitan area", 115.5, 39.4, 117.5, 41, "Megacity; air above a large city with strong aerosol changes."),
  r("delhi", "Delhi National Capital Region", 76.5, 28, 77.8, 29.2, "Megacity with severe seasonal haze."),
  r("sundarbans", "Sundarbans · Ganges delta", 88, 21.4, 90.5, 22.8, "Tidal estuary and mangrove forest."),
  r("chesapeake", "Chesapeake Bay", -77.5, 36.8, -75.6, 39.6, "Large tidal estuary; nutrient runoff and water clarity."),
  r("great-barrier-reef", "Great Barrier Reef", 143, -24, 153, -11, "Coral reef ecosystem sensitive to marine heat waves."),
  r("nino34", "Niño 3.4 (central Pacific)", -170, -5, -120, 5, "Equatorial Pacific box used to track El Niño / La Niña."),
  r("gulf-stream", "Gulf Stream (NW Atlantic)", -75, 35, -60, 42, "Warm western boundary current."),
  r("north-atlantic-subpolar", "Subpolar North Atlantic", -45, 50, -20, 60, "Ocean region with a noted 'cold blob' anomaly."),
  r("sahara-central", "Central Sahara", 0, 20, 20, 28, "Hyper-arid desert; dust source region."),
  r("borneo", "Borneo", 109, -4.2, 119.3, 7, "Tropical rainforest and peatlands; oil-palm expansion and fire haze."),
  r("arctic", "Arctic (Northern Hemisphere sea ice)", -180, 60, 180, 90, "Arctic Ocean and marginal seas; sea-ice extent is a hemisphere total."),
  r("antarctic", "Antarctic (Southern Hemisphere sea ice)", -180, -90, 180, -50, "Southern Ocean around Antarctica; sea-ice extent is a hemisphere total."),
  r("global", "Whole Earth (global mean)", -180, -90, 180, 90, "Global mean over land and ocean."),
  // Single MODIS 250 m pixels used by the bundled NDVI records (bbox drawn ±0.25° for visibility).
  r("sahel", "Sahel pixel · Burkina Faso (14.5°N, 1.5°W)", -1.75, 14.25, -1.25, 14.75, "One 250 m MODIS pixel in the semi-arid Sahel; single summer rainy season."),
  r("rondonia", "Amazon frontier pixel · Rondônia (10.0°S, 62.9°W)", -63.15, -10.25, -62.65, -9.75, "One 250 m MODIS pixel at the Amazon forest frontier."),
];

export const NAMED_REGION_BY_ID: Record<string, Region> = Object.fromEntries(NAMED_REGIONS.map((x) => [x.id, x]));

/** Parse "31.9, 35.9" / "31.9N 35.9E" style coordinates into a point region. */
export function parseCoordinates(text: string): Region | null {
  const m = text
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const d = 1.0;
  return {
    id: `pt-${lat.toFixed(2)}_${lon.toFixed(2)}`,
    name: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`,
    kind: "point",
    bbox: { west: lon - d, south: lat - d, east: lon + d, north: lat + d },
    center: [lon, lat],
    context: "User-specified location (≈2° × 2° box around the point).",
  };
}

export function bboxRegion(bbox: Region["bbox"], name?: string): Region {
  const f = (x: number) => x.toFixed(1);
  return {
    id: `bbox-${f(bbox.west)}_${f(bbox.south)}_${f(bbox.east)}_${f(bbox.north)}`,
    name: name ?? `Box ${f(bbox.south)}°…${f(bbox.north)}°, ${f(bbox.west)}°…${f(bbox.east)}°`,
    kind: "bbox",
    bbox,
    center: [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2],
    context: "Custom bounding box drawn on the map.",
  };
}
