import { describe, expect, it } from "vitest";
import {
  erf,
  erfc,
  formatP,
  formatPStatement,
  lnBeta,
  lnGamma,
  normalCdf,
  normalPdf,
  normalQuantile,
  normalSf,
  regularizedIncompleteBeta,
  studentTCdf,
  studentTPdf,
  studentTQuantile,
  studentTSf,
  studentTTwoSidedP,
} from "../distributions";
import { close, fixtures } from "./helpers";

describe("erf / erfc vs scipy.special", () => {
  it.each(fixtures.erf)("x = $x", ({ x, erf: e, erfc: ec }) => {
    close(erf(x), e, 1e-14, 1e-300, "erf");
    close(erfc(x), ec, 1e-13, 1e-300, "erfc");
  });

  it("keeps full relative precision deep in the tail", () => {
    // erfc(10) = 2.088487583762545e-45 (no 1 - erf cancellation)
    close(erfc(10), 2.088487583762545e-45, 1e-13);
    expect(erfc(30)).toBe(0);
    expect(erfc(-30)).toBe(2);
    expect(Number.isNaN(erf(NaN))).toBe(true);
  });
});

describe("normal distribution vs scipy.stats.norm", () => {
  it.each(fixtures.normal)("x = $x", ({ x, cdf, sf, pdf }) => {
    close(normalCdf(x), cdf, 1e-13, 1e-300, "cdf");
    close(normalSf(x), sf, 1e-13, 1e-300, "sf");
    close(normalPdf(x), pdf, 1e-13, 1e-300, "pdf");
  });

  it.each(fixtures.normalPpf)("quantile p = $p", ({ p, x }) => {
    close(normalQuantile(p), x, 1e-13, 1e-15, "ppf");
  });

  it("quantile edge cases", () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(0.5)).toBe(0);
    expect(Number.isNaN(normalQuantile(1.2))).toBe(true);
    close(normalQuantile(0.975), 1.959963984540054, 1e-14);
  });
});

describe("gamma / beta functions", () => {
  it.each(fixtures.gammaln)("lnGamma($x)", ({ x, v }) => {
    close(lnGamma(x), v, 1e-13, 1e-13, "gammaln");
  });

  it("lnBeta large-argument path agrees with direct formula at moderate size", () => {
    for (const [a, b] of [
      [25, 0.5],
      [30, 7.5],
      [200, 3],
    ]) {
      close(lnBeta(a, b), lnGamma(a) + lnGamma(b) - lnGamma(a + b), 1e-12, 1e-12);
    }
  });

  it.each(fixtures.betainc)("I_$x($a, $b)", ({ a, b, x, v }) => {
    close(regularizedIncompleteBeta(x, a, b), v, 1e-11, 1e-15, "betainc");
  });

  it("incomplete beta edge cases", () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
    expect(Number.isNaN(regularizedIncompleteBeta(0.5, -1, 3))).toBe(true);
  });
});

describe("Student t distribution (fractional df) vs scipy.stats.t", () => {
  it.each(fixtures.tdist)("t = $t, df = $df", ({ t, df, cdf, p2 }) => {
    close(studentTCdf(t, df), cdf, 1e-10, 1e-300, "cdf");
    close(studentTTwoSidedP(t, df), p2, 1e-10, 1e-300, "two-sided p");
    // upper tail consistency
    close(studentTSf(t, df), t > 0 ? p2 / 2 : 1 - p2 / 2, 1e-10, 1e-300, "sf");
  });

  it.each(fixtures.tppf)("quantile p = $p, df = $df", ({ p, df, t }) => {
    close(studentTQuantile(p, df), t, 1e-10, 1e-12, "ppf");
  });

  it("quantile inverts the CDF", () => {
    for (const df of [0.7, 1.9, 3.5, 12.25, 88.8]) {
      for (const p of [1e-6, 0.01, 0.2, 0.8, 0.999]) {
        close(studentTCdf(studentTQuantile(p, df), df), p, 1e-10);
      }
    }
  });

  it("known textbook values", () => {
    close(studentTQuantile(0.975, 10), 2.2281388519862744, 1e-12); // scipy.stats.t.ppf(0.975, 10)
    close(studentTQuantile(0.975, 1), 12.706204736174694, 1e-12);
    close(studentTTwoSidedP(2.2281388519862744, 10), 0.05, 1e-12);
  });

  it("edge cases never produce NaN for valid input", () => {
    expect(studentTTwoSidedP(0, 5)).toBe(1);
    expect(studentTTwoSidedP(Infinity, 5)).toBe(0);
    expect(studentTTwoSidedP(-Infinity, 0.3)).toBe(0);
    close(studentTTwoSidedP(1.96, Infinity), 2 * normalSf(1.96), 1e-14);
    expect(studentTQuantile(0.5, 3.3)).toBe(0);
    expect(studentTQuantile(1, 3.3)).toBe(Infinity);
    expect(Number.isNaN(studentTTwoSidedP(1, 0))).toBe(true);
    expect(studentTTwoSidedP(1e200, 2)).toBeGreaterThanOrEqual(0);
  });

  it("pdf integrates to the CDF difference (trapezoid check)", () => {
    const df = 4.6;
    let s = 0;
    const h = 1e-3;
    for (let x = -1; x < 1.5 - 1e-12; x += h) s += 0.5 * h * (studentTPdf(x, df) + studentTPdf(x + h, df));
    close(s, studentTCdf(1.5, df) - studentTCdf(-1, df), 1e-6);
  });
});

describe("formatP", () => {
  it("formats per reporting convention", () => {
    expect(formatP(0.00002)).toBe("< 0.001");
    expect(formatP(0.0009999)).toBe("< 0.001");
    expect(formatP(0.001)).toBe("0.001");
    expect(formatP(0.0432)).toBe("0.043");
    expect(formatP(0.0496)).toBe("0.050");
    expect(formatP(0.4567)).toBe("0.46");
    expect(formatP(0.999)).toBe("> 0.99");
    expect(formatP(NaN)).toBe("n/a");
    expect(formatPStatement(0.0001)).toBe("p < 0.001");
    expect(formatPStatement(0.25)).toBe("p = 0.25");
  });
});
