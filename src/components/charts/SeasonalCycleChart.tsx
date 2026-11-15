import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { useChartSize } from "./useChartSize";
import { AxisTitle, LinearXAxis, ValueAxis, crisp, leftMarginFor, valueTicks, type Margin } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { ChartLegend, type LegendItem } from "./Legend";
import { DataTable } from "./DataTable";
import { C, DIVERGING, ordinalRamp } from "./palette";
import { MONTHS_LONG, MONTHS_SHORT, MONTH_INITIALS, formatTick, formatValue } from "./format";
import { clamp, localPoint, monoWidth, useChartMotion, useSafeId } from "./utils";
import "./charts.css";

export interface SeasonalPeriod {
  id: string;
  /** e.g. "1981–1990" */
  label: string;
  /** 12 monthly climatology values, January → December. */
  values: (number | null)[];
  color?: string;
  /** Optional spread band (e.g. ±1 SD across years), 12 values each. */
  low?: (number | null)[];
  high?: (number | null)[];
}

export interface SeasonalCycleChartProps {
  /** Two or more periods, OLDEST FIRST (colors step from muted to ice). */
  periods: SeasonalPeriod[];
  yLabel: string;
  unit: string;
  decimals?: number;
  /** Total SVG height including axes (default 280). */
  height?: number;
  ariaLabel: string;
  /** Shade the gap between the oldest and newest period (above = warm, below = cool). */
  showDifference?: boolean;
  /** Legend text for spread bands (default "±1 SD"). */
  spreadLabel?: string;
  showLegend?: boolean;
  onHoverMonth?: (month: number | null) => void;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
type MonthDatum = { m: number; v: number | null };

export function SeasonalCycleChart({
  periods,
  yLabel,
  unit,
  decimals = 1,
  height = 280,
  ariaLabel,
  showDifference = false,
  spreadLabel = "±1 SD",
  showLegend = true,
  onHoverMonth,
  className,
}: SeasonalCycleChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height });
  const uid = useSafeId("sc");
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  const ramp = useMemo(() => ordinalRamp(periods.length), [periods.length]);
  const prepared = useMemo(
    () =>
      periods.map((p, i) => ({
        ...p,
        color: p.color ?? ramp[i],
        data: Array.from({ length: 12 }, (_, m) => ({ m, v: p.values[m] ?? null })) as MonthDatum[],
        newest: i === periods.length - 1,
      })),
    [periods, ramp],
  );
  const first = prepared[0];
  const last = prepared[prepared.length - 1];
  const canDiff = showDifference && prepared.length >= 2;

  const endLabels = width >= 560;
  const geo = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    const take = (v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    };
    for (const p of prepared) {
      p.values.forEach(take);
      p.low?.forEach(take);
      p.high?.forEach(take);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const span = hi - lo || 1;
    const y0 = scaleLinear()
      .domain([lo >= 0 ? Math.max(0, lo - span * 0.08) : lo - span * 0.08, hi + span * 0.08])
      .range([height - 50, 0])
      .nice(Math.max(2, Math.floor((height - 50) / 46)));
    const yt = valueTicks(y0, height - 50);
    // direct end labels only when they separate at December (else legend + tooltip carry identity)
    const endYs = prepared
      .map((p) => {
        for (let m = 11; m >= 0; m--) if (p.values[m] != null) return y0(p.values[m] as number);
        return null;
      })
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const labelsFit = endLabels && endYs.every((v, i) => i === 0 || v - endYs[i - 1] >= 13);
    const right = labelsFit ? Math.max(...prepared.map((p) => monoWidth(p.label, 10))) + 22 : 14;
    const margin: Margin = { top: 24, right, bottom: 26, left: leftMarginFor(yt.ticks.map((v) => formatTick(v, yt.step))) };
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = Math.max(10, height - margin.top - margin.bottom);
    const x = scaleLinear().domain([-0.4, 11.4]).range([0, innerW]);
    const y = y0.copy().range([innerH, 0]);
    return { x, y, yt, margin, innerW, innerH, labelsFit };
  }, [prepared, height, width, endLabels]);
  const { x, y, yt, margin, innerW, innerH, labelsFit } = geo;

  const shapes = useMemo(() => {
    const lineGen = d3line<MonthDatum>()
      .defined((d) => d.v != null)
      .x((d) => x(d.m))
      .y((d) => y(d.v as number))
      .curve(curveMonotoneX);
    const bandGen = d3area<{ m: number; lo: number | null; hi: number | null }>()
      .defined((d) => d.lo != null && d.hi != null)
      .x((d) => x(d.m))
      .y0((d) => y(d.lo as number))
      .y1((d) => y(d.hi as number))
      .curve(curveMonotoneX);
    const lines = prepared.map((p) => ({
      id: p.id,
      d: lineGen(p.data) ?? "",
      band:
        p.low && p.high
          ? bandGen(Array.from({ length: 12 }, (_, m) => ({ m, lo: p.low?.[m] ?? null, hi: p.high?.[m] ?? null }))) ?? ""
          : "",
    }));
    let diff = "";
    let above = "";
    let below = "";
    if (canDiff) {
      const pairs = Array.from({ length: 12 }, (_, m) => ({ m, a: first.values[m] ?? null, b: last.values[m] ?? null }));
      diff =
        d3area<{ m: number; a: number | null; b: number | null }>()
          .defined((d) => d.a != null && d.b != null)
          .x((d) => x(d.m))
          .y0((d) => y(d.a as number))
          .y1((d) => y(d.b as number))
          .curve(curveMonotoneX)(pairs) ?? "";
      const base = lineGen(first.data) ?? "";
      // clip regions: everything above / below the oldest curve
      const firstX = x(0);
      const lastX = x(11);
      above = `${base}L${lastX},-40L${firstX},-40Z`;
      below = `${base}L${lastX},${innerH + 40}L${firstX},${innerH + 40}Z`;
    }
    return { lines, diff, above, below };
  }, [prepared, x, y, canDiff, first, last, innerH]);

  const setActive = useCallback(
    (m: number | null) => {
      if (activeRef.current === m) return;
      activeRef.current = m;
      setActiveRaw(m);
      onHoverMonth?.(m);
    },
    [onHoverMonth],
  );
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e.currentTarget, e);
    setActive(clamp(Math.round(x.invert(p.x - margin.left)), 0, 11));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = activeRef.current ?? 0;
    const map: Record<string, number | null> = {
      ArrowRight: Math.min(11, cur + 1),
      ArrowLeft: Math.max(0, cur - 1),
      Home: 0,
      End: 11,
      Escape: null,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    setActive(map[e.key]);
  };

  const delta = (m: number) => {
    const a = first?.values[m];
    const b = last?.values[m];
    return a != null && b != null && prepared.length >= 2 ? b - a : null;
  };

  const legendItems: LegendItem[] = [
    ...prepared.map((p) => ({ id: p.id, label: p.label, kind: "line" as const, color: p.color, note: p.newest && prepared.length > 1 ? "latest" : undefined })),
    ...(prepared.some((p) => p.low && p.high) ? [{ id: "spread", label: spreadLabel, kind: "area" as const, color: C.ink3 }] : []),
    ...(canDiff
      ? [{ id: "diff", label: `${last.label} above / below ${first.label}`, kind: "gradient" as const, color: DIVERGING.warm, color2: DIVERGING.cool }]
      : []),
  ];

  // direct end labels (only when they don't collide)
  const ends = useMemo(() => {
    if (!labelsFit) return [];
    const items = prepared
      .map((p) => {
        let v: number | null = null;
        for (let m = 11; m >= 0 && v == null; m--) v = p.values[m] ?? null;
        return { id: p.id, label: p.label, color: p.color, y: v == null ? null : y(v) };
      })
      .filter((d): d is { id: string; label: string; color: string; y: number } => d.y != null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 13) return [];
    return items;
  }, [prepared, y, labelsFit]);

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    const monthFmt = (m: number) => (innerW / 12 >= 30 ? MONTHS_SHORT[m] : MONTH_INITIALS[m]);
    return (
      <g>
        <defs>
          <clipPath id={`${uid}-above`}>
            <path d={shapes.above} />
          </clipPath>
          <clipPath id={`${uid}-below`}>
            <path d={shapes.below} />
          </clipPath>
        </defs>
        <ValueAxis scale={y} width={innerW} ticks={yt.ticks} step={yt.step} />
        <LinearXAxis
          scale={x}
          y={innerH}
          ticks={Array.from({ length: 12 }, (_, m) => m)}
          step={1}
          format={monthFmt}
          grid={false}
        />
        <AxisTitle x={-margin.left} y={-margin.top + 11} label={yLabel} unit={unit} />
        {canDiff && (
          <motion.g initial={animate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: animate ? 0.9 : 0 }}>
            <path d={shapes.diff} fill={DIVERGING.warm} opacity={0.2} clipPath={`url(#${uid}-above)`} />
            <path d={shapes.diff} fill={DIVERGING.cool} opacity={0.2} clipPath={`url(#${uid}-below)`} />
          </motion.g>
        )}
        {shapes.lines.map((l, i) =>
          l.band ? <path key={`b${l.id}`} d={l.band} fill={prepared[i].color} opacity={0.1} /> : null,
        )}
        {shapes.lines.map((l, i) => {
          const p = prepared[i];
          const sw = p.newest ? 2.25 : 1.75;
          return (
            <g key={l.id}>
              {animate ? (
                <motion.path
                  d={l.d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ pathLength: { duration: 1.3, ease: EASE, delay: i * 0.2 }, opacity: { duration: 0.2, delay: i * 0.2 } }}
                />
              ) : (
                <path d={l.d} fill="none" stroke={p.color} strokeWidth={sw} strokeLinecap="round" />
              )}
              <motion.g
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: animate ? 0.8 + i * 0.2 : 0 }}
              >
                {p.data.map((d) =>
                  d.v != null ? (
                    <circle
                      key={d.m}
                      cx={x(d.m)}
                      cy={y(d.v)}
                      r={p.newest ? 3.5 : 3}
                      fill={p.newest ? p.color : "var(--color-surface)"}
                      stroke={p.newest ? "var(--color-surface)" : p.color}
                      strokeWidth={p.newest ? 2 : 1.5}
                    />
                  ) : null,
                )}
              </motion.g>
            </g>
          );
        })}
        {ends.map((e) => (
          <g key={`end${e.id}`} transform={`translate(${innerW + 10},${e.y})`}>
            <line x1={-8} x2={-2} y1={0} y2={0} stroke={e.color} strokeWidth={2} />
            <text className="es-tick es-tick-strong" x={2} dy="0.34em" style={{ fontSize: 10 }}>
              {e.label}
            </text>
          </g>
        ))}
      </g>
    );
  }, [ready, x, y, yt, innerW, innerH, margin, uid, yLabel, unit, shapes, prepared, canDiff, animate, ends]);

  const cross =
    active != null ? (
      <g pointerEvents="none">
        <line x1={crisp(x(active))} x2={crisp(x(active))} y1={0} y2={innerH} stroke={C.active} strokeOpacity={0.5} />
        {prepared.map((p) => {
          const v = p.values[active];
          return v != null ? <circle key={p.id} cx={x(active)} cy={y(v)} r={5} fill={p.color} stroke="var(--color-surface)" strokeWidth={2} /> : null;
        })}
      </g>
    ) : null;

  const activeDelta = active != null ? delta(active) : null;
  const liveText =
    active != null
      ? `${MONTHS_LONG[active]}: ` +
        prepared.map((p) => `${p.label} ${formatValue(p.values[active], unit, decimals)}`).join("; ") +
        (activeDelta != null ? `; change ${formatValue(activeDelta, unit, decimals, { signed: true })}` : "")
      : "";

  const table = useMemo(
    () => ({
      cols: ["Month", ...prepared.map((p) => `${p.label} (${unit})`), ...(prepared.length >= 2 ? [`Change, ${last.label} minus ${first.label} (${unit})`] : [])],
      rows: MONTHS_LONG.map((name, m) => [
        name,
        ...prepared.map((p) => (p.values[m] == null ? null : formatValue(p.values[m], undefined, decimals))),
        ...(prepared.length >= 2 ? [(() => { const d = delta(m); return d == null ? null : formatValue(d, undefined, decimals, { signed: true }); })()] : []),
      ]),
    }),
    [prepared, unit, decimals],
  );

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      {showLegend && <ChartLegend items={legendItems} label={`${yLabel} legend`} />}
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}. Use left and right arrow keys to step through months.`}
        tabIndex={0}
        style={{ height, marginTop: showLegend ? 12 : 0 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null) setActive(0);
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {staticLayer}
              {cross}
            </g>
          </svg>
        )}
        <ChartTooltip
          open={active != null}
          x={active != null ? margin.left + x(active) : 0}
          y={active != null && last?.values[active] != null ? margin.top + y(last.values[active] as number) : margin.top + innerH / 2}
          bounds={{ width, height }}
        >
          {active != null && (
            <>
              <TooltipHeader aside="climatology">{MONTHS_LONG[active]}</TooltipHeader>
              <TooltipRows>
                {[...prepared].reverse().map((p) => (
                  <TooltipRow
                    key={p.id}
                    color={p.color}
                    value={p.values[active] == null ? "missing" : formatValue(p.values[active], unit, decimals)}
                    missing={p.values[active] == null}
                    label={p.label}
                  />
                ))}
              </TooltipRows>
              {activeDelta != null && (
                <TooltipNote>
                  Change <strong className="num">{formatValue(activeDelta, unit, decimals, { signed: true })}</strong> ({last.label} vs {first.label})
                </TooltipNote>
              )}
            </>
          )}
        </ChartTooltip>
      </div>
      <DataTable caption={ariaLabel} columns={table.cols} rows={table.rows} />
      <LiveRegion text={liveText} />
    </div>
  );
}
