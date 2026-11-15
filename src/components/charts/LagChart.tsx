import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import { useChartSize } from "./useChartSize";
import { AxisTitle, ValueAxis, crisp, leftMarginFor, valueTicks, type Margin } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { ChartLegend, type LegendItem } from "./Legend";
import { DataTable } from "./DataTable";
import { C } from "./palette";
import { MINUS, formatP, formatR, formatTick } from "./format";
import { annotWidth, barGeometry, localPoint, roundedBarPath, useChartMotion } from "./utils";
import "./charts.css";

export interface LagRow {
  lag: number;
  r: number;
  p: number;
  significant: boolean;
}

export interface LagChartProps {
  /** One row per lag, typically −12 … +12. */
  rows: LagRow[];
  /** Override the auto peak annotation, e.g. "Strongest at +2 months". */
  maxLagLabel?: string;
  /** Axis title (default "Lag"). */
  xLabel?: string;
  /** Lag unit (default "months"). */
  lagUnit?: string;
  /** What a negative / positive lag means, drawn under the axis ends. */
  leadLabels?: { negative: string; positive: string };
  /** Interpretation note under the chart. */
  note?: ReactNode;
  /** Total SVG height including axes (default 250). */
  height?: number;
  ariaLabel: string;
  showLegend?: boolean;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
const signedLag = (l: number) => (l > 0 ? `+${l}` : l < 0 ? `${MINUS}${Math.abs(l)}` : "0");

export function LagChart({
  rows,
  maxLagLabel,
  xLabel = "Lag",
  lagUnit = "months",
  leadLabels,
  note,
  height = 250,
  ariaLabel,
  showLegend = true,
  className,
}: LagChartProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height });
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.lag - b.lag), [rows]);
  const peak = useMemo(() => {
    const pool = sorted.some((r) => r.significant) ? sorted.filter((r) => r.significant) : sorted;
    return pool.reduce<LagRow | null>((m, r) => (!m || Math.abs(r.r) > Math.abs(m.r) ? r : m), null);
  }, [sorted]);

  // one row (lead · title · lead) when wide, two rows when narrow
  const wideAxis = width - 60 >= 380;
  const bottomExtra = leadLabels ? (wideAxis ? 16 : 30) : 16;
  const geo = useMemo(() => {
    const m = Math.min(1, Math.max(0.2, ...sorted.map((r) => Math.abs(r.r) * 1.25)));
    const y0 = scaleLinear().domain([-m, m]).range([height - 50 - bottomExtra, 0]).nice(4);
    const yt = valueTicks(y0, height - 50 - bottomExtra, 40);
    const margin: Margin = { top: 24, right: 14, bottom: 30 + bottomExtra, left: leftMarginFor(yt.ticks.map((v) => formatTick(v, yt.step))) };
    const innerW = Math.max(10, width - margin.left - margin.right);
    const innerH = Math.max(10, height - margin.top - margin.bottom);
    const lags = sorted.map((r) => r.lag);
    const lo = lags.length ? Math.min(...lags) : -12;
    const hi = lags.length ? Math.max(...lags) : 12;
    const x = scaleLinear().domain([lo - 0.5, hi + 0.5]).range([0, innerW]);
    const y = y0.copy().range([innerH, 0]);
    const bar = barGeometry(innerW, hi - lo + 1, 22);
    const span = hi - lo;
    const every = innerW / (span + 1) >= 26 ? (span <= 12 ? 1 : 3) : innerW / (span + 1) >= 13 ? 3 : 6;
    const ticks = lags.filter((l) => l % every === 0);
    return { x, y, yt, margin, innerW, innerH, bar, ticks };
  }, [sorted, height, width, bottomExtra]);
  const { x, y, yt, margin, innerW, innerH, bar, ticks } = geo;

  const setActive = useCallback((i: number | null) => {
    if (activeRef.current === i) return;
    activeRef.current = i;
    setActiveRaw(i);
  }, []);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!sorted.length) return;
    const p = localPoint(e.currentTarget, e);
    const lag = Math.round(x.invert(p.x - margin.left));
    const i = sorted.findIndex((r) => r.lag === lag);
    setActive(i >= 0 ? i : null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = sorted.length;
    if (!n) return;
    const zero = Math.max(0, sorted.findIndex((r) => r.lag === 0));
    const cur = activeRef.current ?? zero;
    const map: Record<string, number | null> = {
      ArrowRight: Math.min(n - 1, cur + 1),
      ArrowLeft: Math.max(0, cur - 1),
      Home: 0,
      End: n - 1,
      Escape: null,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    setActive(map[e.key]);
  };

  const peakText = peak ? maxLagLabel ?? `Peak r = ${formatR(peak.r)} at ${signedLag(peak.lag)} ${lagUnit === "months" ? "mo" : lagUnit}` : "";

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    const zy = crisp(y(0));
    const pk = peak ? { x: x(peak.lag), y: y(peak.r), up: peak.r >= 0 } : null;
    const pw = annotWidth(peakText) + 2;
    return (
      <g>
        <ValueAxis scale={y} width={innerW} ticks={yt.ticks} step={yt.step} strongZero />
        <AxisTitle x={-margin.left} y={-margin.top + 11} label="Correlation" unit="r" />
        {sorted.map((r, i) => {
          const d = roundedBarPath(x(r.lag) - bar.width / 2, bar.width, y(0), y(r.r), 3);
          const body = r.significant ? (
            <path d={d} fill={C.primary} />
          ) : (
            <path d={d} fill={C.primary} fillOpacity={0.07} stroke={C.primary} strokeOpacity={0.75} strokeWidth={1.25} />
          );
          return animate ? (
            <motion.g
              key={r.lag}
              style={{ originY: r.r >= 0 ? 1 : 0 }}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: EASE, delay: i * 0.02 }}
            >
              {body}
            </motion.g>
          ) : (
            <g key={r.lag}>{body}</g>
          );
        })}
        <line x1={0} x2={innerW} y1={zy} y2={zy} stroke="var(--color-ink-3)" strokeOpacity={0.7} />
        {/* lag axis */}
        <line x1={crisp(x(0))} x2={crisp(x(0))} y1={0} y2={innerH} stroke={C.lineStrong} />
        {ticks.map((l) => (
          <text key={l} className={`es-tick${l === 0 ? " es-tick-strong" : ""}`} x={x(l)} y={innerH + 17} textAnchor="middle">
            {signedLag(l)}
          </text>
        ))}
        <AxisTitle
          x={innerW / 2}
          y={innerH + 34 + (leadLabels && !wideAxis ? 15 : 0)}
          label={`${xLabel} (${lagUnit})`}
          anchor="middle"
        />
        {leadLabels && (
          <>
            <text className="es-annot es-annot-muted" x={0} y={innerH + 34}>
              ← {leadLabels.negative}
            </text>
            <text className="es-annot es-annot-muted" x={innerW} y={innerH + 34} textAnchor="end">
              {leadLabels.positive} →
            </text>
          </>
        )}
        {pk && peakText && (
          <motion.g
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: animate ? 0.8 : 0 }}
          >
            {(() => {
              const left = Math.max(0, Math.min(innerW - pw, pk.x - pw / 2));
              const ly = pk.up ? Math.max(2, pk.y - 26) : Math.min(innerH - 18, pk.y + 10);
              return (
                <>
                  <rect x={left} y={ly} width={pw} height={16} rx={3} className="es-label-plate" />
                  <text className="es-annot" x={left + 7} y={ly + 11.5} style={{ textTransform: "none" }}>
                    {peakText}
                  </text>
                </>
              );
            })()}
          </motion.g>
        )}
      </g>
    );
  }, [ready, x, y, yt, margin, innerW, innerH, sorted, bar, animate, ticks, xLabel, lagUnit, leadLabels, peak, peakText, wideAxis]);

  const ar = active != null ? sorted[active] : null;
  const describe = (r: LagRow) =>
    `Lag ${signedLag(r.lag)} ${lagUnit}: r = ${formatR(r.r)}, ${formatP(r.p)}, ${r.significant ? "significant" : "not significant"}`;

  const legendItems: LegendItem[] = [
    { id: "sig", label: "Significant", kind: "rect", color: C.primary },
    { id: "ns", label: "Not significant", kind: "outline", color: C.primary },
  ];

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      {showLegend && <ChartLegend items={legendItems} label="Lag correlation legend" />}
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}${peak ? `. ${peakText}` : ""}. Use left and right arrow keys to read each lag.`}
        tabIndex={0}
        style={{ height, marginTop: showLegend ? 12 : 0 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null && sorted.length) setActive(Math.max(0, sorted.findIndex((r) => r.lag === 0)));
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {staticLayer}
              {ar && (
                <g pointerEvents="none">
                  <rect
                    x={x(ar.lag) - Math.max(bar.width, 8) / 2 - 3}
                    y={0}
                    width={Math.max(bar.width, 8) + 6}
                    height={innerH}
                    rx={4}
                    fill="rgb(56 225 255 / 0.06)"
                    stroke="rgb(56 225 255 / 0.4)"
                  />
                </g>
              )}
            </g>
          </svg>
        )}
        <ChartTooltip
          open={!!ar}
          x={ar ? margin.left + x(ar.lag) : 0}
          y={ar ? margin.top + Math.min(y(ar.r), y(0)) : 0}
          bounds={{ width, height }}
          placement="above"
          offset={10}
          anchorSize={ar ? Math.abs(y(ar.r) - y(0)) : 0}
        >
          {ar && (
            <>
              <TooltipHeader aside={lagUnit}>Lag {signedLag(ar.lag)}</TooltipHeader>
              <TooltipRows>
                <TooltipRow kind={ar.significant ? "rect" : "hollow"} color={C.primary} value={formatR(ar.r)} label="correlation r" />
                <TooltipRow kind="none" value={formatP(ar.p)} label={ar.significant ? "significant" : "not significant"} />
              </TooltipRows>
              {peak && ar.lag === peak.lag && <TooltipNote>Strongest relationship in this window.</TooltipNote>}
            </>
          )}
        </ChartTooltip>
      </div>
      {note != null && (
        <div className="es-note">
          <span className="es-note-mark">Note</span>
          <span>{note}</span>
        </div>
      )}
      <DataTable
        caption={ariaLabel}
        columns={[`Lag (${lagUnit})`, "Correlation r", "p-value", "Significant"]}
        rows={sorted.map((r) => [signedLag(r.lag), formatR(r.r), formatP(r.p), r.significant ? "yes" : "no"])}
      />
      <LiveRegion text={ar ? describe(ar) : ""} />
    </div>
  );
}
