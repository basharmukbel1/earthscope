#!/usr/bin/env python3
"""
Generate reference fixtures for the EARTHSCOPE statistics engine (src/stats).

Every number written here comes from SciPy / NumPy / pymannkendall (the
de-facto reference implementations scientists use), or -- where no library
implements the exact method -- from a small, independent NumPy reference
implementation written directly from the published formulas:

  * Gilbert (1987) Sen-slope confidence interval with interpolated ranks
  * OLS with Santer et al. (2000) AR(1) effective-sample-size adjustment
  * Hamed & Rao (1998) modified Mann-Kendall when the series contains gaps

All random draws use fixed seeds, so the output is fully deterministic.

Usage:  python scripts/gen-stats-fixtures.py
Output: src/stats/__tests__/fixtures.json
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import scipy
from scipy import special, stats

try:
    import pymannkendall as pmk  # pip install pymannkendall
except ImportError:  # pragma: no cover
    pmk = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "stats" / "__tests__" / "fixtures.json"


# ----------------------------------------------------------------- helpers --
def clean(o):
    """Recursively convert numpy scalars/arrays to JSON; NaN -> null."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return [clean(v) for v in o.tolist()]
    if isinstance(o, (np.bool_, bool)):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        if math.isnan(f):
            return None
        if math.isinf(f):
            raise ValueError("Infinity is not representable in fixtures")
        return f
    return o


def decimal_year(year: int, month: int) -> float:
    return year + (month - 0.5) / 12.0


def monthly_axis(start_year: int, n_months: int):
    t, dates = [], []
    for k in range(n_months):
        y, m = start_year + k // 12, k % 12 + 1
        t.append(decimal_year(y, m))
        dates.append(f"{y:04d}-{m:02d}")
    return np.array(t), dates


def ar1_noise(rng, n, phi, sd):
    e = np.empty(n)
    e[0] = rng.normal(0, sd)
    innov_sd = sd * math.sqrt(1 - phi * phi)
    for i in range(1, n):
        e[i] = phi * e[i - 1] + rng.normal(0, innov_sd)
    return e


def p_two_sided_normal(z: float) -> float:
    """Accurate two-sided normal p-value (no 1-cdf cancellation)."""
    return float(2.0 * stats.norm.sf(abs(z)))


def mk_var_s(x: np.ndarray) -> float:
    n = len(x)
    _, counts = np.unique(x, return_counts=True)
    return (n * (n - 1) * (2 * n + 5) - np.sum(counts * (counts - 1) * (2 * counts + 5))) / 18.0


def mk_s(x: np.ndarray) -> float:
    n = len(x)
    s = 0
    for k in range(n - 1):
        s += np.sum(np.sign(x[k + 1 :] - x[k]))
    return float(s)


def mk_z(s: float, var_s: float) -> float:
    if s > 0:
        return (s - 1) / math.sqrt(var_s)
    if s < 0:
        return (s + 1) / math.sqrt(var_s)
    return 0.0


# --------------------------------------------- independent references -------
def sen_ref(t, v, alpha):
    """Theil-Sen slope with Gilbert (1987, sec. 16.4.3) CI, interpolated ranks."""
    t = np.asarray(t, float)
    v = np.asarray(v, float)
    mask = ~np.isnan(v)
    t, v = t[mask], v[mask]
    n = len(v)
    slopes = []
    for i in range(n - 1):
        for j in range(i + 1, n):
            if t[j] != t[i]:
                slopes.append((v[j] - v[i]) / (t[j] - t[i]))
    slopes = np.sort(np.array(slopes))
    N = len(slopes)
    slope = float(np.median(slopes))
    var_s = mk_var_s(v)
    C = stats.norm.ppf(1 - alpha / 2) * math.sqrt(var_s)
    M1 = (N - C) / 2.0
    M2 = (N + C) / 2.0 + 1.0

    def at_rank(r):  # 1-based fractional rank, linear interpolation
        r = min(max(r, 1.0), float(N))
        lo = int(math.floor(r))
        f = r - lo
        if lo >= N:
            return float(slopes[N - 1])
        return float(slopes[lo - 1] + f * (slopes[lo] - slopes[lo - 1]))

    intercept = float(np.median(v) - slope * np.median(t))
    return dict(slope=slope, intercept=intercept, ciLow=at_rank(M1), ciHigh=at_rank(M2), nSlopes=N, varS=var_s)


