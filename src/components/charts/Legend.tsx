import type { ReactNode } from "react";
import { useSafeId } from "./utils";

export type LegendKind =
  | "line"
  | "dashed"
  | "area"
  | "rect"
  | "dot"
  | "hollow"
  | "outline"
  | "hatch"
  | "fan"
  | "marker"
  | "gradient";

export interface LegendItem {
  id: string;
  label: ReactNode;
  kind: LegendKind;
  color?: string;
  /** Second color (e.g. the other pole of a split swatch). */
  color2?: string;
  /** Glyph shown after the key (▲ ▼ ◆) — trend color is never alone. */
  glyph?: string;
  /** Muted trailing note, e.g. "p < 0.05". */
  note?: ReactNode;
}

/** The key mirrors the mark: a line for lines, a rect for bars/areas, a ring for hollow. */
export function LegendKey({ kind, color = "var(--color-ink-3)", color2 }: { kind: LegendKind; color?: string; color2?: string }) {
  const uid = useSafeId("lg");
  const w = 18;
  const h = 10;
  switch (kind) {
    case "line":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <line x1={1} x2={w - 1} y1={h / 2} y2={h / 2} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </svg>
      );
    case "dashed":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <line x1={1} x2={w - 1} y1={h / 2} y2={h / 2} stroke={color} strokeWidth={2} strokeDasharray="4 3" />
        </svg>
      );
    case "area":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <rect x={1} y={2} width={w - 2} height={h - 2} rx={2} fill={color} opacity={0.18} />
          <line x1={1} x2={w - 1} y1={2.5} y2={2.5} stroke={color} strokeWidth={1.5} />
        </svg>
      );
    case "rect":
      return (
        <svg width={12} height={h} aria-hidden="true">
          {color2 ? (
            <>
              <rect x={0} y={1} width={5} height={8} rx={1.5} fill={color} />
              <rect x={7} y={1} width={5} height={8} rx={1.5} fill={color2} />
            </>
          ) : (
            <rect x={1} y={1} width={10} height={8} rx={2} fill={color} />
          )}
        </svg>
      );
    case "dot":
      return (
        <svg width={10} height={h} aria-hidden="true">
          <circle cx={5} cy={5} r={4} fill={color} />
        </svg>
      );
    case "hollow":
      return (
        <svg width={10} height={h} aria-hidden="true">
          <circle cx={5} cy={5} r={3.5} fill="none" stroke={color} strokeWidth={1.5} />
        </svg>
      );
    case "outline":
      return (
        <svg width={12} height={h} aria-hidden="true">
          <rect x={1.5} y={1.5} width={9} height={7} rx={1.5} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1.25} />
        </svg>
      );
    case "marker":
      return (
        <svg width={10} height={h + 2} aria-hidden="true">
          <line x1={5} x2={5} y1={0} y2={h + 2} stroke="var(--color-line-bright)" strokeWidth={1} />
          <path d="M5 1.5 L8 4.5 L5 7.5 L2 4.5Z" fill={color} />
        </svg>
      );
    case "hatch":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <defs>
            <pattern id={`hatch-${uid}`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={4} stroke="var(--color-ink-4)" strokeWidth={1.5} />
            </pattern>
          </defs>
          <rect x={0.5} y={1.5} width={w - 1} height={h - 3} rx={1.5} fill={`url(#hatch-${uid})`} stroke="var(--color-missing)" />
        </svg>
      );
    case "fan":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <path d={`M1 3 L${w / 2} ${h / 2} L${w - 1} 1 L${w - 1} ${h - 1} L${w / 2} ${h / 2} L1 ${h - 3}Z`} fill={color} opacity={0.28} />
        </svg>
      );
    case "gradient":
      return (
        <svg width={w} height={h} aria-hidden="true">
          <rect x={0} y={1} width={w / 2} height={h - 2} fill={color} rx={1.5} />
          <rect x={w / 2} y={1} width={w / 2} height={h - 2} fill={color2 ?? color} rx={1.5} />
        </svg>
      );
  }
}

export interface ChartLegendProps {
  items: LegendItem[];
  className?: string;
  /** Accessible name for the legend list. */
  label?: string;
}

export function ChartLegend({ items, className, label = "Legend" }: ChartLegendProps) {
  if (!items.length) return null;
  return (
    <ul className={`es-legend${className ? ` ${className}` : ""}`} aria-label={label}>
      {items.map((it) => (
        <li key={it.id} className="es-legend-item">
          <LegendKey kind={it.kind} color={it.color} color2={it.color2} />
          {it.glyph && (
            <span className="es-legend-glyph" style={{ color: it.color }} aria-hidden="true">
              {it.glyph}
            </span>
          )}
          <span>{it.label}</span>
          {it.note != null && <span className="es-legend-note">{it.note}</span>}
        </li>
      ))}
    </ul>
  );
}
