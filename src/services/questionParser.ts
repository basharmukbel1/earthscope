import type { Region } from "@/types/domain";
import { VARIABLES } from "@/data/catalog";
import { NAMED_REGIONS } from "@/data/regions";
import { loadCountries, countryToRegion } from "./geo";

/* ==========================================================================
   Lightweight natural-language question parser (no LLM, no network):
   maps words in a research question to catalog variables (keyword scoring)
   and to regions (country names, gazetteer names, and region-type hints
   such as "desert", "rainforest", "city", "estuary").
   ========================================================================== */

export interface ParsedQuestion {
  variables: { id: string; score: number; matched: string }[];
  regions: Region[];
  direction: "increasing" | "decreasing" | null;
  regionTypeHints: { hint: string; suggestions: Region[] }[];
}

const TYPE_HINTS: { words: string[]; hint: string; ids: string[] }[] = [
  { words: ["desert", "arid", "dry land"], hint: "Deserts", ids: ["sahara-central", "levant", "sahel-west"] },
  { words: ["rainforest", "rain forest", "tropical forest", "jungle"], hint: "Rainforests", ids: ["amazon-central", "congo-basin", "borneo"] },
  { words: ["city", "cities", "urban", "megacity"], hint: "Air above large cities", ids: ["delhi", "beijing"] },
  { words: ["estuary", "delta", "tidal"], hint: "Tidal estuaries & deltas", ids: ["chesapeake", "sundarbans", "nile-delta"] },
  { words: ["arctic", "polar", "north pole"], hint: "Arctic", ids: ["arctic-svalbard", "greenland-west"] },
  { words: ["antarctic", "south pole"], hint: "Antarctic", ids: ["antarctic-peninsula"] },
  { words: ["reef", "coral"], hint: "Coral reefs", ids: ["great-barrier-reef"] },
  { words: ["el nino", "el niño", "pacific"], hint: "Equatorial Pacific", ids: ["nino34"] },
  { words: ["farm", "agricultur", "crop", "irrigat"], hint: "Agricultural regions", ids: ["us-great-plains", "indo-gangetic", "california-central-valley", "murray-darling"] },
  { words: ["lake", "inland sea"], hint: "Shrinking lakes", ids: ["lake-chad", "aral-sea"] },
  { words: ["mountain", "plateau", "glacier", "himalaya"], hint: "High mountains", ids: ["tibetan-plateau"] },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function parseQuestion(text: string): Promise<ParsedQuestion> {
  const q = ` ${norm(text)} `;
  const variables: ParsedQuestion["variables"] = [];
  for (const v of VARIABLES) {
    let best = 0;
    let matched = "";
    for (const k of v.keywords) {
      const kk = ` ${norm(k)}`;
      if (q.includes(kk)) {
        const s = kk.length; // longer keyword = more specific
        if (s > best) {
          best = s;
          matched = k;
        }
      }
    }
    if (best > 0) variables.push({ id: v.id, score: best + (v.connector.kind === "power" ? 2 : 0), matched });
  }
  variables.sort((a, b) => b.score - a.score);

  const regions: Region[] = [];
  const countries = await loadCountries();
  for (const c of countries) {
    const n = norm(c.properties.name);
    if (n.length > 2 && q.includes(` ${n} `)) regions.push(countryToRegion(c));
  }
  const aliases: Record<string, string> = { usa: "United States of America", "united states": "United States of America", uk: "United Kingdom", uae: "United Arab Emirates" };
  for (const [a, name] of Object.entries(aliases)) {
    if (q.includes(` ${a} `)) {
      const c = countries.find((x) => x.properties.name === name);
      if (c && !regions.some((r) => r.countryId === c.id)) regions.push(countryToRegion(c));
    }
  }
  for (const r of NAMED_REGIONS) {
    const parts = norm(r.name).split(" · ");
    if (parts.some((p) => p.length > 3 && q.includes(` ${p}`))) regions.push(r);
    else if (norm(r.name).split(" ").some((w) => w.length > 5 && q.includes(` ${w} `) && !["region", "basin", "central", "western", "eastern"].includes(w)))
      regions.push(r);
  }

  const regionTypeHints = TYPE_HINTS.filter((h) => h.words.some((w) => q.includes(w))).map((h) => ({
    hint: h.hint,
    suggestions: h.ids.map((id) => NAMED_REGIONS.find((r) => r.id === id)!).filter(Boolean),
  }));

  const direction = /(decreas|declin|drop|fall|less|shrink|dry|drying|loss|lower|thinn|cool)/.test(q)
    ? "decreasing"
    : /(increas|rise|rising|grow|more|warm|higher|gain|thicken|green)/.test(q)
      ? "increasing"
      : null;

  return { variables: variables.slice(0, 4), regions: dedupe(regions).slice(0, 4), direction, regionTypeHints };
}

function dedupe(rs: Region[]): Region[] {
  const seen = new Set<string>();
  return rs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
