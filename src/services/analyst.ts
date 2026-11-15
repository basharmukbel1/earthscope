import type { AnalysisResult, Region, TimeSeries, Variable } from "@/types/domain";
import { getVariable, VARIABLES } from "@/data/catalog";
import { GLOSSARY } from "@/data/glossary";
import { annualUnit, fmt, fmtP, fmtSigned } from "@/utils/format";
import { compareMethods } from "@/stats";

/* ==========================================================================
   EARTHSCOPE Analyst — deterministic, rule-based scientific interpreter.
   It ONLY states numbers that come from computed AnalysisResults, keeps
   measured EVIDENCE separate from untested HYPOTHESES, and never claims a
   hypothesis is proven. An optional LLM endpoint (VITE_AI_ENDPOINT) can
   replace the narrative while receiving the same computed context.
   ========================================================================== */

export interface EvidenceItem {
  label: string;
  value: string;
  detail?: string;
}

export type AnalystBlock =
  | { type: "text"; text: string }
  | { type: "evidence"; title: string; items: EvidenceItem[]; source?: string }
  | { type: "hypothesis"; title: string; text: string; tests: string[] }
  | { type: "suggestion"; title: string; items: { variableId: string; reason: string }[] }
  | { type: "glossary"; termId: string }
  | { type: "caution"; text: string }
  /** One-click follow-up the page can run (e.g. add a variable the question asked about). */
  | { type: "action"; text: string; label: string; variableId: string };

export interface AnalystResponse {
  engine: "local" | "remote";
  blocks: AnalystBlock[];
  sources: string[];
  /** "out-of-case": asks about a variable this case doesn't contain; "out-of-scope": not about the results at all. */
  kind?: "answer" | "out-of-case" | "out-of-scope";
}

export interface AnalystContext {
  question?: string;
  entries: { series: TimeSeries; result: AnalysisResult; variable: Variable; region: Region | undefined }[];
}

/* -------------------- physical knowledge base (hypotheses) ---------------- */
type Dir = "increasing" | "decreasing";
const MECHANISMS: Record<string, Partial<Record<Dir, { text: string; tests: string[] }[]>>> = {
  t2m: {
    increasing: [
      { text: "Greenhouse-gas–driven warming, possibly amplified locally by land-use change or loss of snow/ice (albedo feedback).", tests: ["Compare with neighbouring regions and the global mean.", "Check snow depth or sea-ice for a matching decline.", "Look at which seasons warm fastest (seasonal cycle chart)."] },
      { text: "Urbanisation or drying soils that reduce evaporative cooling.", tests: ["Test surface soil moisture for a decrease.", "Compare land surface temperature (MODIS) with air temperature."] },
    ],
    decreasing: [
      { text: "Increased aerosol haze or cloudiness reducing sunlight at the surface, or expanded irrigation cooling the air.", tests: ["Test aerosol optical depth for an increase.", "Check evapotranspiration and soil moisture."] },
    ],
  },
  precip: {
    decreasing: [
      { text: "A poleward shift or weakening of the storm track / monsoon that normally brings the rain.", tests: ["Compare with regions to the north and south (Regional Comparison).", "Check whether the decline is concentrated in the wet season."] },
      { text: "Natural multi-decadal variability (e.g. ocean-driven cycles) rather than a long-term change.", tests: ["Extend the record or test sub-periods.", "Check the 'years needed to detect' estimate."] },
    ],
    increasing: [
      { text: "A warmer atmosphere holding more water vapor (~7% per °C), intensifying rainfall.", tests: ["Test atmospheric water vapor for an increase.", "Relate precipitation to temperature in the Relationship Lab."] },
      { text: "A shift of the monsoon or storm track toward this region.", tests: ["Compare with neighbouring regions for an opposite trend."] },
    ],
  },
  "soil-surface": {
    decreasing: [
      { text: "Less rainfall and/or more evaporation from a warmer surface.", tests: ["Test precipitation and air temperature over the same years.", "Check the Relationship Lab for a precipitation → soil-moisture lag."] },
    ],
    increasing: [{ text: "More rainfall or irrigation expansion.", tests: ["Test precipitation.", "Check NDVI for greening over irrigated land."] }],
  },
  "soil-root": {
    decreasing: [
      { text: "Multi-year rainfall deficits or rising plant water demand drawing down the root zone.", tests: ["Test precipitation and evapotranspiration.", "Examine NDVI for vegetation stress."] },
      { text: "Land-cover change (e.g. deforestation) altering infiltration and evapotranspiration.", tests: ["Load the bundled MODIS NDVI record for Rondônia.", "Compare with an intact-forest region."] },
    ],
    increasing: [{ text: "Wetter conditions or reduced evapotranspiration.", tests: ["Test precipitation and evapotranspiration."] }],
  },
  aod: {
    increasing: [
      { text: "Growing emissions from industry, traffic, crop-residue burning or more dust.", tests: ["Check the seasonal cycle for burning-season peaks.", "Compare with a nearby less-populated region."] },
    ],
    decreasing: [{ text: "Air-quality regulations reducing emissions, or fewer dust events.", tests: ["Compare the record before and after known policy changes.", "Relate AOD to surface soil moisture (dust sources)."] }],
  },
  ozone: {
    increasing: [{ text: "Recovery of stratospheric ozone after the Montreal Protocol phased out CFCs.", tests: ["Test only the spring months (Seasonal Kendall / seasonal chart).", "Check sensitivity to the 2004 observing-system change by starting in 2005."] }],
    decreasing: [{ text: "Ozone depletion by halogens, or dynamical changes in stratospheric transport.", tests: ["Test spring months separately.", "Start the record in 2005 to avoid the SBUV→OMI transition."] }],
  },
  "water-vapor": {
    increasing: [{ text: "Warming air holding more moisture (Clausius–Clapeyron).", tests: ["Relate water vapor to air temperature in the Relationship Lab."] }],
    decreasing: [{ text: "Drier air advected into the region or reduced evaporation upstream.", tests: ["Test precipitation and soil moisture."] }],
  },
  evap: {
    increasing: [{ text: "Higher temperature and radiation increasing evaporative demand, if water is available.", tests: ["Test air temperature and soil moisture."] }],
    decreasing: [{ text: "Soils drying out so less water is available to evaporate.", tests: ["Test root-zone soil moisture."] }],
  },
  sst: {
    increasing: [{ text: "Ocean uptake of heat from greenhouse warming, or changes in ocean currents.", tests: ["Compare with a neighbouring ocean region.", "Relate to air temperature over the same box."] }],
    decreasing: [{ text: "Changes in upwelling or ocean circulation (e.g. the North Atlantic 'cold blob').", tests: ["Compare with regions upstream in the current."] }],
  },
  snow: {
    decreasing: [{ text: "Warmer winters turning snow into rain and melting snowpack earlier.", tests: ["Test winter air temperature.", "Check the seasonal cycle shift between decades."] }],
    increasing: [{ text: "More winter precipitation falling as snow.", tests: ["Test precipitation."] }],
  },
  "sea-ice": {
    decreasing: [{ text: "Arctic warming (air and ocean) and the ice-albedo feedback.", tests: ["Test September only (end-of-melt season) with the seasonal chart.", "Relate to Svalbard air temperature."] }],
    increasing: [{ text: "Wind-driven ice expansion or regional cooling.", tests: ["Compare seasons separately."] }],
  },
  ndvi: {
    decreasing: [{ text: "Vegetation loss from deforestation, drought or degradation.", tests: ["Test root-zone soil moisture and precipitation.", "Look for abrupt drops (non-linear change) in the time series."] }],
    increasing: [{ text: "Greening from cropland expansion, irrigation, recovering vegetation or CO₂ fertilisation.", tests: ["Test precipitation and soil moisture for a wetting trend."] }],
  },
};

