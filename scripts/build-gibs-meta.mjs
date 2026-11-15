// EARTHSCOPE — curated NASA GIBS layer metadata.
//
//   node scripts/build-gibs-meta.mjs            # uses cached capabilities if present
//   node scripts/build-gibs-meta.mjs --refresh  # re-download capabilities + re-verify
//
// 1. Parses the GIBS WMTS capabilities (EPSG:4326 "best") for a curated list of layers:
//    title, format, time dimension (all <Value> ranges), horizontal legend, colormap units.
// 2. Verifies every time-varying data layer with a real WMS GetMap (512×256 PNG) at its
//    `end` date. GIBS silently returns a tiny transparent PNG when TIME is out of range,
//    so a layer counts as verified only if the PNG is > 2 KB.
// Output: src/data/gibs-layers.json

import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { ROOT, RAW_DIR, cachedFetch, limiter, writeJson, todayIso } from "./lib/http.mjs";

const CAPS_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml";
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const CACHE = resolve(RAW_DIR, "gibs");
const OUT = resolve(ROOT, "src/data/gibs-layers.json");
const MIN_VERIFY_BYTES = 2048;

// Curated list. `alternatives` are only used if the primary id is missing from the capabilities.
const CURATED = [
  { id: "BlueMarble_NextGeneration", category: "base" },
  { id: "VIIRS_Black_Marble", category: "base" },
  { id: "MERRA2_2m_Air_Temperature_Monthly", variableId: "t2m", category: "atmosphere" },
  { id: "MERRA2_Precipitation_Bias_Corrected_Monthly", variableId: "precip", category: "water" },
  { id: "MODIS_Terra_L3_NDVI_Monthly", variableId: "ndvi", category: "land" },
  { id: "MODIS_Terra_L3_Land_Surface_Temp_Monthly_CMG_Day_TES", variableId: "lst", category: "land" },
  { id: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", variableId: "soil-root", category: "land" },
  { id: "MERRA2_Aerosol_Optical_Depth_Analysis_Monthly", variableId: "aod", category: "atmosphere" },
  { id: "MERRA2_Total_Precipitable_Water_Vapor_Monthly", variableId: "water-vapor", category: "atmosphere" },
  { id: "OMI_Ozone_TOMS_Total_Column", variableId: "ozone", category: "atmosphere" },
  { id: "MERRA2_Evaporation_Land_Monthly", variableId: "evap", category: "land" },
  { id: "GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI", variableId: "water-storage", category: "water" },
  { id: "MODIS_Aqua_L3_SST_Thermal_4km_Day_Monthly", variableId: "sst", category: "ocean", alternatives: ["MODIS_Terra_L3_SST_Thermal_4km_Day_Monthly"] },
  { id: "AMSRU2_Sea_Ice_Concentration_12km", variableId: "sea-ice", category: "ocean", alternatives: ["AMSRU2_Sea_Ice_Concentration_25km"] },
  // Chlorophyll: chosen automatically below (see pickChlorophyll).
  { id: null, variableId: "chlorophyll", category: "ocean", pick: "chlorophyll" },
];

/* ----------------------------- XML parsing ------------------------------ */

const decode = (s) =>
  s
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name.replace(":", "\\:")}=(['"])(.*?)\\1`));
  return m ? decode(m[2]) : undefined;
}

function parseLayers(xml) {
  const blocks = xml.split("<Layer>").slice(1).map((s) => s.split("</Layer>")[0]);
  const out = new Map();
  for (const b of blocks) {
    const id = b.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/)?.[1];
    if (!id) continue;
    const title = decode(b.match(/<ows:Title[^>]*>([^<]*)<\/ows:Title>/)?.[1]);
    const format = b.match(/<Format>([^<]+)<\/Format>/)?.[1];
    const legends = [...b.matchAll(/<LegendURL\b[^>]*\/>/g)].map((m) => ({
      role: attr(m[0], "xlink:role"),
      format: attr(m[0], "format"),
      href: attr(m[0], "xlink:href"),
      title: attr(m[0], "xlink:title"),
    }));
    const colormaps = [...b.matchAll(/<ows:Metadata\b[^>]*\/>/g)]
      .map((m) => ({ role: attr(m[0], "xlink:role"), href: attr(m[0], "xlink:href") }))
      .filter((m) => /colormap/.test(m.role ?? ""));
    const dim = b.match(/<Dimension>([\s\S]*?)<\/Dimension>/)?.[1];
    const values = dim ? [...dim.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1].trim()) : [];
    const defaultTime = dim?.match(/<Default>([^<]+)<\/Default>/)?.[1];
    out.set(id, { id, title, format, legends, colormaps, values, defaultTime });
  }
  return out;
}

