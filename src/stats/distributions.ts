/**
 * Special functions and probability distributions for the EARTHSCOPE
 * statistics engine. Pure TypeScript, no dependencies.
 *
 * Accuracy (verified against SciPy 1.18 in `__tests__/distributions.test.ts`):
 *  - erf / erfc: W. J. Cody's rational Chebyshev approximations, ~1e-16 relative.
 *  - Normal CDF / SF via erfc (no catastrophic 1 − Φ cancellation in the tails).
 *  - Student t CDF / two-sided p for fractional df via the regularized incomplete
 *    beta function (Lentz continued fraction), ~1e-13 relative.
 *
 * @module stats/distributions
 */

const SQRT2 = Math.SQRT2;
const SQRT_2PI = 2.5066282746310002; // sqrt(2π)
const LN_SQRT_2PI = 0.9189385332046728; // ln sqrt(2π)
const INV_SQRT_PI = 0.5641895835477563; // 1/sqrt(π)

/* ------------------------------------------------------------------ erf ---- */

// Coefficients from W. J. Cody, "Rational Chebyshev approximations for the error
// function", Math. Comp. 23 (1969) 631–637; as implemented in Cody's CALERF
// (SPECFUN, netlib, 1990).
const CODY_A = [3.1611237438705656, 113.864154151050156, 377.485237685302021, 3209.37758913846947, 0.185777706184603153];
const CODY_B = [23.6012909523441209, 244.024637934444173, 1282.61652607737228, 2844.23683343917062];
const CODY_C = [
  0.564188496988670089, 8.88314979438837594, 66.1191906371416295, 298.635138197400131, 881.95222124176909,
  1712.04761263407058, 2051.07837782607147, 1230.33935479799725, 2.15311535474403846e-8,
];
const CODY_D = [
  15.7449261107098347, 117.693950891312499, 537.181101862009858, 1621.38957456669019, 3290.79923573345963,
  4362.61909014324716, 3439.36767414372164, 1230.33935480374942,
];
const CODY_P = [
  0.305326634961232344, 0.360344899949804439, 0.125781726111229246, 0.0160837851487422766, 6.58749161529837803e-4,
  0.0163153871373020978,
];
const CODY_Q = [2.56852019228982242, 1.87295284992346725, 0.527905102951428412, 0.0605183413124413191, 0.00233520497626869185];
const CODY_XBIG = 26.543; // erfc(x) underflows beyond this

/** exp(-y²) computed as exp(-ysq²)·exp(-del) to avoid cancellation (Cody). */
function expNegSquare(y: number): number {
  const ysq = Math.trunc(y * 16) / 16;
  const del = (y - ysq) * (y + ysq);
  return Math.exp(-ysq * ysq) * Math.exp(-del);
}

/** Cody's CALERF kernel. kind 0 → erf(x), kind 1 → erfc(x). */
function calerf(x: number, kind: 0 | 1): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  let result: number;
  if (y <= 0.46875) {
    const ysq = y > 1.11e-16 ? y * y : 0;
    let xnum = CODY_A[4] * ysq;
    let xden = ysq;
    for (let i = 0; i < 3; i++) {
      xnum = (xnum + CODY_A[i]) * ysq;
      xden = (xden + CODY_B[i]) * ysq;
    }
    result = (x * (xnum + CODY_A[3])) / (xden + CODY_B[3]);
    return kind === 0 ? result : 1 - result;
  }
  if (y <= 4) {
    let xnum = CODY_C[8] * y;
    let xden = y;
    for (let i = 0; i < 7; i++) {
      xnum = (xnum + CODY_C[i]) * y;
      xden = (xden + CODY_D[i]) * y;
    }
    result = ((xnum + CODY_C[7]) / (xden + CODY_D[7])) * expNegSquare(y);
  } else if (y >= CODY_XBIG) {
    result = 0;
  } else {
    const ysq = 1 / (y * y);
    let xnum = CODY_P[5] * ysq;
    let xden = ysq;
    for (let i = 0; i < 4; i++) {
      xnum = (xnum + CODY_P[i]) * ysq;
      xden = (xden + CODY_Q[i]) * ysq;
    }
    result = (ysq * (xnum + CODY_P[4])) / (xden + CODY_Q[4]);
    result = ((INV_SQRT_PI - result) / y) * expNegSquare(y);
  }
  // `result` is erfc(|x|) here.
  if (kind === 0) {
    const e = 0.5 - result + 0.5;
    return x < 0 ? -e : e;
  }
  return x < 0 ? 2 - result : result;
}

/**
 * Error function erf(x) = 2/√π ∫₀ˣ e^(−t²) dt.
 *
 * Method: W. J. Cody (1969), "Rational Chebyshev approximations for the error
 * function", Math. Comp. 23:631–637 (CALERF). Relative error ≲ 1e-16.
 */