const RELATED: Record<string, string[]> = {
  t2m: ["soil-surface", "water-vapor", "snow", "precip"],
  precip: ["soil-root", "soil-surface", "evap", "t2m"],
  "soil-surface": ["precip", "t2m", "evap"],
  "soil-root": ["precip", "evap", "t2m", "ndvi"],
  aod: ["soil-surface", "precip", "t2m"],
  ozone: ["t2m"],
  "water-vapor": ["t2m", "precip"],
  evap: ["soil-root", "t2m", "precip"],
  sst: ["t2m", "water-vapor"],
  snow: ["t2m", "precip"],
  "sea-ice": ["t2m", "sst"],
  ndvi: ["precip", "soil-root", "t2m"],
};

const RELATED_REASON: Record<string, string> = {
  t2m: "Temperature drives evaporation, snowmelt and moisture capacity.",
  precip: "Rainfall is the main water input to soils and vegetation.",
  "soil-surface": "Surface soil moisture responds quickly to rain and heat.",
  "soil-root": "Root-zone moisture integrates months of rainfall and evaporation.",
  evap: "Evapotranspiration links soil water, vegetation and heat.",
  "water-vapor": "Water vapor tracks the moisture-holding capacity of warmer air.",
  snow: "Snow responds to winter temperature and precipitation.",
  sst: "Ocean temperature shapes regional climate and humidity.",
  ndvi: "Vegetation greenness integrates water and heat stress.",
};

/* ------------------------------ helpers ---------------------------------- */

function unitPerDecade(v: Variable, r?: AnalysisResult): string {
  const u = (r as (AnalysisResult & { annualUnit?: string }) | undefined)?.annualUnit ?? annualUnit(v.unit, v.annualAgg, v.annualSumFactor);
  return `${u} per decade`;
}

