// EARTHSCOPE — REAL non-reanalysis time series obtainable without login, saved as
// TimeSeries JSON snapshots (src/types/domain.ts shape, provenance.mode = "snapshot").
//
//   node scripts/build-external.mjs                    # all sources
//   node scripts/build-external.mjs --only=nsidc,gistemp
//   node scripts/build-external.mjs --only=modis       # slow: ORNL API ~50 s per request
//
// Sources
//   nsidc   NSIDC Sea Ice Index (G02135) monthly sea-ice extent, Arctic + Antarctic (satellite passive microwave)
//   modis   ORNL DAAC MODIS/VIIRS Land Product Subsets REST API — MOD13Q1 v061 250 m 16-day NDVI at 2 sites
//   gistemp NASA GISTEMP v4 global land-ocean temperature anomaly (station + ship/buoy, not satellite)
//
// Every raw response is cached gzipped under data-raw/external/ (resumable).
// Output: src/data/external/*.json + manifest.json (each entry records the source's CORS header).

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { ROOT, RAW_DIR, cachedFetch, politeFetch, limiter, writeJson, writeFileAtomic, exists, todayIso } from "./lib/http.mjs";

const execFileP = promisify(execFile);
const OUT = resolve(ROOT, "src/data/external");
const CACHE = resolve(RAW_DIR, "external");
const PROBE_ORIGIN = "http://localhost:5173"; // Vite dev origin, used only to read the CORS response header

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const want = (k) => !ONLY || ONLY.has(k);

/* ------------------------------- helpers -------------------------------- */

const pad2 = (n) => String(n).padStart(2, "0");
const monthT = (y, m) => Number((y + (m - 0.5) / 12).toFixed(4)); // mid-month decimal year
function dayT(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const len = Date.UTC(y + 1, 0, 1) - start;
  return Number((y + (d.getTime() - start) / len).toFixed(4));
}

/** Minimal RFC-4180 line splitter (handles "a,b" quoted fields). */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** CORS probe: simple GET with an Origin header; browser-fetchable if ACAO is * or echoes the origin. */
async function corsProbe(url) {
  try {
    const r = await politeFetch(url, { headers: { Origin: PROBE_ORIGIN }, retries: 3, timeoutMs: 180_000, log: false });
    const acao = r.headers.get("access-control-allow-origin");
    return { url, status: r.status, accessControlAllowOrigin: acao, browserFetchable: acao === "*" || acao === PROBE_ORIGIN };
  } catch (e) {
    return { url, status: null, accessControlAllowOrigin: null, browserFetchable: false, error: e.message.slice(0, 160) };
  }
}

