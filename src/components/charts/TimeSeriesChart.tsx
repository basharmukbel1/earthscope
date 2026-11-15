import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import type { Point, TrendDirection } from "../../types/domain";
import { useChartSize } from "./useChartSize";
import { AxisTitle, TimeAxis, ValueAxis, crisp, leftMarginFor, timeTicks, valueTicks, type Margin } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { ChartLegend, type LegendItem } from "./Legend";
import { DataTable } from "./DataTable";
import { C, TREND_GLYPH, seriesColor, trendColor } from "./palette";
import { EN_DASH, formatDateString, formatDecimalYear, formatTick, formatValue } from "./format";
import { annotWidth, barGeometry, clamp, localPoint, monoWidth, nearestIndex, roundedBarPath, useChartMotion, useSafeId } from "./utils";
import "./charts.css";

export type SeriesVariant = "line" | "dots" | "area" | "bars";

export interface TimeSeriesSpec {
  id: string;
  label: string;
  points: Point[];
  color?: string;
  variant?: SeriesVariant;
  /** Context series: drawn quietly behind the others. */
  dimmed?: boolean;
}

export interface TrendOverlay {
  slopePerYear: number;
  /** Value at t = 0 (decimal year); fitted line = intercept + slopePerYear · t. */
  intercept: number;
  /** Slope confidence interval (units / year). */
  ciLow: number;
  ciHigh: number;
  significant: boolean;
  label: string;
  direction: TrendDirection;
  /** Pivot of the CI fan; defaults to the mean t of the observed primary series. */
  meanT?: number;
}

export interface TimeMarker {
  t: number;
  label: string;
}

export interface TimeSeriesChartProps {
  series: TimeSeriesSpec[];
  trend?: TrendOverlay | null;
  movingAverage?: Point[];
  /** Legend / tooltip label of the moving average (default "Moving average"). */
  movingAverageLabel?: string;
  markers?: TimeMarker[];
  yLabel: string;
  unit: string;
  decimals?: number;
  /** Total SVG height including axes (default 300). */
  height?: number;
  zeroLine?: boolean;
  showMissing?: boolean;
  onHoverDate?: (t: number | null) => void;
  ariaLabel: string;
  /** Built-in legend row (default true; hidden automatically for a lone plain series). */
  showLegend?: boolean;
  /** Label for the CI fan in the legend (default "95% CI of slope"). */
  ciLabel?: string;
  yDomain?: [number, number];
  className?: string;
}

const keyOf = (t: number) => t.toFixed(5);
const EASE = [0.16, 1, 0.3, 1] as const;

interface StrokeProps {
  stroke: string;
  strokeWidth: number;
  strokeLinejoin?: "round";
  strokeLinecap?: "round";
}

interface PreparedSeries extends TimeSeriesSpec {
  color: string;
  variant: SeriesVariant;
  byT: Map<string, Point>;
  observed: Point[];
}

