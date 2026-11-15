import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import type { Point } from "../../types/domain";
import { useChartSize } from "./useChartSize";
import { AxisTitle, TimeAxis, ValueAxis, crisp, leftMarginFor, timeTicks, valueTicks, type Margin } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipRow, TooltipRows } from "./ChartTooltip";
import { ChartLegend, type LegendItem } from "./Legend";
import { DataTable } from "./DataTable";
import { C, DIVERGING } from "./palette";
import { formatDateString, formatDecimalYear, formatTick, formatValue } from "./format";
import { annotWidth, barGeometry, clamp, localPoint, nearestIndex, roundedBarPath, useChartMotion, useSafeId } from "./utils";
import type { TimeMarker } from "./TimeSeriesChart";
import "./charts.css";

export interface AnomalyChartProps {
  /** Anomalies relative to a baseline (monthly or annual). */
  points: Point[];
  /** Optional smoothing overlay (e.g. 12-month or 5-year running mean). */
  movingAverage?: Point[];
  movingAverageLabel?: string;
  yLabel: string;
  unit: string;
  decimals?: number;
  /** Total SVG height including axes (default 260). */
  height?: number;
  /** Text on the zero line, e.g. "1991–2020 mean". */
  baselineLabel?: string;
  positiveLabel?: string;
  negativeLabel?: string;
  /** Override the neutral diverging pair (never use rise/fall here). */
  positiveColor?: string;
  negativeColor?: string;
  markers?: TimeMarker[];
  showMissing?: boolean;
  onHoverDate?: (t: number | null) => void;
  ariaLabel: string;
  showLegend?: boolean;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function AnomalyChart({
  points,
  movingAverage,
  movingAverageLabel = "Running mean",
  yLabel,
  unit,
  decimals = 2,
  height = 260,
  baselineLabel,
  positiveLabel = "Above baseline",
  negativeLabel = "Below baseline",
  positiveColor = DIVERGING.warm,
  negativeColor = DIVERGING.cool,
  markers = [],
  showMissing = false,
  onHoverDate,
  ariaLabel,
  showLegend = true,
  className,
}: AnomalyChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height });
  const uid = useSafeId("an");
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  const sorted = useMemo(() => [...points].sort((a, b) => a.t - b.t), [points]);
  const ma = useMemo(() => (movingAverage ? [...movingAverage].sort((a, b) => a.t - b.t) : undefined), [movingAverage]);
  const maByT = useMemo(() => new Map((ma ?? []).map((p) => [p.t.toFixed(5), p])), [ma]);
  const times = useMemo(() => sorted.map((p) => p.t), [sorted]);
  const step = useMemo(() => {
    if (times.length < 2) return 1;
    const d = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)] || 1;
  }, [times]);

  const geo = useMemo(() => {
    const t0 = times[0] ?? 0;
    const t1 = times[times.length - 1] ?? 1;
    const xDom: [number, number] = [t0 - step / 2, t1 + step / 2];
    let lo = 0;
    let hi = 0;
    for (const p of sorted) if (p.v != null && Number.isFinite(p.v)) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    for (const p of ma ?? []) if (p.v != null && Number.isFinite(p.v)) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo;
    const topPad = markers.length ? 30 : 24;
    const y0 = scaleLinear().domain([lo - span * 0.05, hi + span * 0.05]).range([height - 26 - topPad, 0]).nice(Math.max(2, Math.floor((height - 50) / 44)));
    const yt = valueTicks(y0, height - 50, 44);
    const margin: Margin = { top: topPad, right: 16, bottom: 26, left: leftMarginFor(yt.ticks.map((v) => formatTick(v, yt.step))) };
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = Math.max(10, height - margin.top - margin.bottom);
    const x = scaleLinear().domain(xDom).range([0, innerW]);
    const y = y0.copy().range([innerH, 0]);
    return { x, y, yt, xt: timeTicks(xDom, innerW, width < 480 ? 52 : 68), margin, innerW, innerH };
  }, [times, step, sorted, ma, markers.length, height, width]);
  const { x, y, yt, xt, margin, innerW, innerH } = geo;

  const bar = useMemo(
    () => barGeometry(innerW, Math.max(1, Math.round((x.domain()[1] - x.domain()[0]) / step))),
    [innerW, x, step],
  );

  const bars = useMemo(() => {
    let pos = "";
    let neg = "";
    const zy = y(0);
    const r = bar.width >= 6 ? 3 : bar.width >= 3 ? 1 : 0;
    for (const p of sorted) {
      if (p.v == null || !Number.isFinite(p.v) || p.v === 0) continue;
      const d = roundedBarPath(x(p.t) - bar.width / 2, bar.width, zy, y(p.v), r);
      if (p.v > 0) pos += d;
      else neg += d;
    }
    return { pos, neg };
  }, [sorted, x, y, bar.width]);

  const maPath = useMemo(
    () =>
      ma
        ? d3line<Point>()
            .defined((p) => p.v != null && Number.isFinite(p.v))
            .x((p) => x(p.t))
            .y((p) => y(p.v as number))(ma) ?? ""
        : "",
    [ma, x, y],
  );

  const missingRuns = useMemo(() => {
    if (!showMissing) return [] as { x0: number; x1: number }[];
    const runs: { x0: number; x1: number }[] = [];
    let start: number | null = null;
    sorted.forEach((p, i) => {
      const miss = p.v == null || !Number.isFinite(p.v);
      if (miss && start == null) start = p.t;
      const last = i === sorted.length - 1;
      if ((!miss || last) && start != null) {
        const end = miss ? p.t : sorted[i - 1].t;
        runs.push({ x0: clamp(x(start - step / 2), 0, innerW), x1: clamp(x(end + step / 2), 0, innerW) });
        start = null;
      }
    });
    return runs;
  }, [showMissing, sorted, x, step, innerW]);

  /* interaction */
  const setActive = useCallback(
    (i: number | null) => {
      if (activeRef.current === i) return;
      activeRef.current = i;
      setActiveRaw(i);
      onHoverDate?.(i == null ? null : times[i] ?? null);
    },
    [onHoverDate, times],
  );
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!times.length) return;
    const p = localPoint(e.currentTarget, e);
    setActive(nearestIndex(times, x.invert(p.x - margin.left)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = times.length;
    if (!n) return;
    const cur = activeRef.current ?? n - 1;
    const jump = e.shiftKey ? Math.max(1, Math.round(1 / step)) : 1;
    const map: Record<string, number | null> = {
      ArrowRight: Math.min(n - 1, cur + jump),
      ArrowLeft: Math.max(0, cur - jump),
      Home: 0,
      End: n - 1,
      Escape: null,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    setActive(map[e.key]);
  };

  const activePoint = active != null ? sorted[active] : null;
  const activeMa = activePoint ? maByT.get(activePoint.t.toFixed(5))?.v ?? null : null;
  const fmtDate = (p: Point) => (p.date ? formatDateString(p.date) : formatDecimalYear(p.t, step >= 0.99 ? "year" : "month"));
  const sideLabel = (v: number | null) => (v == null ? "missing" : v > 0 ? positiveLabel : v < 0 ? negativeLabel : "At baseline");

  const legendItems: LegendItem[] = [
    { id: "pos", label: positiveLabel, kind: "rect", color: positiveColor },
    { id: "neg", label: negativeLabel, kind: "rect", color: negativeColor },
    ...(ma ? [{ id: "ma", label: movingAverageLabel, kind: "line" as const, color: C.ink }] : []),
    ...(markers.length ? [{ id: "mk", label: "Annotation", kind: "marker" as const, color: C.warn }] : []),
    ...(missingRuns.length ? [{ id: "miss", label: "Missing data", kind: "hatch" as const }] : []),
  ];

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    const zy = crisp(y(0));
    return (
      <g>
        <defs>
          <pattern id={`${uid}-hatch`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={4} stroke="var(--color-ink-4)" strokeWidth={1.5} />
          </pattern>
        </defs>
        <ValueAxis scale={y} width={innerW} ticks={yt.ticks} step={yt.step} strongZero format={(v) => formatTick(v, yt.step).replace(/^(\d)/, v > 0 ? "+$1" : "$1")} />
        <TimeAxis scale={x} y={innerH} ticks={xt} />
        <AxisTitle x={-margin.left} y={-margin.top + 11} label={yLabel} unit={unit} />
        {missingRuns.map((r, i) => (
          <g key={i}>
            <rect x={r.x0} y={0} width={Math.max(1, r.x1 - r.x0)} height={innerH} fill="var(--color-missing)" opacity={0.14} />
            <rect x={r.x0} y={innerH - 6} width={Math.max(1.5, r.x1 - r.x0)} height={6} fill={`url(#${uid}-hatch)`} />
          </g>
        ))}
        {markers.map((m, i) => {
          const mx = x(m.t);
          if (mx < 0 || mx > innerW) return null;
          const w = annotWidth(m.label);
          const left = mx + 6 + w > innerW ? mx - 6 - w : mx + 6;
          return (
            <g key={`mk${i}`}>
              <line x1={crisp(mx)} x2={crisp(mx)} y1={0} y2={innerH} stroke={C.lineBright} />
              <path d={`M${crisp(mx)} -4 l3.5 3.5 l-3.5 3.5 l-3.5 -3.5Z`} fill={C.warn} />
              <rect x={left} y={2 + (i % 2) * 16} width={w} height={14} rx={3} className="es-label-plate" />
              <text className="es-annot" x={left + 6} y={12 + (i % 2) * 16}>
                {m.label}
              </text>
            </g>
          );
        })}
        <g style={{ opacity: "var(--es-dim, 1)", transition: "opacity 160ms" }}>
        <motion.g
          style={{ originY: 1 }}
          initial={animate ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <path d={bars.pos} fill={positiveColor} />
        </motion.g>
        <motion.g
          style={{ originY: 0 }}
          initial={animate ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.9, ease: EASE }}
        >
          <path d={bars.neg} fill={negativeColor} />
        </motion.g>
        </g>
        <line x1={0} x2={innerW} y1={zy} y2={zy} stroke="var(--color-ink-3)" strokeOpacity={0.7} />
        {baselineLabel && (
          <text className="es-axis-title" x={innerW} y={-margin.top + 11} textAnchor="end">
            0 ={" "}
            <tspan className="es-axis-unit" style={{ textTransform: "none", letterSpacing: "0.04em" }}>
              {baselineLabel}
            </tspan>
          </text>
        )}
        {maPath && (
          <g>
            <path d={maPath} fill="none" stroke="var(--color-surface)" strokeWidth={5} opacity={0.8} strokeLinejoin="round" />
            {animate ? (
              <motion.path
                d={maPath}
                fill="none"
                stroke={C.ink}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ pathLength: { duration: 1.4, ease: EASE, delay: 0.5 }, opacity: { duration: 0.2, delay: 0.5 } }}
              />
            ) : (
              <path d={maPath} fill="none" stroke={C.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
          </g>
        )}
      </g>
    );
  }, [ready, x, y, yt, xt, innerW, innerH, margin, uid, yLabel, unit, missingRuns, markers, animate, bars, positiveColor, negativeColor, baselineLabel, maPath]);

  const cross =
    activePoint != null ? (
      <g pointerEvents="none">
        <line x1={crisp(x(activePoint.t))} x2={crisp(x(activePoint.t))} y1={0} y2={innerH} stroke={C.active} strokeOpacity={0.45} />
        {activePoint.v != null && activePoint.v !== 0 && (
          <path
            d={roundedBarPath(x(activePoint.t) - Math.max(bar.width, 3) / 2, Math.max(bar.width, 3), y(0), y(activePoint.v), bar.width >= 6 ? 3 : 1)}
            fill={activePoint.v > 0 ? positiveColor : negativeColor}
            stroke={C.ink}
            strokeWidth={1}
          />
        )}
        {activeMa != null && <circle cx={x(activePoint.t)} cy={y(activeMa)} r={3.5} fill={C.ink} stroke="var(--color-surface)" strokeWidth={2} />}
      </g>
    ) : null;

  const liveText = activePoint
    ? `${fmtDate(activePoint)}: ${formatValue(activePoint.v, unit, decimals, { signed: true })}, ${sideLabel(activePoint.v)}` +
      (activeMa != null ? `; ${movingAverageLabel} ${formatValue(activeMa, unit, decimals, { signed: true })}` : "")
    : "";

  const table = useMemo(
    () => ({
      cols: ["Date", `Anomaly (${unit})`, ...(ma ? [`${movingAverageLabel} (${unit})`] : [])],
      rows: sorted.map((p) => [
        fmtDate(p),
        p.v == null ? null : formatValue(p.v, undefined, decimals, { signed: true }),
        ...(ma ? [(() => { const v = maByT.get(p.t.toFixed(5))?.v; return v == null ? null : formatValue(v, undefined, decimals, { signed: true }); })()] : []),
      ]),
    }),
    [sorted, ma, maByT, unit, decimals, movingAverageLabel, step],
  );

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      {showLegend && <ChartLegend items={legendItems} label={`${yLabel} legend`} />}
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}. Use left and right arrow keys to read values.`}
        tabIndex={0}
        style={{ height, marginTop: showLegend ? 12 : 0 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null && times.length) setActive(times.length - 1);
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg
            width={width}
            height={height}
            aria-hidden="true"
            focusable="false"
            style={{ ["--es-dim" as string]: active != null ? 0.5 : 1 }}
          >
            <g transform={`translate(${margin.left},${margin.top})`}>
              {staticLayer}
              {cross}
            </g>
          </svg>
        )}
        <ChartTooltip
          open={!!activePoint}
          x={activePoint ? margin.left + x(activePoint.t) : 0}
          y={activePoint ? margin.top + (activePoint.v != null ? y(activePoint.v) : innerH / 2) : 0}
          bounds={{ width, height }}
        >
          {activePoint && (
            <>
              <TooltipHeader>{fmtDate(activePoint)}</TooltipHeader>
              <TooltipRows>
                <TooltipRow
                  kind="rect"
                  color={activePoint.v != null && activePoint.v < 0 ? negativeColor : positiveColor}
                  value={activePoint.v == null ? "missing" : formatValue(activePoint.v, unit, decimals, { signed: true })}
                  missing={activePoint.v == null}
                  label={sideLabel(activePoint.v)}
                />
                {activeMa != null && (
                  <TooltipRow color={C.ink} value={formatValue(activeMa, unit, decimals, { signed: true })} label={movingAverageLabel} />
                )}
              </TooltipRows>
            </>
          )}
        </ChartTooltip>
      </div>
      <DataTable caption={ariaLabel} columns={table.cols} rows={table.rows} />
      <LiveRegion text={liveText} />
    </div>
  );
}