export function erf(x: number): number {
  return calerf(x, 0);
}

/**
 * Complementary error function erfc(x) = 1 − erf(x), computed directly (no
 * cancellation) so tail values such as erfc(10) ≈ 2.09e-45 keep full relative
 * precision. Underflows to 0 for x ≳ 26.54.
 *
 * Method: W. J. Cody (1969), Math. Comp. 23:631–637 (CALERF).
 */
export function erfc(x: number): number {
  return calerf(x, 1);
}

/* --------------------------------------------------------------- normal ---- */

/** Standard normal probability density φ(x) = exp(−x²/2)/√(2π). */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF Φ(x) = ½·erfc(−x/√2) (accurate in the lower tail).
 * Reference: Abramowitz & Stegun (1964) eq. 26.2.29; erfc per Cody (1969).
 */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / SQRT2);
}

/**
 * Standard normal upper-tail (survival) probability 1 − Φ(x), computed as
 * ½·erfc(x/√2) — NOT as 1 − Φ(x), which loses all precision for x ≳ 8.
 * Use `2 * normalSf(Math.abs(z))` for a two-sided p-value.
 */
export function normalSf(x: number): number {
  return 0.5 * erfc(x / SQRT2);
}

// P. J. Acklam (2003), "An algorithm for computing the inverse normal cumulative
// distribution function" (relative error < 1.15e-9 before refinement).
const ACK_A = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
const ACK_B = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
const ACK_C = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
const ACK_D = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
const ACK_PLOW = 0.02425;

/**
 * Inverse of the standard normal CDF, Φ⁻¹(p).
 *
 * Method: P. J. Acklam's rational approximation (2003) followed by one Halley
 * step using the erfc-based CDF, giving ~1e-15 relative accuracy. For p > 0.5
 * the symmetric identity Φ⁻¹(p) = −Φ⁻¹(1 − p) is used (1 − p is exact there).
 *
 * @returns −Infinity for p = 0, +Infinity for p = 1, NaN outside [0, 1].
 */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p > 0.5) return -normalQuantile(1 - p);
  let x: number;
  if (p < ACK_PLOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((ACK_C[0] * q + ACK_C[1]) * q + ACK_C[2]) * q + ACK_C[3]) * q + ACK_C[4]) * q + ACK_C[5]) /
      ((((ACK_D[0] * q + ACK_D[1]) * q + ACK_D[2]) * q + ACK_D[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((ACK_A[0] * r + ACK_A[1]) * r + ACK_A[2]) * r + ACK_A[3]) * r + ACK_A[4]) * r + ACK_A[5]) * q) /
      (((((ACK_B[0] * r + ACK_B[1]) * r + ACK_B[2]) * r + ACK_B[3]) * r + ACK_B[4]) * r + 1);
  }
  // One step of Halley's rational method (third-order convergence).
  const e = normalCdf(x) - p;
  const u = e * SQRT_2PI * Math.exp(0.5 * x * x);
  if (Number.isFinite(u)) x = x - u / (1 + 0.5 * x * u);
  return x;
}

/* ---------------------------------------------------------------- gamma ---- */

// Lanczos (1964) approximation, g = 7, n = 9 (coefficients as tabulated by
// P. Godfrey; also used in Numerical Recipes-style implementations).
const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/**
 * Natural log of the gamma function, ln Γ(x), for x > 0 (for non-integer
 * x < 0 it returns ln|Γ(x)| via the reflection formula; for x ≤ 0 integers,
 * +Infinity).
 *
 * Method: Lanczos (1964), "A precision approximation of the gamma function",
 * SIAM J. Numer. Anal. B 1:86–96, with g = 7, n = 9; reflection
 * Γ(x)Γ(1−x) = π / sin(πx) for x < 0.5. Absolute error ≲ 1e-14.
 */
