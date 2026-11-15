/**
 * False discovery rate control for many simultaneous tests (e.g. one trend
 * test per grid cell on a map).
 *
 * @module stats/fdr
 */
import { isValidValue, type MaybeNumber } from "./series";

/**
 * Benjamini–Hochberg adjusted p-values ("q-values" in the BH sense), equal to
 * R's `p.adjust(p, "BH")` and `scipy.stats.false_discovery_control(p, method="bh")`:
 *   q_(k) = min_{j ≥ k} ( m · p_(j) / j ), capped at 1.
 * Missing / non-finite p-values are excluded from m and returned as NaN.
 */
export function benjaminiHochbergAdjust(pvalues: ArrayLike<MaybeNumber>): number[] {
  const idx: number[] = [];
  for (let i = 0; i < pvalues.length; i++) if (isValidValue(pvalues[i])) idx.push(i);
  const m = idx.length;
  const out = new Array<number>(pvalues.length).fill(NaN);
  if (m === 0) return out;
  idx.sort((a, b) => (pvalues[a] as number) - (pvalues[b] as number));
  let running = Infinity;
  for (let k = m - 1; k >= 0; k--) {
    const i = idx[k];
    const q = Math.min(1, (m * (pvalues[i] as number)) / (k + 1));
    running = Math.min(running, q);
    out[i] = running;
  }
  return out;
}

/**
 * Benjamini & Hochberg (1995) step-up procedure, "Controlling the false
 * discovery rate: a practical and powerful approach to multiple testing",
 * J. R. Stat. Soc. B 57:289–300. With p-values sorted ascending, find the
 * largest k with p_(k) ≤ (k/m)·α and reject the k smallest.
 *
 * For field significance of gridded climate trends, Wilks (2016, "'The Stippling
 * Shows Statistically Significant Grid Points': How Research Results are
 * Routinely Overstated and Overinterpreted, and What to Do about It", BAMS
 * 97:2263–2273) recommends α_FDR = 0.10 (the default here), which controls
 * the global test at about α_global = 0.05 for typical spatial correlation.
 *
 * @returns booleans aligned with the input (true = significant after FDR
 * control). Missing p-values are never significant and are excluded from m.
 */
export function benjaminiHochberg(pvalues: ArrayLike<MaybeNumber>, alpha = 0.1): boolean[] {
  const q = benjaminiHochbergAdjust(pvalues);
  return q.map((v) => Number.isFinite(v) && v <= alpha);
}