export function describeResult(r: AnalysisResult, v: Variable, regionName: string): string {
  const s = r.summary;
  const dirWord = s.direction === "increasing" ? "increased" : s.direction === "decreasing" ? "decreased" : "shown no change";
  const mag = `${fmt(Math.abs(s.perDecade), v.decimals)} ${unitPerDecade(v, r)}`;
  const pctVal = v.intervalScale ? null : s.pctPerDecade;
  const pct = pctVal !== null ? ` (${fmt(Math.abs(pctVal), 1)}% of the long-term mean per decade)` : "";
  const ci = `95% CI ${fmtSigned(s.perDecadeCi[0], v.decimals)} to ${fmtSigned(s.perDecadeCi[1], v.decimals)}`;
  const sig = s.significant
    ? `This trend is statistically significant (p ${fmtP(s.p).startsWith("<") ? fmtP(s.p) : "= " + fmtP(s.p)}, α = ${s.alpha}).`
    : `This trend is NOT statistically significant (p = ${fmtP(s.p)}, α = ${s.alpha}) — the data are compatible with no trend.`;
  return `Between ${r.startYear} and ${r.endYear}, ${v.name.toLowerCase()} over ${regionName} has ${dirWord} by ${mag}${pct}; ${ci}. ${sig}`;
}

export function evidenceFor(r: AnalysisResult, v: Variable): EvidenceItem[] {
  return [
    { label: "Trend (primary)", value: `${fmtSigned(r.summary.perDecade, v.decimals)} ${unitPerDecade(v, r)}`, detail: r.summary.method },
    { label: "95% confidence interval", value: `${fmtSigned(r.summary.perDecadeCi[0], v.decimals)} … ${fmtSigned(r.summary.perDecadeCi[1], v.decimals)}` },
    { label: "p-value", value: fmtP(r.summary.p), detail: r.summary.significant ? `significant at α = ${r.summary.alpha}` : `not significant at α = ${r.summary.alpha}` },
    { label: "Mann-Kendall τ", value: fmt(r.mk.tau, 3), detail: `S = ${r.mk.s}, n = ${r.mk.n} years` },
    (() => {
      const row = compareMethods(r).find((x) => x.id === "ols-ar1");
      return { label: "OLS on anomalies (AR1-adjusted)", value: row ? `${fmtSigned(row.slopePerDecade, v.decimals)} / decade` : "—", detail: `p = ${fmtP(r.ols.p)}, R² = ${fmt(r.ols.r2, 3)}${r.ols.nEff ? `, effective n ≈ ${Math.round(r.ols.nEff)}` : ""}` };
    })(),
    { label: "Record", value: `${r.startYear}–${r.endYear}`, detail: `${r.nMonths} months, ${fmt(r.missingPct, 1)}% missing` },
  ];
}

export function hypothesesFor(r: AnalysisResult, v: Variable): { text: string; tests: string[] }[] {
  const dir = r.summary.direction === "no-trend" ? null : r.summary.direction;
  if (!dir) return [];
  return MECHANISMS[v.id]?.[dir] ?? [];
}

export function nextVariables(v: Variable, exclude: string[] = []): { variableId: string; reason: string }[] {
  return (RELATED[v.id] ?? [])
    .filter((id) => !exclude.includes(id) && getVariable(id))
    .slice(0, 3)
    .map((id) => ({ variableId: id, reason: RELATED_REASON[id] ?? "Physically linked variable." }));
}

/** Structured interpretation for a single result (used by Workspace & Reports). */
export function interpret(r: AnalysisResult, v: Variable, region: Region | undefined): AnalystBlock[] {
  const regionName = region?.name ?? "the selected region";
  const blocks: AnalystBlock[] = [{ type: "text", text: describeResult(r, v, regionName) }];
  if (!r.summary.significant && r.summary.yearsToDetect && Number.isFinite(r.summary.yearsToDetect)) {
    const ytd = r.summary.yearsToDetect;
    const len = r.endYear - r.startYear + 1;
    blocks.push({
      type: "caution",
      text:
        ytd > len
          ? `A trend of this size would need roughly ${Math.round(ytd)} years of data to be detectable (Weatherhead et al. 1998); this record has ${len}. A longer record could change the conclusion.`
          : `The detection-time estimate (~${Math.round(ytd)} years) is shorter than the record, yet the test is not significant — the change may be irregular rather than a steady trend.`,
    });
  }
  if (r.summary.significant && !v.intervalScale && r.summary.pctPerDecade !== null && Math.abs(r.summary.pctPerDecade) < 1) {
    blocks.push({ type: "caution", text: "Significant but small: the change is under 1% of the mean per decade. Statistical significance is not the same as practical importance." });
  }
  if (r.missingPct > 10) blocks.push({ type: "caution", text: `${fmt(r.missingPct, 1)}% of months are missing; results may be less reliable.` });
  const mkDir = Math.sign(r.sen.slope);
  const olsDir = Math.sign(r.ols.slope);
  if (mkDir !== 0 && olsDir !== 0 && mkDir !== olsDir) {
    blocks.push({ type: "caution", text: "Sen's slope (annual) and OLS (monthly anomalies) disagree in sign — the trend is weak and method-dependent." });
  }
  for (const h of hypothesesFor(r, v).slice(0, 2)) blocks.push({ type: "hypothesis", title: "Possible explanation — untested", text: h.text, tests: h.tests });
  return blocks;
}

