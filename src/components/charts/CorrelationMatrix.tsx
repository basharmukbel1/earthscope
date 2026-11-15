import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion } from "motion/react";
import { useChartSize } from "./useChartSize";
import { ChartTooltip, LiveRegion, TooltipHeader, TooltipNote, TooltipRow, TooltipRows } from "./ChartTooltip";
import { DataTable } from "./DataTable";
import { C, divergingColor, textOnFill } from "./palette";
import { MINUS, formatP, formatR } from "./format";
import { localPoint, sansWidth, useChartMotion, useSafeId } from "./utils";
import "./charts.css";

export interface CorrelationMatrixProps {
  labels: string[];
  /** Square matrix of correlation coefficients (−1 … 1). */
  r: number[][];
  /** Matching matrix of p-values. */
  p: number[][];
  /** Significance threshold (default 0.05). */
  alpha?: number;
  ariaLabel: string;
  /** Show the full matrix or only the lower triangle (default "full"). */
  triangle?: "full" | "lower";
  decimals?: number;
  /** Largest cell edge in px (default 68). */
  maxCell?: number;
  /** Name of the coefficient for legend / tooltip (default "Pearson r"). */
  method?: string;
  className?: string;
}

type Cell = { i: number; j: number };

export function CorrelationMatrix({
  labels,
  r,
  p,
  alpha = 0.05,
  ariaLabel,
  triangle = "full",
  decimals = 2,
  maxCell = 68,
  method = "Pearson r",
  className,
}: CorrelationMatrixProps) {
  const n = labels.length;
  const { ref, width, ready } = useChartSize<HTMLDivElement>({ height: 10 });
  const uid = useSafeId("cm");
  const { animate } = useChartMotion();
  const [active, setActiveRaw] = useState<Cell | null>(null);
  const activeRef = useRef<Cell | null>(null);

  const geo = useMemo(() => {
    const labelW = Math.min(Math.max(...labels.map((l) => sansWidth(l, 12)), 40) + 14, Math.max(80, width * 0.34));
    const colLabelW = Math.max(...labels.map((l) => sansWidth(l, 11)), 10);
    let cell = Math.max(22, Math.min(maxCell, Math.floor((width - labelW - 4) / Math.max(1, n))));
    const rotate = colLabelW + 8 > cell;
    if (rotate) {
      // a -42° label runs up-right: keep the last column's label inside the frame
      const lastW = sansWidth(labels[n - 1] ?? "", 11) * Math.cos((42 * Math.PI) / 180);
      cell = Math.max(22, Math.min(cell, Math.floor((width - labelW - Math.max(0, lastW - 6)) / Math.max(1, n - 0.5))));
    }
    const top = rotate ? Math.min(120, Math.ceil(colLabelW * 0.68 + 14)) : 24;
    const gridW = cell * n;
    const height = top + gridW + 4;
    return { labelW, cell, rotate, top, gridW, height };
  }, [labels, width, n, maxCell]);
  const { labelW, cell, rotate, top, gridW, height } = geo;

  const visible = useCallback((i: number, j: number) => triangle === "full" || j <= i, [triangle]);

  const setActive = useCallback((c: Cell | null) => {
    const prev = activeRef.current;
    if (prev === c || (prev && c && prev.i === c.i && prev.j === c.j)) return;
    activeRef.current = c;
    setActiveRaw(c);
  }, []);

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pt = localPoint(e.currentTarget, e);
    const j = Math.floor((pt.x - labelW) / cell);
    const i = Math.floor((pt.y - top) / cell);
    if (i >= 0 && j >= 0 && i < n && j < n && visible(i, j)) setActive({ i, j });
    else setActive(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = activeRef.current ?? { i: n > 1 ? 1 : 0, j: 0 };
    let { i, j } = cur;
    switch (e.key) {
      case "ArrowRight":
        j = Math.min(n - 1, j + 1);
        break;
      case "ArrowLeft":
        j = Math.max(0, j - 1);
        break;
      case "ArrowDown":
        i = Math.min(n - 1, i + 1);
        break;
      case "ArrowUp":
        i = Math.max(0, i - 1);
        break;
      case "Home":
        j = 0;
        break;
      case "End":
        j = triangle === "lower" ? i : n - 1;
        break;
      case "Escape":
        e.preventDefault();
        setActive(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (!visible(i, j)) j = i;
    setActive({ i, j });
  };

  const cells = useMemo(() => {
    const out: { i: number; j: number; v: number; pv: number; fill: string; sig: boolean; diag: boolean }[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (!visible(i, j)) continue;
        const v = r[i]?.[j] ?? NaN;
        const pv = p[i]?.[j] ?? NaN;
        const diag = i === j;
        out.push({ i, j, v, pv, diag, sig: !diag && Number.isFinite(pv) && pv < alpha, fill: diag ? "var(--color-surface-2)" : divergingColor(Number.isFinite(v) ? v : 0) });
      }
    return out;
  }, [n, r, p, alpha, visible]);

  const showText = cell >= 34;
  const fmtCell = (v: number) => {
    const s = formatR(v, decimals);
    return cell < 46 ? s.replace(/^(−?)0\./, "$1.") : s;
  };

  const rowLabel = (l: string, i: number, fill: string) => (
    <text key={`r${i}`} className="es-row-label" x={labelW - 10} y={top + i * cell + cell / 2} dy="0.35em" textAnchor="end" style={{ fontSize: 12, fill }}>
      {l}
    </text>
  );
  const colLabel = (l: string, j: number, fill: string) =>
    rotate ? (
      <text
        key={`c${j}`}
        className="es-row-label"
        transform={`translate(${labelW + j * cell + cell / 2 + 3},${top - 8}) rotate(-42)`}
        style={{ fontSize: 11, fill }}
      >
        {l}
      </text>
    ) : (
      <text key={`c${j}`} className="es-row-label" x={labelW + j * cell + cell / 2} y={top - 9} textAnchor="middle" style={{ fontSize: 11, fill }}>
        {l}
      </text>
    );

  const staticLayer = useMemo(() => {
    if (!ready) return null;
    return (
      <g>
        {cells.map((c, k) => {
          const x = labelW + c.j * cell;
          const y = top + c.i * cell;
          const fg = c.diag ? "var(--color-ink-4)" : textOnFill(c.fill);
          return (
            <motion.g
              key={`${c.i}-${c.j}`}
              initial={animate ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: animate ? Math.min(0.6, (c.i + c.j) * 0.035 + k * 0.002) : 0 }}
            >
              <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={3} fill={c.fill} />
              {c.diag ? (
                <line x1={x + cell * 0.32} y1={y + cell * 0.68} x2={x + cell * 0.68} y2={y + cell * 0.32} stroke="var(--color-ink-4)" strokeWidth={1} />
              ) : (
                <>
                  {showText && Number.isFinite(c.v) && (
                    <text
                      className="es-cell-text"
                      x={x + cell / 2}
                      y={y + cell / 2}
                      dy="0.35em"
                      textAnchor="middle"
                      fill={fg}
                      fillOpacity={c.sig ? 1 : 0.62}
                      fontWeight={c.sig ? 600 : 400}
                      style={{ fontSize: cell >= 46 ? 11.5 : 10.5 }}
                    >
                      {fmtCell(c.v)}
                    </text>
                  )}
                  {c.sig && <circle cx={x + cell - 8} cy={y + 8} r={2.25} fill={fg} />}
                </>
              )}
            </motion.g>
          );
        })}
        {labels.map((l, i) => rowLabel(l, i, "var(--color-ink-2)"))}
        {labels.map((l, j) => colLabel(l, j, "var(--color-ink-3)"))}
      </g>
    );
  }, [ready, cells, labelW, cell, top, animate, labels, rotate, triangle, n, showText, decimals]);

  const ac = active ? cells.find((c) => c.i === active.i && c.j === active.j) ?? null : null;
  const describe = (c: { i: number; j: number; v: number; pv: number; sig: boolean; diag: boolean }) =>
    c.diag
      ? `${labels[c.i]} with itself`
      : `${labels[c.i]} and ${labels[c.j]}: ${method} ${formatR(c.v, decimals)}, ${formatP(c.pv)}, ${c.sig ? "significant" : "not significant"} at alpha ${alpha}`;

  const strength = (v: number) => {
    const a = Math.abs(v);
    return a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "negligible";
  };

  const table = useMemo(
    () => ({
      cols: ["Variable", ...labels.map((l) => `${l} (${method})`)],
      rows: labels.map((l, i) => [
        l,
        ...labels.map((_, j) =>
          !visible(i, j) || i === j
            ? i === j
              ? "1"
              : ""
            : `${formatR(r[i]?.[j], decimals)} (${formatP(p[i]?.[j])}${(p[i]?.[j] ?? 1) < alpha ? ", significant" : ""})`,
        ),
      ]),
    }),
    [labels, r, p, alpha, decimals, method, visible],
  );

  // Gradient stops for the scale legend
  const stops = useMemo(() => Array.from({ length: 11 }, (_, k) => ({ o: k / 10, c: divergingColor(-1 + (k / 10) * 2) })), []);

  return (
    <div ref={ref} className={`es-chart${className ? ` ${className}` : ""}`}>
      <div
        className="es-plot"
        role="img"
        aria-label={`${ariaLabel}. Use arrow keys to move between cells.`}
        tabIndex={0}
        style={{ height: ready ? height : 200 }}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (!activeRef.current && n) setActive({ i: n > 1 ? 1 : 0, j: 0 });
        }}
        onBlur={() => setActive(null)}
      >
        {ready && (
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            {staticLayer}
            {ac && (
              <g pointerEvents="none">
                <rect x={labelW} y={top + ac.i * cell} width={(triangle === "lower" ? ac.i + 1 : n) * cell} height={cell} fill="none" stroke="rgb(56 225 255 / 0.18)" />
                <rect x={labelW + ac.j * cell} y={top} width={cell} height={gridW} fill="none" stroke="rgb(56 225 255 / 0.18)" />
                <rect x={labelW + ac.j * cell + 0.5} y={top + ac.i * cell + 0.5} width={cell - 1} height={cell - 1} rx={4} fill="none" stroke={C.active} strokeWidth={1.5} />
                {rowLabel(labels[ac.i], ac.i, "var(--color-ink)")}
                {colLabel(labels[ac.j], ac.j, "var(--color-ink)")}
              </g>
            )}
          </svg>
        )}
        <ChartTooltip
          open={!!ac}
          x={ac ? labelW + ac.j * cell + cell / 2 : 0}
          y={ac ? top + ac.i * cell : 0}
          bounds={{ width, height }}
          placement="above"
          offset={8}
          anchorSize={cell}
        >
          {ac && (
            <>
              <TooltipHeader aside={method}>{ac.diag ? labels[ac.i] : `${labels[ac.i]} × ${labels[ac.j]}`}</TooltipHeader>
              {ac.diag ? (
                <TooltipNote>A variable is perfectly correlated with itself.</TooltipNote>
              ) : (
                <>
                  <TooltipRows>
                    <TooltipRow kind="rect" color={ac.fill} value={formatR(ac.v, decimals)} label={`${strength(ac.v)} ${ac.v >= 0 ? "positive" : "negative"}`} />
                    <TooltipRow kind={ac.sig ? "dot" : "hollow"} color={C.ink2} value={formatP(ac.pv)} label={ac.sig ? `significant (α = ${alpha})` : `not significant (α = ${alpha})`} />
                  </TooltipRows>
                  <TooltipNote>Correlation describes co-variation, not cause.</TooltipNote>
                </>
              )}
            </>
          )}
        </ChartTooltip>
      </div>

      {/* scale + significance legend */}
      <div className="es-legend" style={{ marginTop: 14 }} aria-hidden="true">
        <span className="es-legend-item">
          <svg width={150} height={26} style={{ overflow: "visible" }}>
            <defs>
              <linearGradient id={`${uid}-grad`} x1="0" x2="1" y1="0" y2="0">
                {stops.map((s) => (
                  <stop key={s.o} offset={s.o} stopColor={s.c} />
                ))}
              </linearGradient>
            </defs>
            <rect x={0} y={2} width={150} height={8} rx={2} fill={`url(#${uid}-grad)`} />
            {[0, 75, 150].map((xx) => (
              <line key={xx} x1={xx} x2={xx} y1={10} y2={13} stroke={C.axis} />
            ))}
            <text className="es-tick" x={0} y={24} textAnchor="start" style={{ fontSize: 9.5 }}>{`${MINUS}1`}</text>
            <text className="es-tick" x={75} y={24} textAnchor="middle" style={{ fontSize: 9.5 }}>0</text>
            <text className="es-tick" x={150} y={24} textAnchor="end" style={{ fontSize: 9.5 }}>+1</text>
          </svg>
          <span className="es-legend-note" style={{ marginLeft: 4 }}>
            {method}: negative ↔ positive
          </span>
        </span>
        <span className="es-legend-item">
          <svg width={10} height={10}>
            <circle cx={5} cy={5} r={2.5} fill={C.ink} />
          </svg>
          <span>
            p &lt; {alpha} <span className="es-legend-note">significant (bold value)</span>
          </span>
        </span>
      </div>

      <DataTable caption={ariaLabel} columns={table.cols} rows={table.rows} />
      <LiveRegion text={ac ? describe(ac) : ""} />
    </div>
  );
}