/** "2000-02-01/2024-12-01/P1M" or single date → {start, end, period}. */
function parseRange(v) {
  const [start, end, period] = v.split("/");
  return { start: start.slice(0, 10), end: (end ?? start).slice(0, 10), period: period ?? null };
}

const DAY = 86_400_000;
function coverageDays(ranges) {
  return ranges.reduce((s, r) => s + (Date.parse(r.end) - Date.parse(r.start)) / DAY + 1, 0);
}

/** Longest *clean* record: covered days minus a penalty for every gap. Daily or monthly. */
function pickChlorophyll(layers) {
  const cands = [...layers.values()].filter((l) => /chlorophyll[ _]a\b/i.test(l.title ?? "") && l.values.length);
  const monthly = cands.filter((l) => l.values.some((v) => v.endsWith("/P1M")));
  const pool = monthly.length ? monthly : cands;
  const scored = pool
    .map((l) => {
      const ranges = l.values.map(parseRange);
      const cov = coverageDays(ranges);
      const gaps = ranges.slice(1).map((r, i) => Math.round((Date.parse(r.start) - Date.parse(ranges[i].end)) / DAY - 1));
      const gapDays = gaps.reduce((s, g) => s + g, 0);
      return { id: l.id, title: l.title, cov, gaps: gaps.length, gapDays, score: cov - 30 * gaps.length - gapDays, start: ranges[0].start, end: ranges.at(-1).end };
    })
    .sort((a, b) => b.score - a.score);
  return { chosen: scored[0], candidates: scored, monthlyAvailable: monthly.length > 0 };
}

/* -------------------------------- units --------------------------------- */

async function colormapUnits(layer) {
  const cm = layer.colormaps.find((c) => c.role?.endsWith("/1.3")) ?? layer.colormaps.at(-1);
  if (!cm?.href) return undefined;
  try {
    const { body } = await cachedFetch(cm.href, resolve(CACHE, "colormaps", `${layer.id}.xml.gz`), {
      validate: (b, s) => s === 200 && b.includes("<ColorMap"),
    });
    const xml = body.toString("utf8");
    const units = [...xml.matchAll(/<ColorMap\b[^>]*>/g)].map((m) => attr(m[0], "units")).filter(Boolean);
    return units[0];
  } catch (e) {
    console.warn(`  colormap for ${layer.id} unavailable: ${e.message.slice(0, 120)}`);
    return undefined;
  }
}

/* ------------------------------ WMS verify ------------------------------ */

function wmsUrl(id, time, format = "image/png") {
  const q = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: id,
    STYLES: "",
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: "512",
    HEIGHT: "256",
    FORMAT: format,
    TRANSPARENT: "TRUE",
  });
  if (time) q.set("TIME", time);
  return `${WMS}?${q}`;
}

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function verifyLayer(id, time) {
  const url = wmsUrl(id, time);
  const cachePath = resolve(CACHE, "verify", `${id}_${time}.png.gz`);
  const { body, meta } = await cachedFetch(url, cachePath, { validate: (b, s) => s === 200 });
  const png = pngSize(body);
  const isPng = !!png && png.width === 512 && png.height === 256;
  return {
    url,
    time,
    bytes: body.length,
    isPng,
    contentType: meta.contentType,
    ok: isPng && body.length > MIN_VERIFY_BYTES,
    checked: meta.retrieved ?? new Date().toISOString(),
    error: isPng ? undefined : body.subarray(0, 200).toString("utf8").replace(/\s+/g, " "),
  };
}