/* ------------------------------ Q & A ------------------------------------ */

type CaseEntry = AnalystContext["entries"][number];

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

/**
 * What a question can be about. Each concept maps to the catalog variables that
 * measure it. Deliberately stricter than the catalog search keywords (where e.g.
 * "air" or "moisture" match several variables) so the analyst never answers a
 * question about one variable with numbers from another.
 */
interface Concept {
  id: string;
  label: string;
  re: RegExp;
  ids: string[];
  /** Variable offered when the case does not contain this concept. */
  add: string;
  /** More specific concepts that replace this one when both match. */
  supersededBy?: string[];
}
const CONCEPTS: Concept[] = [
  { id: "precip", label: "precipitation", re: /\b(precip\w*|rain\w*|snowfall|monsoons?)\b/, ids: ["precip"], add: "precip" },
  { id: "sst", label: "sea surface temperature", re: /\b(sea[- ]surface temperatures?|sst|ocean temperatures?|ocean warming)\b/, ids: ["sst"], add: "sst" },
  { id: "lst", label: "land surface temperature", re: /\b(land surface temperatures?|lst|ground temperatures?)\b/, ids: ["lst"], add: "lst" },
  {
    id: "temperature",
    label: "temperature",
    re: /\b(temperatures?|warm\w*|heat\w*|hotter|hot|colder|cold|cool(s|ing|er)?)\b/,
    ids: ["t2m", "lst", "sst", "global-temp"],
    add: "t2m",
    supersededBy: ["sst", "lst"],
  },
  { id: "soil", label: "soil moisture", re: /\b(soils?|root[- ]zone)\b/, ids: ["soil-surface", "soil-root"], add: "soil-surface" },
  { id: "dryness", label: "drought or dryness", re: /\b(droughts?|dry|drying|dries|drier|wetter|wet)\b/, ids: ["precip", "soil-surface", "soil-root"], add: "precip" },
  { id: "water-vapor", label: "water vapor", re: /\b(water vapou?r|humid\w*|precipitable)\b/, ids: ["water-vapor"], add: "water-vapor" },
  { id: "aod", label: "aerosols", re: /\b(aerosols?|haze|hazy|pollut\w*|smog|dust\w*|smoke|aod)\b/, ids: ["aod"], add: "aod" },
  { id: "ozone", label: "ozone", re: /\bozone\b/, ids: ["ozone"], add: "ozone" },
  { id: "evap", label: "evapotranspiration", re: /\b(evapo\w*|transpiration)\b/, ids: ["evap"], add: "evap" },
  { id: "snow", label: "snow", re: /\b(snow|snowpack|snow depth)\b/, ids: ["snow"], add: "snow" },
  { id: "sea-ice", label: "sea ice", re: /\b(sea[- ]ice|ice extent)\b/, ids: ["sea-ice"], add: "sea-ice" },
  { id: "ndvi", label: "vegetation", re: /\b(ndvi|vegetation|greenness|greening|browning)\b/, ids: ["ndvi"], add: "ndvi" },
  { id: "runoff", label: "runoff", re: /\b(runoff|streamflow)\b/, ids: ["runoff"], add: "runoff" },
  { id: "groundwater", label: "groundwater", re: /\b(groundwater|water storage)\b/, ids: ["water-storage"], add: "water-storage" },
  { id: "chlorophyll", label: "chlorophyll", re: /\b(chlorophyll|phytoplankton|algae|algal)\b/, ids: ["chlorophyll"], add: "chlorophyll" },
];

/** Concepts named in a question (lower-cased), most specific first. */
export function mentionedConcepts(q: string): Concept[] {
  const hits = CONCEPTS.filter((c) => c.re.test(q));
  return hits.filter((c) => !c.supersededBy?.some((id) => hits.some((h) => h.id === id)));
}

const UP_WORDS = /\b(increas\w*|ris(e|es|ing)|warm(s|ing|er)|wetter|grow(s|ing)?|higher|more)\b/;
const DOWN_WORDS = /\b(decreas\w*|declin\w*|fall(s|ing)?|drop(s|ping)?|cool(s|ing|er)|drier|drying|dry(ing)? up|less|lower|shrink\w*|melt\w*|disappear\w*)\b/;
const WHY_WORDS = /\b(why|cause\w*|causing|reason\w*|driv(e|es|ing|er|ers)|explain\w*|behind)\b/;
const OPPOSITE_WORDS = /\b(opposit\w*|oppos(e|es|ing)|contrast\w*|reverse\w*|see-?saw)\b/;
const ON_TOPIC = /\b(trends?|results?|findings?|find|found|data|chang\w*|summar\w*|overview|signific\w*|investigat\w*|case|regions?|analy\w*|records?|series|variables?|statistic\w*|p-?values?|uncertain\w*|confiden\w*)\b/;

