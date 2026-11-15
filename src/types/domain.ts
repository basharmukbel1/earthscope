/* ==========================================================================
   EARTHSCOPE — shared domain types (the contract between services, stats,
   charts, the Earth engine and pages).
   ========================================================================== */

export type Category = "atmosphere" | "land" | "water" | "ocean";

/** How the app can obtain a time series for a variable. */
export type Connector =
  | { kind: "power"; parameter: string; startYear: number; note?: string } // live, in-app (NASA POWER API)
  | { kind: "bundled"; snapshotIds: string[]; tools: ExternalTool[]; note?: string } // real bundled snapshots + import
  | { kind: "import"; tools: ExternalTool[]; note?: string }; // analyse after export from Giovanni/AppEEARS/etc.

export type ExternalTool =
  | "giovanni"
  | "appeears"
  | "hydrology"
  | "cdo"
  | "knmi"
  | "nsidc"
  | "worldview"
  | "podaac"
  | "ornl"
  | "csa"
  | "giss";

/** A satellite / model product that measures this variable (catalog information). */
export interface ProductInfo {
  product: string; // "GPM IMERG Final Run, monthly (GPM_3IMERGM v07)"
  mission: string; // "GPM Core Observatory + constellation"
  kind: "satellite" | "reanalysis" | "model" | "in-situ";
  temporal: string;
  spatial: string;
  timeRange: string;
  access: ExternalTool[];
}

export interface Variable {
  id: string; // stable slug e.g. "t2m"
  name: string; // "Air temperature (2 m)"
  shortName: string; // "T2M"
  category: Category;
  /** Plain-language definition for high-school / college users. */
  definition: string;
  /** Why it is useful as a change indicator. */
  whyItMatters: string;
  unit: string; // display unit, e.g. "°C"
  /** Dataset / product identity (real NASA product names). */
  dataset: {
    product: string; // "MERRA-2 (M2TMNXSLV)"
    source: string; // "NASA GMAO MERRA-2 reanalysis"
    mission: string; // "MERRA-2 model" | "Terra & Aqua / MODIS"
    kind: "satellite" | "reanalysis" | "model" | "in-situ";
    temporal: string; // "Monthly"
    spatial: string; // "0.5° × 0.625°"
    timeRange: string; // "1981 – present"
    coverage: string; // "Global, land + ocean"
    doiOrUrl?: string;
  };
  connector: Connector;
  /** Satellite / model products that measure this variable (shown in Discovery). */
  products: ProductInfo[];
  /** Data-quality caveats shown next to results (e.g. observing-system changes). */
  caveats?: string[];
  /** Matching GIBS layer id for imagery context (may be undefined). */
  gibsLayer?: string;
  /** Keywords used by the natural-language question parser and search. */
  keywords: string[];
  /** Aggregation used when building annual values. */
  annualAgg: "mean" | "sum";
  /** Converts the raw monthly value (e.g. mm/day) into an annual total when annualAgg = "sum". */
  annualSumFactor?: "daysInMonth";
  /** Interval-scale quantity (e.g. °C): "% of mean" is meaningless and is hidden. */
  intervalScale?: boolean;
  /** Sensible y-axis decimals. */
  decimals: number;
}

export type RegionKind = "country" | "named" | "bbox" | "point";

export interface BBox {
  west: number; // -180..180
  south: number; // -90..90
  east: number; // -180..180 (may be < west when crossing the antimeridian)
  north: number;
}

export interface Region {
  id: string;
  name: string;
  kind: RegionKind;
  bbox: BBox;
  /** Centroid [lon, lat]. */
  center: [number, number];
  /** Country id (world-atlas numeric id as string) when kind === "country". */
  countryId?: string;
  /** Short descriptive context (e.g. "Hot desert; winter-rain regime"). */
  context?: string;
}

export interface Point {
  /** Decimal-year time coordinate (e.g. 2001.0417 for Jan 2001 mid-month). */
  t: number;
  /** ISO month "YYYY-MM" or day "YYYY-MM-DD". */
  date: string;
  /** null = missing observation. */
  v: number | null;
}

export type SeriesResolution = "monthly" | "annual" | "daily";

