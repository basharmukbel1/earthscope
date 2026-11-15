/**
 * Deterministic synthetic time series for the teaching simulator and for
 * Monte-Carlo validation of the statistics engine. Everything produced here
 * is SYNTHETIC and must be labelled as such in the UI
 * (provenance.mode = "simulation").
 *
 * @module stats/simulate
 */
import type { Point } from "../types/domain";
import { decimalYear, formatMonth } from "./series";

/**
 * Mulberry32 seeded pseudo-random number generator (Tommy Ettinger, 2017;
 * public domain). Fast 32-bit generator with full 2³² period, adequate for
 * simulation and teaching (not for cryptography).
 *
 * @returns a function producing uniform numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Normal random deviate via the Box–Muller transform (Box & Muller 1958,
 * Ann. Math. Stat. 29:610–611). Uses 1 − u so log(0) cannot occur.
 */
export function gaussian(rng: () => number, mean = 0, sd = 1): number {
  const u1 = 1 - rng();
  const u2 = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Parameters for {@link simulateMonthlySeries}. */
export interface SimulationOptions {
  /** First calendar year (series starts in January). */
  startYear: number;
  /** Number of whole years to generate. */
  years: number;
  /** Linear trend in units per decade. */
  trendPerDecade: number;
  /** Standard deviation of the (stationary) noise, in data units. */
  noiseSd: number;
  /** Amplitude of a sinusoidal seasonal cycle peaking in July (default 0). */
  seasonalAmplitude?: number;
  /** Lag-1 autocorrelation φ of the monthly AR(1) noise, in (−1, 1) (default 0). */
  ar1?: number;
  /** RNG seed (default 1). */
  seed?: number;
  /** Value of the trend line at the start of the record (default 0). */
  baseline?: number;
  /** Fraction of months randomly set to null to mimic gaps (default 0). */
  missingFraction?: number;
}

/**
 * Generate a synthetic monthly series
 *   v(t) = baseline + (trendPerDecade/10)·(t − startYear)
 *          + seasonalAmplitude·cos(2π(month − 7)/12) + ε_t
 * where ε is a stationary AR(1) process ε_t = φε_{t−1} + √(1−φ²)·σ·η_t,
 * η ~ N(0,1), started from its stationary distribution so Var(ε) = σ²
 * throughout. Deterministic for a given seed.
 */
export function simulateMonthlySeries(opts: SimulationOptions): Point[] {
  const { startYear, years, trendPerDecade, noiseSd } = opts;
  const amp = opts.seasonalAmplitude ?? 0;
  const phi = opts.ar1 ?? 0;
  const baseline = opts.baseline ?? 0;
  const missing = opts.missingFraction ?? 0;
  if (!(phi > -1 && phi < 1)) throw new RangeError(`ar1 must be in (-1, 1), got ${phi}`);
  if (!(years >= 1)) throw new RangeError("years must be >= 1");
  const seed = opts.seed ?? 1;
  const rng = mulberry32(seed);
  // Separate stream for gaps, so toggling missingFraction does not change the noise.
  const gapRng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const innovSd = noiseSd * Math.sqrt(1 - phi * phi);
  const out: Point[] = [];
  let e = gaussian(rng, 0, noiseSd);
  const n = Math.round(years) * 12;
  for (let k = 0; k < n; k++) {
    if (k > 0) e = phi * e + gaussian(rng, 0, innovSd);
    const year = startYear + Math.floor(k / 12);
    const month = (k % 12) + 1;
    const t = decimalYear(year, month);
    const v = baseline + (trendPerDecade / 10) * (t - startYear) + amp * Math.cos((2 * Math.PI * (month - 7)) / 12) + e;
    const drop = missing > 0 && gapRng() < missing;
    out.push({ t, date: formatMonth(year, month), v: drop ? null : v });
  }
  return out;
}
