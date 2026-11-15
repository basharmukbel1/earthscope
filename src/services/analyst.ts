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
  | { type: "caution"; text: string };

export interface AnalystResponse {
  engine: "local" | "remote";
  blocks: AnalystBlock[];
  sources: string[];
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

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

export function answerLocally(question: string, ctx: AnalystContext): AnalystResponse {
  const q = question.toLowerCase();
  const blocks: AnalystBlock[] = [];
  const sources = new Set<string>();
  const entries = ctx.entries;
  entries.forEach((e) => sources.add(e.series.provenance.source));

  // Glossary questions work without data.
  const termHit = Object.entries(GLOSSARY).find(([id, g]) => q.includes(g.term.toLowerCase()) || q.includes(id.replace("-", " ")));
  if (has(q, "what is", "what's", "define", "meaning of", "what does", "explain the term") && termHit) {
    blocks.push({ type: "glossary", termId: termHit[0] });
    if (termHit[1].link) sources.add(termHit[1].link.label);
    return { engine: "local", blocks, sources: [...sources] };
  }

  if (!entries.length) {
    blocks.push({
      type: "text",
      text: "I can only interpret results you have actually computed — there is no active investigation yet. Start one (or run a demo) and I'll explain the trends, test hypotheses and suggest what to investigate next.",
    });
    if (termHit) blocks.push({ type: "glossary", termId: termHit[0] });
    return { engine: "local", blocks, sources: [] };
  }

  const sig = entries.filter((e) => e.result.summary.significant);

  // Opposite trends between regions
  if (has(q, "opposite", "different", "differ", "contrast", "why are these", "two regions", "compare")) {
    const byVar = new Map<string, typeof entries>();
    for (const e of entries) byVar.set(e.variable.id, [...(byVar.get(e.variable.id) ?? []), e]);
    let found = false;
    for (const [, group] of byVar) {
      if (group.length < 2) continue;
      found = true;
      const v = group[0].variable;
      blocks.push({
        type: "evidence",
        title: `Measured: ${v.name} by region`,
        items: group.map((e) => ({
          label: e.region?.name ?? e.series.regionId,
          value: `${fmtSigned(e.result.summary.perDecade, v.decimals)} ${unitPerDecade(v, e.result)}`,
          detail: `${e.result.summary.significant ? "significant" : "not significant"} · p = ${fmtP(e.result.summary.p)} · CI ${fmtSigned(e.result.summary.perDecadeCi[0], v.decimals)}…${fmtSigned(e.result.summary.perDecadeCi[1], v.decimals)}`,
        })),
      });
      const ups = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "increasing");
      const downs = group.filter((e) => e.result.summary.significant && e.result.summary.direction === "decreasing");
      if (ups.length && downs.length) {
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
      } else {
        const opposite = group.some((a) => group.some((b) => Math.sign(a.result.summary.perDecade) === -Math.sign(b.result.summary.perDecade) && a !== b));
        blocks.push({
          type: "caution",
          text: opposite
            ? "The trend estimates point in opposite directions, but at least one of them is not statistically significant — so the data do not yet establish opposing trends. Look at whether the confidence intervals overlap zero."
            : "These regions do not show opposite trends in the computed results.",
        });
      }
    }
    if (!found) blocks.push({ type: "text", text: "Opposite-trend questions need the same variable in at least two regions. Use Regional Comparison to add regions." });
    return { engine: "local", blocks, sources: [...sources] };
  }

  // Significance / statistics explanation
  if (has(q, "significan", "p-value", "p value", "confidence", "mann", "kendall", "sen", "regression", "reliable", "trust", "certain")) {
    for (const e of entries.slice(0, 3)) {
      blocks.push({ type: "evidence", title: `${e.variable.name} · ${e.region?.name ?? ""}`, items: evidenceFor(e.result, e.variable), source: e.series.provenance.source });
    }
    blocks.push({
      type: "text",
      text: "Read the p-value as: “if there were no real trend, how often would random variability produce one at least this strong?”. The confidence interval gives the plausible range of the true rate; if it excludes zero the trend is significant. EARTHSCOPE tests annual values with Mann-Kendall (rank-based, robust) and monthly anomalies with OLS adjusted for autocorrelation.",
    });
    blocks.push({ type: "glossary", termId: "practical-importance" });
    return { engine: "local", blocks, sources: [...sources] };
  }

