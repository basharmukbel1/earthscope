/**
 * EARTHSCOPE statistics engine — public API (tree-shakeable named exports).
 *
 * Methods and references:
 *  - OLS + AR(1) effective sample size .......... Santer et al. (2000) JGR 105:7337
 *  - Mann–Kendall test .......................... Mann (1945); Kendall (1975); Gilbert (1987)
 *  - Hamed–Rao modified Mann–Kendall ............ Hamed & Rao (1998) J. Hydrol. 204:182
 *  - Theil–Sen slope + CI ....................... Theil (1950); Sen (1968); Gilbert (1987)
 *  - Seasonal Kendall ........................... Hirsch, Slack & Smith (1982) WRR 18:107
 *  - Correlation effective N .................... Bretherton et al. (1999) J. Climate 12:1990
 *  - Years to detect a trend .................... Weatherhead et al. (1998) JGR 103:17149
 *  - False discovery rate ....................... Benjamini & Hochberg (1995); Wilks (2016) BAMS
 *
 * @module stats
 */
export * from "./errors";
export * from "./distributions";
export * from "./series";
export * from "./ols";
export * from "./mannKendall";
export * from "./sen";
export * from "./seasonalKendall";
export * from "./correlation";
export * from "./detect";
export * from "./fdr";
export * from "./simulate";
export * from "./analyze";
