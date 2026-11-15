/* ==========================================================================
   Guided demonstration investigations (challenge: "provide a couple of
   demonstration examples that the user could watch").
   Demos only define QUESTIONS and setup — every number shown is computed
   from real data when the demo runs (live NASA POWER, or a bundled real
   snapshot when offline). Narration never asserts a result in advance.
   ========================================================================== */

export interface DemoRegionRef {
  kind: "country" | "named";
  /** country name as in world-atlas, or NAMED_REGIONS id */
  ref: string;
}

/**
 * A pattern a demo's title takes for granted (e.g. "How fast is the Arctic warming?"
 * presupposes warming). Every claim is checked against the computed result in
 * src/data/__tests__/demos.test.ts; titles without a verified claim must be neutral questions.
 */
export type DemoClaim =
  | { kind: "significant-trend"; variableId: string; region: string; direction: "increasing" | "decreasing" }
  | { kind: "opposite-significant"; variableId: string; regions: [string, string] };

export interface DemoInvestigation {
  id: string;
  title: string;
  question: string;
  variableIds: string[];
  regions: DemoRegionRef[];
  startYear: number;
  endYear: number;
  narration: string[]; // shown step-by-step in "Watch a demo"
  why: string;
  page: "workspace" | "compare" | "relationships";
  /** Patterns the title presupposes — must be backed by the computed results (see DemoClaim). */
  claims?: DemoClaim[];
}

export const DEMOS: DemoInvestigation[] = [
  {
    id: "jordan-precip",
    title: "Is precipitation decreasing in Jordan?",
    question: "Is precipitation decreasing in Jordan?",
    variableIds: ["precip"],
    regions: [{ kind: "country", ref: "Jordan" }],
    startYear: 1981,
    endYear: 2025,
    why: "Jordan is one of the most water-scarce countries on Earth; its rain falls in winter at the edge of the Mediterranean storm track.",
    narration: [
      "We start with a question a detective can test: is rainfall over Jordan going down?",
      "EARTHSCOPE suggests the Precipitation variable (MERRA-2, bias-corrected) and finds Jordan on the map.",
      "We request 45 years of monthly data from the NASA POWER API, sampling every grid cell inside Jordan's border.",
      "Rain falls mostly in winter, so we test ANNUAL TOTALS with Mann-Kendall and estimate the rate with Sen's slope.",
      "The result card tells us the direction, the size per decade, the 95% confidence interval and the p-value — read them together.",
    ],
    page: "workspace",
  },
  {
    id: "levant-compare",
    title: "Jordan vs Saudi Arabia vs Iraq",
    question: "Do Jordan, Saudi Arabia and Iraq show the same precipitation trend?",
    variableIds: ["precip"],
    regions: [
      { kind: "country", ref: "Jordan" },
      { kind: "country", ref: "Saudi Arabia" },
      { kind: "country", ref: "Iraq" },
    ],
    startYear: 1981,
    endYear: 2025,
    why: "Neighbouring regions can trend differently even under the same large-scale process — the challenge's key insight.",
    narration: [
      "Same variable, same years, three neighbouring countries.",
      "Each region is averaged over its own grid cells, then tested independently.",
      "The forest plot puts every trend and its confidence interval on one axis — watch for intervals on opposite sides of zero.",
    ],
    page: "compare",
  },
  {
    id: "arctic-warming",
    title: "How fast is the Arctic warming?",
    claims: [{ kind: "significant-trend", variableId: "t2m", region: "Svalbard & Barents Sea", direction: "increasing" }],
    question: "Is air temperature increasing around Svalbard?",
    variableIds: ["t2m"],
    regions: [{ kind: "named", ref: "arctic-svalbard" }],
    startYear: 1981,
    endYear: 2025,
    why: "The Barents Sea region has lost much of its winter sea ice — a candidate for unusually rapid warming.",
    narration: [
      "Air temperature over Svalbard and the Barents Sea, 1981–2025.",
      "We remove the seasonal cycle to see anomalies, then test the trend with two independent methods.",
      "Compare the trend per decade with the global-average warming you may have heard about.",
    ],
    page: "workspace",
  },
  {
    id: "amazon-soil",
    title: "Is the Amazon frontier drying?",
    question: "Is root-zone soil moisture decreasing in Rondônia?",
    variableIds: ["soil-root", "precip", "t2m"],
    regions: [{ kind: "named", ref: "amazon-rondonia" }],
    startYear: 1981,
    endYear: 2025,
    why: "Deforestation and warming can change how much water soils hold through the dry season.",
    narration: [
      "Root-zone soil moisture changes slowly, so neighbouring months are strongly correlated.",
      "That autocorrelation would make a naive t-test overconfident — EARTHSCOPE shrinks the effective sample size.",
      "Then we relate soil moisture to rainfall and temperature in the Relationship Lab.",
    ],
    page: "workspace",
  },
  {
    id: "igp-aerosol",
    title: "Haze over the Indo-Gangetic Plain",
    question: "Are aerosols increasing over the Indo-Gangetic Plain?",
    variableIds: ["aod"],
    regions: [{ kind: "named", ref: "indo-gangetic" }],
    startYear: 2001,
    endYear: 2025,
    why: "One of the most polluted, densely populated regions on Earth — the atmosphere above many large cities.",
    narration: [
      "Aerosol optical depth measures how hazy the air is.",
      "This record starts in 2001, so we have 25 years — enough for a basic trend test, but watch the confidence interval.",
    ],
    page: "workspace",
  },
  {
    id: "sahel-vs-iberia",
    title: "Do the Sahel and Iberia show opposite rainfall trends?",
    question: "Are precipitation trends in the Sahel and Iberia moving in opposite directions?",
    variableIds: ["precip"],
    regions: [
      { kind: "named", ref: "sahel-west" },
      { kind: "named", ref: "mediterranean-iberia" },
    ],
    startYear: 1981,
    endYear: 2025,
    why: "The Sahel's summer monsoon and Iberia's winter storms respond to different parts of the circulation.",
    narration: [
      "Two regions, one variable.",
      "If their confidence intervals sit on opposite sides of zero, the trends genuinely oppose each other.",
    ],
    page: "compare",
  },
];

export const DEMO_BY_ID: Record<string, DemoInvestigation> = Object.fromEntries(DEMOS.map((d) => [d.id, d]));

/** Where a demo's finished case opens. */
export const demoPath = (d: DemoInvestigation) => (d.page === "compare" ? "/compare" : d.page === "relationships" ? "/relationships" : "/workspace");
