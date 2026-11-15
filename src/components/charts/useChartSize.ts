import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface ChartSizeOptions {
  /** Fixed plot height in px (wins over aspect). */
  height?: number;
  /** width / height ratio used when no fixed height is given (default 2.4). */
  aspect?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface ChartSize<T extends HTMLElement> {
  ref: RefObject<T | null>;
  width: number;
  height: number;
  /** True once the container has been measured (width > 0). */
  ready: boolean;
}

/**
 * Responsive chart sizing: tracks the container's content width with a
 * ResizeObserver and derives the height (fixed, or from an aspect ratio,
 * clamped). Width is rounded to whole pixels so hairlines stay crisp.
 */
export function useChartSize<T extends HTMLElement = HTMLDivElement>(
  opts: ChartSizeOptions = {},
): ChartSize<T> {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => {
      const next = Math.max(0, Math.floor(w));
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure(w));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const { height: fixed, aspect = 2.4, minHeight = 160, maxHeight = 640 } = opts;
  const height = fixed ?? Math.round(Math.max(minHeight, Math.min(maxHeight, width > 0 ? width / aspect : minHeight)));

  return { ref, width, height, ready: width > 0 };
}