/** Fetch via the system curl binary (data.giss.nasa.gov resets/403s Node's fetch). Cached gzipped. */
async function curlCached(url, cachePath, { origin } = {}) {
  const metaPath = cachePath.replace(/\.gz$/, "") + ".meta.json";
  if (await exists(cachePath)) {
    return { body: gunzipSync(await readFile(cachePath)), meta: JSON.parse(await readFile(metaPath, "utf8")), fromCache: true };
  }
  const args = ["-sS", "-L", "--fail", "--max-time", "120", "--retry", "4", "--retry-delay", "5", "-D", "-", url];
  if (origin) args.splice(0, 0, "-H", `Origin: ${origin}`);
  const { stdout } = await execFileP("curl", args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  // Split final header block from body.
  const text = stdout.toString("latin1");
  let idx = 0;
  let headerEnd = -1;
  while (true) {
    const e = text.indexOf("\r\n\r\n", idx);
    if (e < 0) break;
    const block = text.slice(idx, e);
    headerEnd = e + 4;
    if (!/^HTTP\/\S+ (30\d|100)/.test(block)) break;
    idx = headerEnd;
  }
  const headerBlock = text.slice(idx, headerEnd);
  const body = stdout.subarray(headerEnd);
  const status = Number(headerBlock.match(/^HTTP\/\S+ (\d+)/)?.[1]);
  const acao = headerBlock.match(/^access-control-allow-origin:\s*(.*)$/im)?.[1]?.trim() ?? null;
  const meta = { url, status, accessControlAllowOrigin: acao, bytes: body.length, retrieved: new Date().toISOString(), via: "curl" };
  await writeFileAtomic(cachePath, gzipSync(body));
  await writeFileAtomic(metaPath, JSON.stringify(meta, null, 2));
  return { body, meta, fromCache: false };
}

function seriesStats(points) {
  const valid = points.filter((p) => p.v != null);
  return { n: points.length, nValid: valid.length, nMissing: points.length - valid.length, start: points[0]?.date, end: points.at(-1)?.date };
}

/* --------------------------------- NSIDC -------------------------------- */

const NSIDC_BASE = "https://noaadata.apps.nsidc.org/NOAA/G02135";

async function buildNsidc() {
  const results = [];
  const cors = await corsProbe(`${NSIDC_BASE}/north/monthly/data/`);
  for (const hemi of [
    { dir: "north", code: "N", regionId: "arctic", name: "Arctic" },
    { dir: "south", code: "S", regionId: "antarctic", name: "Antarctic" },
  ]) {
    const listingUrl = `${NSIDC_BASE}/${hemi.dir}/monthly/data/`;
    const listing = (await politeFetch(listingUrl)).body.toString("utf8");
    const versions = [...listing.matchAll(new RegExp(`${hemi.code}_01_extent_v([\\d.]+)\\.csv`, "g"))].map((m) => m[1]);
    if (!versions.length) throw new Error(`No ${hemi.code}_01_extent_v*.csv in ${listingUrl}`);
    const version = versions.sort((a, b) => Number(b) - Number(a))[0];
    const byMonth = new Map(); // "YYYY-MM" -> {extent, area, source}
    const urls = [];
    let retrieved;
    for (let m = 1; m <= 12; m++) {
      const file = `${hemi.code}_${pad2(m)}_extent_v${version}.csv`;
      const url = `${listingUrl}${file}`;
      urls.push(url);
      const { body, meta } = await cachedFetch(url, resolve(CACHE, "nsidc", `${file}.gz`), {
        validate: (b, s) => s === 200 && /^year,\s*mo/i.test(b.toString("utf8")),
      });
      retrieved = retrieved ?? meta.retrieved;
      const lines = body.toString("utf8").trim().split(/\r?\n/);
      const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
      const ix = (k) => header.indexOf(k);
      for (const line of lines.slice(1)) {
        const c = splitCsvLine(line);
        const y = Number(c[ix("year")]);
        const mo = Number(c[ix("mo")]);
        if (!Number.isFinite(y) || mo !== m) continue;
        const extent = Number(c[ix("extent")]);
        const area = Number(c[ix("area")]);
        byMonth.set(`${y}-${pad2(mo)}`, {
          extent: extent > -9000 ? extent : null,
          area: area > -9000 ? area : null,
          source: c[ix("source_dataset")] === "-9999" ? null : c[ix("source_dataset")],
        });
      }
    }
    const keys = [...byMonth.keys()].sort();
    const [y0, m0] = keys[0].split("-").map(Number);
    const [y1, m1] = keys.at(-1).split("-").map(Number);
    const points = [];
    const sourceCounts = {};
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
      const rec = byMonth.get(`${y}-${pad2(m)}`);
      points.push({ t: monthT(y, m), date: `${y}-${pad2(m)}`, v: rec?.extent ?? null });
      if (rec?.source) sourceCounts[rec.source] = (sourceCounts[rec.source] ?? 0) + 1;
    }
    const missing = points.filter((p) => p.v == null).map((p) => p.date);
    const id = `sea-ice-extent-${hemi.regionId}-monthly`;
    const ts = {
      id,
      variableId: "sea-ice",
      regionId: hemi.regionId,
      label: `${hemi.name} sea-ice extent (monthly)`,
      unit: "million km²",
      resolution: "monthly",
      points,
      provenance: {
        source: `NSIDC Sea Ice Index (G02135) v${version} — satellite passive-microwave sea-ice extent`,
        mode: "snapshot",
        retrieved: retrieved?.slice(0, 10) ?? todayIso(),
        url: `${listingUrl}${hemi.code}_{MM}_extent_v${version}.csv`,
        sampling: `${hemi.name === "Arctic" ? "Northern" : "Southern"} Hemisphere total extent (area of cells with ≥15% ice concentration), monthly mean`,
        notes: [
          "Citation: Sea Ice Index (G02135), Version 4. NSIDC, Boulder, Colorado USA. doi:10.7265/a98x-0f50 (https://nsidc.org/data/G02135/versions/4).",
          `Source datasets reported in the CSVs (months): ${Object.entries(sourceCounts)
            .map(([k, v]) => `${k} ×${v}`)
            .join("; ")}.`,
          missing.length ? `Missing months (−9999 in source) stored as null: ${missing.join(", ")}.` : "No missing months.",
          "Most recent months may come from near-real-time processing and can be revised by NSIDC.",
        ],
      },
    };
    await writeJson(resolve(OUT, `${id}.json`), ts, { pretty: false });
    const st = seriesStats(points);
    console.log(`NSIDC ${hemi.name}: v${version} ${st.start}…${st.end} n=${st.n} missing=${st.nMissing}`);
    results.push({
      file: `${id}.json`,
      id,
      title: ts.label,
      source: ts.provenance.source,
      url: ts.provenance.url,
      urls,
      retrieved: ts.provenance.retrieved,
      unit: ts.unit,
      resolution: "monthly",
      kind: "satellite",
      ...st,
      cors: cors.browserFetchable,
      corsHeader: cors.accessControlAllowOrigin,
      corsProbe: cors,
    });
  }
  return results;
}

