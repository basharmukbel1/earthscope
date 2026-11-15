import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { scaleLinear } from "d3-scale";
import type { TrendDirection } from "../../types/domain";
import { useChartSize } from "./useChartSize";
import { LinearXAxis, crisp } from "./axes";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { ChartLegend, type LegendItem } from "./Legend";
import { DataTable } from "./DataTable";
import { C, TREND_GLYPH, trendColor } from "./palette";
import { formatNumber, formatValue } from "./format";
import { localPoint, monoWidth, sansWidth, useChartMotion } from "./utils";
import "./charts.css";

export interface ForestRow {
  id: string;
  label: string;
  /** Optional second line, e.g. "n = 44 yr · Sen's slope". */
  sublabel?: string;
  estimate: number;
  ciLow: number;
  ciHigh: number;
  significant: boolean;
  direction: TrendDirection;
  /** Unit of the estimate, e.g. "°C/decade". */
  unit: string;
}

export interface ForestPlotProps {
  rows: ForestRow[];
  ariaLabel: string;
  decimals?: number;
  /** Axis title (default: "Trend" + the first row's unit). */
  xLabel?: string;
  /** Mark significant trends of opposite sign with a bracket + note (default true). */
  highlightOpposing?: boolean;
  /** Row pitch in px (default 42). */
  rowHeight?: number;
  /** Header over the label column (default "Region"). */
  labelHeader?: string;
  showLegend?: boolean;
  className?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function ForestPlot({
  rows,
  ariaLabel,
  decimals = 2,
  xLabel,
  highlightOpposing = true,
  rowHeight = 42,
  labelHeader = "Region",
  showLegend = true,
  className,
}: ForestPlotProps) {
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height: 10 });
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<number | null>(null);
  const activeRef = useRef<number | null>(null);

  const unit = rows[0]?.unit ?? "";
  const narrow = width < 560;
  const fmtCi = (r: ForestRow) => `[${formatNumber(r.ciLow, decimals)}, ${formatNumber(r.ciHigh, decimals)}]`;

  const opposing = useMemo(() => {
    const up = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.significant && r.direction === "increasing" && r.estimate > 0);
    const down = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.significant && r.direction === "decreasing" && r.estimate < 0);
    return highlightOpposing && up.length && down.length ? { up, down, idx: [...up, ...down].map((d) => d.i).sort((a, b) => a - b) } : null;
  }, [rows, highlightOpposing]);

  const geo = useMemo(() => {
    const headerH = 26;
    const axisH = 42;
    const bracketW = opposing ? 16 : 0;
    // label column fits the label, the mono sublabel and (when narrow) the inline value line
    const subW = (t: string) => t.length * 9.5 * 0.66;
    const labelW = narrow
      ? Math.min(
          width * 0.56,
          Math.max(96, ...rows.map((r) => Math.max(sansWidth(r.label, 12.5), subW(`x ${formatNumber(r.estimate, decimals, { signed: true })} ${fmtCi(r)}`)) + 12)),
        )
      : Math.min(240, Math.max(110, ...rows.map((r) => Math.max(sansWidth(r.label, 12.5), r.sublabel ? subW(r.sublabel) : 0) + 16)));
    const valueW = narrow ? 0 : Math.max(...rows.map((r) => monoWidth(formatValue(r.estimate, undefined, decimals, { signed: true }), 11.5) + monoWidth(fmtCi(r), 10.5))) + 40;
    const plotX = labelW + bracketW + 6;
    const plotW = Math.max(60, width - plotX - valueW - (narrow ? 8 : 14));
    let lo = Math.min(0, ...rows.map((r) => r.ciLow));
    let hi = Math.max(0, ...rows.map((r) => r.ciHigh));
    const span = hi - lo || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    const count = Math.max(3, Math.min(7, Math.floor(plotW / 56)));
    // no .nice(): a forest plot's scale should hug the intervals
    const x = scaleLinear().domain([lo, hi]).range([0, plotW]);
    const all = x.ticks(count);
    const step = all.length > 1 ? Math.abs(all[1] - all[0]) : 1;
    // thin labels that would touch (keep zero), e.g. on phones
    const perLabel = 40;
    const k = Math.max(1, Math.ceil((all.length * perLabel) / plotW));
    const z = Math.max(0, all.findIndex((t) => Math.abs(t) < 1e-9));
    const ticks = all.filter((_, i) => (i - z) % k === 0);
    const height = headerH + rows.length * rowHeight + axisH;
    return { headerH, axisH, labelW, valueW, plotX, plotW, x, ticks, step, height, bracketW };
  }, [rows, width, narrow, rowHeight, decimals, opposing]);
  const { headerH, labelW, plotX, plotW, x, ticks, step, height, bracketW } = geo;
  const rowY = (i: number) => headerH + i * rowHeight + rowHeight / 2;

  const setActive = useCallback((i: number | null) => {
    if (activeRef.current === i) return;
    activeRef.current = i;
    setActiveRaw(i);
  }, []);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = localPoint(e.currentTarget, e);
    const i = Math.floor((p.y - headerH) / rowHeight);
    setActive(i >= 0 && i < rows.length ? i : null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = rows.length;
    if (!n) return;
    const cur = activeRef.current ?? 0;
    const map: Record<string, number | null> = {
      ArrowDown: Math.min(n - 1, cur + 1),
      ArrowRight: Math.min(n - 1, cur + 1),
      ArrowUp: Math.max(0, cur - 1),
      ArrowLeft: Math.max(0, cur - 1),
      Home: 0,
      End: n - 1,
      Escape: null,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    setActive(map[e.key]);
  };

  const describe = (r: ForestRow) =>
    `${r.label}: ${formatValue(r.estimate, r.unit, decimals, { signed: true })}, 95% CI ${formatNumber(r.ciLow, decimals)} to ${formatNumber(
      r.ciHigh,
      decimals,
    )}, ${r.direction === "no-trend" ? "no clear trend" : r.direction}, ${r.significant ? "significant" : "not significant"}`;

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    const zx = crisp(plotX + x(0));
    const plotBottom = headerH + rows.length * rowHeight;
    return (
      <g>
        {/* column headers */}
        <text className="es-axis-title" x={0} y={14}>
          {labelHeader}
        </text>
        {!narrow && (
          <text className="es-axis-title" x={width} y={14} textAnchor="end">
            Estimate <tspan style={{ textTransform: "none" }}>[95% CI]</tspan>
          </text>
        )}
        <line x1={0} x2={width} y1={crisp(headerH - 4)} y2={crisp(headerH - 4)} stroke={C.line} />
        {/* gridlines */}
        <g transform={`translate(${plotX},0)`}>
          <LinearXAxis
            scale={x}
            y={plotBottom + 4}
            ticks={ticks}
            step={step}
            gridTop={headerH - 4}
            format={(v) => formatNumber(v, Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) + 0.001))), { signed: true }).replace(/^\+0$/, "0")}
          />
          <text className="es-axis-title" x={plotW} y={plotBottom + 38} textAnchor="end">
            {xLabel ?? "Trend"}
            <tspan style={{ textTransform: "none", letterSpacing: "0.04em" }}>{` · ${unit}`}</tspan>
          </text>
        </g>
        {/* row separators */}
        {rows.map((_, i) =>
          i > 0 ? <line key={`sep${i}`} x1={0} x2={width} y1={crisp(headerH + i * rowHeight)} y2={crisp(headerH + i * rowHeight)} stroke={C.grid} /> : null,
        )}
        {/* zero reference */}
        <line x1={zx} x2={zx} y1={headerH - 4} y2={plotBottom + 4} stroke="var(--color-ink-3)" strokeOpacity={0.75} />
        <text className="es-tick es-tick-strong" x={zx} y={headerH - 9} textAnchor="middle" style={{ fontSize: 9 }}>
          NO CHANGE
        </text>

        {rows.map((r, i) => {
          const cy = rowY(i);
          const col = trendColor(r.direction);
          const x0 = plotX + x(r.ciLow);
          const x1 = plotX + x(r.ciHigh);
          const cx = plotX + x(r.estimate);
          return (
            <g key={r.id}>
              <text className="es-row-label" x={0} y={narrow || r.sublabel ? cy - 6 : cy} dy="0.35em">
                {r.label}
              </text>
              {narrow ? (
                <text className="es-row-sublabel" x={0} y={cy + 9} dy="0.35em">
                  <tspan fill={col}>{TREND_GLYPH[r.direction]}</tspan>
                  {` ${formatNumber(r.estimate, decimals, { signed: true })} ${fmtCi(r)}`}
                </text>
              ) : (
                r.sublabel && (
                  <text className="es-row-sublabel" x={0} y={cy + 9} dy="0.35em">
                    {r.sublabel}
                  </text>
                )
              )}
              <motion.g
                initial={animate ? { opacity: 0, x: -6 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: EASE, delay: animate ? 0.1 + i * 0.07 : 0 }}
              >
                <line x1={x0} x2={x1} y1={cy} y2={cy} stroke={col} strokeWidth={1.75} strokeLinecap="round" strokeDasharray={r.significant ? undefined : "4 3"} />
                <line x1={x0} x2={x0} y1={cy - 5} y2={cy + 5} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                <line x1={x1} x2={x1} y1={cy - 5} y2={cy + 5} stroke={col} strokeWidth={1.5} strokeLinecap="round" />
                {r.direction === "no-trend" ? (
                  <path
                    d={`M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`}
                    fill={r.significant ? col : "var(--color-surface)"}
                    stroke={r.significant ? "var(--color-surface)" : col}
                    strokeWidth={2}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={5.5}
                    fill={r.significant ? col : "var(--color-surface)"}
                    stroke={r.significant ? "var(--color-surface)" : col}
                    strokeWidth={2}
                  />
                )}
              </motion.g>
              {!narrow && (
                <text x={width} y={cy} dy="0.35em" textAnchor="end">
                  <tspan style={{ fontSize: 9 }} fill={col}>
                    {TREND_GLYPH[r.direction]}
                  </tspan>
                  <tspan className="es-value-label" style={{ fontSize: 11.5 }} dx={6} fontWeight={r.significant ? 600 : 400}>
                    {formatNumber(r.estimate, decimals, { signed: true })}
                  </tspan>
                  <tspan className="es-tick" style={{ fontSize: 10.5 }} dx={8}>
                    {fmtCi(r)}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}

        {opposing && (
          <motion.g
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: animate ? 0.6 + rows.length * 0.07 : 0 }}
          >
            {(() => {
              const bx = labelW + bracketW / 2 + 2;
              const y0 = rowY(opposing.idx[0]);
              const y1 = rowY(opposing.idx[opposing.idx.length - 1]);
              return (
                <>
                  <line x1={crisp(bx)} x2={crisp(bx)} y1={y0} y2={y1} stroke={C.lineBright} />
                  {opposing.idx.map((i) => (
                    <line key={i} x1={bx} x2={bx + 5} y1={rowY(i)} y2={rowY(i)} stroke={C.lineBright} />
                  ))}
                  <circle cx={bx} cy={(y0 + y1) / 2} r={7} fill="var(--color-surface)" stroke={C.lineBright} />
                  <text x={bx} y={(y0 + y1) / 2} dy="0.36em" textAnchor="middle" style={{ fontSize: 9 }} fill="var(--color-ink-2)">
                    ⇅
                  </text>
                </>
              );
            })()}
          </motion.g>
        )}
      </g>
    );
  }, [ready, plotX, x, headerH, rows, rowHeight, labelHeader, narrow, width, ticks, step, plotW, xLabel, unit, animate, decimals, opposing, labelW, bracketW]);

  const ar = active != null ? rows[active] : null;
  const legendItems: LegendItem[] = [
    { id: "inc", label: "Increasing", kind: "dot", color: C.rise, glyph: TREND_GLYPH.increasing },
    { id: "dec", label: "Decreasing", kind: "dot", color: C.fall, glyph: TREND_GLYPH.decreasing },
    { id: "ns", label: "Not significant", kind: "hollow", color: C.flat, note: "hollow · dashed CI" },
  ];

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      {showLegend && <ChartLegend items={legendItems} label="Forest plot legend" />}
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}. Use up and down arrow keys to read each row.`}
        tabIndex={0}
        style={{ height: ready ? height : 200, marginTop: showLegend ? 14 : 0 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activeRef.current == null && rows.length) setActive(0);
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            {ar && active != null && (
              <rect x={-6} y={headerH + active * rowHeight + 1} width={width + 12} height={rowHeight - 2} rx={6} fill="rgb(148 180 255 / 0.05)" stroke="rgb(56 225 255 / 0.25)" />
            )}
            {staticLayer}
          </svg>
        )}
        <ChartTooltip
          open={!!ar}
          x={ar ? plotX + x(ar.estimate) : 0}
          y={active != null ? rowY(active) - 8 : 0}
          bounds={{ width, height }}
          placement="above"
          offset={10}
          anchorSize={16}
        >
          {ar && (
            <>
              <TooltipHeader aside={ar.unit}>{ar.label}</TooltipHeader>
              <TooltipRows>
                <TooltipRow
                  kind={ar.significant ? "dot" : "hollow"}
                  color={trendColor(ar.direction)}
                  value={`${TREND_GLYPH[ar.direction]} ${formatNumber(ar.estimate, decimals, { signed: true })}`}
                  label={ar.direction === "no-trend" ? "no clear trend" : ar.direction}
                />
                <TooltipRow kind="none" value={fmtCi(ar)} label="95% CI" />
              </TooltipRows>
              <TooltipNote>
                {ar.significant ? (
                  <>
                    <strong>Significant</strong> — the interval excludes zero.
                  </>
                ) : (
                  <>
                    <strong>Not significant</strong> — the interval includes zero.
                  </>
                )}
              </TooltipNote>
            </>
          )}
        </ChartTooltip>
      </div>
      {opposing && (
        <div className="es-note">
          <span className="es-note-mark">⇅ Opposing</span>
          <span>
            Significant trends of opposite sign:{" "}
            <strong>{opposing.up.map((d) => d.r.label).join(", ")}</strong> rising vs.{" "}
            <strong>{opposing.down.map((d) => d.r.label).join(", ")}</strong> falling. A single global average would hide this contrast.
          </span>
        </div>
      )}
      <DataTable
        caption={ariaLabel}
        columns={["Region", `Estimate (${unit})`, "95% CI low", "95% CI high", "Direction", "Significant"]}
        rows={rows.map((r) => [
          r.label,
          formatNumber(r.estimate, decimals, { signed: true }),
          formatNumber(r.ciLow, decimals),
          formatNumber(r.ciHigh, decimals),
          r.direction,
          r.significant ? "yes" : "no",
        ])}
      />
      <LiveRegion text={ar ? describe(ar) : ""} />
    </div>
  );
}