/** Step back one period from an ISO date (P1M/P1D/P8D/P16D/P1Y/P28D). */
function stepBack(date, period) {
  const d = new Date(date + "T00:00:00Z");
  const m = period?.match(/^P(\d+)([DMY])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "D") d.setUTCDate(d.getUTCDate() - n);
  if (m[2] === "M") d.setUTCMonth(d.getUTCMonth() - n);
  if (m[2] === "Y") d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const refresh = process.argv.includes("--refresh");
  if (refresh) {
    await rm(resolve(CACHE, "WMTSCapabilities.xml.gz"), { force: true });
    await rm(resolve(CACHE, "verify"), { recursive: true, force: true });
  }
  const caps = await cachedFetch(CAPS_URL, resolve(CACHE, "WMTSCapabilities.xml.gz"), {
    timeoutMs: 300_000,
    validate: (b, s) => s === 200 && b.includes("<Capabilities"),
  });
  const capsRetrieved = caps.meta.retrieved ?? new Date().toISOString();
  console.log(`Capabilities: ${(caps.body.length / 1e6).toFixed(1)} MB${caps.fromCache ? " (cache)" : ""}, retrieved ${capsRetrieved}`);
  const layers = parseLayers(caps.body.toString("utf8"));
  console.log(`Parsed ${layers.size} layers`);

  const chl = pickChlorophyll(layers);
  console.log(
    `Chlorophyll: ${chl.monthlyAvailable ? "monthly" : "NO monthly L3 layer in EPSG:4326 best — using daily"}; chose ${chl.chosen.id} (${chl.chosen.start}…${chl.chosen.end}, ${chl.chosen.gaps} gaps / ${chl.chosen.gapDays} missing days)`,
  );

  const entries = [];
  const notes = [];
  for (const c of CURATED) {
    let id = c.id;
    let substitution;
    if (c.pick === "chlorophyll") {
      id = chl.chosen.id;
      substitution = chl.monthlyAvailable
        ? `Chlorophyll layer chosen automatically as the monthly layer with the longest clean record.`
        : `No monthly L3 chlorophyll-a layer exists in GIBS EPSG:4326 "best"; chose the daily layer with the longest clean record (${chl.chosen.start} to ${chl.chosen.end}, ${chl.chosen.gaps} short gaps). Runners-up: ${chl.candidates
            .slice(1, 4)
            .map((x) => `${x.id} (${x.start}…${x.end}, ${x.gaps} gaps)`)
            .join("; ")}.`;
    } else if (!layers.has(id)) {
      const alt = (c.alternatives ?? []).find((a) => layers.has(a));
      if (!alt) throw new Error(`Layer ${id} missing from capabilities and no alternative found`);
      substitution = `Requested layer ${id} not in GIBS capabilities; substituted ${alt}.`;
      id = alt;
    }
    const L = layers.get(id);
    const ranges = L.values.map(parseRange);
    const periods = [...new Set(ranges.map((r) => r.period).filter(Boolean))];
    const periodCounts = ranges.reduce((acc, r) => ((acc[r.period] = (acc[r.period] ?? 0) + 1), acc), {});
    const mainPeriod = Object.entries(periodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const legendH =
      L.legends.find((l) => /horizontal/.test(l.role ?? "") && /_H\.svg$/i.test(l.href ?? "")) ??
      L.legends.find((l) => /horizontal/.test(l.role ?? "")) ??
      L.legends.find((l) => l.format === "image/png") ??
      L.legends[0];
    const units = c.category === "base" ? undefined : await colormapUnits(L);
    // Overall extent = min start / max end over ALL ranges (GIBS ranges can overlap or be
    // listed out of order, e.g. GRACE has "2019-03-01/2022-12-01" before "2020-02-01/2022-07-01").
    const allDates = ranges.flatMap((r) => [r.start, r.end]).sort();
    const anomalies = ranges.filter((r) => r.end < r.start).map((r) => `${r.start}/${r.end}`);

    const e = {
      id,
      title: L.title,
      ...(c.variableId ? { variableId: c.variableId } : {}),
      category: c.category,
      format: L.format,
      ...(ranges.length
        ? {
            start: allDates[0],
            end: allDates.at(-1),
            ...(anomalies.length ? { rangeAnomalies: anomalies } : {}),
            period: c.category === "base" ? ranges.at(-1).period : mainPeriod,
            ...(periods.length > 1 ? { periods } : {}),
            ranges: L.values,
            defaultTime: L.defaultTime,
          }
        : {}),
      ...(legendH?.href ? { legendUrl: legendH.href } : {}),
      ...(units ? { units } : {}),
      ...(substitution ? { description: substitution, substitution: true } : {}),
    };
    if (substitution) notes.push(substitution);
    entries.push(e);
  }

  // Verify data layers at their end date (≤3 concurrent).
  const limit = limiter(3);
  await Promise.all(
    entries.map((e) =>
      limit(async () => {
        if (e.category === "base") {
          // Static / annual base maps: verify with the time we actually use (JPEG for BlueMarble).
          const time = e.id === "VIIRS_Black_Marble" ? e.end : undefined;
          const v = await verifyLayer(e.id, time).catch((err) => ({ ok: false, bytes: 0, error: err.message }));
          e.verified = v.ok;
          e.verifyBytes = v.bytes;
          e.verifyTime = time ?? null;
          return;
        }
        try {
          const v = await verifyLayer(e.id, e.end);
          e.verified = v.ok;
          e.verifyBytes = v.bytes;
          e.verifyTime = v.time;
          e.verifyUrl = v.url;
          if (v.ok) {
            e.verifiedEnd = e.end;
          } else {
            // `verified` stays false (the advertised end does not render). Walk back up to 8
            // periods to find the latest date that DOES render, so the app has a usable date.
            let t = e.end;
            const tried = [];
            for (let k = 0; k < 8; k++) {
              t = stepBack(t, e.period);
              if (!t || t < e.start) break;
              const pv = await verifyLayer(e.id, t);
              tried.push({ time: t, ok: pv.ok, bytes: pv.bytes });
              if (pv.ok) {
                e.verifiedEnd = t;
                break;
              }
            }
            e.verifyWalkBack = tried;
          }
        } catch (err) {
          e.verified = false;
          e.verifyBytes = 0;
          e.verifyError = String(err.message).slice(0, 200);
        }
      }),
    ),
  );

  const out = entries.map((e) => ({ ...e, capabilitiesRetrieved: capsRetrieved.slice(0, 10), verifiedOn: todayIso() }));
  await writeJson(OUT, out);

  console.log("\nid".padEnd(58) + "start       end         period  units     verified  bytes");
  for (const e of out) {
    console.log(
      `${e.id.padEnd(57)} ${(e.start ?? "static").padEnd(11)} ${(e.end ?? "").padEnd(11)} ${(e.period ?? "").padEnd(7)} ${(e.units ?? "").padEnd(9)} ${String(e.verified).padEnd(9)} ${e.verifyBytes}` +
        (e.verifyWalkBack ? `  → verifiedEnd ${e.verifiedEnd ?? "none"} (${e.verifyWalkBack.map((w) => `${w.time}:${w.bytes}B`).join(", ")})` : ""),
    );
  }
  if (notes.length) console.log("\nNotes:\n- " + notes.join("\n- "));
  console.log(`\nWrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
