import type { ScaleLinear } from "d3-scale";
import { tickStep } from "d3-array";
import { MONTHS_SHORT, decimalYearParts, formatTick } from "./format";
import { monoWidth } from "./utils";
import { C } from "./palette";

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Snap a coordinate to the pixel grid so 1px hairlines render crisp. */
export const crisp = (v: number) => Math.round(v) + 0.5;

/* -------------------------------------------------------------- ticks */

export interface TimeTicks {
  ticks: number[];
  minor: number[];
  /** Step in years (fractional when monthly). */
  step: number;
  monthly: boolean;
}

const YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
const MONTH_STEPS = [1, 2, 3, 6];

/**
 * Smart year ticks: the smallest "nice" step whose labels keep ≥ minSpacing px
 * apart. Short records fall through to month ticks. Minor ticks mark single
 * years when there is room — a quiet instrument-scale detail.
 */
export function timeTicks(domain: [number, number], width: number, minSpacing = 64): TimeTicks {
  const [d0, d1] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  const span = Math.max(1e-6, d1 - d0);
  const pxPerYear = width / span;
  const eps = 1e-6;

  if (span < 4) {
    const m = MONTH_STEPS.find((s) => (s / 12) * pxPerYear >= minSpacing * 1.15);
    if (m && pxPerYear / 12 * m >= 20) {
      const step = m / 12;
      const ticks: number[] = [];
      const start = Math.ceil(d0 * 12 - eps) / 12;
      for (let t = start; t <= d1 + eps; t += step) ticks.push(Math.round(t * 12) / 12);
      const kept = ticks.filter((t) => Math.round(t * 12) % m === 0);
      if (kept.length >= 2) return { ticks: kept, minor: [], step, monthly: true };
    }
  }

  const step = YEAR_STEPS.find((s) => s * pxPerYear >= minSpacing) ?? YEAR_STEPS[YEAR_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(d0 / step - eps) * step; t <= d1 + eps; t += step) ticks.push(Math.round(t));
  const minor: number[] = [];
  const minorStep = step <= 10 ? 1 : step / 5;
  if (step > 1 && minorStep * pxPerYear >= 5) {
    for (let t = Math.ceil(d0 / minorStep - eps) * minorStep; t <= d1 + eps; t += minorStep) {
      if (Math.abs(t / step - Math.round(t / step)) > 1e-6) minor.push(t);
    }
  }
  return { ticks: ticks.length ? ticks : [Math.round(d0), Math.round(d1)], minor, step, monthly: false };
}

export function formatTimeTick(t: number, monthly: boolean): string {
  if (!monthly) return String(Math.round(t));
  const { year, month } = decimalYearParts(t + 1e-6);
  return month === 0 ? String(year) : MONTHS_SHORT[month];
}

export interface ValueTicks {
  ticks: number[];
  step: number;
}

/** ~one gridline per `spacing` px of plot height, on nice numbers. */
export function valueTicks(scale: ScaleLinear<number, number>, height: number, spacing = 46): ValueTicks {
  const count = Math.max(2, Math.min(8, Math.floor(height / spacing)));
  const [a, b] = scale.domain();
  return { ticks: scale.ticks(count), step: Math.abs(tickStep(a, b, count)) || 1 };
}

/** Left margin wide enough for the widest value label. */
export function leftMarginFor(labels: string[], min = 34, fontSize = 10.5): number {
  const w = labels.reduce((m, l) => Math.max(m, monoWidth(l, fontSize)), 0);
  return Math.max(min, Math.ceil(w + 14));
}

/* --------------------------------------------------------------- axes */

export interface TimeAxisProps {
  scale: ScaleLinear<number, number>;
  /** y of the axis baseline (plot bottom) in plot coordinates. */
  y: number;
  ticks: TimeTicks;
  format?: (t: number) => string;
  /** Draw full-height vertical gridlines at major ticks. */
  grid?: boolean;
  gridTop?: number;
}

