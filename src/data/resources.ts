/* ==========================================================================
   Every resource listed on the official challenge Resources tab
   (spaceappschallenge.org/2026/challenges/earth-system-trend-detective,
   retrieved 2026-11-15), plus the two NASA services EARTHSCOPE calls directly.
   ========================================================================== */

export interface ResourceItem {
  title: string;
  url: string;
  provider: string;
  group: "nasa" | "partner-general" | "csa" | "integrated";
  description: string;
  /** How EARTHSCOPE uses it. */
  usage: string;
}

export const CHALLENGE_DISCLAIMER =
  "NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites. For non-U.S. Government websites, participants must comply with any data use parameters of that specific website.";

export const RESOURCES: ResourceItem[] = [
  {
    title: "NASA POWER API",
    url: "https://power.larc.nasa.gov/",
    provider: "NASA Langley Research Center",
    group: "integrated",
    description: "Prediction Of Worldwide Energy Resources — global meteorology and solar data derived from MERRA-2 and CERES, served through an open API.",
    usage: "EARTHSCOPE fetches monthly time series live from POWER for every in-app variable (temperature, precipitation, soil moisture, ozone, aerosols, water vapor…) and computed the Trend Atlas from it.",
  },
  {
    title: "NASA GIBS (Global Imagery Browse Services)",
    url: "https://nasa-gibs.github.io/gibs-api-docs/",
    provider: "NASA ESDIS",
    group: "integrated",
    description: "Open imagery service for hundreds of NASA satellite and model layers.",
    usage: "Earth textures (Blue Marble, Black Marble) and the monthly data layers draped on the Earth Explorer globe come from GIBS.",
  },
  {
    title: "Giovanni",
    url: "https://giovanni.gsfc.nasa.gov/",
    provider: "NASA GES DISC",
    group: "nasa",
    description: "Versatile tool that provides menus of numerous data variables, and allows generation of time series and download of the time series data.",
    usage: "Catalog variables link to Giovanni, and EARTHSCOPE imports Giovanni area-averaged time-series CSV files for analysis (IMERG, MODIS, OMI, AIRS, GLDAS…).",
  },
  {
    title: "Hydrology Time Series",
    url: "https://disc.gsfc.nasa.gov/information/tools?title=Hydrology%20Time%20Series",
    provider: "NASA GES DISC",
    group: "nasa",
    description: "Allows generation of time-series with hydrological data.",
    usage: "Recommended route for GLDAS / NLDAS runoff, soil moisture and evapotranspiration; ASCII exports can be imported.",
  },
  {
    title: "AppEEARS",
    url: "https://appeears.earthdatacloud.nasa.gov/",
    provider: "NASA LP DAAC",
    group: "nasa",
    description: "Offers a simple and efficient way to access and transform geospatial data from a variety of federal data archives. Includes time-series generation.",
    usage: "Recommended route for MODIS NDVI, land surface temperature and SMAP; AppEEARS point-sample CSVs can be imported directly.",
  },
  {
    title: "Climate Data Online (CDO)",
    url: "https://www.ncei.noaa.gov/cdo-web/",
    provider: "NOAA NCEI",
    group: "nasa",
    description: "CDO provides free access to NCDC's archive of global historical weather and climate data in addition to station history information. This site includes a mapping tool.",
    usage: "Use station records to validate satellite/model trends; CDO CSV exports can be imported.",
  },
  {
    title: "Time-Series Analysis of Remotely-Sensed SeaWiFS Chlorophyll in River-Influenced Coastal Regions",
    url: "https://ntrs.nasa.gov/api/citations/20090042747/downloads/20090042747.pdf",
    provider: "NASA Technical Reports Server",
    group: "nasa",
    description: "Research article demonstrating time-series creation and significance testing.",
    usage: "Cited in the Trend Lab method notes and in generated reports as a worked example of trend significance testing.",
  },
  {
    title: "KNMI Climate Explorer",
    url: "https://climexp.knmi.nl/",
    provider: "Royal Netherlands Meteorological Institute (KNMI)",
    group: "partner-general",
    description: "A web-based scientific analysis tool to explore, analyze, and visualize climate data from a wide range of sources.",
    usage: "Suggested for independent validation; its text-series exports can be imported.",
  },
  {
    title: "Statistical test methods to detect trends in time series data",
    url: "https://medium.com/@snp.kriss/statistical-test-methods-to-detect-trends-in-time-series-data-b361a0ec530b",
    provider: "Article (Medium)",
    group: "partner-general",
    description: "Article about testing trends in data.",
    usage: "Linked from the Trend Lab method explainers.",
  },
  {
    title: "A Comprehensive Guide to Statistical Significance",
    url: "https://www.statsig.com/perspectives/a-comprehensive-guide-to-statistical-significance",
    provider: "Statsig",
    group: "partner-general",
    description: "A guide to significance testing.",
    usage: "Linked from the glossary entry on p-values and significance.",
  },
  {
    title: "Radarsat Constellation Mission (RCM) — Data",
    url: "https://donnees-data.asc-csa.gc.ca/en/dataset/rcm",
    provider: "Canadian Space Agency (CSA)",
    group: "csa",
    description: "Canada's new generation of Earth observation satellites — a trio of SAR satellites for maritime surveillance (ice, wind, oil, ships), disaster management and ecosystem monitoring.",
    usage: "Listed as a sea-ice / wetlands / coastal-change product in the Discovery Studio.",
  },
  {
    title: "Geo.ca",
    url: "http://geo.ca/",
    provider: "Government of Canada",
    group: "csa",
    description: "The definitive source for Canada's open geospatial information, useful for monitoring environmental issues in Canada.",
    usage: "Suggested source of Canadian boundaries and ancillary layers for regional investigations.",
  },
  {
    title: "SWOT Mission — Information",
    url: "https://www.asc-csa.gc.ca/eng/satellites/swot/",
    provider: "Canadian Space Agency (CSA)",
    group: "csa",
    description: "SWOT (NASA & CNES with CSA and the UK Space Agency) surveys ~90% of Earth's surface water, measuring changes in the elevation of lakes, rivers, reservoirs and oceans.",
    usage: "Catalogued as 'Surface water elevation' with a note that its short record limits trend detection.",
  },
  {
    title: "Monitoring and protecting our ecosystem from space",
    url: "https://www.asc-csa.gc.ca/eng/satellites/everyday-lives/monitoring-and-protecting-our-ecosystems-from-space.asp",
    provider: "Canadian Space Agency (CSA)",
    group: "csa",
    description: "How satellite data can help monitor changes and promote responsible use of land and natural resources.",
    usage: "Background reading linked from the Discovery Studio partner section.",
  },
  {
    title: "Synthetic Aperture Radar Python Tutorial",
    url: "https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial",
    provider: "Canadian Space Agency (CSA)",
    group: "csa",
    description: "Tutorial on working with SAR imagery using Python and QGIS, with practical steps for accessing and visualizing data.",
    usage: "Recommended next step for users who want to analyse RCM radar imagery themselves.",
  },
];

export const RESOURCE_GROUPS: { id: ResourceItem["group"]; label: string; note: string }[] = [
  { id: "integrated", label: "Integrated into EARTHSCOPE", note: "Services the app calls directly." },
  { id: "nasa", label: "NASA data & resources", note: "From the challenge Resources tab." },
  { id: "partner-general", label: "Space agency partner resources", note: "From the challenge Resources tab." },
  { id: "csa", label: "Canadian Space Agency (CSA)", note: "From the challenge Resources tab." },
];
