export interface GlossaryEntry {
  term: string;
  short: string;
  long: string;
  link?: { label: string; url: string };
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  trend: {
    term: "Trend",
    short: "A steady change in one direction over time.",
    long: "A trend is a persistent rise or fall in a variable that stands out from its natural ups and downs. EARTHSCOPE estimates linear trends — the average change per year (reported per decade).",
  },
  "p-value": {
    term: "p-value",
    short: "How surprising the trend would be if there were really no trend.",
    long: "The p-value is the probability of seeing a trend at least this strong just from random year-to-year variability if the true trend were zero. Small p-values (below the chosen α, usually 0.05) mean the trend is unlikely to be a fluke. A p-value is not the probability that the trend is real, and it says nothing about how big or important the trend is.",
    link: { label: "A Comprehensive Guide to Statistical Significance (Statsig)", url: "https://www.statsig.com/perspectives/a-comprehensive-guide-to-statistical-significance" },
  },
  significance: {
    term: "Statistical significance",
    short: "The trend is unlikely to be explained by chance alone (p < α).",
    long: "We call a trend 'significant' when its p-value is below α = 0.05. Significance depends on the size of the trend, the noise, and the length of the record — a real but small trend can be non-significant simply because the record is short.",
  },
  "practical-importance": {
    term: "Practical importance",
    short: "Whether the size of the change matters in the real world.",
    long: "A tiny change can be highly significant in a long, smooth record; a large change can be non-significant in a short, noisy one. Always look at the magnitude (per decade, % of the mean) and its confidence interval, not only the p-value.",
  },
  "mann-kendall": {
    term: "Mann-Kendall test",
    short: "A rank-based test for a monotonic upward or downward trend.",
    long: "The Mann-Kendall test compares every pair of years and counts how often later values are larger than earlier ones. It does not assume a straight line or normally distributed data, so it is robust to outliers. EARTHSCOPE applies it to annual values (corrected for ties).",
    link: { label: "Statistical test methods to detect trends", url: "https://medium.com/@snp.kriss/statistical-test-methods-to-detect-trends-in-time-series-data-b361a0ec530b" },
  },
  "sen-slope": {
    term: "Sen's slope",
    short: "The median of all pairwise slopes — a robust trend rate.",
    long: "Sen's (Theil–Sen) slope is the median slope over every pair of years. Paired with Mann-Kendall it gives a robust trend rate; its confidence interval follows Gilbert (1987).",
  },
  ols: {
    term: "Linear regression (OLS)",
    short: "The best-fitting straight line through the data.",
    long: "Ordinary least squares fits a straight line by minimising squared errors. Its slope is tested with a t-test. Because neighbouring months are correlated, EARTHSCOPE uses an effective sample size (Santer et al. 2000) to avoid overconfident p-values.",
  },
  "confidence-interval": {
    term: "Confidence interval",
    short: "A range of trend values compatible with the data.",
    long: "A 95% confidence interval gives the plausible range of the true trend. If it excludes zero, the trend is significant at α = 0.05. Wide intervals mean high uncertainty.",
  },
  "t-test": {
    term: "t-test",
    short: "Tests whether a regression slope is different from zero.",
    long: "The slope divided by its standard error follows a Student t distribution if the true slope is zero; the resulting p-value tests the trend.",
  },
  anomaly: {
    term: "Anomaly",
    short: "How far a value is from its normal for that time of year.",
    long: "Anomalies remove the seasonal cycle: a July value is compared with the average July. Trends are easier to see and test in anomalies because summer/winter swings are gone.",
  },
  seasonality: {
    term: "Seasonal cycle",
    short: "The regular yearly rhythm of a variable.",
    long: "Most Earth variables swing with the seasons. The challenge notes that trends may be hidden until the seasonal cycle is removed — EARTHSCOPE does this with monthly climatology.",
  },
  autocorrelation: {
    term: "Autocorrelation",
    short: "When one month's value depends on the previous month's.",
    long: "Autocorrelated data contain less independent information than their length suggests, which makes naive p-values too small. EARTHSCOPE corrects for lag-1 autocorrelation.",
  },
  "seasonal-kendall": {
    term: "Seasonal Kendall test",
    short: "Mann-Kendall applied month-by-month, then combined.",
    long: "Hirsch et al. (1982): Januaries are compared only with Januaries, Februaries with Februaries, and so on, so the seasonal cycle cannot create a false trend.",
  },
  "years-to-detect": {
    term: "Years needed to detect",
    short: "How long a record must be for this trend to become detectable.",
    long: "Weatherhead et al. (1998) estimate the number of years needed to detect a trend of a given size given the noise and autocorrelation of the data. If a trend is not yet significant, this tells you whether more data would likely change that.",
  },
  correlation: {
    term: "Correlation",
    short: "How strongly two variables move together.",
    long: "Pearson's r ranges from −1 to +1. Correlation does NOT establish causation: two variables can move together because a third factor drives both, or by coincidence.",
  },
  reanalysis: {
    term: "Reanalysis",
    short: "A model 'replay' of past weather constrained by observations.",
    long: "Reanalyses such as MERRA-2 combine satellite and ground observations with a weather model to produce consistent global fields back to 1980. They fill gaps but can be affected by changes in the observing system.",
  },
  fdr: {
    term: "False discovery rate",
    short: "Controls false alarms when testing many locations at once.",
    long: "Testing hundreds of map points at α = 0.05 would produce ~5% false 'significant' trends by chance. The Benjamini–Hochberg FDR procedure (Wilks 2016) keeps the expected share of false discoveries below q = 0.05 — EARTHSCOPE uses it for the global Trend Atlas, while a single time series is significant when p < 0.05.",
  },
};

export const glossaryTerms = Object.keys(GLOSSARY);
