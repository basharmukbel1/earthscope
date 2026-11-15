import { useId } from "react";
import { useReducedMotion } from "motion/react";

/** useId() sanitised for use inside SVG url(#…) references. */
export function useSafeId(prefix = "es"): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Motion is decoration: honour the user's reduced-motion preference. */
export function useChartMotion(): { animate: boolean } {
  const reduced = useReducedMotion();
  return { animate: !reduced };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Index of the value in a SORTED array nearest to x (binary search). */
export function nearestIndex(sorted: readonly number[], x: number): number {
  const n = sorted.length;
  if (!n) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo] - x) <= Math.abs(sorted[hi] - x) ? lo : hi;
}

/** Approximate rendered width of mono text (JetBrains Mono ≈ 0.6em per glyph). */
export function monoWidth(text: string, fontSize = 10.5): number {
  return text.length * fontSize * 0.6;
}

/** Width of an uppercase tracked mono annotation (es-annot) incl. 6px side padding. */
export function annotWidth(text: string, fontSize = 9.5, tracking = 0.08): number {
  return text.length * fontSize * (0.6 + tracking) + 12;
}

/** Approximate rendered width of Inter text. */
export function sansWidth(text: string, fontSize = 12.5): number {
  return text.length * fontSize * 0.53;
}

/** Pointer position relative to an element. */
export function localPoint(el: Element, e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * SVG path for a bar whose data-end is rounded and whose baseline end is
 * square (dataviz mark spec). Works for bars growing up or down.
 */
export function roundedBarPath(x: number, w: number, yBase: number, yEnd: number, radius = 4): string {
  const h = Math.abs(yEnd - yBase);
  if (h < 0.01 || w <= 0) return "";
  const r = Math.max(0, Math.min(radius, w / 2, h));
  const up = yEnd < yBase;
  const x0 = x;
  const x1 = x + w;
  if (r < 0.5) return `M${x0},${yBase}V${yEnd}H${x1}V${yBase}Z`;
  if (up) {
    return `M${x0},${yBase}V${yEnd + r}Q${x0},${yEnd} ${x0 + r},${yEnd}H${x1 - r}Q${x1},${yEnd} ${x1},${yEnd + r}V${yBase}Z`;
  }
  return `M${x0},${yBase}V${yEnd - r}Q${x0},${yEnd} ${x0 + r},${yEnd}H${x1 - r}Q${x1},${yEnd} ${x1},${yEnd - r}V${yBase}Z`;
}

/** Same as roundedBarPath but horizontal (grows from xBase to xEnd). */
export function roundedHBarPath(y: number, h: number, xBase: number, xEnd: number, radius = 4): string {
  const w = Math.abs(xEnd - xBase);
  if (w < 0.01 || h <= 0) return "";
  const r = Math.max(0, Math.min(radius, h / 2, w));
  const right = xEnd > xBase;
  const y0 = y;
  const y1 = y + h;
  if (r < 0.5) return `M${xBase},${y0}H${xEnd}V${y1}H${xBase}Z`;
  if (right) {
    return `M${xBase},${y0}H${xEnd - r}Q${xEnd},${y0} ${xEnd},${y0 + r}V${y1 - r}Q${xEnd},${y1} ${xEnd - r},${y1}H${xBase}Z`;
  }
  return `M${xBase},${y0}H${xEnd + r}Q${xEnd},${y0} ${xEnd},${y0 + r}V${y1 - r}Q${xEnd},${y1} ${xEnd + r},${y1}H${xBase}Z`;
}

/** Bar width + gap for n bars in a band of `span` px (≤ 24px, 2px surface gap). */
export function barGeometry(span: number, n: number, maxWidth = 24): { width: number; gap: number } {
  const slot = n > 0 ? span / n : span;
  const gap = slot >= 6 ? 2 : slot >= 3 ? 1 : 0;
  return { width: Math.max(0.75, Math.min(maxWidth, slot - gap)), gap };
}