/** Direction a question takes for granted ("why is X decreasing?"), if exactly one. */
export function premiseDirection(q: string): "increasing" | "decreasing" | null {
  const up = UP_WORDS.test(q);
  const down = DOWN_WORDS.test(q);
  return up === down ? null : up ? "increasing" : "decreasing";
}

const dirNoun = (d: "increasing" | "decreasing") => (d === "increasing" ? "increase" : "decrease");
const pText = (p: number) => (fmtP(p).startsWith("<") ? `p ${fmtP(p)}` : `p = ${fmtP(p)}`);
const trendText = (e: CaseEntry) => `${fmtSigned(e.result.summary.perDecade, e.variable.decimals)} ${unitPerDecade(e.variable, e.result)}`;
const label = (e: CaseEntry) => `${e.variable.name} in ${e.region?.name ?? "this area"}`;
const isLive = (id: string) => getVariable(id)?.connector.kind === "power";

function addVariableBlocks(concept: Concept, entries: CaseEntry[]): AnalystBlock[] {
  const v = getVariable(concept.add);
  if (!v) return [];
  const canAdd = isLive(v.id) && entries.length > 0 && entries.every((e) => !!e.region);
  if (canAdd) {
    return [
      {
        type: "action",
        variableId: v.id,
        label: `Add ${v.name} and analyse`,
        text: `Add ${v.name.toLowerCase()} to this case: EARTHSCOPE fetches it from NASA POWER for the same regions and years and tests it with the same methods.`,
      },
    ];
  }
  return [{ type: "suggestion", title: `${v.name} is not in this case`, items: [{ variableId: v.id, reason: isLive(v.id) ? "Start an investigation that includes it." : "Not fetched live — open it to load a bundled snapshot or import a file." }] }];
}

/** "Your question assumes X, but…" — stated before anything else. */
function directionPremiseBlocks(premise: "increasing" | "decreasing", scoped: CaseEntry[]): AnalystBlock[] {
  const out: AnalystBlock[] = [];
  for (const e of scoped.slice(0, 3)) {
    const s = e.result.summary;
    if (s.direction === premise && s.significant) continue;
    if (s.direction === premise) {
      out.push({ type: "caution", text: `Your question assumes a ${dirNoun(premise)}, but the results don't confirm one for ${label(e)}: the estimate points that way (${trendText(e)}) but it is not statistically significant (${pText(s.p)}).` });
    } else if (s.direction !== "no-trend" && s.significant) {
      out.push({ type: "caution", text: `Your question assumes a ${dirNoun(premise)}, but the results show the opposite for ${label(e)}: a statistically significant ${dirNoun(s.direction)} (${trendText(e)}, ${pText(s.p)}).` });
    } else {
      out.push({ type: "caution", text: `Your question assumes a ${dirNoun(premise)}, but the results don't show one for ${label(e)}: the estimate is ${trendText(e)} and it is not statistically significant (${pText(s.p)}).` });
    }
  }
  return out;
}

