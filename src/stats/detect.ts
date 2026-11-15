/**
 * Trend detectability: how many years of data are needed before a trend of
 * a given size can be detected against noisy, autocorrelated variability.
 *
 * @module stats/detect
 */

/**
 * Number of years n* needed to detect a linear trend ω0 with probability 0.90
 * at the 5 % significance level (two-sided), after Weatherhead et al. (1998),
 * "Factors affecting the detection of trends: Statistical considerations and
 * applications to environmental data", JGR 103(D14):17149–17161, eq. 3:
 *
 *   n* = [ (3.3 σN / |ω0|) · √((1 + φ)/(1 − φ)) ]^(2/3)
 *
 * where σN is the standard deviation of the MONTHLY noise (deseasonalised,
 * detrended anomalies), φ its lag-1 autocorrelation and ω0 the trend in units
 * per YEAR. For data with a different sampling rate pass `obsPerYear`; σN is
 * then scaled by √(12/obsPerYear), which follows from the same derivation
 * (Var(ω̂) ≈ 12σ²/(m·n³) for m observations per year over n years).
 *
 * @returns years (may be fractional), or null when the trend is 0/non-finite,
 * σN is not positive, or |φ| ≥ 1.
 */
export function weatherheadYearsToDetect(
  trendPerYear: number,
  noiseSdMonthly: number,
  phi: number,
  obsPerYear = 12,
): number | null {
  if (!Number.isFinite(trendPerYear) || trendPerYear === 0) return null;
  if (!Number.isFinite(noiseSdMonthly) || !(noiseSdMonthly > 0)) return null;
  if (!Number.isFinite(phi) || phi <= -1 || phi >= 1) return null;
  if (!(obsPerYear > 0)) return null;
  const sigma = noiseSdMonthly * Math.sqrt(12 / obsPerYear);
  const base = ((3.3 * sigma) / Math.abs(trendPerYear)) * Math.sqrt((1 + phi) / (1 - phi));
  return Math.pow(base, 2 / 3);
}

/**
 * Approximate standard deviation of an estimated linear trend (units/year)
 * after `years` years of monthly data with AR(1) noise, Weatherhead et al.
 * (1998) eq. 2:  σ_ω ≈ σN / n^(3/2) · √((1 + φ)/(1 − φ)).
 */
export function weatherheadTrendSd(noiseSdMonthly: number, phi: number, years: number, obsPerYear = 12): number {
  if (!(years > 0) || !(noiseSdMonthly >= 0) || !(phi > -1 && phi < 1) || !(obsPerYear > 0)) return NaN;
  const sigma = noiseSdMonthly * Math.sqrt(12 / obsPerYear);
  return (sigma / Math.pow(years, 1.5)) * Math.sqrt((1 + phi) / (1 - phi));
}