  // Years to detect / longer record
  if (has(q, "how long", "how many years", "longer", "more data", "detect")) {
    for (const e of entries) {
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
    return { engine: "local", blocks, sources: [...sources] };
  }

  // Suggestions
  if (has(q, "suggest", "what else", "next", "other variable", "investigate further", "recommend", "should i")) {
    const used = entries.map((e) => e.variable.id);
    const seen = new Set<string>();
    const items: { variableId: string; reason: string }[] = [];
    for (const e of entries) for (const n of nextVariables(e.variable, used)) if (!seen.has(n.variableId)) (seen.add(n.variableId), items.push(n));
    blocks.push({ type: "suggestion", title: "Variables worth testing next", items: items.slice(0, 4) });
    blocks.push({ type: "text", text: "Also consider: comparing a neighbouring region, testing sub-periods (e.g. before/after 2000), and checking the seasonal chart for which months drive the change." });
    return { engine: "local", blocks, sources: [...sources] };
  }

  // Hypotheses
  if (has(q, "why", "cause", "hypothes", "reason", "driver", "explain")) {
    for (const e of entries.slice(0, 3)) {
      blocks.push({ type: "text", text: describeResult(e.result, e.variable, e.region?.name ?? "the region") });
      const hs = hypothesesFor(e.result, e.variable);
      if (!e.result.summary.significant) {
        blocks.push({ type: "caution", text: `${e.variable.name}: the trend is not significant, so a causal explanation would be premature. Consider whether more data are needed first.` });
      }
      for (const h of hs) blocks.push({ type: "hypothesis", title: "Hypothesis — not tested by this analysis", text: h.text, tests: h.tests });
      if (!hs.length) blocks.push({ type: "text", text: "I don't have a vetted mechanism for this variable/direction. Treat any explanation as a hypothesis to test against other variables." });
    }
    blocks.push({ type: "caution", text: "Statistical trends describe WHAT changed, not WHY. These hypotheses come from physical reasoning, not from the data; they are not proven." });
    return { engine: "local", blocks, sources: [...sources] };
  }

  // Default: summary
  blocks.push({
    type: "text",
    text: `I analysed ${entries.length} time series. ${sig.length} show a statistically significant trend at α = ${entries[0].result.summary.alpha}.`,
  });
  for (const e of entries.slice(0, 4)) {
    blocks.push({ type: "evidence", title: `${e.variable.name} · ${e.region?.name ?? ""}`, items: evidenceFor(e.result, e.variable).slice(0, 4), source: e.series.provenance.source });
  }
  blocks.push({ type: "suggestion", title: "Try asking", items: [] });
  return { engine: "local", blocks, sources: [...sources] };
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
  if (!AI_ENDPOINT) return local;
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
    const evidence = local.blocks.filter((b) => b.type === "evidence");
    return {
      engine: "remote",
      blocks: [...evidence, { type: "text", text: data.answer }, { type: "caution", text: "Generated by a language model from your computed results. Verify any claim against the evidence above." }],
      sources: local.sources,
    };
  } catch (e) {
    return { ...local, blocks: [{ type: "caution", text: "The language model didn't respond, so the rule-based analyst answered instead." }, ...local.blocks] };
  }
}

export const SUGGESTED_PROMPTS = [
  "Why are these two regions showing opposite precipitation trends?",
  "Is this trend statistically significant? Explain the p-value.",
  "How many years of data would we need to detect this trend?",
  "What other variables should I investigate next?",
  "What could be causing this change?",
  "What is the Mann-Kendall test?",
  "Summarise my results.",
];

export const ALL_VARIABLE_IDS = VARIABLES.map((v) => v.id);