export function answerLocally(question: string, ctx: AnalystContext): AnalystResponse {
  const q = question.toLowerCase();
  const blocks: AnalystBlock[] = [];
  const sources = new Set<string>();
  const entries = ctx.entries;
  const done = (kind: AnalystResponse["kind"] = "answer", list: CaseEntry[] = entries): AnalystResponse => {
    list.forEach((e) => sources.add(e.series.provenance.source));
    return { engine: "local", blocks, sources: [...sources], kind };
  };

  // Glossary questions work without data.
  const termHit = Object.entries(GLOSSARY).find(([id, g]) => q.includes(g.term.toLowerCase()) || q.includes(id.replace("-", " ")));
  if (has(q, "what is", "what's", "define", "meaning of", "what does", "explain the term") && termHit) {
    blocks.push({ type: "glossary", termId: termHit[0] });
    if (termHit[1].link) sources.add(termHit[1].link.label);
    return { engine: "local", blocks, sources: [...sources], kind: "answer" };
  }

  if (!entries.length) {
    blocks.push({
      type: "text",
      text: "I can only interpret results you have actually computed — there is no active investigation yet. Start one (or run a demo) and I'll explain the trends, test hypotheses and suggest what to investigate next.",
    });
    if (termHit) blocks.push({ type: "glossary", termId: termHit[0] });
    return { engine: "local", blocks, sources: [], kind: "answer" };
  }

  /* ---- 1. Which variables is the question about? Never answer with others. ---- */
  const concepts = mentionedConcepts(q);
  const caseIds = new Set(entries.map((e) => e.variable.id));
  const inCase = new Set<string>();
  const missing: Concept[] = [];
  for (const c of concepts) {
    const ids = c.ids.filter((id) => caseIds.has(id));
    if (ids.length) ids.forEach((id) => inCase.add(id));
    else missing.push(c);
  }
  const caseVars = [...new Set(entries.map((e) => e.variable.name.toLowerCase()))].join(" and ");
  const caseRegions = [...new Set(entries.map((e) => e.region?.name).filter(Boolean))].join(", ");
  if (missing.length && !inCase.size) {
    const m = missing[0];
    blocks.push({
      type: "caution",
      text: `This case doesn't include ${m.label} — it covers ${caseVars}${caseRegions ? ` in ${caseRegions}` : ""}. I won't answer a question about ${m.label} with ${caseVars} data.`,
    });
    blocks.push(...addVariableBlocks(m, entries));
    return done("out-of-case", []);
  }
  const scoped = inCase.size ? entries.filter((e) => inCase.has(e.variable.id)) : entries;
  if (missing.length) {
    blocks.push({ type: "caution", text: `This case has no ${missing.map((m) => m.label).join(" or ")} data, so the answer below uses only ${[...new Set(scoped.map((e) => e.variable.name.toLowerCase()))].join(" and ")}.` });
    blocks.push(...addVariableBlocks(missing[0], entries));
  }

  const regionNames = entries.map((e) => e.region?.name?.toLowerCase()).filter((n): n is string => !!n);
  const why = WHY_WORDS.test(q);
  const premise = premiseDirection(q);

  /* ---- 2. Opposite / compare between regions ---- */
  const wantsOpposite = OPPOSITE_WORDS.test(q);
  const mentionsRegions = /(regions?|places?|countries|areas|these two|both)/.test(q) || regionNames.filter((n) => q.includes(n)).length >= 2;
  if (wantsOpposite || (/(comparew*|comparison|differw*|vs|versus)/.test(q) && mentionsRegions)) {
    const byVar = new Map<string, CaseEntry[]>();
    for (const e of scoped) byVar.set(e.variable.id, [...(byVar.get(e.variable.id) ?? []), e]);
    const groups = [...byVar.values()].filter((g) => g.length >= 2);
    if (!groups.length) {
      const only = scoped[0];
      blocks.push({
        type: "caution",
        text: `Your question ${wantsOpposite ? "assumes opposite trends between regions" : "compares regions"}, but this case has only one region for ${[...new Set(scoped.map((e) => e.variable.name.toLowerCase()))].join(" and ")} (${only.region?.name ?? "the selected area"}). Add a region in Regional Comparison to compare.`,
      });
      blocks.push({ type: "evidence", title: `What the data show · ${label(only)}`, items: evidenceFor(only.result, only.variable).slice(0, 3), source: only.series.provenance.source });
      return done("answer", scoped);
    }
    for (const group of groups) {
      const v = group[0].variable;
      const ups = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "increasing");
      const downs = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "decreasing");
      const opposing = ups.length > 0 && downs.length > 0;
      if (wantsOpposite && !opposing) {
        const signsDiffer = group.some((a) => group.some((b) => a !== b && Math.sign(a.result.summary.perDecade) === -Math.sign(b.result.summary.perDecade)));
        blocks.push({
          type: "caution",
          text: signsDiffer
            ? `Your question assumes opposite ${v.name.toLowerCase()} trends, but the results don't establish them: the estimates point in opposite directions, yet at least one is not statistically significant. Here is what the data do show:`
            : `Your question assumes opposite ${v.name.toLowerCase()} trends, but these regions do not show opposite trends in the computed results. Here is what the data do show:`,
        });
      }
      blocks.push({
        type: "evidence",
        title: `Measured: ${v.name} by region`,
        items: group.map((e) => ({
          label: e.region?.name ?? e.series.regionId,
          value: trendText(e),
          detail: `${e.result.summary.significant ? "significant" : "not significant"} · p = ${fmtP(e.result.summary.p)} · CI ${fmtSigned(e.result.summary.perDecadeCi[0], v.decimals)}…${fmtSigned(e.result.summary.perDecadeCi[1], v.decimals)}`,
        })),
      });
      if (opposing) {
        blocks.push({
          type: "text",
          text: `The data show genuinely opposing, significant trends: ${ups.map((e) => e.region?.name).join(", ")} increasing vs ${downs.map((e) => e.region?.name).join(", ")} decreasing. As the challenge notes, one large-scale process can push neighbouring regions in opposite directions.`,
        });
        blocks.push({
          type: "hypothesis",
          title: "Possible explanation — untested",
          text: `A shift in the position or strength of the circulation feature that delivers ${v.name.toLowerCase()} (storm track, monsoon or jet) could add to one region while taking from another.`,
          tests: [
            "Check whether the opposing changes happen in the same season (seasonal cycle chart for each region).",
            "Test a region located between the two — a gradient would support a shift.",
            "Relate each region's anomalies to the other (Relationship Lab): a negative correlation would be consistent with a see-saw.",
          ],
        });
      } else if (!wantsOpposite) {
        const sigCount = ups.length + downs.length;
        blocks.push({
          type: "text",
          text: `${sigCount} of ${group.length} regions show a statistically significant ${v.name.toLowerCase()} trend. Compare the confidence intervals: where they overlap, the regions' rates are not clearly different.`,
        });
      }
    }
    return done("answer", scoped);
  }

  /* ---- 3. Premises about direction are checked before anything else ---- */
  if (premise && why) blocks.push(...directionPremiseBlocks(premise, scoped));

  // Significance / statistics explanation
  if (has(q, "significan", "p-value", "p value", "confidence", "mann", "kendall", "regression", "reliable", "trust", "certain") || /\bsen'?s?\b/.test(q)) {
    for (const e of scoped.slice(0, 3)) {
      blocks.push({ type: "evidence", title: `${e.variable.name} · ${e.region?.name ?? ""}`, items: evidenceFor(e.result, e.variable), source: e.series.provenance.source });
    }
    blocks.push({
      type: "text",
      text: "Read the p-value as: “if there were no real trend, how often would random variability produce one at least this strong?”. The confidence interval gives the plausible range of the true rate; if it excludes zero the trend is significant. EARTHSCOPE tests annual values with Mann-Kendall (rank-based, robust) and monthly anomalies with OLS adjusted for autocorrelation.",
    });
    blocks.push({ type: "glossary", termId: "practical-importance" });
    return done("answer", scoped);
  }

  // Years to detect / longer record
  if (has(q, "how long", "how many years", "longer", "more data", "detect")) {
    for (const e of scoped) {
      const ytd = e.result.summary.yearsToDetect;
      blocks.push({
        type: "evidence",
        title: `${e.variable.name} · ${e.region?.name ?? ""}`,
        items: [
          { label: "Record length", value: `${e.result.endYear - e.result.startYear + 1} years` },
          { label: "Years needed to detect (Weatherhead 1998)", value: ytd ? `≈ ${Math.round(ytd)} years` : "—" },
          { label: "Currently significant?", value: e.result.summary.significant ? "Yes" : "No" },
        ],
      });
    }
    blocks.push({ type: "glossary", termId: "years-to-detect" });
    return done("answer", scoped);
  }

  // Suggestions
  if (has(q, "suggest", "what else", "next", "other variable", "investigate further", "recommend", "should i")) {
    const used = entries.map((e) => e.variable.id);
    const seen = new Set<string>();
    const items: { variableId: string; reason: string }[] = [];
    for (const e of scoped) for (const n of nextVariables(e.variable, used)) if (!seen.has(n.variableId)) (seen.add(n.variableId), items.push(n));
    blocks.push({ type: "suggestion", title: "Variables worth testing next", items: items.slice(0, 4) });
    blocks.push({ type: "text", text: "Also consider: comparing a neighbouring region, testing sub-periods (e.g. before/after 2000), and checking the seasonal chart for which months drive the change." });
    return done("answer", scoped);
  }

  // Hypotheses
  if (why) {
    for (const e of scoped.slice(0, 3)) {
      blocks.push({ type: "text", text: describeResult(e.result, e.variable, e.region?.name ?? "the region") });
      const hs = hypothesesFor(e.result, e.variable);
      if (!e.result.summary.significant) {
        blocks.push({ type: "caution", text: `${e.variable.name}: the trend is not significant, so a causal explanation would be premature. Consider whether more data are needed first.` });
      }
      for (const h of hs) blocks.push({ type: "hypothesis", title: "Hypothesis — not tested by this analysis", text: h.text, tests: h.tests });
      if (!hs.length) blocks.push({ type: "text", text: "I don't have a vetted mechanism for this variable/direction. Treat any explanation as a hypothesis to test against other variables." });
    }
    blocks.push({ type: "caution", text: "Statistical trends describe WHAT changed, not WHY. These hypotheses come from physical reasoning, not from the data; they are not proven." });
    return done("answer", scoped);
  }

  // Direct yes/no questions about a direction ("Is precipitation decreasing in Jordan?")
  if (premise) {
    for (const e of scoped.slice(0, 3)) {
      const s = e.result.summary;
      const lead =
        s.direction === premise && s.significant
          ? "Yes."
          : s.direction === premise
            ? "Not confirmed."
            : s.significant && s.direction !== "no-trend"
              ? `No — the data show a significant ${dirNoun(s.direction)}.`
              : "No clear trend.";
      blocks.push({ type: "text", text: `${lead} ${describeResult(e.result, e.variable, e.region?.name ?? "the region")}` });
    }
    return done("answer", scoped);
  }

  // Out of scope: nothing in the question relates to this investigation.
  if (!concepts.length && !ON_TOPIC.test(q) && !regionNames.some((n) => q.includes(n))) {
    blocks.push({
      type: "text",
      text: `I can only answer questions about this investigation's computed results — ${caseVars}${caseRegions ? ` in ${caseRegions}` : ""}. I don't have information about anything else, so I won't guess. Try one of the suggested questions below.`,
    });
    return done("out-of-scope", []);
  }

  // Default: summary
  const sig = scoped.filter((e) => e.result.summary.significant);
  blocks.push({
    type: "text",
    text: `I analysed ${scoped.length} time series. ${sig.length} show a statistically significant trend at α = ${scoped[0].result.summary.alpha}.`,
  });
  for (const e of scoped.slice(0, 4)) {
    blocks.push({ type: "evidence", title: `${e.variable.name} · ${e.region?.name ?? ""}`, items: evidenceFor(e.result, e.variable).slice(0, 4), source: e.series.provenance.source });
  }
  return done("answer", scoped);
}