export function lnGamma(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x <= 0 && Number.isInteger(x)) return Infinity;
  if (x < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return LN_SQRT_2PI + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Stirling-series remainder δ(z) = lnΓ(z) − [(z−½)ln z − z + ½ln 2π], valid for z ≥ 10. */
function stirlingDelta(z: number): number {
  const z2 = 1 / (z * z);
  return (1 / z) * (1 / 12 - z2 * (1 / 360 - z2 * (1 / 1260 - z2 * (1 / 1680 - z2 / 1188))));
}

/**
 * ln B(a, b) = ln Γ(a) + ln Γ(b) − ln Γ(a + b), for a, b > 0.
 * When the larger argument is ≥ 20 the difference ln Γ(a) − ln Γ(a+b) is
 * evaluated with a Stirling-series difference (log1p form) to avoid the
 * catastrophic cancellation that a direct subtraction suffers at large df.
 */
export function lnBeta(a: number, b: number): number {
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  if (big < 20) return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  // lnΓ(big) − lnΓ(big+small) = −(big−½)·log1p(small/big) − small·ln(big+small) + small + δ(big) − δ(big+small)
  const diff =
    -(big - 0.5) * Math.log1p(small / big) -
    small * Math.log(big + small) +
    small +
    stirlingDelta(big) -
    stirlingDelta(big + small);
  return lnGamma(small) + diff;
}

/* ----------------------------------------------------- incomplete beta ---- */

const BETACF_MAXIT = 20000;
const BETACF_EPS = 1e-16;
const BETACF_FPMIN = 1e-300;

/**
 * Continued fraction for the incomplete beta function, evaluated with the
 * modified Lentz method (Press et al., Numerical Recipes, 3rd ed., §6.4).
 */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= BETACF_MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < BETACF_FPMIN) d = BETACF_FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < BETACF_FPMIN) c = BETACF_FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < BETACF_EPS) return h;
  }
  return h; // not converged: best available estimate (only for astronomically large a, b)
}

/**
 * I_x(a, b) with the complement y = 1 − x supplied separately, so callers that
 * know y more accurately than 1 − x (e.g. the t distribution) keep precision.
 */
function incBetaXY(x: number, y: number, a: number, b: number, lnx = Math.log(x), lny = Math.log(y)): number {
  if (x <= 0) return 0;
  if (y <= 0) return 1;
  const lnFront = a * lnx + b * lny - lnBeta(a, b);
  if (x < (a + 1) / (a + b + 2)) {
    return Math.min(1, (Math.exp(lnFront) * betacf(a, b, x)) / a);
  }
  return Math.max(0, 1 - (Math.exp(lnFront) * betacf(b, a, y)) / b);
}

/**
 * Regularized incomplete beta function I_x(a, b) = B(x; a, b) / B(a, b).
 *
 * Method: continued fraction evaluated by the modified Lentz algorithm, using
 * the symmetry I_x(a,b) = 1 − I_{1−x}(b,a) where the fraction converges
 * faster (Press et al. 2007, Numerical Recipes 3rd ed., §6.4; Lentz 1976).
 *
 * @param x in [0, 1]
 * @param a > 0
 * @param b > 0
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (Number.isNaN(x) || Number.isNaN(a) || Number.isNaN(b) || a <= 0 || b <= 0 || x < 0 || x > 1) return NaN;
  return incBetaXY(x, 1 - x, a, b);
}

/* ------------------------------------------------------------ Student t ---- */

/**
 * Two-sided p-value P(|T| ≥ |t|) for Student's t distribution with (possibly
 * fractional) `df` degrees of freedom, as needed after an effective-sample-size
 * correction (e.g. df = n_eff − 2 in Santer et al. 2000).
 *
 * Method: P(|T| ≥ |t|) = I_{df/(df+t²)}(df/2, 1/2) (Abramowitz & Stegun 1964,
 * eq. 26.7.1 / 26.5.27), with the incomplete beta function evaluated by a
 * Lentz continued fraction. df = Infinity falls back to the normal distribution.
 *
 * @returns p in [0, 1]; 1 for t = 0; 0 for |t| = Infinity; NaN for invalid df.
 */
export function studentTTwoSidedP(t: number, df: number): number {
  if (Number.isNaN(t) || Number.isNaN(df) || !(df > 0)) return NaN;
  const at = Math.abs(t);
  if (at === Infinity) return 0;
  if (t === 0) return 1;
  if (df === Infinity) return Math.min(1, 2 * normalSf(at));
  let x: number;
  let y: number;
  let lnx: number;
  let lny: number;
  if (at > 1e150) {
    x = df / at / at;
    y = 1 - x;
    lnx = Math.log(df) - 2 * Math.log(at);
    lny = Math.log1p(-x);
  } else {
    const t2 = at * at;
    x = df / (df + t2);
    y = t2 / (df + t2);
    lnx = -Math.log1p(t2 / df); // accurate even when x ≈ 1
    lny = -Math.log1p(df / t2); // accurate even when y ≈ 1
  }
  return Math.min(1, Math.max(0, incBetaXY(x, y, df / 2, 0.5, lnx, lny)));
}

/**
 * Student's t cumulative distribution function P(T ≤ t) for fractional df.
 * Lower and upper tails are both computed without 1 − F cancellation.
 * Method: see {@link studentTTwoSidedP}.
 */
