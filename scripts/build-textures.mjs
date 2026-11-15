// EARTHSCOPE — globe textures from NASA GIBS (WMS GetMap, EPSG:4326 equirectangular).
//
//   node scripts/build-textures.mjs
//
// Writes public/textures/earth-{day,night}-{4k,2k}.jpg and public/textures/README.md.
// Every image is verified to be a real baseline/progressive JPEG with the expected
// dimensions (parsed from the SOF marker) — GIBS returns XML ServiceExceptions on error.

import { resolve } from "node:path";
import { ROOT, RAW_DIR, cachedFetch, writeFileAtomic, todayIso } from "./lib/http.mjs";

const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const OUT = resolve(ROOT, "public/textures");

const LAYERS = [
  {
    key: "day",
    layer: "BlueMarble_NextGeneration",
    time: null, // static layer (no time dimension)
    attribution:
      "NASA Earth Observatory — Blue Marble: Next Generation (MODIS-based monthly composites, Reto Stöckli et al.), served by NASA GIBS",
  },
  {
    key: "night",
    layer: "VIIRS_Black_Marble",
    time: "2016-01-01", // GIBS offers 2012-01-01 and 2016-01-01 (default); pin the most recent explicitly
    attribution: "NASA Black Marble 2016 — Suomi NPP VIIRS Day/Night Band night lights composite (NASA Earth Observatory / GSFC), served by NASA GIBS",
  },
];

const SIZES = [
  { tag: "4k", width: 4096, height: 2048, fallbacks: [[3600, 1800], [3072, 1536], [2880, 1440]] },
  { tag: "2k", width: 2048, height: 1024, fallbacks: [] },
];

function getMapUrl(layer, width, height, time) {
  const q = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layer,
    STYLES: "",
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: "image/jpeg",
  });
  if (time) q.set("TIME", time);
  return `${WMS}?${q.toString()}`;
}

/** Parse JPEG SOFn marker → { width, height, progressive } or null when not a JPEG. */
export function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), progressive: marker === 0xc2, components: buf[i + 9] };
    }
    i += 2 + len;
  }
  return null;
}

async function fetchTexture(layer, time, width, height) {
  const url = getMapUrl(layer, width, height, time);
  const cache = resolve(RAW_DIR, "textures", `${layer}_${time ?? "static"}_${width}x${height}.jpg.gz`);
  const { body, meta, fromCache } = await cachedFetch(url, cache, {
    timeoutMs: 300_000,
    validate: (b, status) => {
      const info = status === 200 ? jpegInfo(b) : null;
      return !!info && info.width === width && info.height === height;
    },
  });
  return { url, body, meta, fromCache, info: jpegInfo(body) };
}

async function main() {
  const retrieved = todayIso();
  const produced = [];
  for (const L of LAYERS) {
    for (const S of SIZES) {
      const tries = [[S.width, S.height], ...S.fallbacks];
      let ok = null;
      const rejected = [];
      for (const [w, h] of tries) {
        try {
          ok = await fetchTexture(L.layer, L.time, w, h);
          break;
        } catch (e) {
          rejected.push({ width: w, height: h, error: e.message.slice(0, 200) });
          console.warn(`  ${L.layer} ${w}x${h} rejected: ${e.message.slice(0, 160)}`);
        }
      }
      if (!ok) throw new Error(`No size worked for ${L.layer} (${S.tag})`);
      // Minimum plausible size: a blank/transparent fallback would compress to a few KB.
      const minBytes = (ok.info.width * ok.info.height) / 40;
      if (ok.body.length < minBytes) throw new Error(`${L.layer} ${S.tag}: suspiciously small JPEG (${ok.body.length} B)`);
      const file = `earth-${L.key}-${S.tag}.jpg`;
      await writeFileAtomic(resolve(OUT, file), ok.body);
      console.log(
        `${file}: ${ok.info.width}x${ok.info.height} ${ok.info.progressive ? "progressive" : "baseline"} JPEG, ${(ok.body.length / 1024).toFixed(0)} KiB${ok.fromCache ? " (cache)" : ""}`,
      );
      produced.push({
        file,
        layer: L.layer,
        time: L.time,
        width: ok.info.width,
        height: ok.info.height,
        bytes: ok.body.length,
        url: ok.url,
        retrieved: ok.meta?.retrieved?.slice(0, 10) ?? retrieved,
        attribution: L.attribution,
        rejected,
      });
    }
  }
  await writeFileAtomic(resolve(OUT, "README.md"), readme(produced));
  console.log("Wrote public/textures/README.md");
}

function readme(items) {
  const rows = items
    .map(
      (it) =>
        `| \`${it.file}\` | \`${it.layer}\`${it.time ? ` (TIME=${it.time})` : ""} | ${it.width} × ${it.height} | ${(it.bytes / 1024).toFixed(0)} KiB | ${it.retrieved} |`,
    )
    .join("\n");
  const urls = items.map((it) => `- \`${it.file}\`:\n  <${it.url}>`).join("\n");
  const fallbacks = items.filter((it) => it.rejected.length);
  return `# Globe textures

Equirectangular (plate carrée, EPSG:4326, −180…180° lon × −90…90° lat) images
retrieved from **NASA GIBS** (Global Imagery Browse Services) with WMS 1.3.0
\`GetMap\` requests, generated by \`scripts/build-textures.mjs\`. The top-left
pixel is (90° N, 180° W). Each file was verified to be a real JPEG of the
expected size by parsing its SOF marker.

| File | GIBS layer | Size (px) | Bytes | Retrieved |
| --- | --- | --- | --- | --- |
${rows}

## Attribution

- **Day — Blue Marble: Next Generation.** NASA Earth Observatory, Reto Stöckli
  (NASA GSFC). Cloud-free true-colour MODIS composite. Imagery courtesy of NASA
  Earth Observatory, served by NASA GIBS / EOSDIS.
- **Night — Black Marble 2016.** NASA Earth Observatory / NASA GSFC, Suomi NPP
  VIIRS Day/Night Band (Miguel Román et al.). Served by NASA GIBS / EOSDIS.

We acknowledge the use of imagery provided by services from NASA's Global
Imagery Browse Services (GIBS), part of NASA's Earth Science Data and
Information System (ESDIS). GIBS API documentation:
<https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api>

NASA imagery is generally not subject to copyright in the United States
(see <https://www.nasa.gov/nasa-brand-center/images-and-media/>).

## Exact request URLs

${urls}
${
  fallbacks.length
    ? `\n## Size fallbacks\n\n${fallbacks.map((f) => `- ${f.file}: rejected ${f.rejected.map((r) => `${r.width}×${r.height}`).join(", ")}`).join("\n")}\n`
    : "\nAll sizes were accepted at the first attempt (GIBS WMS advertises MaxWidth/MaxHeight = 20000).\n"
}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
