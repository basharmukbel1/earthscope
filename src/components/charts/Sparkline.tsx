import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import type { Point, TrendDirection } from "../../types/domain";
import { C, trendColor } from "./palette";
import { useSafeId } from "./utils";
import "./charts.css";

export interface SparklineProps {
  /** Series values: Points (gaps where v = null) or a plain number array. */
  points: Point[] | (number | null)[];
  width?: number;
  height?: number;
  /** Tint the line by trend direction (only when significant; otherwise neutral). */
  trend?: TrendDirection | null;
  significant?: boolean;
  /** Explicit line color (overrides the trend tint). */
  color?: string;
  /** Soft wash under the line (default true). */
  area?: boolean;
  /** Dot on the most recent value (default true). */
  endDot?: boolean;
  /** Accessible description; omit when the surrounding text already states the values. */
  ariaLabel?: string;
  className?: string;
}

/** Tiny inline series for stat tiles and table rows. */
export function Sparkline({
  points,
  width = 120,
  height = 28,
  trend = null,
  significant = true,
  color,
  area = true,
  endDot = true,
  ariaLabel,
  className,
}: SparklineProps) {
  const uid = useSafeId("sk");
  const data = useMemo(
    () =>
      (points as (Point | number | null)[]).map((p, i) =>
        typeof p === "number" || p === null ? { t: i, v: p } : { t: p.t, v: p.v },
      ),
    [points],
  );
  const stroke = color ?? (trend && significant ? trendColor(trend) : trend ? C.flat : C.primary);

  const geo = useMemo(() => {
    const obs = data.filter((d) => d.v != null && Number.isFinite(d.v)) as { t: number; v: number }[];
    if (obs.length < 2) return null;
    const pad = 3;
    const ts = data.map((d) => d.t);
    const vs = obs.map((d) => d.v);
    const x = scaleLinear().domain([Math.min(...ts), Math.max(...ts)]).range([pad, width - pad]);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    const y = scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([height - pad, pad]);
    const defined = (d: { v: number | null }) => d.v != null && Number.isFinite(d.v);
    const line = d3line<{ t: number; v: number | null }>().defined(defined).x((d) => x(d.t)).y((d) => y(d.v as number))(data) ?? "";
    const fill =
      d3area<{ t: number; v: number | null }>()
        .defined(defined)
        .x((d) => x(d.t))
        .y0(height)
        .y1((d) => y(d.v as number))(data) ?? "";
    const last = obs[obs.length - 1];
    return { line, fill, end: { x: x(last.t), y: y(last.v) } };
  }, [data, width, height]);

  return (
    <svg
      className={`es-spark${className ? ` ${className}` : ""}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {geo && (
        <>
          {area && (
            <>
              <defs>
                <linearGradient id={`${uid}-g`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={geo.fill} fill={`url(#${uid}-g)`} />
            </>
          )}
          <path
            d={geo.line}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {endDot && <circle cx={geo.end.x} cy={geo.end.y} r={2.5} fill={stroke} stroke="var(--color-surface)" strokeWidth={1.5} />}
        </>
      )}
    </svg>
  );
}
