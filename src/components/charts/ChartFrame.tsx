import type { ReactNode } from "react";
import { useSafeId } from "./utils";
import "./charts.css";

export type ChartStatus = "ready" | "loading" | "empty" | "error";

export interface ChartFrameProps {
  /** Mono kicker above the title, e.g. "Fig. 2 · Time series". */
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Unit chip in the header, e.g. "°C". */
  unit?: string;
  /** Small label inside the unit chip (default "Unit"). */
  unitLabel?: string;
  /** Extra header controls (toggles, menus) — right aligned. */
  actions?: ReactNode;
  /** Legend slot (charts render their own legend by default; use for extras). */
  legend?: ReactNode;
  /** Source / provenance caption (rendered as the <figcaption>). */
  caption?: ReactNode;
  /** Label before the caption (default "Source"). */
  captionLabel?: string;
  status?: ChartStatus;
  emptyMessage?: ReactNode;
  errorMessage?: ReactNode;
  onRetry?: () => void;
  /** Height of the loading / empty / error placeholder (match the chart). */
  stateHeight?: number;
  /** Drop the panel chrome (when nested inside another panel). */
  bare?: boolean;
  className?: string;
  id?: string;
  children?: ReactNode;
}

/**
 * Figure chrome shared by every chart: title block, unit chip, legend slot,
 * provenance caption, and designed loading / empty / error states.
 */
export function ChartFrame({
  eyebrow,
  title,
  subtitle,
  unit,
  unitLabel = "Unit",
  actions,
  legend,
  caption,
  captionLabel = "Source",
  status = "ready",
  emptyMessage = "No observations in the selected range.",
  errorMessage = "The data could not be loaded.",
  onRetry,
  stateHeight = 260,
  bare = false,
  className,
  id,
  children,
}: ChartFrameProps) {
  const uid = useSafeId("fr");
  const titleId = `${uid}-t`;
  const subId = `${uid}-s`;
  const hasHead = eyebrow != null || title != null || subtitle != null || unit != null || actions != null;

  return (
    <figure
      id={id}
      className={`es-frame${className ? ` ${className}` : ""}`}
      data-bare={bare ? "true" : undefined}
      aria-labelledby={title != null ? titleId : undefined}
      aria-describedby={subtitle != null ? subId : undefined}
      aria-busy={status === "loading" ? true : undefined}
    >
      {hasHead && (
        <div className="es-frame-head">
          <div className="es-frame-titles">
            {eyebrow != null && <div className="es-eyebrow">{eyebrow}</div>}
            {title != null ? (
              <h3 id={titleId} className="es-title">
                {title}
              </h3>
            ) : status === "loading" ? (
              <div className="skeleton es-skel-title" style={{ width: 180 }} />
            ) : null}
            {subtitle != null && (
              <p id={subId} className="es-subtitle">
                {subtitle}
              </p>
            )}
          </div>
          {(unit != null || actions != null) && (
            <div className="es-frame-aside">
              {actions}
              {unit != null && (
                <span className="es-unit-chip num">
                  <span>{unitLabel}</span>
                  <span>{unit}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {legend != null && status === "ready" && <div className="es-frame-legend">{legend}</div>}

      <div className="es-frame-body">
        {status === "ready" && children}
        {status === "loading" && <ChartSkeleton height={stateHeight} />}
        {status === "empty" && (
          <ChartState kind="empty" height={stateHeight} badge="No data">
            {emptyMessage}
          </ChartState>
        )}
        {status === "error" && (
          <ChartState kind="error" height={stateHeight} badge="Load error" onRetry={onRetry}>
            {errorMessage}
          </ChartState>
        )}
      </div>

      {caption != null && (
        <figcaption className="es-caption">
          <span className="es-caption-label">{captionLabel}</span>
          <span>{caption}</span>
        </figcaption>
      )}
    </figure>
  );
}

/** Loading placeholder shaped like a chart: hairline grid, tick stubs, shimmering wave. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="es-skel" style={{ height }} role="status" aria-label="Loading chart">
      <div className="es-skel-grid" />
      <div className="skeleton es-skel-wave" />
      <div className="es-skel-ticks-y" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton es-skel-tick" style={{ width: 26 }} />
        ))}
      </div>
      <div className="es-skel-ticks-x" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton es-skel-tick" />
        ))}
      </div>
    </div>
  );
}

function ChartState({
  kind,
  height,
  badge,
  onRetry,
  children,
}: {
  kind: "empty" | "error";
  height: number;
  badge: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="es-state" data-kind={kind} style={{ height }} role={kind === "error" ? "alert" : "status"}>
      <div className="es-state-hatch" aria-hidden="true" />
      <div className="es-state-card">
        <span className="es-state-badge">
          <span className="es-state-dot" aria-hidden="true" />
          {badge}
        </span>
        <p className="es-state-text">{children}</p>
        {kind === "error" && onRetry && (
          <button type="button" className="es-btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