def lag1_ref(e_full: np.ndarray) -> float:
    """Lag-1 autocorrelation of an evenly spaced series that may contain NaN gaps.

    r1 = [sum over adjacent valid pairs (e_i-m)(e_{i+1}-m)] * ((n-1)/nPairs) / sum (e_i-m)^2
    which reduces to the standard estimator when there are no gaps.
    """
    mask = ~np.isnan(e_full)
    vals = e_full[mask]
    n = len(vals)
    m = vals.mean()
    den = np.sum((vals - m) ** 2)
    pair = mask[:-1] & mask[1:]
    n_pairs = int(pair.sum())
    num = np.sum((e_full[:-1][pair] - m) * (e_full[1:][pair] - m))
    r1 = num * (n - 1) / n_pairs / den
    return float(max(-1.0, min(1.0, r1)))


def ols_ar1_ref(t, v, alpha):
    """OLS + Santer et al. (2000) AR(1) adjustment (independent numpy reference)."""
    t = np.asarray(t, float)
    v = np.asarray(v, float)
    mask = ~np.isnan(v)
    lr = stats.linregress(t[mask], v[mask])
    n = int(mask.sum())
    resid = np.full(len(v), np.nan)
    resid[mask] = v[mask] - (lr.intercept + lr.slope * t[mask])
    r1 = lag1_ref(resid)
    se0 = lr.stderr
    if r1 > 0:
        n_eff = min(float(n), max(3.0, n * (1 - r1) / (1 + r1)))
        se = se0 * math.sqrt((n - 2) / (n_eff - 2))
        df = n_eff - 2
        adjusted = True
    else:
        n_eff = float(n)
        se = se0
        df = n - 2.0
        adjusted = False
    tstat = lr.slope / se
    p = float(2 * stats.t.sf(abs(tstat), df))
    q = stats.t.ppf(1 - alpha / 2, df)
    return dict(
        n=n, slope=lr.slope, intercept=lr.intercept, se=se, tStat=tstat, df=df, p=p,
        ciLow=lr.slope - q * se, ciHigh=lr.slope + q * se, r2=lr.rvalue ** 2,
        r1=r1, nEff=n_eff, adjusted=adjusted,
    )


def hamed_rao_ref(values, alpha, lag=None):
    """Hamed & Rao (1998) modified MK, following pymannkendall's algorithm but
    detrending with the Sen slope on the ORIGINAL time index (gap aware)."""
    xo = np.asarray(values, float)
    idx = np.arange(len(xo), dtype=float)
    mask = ~np.isnan(xo)
    x, ti = xo[mask], idx[mask]
    n = len(x)
    s = mk_s(x)
    var_s = mk_var_s(x)
    tau = s / (0.5 * n * (n - 1))
    slope = sen_ref(ti, x, alpha)["slope"]
    # Detrend relative to the first time. The Sen slope passes through a median
    # pair of points, whose detrended values are therefore mathematically tied:
    # snap rounding-level differences (< 1e-12 of the data scale) to exact ties.
    x_detrend = x - (ti - ti[0]) * slope
    scale = max(np.max(np.abs(x)), np.max(np.abs((ti - ti[0]) * slope)))
    order = np.argsort(x_detrend, kind="stable")
    snapped = x_detrend.copy()
    start = 0
    for k in range(1, n + 1):
        if k == n or x_detrend[order[k]] - x_detrend[order[start]] > 1e-12 * scale:
            snapped[order[start:k]] = x_detrend[order[start]]
            start = k
    ranks = stats.rankdata(snapped)
    y = ranks - ranks.mean()
    acov = np.correlate(y, y, "full")[n - 1 :] / n
    acf = acov / acov[0]
    max_lag = n - 1 if lag is None else min(lag, n - 1)
    bound = stats.norm.ppf(1 - alpha / 2) / math.sqrt(n)
    sni = 0.0
    for i in range(1, max_lag + 1):
        if not (-bound <= acf[i] <= bound):
            sni += (n - i) * (n - i - 1) * (n - i - 2) * acf[i]
    ratio = 1 + 2.0 / (n * (n - 1) * (n - 2)) * sni
    var_c = var_s * ratio
    z = mk_z(s, var_c)
    return dict(n=n, s=s, varS=var_c, z=z, p=p_two_sided_normal(z), tau=tau, correction=ratio)


