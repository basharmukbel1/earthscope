import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { useChartSize } from "./useChartSize";
import { AxisTitle, LinearXAxis, ValueAxis, leftMarginFor, valueTicks, type Margin } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { DataTable } from "./DataTable";
import { C } from "./palette";
import { formatNumber, formatP, formatR, formatSig, formatTick, formatValue } from "./format";
import { clamp, localPoint, useChartMotion, useSafeId } from "./utils";
import "./charts.css";

export interface ScatterPoint {
  x: number;
  y: number;
  label?: string;
}

export interface ScatterFit {
  slope: number;
  intercept: number;
  r: number;
  p: number;
  n: number;
}

export interface ScatterChartProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  fit?: ScatterFit | null;
  /** Significance threshold for the fit (default 0.05): solid line if p < alpha, dashed otherwise. */
  alpha?: number;
  xDecimals?: number;
  yDecimals?: number;
  /** Total SVG height including axes (default 320). */
  height?: number;
  color?: string;
  ariaLabel: string;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xUnit,
  yUnit,
  fit = null,
  alpha = 0.05,
  xDecimals = 1,
  yDecimals = 1,
  height = 320,
  color = C.primary,
  ariaLabel,
  className,
}: ScatterChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height });
  const uid = useSafeId("sp");
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  /** Points ordered by x so the keyboard walks left → right. */
  const pts = useMemo(
    () => points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x),
    [points],
  );

  const geo = useMemo(() => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // pad 6%, but never push non-negative data below zero
    const pad = (lo: number, hi: number) => {
      const s = hi - lo || Math.abs(hi) || 1;
      return [lo >= 0 ? Math.max(0, lo - s * 0.06) : lo - s * 0.06, hi + s * 0.06] as [number, number];
    };
    const xd = pad(xs.length ? Math.min(...xs) : 0, xs.length ? Math.max(...xs) : 1);
    const yd = pad(ys.length ? Math.min(...ys) : 0, ys.length ? Math.max(...ys) : 1);
    const innerHGuess = height - 24 - 46;
    const y0 = scaleLinear().domain(yd).range([innerHGuess, 0]).nice(Math.max(2, Math.floor(innerHGuess / 46)));
    const yt = valueTicks(y0, innerHGuess);
    const margin: Margin = { top: 24, right: 16, bottom: 46, left: leftMarginFor(yt.ticks.map((v) => formatTick(v, yt.step))) };
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = Math.max(10, height - margin.top - margin.bottom);
    const xCount = Math.max(2, Math.min(8, Math.floor(innerW / 80)));
    const x = scaleLinear().domain(xd).range([0, innerW]).nice(xCount);
    const y = y0.copy().range([innerH, 0]);
    const xTicks = x.ticks(xCount);
    const xStep = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : 1;
    return { x, y, yt, xTicks, xStep, margin, innerW, innerH };
  }, [pts, height, width]);
  const { x, y, yt, xTicks, xStep, margin, innerW, innerH } = geo;

  /** Density-aware opacity: points in crowded 10px cells fade so structure shows. */
  const marks = useMemo(() => {
    const cell = 10;
    const counts = new Map<string, number>();
    const keyFor = (p: ScatterPoint) => `${Math.floor(x(p.x) / cell)}:${Math.floor(y(p.y) / cell)}`;
    for (const p of pts) counts.set(keyFor(p), (counts.get(keyFor(p)) ?? 0) + 1);
    const r = pts.length > 250 ? 3 : pts.length > 80 ? 3.5 : 4.5;
    return pts.map((p) => ({ cx: x(p.x), cy: y(p.y), r, o: clamp(0.95 / Math.sqrt(counts.get(keyFor(p)) ?? 1), 0.32, 0.92) }));
  }, [pts, x, y]);

  const sig = fit ? fit.p < alpha : false;

  /** Put the stats card in the emptiest corner. */
  const card = useMemo(() => {
    if (!fit) return null;
    const w = 164;
    const h = 62;
    const corners = [
      { x: 8, y: 8 },
      { x: innerW - w - 8, y: 8 },
      { x: 8, y: innerH - h - 8 },
      { x: innerW - w - 8, y: innerH - h - 8 },
    ];
    const score = (c: { x: number; y: number }) => {
      let n = 0;
      for (const m of marks) if (m.cx > c.x - 6 && m.cx < c.x + w + 6 && m.cy > c.y - 6 && m.cy < c.y + h + 6) n++;
      const fy0 = y(fit.intercept + fit.slope * x.invert(c.x));
      const fy1 = y(fit.intercept + fit.slope * x.invert(c.x + w));
      const crosses = Math.max(fy0, fy1) > c.y && Math.min(fy0, fy1) < c.y + h;
      return n + (crosses ? 8 : 0);
    };
    const best = corners.reduce((a, b) => (score(b) < score(a) ? b : a));
    return { ...best, w, h };
  }, [fit, marks, innerW, innerH, x, y]);

  const setActive = useCallback((i: number | null) => {
    if (activeRef.current === i) return;
    activeRef.current = i;
    setActiveRaw(i);
  }, []);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e.currentTarget, e);
    const px = p.x - margin.left;
    const py = p.y - margin.top;
    let best = -1;
    let bd = 28 * 28;
    marks.forEach((m, i) => {
      const d = (m.cx - px) ** 2 + (m.cy - py) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setActive(best >= 0 ? best : null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = pts.length;
    if (!n) return;
    const cur = activeRef.current ?? 0;
    const map: Record<string, number | null> = {
      ArrowRight: Math.min(n - 1, cur + 1),
      ArrowUp: Math.min(n - 1, cur + 1),
      ArrowLeft: Math.max(0, cur - 1),
      ArrowDown: Math.max(0, cur - 1),
      Home: 0,
      End: n - 1,
      Escape: null,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    setActive(map[e.key]);
  };

  const fitSeg = useMemo(() => {
    if (!fit || !pts.length) return null;
    // the fitted line spans the observed x-range only (no extrapolation)
    const a = pts[0].x;
    const b = pts[pts.length - 1].x;
    return { x1: x(a), y1: y(fit.intercept + fit.slope * a), x2: x(b), y2: y(fit.intercept + fit.slope * b) };
  }, [fit, pts, x, y]);

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    return (
      <g>
        <defs>
          <clipPath id={`${uid}-clip`}>
            <rect x={0} y={0} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        <ValueAxis scale={y} width={innerW} ticks={yt.ticks} step={yt.step} />
        <LinearXAxis scale={x} y={innerH} ticks={xTicks} step={xStep} gridTop={0} />
        <AxisTitle x={-margin.left} y={-margin.top + 11} label={yLabel} unit={yUnit} />
        <AxisTitle x={innerW} y={innerH + 40} label={xLabel} unit={xUnit} anchor="end" />
        <motion.g
          initial={animate ? { opacity: 0, scale: 0.98 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: EASE }}
          style={{ originX: 0.5, originY: 0.5 }}
        >
          {marks.map((m, i) => (
            <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={color} fillOpacity={m.o} stroke="var(--color-surface)" strokeWidth={1} strokeOpacity={0.9} />
          ))}
        </motion.g>
        {fit && fitSeg && (
          <g clipPath={`url(#${uid}-clip)`}>
            <line {...fitSeg} stroke="var(--color-surface)" strokeWidth={5} opacity={0.8} />
            {animate ? (
              <motion.line
                {...fitSeg}
                stroke={C.ink}
                strokeWidth={1.75}
                strokeDasharray={sig ? undefined : "7 5"}
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.5 }}
              />
            ) : (
              <line {...fitSeg} stroke={C.ink} strokeWidth={1.75} strokeDasharray={sig ? undefined : "7 5"} strokeLinecap="round" />
            )}
          </g>
        )}
        {fit && card && (
          <motion.g
            initial={animate ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: animate ? 0.8 : 0 }}
          >
            <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={8} className="es-label-plate" />
            <circle
              cx={card.x + 14}
              cy={card.y + 17}
              r={3.5}
              fill={sig ? C.ink : "none"}
              stroke={C.ink}
              strokeWidth={1.5}
            />
            <text className="es-value-label" x={card.x + 24} y={card.y + 21} style={{ fontSize: 13 }} fontWeight={500}>
              r = {formatR(fit.r)}
            </text>
            <text className="es-tick" x={card.x + card.w - 10} y={card.y + 20} textAnchor="end" style={{ fontSize: 9.5 }}>
              {sig ? "SIGNIFICANT" : "NOT SIG."}
            </text>
            <text className="es-tick es-tick-strong" x={card.x + 10} y={card.y + 39} style={{ fontSize: 10.5 }}>
              {formatP(fit.p)} · n = {formatNumber(fit.n, 0)}
            </text>
            <text className="es-tick" x={card.x + 10} y={card.y + 54} style={{ fontSize: 10 }}>
              y = {formatSig(fit.slope, 3)}x {fit.intercept < 0 ? "−" : "+"} {formatSig(Math.abs(fit.intercept), 3)}
            </text>
          </motion.g>
        )}
      </g>
    );
  }, [ready, uid, innerW, innerH, x, y, yt, xTicks, xStep, margin, yLabel, yUnit, xLabel, xUnit, animate, marks, color, fit, fitSeg, sig, card]);

  const ap = active != null ? pts[active] : null;
  const am = active != null ? marks[active] : null;
  const resid = ap && fit ? ap.y - (fit.intercept + fit.slope * ap.x) : null;
  const liveText = ap
    ? `${ap.label ?? `Point ${active! + 1}`}: ${xLabel} ${formatValue(ap.x, xUnit, xDecimals)}, ${yLabel} ${formatValue(ap.y, yUnit, yDecimals)}`
    : "";

  const table = useMemo(
    () => ({
      cols: ["Observation", `${xLabel} (${xUnit})`, `${yLabel} (${yUnit})`],
      rows: pts.map((p, i) => [p.label ?? `Point ${i + 1}`, formatNumber(p.x, xDecimals), formatNumber(p.y, yDecimals)]),
    }),
    [pts, xLabel, xUnit, yLabel, yUnit, xDecimals, yDecimals],
  );

  const fitText = fit ? `. Fitted line: r = ${formatR(fit.r)}, ${formatP(fit.p)}, n = ${fit.n}, ${sig ? "significant" : "not significant"} at alpha ${alpha}` : "";

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}${fitText}. Use arrow keys to step through points.`}
        tabIndex={0}
        style={{ height }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null && pts.length) setActive(0);
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {staticLayer}
              {am && (
                <g pointerEvents="none">
                  <line x1={am.cx} x2={am.cx} y1={am.cy} y2={innerH} stroke={C.active} strokeOpacity={0.35} />
                  <line x1={0} x2={am.cx} y1={am.cy} y2={am.cy} stroke={C.active} strokeOpacity={0.35} />
                  <circle cx={am.cx} cy={am.cy} r={am.r + 4} fill="none" stroke={C.active} strokeWidth={1.5} />
                  <circle cx={am.cx} cy={am.cy} r={am.r} fill={color} stroke="var(--color-surface)" strokeWidth={1.5} />
                </g>
              )}
            </g>
          </svg>
        )}
        <ChartTooltip
          open={!!ap}
          x={am ? margin.left + am.cx : 0}
          y={am ? margin.top + am.cy : 0}
          bounds={{ width, height }}
          placement="above"
          offset={12}
          anchorSize={0}
        >
          {ap && (
            <>
              <TooltipHeader>{ap.label ?? `Point ${active! + 1}`}</TooltipHeader>
              <TooltipRows>
                <TooltipRow kind="none" value={formatValue(ap.x, xUnit, xDecimals)} label={xLabel} />
                <TooltipRow kind="none" value={formatValue(ap.y, yUnit, yDecimals)} label={yLabel} />
              </TooltipRows>
              {resid != null && (
                <TooltipNote>
                  <strong className="num">{formatValue(resid, yUnit, yDecimals, { signed: true })}</strong> from the fitted line
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
