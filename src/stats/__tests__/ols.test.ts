import { describe, expect, it } from "vitest";
import type { Point } from "../../types/domain";
import { InsufficientDataError } from "../errors";
import { linearResiduals, ols, olsAR1, predictLinear } from "../ols";
import { decimalYear, formatMonth } from "../series";
import { close, fixtures, toPoints } from "./helpers";

describe("ols vs scipy.stats.linregress", () => {
  it.each(fixtures.linregress)("$name", (f) => {
    const r = ols(f.x, f.y);
    expect(r.n).toBe(f.n);
    expect(r.df).toBe(f.n - 2);
    close(r.slope, f.slope, 1e-10, 0, "slope");
    close(r.intercept, f.intercept, 1e-9, 1e-9, "intercept");
    close(r.se, f.stderr, 1e-9, 0, "stderr");
    close(r.p, f.pvalue, 1e-8, 1e-300, "p");
    close(r.r2, f.rvalue * f.rvalue, 1e-9, 1e-15, "r2");
    close(r.ciLow, f.ciLow, 1e-9, 1e-12, "ciLow");
    close(r.ciHigh, f.ciHigh, 1e-9, 1e-12, "ciHigh");
    close(r.t, f.slope / f.stderr, 1e-9, 0, "t");
    expect(r.adjusted).toBe(false);
  });
});

describe("olsAR1 (Santer et al. 2000) vs independent numpy reference", () => {
  it.each(fixtures.olsAr1)("$name", (f) => {
    const r = olsAR1(toPoints(f.t, f.v), f.alpha);
    expect(r.n).toBe(f.n);
    expect(r.adjusted).toBe(f.adjusted);
    close(r.slope, f.slope, 1e-10, 0, "slope");
    close(r.intercept, f.intercept, 1e-9, 1e-9, "intercept");
    close(r.r1 as number, f.r1, 1e-9, 1e-12, "r1");
    close(r.nEff as number, f.nEff, 1e-9, 0, "nEff");
    close(r.se, f.se, 1e-9, 0, "se");
    close(r.df, f.df, 1e-9, 0, "df");
    close(r.t, f.tStat, 1e-9, 0, "t");
    close(r.p, f.p, 1e-8, 1e-300, "p");
    close(r.ciLow, f.ciLow, 1e-9, 1e-12, "ciLow");
    close(r.ciHigh, f.ciHigh, 1e-9, 1e-12, "ciHigh");
    close(r.r2, f.r2, 1e-9, 1e-15, "r2");
  });

  it("inflates the standard error when residuals are positively autocorrelated", () => {
    const f = fixtures.olsAr1.find((x) => x.name === "monthly-ar085")!;
    const plain = ols(f.t, f.v);
    const adj = olsAR1(toPoints(f.t, f.v));
    expect(adj.se / plain.se).toBeGreaterThan(3);
    expect(adj.p).toBeGreaterThan(plain.p);
    close(adj.se, plain.se * Math.sqrt((adj.n - 2) / ((adj.nEff as number) - 2)), 1e-12);
  });

  it("floors n_eff at 3 so df >= 1 and nothing is NaN", () => {
    // Smooth residual pattern → r1 close to 1.
    const pts: Point[] = [];
    for (let i = 0; i < 40; i++) {
      const t = 2000 + i;
      pts.push({ t, date: String(t), v: 0.1 * i + Math.sin(i / 12) * 5 });
    }
    const r = olsAR1(pts);
    expect(r.nEff).toBeGreaterThanOrEqual(3);
    expect(r.df).toBeGreaterThanOrEqual(1);
    for (const v of [r.slope, r.se, r.t, r.p, r.ciLow, r.ciHigh]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("robustness", () => {
  it("throws a typed InsufficientDataError for n < 3", () => {
    expect(() => ols([1, 2], [3, 4])).toThrow(InsufficientDataError);
    expect(() => ols([1, 2, 3], [3, null, 4])).toThrow(InsufficientDataError);
    expect(() => olsAR1([{ t: 2000.5, date: "2000", v: 1 }])).toThrow(InsufficientDataError);
    expect(() => ols([5, 5, 5], [1, 2, 3])).toThrow(InsufficientDataError); // constant x
    try {
      ols([1], [1]);
    } catch (e) {
      expect((e as InsufficientDataError).required).toBe(3);
      expect((e as InsufficientDataError).actual).toBe(1);
      expect((e as Error).name).toBe("InsufficientDataError");
    }
  });

  it("constant y gives slope 0, p = 1 and no NaN", () => {
    const r = ols([1, 2, 3, 4], [7, 7, 7, 7]);
    expect(r.slope).toBe(0);
    expect(r.p).toBe(1);
    expect(r.t).toBe(0);
    expect(r.r2).toBe(0);
    expect(r.ciLow).toBe(0);
    const a = olsAR1([1, 2, 3, 4, 5].map((t) => ({ t, date: String(t), v: 7 })));
    expect(a.p).toBe(1);
    expect(Number.isNaN(a.r1)).toBe(false);
  });

  it("perfect linear data: p ≈ 0, finite results", () => {
    const x = [2000.5, 2001.5, 2002.5, 2003.5, 2004.5];
    const r = ols(
      x,
      x.map((v) => 3 * v - 1),
    );
    close(r.slope, 3, 1e-12);
    expect(r.p).toBeLessThan(1e-12);
    expect(Number.isNaN(r.t)).toBe(false);
  });

  it("uses decimal-year time, so a missing year does not distort the slope", () => {
    const pts: Point[] = [];
    for (let y = 1990; y < 2010; y++) {
      for (let m = 1; m <= 12; m++) {
        const t = decimalYear(y, m);
        // drop all of 1995–1997 (36 months)
        pts.push({ t, date: formatMonth(y, m), v: y >= 1995 && y <= 1997 ? null : 0.04 * (t - 1990) + 1 });
      }
    }
    const r = olsAR1(pts);
    close(r.slope, 0.04, 1e-10);
    // An index-based fit on the compressed series would give a different (wrong) slope:
    const vals = pts.filter((p) => p.v !== null).map((p) => p.v as number);
    const idxFit = ols(
      vals.map((_, i) => i / 12),
      vals,
    );
    expect(Math.abs(idxFit.slope - 0.04)).toBeGreaterThan(0.002);
  });

  it("predictLinear and linearResiduals", () => {
    const fit = { slope: 2, intercept: 1 };
    expect(predictLinear(fit, 3)).toBe(7);
    expect(linearResiduals([{ t: 3, date: "x", v: 8 }, { t: 4, date: "y", v: null }], fit).map((p) => p.v)).toEqual([1, null]);
  });

  it("rejects invalid alpha", () => {
    expect(() => ols([1, 2, 3], [1, 2, 4], 0)).toThrow(RangeError);
  });
});