/**
 * Suggested questions built from the current case (its variables, regions and
 * findings). Only questions the analyst can actually answer for this case.
 */
export function suggestedPrompts(ctx: AnalystContext): string[] {
  const es = ctx.entries;
  if (!es.length) return ["What is a p-value?", "What is the Mann-Kendall test?", "What is Sen's slope?", "What is a confidence interval?"];
  const out: string[] = [];
  const first = es[0];
  const v0 = first.variable.name.toLowerCase();
  const r0 = first.region?.name;
  out.push(`Is the ${v0} trend${r0 ? ` in ${r0}` : ""} statistically significant?`);

  const byVar = new Map<string, CaseEntry[]>();
  for (const e of es) byVar.set(e.variable.id, [...(byVar.get(e.variable.id) ?? []), e]);
  for (const group of byVar.values()) {
    if (group.length < 2) continue;
    const v = group[0].variable.name.toLowerCase();
    const ups = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "increasing");
    const downs = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "decreasing");
    if (ups.length && downs.length) out.push(`Why do ${ups[0].region?.name} and ${downs[0].region?.name} show opposite ${v} trends?`);
    else out.push(`How do the ${v} trends compare across ${group.map((e) => e.region?.name).filter(Boolean).slice(0, 3).join(", ")}?`);
    break;
  }

  const s0 = first.result.summary;
  if (s0.significant && s0.direction !== "no-trend") out.push(`What could be causing the ${dirNoun(s0.direction)} in ${v0}${r0 ? ` in ${r0}` : ""}?`);
  else if (s0.yearsToDetect) out.push(`How many years of data would we need to detect the ${v0} trend?`);

  if (byVar.size > 1) {
    const other = [...byVar.values()][1][0];
    out.push(`Is the ${other.variable.name.toLowerCase()} trend${other.region?.name ? ` in ${other.region.name}` : ""} statistically significant?`);
  }
  out.push("What other variables should I investigate next?");
  out.push("Summarise my results.");
  out.push("What is the Mann-Kendall test?");
  return [...new Set(out)].slice(0, 6);
}