export interface SeriesProvenance {
  /** "NASA POWER API (MERRA-2 reanalysis)" | "Giovanni CSV import" ... */
  source: string;
  /** "live" = fetched this session; "snapshot" = bundled real data; "import" = user file; "simulation" = synthetic teaching data. */
  mode: "live" | "snapshot" | "import" | "simulation";
  retrieved?: string; // ISO date
  url?: string;
  /** Spatial sampling description e.g. "Area mean of 42 of 56 grid cells (0.5°×0.625°)". */
  sampling?: string;
  cellsUsed?: number;
  cellsTotal?: number;
  notes?: string[];
}

export interface TimeSeries {
  id: string;
  variableId: string;
  regionId: string;
  label: string;
  unit: string;
  resolution: SeriesResolution;
  points: Point[];
  provenance: SeriesProvenance;
}

/* ---------------------------- statistics --------------------------------- */

export type TrendDirection = "increasing" | "decreasing" | "no-trend";

export interface OlsResult {
  method: "ols";
  n: number;
  slope: number; // units per year
  intercept: number;
  se: number;
  t: number;
  df: number;
  p: number;
  ciLow: number; // slope CI (units/yr)
  ciHigh: number;
  r2: number;
  /** lag-1 autocorrelation of residuals and effective sample size, when adjusted */
  r1?: number;
  nEff?: number;
  adjusted: boolean;
}

export interface MannKendallResult {
  method: "mann-kendall";
  n: number;
  s: number;
  varS: number;
  z: number;
  p: number;
  tau: number;
}

export interface SenResult {
  method: "sen";
  n: number;
  slope: number; // units per year
  intercept: number;
  ciLow: number;
  ciHigh: number;
}

export interface SeasonalKendallResult {
  method: "seasonal-kendall";
  n: number;
  s: number;
  varS: number;
  z: number;
  p: number;
  slope: number; // seasonal Sen slope, units per year
}

export interface TrendSummary {
  direction: TrendDirection;
  significant: boolean;
  alpha: number;
  /** Primary slope in units/decade. */
  perDecade: number;
  perDecadeCi: [number, number];
  /** Total change over the record (units). */
  totalChange: number;
  /** Change relative to the long-term mean, % per decade (null when mean ~ 0). */
  pctPerDecade: number | null;
  p: number;
  method: string;
  /** Weatherhead et al. (1998) estimate of years needed to detect this trend. */
  yearsToDetect: number | null;
}

export interface AnalysisResult {
  seriesId: string;
  variableId: string;
  regionId: string;
  unit: string;
  startYear: number;
  endYear: number;
  nMonths: number;
  nMissing: number;
  missingPct: number;
  mean: number;
  /** Deseasonalised monthly anomalies (used by OLS-AR1 / correlation). */
  anomalies: Point[];
  annual: Point[];
  climatology: number[]; // 12 values
  ols: OlsResult; // on monthly anomalies, AR(1)-adjusted
  olsAnnual: OlsResult;
  mk: MannKendallResult; // on annual values
  sen: SenResult; // on annual values
  seasonalKendall?: SeasonalKendallResult;
  summary: TrendSummary;
  computedAt: string;
}

/* ---------------------------- investigations ----------------------------- */

export type MethodId = "ols" | "mann-kendall" | "sen" | "ci" | "seasonal";

export interface InvestigationConfig {
  id: string;
  question: string;
  variableIds: string[];
  regions: Region[];
  startYear: number;
  endYear: number;
  resolution: "monthly";
  methods: MethodId[];
  alpha: number;
  createdAt: string;
  demoId?: string;
}

/* ---------------------------- earth layers ------------------------------- */

export interface GibsLayerMeta {
  id: string; // GIBS identifier
  title: string;
  variableId?: string;
  category: Category | "base";
  format: "image/png" | "image/jpeg";
  /** Inclusive ISO dates; undefined = static layer. */
  start?: string;
  end?: string;
  period?: "P1M" | "P1D" | "P8D" | "P16D" | "P1Y" | string;
  legendUrl?: string;
  units?: string;
  description?: string;
}

/** Real trend marker computed by scripts/build-atlas (NASA POWER). */
export interface AtlasPoint {
  lon: number;
  lat: number;
  /** slope per decade */
  slope: number;
  p: number;
  /** passes Benjamini–Hochberg FDR control */
  sig: boolean;
  mean: number;
  land: boolean;
}

export interface AtlasLayer {
  variableId: string;
  parameter: string;
  unit: string; // slope unit per decade
  startYear: number;
  endYear: number;
  method: string;
  fdrAlpha: number;
  retrieved: string;
  source: string;
  points: AtlasPoint[];
}