export function TimeAxis({ scale, y, ticks, format, grid = false, gridTop = 0 }: TimeAxisProps) {
  const [r0, r1] = scale.range();
  const fmt = format ?? ((t: number) => formatTimeTick(t, ticks.monthly));
  const yb = crisp(y);
  return (
    <g aria-hidden="true">
      {grid &&
        ticks.ticks.map((t) => (
          <line key={`g${t}`} x1={crisp(scale(t))} x2={crisp(scale(t))} y1={gridTop} y2={y} stroke={C.grid} />
        ))}
      <line x1={r0} x2={r1} y1={yb} y2={yb} stroke={C.axis} />
      {ticks.minor.map((t) => (
        <line key={`m${t}`} x1={crisp(scale(t))} x2={crisp(scale(t))} y1={yb} y2={yb + 3} stroke={C.axis} opacity={0.55} />
      ))}
      {ticks.ticks.map((t) => {
        const x = scale(t);
        if (x < r0 - 0.5 || x > r1 + 0.5) return null;
        return (
          <g key={t} transform={`translate(${crisp(x)},${yb})`}>
            <line y1={0} y2={5} stroke={C.axis} />
            <text className="es-tick" y={17} textAnchor="middle">
              {fmt(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface LinearAxisProps {
  scale: ScaleLinear<number, number>;
  y: number;
  ticks: number[];
  step: number;
  format?: (v: number) => string;
  grid?: boolean;
  gridTop?: number;
}

/** Horizontal numeric axis (scatter x, forest plot, lag). */
export function LinearXAxis({ scale, y, ticks, step, format, grid = true, gridTop = 0 }: LinearAxisProps) {
  const [r0, r1] = scale.range();
  const fmt = format ?? ((v: number) => formatTick(v, step));
  const yb = crisp(y);
  return (
    <g aria-hidden="true">
      {grid &&
        ticks.map((t) => (
          <line key={`g${t}`} x1={crisp(scale(t))} x2={crisp(scale(t))} y1={gridTop} y2={y} stroke={C.grid} />
        ))}
      <line x1={r0} x2={r1} y1={yb} y2={yb} stroke={C.axis} />
      {ticks.map((t) => (
        <g key={t} transform={`translate(${crisp(scale(t))},${yb})`}>
          <line y1={0} y2={5} stroke={C.axis} />
          <text className="es-tick" y={17} textAnchor="middle">
            {fmt(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface ValueAxisProps {
  scale: ScaleLinear<number, number>;
  /** Plot width — gridlines span it. */
  width: number;
  ticks: number[];
  step: number;
  format?: (v: number) => string;
  grid?: boolean;
  /** Emphasise the label at 0 (anomaly / correlation charts). */
  strongZero?: boolean;
}

/** Vertical value axis: mono labels right-aligned in the margin + hairline grid. */
export function ValueAxis({ scale, width, ticks, step, format, grid = true, strongZero = false }: ValueAxisProps) {
  const fmt = format ?? ((v: number) => formatTick(v, step));
  return (
    <g aria-hidden="true">
      {ticks.map((t) => {
        const y = crisp(scale(t));
        return (
          <g key={t}>
            {grid && <line x1={0} x2={width} y1={y} y2={y} stroke={C.grid} />}
            <text
              className={`es-tick${strongZero && t === 0 ? " es-tick-strong" : ""}`}
              x={-10}
              y={y}
              dy="0.34em"
              textAnchor="end"
            >
              {fmt(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Mono axis title with an un-transformed unit: "TEMPERATURE · °C". */
export function AxisTitle({
  x,
  y,
  label,
  unit,
  anchor = "start",
}: {
  x: number;
  y: number;
  label: string;
  unit?: string;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text className="es-axis-title" x={x} y={y} textAnchor={anchor} aria-hidden="true">
      {label}
      {unit ? (
        <tspan className="es-axis-unit" style={{ textTransform: "none", letterSpacing: "0.04em" }}>
          {" · "}
          {unit}
        </tspan>
      ) : null}
    </text>
  );
}