/** Compact, numbers-only context sent to an optional remote LLM. */
export function compactContext(ctx: AnalystContext) {
  return ctx.entries.map((e) => ({
    variable: e.variable.name,
    unit: e.variable.unit,
    region: e.region?.name,
    regionContext: e.region?.context,
    years: `${e.result.startYear}-${e.result.endYear}`,
    source: e.series.provenance.source,
    trendPerDecade: e.result.summary.perDecade,
    ci95: e.result.summary.perDecadeCi,
    p: e.result.summary.p,
    significant: e.result.summary.significant,
    method: e.result.summary.method,
    pctPerDecade: e.variable.intervalScale ? null : e.result.summary.pctPerDecade,
    mkTau: e.result.mk.tau,
    olsAr1: { slopePerDecade: e.result.ols.slope * 10, p: e.result.ols.p, r2: e.result.ols.r2 },
    yearsToDetect: e.result.summary.yearsToDetect,
    missingPct: e.result.missingPct,
  }));
}

export const AI_ENDPOINT: string | undefined = (import.meta.env.VITE_AI_ENDPOINT as string | undefined) || undefined;

export async function answer(question: string, ctx: AnalystContext): Promise<AnalystResponse> {
  const local = answerLocally(question, ctx);
  if (!AI_ENDPOINT || local.kind === "out-of-case" || local.kind === "out-of-scope") return local;
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, results: compactContext(ctx) }),
    });
    if (!res.ok) throw new Error(`AI endpoint HTTP ${res.status}`);
    const data = (await res.json()) as { answer?: string };
    if (!data.answer) throw new Error("Empty AI response");
    // Keep the measured evidence blocks from the local engine; replace narrative text.
    const evidence = local.blocks.filter((b) => b.type === "evidence" || b.type === "action");
    const premises = local.blocks.filter((b) => b.type === "caution" && /^(Your question|This case)/.test(b.text));
    return {
      engine: "remote",
      kind: "answer",
      blocks: [...premises, ...evidence, { type: "text", text: data.answer }, { type: "caution", text: "Generated by a language model from your computed results. Verify any claim against the evidence above." }],
      sources: local.sources,
    };
  } catch (e) {
    return { ...local, blocks: [{ type: "caution", text: "The language model didn't respond, so the rule-based analyst answered instead." }, ...local.blocks] };
  }
}

export const ALL_VARIABLE_IDS = VARIABLES.map((v) => v.id);
