import type { AnalysisResult, Variable } from "@/types/domain";
import { fmt, fmtP } from "@/utils/format";
import { resultAnnualUnit } from "@/utils/trend";

/**
 * One plain-language sentence for a computed result, built only from its numbers
 * (headline slope per decade, direction, p-value, α). A trend that is not
 * statistically significant is never stated as a fact.
 *   "Cameroon is warming by about 0.36 °C every decade — a statistically significant trend (p < 0.001)."
 */
export function plainSentence(r: AnalysisResult, v: Variable, regionName = "this area"): string {
  const s = r.summary;
  const unit = resultAnnualUnit(r, v);
  const mag = `${fmt(Math.abs(s.perDecade), v.decimals)} ${unit}`;
  const p = fmtP(s.p);
  const pText = p.startsWith("<") ? `p ${p}` : `p = ${p}`;
  const isTemp = v.intervalScale === true;
  const up = s.direction === "increasing";

  if (s.direction === "no-trend") return `${v.name} in ${regionName} shows no overall change (${pText}).`;

  if (s.significant) {
    const main = isTemp
      ? `${regionName} is ${up ? "warming" : "cooling"} by about ${mag} every decade`
      : `${v.name} in ${regionName} is ${up ? "rising" : "falling"} by about ${mag} every decade`;
    return `${main} — a statistically significant trend (${pText}).`;
  }
  return `The ${v.name.toLowerCase()} estimate for ${regionName} ${up ? "rises" : "falls"} by about ${mag} per decade, but this is not statistically significant (${pText}), so it could be natural variation.`;
}