/* --------------------------------- MODIS -------------------------------- */

const ORNL = "https://modis.ornl.gov/rst/api/v1";
const PRODUCT = "MOD13Q1";
const NDVI_BAND = "250m_16_days_NDVI";
const REL_BAND = "250m_16_days_pixel_reliability";
const SITES = [
  { key: "rondonia", lat: -10.0, lon: -62.9, name: "Amazon forest frontier, Rondônia (Brazil)" },
  { key: "sahel", lat: 14.5, lon: -1.5, name: "Sahel, Burkina Faso" },
];
const CHUNK = 10; // API maximum dates per subset request
// MOD13Q1 pixel reliability ranks to keep: 0 = Good, 1 = Marginal, 2 = Snow/Ice, 3 = Cloudy.
// Brief: "keep only good-quality pixels" → [0]. Use [0, 1] for a denser (good + marginal) series.
const KEEP_RANKS = [0];
const RANK_NAMES = { 0: "good", 1: "marginal", 2: "snow/ice", 3: "cloudy" };

async function buildModis() {
  const limit = limiter(3);
  const cors = await corsProbe(`${ORNL}/${PRODUCT}/bands`);
  const results = [];
  const siteData = [];
  for (const site of SITES) {
    const datesUrl = `${ORNL}/${PRODUCT}/dates?latitude=${site.lat}&longitude=${site.lon}`;
    const { body } = await cachedFetch(datesUrl, resolve(CACHE, "modis", `${PRODUCT}_${site.key}_dates.json.gz`), {
      headers: { Accept: "application/json" },
      timeoutMs: 240_000,
      baseDelayMs: 5000,
      validate: (b, s) => s === 200 && Array.isArray(JSON.parse(b.toString("utf8")).dates),
    });
    const dates = JSON.parse(body.toString("utf8")).dates;
    siteData.push({ site, dates, datesUrl });
  }
  // Fetch all chunks for both bands at both sites, ≤3 concurrent.
  let done = 0;
  const jobs = [];
  for (const sd of siteData) {
    for (let i = 0; i < sd.dates.length; i += CHUNK) {
      const chunk = sd.dates.slice(i, i + CHUNK);
      for (const band of [NDVI_BAND, REL_BAND]) jobs.push({ sd, chunk, band });
    }
  }
  console.log(`MODIS: ${jobs.length} subset requests (${siteData.map((s) => `${s.site.key} ${s.dates.length} dates`).join(", ")})`);
  const t0 = Date.now();
  const failures = [];
  const data = new Map(); // `${site}|${band}|${modis_date}` -> {value, calendar_date, proc_date, tile}
  await Promise.all(
    jobs.map(({ sd, chunk, band }) =>
      limit(async () => {
        const a = chunk[0].modis_date;
        const b = chunk.at(-1).modis_date;
        const url = `${ORNL}/${PRODUCT}/subset?latitude=${sd.site.lat}&longitude=${sd.site.lon}&band=${band}&startDate=${a}&endDate=${b}&kmAboveBelow=0&kmLeftRight=0`;
        try {
          const r = await cachedFetch(url, resolve(CACHE, "modis", `${PRODUCT}_${sd.site.key}_${band}_${a}_${b}.json.gz`), {
            headers: { Accept: "application/json" },
            timeoutMs: 300_000,
            retries: 7,
            baseDelayMs: 5000,
            validate: (body, s) => {
              if (s !== 200) return false;
              try {
                const j = JSON.parse(body.toString("utf8"));
                return Array.isArray(j.subset) && j.subset.length === chunk.length;
              } catch {
                return false;
              }
            },
          });
          const j = JSON.parse(r.body.toString("utf8"));
          for (const s of j.subset) {
            data.set(`${sd.site.key}|${band}|${s.modis_date}`, { value: s.data[0], calendar_date: s.calendar_date, proc_date: s.proc_date, tile: s.tile });
          }
          if (!r.fromCache && j.xllcorner) sd.cell = { xllcorner: j.xllcorner, yllcorner: j.yllcorner, cellsize: j.cellsize };
        } catch (e) {
          failures.push({ site: sd.site.key, band, a, b, error: e.message.slice(0, 200) });
        }
        done++;
        if (done % 10 === 0 || done === jobs.length)
          console.log(`  MODIS ${done}/${jobs.length} (failed ${failures.length}) ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      }),
    ),
  );
  if (failures.length) {
    console.warn(`MODIS: ${failures.length} chunk(s) failed — re-run to resume. First: ${JSON.stringify(failures[0])}`);
    return { results, failures };
  }

  for (const { site, dates, datesUrl } of siteData) {
    const relCounts = { 0: 0, 1: 0, 2: 0, 3: 0, fill: 0 };
    const sixteen = [];
    const tiles = new Set();
    for (const d of dates) {
      const nd = data.get(`${site.key}|${NDVI_BAND}|${d.modis_date}`);
      const rl = data.get(`${site.key}|${REL_BAND}|${d.modis_date}`);
      tiles.add(nd.tile);
      const rel = rl.value;
      if (rel >= 0 && rel <= 3) relCounts[rel]++;
      else relCounts.fill++;
      const raw = nd.value;
      const validRange = raw !== -3000 && raw >= -2000 && raw <= 10000;
      const good = validRange && KEEP_RANKS.includes(rel);
      sixteen.push({ date: d.calendar_date, raw, rel, v: good ? Number((raw * 0.0001).toFixed(4)) : null });
    }
    // 16-day series
    const pts16 = sixteen.map((s) => ({ t: dayT(s.date), date: s.date, v: s.v }));
    // Monthly mean of good composites, assigned by composite centre (start + 8 days).
    const monthly = new Map();
    for (const s of sixteen) {
      const c = new Date(s.date + "T00:00:00Z");
      c.setUTCDate(c.getUTCDate() + 8);
      const key = `${c.getUTCFullYear()}-${pad2(c.getUTCMonth() + 1)}`;
      if (!monthly.has(key)) monthly.set(key, []);
      if (s.v != null) monthly.get(key).push(s.v);
    }
    const mkeys = [...monthly.keys()].sort();
    const [y0, m0] = mkeys[0].split("-").map(Number);
    const [y1, m1] = mkeys.at(-1).split("-").map(Number);
    const ptsM = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y++, (m = 1)) : m++) {
      const vals = monthly.get(`${y}-${pad2(m)}`) ?? [];
      ptsM.push({ t: monthT(y, m), date: `${y}-${pad2(m)}`, v: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null });
    }
    const subsetPattern = `${ORNL}/${PRODUCT}/subset?latitude=${site.lat}&longitude=${site.lon}&band={${NDVI_BAND}|${REL_BAND}}&startDate=AYYYYDDD&endDate=AYYYYDDD&kmAboveBelow=0&kmLeftRight=0`;
    const commonNotes = [
      `Single 250 m MODIS sinusoidal pixel containing (${site.lat}, ${site.lon}); tile ${[...tiles].join(", ")}.`,
      `Quality filter: kept only composites with ${REL_BAND} in {${KEEP_RANKS.join(", ")}} (${KEEP_RANKS.map((r) => RANK_NAMES[r]).join(" + ")}); all other ranks (${[0, 1, 2, 3]
        .filter((r) => !KEEP_RANKS.includes(r))
        .map((r) => `${r} ${RANK_NAMES[r]}`)
        .join(", ")}) and fill were set to null. Counts over ${dates.length} composites: good ${relCounts[0]}, marginal ${relCounts[1]}, snow/ice ${relCounts[2]}, cloudy ${relCounts[3]}, fill ${relCounts.fill}.`,
      `NDVI = ${NDVI_BAND} × 0.0001 (valid raw range −2000…10000, fill −3000).`,
      "Product: MOD13Q1 Collection 6.1 (Terra MODIS Vegetation Indices 16-Day L3 Global 250 m), Didan, K. (2021), doi:10.5067/MODIS/MOD13Q1.061. Subset via ORNL DAAC MODIS/VIIRS Land Product Subsets REST API.",
    ];
    const retrieved = todayIso();
    const base = {
      variableId: "ndvi",
      regionId: site.key,
      unit: "NDVI (unitless)",
    };
    const ts16 = {
      id: `ndvi-${site.key}-16day`,
      ...base,
      label: `NDVI, ${site.name} — MODIS Terra 16-day`,
      resolution: "daily",
      points: pts16,
      provenance: {
        source: "NASA MODIS Terra MOD13Q1 v061 NDVI via ORNL DAAC MODIS Land Product Subsets API",
        mode: "snapshot",
        retrieved,
        url: subsetPattern,
        sampling: `16-day composites; date = composite start date (MODIS calendar_date)`,
        cellsUsed: 1,
        cellsTotal: 1,
        notes: commonNotes,
      },
    };
    const tsM = {
      id: `ndvi-${site.key}-monthly`,
      ...base,
      label: `NDVI, ${site.name} — MODIS Terra monthly mean`,
      resolution: "monthly",
      points: ptsM,
      provenance: {
        source: ts16.provenance.source,
        mode: "snapshot",
        retrieved,
        url: subsetPattern,
        sampling: "Monthly mean of good-quality 16-day composites, each assigned to the month containing its centre (start + 8 days); null when no good composite",
        cellsUsed: 1,
        cellsTotal: 1,
        notes: commonNotes,
      },
    };
    for (const ts of [ts16, tsM]) {
      await writeJson(resolve(OUT, `${ts.id}.json`), ts, { pretty: false });
      const st = seriesStats(ts.points);
      const vals = ts.points.filter((p) => p.v != null).map((p) => p.v);
      console.log(
        `MODIS ${ts.id}: ${st.start}…${st.end} n=${st.n} valid=${st.nValid} NDVI range ${Math.min(...vals).toFixed(3)}…${Math.max(...vals).toFixed(3)} mean ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)}`,
      );
      results.push({
        file: `${ts.id}.json`,
        id: ts.id,
        title: ts.label,
        source: ts.provenance.source,
        url: ts.provenance.url,
        datesUrl,
        retrieved,
        unit: ts.unit,
        resolution: ts.resolution,
        kind: "satellite",
        ...st,
        qa: { band: REL_BAND, keptRanks: KEEP_RANKS, counts: relCounts },
        cors: cors.browserFetchable,
        corsHeader: cors.accessControlAllowOrigin,
        corsProbe: cors,
      });
    }
  }
  return { results, failures };
}

/* -------------------------------- GISTEMP ------------------------------- */

const GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv";

async function buildGistemp() {
  const { body, meta } = await curlCached(GISTEMP_URL, resolve(CACHE, "gistemp", "GLB.Ts+dSST.csv.gz"), { origin: PROBE_ORIGIN });
  const text = body.toString("utf8");
  if (!/Year,Jan,Feb/.test(text)) throw new Error("Unexpected GISTEMP CSV format");
  const lines = text.trim().split(/\r?\n/);
  const hi = lines.findIndex((l) => l.startsWith("Year,"));
  const pts = [];
  for (const line of lines.slice(hi + 1)) {
    const c = line.split(",");
    const y = Number(c[0]);
    if (!Number.isFinite(y)) continue;
    for (let m = 1; m <= 12; m++) {
      const raw = c[m]?.trim();
      const v = raw && raw !== "***" ? Number(raw) : null;
      pts.push({ t: monthT(y, m), date: `${y}-${pad2(m)}`, v: Number.isFinite(v) ? v : null });
    }
  }
  // Drop trailing not-yet-published months of the current year (*** after the last value).
  while (pts.length && pts.at(-1).v == null) pts.pop();
  const ts = {
    id: "gistemp-global-monthly",
    variableId: "t2m",
    regionId: "global",
    label: "Global land–ocean temperature anomaly (GISTEMP v4)",
    unit: "°C anomaly vs 1951–1980",
    resolution: "monthly",
    points: pts,
    provenance: {
      source: "NASA GISS Surface Temperature Analysis (GISTEMP v4), Land-Ocean Temperature Index",
      mode: "snapshot",
      retrieved: meta.retrieved.slice(0, 10),
      url: GISTEMP_URL,
      sampling: "Global mean of land surface air temperature (GHCN v4 stations) + sea surface temperature (ERSST v5, ships/buoys)",
      notes: [
        "In-situ based (weather stations, ships and buoys) — NOT a satellite product.",
        "Anomalies relative to the 1951–1980 base period. GISTEMP Team (2026), NASA GISS; Lenssen et al. (2024).",
        "Recent months are preliminary and may be revised.",
        `Raw CSV retrieved ${meta.retrieved}${meta.lastModified ? ` (server Last-Modified: ${meta.lastModified})` : ""}${meta.via ? `; ${meta.via}` : ""}`,
      ],
    },
  };
  await writeJson(resolve(OUT, `${ts.id}.json`), ts, { pretty: false });
  const st = seriesStats(pts);
  console.log(`GISTEMP: ${st.start}…${st.end} n=${st.n} missing=${st.nMissing}`);
  return [
    {
      file: `${ts.id}.json`,
      id: ts.id,
      title: ts.label,
      source: ts.provenance.source,
      url: GISTEMP_URL,
      retrieved: ts.provenance.retrieved,
      unit: ts.unit,
      resolution: "monthly",
      kind: "in-situ",
      ...st,
      cors: meta.accessControlAllowOrigin === "*" || meta.accessControlAllowOrigin === PROBE_ORIGIN,
      corsHeader: meta.accessControlAllowOrigin,
      corsNote:
        "No Access-Control-Allow-Origin header; additionally data.giss.nasa.gov rejected Node's fetch (connection reset with default UA, HTTP 403 with a custom UA) — fetched with curl.",
    },
  ];
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const manifestPath = resolve(OUT, "manifest.json");
  const collected = [];
  const replace = (entries) => collected.push(...entries);
  const problems = [];
  if (want("nsidc")) replace(await buildNsidc());
  if (want("gistemp")) {
    try {
      replace(await buildGistemp());
    } catch (e) {
      problems.push(`gistemp: ${e.message}`);
      console.error("GISTEMP failed:", e.message);
    }
  }
  if (want("modis")) {
    const { results, failures } = await buildModis();
    replace(results);
    if (failures.length) problems.push(`modis: ${failures.length} chunks failed`);
  }
  // Read-merge-write at the end so concurrent/partial runs (--only=...) keep each other's entries.
  let manifest = { title: "EARTHSCOPE external (non-reanalysis) time-series snapshots", files: [] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {}
  const ids = new Set(collected.map((e) => e.id));
  manifest.files = [...manifest.files.filter((f) => !ids.has(f.id)), ...collected];
  manifest.updated = new Date().toISOString();
  manifest.corsProbeOrigin = PROBE_ORIGIN;
  manifest.files.sort((a, b) => a.id.localeCompare(b.id));
  await writeJson(manifestPath, manifest);
  console.log(`Wrote ${manifestPath} (${manifest.files.length} files)`);
  if (problems.length) {
    console.error("Problems:\n- " + problems.join("\n- "));
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
