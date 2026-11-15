import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type TooltipKeyKind = "line" | "dashed" | "rect" | "dot" | "hollow" | "none";

export interface ChartTooltipProps {
  open: boolean;
  /** Anchor point in container pixel coordinates. */
  x: number;
  y: number;
  /** Size of the positioning container (the chart root). */
  bounds: { width: number; height: number };
  /**
   * "side": beside the anchor, flipping left/right at the edges (crosshair charts).
   * "above": centred above the anchor, flipping below near the top (bars / cells).
   */
  placement?: "side" | "above";
  /** Gap between anchor and card in px. */
  offset?: number;
  /** Height of the anchored mark (cell / bar), so a flip below clears it. */
  anchorSize?: number;
  /** How far ("above" placement) the card may rise over the content above the plot. */
  overflowTop?: number;
  id?: string;
  children: ReactNode;
}

/**
 * Glass tooltip card that follows the pointer (or the keyboard cursor) and
 * flips at the container edges. Purely visual (aria-hidden) — every chart
 * also announces the same readout through a polite live region.
 */
export function ChartTooltip({
  open,
  x,
  y,
  bounds,
  placement = "side",
  offset = 16,
  anchorSize = 0,
  overflowTop = 48,
  id,
  children,
}: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wasOpen = useRef(false);
  const [snap, setSnap] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) {
      wasOpen.current = false;
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 4;
    let left: number;
    let top: number;
    left = placement === "above" ? x - w / 2 : x + offset;
    if (placement === "side" && left + w > bounds.width - pad) left = x - offset - w;
    left = Math.max(pad - 8, Math.min(bounds.width - w - pad + 8, left));
    if (placement === "above") {
      // prefer above the mark (may rise a little over the legend); else below it
      top = y - h - offset;
      if (top < -overflowTop) top = y + anchorSize + offset;
      top = Math.min(top, Math.max(-overflowTop, bounds.height - h - pad));
    } else {
      top = y - h / 2;
      top = Math.max(pad, Math.min(Math.max(pad, bounds.height - h - pad), top));
    }
    setSnap(!wasOpen.current);
    wasOpen.current = true;
    setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }));
  }, [open, x, y, bounds.width, bounds.height, placement, offset, anchorSize, overflowTop, children]);

  return (
    <div
      ref={ref}
      id={id}
      className="es-tooltip"
      aria-hidden="true"
      data-open={open && pos ? "true" : "false"}
      style={{
        transform: `translate3d(${Math.round(pos?.left ?? 0)}px, ${Math.round(pos?.top ?? 0)}px, 0)`,
        transition: snap ? "opacity 140ms var(--ease-standard)" : undefined,
        visibility: open ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function TooltipHeader({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="es-tt-head">
      <strong>{children}</strong>
      {aside != null && <span>{aside}</span>}
    </div>
  );
}

export function TooltipRows({ children }: { children: ReactNode }) {
  return <div className="es-tt-rows">{children}</div>;
}

export interface TooltipRowProps {
  color?: string;
  kind?: TooltipKeyKind;
  value: ReactNode;
  label: ReactNode;
  missing?: boolean;
}

/** One readout row: [key] value label — values lead, labels follow. */
export function TooltipRow({ color = "var(--color-ink-3)", kind = "line", value, label, missing }: TooltipRowProps) {
  return (
    <>
      {kind === "none" ? (
        <span />
      ) : (
        <span className="es-tt-key" data-kind={kind} style={{ color, background: color }} />
      )}
      <span className="es-tt-value" data-missing={missing ? "true" : undefined}>
        {value}
      </span>
      <span className="es-tt-label">{label}</span>
    </>
  );
}

export function TooltipNote({ children }: { children: ReactNode }) {
  return <div className="es-tt-note">{children}</div>;
}

/** Polite screen-reader announcement of the keyboard/hover readout. */
export function LiveRegion({ text }: { text: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