export function TimeSeriesChart({
  series,
  trend = null,
  movingAverage,
  movingAverageLabel = "Moving average",
  markers = [],
  yLabel,
  unit,
  decimals = 1,
  height = 300,
  zeroLine = false,
  showMissing = false,
  onHoverDate,
  ariaLabel,
  showLegend = true,
  ciLabel = "95% CI of slope",
  yDomain,
  className,
}: TimeSeriesChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height });
  const uid = useSafeId("ts");
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  /* ------------------------------------------------------------ data */
  const prepared = useMemo<PreparedSeries[]>(() => {
    // Categorical slots go, in order, to the peer series that need one;
    // dimmed context series default to the de-emphasis ink.
    const peers = series.filter((s) => !s.dimmed && !s.color);
    return series.map((s) => {
        const pts = [...s.points].sort((a, b) => a.t - b.t);
        return {
          ...s,
          points: pts,
          color: s.color ?? (s.dimmed ? C.ink3 : seriesColor(peers.indexOf(s), peers.length)),
          variant: s.variant ?? "line",
          byT: new Map(pts.map((p) => [keyOf(p.t), p])),
          observed: pts.filter((p) => p.v != null && Number.isFinite(p.v)),
        };
    });
  }, [series]);
  const primary = prepared.find((s) => !s.dimmed) ?? prepared[0];

  const maSorted = useMemo(() => (movingAverage ? [...movingAverage].sort((a, b) => a.t - b.t) : undefined), [movingAverage]);
  const maByT = useMemo(() => new Map((maSorted ?? []).map((p) => [keyOf(p.t), p])), [maSorted]);

  const times = useMemo(() => {
    const set = new Map<string, number>();
    for (const s of prepared) for (const p of s.points) set.set(keyOf(p.t), p.t);
    return [...set.values()].sort((a, b) => a - b);
  }, [prepared]);

  const step = useMemo(() => {
    if (times.length < 2) return 1;
    const diffs = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 1;
  }, [times]);

  const hasBars = prepared.some((s) => s.variant === "bars");

  const trendGeom = useMemo(() => {
    if (!trend || !primary || primary.observed.length < 2) return null;
    const t0 = primary.observed[0].t;
    const t1 = primary.observed[primary.observed.length - 1].t;
    const meanT = trend.meanT ?? primary.observed.reduce((a, p) => a + p.t, 0) / primary.observed.length;
    const f = (t: number) => trend.intercept + trend.slopePerYear * t;
    const yM = f(meanT);
    const lo = (t: number) => yM + trend.ciLow * (t - meanT);
    const hi = (t: number) => yM + trend.ciHigh * (t - meanT);
    return { t0, t1, meanT, f, yM, lo, hi };
  }, [trend, primary]);

  /* ---------------------------------------------------------- scales */
  const geo = useMemo(() => {
    const xMin = times.length ? times[0] : 0;
    const xMax = times.length ? times[times.length - 1] : 1;
    const pad = hasBars ? step / 2 : 0;
    const xDom: [number, number] = [xMin - pad, xMax + pad === xMin - pad ? xMax + 1 : xMax + pad];

    let lo = Infinity;
    let hi = -Infinity;
    const take = (v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    };
    if (yDomain) {
      [lo, hi] = yDomain;
    } else {
      for (const s of prepared) for (const p of s.observed) take(p.v);
      for (const p of maSorted ?? []) take(p.v);
      if (trendGeom) {
        take(trendGeom.f(trendGeom.t0));
        take(trendGeom.f(trendGeom.t1));
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      const nonNegative = lo >= 0;
      if (zeroLine || hasBars) take(0);
      const span = hi - lo || Math.abs(hi) || 1;
      lo -= span * 0.06;
      hi += span * 0.06;
      // never invent negative room for non-negative data (bars sit on 0)
      if (nonNegative && lo < 0) lo = 0;
    }

    const topPad = markers.length ? 30 : 24;
    const tmpY = scaleLinear().domain([lo, hi]).range([height - 26 - topPad, 0]);
    if (!yDomain) tmpY.nice(Math.max(2, Math.floor((height - 50) / 46)));
    const yt = valueTicks(tmpY, height - 50);
    const labels = yt.ticks.map((v) => formatTick(v, yt.step));
    const margin: Margin = { top: topPad, right: 16, bottom: 26, left: leftMarginFor(labels) };
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = Math.max(10, height - margin.top - margin.bottom);
    const x = scaleLinear().domain(xDom).range([0, innerW]);
    const y = tmpY.copy().range([innerH, 0]);
    const xt = timeTicks(xDom, innerW, width < 480 ? 52 : 68);
    return { x, y, xt, yt, margin, innerW, innerH };
  }, [times, step, hasBars, prepared, maSorted, trendGeom, zeroLine, yDomain, markers.length, height, width]);

  const { x, y, xt, yt, margin, innerW, innerH } = geo;

  /* ----------------------------------------------------------- paths */
  const paths = useMemo(() => {
    const lineGen = d3line<Point>()
      .defined((p) => p.v != null && Number.isFinite(p.v))
      .x((p) => x(p.t))
      .y((p) => y(p.v as number));
    const baseV = y.domain()[0] <= 0 && y.domain()[1] >= 0 ? 0 : y.domain()[0];
    const areaGen = d3area<Point>()
      .defined((p) => p.v != null && Number.isFinite(p.v))
      .x((p) => x(p.t))
      .y0(y(y.domain()[0]))
      .y1((p) => y(p.v as number));
    const bar = barGeometry(innerW, times.length);
    return prepared.map((s) => {
      const density = s.points.length / Math.max(1, innerW);
      const isolated = s.points.filter((p, i, arr) => {
        if (p.v == null) return false;
        const prev = arr[i - 1];
        const next = arr[i + 1];
        return (!prev || prev.v == null) && (!next || next.v == null);
      });
      return {
        id: s.id,
        line: lineGen(s.points) ?? "",
        area: s.variant === "area" ? areaGen(s.points) ?? "" : "",
        bars:
          s.variant === "bars"
            ? s.observed
                .map((p) => roundedBarPath(x(p.t) - bar.width / 2, bar.width, y(baseV), y(p.v as number), 3))
                .join("")
            : "",
        strokeWidth: density > 0.35 ? 1.5 : 2,
        dotR: clamp((innerW / Math.max(1, s.points.length)) * 0.32, 1.6, 4),
        isolated,
      };
    });
  }, [prepared, x, y, innerW, times.length]);

  const maPath = useMemo(() => {
    if (!maSorted) return "";
    return (
      d3line<Point>()
        .defined((p) => p.v != null && Number.isFinite(p.v))
        .x((p) => x(p.t))
        .y((p) => y(p.v as number))(maSorted) ?? ""
    );
  }, [maSorted, x, y]);

  /* missing runs (primary + any non-dimmed series) */
  const missingRuns = useMemo(() => {
    if (!showMissing) return [] as { x0: number; x1: number; n: number }[];
    const runs: { x0: number; x1: number; n: number }[] = [];
    for (const s of prepared) {
      if (s.dimmed) continue;
      let start: number | null = null;
      let count = 0;
      s.points.forEach((p, i) => {
        const miss = p.v == null || !Number.isFinite(p.v);
        if (miss) {
          if (start == null) start = p.t;
          count++;
        }
        const last = i === s.points.length - 1;
        if ((!miss || last) && start != null) {
          const end = miss ? p.t : s.points[i - 1].t;
          runs.push({ x0: x(start - step / 2), x1: x(end + step / 2), n: count });
          start = null;
          count = 0;
        }
      });
    }
    return runs.map((r) => ({ ...r, x0: clamp(r.x0, 0, innerW), x1: clamp(r.x1, 0, innerW) }));
  }, [showMissing, prepared, x, step, innerW]);

  /* ------------------------------------------------------ interaction */
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
    const t = x.invert(p.x - margin.left);
    setPointerY(p.y);
    setActive(nearestIndex(times, t));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!times.length) return;
    const n = times.length;
    const cur = active ?? n - 1;
    const jump = e.shiftKey ? Math.max(1, Math.round(1 / step)) : 1;
    let next: number | null = cur;
    switch (e.key) {
      case "ArrowRight":
        next = Math.min(n - 1, cur + jump);
        break;
      case "ArrowLeft":
        next = Math.max(0, cur - jump);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = n - 1;
        break;
      case "Escape":
        next = null;
        break;
      default:
        return;
    }
    e.preventDefault();
    setPointerY(null);
    setActive(next);
  };

  const activeT = active != null ? times[active] : null;
  const readout = useMemo(() => {
    if (activeT == null) return null;
    const k = keyOf(activeT);
    const src = prepared.map((s) => s.byT.get(k)).find(Boolean);
    const date = src ? formatDateString(src.date) : formatDecimalYear(activeT);
    const rows = prepared.map((s) => {
      const p = s.byT.get(k);
      const v = p?.v ?? null;
      return { id: s.id, label: s.label, color: s.color, v, has: !!p, dimmed: !!s.dimmed };
    });
    const ma = maByT.get(k)?.v ?? null;
    const fit = trendGeom && activeT >= trendGeom.t0 && activeT <= trendGeom.t1 ? trendGeom.f(activeT) : null;
    const primaryV = primary?.byT.get(k)?.v ?? null;
    return { date, rows, ma, fit, primaryV };
  }, [activeT, prepared, primary, maByT, trendGeom]);

  const liveText = readout
    ? `${readout.date}. ` +
      readout.rows
        .filter((r) => r.has)
        .map((r) => `${r.label}: ${r.v == null ? "missing" : formatValue(r.v, unit, decimals)}`)
        .join("; ") +
      (readout.ma != null ? `; ${movingAverageLabel}: ${formatValue(readout.ma, unit, decimals)}` : "") +
      (readout.fit != null ? `; trend fit: ${formatValue(readout.fit, unit, decimals)}` : "")
    : "";

  /* ----------------------------------------------------------- legend */
  const legendItems = useMemo<LegendItem[]>(() => {
    const items: LegendItem[] = [];
    const plainSingle = prepared.length === 1 && !trend && !maSorted && !markers.length && !missingRuns.length;
    if (plainSingle) return items;
    for (const s of prepared) {
      items.push({
        id: `s-${s.id}`,
        label: s.label,
        kind: s.variant === "bars" ? "rect" : s.variant === "area" ? "area" : s.variant === "dots" ? "dot" : "line",
        color: s.color,
        note: s.dimmed ? "context" : undefined,
      });
    }
    if (maSorted) items.push({ id: "ma", label: movingAverageLabel, kind: "line", color: C.ink });
    if (trend) {
      const tc = trendColor(trend.direction);
      items.push({
        id: "trend",
        label: "Linear trend",
        kind: trend.significant ? "line" : "dashed",
        color: tc,
        glyph: TREND_GLYPH[trend.direction],
        note: trend.significant ? "significant" : "not significant",
      });
      items.push({ id: "ci", label: ciLabel, kind: "fan", color: tc });
    }
    if (markers.length) items.push({ id: "mk", label: "Annotation", kind: "marker", color: C.warn });
    if (missingRuns.length) items.push({ id: "miss", label: "Missing data", kind: "hatch" });
    return items;
  }, [prepared, trend, maSorted, markers.length, missingRuns.length, movingAverageLabel, ciLabel]);

  /* ------------------------------------------------------ static layer */
  const staticLayer = useMemo(() => {
    if (!ready) return null;
    const tc = trend ? trendColor(trend.direction) : C.flat;
    const zeroIn = y.domain()[0] < 0 && y.domain()[1] > 0;

    // marker label layout (stagger when they would collide)
    const markerLayout: { x: number; row: number; anchorEnd: boolean; w: number; label: string }[] = [];
    [...markers]
      .sort((a, b) => a.t - b.t)
      .forEach((m) => {
        const mx = x(m.t);
        if (mx < -1 || mx > innerW + 1) return;
        const w = annotWidth(m.label);
        const anchorEnd = mx + 6 + w > innerW;
        const left = anchorEnd ? mx - 6 - w : mx + 6;
        let row = 0;
        while (markerLayout.some((o) => o.row === row && !(left > (o.anchorEnd ? o.x - 6 : o.x + 6 + o.w) + 6 || left + w < (o.anchorEnd ? o.x - 6 - o.w : o.x) - 6))) row++;
        markerLayout.push({ x: mx, row, anchorEnd, w, label: m.label });
      });

    // trend label placement
    let trendLabel: null | { x: number; y: number; w: number; ex: number; ey: number; above: boolean } = null;
    if (trend && trendGeom) {
      const ex = x(trendGeom.t1);
      const ey = y(trendGeom.f(trendGeom.t1));
      const w = monoWidth(trend.label, 10.5) + 30;
      const above = ey > innerH * 0.45;
      const ly = above ? Math.max(14, ey - 34) : Math.min(innerH - 12, ey + 34);
      trendLabel = { x: Math.max(0, Math.min(innerW - w, ex - w + 8)), y: ly, w, ex, ey, above };
    }

    const drawLine = (d: string, key: string, props: StrokeProps, delay = 0) =>
      animate ? (
        <motion.path
          key={key}
          d={d}
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ pathLength: { duration: 1.5, ease: EASE, delay }, opacity: { duration: 0.2, delay } }}
          {...props}
        />
      ) : (
        <path key={key} d={d} fill="none" {...props} />
      );

    return (
      <g>
        <defs>
          <clipPath id={`${uid}-clip`}>
            <rect x={0} y={-2} width={innerW} height={innerH + 4} />
          </clipPath>
          <clipPath id={`${uid}-reveal`}>
            {animate ? (
              <motion.rect
                x={0}
                y={-20}
                height={innerH + 40}
                initial={{ width: 0 }}
                animate={{ width: innerW + 20 }}
                transition={{ duration: 1.4, ease: EASE }}
              />
            ) : (
              <rect x={0} y={-20} width={innerW + 20} height={innerH + 40} />
            )}
          </clipPath>
          <pattern id={`${uid}-hatch`} width={4} height={4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={4} stroke="var(--color-ink-4)" strokeWidth={1.5} />
          </pattern>
          {prepared.map((s) =>
            s.variant === "area" ? (
              <linearGradient key={s.id} id={`${uid}-grad-${s.id}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={s.dimmed ? 0.08 : 0.2} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ) : null,
          )}
        </defs>

        <ValueAxis scale={y} width={innerW} ticks={yt.ticks} step={yt.step} strongZero={zeroLine} />
        <TimeAxis scale={x} y={innerH} ticks={xt} />
        <AxisTitle x={-margin.left} y={-margin.top + 11} label={yLabel} unit={unit} />

        {/* missing data: faint full-height wash + hatched strip on the axis */}
        {missingRuns.map((r, i) => (
          <g key={`miss${i}`} aria-hidden="true">
            <rect x={r.x0} y={0} width={Math.max(1, r.x1 - r.x0)} height={innerH} fill="var(--color-missing)" opacity={0.14} />
            <rect x={r.x0} y={innerH - 6} width={Math.max(1.5, r.x1 - r.x0)} height={6} fill={`url(#${uid}-hatch)`} />
          </g>
        ))}

        {zeroLine && zeroIn && (
          <line x1={0} x2={innerW} y1={crisp(y(0))} y2={crisp(y(0))} stroke={C.axis} strokeWidth={1} />
        )}

        {/* annotation markers */}
        {markerLayout.map((m, i) => {
          const ly = 2 + m.row * 16;
          const left = m.anchorEnd ? m.x - 6 - m.w : m.x + 6;
          return (
            <g key={`mk${i}`} aria-hidden="true">
              <line x1={crisp(m.x)} x2={crisp(m.x)} y1={0} y2={innerH} stroke={C.lineBright} strokeWidth={1} />
              <path d={`M${crisp(m.x)} ${-4} l3.5 3.5 l-3.5 3.5 l-3.5 -3.5Z`} fill={C.warn} />
              <rect x={left} y={ly} width={m.w} height={14} rx={3} className="es-label-plate" />
              <text className="es-annot" x={left + 6} y={ly + 10}>
                {m.label}
              </text>
            </g>
          );
        })}

        {/* CI fan, pivoting at the mean time */}
        {trend && trendGeom && (
          <motion.g
            clipPath={`url(#${uid}-clip)`}
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: animate ? 1.1 : 0 }}
          >
            <path
              d={`M${x(trendGeom.t0)},${y(trendGeom.lo(trendGeom.t0))}L${x(trendGeom.meanT)},${y(trendGeom.yM)}L${x(trendGeom.t1)},${y(
                trendGeom.lo(trendGeom.t1),
              )}L${x(trendGeom.t1)},${y(trendGeom.hi(trendGeom.t1))}L${x(trendGeom.meanT)},${y(trendGeom.yM)}L${x(trendGeom.t0)},${y(
                trendGeom.hi(trendGeom.t0),
              )}Z`}
              fill={tc}
              opacity={0.11}
            />
            <path
              d={`M${x(trendGeom.t0)},${y(trendGeom.lo(trendGeom.t0))}L${x(trendGeom.t1)},${y(trendGeom.lo(trendGeom.t1))}M${x(
                trendGeom.t0,
              )},${y(trendGeom.hi(trendGeom.t0))}L${x(trendGeom.t1)},${y(trendGeom.hi(trendGeom.t1))}`}
              stroke={tc}
              strokeWidth={1}
              opacity={0.32}
              fill="none"
            />
          </motion.g>
        )}

        {/* series — dimmed context first */}
        {[...prepared]
          .map((s, i) => ({ s, p: paths[i] }))
          .sort((a, b) => Number(!!b.s.dimmed) - Number(!!a.s.dimmed))
          .map(({ s, p }, order) => {
            const op = s.dimmed ? 0.38 : maSorted ? 0.62 : 1;
            const sw = s.dimmed ? 1.25 : p.strokeWidth;
            const key = `${s.id}-${s.points.length}`;
            return (
              <g key={key} opacity={op}>
                {s.variant === "area" && (
                  <path d={p.area} fill={`url(#${uid}-grad-${s.id})`} clipPath={`url(#${uid}-reveal)`} />
                )}
                {s.variant === "bars" && (
                  <path d={p.bars} fill={s.color} fillOpacity={trend ? 0.5 : 0.8} clipPath={`url(#${uid}-reveal)`} />
                )}
                {s.variant === "dots" && (
                  <g clipPath={`url(#${uid}-reveal)`}>
                    {s.observed.map((pt) => (
                      <circle key={pt.t} cx={x(pt.t)} cy={y(pt.v as number)} r={p.dotR} fill={s.color} />
                    ))}
                  </g>
                )}
                {(s.variant === "line" || s.variant === "area") &&
                  drawLine(
                    p.line,
                    "l",
                    {
                      stroke: s.color,
                      strokeWidth: sw,
                      strokeLinejoin: "round",
                      strokeLinecap: "round",
                    },
                    order * 0.12,
                  )}
                {(s.variant === "line" || s.variant === "area") &&
                  p.isolated.map((pt) => (
                    <circle key={`iso${pt.t}`} cx={x(pt.t)} cy={y(pt.v as number)} r={Math.max(1.6, sw)} fill={s.color} />
                  ))}
              </g>
            );
          })}

        {/* moving average: surface under-stroke keeps it legible over raw data */}
        {maPath && (
          <g>
            <path d={maPath} fill="none" stroke="var(--color-surface)" strokeWidth={5} strokeLinejoin="round" opacity={0.75} />
            {drawLine(maPath, "ma", { stroke: C.ink, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }, 0.35)}
          </g>
        )}

        {/* fitted trend */}
        {trend && trendGeom && (
          <g clipPath={`url(#${uid}-clip)`}>
            <path
              d={`M${x(trendGeom.t0)},${y(trendGeom.f(trendGeom.t0))}L${x(trendGeom.t1)},${y(trendGeom.f(trendGeom.t1))}`}
              stroke="var(--color-surface)"
              strokeWidth={5}
              opacity={0.7}
              fill="none"
            />
            {trend.significant ? (
              drawLine(
                `M${x(trendGeom.t0)},${y(trendGeom.f(trendGeom.t0))}L${x(trendGeom.t1)},${y(trendGeom.f(trendGeom.t1))}`,
                "trend",
                { stroke: tc, strokeWidth: 2.25, strokeLinecap: "round" },
                0.7,
              )
            ) : (
              <motion.path
                d={`M${x(trendGeom.t0)},${y(trendGeom.f(trendGeom.t0))}L${x(trendGeom.t1)},${y(trendGeom.f(trendGeom.t1))}`}
                stroke={tc}
                strokeWidth={2}
                strokeDasharray="7 5"
                fill="none"
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: animate ? 0.9 : 0 }}
              />
            )}
          </g>
        )}
        {trend && trendLabel && (
          <motion.g
            initial={animate ? { opacity: 0, y: trendLabel.above ? 4 : -4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: animate ? 1.5 : 0 }}
            aria-hidden="true"
          >
            <line
              x1={trendLabel.ex}
              x2={trendLabel.ex}
              y1={trendLabel.above ? trendLabel.y + 9 : trendLabel.y - 9}
              y2={trendLabel.above ? trendLabel.ey - 6 : trendLabel.ey + 6}
              stroke={C.lineBright}
            />
            <rect x={trendLabel.x} y={trendLabel.y - 9} width={trendLabel.w} height={18} rx={9} className="es-label-plate" />
            <text x={trendLabel.x + 10} y={trendLabel.y} dy="0.35em" style={{ fontSize: 9 }} fill={tc}>
              {TREND_GLYPH[trend.direction]}
            </text>
            <text className="es-value-label" x={trendLabel.x + 23} y={trendLabel.y} dy="0.35em" style={{ fontSize: 10.5 }}>
              {trend.label}
            </text>
            <circle
              cx={trendLabel.ex}
              cy={trendLabel.ey}
              r={4}
              fill={trend.significant ? tc : "var(--color-surface)"}
              stroke={trend.significant ? "var(--color-surface)" : tc}
              strokeWidth={2}
            />
          </motion.g>
        )}
      </g>
    );
  }, [ready, x, y, xt, yt, innerW, innerH, margin, prepared, paths, maPath, trend, trendGeom, markers, missingRuns, zeroLine, animate, uid, yLabel, unit, maSorted]);

  /* --------------------------------------------------- crosshair layer */
  const cross =
    readout && activeT != null ? (
      <g pointerEvents="none" aria-hidden="true">
        <line x1={crisp(x(activeT))} x2={crisp(x(activeT))} y1={0} y2={innerH} stroke={C.active} strokeOpacity={0.55} />
        {readout.fit != null && trend && (
          <circle cx={x(activeT)} cy={y(readout.fit)} r={3} fill="var(--color-surface)" stroke={trendColor(trend.direction)} strokeWidth={1.5} />
        )}
        {readout.ma != null && <circle cx={x(activeT)} cy={y(readout.ma)} r={3.5} fill={C.ink} stroke="var(--color-surface)" strokeWidth={2} />}
        {readout.rows.map((r) =>
          r.v != null ? (
            <circle key={r.id} cx={x(activeT)} cy={y(r.v)} r={4.5} fill={r.color} stroke="var(--color-surface)" strokeWidth={2} opacity={r.dimmed ? 0.6 : 1} />
          ) : null,
        )}
        <g transform={`translate(${clamp(x(activeT), 30, innerW - 30)},${innerH + 4})`}>
          <rect x={-31} y={0} width={62} height={18} rx={4} fill="var(--color-surface-2)" stroke="rgb(56 225 255 / 0.5)" />
          <text className="es-tick es-tick-strong" y={12.5} textAnchor="middle" style={{ fontSize: 10 }}>
            {formatDecimalYear(activeT, step >= 0.99 ? "year" : "month")}
          </text>
        </g>
      </g>
    ) : null;

  /* ------------------------------------------------------- data table */
  const table = useMemo(() => {
    const cols = ["Date", ...prepared.map((s) => `${s.label} (${unit})`)];
    if (maSorted) cols.push(`${movingAverageLabel} (${unit})`);
    if (trendGeom) cols.push(`Trend fit (${unit})`);
    const rows = times.map((t) => {
      const k = keyOf(t);
      const src = prepared.map((s) => s.byT.get(k)).find(Boolean);
      const row: (string | null)[] = [src ? formatDateString(src.date) : formatDecimalYear(t)];
      for (const s of prepared) {
        const v = s.byT.get(k)?.v;
        row.push(v == null ? null : formatValue(v, undefined, decimals));
      }
      if (maSorted) {
        const v = maByT.get(k)?.v;
        row.push(v == null ? null : formatValue(v, undefined, decimals));
      }
      if (trendGeom) row.push(t >= trendGeom.t0 && t <= trendGeom.t1 ? formatValue(trendGeom.f(t), undefined, decimals) : EN_DASH);
      return row;
    });
    return { cols, rows };
  }, [prepared, times, maSorted, maByT, trendGeom, unit, decimals, movingAverageLabel]);

  const legendVisible = showLegend && legendItems.length > 0;

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      {legendVisible && <ChartLegend items={legendItems} className="es-chart-legend" label={`${yLabel} legend`} />}
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}${trend ? `. ${trend.label}` : ""}. Use left and right arrow keys to read values.`}
        tabIndex={0}
        style={{ height, marginTop: legendVisible ? 12 : 0 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null && times.length) {
            setPointerY(null);
            setActive(times.length - 1);
          }
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
          open={!!readout}
          x={activeT != null ? margin.left + x(activeT) : 0}
          y={
            pointerY ??
            margin.top + (readout?.primaryV != null ? y(readout.primaryV) : innerH * 0.4)
          }
          bounds={{ width, height }}
        >
          {readout && (
            <>
              <TooltipHeader>{readout.date}</TooltipHeader>
              <TooltipRows>
                {readout.rows
                  .filter((r) => r.has || prepared.length > 1)
                  .map((r) => (
                    <TooltipRow
                      key={r.id}
                      color={r.color}
                      value={r.v == null ? "missing" : formatValue(r.v, unit, decimals)}
                      missing={r.v == null}
                      label={r.label}
                    />
                  ))}
                {readout.ma != null && (
                  <TooltipRow color={C.ink} value={formatValue(readout.ma, unit, decimals)} label={movingAverageLabel} />
                )}
                {readout.fit != null && trend && (
                  <TooltipRow
                    color={trendColor(trend.direction)}
                    kind={trend.significant ? "line" : "dashed"}
                    value={formatValue(readout.fit, unit, decimals)}
                    label="Trend fit"
                  />
                )}
              </TooltipRows>
              {readout.fit != null && trend && readout.primaryV != null && (
                <TooltipNote>
                  <strong className="num">{formatValue(readout.primaryV - readout.fit, unit, decimals, { signed: true })}</strong> from
                  the trend line
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