export function studentTCdf(t: number, df: number): number {
  const p2 = studentTTwoSidedP(t, df);
  if (Number.isNaN(p2)) return NaN;
  return t < 0 ? 0.5 * p2 : 1 - 0.5 * p2;
}

/** Upper-tail probability P(T > t) of Student's t (accurate for large t). */
export function studentTSf(t: number, df: number): number {
  const p2 = studentTTwoSidedP(t, df);
  if (Number.isNaN(p2)) return NaN;
  return t > 0 ? 0.5 * p2 : 1 - 0.5 * p2;
}

/** Student's t probability density for (fractional) df. */
export function studentTPdf(t: number, df: number): number {
  if (!(df > 0)) return NaN;
  if (df === Infinity) return normalPdf(t);
  const lnC = lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  return Math.exp(lnC - ((df + 1) / 2) * Math.log1p((t * t) / df));
}

/**
 * Quantile (inverse CDF) of Student's t distribution for fractional df, e.g.
 * `studentTQuantile(0.975, df)` for a two-sided 95 % confidence interval.
 *
 * Method: closed forms for df = 1 (Cauchy) and df = 2; otherwise a
 * Cornish–Fisher starting value (Abramowitz & Stegun 1964, eq. 26.7.5)
 * followed by safeguarded Newton iteration on the CDF inside a bracketing
 * interval (bisection whenever a Newton step leaves the bracket). Converges to
 * ~1e-14 relative.
 */
export function studentTQuantile(p: number, df: number): number {
  if (Number.isNaN(p) || Number.isNaN(df) || p < 0 || p > 1 || !(df > 0)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  if (df === Infinity || df > 1e12) return normalQuantile(p);
  if (p > 0.5) return -studentTQuantile(1 - p, df); // 1 − p is exact for p in (0.5, 1)
  if (df === 1) return -1 / Math.tan(Math.PI * p); // = tan(π(p − ½)) without cancellation near p → 0
  if (df === 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));

  // Lower tail: find t < 0 with F(t) = p.
  const cdf = (t: number) => 0.5 * studentTTwoSidedP(t, df);
  const lnC = lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI);
  const pdf = (t: number) => Math.exp(lnC - ((df + 1) / 2) * Math.log1p((t * t) / df));

  const z = normalQuantile(p);
  const z2 = z * z;
  let x = z + (z * (z2 + 1)) / (4 * df) + (z * ((5 * z2 + 16) * z2 + 3)) / (96 * df * df);
  if (!(x < 0) || !Number.isFinite(x)) x = z < 0 ? z : -1;

  // Bracket [lo, hi] with F(lo) ≤ p < F(hi).
  let hi = 0;
  let lo = x;
  let flo = cdf(lo);
  if (flo > p) {
    hi = lo;
    while (flo > p) {
      hi = lo;
      lo *= 2;
      if (!Number.isFinite(lo)) return -Infinity;
      flo = cdf(lo);
    }
  } else {
    // x is at or below the root; tighten hi towards x by halving.
    let probe = x / 2;
    while (probe < -1e-300 && cdf(probe) <= p) {
      lo = probe;
      probe /= 2;
    }
    hi = probe;
  }

  x = 0.5 * (lo + hi);
  for (let iter = 0; iter < 200; iter++) {
    const fx = cdf(x) - p;
    if (fx === 0) return x;
    if (fx < 0) lo = x;
    else hi = x;
    const d = pdf(x);
    let next = d > 0 ? x - fx / d : NaN;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - x) <= 1e-15 * Math.abs(next) || hi - lo <= 4e-16 * Math.abs(lo)) return next;
    x = next;
  }
  return x;
}

/* ------------------------------------------------------------ formatting ---- */

/**
 * Format a p-value for display following common reporting practice (APA 7th
 * ed. §6.36): "< 0.001" below 0.001, three decimals below 0.1 (so values near
 * 0.05 are not rounded across the threshold), two decimals otherwise, and
 * "> 0.99" at the top end. Non-finite input gives "n/a".
 *
 * @example formatP(0.00002) === "< 0.001"; formatP(0.0432) === "0.043"; formatP(0.4567) === "0.46"
 */
export function formatP(p: number, threshold = 0.001): string {
  if (!Number.isFinite(p)) return "n/a";
  if (p < threshold) return `< ${threshold}`;
  if (p < 0.1) return p.toFixed(3);
  if (p > 0.99) return "> 0.99";
  return p.toFixed(2);
}

/** Like {@link formatP} but with the "p" prefix: "p < 0.001" or "p = 0.043". */
export function formatPStatement(p: number, threshold = 0.001): string {
  const s = formatP(p, threshold);
  if (s === "n/a") return "p = n/a";
  return s.startsWith("<") || s.startsWith(">") ? `p ${s}` : `p = ${s}`;
}