# ===================================================================== main ==
def main():
    fx: dict = {
        "meta": {
            "generator": "scripts/gen-stats-fixtures.py",
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "pymannkendall": getattr(pmk, "__version__", None),
        }
    }

    # ------------------------------------------------------------ special --
    xs = [-6.0, -3.2, -1.5, -0.7, -0.3, -1e-9, 0.0, 1e-9, 0.1, 0.3, 0.46875, 0.47, 0.5, 0.9, 1.0,
          1.7, 2.5, 3.0, 3.9, 4.0, 4.1, 5.5, 7.0, 10.0, 15.0, 20.0, 26.0]
    fx["erf"] = [dict(x=x, erf=special.erf(x), erfc=special.erfc(x)) for x in xs]

    zs = [-38.0, -20.0, -10.0, -8.0, -5.0, -3.0, -1.96, -1.0, -0.2, 0.0, 0.5, 1.0, 1.6449, 2.5, 4.0, 6.0, 9.0, 12.0]
    fx["normal"] = [dict(x=z, cdf=stats.norm.cdf(z), sf=stats.norm.sf(z), pdf=stats.norm.pdf(z)) for z in zs]

    ps = [1e-300, 1e-100, 1e-20, 1e-10, 1e-6, 1e-4, 0.001, 0.01, 0.02425, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7,
          0.9, 0.95, 0.975, 0.99, 0.999, 0.9999, 1 - 1e-10]
    fx["normalPpf"] = [dict(p=p, x=stats.norm.ppf(p)) for p in ps]

    gx = [1e-8, 0.01, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 7.3, 10.0, 15.5, 33.3, 100.0, 171.5, 250.25, 1000.0, 1e5, 1e7]
    fx["gammaln"] = [dict(x=x, v=special.gammaln(x)) for x in gx]

    bcases = []
    for a, b in [(0.5, 0.5), (1.0, 1.0), (2.5, 0.5), (0.5, 7.0), (5.0, 3.0), (50.0, 0.5), (0.25, 0.5),
                 (240.0, 0.5), (1500.0, 0.5), (10.0, 10.0), (100.0, 120.0), (3.3, 0.7)]:
        for x in [1e-6, 0.01, 0.2, 0.5, 0.8, 0.97, 0.999]:
            bcases.append(dict(a=a, b=b, x=x, v=special.betainc(a, b, x)))
    fx["betainc"] = bcases

    tcases = []
    for df in [0.5, 1.0, 1.5, 2.0, 2.7, 3.3, 5.0, 7.25, 10.5, 29.9, 100.3, 478.6, 1000.5, 1e6]:
        for t in [-40.0, -10.0, -4.0, -2.1, -1.0, -0.3, 0.0, 0.25, 0.7, 1.5, 2.0, 3.1, 6.0, 25.0]:
            tcases.append(dict(t=t, df=df, cdf=stats.t.cdf(t, df), p2=2 * stats.t.sf(abs(t), df)))
    fx["tdist"] = tcases

    qcases = []
    for df in [0.5, 1.0, 1.3, 2.0, 2.7, 3.3, 4.0, 7.25, 10.5, 29.9, 100.3, 478.6, 1e5]:
        for p in [1e-8, 0.0005, 0.005, 0.025, 0.05, 0.1, 0.3, 0.5, 0.6, 0.9, 0.95, 0.975, 0.995, 0.9995]:
            qcases.append(dict(p=p, df=df, t=stats.t.ppf(p, df)))
    fx["tppf"] = qcases

    # ------------------------------------------------------------- OLS -------
    rng = np.random.default_rng(20260101)
    lin = []
    # 1. monthly series with gaps (decimal-year x)
    t, _ = monthly_axis(1990, 360)
    y = 0.021 * (t - 1990) + 0.4 * np.sin(2 * np.pi * t) + rng.normal(0, 0.3, len(t))
    y[rng.random(len(t)) < 0.1] = np.nan
    lin.append(("monthly-gaps", t, y))
    # 2. short annual
    t = np.arange(2010, 2018) + 0.5
    y = 3.0 - 0.15 * (t - 2010) + rng.normal(0, 0.2, len(t))
    lin.append(("annual-short", t, y))
    # 3. annual, negative slope, one missing year
    t = np.arange(1981, 2021) + 0.5
    y = 14.2 - 0.031 * (t - 1981) + rng.normal(0, 0.25, len(t))
    y[[5, 17]] = np.nan
    lin.append(("annual-negative-gaps", t, y))
    # 4. pure noise
    t = np.arange(1960, 2020) + 0.5
    y = rng.normal(100, 5, len(t))
    lin.append(("noise", t, y))
    out = []
    for name, t, y in lin:
        m = ~np.isnan(y)
        lr = stats.linregress(t[m], y[m])
        n = int(m.sum())
        q = stats.t.ppf(0.975, n - 2)
        out.append(dict(name=name, x=t, y=y, n=n, slope=lr.slope, intercept=lr.intercept, stderr=lr.stderr,
                        pvalue=lr.pvalue, rvalue=lr.rvalue, ciLow=lr.slope - q * lr.stderr,
                        ciHigh=lr.slope + q * lr.stderr))
    fx["linregress"] = out

    ar = []
    t, _ = monthly_axis(1985, 420)
    y = 0.015 * (t - 1985) + ar1_noise(rng, len(t), 0.6, 0.5)
    y[rng.random(len(t)) < 0.05] = np.nan
    ar.append(("monthly-ar06-gaps", t, y, 0.05))
    t, _ = monthly_axis(2000, 240)
    y = -0.01 * (t - 2000) + ar1_noise(rng, len(t), -0.3, 0.4)
    ar.append(("monthly-negative-r1", t, y, 0.05))
    t = np.arange(2005, 2017) + 0.5
    y = 1.0 + 0.05 * (t - 2005) + ar1_noise(rng, len(t), 0.5, 0.1)
    ar.append(("annual-12", t, y, 0.1))
    t, _ = monthly_axis(1981, 480)
    y = 0.02 * (t - 1981) + ar1_noise(rng, len(t), 0.85, 0.6)
    ar.append(("monthly-ar085", t, y, 0.05))
    fx["olsAr1"] = [dict(name=nm, t=t, v=y, alpha=a, **ols_ar1_ref(t, y, a)) for nm, t, y, a in ar]

    # ------------------------------------------------------- Mann-Kendall ----
    mk_series = []
    mk_series.append(("noise-40", rng.normal(0, 1, 40)))
    x = np.round(0.05 * np.arange(50) + rng.normal(0, 1.2, 50), 0)  # heavy ties
    mk_series.append(("ties-rounded-50", x))
    x = 0.02 * np.arange(45) + rng.normal(0, 0.5, 45)
    x[[3, 9, 10, 22, 30, 44]] = np.nan
    mk_series.append(("nans-45", x))
    mk_series.append(("strong-trend-60", 0.5 * np.arange(60) + rng.normal(0, 1, 60)))
    mk_series.append(("small-int-30", rng.integers(1, 4, 30).astype(float)))
    x = 10 - 0.08 * np.arange(35) + rng.normal(0, 0.6, 35)
    x = np.round(x, 1)
    x[[0, 17]] = np.nan
    mk_series.append(("decreasing-ties-nans-35", x))
    x = np.arange(25, dtype=float)
    x[[4, 12]] = np.nan
    mk_series.append(("monotone-25", x))
    mk_out = []
    for name, x in mk_series:
        rec = dict(name=name, values=x, alpha=0.05)
        xx = x[~np.isnan(x)]
        n = len(xx)
        s, vs = mk_s(xx), mk_var_s(xx)
        z = mk_z(s, vs)
        rec.update(n=n, s=s, varS=vs, z=z, pSf=p_two_sided_normal(z), tau=s / (0.5 * n * (n - 1)))
        if pmk is not None:
            r = pmk.original_test(x, 0.05)
            rec["pmk"] = dict(s=r.s, varS=r.var_s, z=r.z, p=r.p, tau=r.Tau, slope=r.slope, intercept=r.intercept)
        mk_out.append(rec)
    fx["mk"] = mk_out

    hr_out = []
    hr_series = [
        ("ar07-60", ar1_noise(rng, 60, 0.7, 1.0) + 0.03 * np.arange(60), False),
        ("white-50", rng.normal(0, 1, 50), False),
        ("ties-ar05-40", np.round(ar1_noise(rng, 40, 0.5, 1.0) + 0.04 * np.arange(40), 0), False),
        ("trend-ar08-80", ar1_noise(rng, 80, 0.8, 1.0) + 0.05 * np.arange(80), False),
    ]
    x = ar1_noise(rng, 50, 0.6, 1.0) + 0.03 * np.arange(50)
    x[[2, 15, 16, 40]] = np.nan
    hr_series.append(("ar06-nans-50", x, True))
    for name, x, has_nan in hr_series:
        ref = hamed_rao_ref(x, 0.05)
        rec = dict(name=name, values=x, alpha=0.05, **ref)
        if pmk is not None and not has_nan:
            r = pmk.hamed_rao_modification_test(x, 0.05)
            rec["pmk"] = dict(s=r.s, varS=r.var_s, z=r.z, p=r.p, tau=r.Tau)
        hr_out.append(rec)
    fx["hamedRao"] = hr_out

    # ---------------------------------------------------------- Sen slope ----
    sen_out = []
    # (a) decimal-year time with gaps and ties in v
    t = np.arange(1981, 2021) + 0.5
    v = np.round(12 + 0.03 * (t - 1981) + rng.normal(0, 0.3, len(t)), 1)
    keep = np.ones(len(t), bool)
    keep[[4, 5, 20]] = False
    t_g, v_g = t[keep], v[keep]
    for alpha in (0.05, 0.1):
        ref = sen_ref(t_g, v_g, alpha)
        th = stats.theilslopes(v_g, t_g, 1 - alpha)
        sen_out.append(dict(name=f"annual-gaps-ties-a{alpha}", t=t_g, v=v_g, alpha=alpha, **ref,
                            scipy=dict(slope=th.slope, intercept=th.intercept, low=th.low_slope, high=th.high_slope)))
    # (b) unit-spaced index time with NaNs -> comparable with pymannkendall.sens_slope
    v = 5 - 0.2 * np.arange(30) + rng.normal(0, 1, 30)
    v[[3, 11, 29]] = np.nan
    t = np.arange(30, dtype=float)
    ref = sen_ref(t, v, 0.05)
    rec = dict(name="index-nans-30", t=t, v=v, alpha=0.05, **ref)
    if pmk is not None:
        r = pmk.sens_slope(v)
        rec["pmk"] = dict(slope=r.slope, intercept=r.intercept)
    sen_out.append(rec)
    # (c) monthly decimal-year time (many slopes)
    tm, _ = monthly_axis(2001, 120)
    v = 0.1 * (tm - 2001) + rng.normal(0, 0.5, len(tm))
    ref = sen_ref(tm, v, 0.05)
    th = stats.theilslopes(v, tm, 0.95)
    sen_out.append(dict(name="monthly-120", t=tm, v=v, alpha=0.05, **ref,
                        scipy=dict(slope=th.slope, intercept=th.intercept, low=th.low_slope, high=th.high_slope)))
    fx["sen"] = sen_out

    # ---------------------------------------------------- Seasonal Kendall ---
    seas_out = []
    for name, n_months, nan_frac, decimals in [("monthly-20y-ties-nans", 240, 0.08, 1),
                                               ("monthly-partial-year", 247, 0.0, 2),
                                               ("monthly-30y-noise", 360, 0.03, 3)]:
        t, dates = monthly_axis(1995, n_months)
        trend = 0.012 if "noise" not in name else 0.0
        v = 15 + 8 * np.cos(2 * np.pi * (t - 1995 - 7 / 12)) + trend * (t - 1995) + rng.normal(0, 0.6, len(t))
        v = np.round(v, decimals)
        v[rng.random(len(t)) < nan_frac] = np.nan
        # per-month reference
        s_tot, var_tot, slopes = 0.0, 0.0, []
        for m in range(12):
            idx = np.arange(m, n_months, 12)
            xm = v[idx]
            tt = t[idx]
            ok = ~np.isnan(xm)
            xm, tt = xm[ok], tt[ok]
            if len(xm) >= 2:
                s_tot += mk_s(xm)
                var_tot += mk_var_s(xm)
                for i in range(len(xm) - 1):
                    for j in range(i + 1, len(xm)):
                        slopes.append((xm[j] - xm[i]) / (tt[j] - tt[i]))
        z = mk_z(s_tot, var_tot)
        rec = dict(name=name, t=t, dates=dates, values=v, alpha=0.05, n=int((~np.isnan(v)).sum()),
                   s=s_tot, varS=var_tot, z=z, pSf=p_two_sided_normal(z), slope=float(np.median(slopes)))
        if pmk is not None:
            r = pmk.seasonal_test(v, period=12, alpha=0.05)
            rec["pmk"] = dict(s=r.s, varS=r.var_s, z=r.z, p=r.p, slope=r.slope)
        seas_out.append(rec)
    fx["seasonal"] = seas_out

    # --------------------------------------------------------- correlation ---
    corr = []
    for name, n, rho, tie_round, nan_pos in [("pos-60", 60, 0.6, None, [5, 30]),
                                             ("weak-25", 25, 0.15, None, []),
                                             ("neg-ties-40", 40, -0.5, 0, [0, 39]),
                                             ("ties-small-15", 15, 0.4, 0, [7])]:
        x = rng.normal(0, 1, n)
        y = rho * x + math.sqrt(1 - rho * rho) * rng.normal(0, 1, n)
        if tie_round is not None:
            x, y = np.round(x * 2, tie_round), np.round(y * 2, tie_round)
        xm, ym = x.copy(), y.copy()
        for k, pos in enumerate(nan_pos):
            (xm if k % 2 == 0 else ym)[pos] = np.nan
        ok = ~np.isnan(xm) & ~np.isnan(ym)
        pr = stats.pearsonr(xm[ok], ym[ok])
        sr = stats.spearmanr(xm[ok], ym[ok])
        corr.append(dict(name=name, x=xm, y=ym, n=int(ok.sum()), pearsonR=pr.statistic, pearsonP=pr.pvalue,
                         spearmanR=sr.statistic, spearmanP=sr.pvalue))
    fx["correlation"] = corr

    # ---------------------------------------------------------------- FDR ----
    fdr = []
    p1 = np.concatenate([rng.uniform(0, 1, 40), rng.uniform(0, 0.01, 10)])
    p2 = np.array([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216, 0.222, 0.251, 0.269,
                   0.275, 0.34, 0.341, 0.384, 0.569, 0.594, 0.696, 0.762, 0.94, 0.942, 0.975, 0.986])  # BH 1995 example
    p3 = np.array([0.01, 0.01, 0.02, 0.02, 0.5, 0.04])
    for name, p in [("mixed-50", p1), ("bh1995", p2), ("ties-6", p3)]:
        for alpha in (0.05, 0.1):
            adj = stats.false_discovery_control(p, method="bh")
            fdr.append(dict(name=name, p=p, alpha=alpha, adjusted=adj, reject=adj <= alpha))
    fx["fdr"] = fdr

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(clean(fx), f, allow_nan=False, separators=(",", ":"))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KiB); pymannkendall={'yes' if pmk else 'no'}")


if __name__ == "__main__":
    main()
