/* ==========================================================================
   EARTHSCOPE significance policy — one rule, stated the same way everywhere.
   - A single time series (one variable, one region): significant if p < α
     (α = 0.05 by default; the user can change it in the Workspace).
   - Many map points tested at once (the Trend Atlas): significant if the
     Benjamini–Hochberg false discovery rate is controlled at q = 0.05.
   ========================================================================== */

export const DEFAULT_ALPHA = 0.05;
/** Must match FDR_Q in scripts/build-atlas.ts (the atlas manifest records it). */
export const ATLAS_FDR_Q = 0.05;

export const singleSeriesPolicy = (alpha = DEFAULT_ALPHA) => `Significant = p < ${alpha} for this single series.`;
export const mapPolicy = (points?: number) =>
  `Significant = Benjamini–Hochberg FDR q < ${ATLAS_FDR_Q}${points ? ` across all ${points} points` : " across all map points"}.`;
