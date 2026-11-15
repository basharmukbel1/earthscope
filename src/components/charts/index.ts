/* EARTHSCOPE chart kit — public surface. */
import "./charts.css";

export { ChartFrame, ChartSkeleton } from "./ChartFrame";
export type { ChartFrameProps, ChartStatus } from "./ChartFrame";

export { ChartTooltip, TooltipHeader, TooltipRows, TooltipRow, TooltipNote, LiveRegion } from "./ChartTooltip";
export type { ChartTooltipProps, TooltipRowProps, TooltipKeyKind } from "./ChartTooltip";

export { ChartLegend, LegendKey } from "./Legend";
export type { ChartLegendProps, LegendItem, LegendKind } from "./Legend";

export { DataTable } from "./DataTable";
export type { DataTableProps, DataCell } from "./DataTable";

export { TimeAxis, ValueAxis, LinearXAxis, AxisTitle, timeTicks, valueTicks, formatTimeTick, leftMarginFor, crisp } from "./axes";
export type { Margin, TimeTicks, ValueTicks } from "./axes";

export { useChartSize } from "./useChartSize";
export type { ChartSizeOptions, ChartSize } from "./useChartSize";

export * from "./format";
export {
  C as CHART_COLORS,
  CATEGORICAL,
  DIVERGING,
  ORDINAL_DARK,
  ORDINAL_LIGHT,
  TREND_GLYPH,
  trendColor,
  seriesColor,
  ordinalRamp,
  divergingColor,
  mixOklab,
  textOnFill,
} from "./palette";

export { TimeSeriesChart } from "./TimeSeriesChart";
export type { TimeSeriesChartProps, TimeSeriesSpec, TrendOverlay, TimeMarker, SeriesVariant } from "./TimeSeriesChart";

export { AnomalyChart } from "./AnomalyChart";
export type { AnomalyChartProps } from "./AnomalyChart";

export { SeasonalCycleChart } from "./SeasonalCycleChart";
export type { SeasonalCycleChartProps, SeasonalPeriod } from "./SeasonalCycleChart";

export { ScatterChart } from "./ScatterChart";
export type { ScatterChartProps, ScatterPoint, ScatterFit } from "./ScatterChart";

export { CorrelationMatrix } from "./CorrelationMatrix";
export type { CorrelationMatrixProps } from "./CorrelationMatrix";

export { LagChart } from "./LagChart";
export type { LagChartProps, LagRow } from "./LagChart";

export { ForestPlot } from "./ForestPlot";
export type { ForestPlotProps, ForestRow } from "./ForestPlot";

export { Sparkline } from "./Sparkline";
export type { SparklineProps } from "./Sparkline";
