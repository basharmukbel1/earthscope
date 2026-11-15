import type { Category, ExternalTool, Variable } from "@/types/domain";

/* ==========================================================================
   Variable catalog.
   - `dataset` describes what EARTHSCOPE analyses in-app for this variable.
   - `products` lists the satellite / model products that measure it (from the
     challenge background: MODIS, OMI, AIRS, GPM, MERRA-2, GLDAS, + partners).
   - `connector` says honestly how a time series is obtained:
       power   → fetched live from the NASA POWER API (MERRA-2 / CERES based)
       bundled → real snapshot shipped with the app + import route
       import  → export a CSV from Giovanni / AppEEARS / … and import it
   ========================================================================== */

const POWER_MERRA = {
  source: "NASA POWER API · MERRA-2 reanalysis (NASA GMAO)",
  mission: "MERRA-2 (assimilates satellite + in-situ observations)",
  kind: "reanalysis" as const,
  temporal: "Monthly (from hourly)",
  spatial: "0.5° × 0.625° grid",
  coverage: "Global · land + ocean",
  doiOrUrl: "https://power.larc.nasa.gov/",
};

export const VARIABLES: Variable[] = [
  /* ------------------------------ ATMOSPHERE ------------------------------ */
  {
    id: "global-temp",
    name: "Global surface temperature anomaly",
    shortName: "GISTEMP",
    category: "atmosphere",
    definition:
      "How much warmer or cooler the whole planet's surface (land air + sea surface) is compared with its 1951–1980 average, in °C. NASA's longest temperature record, back to 1880.",
    whyItMatters: "The headline indicator of global climate change; a reference to compare any regional warming rate against.",
    unit: "°C anomaly vs 1951–1980",
    dataset: {
      source: "NASA GISS Surface Temperature Analysis (GISTEMP v4) — bundled snapshot",
      product: "GISTEMP v4 Land-Ocean Temperature Index (GLB.Ts+dSST)",
      mission: "GHCN v4 weather stations + ERSST v5 ships and buoys",
      kind: "in-situ",
      temporal: "Monthly",
      spatial: "Global mean",
      timeRange: "1880 – present",
      coverage: "Global",
      doiOrUrl: "https://data.giss.nasa.gov/gistemp/",
    },
    connector: { kind: "bundled", snapshotIds: ["gistemp-global-monthly"], tools: ["giss"] },
    products: [
      { product: "GISTEMP v4 Land-Ocean Temperature Index", mission: "NASA GISS (stations + ships/buoys)", kind: "in-situ", temporal: "Monthly", spatial: "2° grid / global mean", timeRange: "1880 – present", access: ["giss"] },
    ],
    intervalScale: true,
    keywords: ["global temperature", "global warming", "gistemp", "planet", "whole earth", "worldwide"],
    annualAgg: "mean",
    decimals: 2,
  },
  {
    id: "t2m",
    name: "Air temperature",
    shortName: "T2M",
    category: "atmosphere",
    definition:
      "How warm the air is about 2 meters above the ground — the temperature you would feel standing outside, averaged over each month.",
    whyItMatters:
      "The most direct indicator of a warming or cooling climate. Regional rates differ a lot: the Arctic and continental interiors warm faster than the oceans.",
    unit: "°C",
    dataset: { ...POWER_MERRA, product: "MERRA-2 2-m air temperature (T2M, via POWER)", timeRange: "1981 – 2025" },
    connector: { kind: "power", parameter: "T2M", startYear: 1981 },
    products: [
      { product: "MERRA-2 single-level diagnostics (M2TMNXSLV)", mission: "MERRA-2 reanalysis", kind: "reanalysis", temporal: "Monthly", spatial: "0.5° × 0.625°", timeRange: "1980 – present", access: ["giovanni"] },
      { product: "AIRS surface air temperature (AIRS3STM)", mission: "Aqua / AIRS", kind: "satellite", temporal: "Monthly", spatial: "1°", timeRange: "Sep 2002 – present", access: ["giovanni"] },
      { product: "GLDAS Noah air temperature (Tair_f_inst)", mission: "GLDAS land model", kind: "model", temporal: "Monthly", spatial: "0.25°", timeRange: "2000 – present", access: ["giovanni", "hydrology"] },
    ],
    gibsLayer: "MERRA2_2m_Air_Temperature_Monthly",
    keywords: ["temperature", "warming", "warm", "heat", "hot", "cold", "cooling", "air", "climate", "t2m"],
    annualAgg: "mean",
    intervalScale: true,
    decimals: 2,
  },
  {
    id: "ozone",
    name: "Total column ozone",
    shortName: "TO3",
    category: "atmosphere",
    definition:
      "The total amount of ozone gas in a column of air from the ground to the top of the atmosphere, measured in Dobson Units (DU). Most of it sits in the stratosphere and shields life from ultraviolet light.",
    whyItMatters:
      "Tracks ozone depletion and the slow recovery expected after the Montreal Protocol. The Antarctic ozone hole is a strongly seasonal (spring) signal.",
    unit: "DU",
    dataset: { ...POWER_MERRA, product: "MERRA-2 total column ozone (TO3, via POWER)", timeRange: "1981 – 2025" },
    connector: { kind: "power", parameter: "TO3", startYear: 1981 },
    products: [
      { product: "OMI total ozone (OMTO3e)", mission: "Aura / OMI", kind: "satellite", temporal: "Daily", spatial: "0.25°", timeRange: "Oct 2004 – present", access: ["giovanni"] },
      { product: "OMPS total ozone", mission: "Suomi NPP / NOAA-20 OMPS", kind: "satellite", temporal: "Daily", spatial: "1°", timeRange: "2012 – present", access: ["giovanni", "worldview"] },
    ],
    caveats: [
      "MERRA-2 ozone assimilates SBUV until 2004 and OMI + MLS afterwards; an observing-system change near 2004–2005 can affect long-term trends.",
    ],
    gibsLayer: "OMI_Ozone_TOMS_Total_Column",
    keywords: ["ozone", "ozone hole", "uv", "ultraviolet", "stratosphere", "montreal", "to3", "omi"],
    annualAgg: "mean",
    decimals: 1,
  },
  {
    id: "aod",
    name: "Aerosol optical depth",
    shortName: "AOD 550 nm",
    category: "atmosphere",
    definition:
      "How much sunlight is blocked by particles suspended in the air — dust, smoke, sea salt and pollution haze. 0 means perfectly clear; values above ~0.5 mean very hazy air.",
    whyItMatters:
      "Reveals rising or falling air pollution, dust storms and wildfire smoke. Aerosols also cool the surface by reflecting sunlight.",
    unit: "unitless",
    dataset: {
      ...POWER_MERRA,
      source: "NASA POWER API · radiation inputs (CERES SYN1deg / MERRA-2 aerosol)",
      product: "Aerosol optical depth at 550 nm (AOD_55, via POWER)",
      timeRange: "2001 – 2025",
      spatial: "1° (radiation grid)",
    },
    connector: { kind: "power", parameter: "AOD_55", startYear: 2001, note: "POWER provides AOD from 2001 onward." },
    products: [
      { product: "MODIS atmosphere monthly L3 (MOD08_M3 / MYD08_M3)", mission: "Terra & Aqua / MODIS", kind: "satellite", temporal: "Monthly", spatial: "1°", timeRange: "2000 – present", access: ["giovanni"] },
      { product: "MERRA-2 aerosol diagnostics (M2TMNXAER)", mission: "MERRA-2 reanalysis", kind: "reanalysis", temporal: "Monthly", spatial: "0.5° × 0.625°", timeRange: "1980 – present", access: ["giovanni"] },
      { product: "OMI aerosol index (OMAERUVd)", mission: "Aura / OMI", kind: "satellite", temporal: "Daily", spatial: "1°", timeRange: "Oct 2004 – present", access: ["giovanni"] },
    ],
    gibsLayer: "MERRA2_Aerosol_Optical_Depth_Analysis_Monthly",
    keywords: ["aerosol", "aerosols", "pollution", "haze", "smog", "dust", "smoke", "particles", "air quality", "aod"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "water-vapor",
    name: "Atmospheric water vapor",
    shortName: "TQV",
    category: "atmosphere",
    definition:
      "All the invisible water vapor in a column of air, expressed as the depth of water (kg per m² ≈ mm) you would get if it all condensed.",
    whyItMatters:
      "Warmer air holds more moisture (~7% per °C). Rising water vapor amplifies warming and fuels heavier rainfall.",
    unit: "kg m⁻²",
    dataset: { ...POWER_MERRA, product: "MERRA-2 total precipitable water vapor (TQV, via POWER)", timeRange: "1981 – 2025" },
    connector: { kind: "power", parameter: "TQV", startYear: 1981 },
    products: [
      { product: "AIRS total precipitable water (AIRS3STM)", mission: "Aqua / AIRS", kind: "satellite", temporal: "Monthly", spatial: "1°", timeRange: "Sep 2002 – present", access: ["giovanni"] },
      { product: "MERRA-2 TQV (M2TMNXSLV)", mission: "MERRA-2 reanalysis", kind: "reanalysis", temporal: "Monthly", spatial: "0.5° × 0.625°", timeRange: "1980 – present", access: ["giovanni"] },
    ],
    gibsLayer: "MERRA2_Total_Precipitable_Water_Vapor_Monthly",
    keywords: ["water vapor", "vapour", "humidity", "moisture", "humid", "precipitable", "tqv", "airs"],
    annualAgg: "mean",
    decimals: 2,
  },

  /* --------------------------------- LAND --------------------------------- */
  {
    id: "ndvi",
    name: "Vegetation greenness (NDVI)",
    shortName: "NDVI",
    category: "land",
    definition:
      "The Normalized Difference Vegetation Index compares red and near-infrared light reflected by the surface. Healthy green plants score high (0.6–0.9); bare soil and deserts score low (< 0.2).",
    whyItMatters:
      "Shows greening (longer growing seasons, irrigation, CO₂ fertilisation) or browning (drought, deforestation, land degradation).",
    unit: "NDVI (unitless)",
    dataset: {
      source: "MODIS (ORNL DAAC Land Product Subsets) / your Giovanni or AppEEARS export",
      product: "MODIS Terra vegetation indices (MOD13Q1 / MOD13C2)",
      mission: "Terra / MODIS",
      kind: "satellite",
      temporal: "16-day / monthly",
      spatial: "250 m (MOD13Q1) · 0.05° (MOD13C2)",
      timeRange: "Feb 2000 – present",
      coverage: "Global land",
      doiOrUrl: "https://lpdaac.usgs.gov/products/mod13q1v061/",
    },
    connector: {
      kind: "bundled",
      snapshotIds: ["ndvi-sahel-monthly", "ndvi-rondonia-monthly"],
      tools: ["appeears", "giovanni", "ornl"],
      note: "Two real MODIS MOD13Q1 point records (good-quality pixels only, monthly means) are bundled — a Sahel site and an Amazon-frontier forest pixel. Import an AppEEARS or Giovanni CSV for any other area.",
    },
    products: [
      { product: "MODIS Terra NDVI 16-day 250 m (MOD13Q1 v6.1)", mission: "Terra / MODIS", kind: "satellite", temporal: "16-day", spatial: "250 m", timeRange: "Feb 2000 – present", access: ["appeears", "ornl"] },
      { product: "MODIS Terra NDVI monthly CMG (MOD13C2 v6.1)", mission: "Terra / MODIS", kind: "satellite", temporal: "Monthly", spatial: "0.05°", timeRange: "Feb 2000 – present", access: ["giovanni", "appeears"] },
      { product: "VIIRS NDVI (VNP13A1)", mission: "Suomi NPP / VIIRS", kind: "satellite", temporal: "16-day", spatial: "500 m", timeRange: "2012 – present", access: ["appeears"] },
    ],
    gibsLayer: "MODIS_Terra_L3_NDVI_Monthly",
    keywords: ["vegetation", "ndvi", "greenness", "green", "greening", "browning", "plants", "forest", "deforestation", "crops", "farmland", "desertification", "modis"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "lst",
    name: "Land surface temperature",
    shortName: "LST",
    category: "land",
    definition:
      "The temperature of the ground surface itself (soil, rooftops, canopy) as seen by a satellite's thermal sensor — often much hotter than the air on sunny days.",
    whyItMatters:
      "Reveals urban heat islands, drying soils and heat stress on crops; complements air temperature.",
    unit: "K",
    dataset: {
      source: "Your AppEEARS / Giovanni export",
      product: "MODIS Terra LST monthly (MOD11C3 v6.1)",
      mission: "Terra / MODIS",
      kind: "satellite",
      temporal: "Monthly",
      spatial: "0.05°",
      timeRange: "Mar 2000 – present",
      coverage: "Global land",
      doiOrUrl: "https://lpdaac.usgs.gov/products/mod11c3v061/",
    },
    connector: { kind: "import", tools: ["appeears", "giovanni"], note: "For an in-app model proxy, investigate Air temperature or Surface skin temperature." },
    products: [
      { product: "MODIS Terra LST & emissivity monthly (MOD11C3)", mission: "Terra / MODIS", kind: "satellite", temporal: "Monthly", spatial: "0.05°", timeRange: "Mar 2000 – present", access: ["appeears", "giovanni"] },
      { product: "MODIS Aqua LST (MYD11C3)", mission: "Aqua / MODIS", kind: "satellite", temporal: "Monthly", spatial: "0.05°", timeRange: "Jul 2002 – present", access: ["appeears", "giovanni"] },
    ],
    gibsLayer: "MODIS_Terra_L3_Land_Surface_Temp_Monthly_CMG_Day_TES",
    keywords: ["land surface temperature", "lst", "surface temperature", "urban heat", "heat island", "ground temperature", "thermal"],
    annualAgg: "mean",
    intervalScale: true,
    decimals: 2,
  },
  {
    id: "soil-surface",
    name: "Surface soil moisture",
    shortName: "GWETTOP",
    category: "land",
    definition:
      "How wet the top 5 cm of soil is, from 0 (completely dry) to 1 (completely saturated).",
    whyItMatters:
      "An early-warning sign of drought and a control on crop growth, dust and heat waves. It responds quickly to rain and evaporation.",
    unit: "0–1 (wetness)",
    dataset: { ...POWER_MERRA, product: "MERRA-2 surface soil wetness (GWETTOP, via POWER)", timeRange: "1981 – 2025", coverage: "Global land" },
    connector: { kind: "power", parameter: "GWETTOP", startYear: 1981 },
    products: [
      { product: "SMAP L3 radiometer soil moisture (SPL3SMP)", mission: "SMAP", kind: "satellite", temporal: "Daily", spatial: "36 km", timeRange: "Mar 2015 – present", access: ["appeears", "worldview"] },
      { product: "GLDAS Noah soil moisture 0–10 cm (SoilMoi0_10cm_inst)", mission: "GLDAS land model", kind: "model", temporal: "Monthly", spatial: "0.25°", timeRange: "2000 – present", access: ["giovanni", "hydrology"] },
    ],
    gibsLayer: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture",
    keywords: ["soil moisture", "soil", "drought", "dry", "drying", "wetness", "moisture", "agriculture", "smap", "gldas"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "soil-root",
    name: "Root-zone soil moisture",
    shortName: "GWETROOT",
    category: "land",
    definition:
      "How much water is available to plant roots in roughly the top 1 meter of soil, from 0 (dry) to 1 (saturated).",
    whyItMatters:
      "Changes slowly and integrates months of weather — a good indicator of long-term drying or wetting of a landscape.",
    unit: "0–1 (wetness)",
    dataset: { ...POWER_MERRA, product: "MERRA-2 root-zone soil wetness (GWETROOT, via POWER)", timeRange: "1981 – 2025", coverage: "Global land" },
    connector: { kind: "power", parameter: "GWETROOT", startYear: 1981 },
    products: [
      { product: "SMAP L4 root-zone soil moisture (SPL4SMGP)", mission: "SMAP + land model", kind: "satellite", temporal: "3-hourly", spatial: "9 km", timeRange: "Mar 2015 – present", access: ["appeears", "worldview"] },
      { product: "GLDAS Noah root-zone soil moisture (RootMoist_inst)", mission: "GLDAS land model", kind: "model", temporal: "Monthly", spatial: "0.25°", timeRange: "2000 – present", access: ["giovanni", "hydrology"] },
    ],
    caveats: ["Root-zone moisture is strongly autocorrelated month to month — EARTHSCOPE's AR(1)-adjusted test accounts for this."],
    gibsLayer: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture",
    keywords: ["root zone", "root-zone", "subsoil", "deep soil", "plant water", "groundwater"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "evap",
    name: "Evapotranspiration",
    shortName: "EVLAND",
    category: "land",
    definition:
      "Water leaving the land surface into the air — evaporation from soil and water plus transpiration from plants — expressed in mm of water.",
    whyItMatters:
      "Links the water and energy cycles: rising evaporation can dry soils even when rainfall is unchanged.",
    unit: "mm/day",
    dataset: { ...POWER_MERRA, product: "MERRA-2 land evaporation (EVLAND, via POWER)", timeRange: "1981 – 2025", coverage: "Global land" },
    connector: { kind: "power", parameter: "EVLAND", startYear: 1981 },
    products: [
      { product: "MODIS evapotranspiration (MOD16A2GF)", mission: "Terra / MODIS", kind: "satellite", temporal: "8-day", spatial: "500 m", timeRange: "2001 – present", access: ["appeears"] },
      { product: "GLDAS Noah evapotranspiration (Evap_tavg)", mission: "GLDAS land model", kind: "model", temporal: "Monthly", spatial: "0.25°", timeRange: "2000 – present", access: ["giovanni", "hydrology"] },
    ],
    gibsLayer: "MERRA2_Evaporation_Land_Monthly",
    keywords: ["evapotranspiration", "evaporation", "transpiration", "et", "water loss"],
    annualAgg: "sum",
    annualSumFactor: "daysInMonth",
    decimals: 2,
  },

  /* --------------------------------- WATER -------------------------------- */
  {
    id: "precip",
    name: "Precipitation",
    shortName: "PRECTOTCORR",
    category: "water",
    definition:
      "Rain and snow reaching the ground. EARTHSCOPE reports the monthly average rate (mm per day) and converts it to annual totals (mm per year) for trend testing.",
    whyItMatters:
      "Decides water availability, floods and droughts. Precipitation trends often have opposite signs in neighbouring regions as storm tracks and monsoons shift.",
    unit: "mm/day",
    dataset: { ...POWER_MERRA, product: "MERRA-2 bias-corrected precipitation (PRECTOTCORR, via POWER)", timeRange: "1981 – 2025" },
    connector: { kind: "power", parameter: "PRECTOTCORR", startYear: 1981 },
    products: [
      { product: "GPM IMERG Final Run monthly (GPM_3IMERGM v07)", mission: "GPM Core Observatory + partner constellation", kind: "satellite", temporal: "Monthly", spatial: "0.1°", timeRange: "Jun 2000 – present", access: ["giovanni"] },
      { product: "MERRA-2 corrected precipitation (M2TMNXFLX PRECTOTCORR)", mission: "MERRA-2 reanalysis", kind: "reanalysis", temporal: "Monthly", spatial: "0.5° × 0.625°", timeRange: "1980 – present", access: ["giovanni"] },
      { product: "NOAA GHCN-Daily station records", mission: "In-situ rain gauges", kind: "in-situ", temporal: "Daily", spatial: "Stations", timeRange: "Varies (1800s – present)", access: ["cdo"] },
    ],
    caveats: ["In very dry regions many months have ~0 mm, so EARTHSCOPE tests annual totals and reports % change per decade."],
    gibsLayer: "MERRA2_Precipitation_Bias_Corrected_Monthly",
    keywords: ["precipitation", "rain", "rainfall", "snowfall", "drought", "wet", "monsoon", "flood", "precip", "gpm", "imerg"],
    annualAgg: "sum",
    annualSumFactor: "daysInMonth",
    decimals: 2,
  },
  {
    id: "runoff",
    name: "Surface runoff",
    shortName: "Qs",
    category: "water",
    definition:
      "Rain or snowmelt that flows over the land surface toward streams instead of soaking in, from the GLDAS land-surface model.",
    whyItMatters: "Connects rainfall to streamflow and flood risk; changes with land use and soil saturation.",
    unit: "kg m⁻²",
    dataset: {
      source: "Your Hydrology Time Series / Giovanni export",
      product: "GLDAS Noah land surface model L4 monthly (GLDAS_NOAH025_M v2.1), Qs_acc",
      mission: "GLDAS land model",
      kind: "model",
      temporal: "Monthly",
      spatial: "0.25°",
      timeRange: "Jan 2000 – present (GLDAS-2.0: 1948 – 2014)",
      coverage: "Global land (60°S – 90°N)",
      doiOrUrl: "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_M_2.1/summary",
    },
    connector: { kind: "import", tools: ["hydrology", "giovanni"] },
    products: [
      { product: "GLDAS Noah 2.1 monthly surface runoff (Qs_acc)", mission: "GLDAS land model", kind: "model", temporal: "Monthly", spatial: "0.25°", timeRange: "2000 – present", access: ["giovanni", "hydrology"] },
      { product: "NLDAS-2 runoff (North America)", mission: "NLDAS land model", kind: "model", temporal: "Hourly / monthly", spatial: "0.125°", timeRange: "1979 – present", access: ["hydrology", "giovanni"] },
    ],
    keywords: ["runoff", "streamflow", "river", "flood", "discharge", "flow", "hydrology", "gldas"],
    annualAgg: "sum",
    decimals: 2,
  },
  {
    id: "water-storage",
    name: "Terrestrial water storage",
    shortName: "TWS / LWE",
    category: "water",
    definition:
      "Changes in all water stored on and below the land — groundwater, soil water, lakes, snow and ice — measured by tiny changes in Earth's gravity, as an equivalent water thickness in cm.",
    whyItMatters:
      "The only global view of groundwater depletion; reveals aquifers being over-pumped and ice sheets losing mass.",
    unit: "cm (LWE)",
    dataset: {
      source: "Your PO.DAAC / Giovanni export",
      product: "GRACE & GRACE-FO JPL mascon RL06.3 (TELLUS_GRAC-GRFO_MASCON_CRI)",
      mission: "GRACE (2002–2017) & GRACE-FO (2018 – present)",
      kind: "satellite",
      temporal: "Monthly",
      spatial: "0.5° grid (≈3° mascons)",
      timeRange: "Apr 2002 – present (gap Jul 2017 – May 2018)",
      coverage: "Global",
      doiOrUrl: "https://grace.jpl.nasa.gov/data/get-data/jpl_global_mascons/",
    },
    connector: { kind: "import", tools: ["podaac", "giovanni"], note: "Expect a ~11-month gap between the GRACE and GRACE-FO missions." },
    products: [
      { product: "JPL GRACE/GRACE-FO mascon CRI", mission: "GRACE & GRACE-FO", kind: "satellite", temporal: "Monthly", spatial: "0.5°", timeRange: "Apr 2002 – present", access: ["podaac"] },
    ],
    gibsLayer: "GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI",
    keywords: ["groundwater", "water storage", "aquifer", "grace", "gravity", "water table", "depletion", "ice sheet", "mass loss"],
    annualAgg: "mean",
    decimals: 2,
  },
  {
    id: "snow",
    name: "Snow depth",
    shortName: "SNODP",
    category: "water",
    definition: "The depth of snow lying on the ground, averaged over each month.",
    whyItMatters:
      "Snowpack is a natural reservoir for many rivers; declining snow can mean less water in summer.",
    unit: "cm",
    dataset: { ...POWER_MERRA, product: "MERRA-2 snow depth (SNODP, via POWER)", timeRange: "1981 – 2025", coverage: "Global land" },
    connector: { kind: "power", parameter: "SNODP", startYear: 1981 },
    products: [
      { product: "MODIS snow cover (MOD10CM)", mission: "Terra / MODIS", kind: "satellite", temporal: "Monthly", spatial: "0.05°", timeRange: "2000 – present", access: ["appeears"] },
    ],
    keywords: ["snow", "snowpack", "snow depth", "winter", "glacier", "mountains"],
    annualAgg: "mean",
    decimals: 2,
  },
  {
    id: "surface-water",
    name: "Surface water elevation",
    shortName: "SWOT WSE",
    category: "water",
    definition:
      "The height of the water surface of lakes, rivers and reservoirs measured by radar interferometry from space.",
    whyItMatters: "Tracks reservoirs and lakes rising or falling — only a few years of record so far, too short for robust trends.",
    unit: "m",
    dataset: {
      source: "PO.DAAC (SWOT is led by NASA and CNES with CSA and UKSA)",
      product: "SWOT Level-2 river & lake products",
      mission: "SWOT",
      kind: "satellite",
      temporal: "~21-day repeat",
      spatial: "~100 m",
      timeRange: "2023 – present",
      coverage: "~90% of Earth's surface water",
      doiOrUrl: "https://www.asc-csa.gc.ca/eng/satellites/swot/",
    },
    connector: { kind: "import", tools: ["podaac", "csa"], note: "Record is short: trends are unlikely to be significant yet." },
    products: [
      { product: "SWOT L2 HR LakeSP / RiverSP", mission: "SWOT (NASA · CNES · CSA · UKSA)", kind: "satellite", temporal: "~21-day", spatial: "~100 m", timeRange: "2023 – present", access: ["podaac"] },
    ],
    keywords: ["lake", "reservoir", "river height", "water level", "swot", "surface water"],
    annualAgg: "mean",
    decimals: 2,
  },

  /* --------------------------------- OCEAN -------------------------------- */
  {
    id: "sst",
    name: "Sea surface temperature",
    shortName: "SST (skin)",
    category: "ocean",
    definition:
      "The temperature of the ocean's surface. In-app series use MERRA-2 surface skin temperature, which over open ocean follows the sea surface temperature.",
    whyItMatters: "Ocean warming drives coral bleaching, stronger storms, sea-level rise and marine-heatwave events.",
    unit: "°C",
    dataset: {
      ...POWER_MERRA,
      product: "MERRA-2 surface skin temperature (TS, via POWER) — ocean regions",
      timeRange: "1981 – 2025",
      coverage: "Global (choose an ocean region)",
    },
    connector: {
      kind: "power",
      parameter: "TS",
      startYear: 1981,
      note: "Over land TS is the ground skin temperature — select an ocean region for SST.",
    },
    products: [
      { product: "MODIS-Aqua L3 SST (thermal IR, 4 km)", mission: "Aqua / MODIS", kind: "satellite", temporal: "Monthly", spatial: "4 km", timeRange: "Jul 2002 – present", access: ["giovanni", "podaac"] },
      { product: "GHRSST MUR L4 SST", mission: "Multi-sensor blend", kind: "satellite", temporal: "Daily", spatial: "0.01°", timeRange: "Jun 2002 – present", access: ["podaac", "worldview"] },
    ],
    gibsLayer: "MODIS_Aqua_L3_SST_Thermal_4km_Day_Monthly",
    keywords: ["sea surface temperature", "sst", "ocean temperature", "ocean warming", "marine heatwave", "coral", "sea"],
    annualAgg: "mean",
    intervalScale: true,
    decimals: 2,
  },
  {
    id: "chlorophyll",
    name: "Chlorophyll-a",
    shortName: "chlor_a",
    category: "ocean",
    definition:
      "The concentration of the green pigment of phytoplankton — microscopic ocean plants — estimated from the color of the sea.",
    whyItMatters:
      "Phytoplankton are the base of the marine food web; trends show changing productivity, river nutrient runoff and algal blooms.",
    unit: "mg m⁻³",
    dataset: {
      source: "Your Giovanni / OB.DAAC export",
      product: "MODIS-Aqua L3 mapped chlorophyll-a (chlor_a)",
      mission: "Aqua / MODIS (SeaWiFS 1997–2010, PACE OCI 2024–)",
      kind: "satellite",
      temporal: "Monthly",
      spatial: "4 km / 9 km",
      timeRange: "Jul 2002 – present",
      coverage: "Global ocean",
      doiOrUrl: "https://oceancolor.gsfc.nasa.gov/",
    },
    connector: {
      kind: "import",
      tools: ["giovanni"],
      note: "See the SeaWiFS chlorophyll time-series paper in Resources for a worked significance-testing example.",
    },
    products: [
      { product: "MODIS-Aqua L3m chlor_a", mission: "Aqua / MODIS", kind: "satellite", temporal: "Monthly", spatial: "4 km", timeRange: "Jul 2002 – present", access: ["giovanni"] },
      { product: "SeaWiFS L3m chlor_a", mission: "OrbView-2 / SeaWiFS", kind: "satellite", temporal: "Monthly", spatial: "9 km", timeRange: "Sep 1997 – Dec 2010", access: ["giovanni"] },
      { product: "PACE OCI chlorophyll-a", mission: "PACE / OCI", kind: "satellite", temporal: "Daily / monthly", spatial: "4 km", timeRange: "2024 – present", access: ["worldview"] },
    ],
    gibsLayer: "MODIS_Aqua_L2_Chlorophyll_A",
    keywords: ["chlorophyll", "phytoplankton", "algae", "algal bloom", "ocean productivity", "plankton", "seawifs"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "ocean-color",
    name: "Ocean color · water clarity (Kd490)",
    shortName: "Kd_490",
    category: "ocean",
    definition:
      "How quickly blue-green light (490 nm) fades with depth. Higher values mean murkier water — from sediment, plankton or river plumes.",
    whyItMatters: "Tracks coastal sediment plumes, river discharge and water quality in estuaries.",
    unit: "m⁻¹",
    dataset: {
      source: "Your Giovanni / OB.DAAC export",
      product: "MODIS-Aqua L3 mapped diffuse attenuation (Kd_490)",
      mission: "Aqua / MODIS",
      kind: "satellite",
      temporal: "Monthly",
      spatial: "4 km",
      timeRange: "Jul 2002 – present",
      coverage: "Global ocean",
      doiOrUrl: "https://oceancolor.gsfc.nasa.gov/",
    },
    connector: { kind: "import", tools: ["giovanni"] },
    products: [
      { product: "MODIS-Aqua L3m Kd_490", mission: "Aqua / MODIS", kind: "satellite", temporal: "Monthly", spatial: "4 km", timeRange: "Jul 2002 – present", access: ["giovanni"] },
    ],
    keywords: ["ocean color", "water clarity", "turbidity", "sediment", "estuary", "kd490", "murky"],
    annualAgg: "mean",
    decimals: 3,
  },
  {
    id: "sea-ice",
    name: "Sea-ice extent",
    shortName: "Extent",
    category: "ocean",
    definition:
      "The area of ocean covered by at least 15% sea ice, measured by satellite passive-microwave sensors since late 1978.",
    whyItMatters:
      "One of the clearest signals of a warming Arctic: September (end-of-summer) extent has fallen dramatically since the 1980s.",
    unit: "million km²",
    dataset: {
      source: "NSIDC Sea Ice Index (G02135) — bundled snapshot",
      product: "Sea Ice Index monthly extent (G02135)",
      mission: "Nimbus-7 SMMR, DMSP SSM/I & SSMIS",
      kind: "satellite",
      temporal: "Monthly",
      spatial: "25 km",
      timeRange: "Nov 1978 – present",
      coverage: "Arctic & Antarctic",
      doiOrUrl: "https://nsidc.org/data/g02135",
    },
    connector: { kind: "bundled", snapshotIds: ["sea-ice-extent-arctic-monthly", "sea-ice-extent-antarctic-monthly"], tools: ["nsidc", "csa"] },
    products: [
      { product: "NSIDC Sea Ice Index (G02135)", mission: "Passive microwave (SMMR, SSM/I, SSMIS)", kind: "satellite", temporal: "Daily / monthly", spatial: "25 km", timeRange: "Nov 1978 – present", access: ["nsidc"] },
      { product: "AMSR2 sea-ice concentration", mission: "GCOM-W1 / AMSR2 (JAXA)", kind: "satellite", temporal: "Daily", spatial: "12.5 km", timeRange: "2012 – present", access: ["worldview"] },
      { product: "RADARSAT Constellation Mission (RCM) ice imagery", mission: "RCM (Canadian Space Agency)", kind: "satellite", temporal: "Daily revisits", spatial: "3 – 100 m (SAR)", timeRange: "2019 – present", access: ["csa"] },
    ],
    gibsLayer: "AMSRU2_Sea_Ice_Concentration_12km",
    keywords: ["sea ice", "arctic", "ice", "polar", "melting", "antarctic", "ice extent", "nsidc"],
    annualAgg: "mean",
    decimals: 2,
  },
];

export const VARIABLE_BY_ID: Record<string, Variable> = Object.fromEntries(VARIABLES.map((v) => [v.id, v]));

export const getVariable = (id: string): Variable | undefined => VARIABLE_BY_ID[id];

export const CATEGORIES: { id: Category; label: string; blurb: string; code: string }[] = [
  { id: "atmosphere", label: "Atmosphere", code: "ATM", blurb: "Temperature, ozone, aerosols and water vapor in the air above us." },
  { id: "land", label: "Land", code: "LND", blurb: "Vegetation, soils, surface heat and the water plants send back to the sky." },
  { id: "water", label: "Water", code: "H2O", blurb: "Rain, runoff, snow and the water stored beneath our feet." },
  { id: "ocean", label: "Ocean", code: "OCN", blurb: "Sea temperature, ocean color, plankton and polar sea ice." },
];

export const TOOL_INFO: Record<ExternalTool, { label: string; url: string; description: string }> = {
  giovanni: { label: "Giovanni", url: "https://giovanni.gsfc.nasa.gov/", description: "NASA GES DISC tool: area-averaged time series for hundreds of variables; download as CSV." },
  appeears: { label: "AppEEARS", url: "https://appeears.earthdatacloud.nasa.gov/", description: "Extract point or area samples of MODIS, VIIRS, SMAP and more as CSV." },
  hydrology: { label: "Hydrology Time Series", url: "https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series", description: "GES DISC 'data rods' time series for GLDAS, NLDAS and other hydrology models." },
  cdo: { label: "NOAA Climate Data Online", url: "https://www.ncei.noaa.gov/cdo-web/", description: "Historical weather-station records for validating satellite and model trends." },
  knmi: { label: "KNMI Climate Explorer", url: "https://climexp.knmi.nl/", description: "Web tool for exploring and correlating climate datasets; exports text series." },
  nsidc: { label: "NSIDC", url: "https://nsidc.org/data/g02135", description: "National Snow and Ice Data Center — Sea Ice Index." },
  worldview: { label: "NASA Worldview", url: "https://worldview.earthdata.nasa.gov/", description: "Browse full-resolution GIBS satellite imagery by date." },
  podaac: { label: "PO.DAAC", url: "https://podaac.jpl.nasa.gov/", description: "NASA's physical oceanography archive (GRACE, SWOT, SST)." },
  ornl: { label: "ORNL DAAC MODIS subsets", url: "https://modis.ornl.gov/", description: "Point time series of MODIS and VIIRS land products." },
  csa: { label: "Canadian Space Agency", url: "https://www.asc-csa.gc.ca/eng/satellites/", description: "RCM, SWOT and Earth-observation resources from CSA." },
  giss: { label: "NASA GISS GISTEMP", url: "https://data.giss.nasa.gov/gistemp/", description: "NASA Goddard Institute for Space Studies surface temperature analysis." },
};

/** Variables that can be retrieved live in-app. */
export const LIVE_VARIABLES = VARIABLES.filter((v) => v.connector.kind === "power");

/** Missions & models mentioned across the catalog, for the Discovery "missions" rail. */
export const MISSIONS: { name: string; agency: string; kind: string; since: string; measures: string }[] = [
  { name: "MERRA-2", agency: "NASA GMAO", kind: "Reanalysis model", since: "1980", measures: "Temperature, precipitation, soil water, ozone, water vapor" },
  { name: "GLDAS", agency: "NASA GSFC / GES DISC", kind: "Land model", since: "1948 / 2000", measures: "Soil moisture, runoff, evapotranspiration" },
  { name: "MODIS", agency: "NASA · Terra & Aqua", kind: "Imaging spectroradiometer", since: "2000", measures: "Vegetation, land temperature, aerosols, ocean color, SST" },
  { name: "GPM IMERG", agency: "NASA · JAXA", kind: "Precipitation constellation", since: "2000", measures: "Rain and snowfall" },
  { name: "OMI", agency: "NASA · NSO/KNMI (Aura)", kind: "UV/visible spectrometer", since: "2004", measures: "Ozone, aerosol index, NO₂" },
  { name: "AIRS", agency: "NASA · Aqua", kind: "Infrared sounder", since: "2002", measures: "Temperature and water-vapor profiles" },
  { name: "SMAP", agency: "NASA", kind: "L-band radiometer", since: "2015", measures: "Soil moisture, freeze/thaw" },
  { name: "GRACE / GRACE-FO", agency: "NASA · DLR · GFZ", kind: "Gravimetry", since: "2002", measures: "Groundwater & ice-mass change" },
  { name: "SWOT", agency: "NASA · CNES · CSA · UKSA", kind: "Radar interferometer", since: "2023", measures: "Lake, river & ocean surface height" },
  { name: "RCM", agency: "Canadian Space Agency", kind: "C-band SAR constellation", since: "2019", measures: "Sea ice, wetlands, coastal change" },
];
