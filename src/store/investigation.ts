import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AnalysisResult, InvestigationConfig, Region, TimeSeries } from "@/types/domain";
import { getVariable } from "@/data/catalog";
import { NAMED_REGION_BY_ID } from "@/data/regions";
import { analyzeSeries } from "@/stats";
import { fetchRegionSeries, loadBundledSeries, type FetchProgress } from "@/services/series";
import { loadDemoSnapshots, resolveDemoRegions } from "@/services/demoCase";
import type { DemoInvestigation } from "@/data/demos";
import type { SamplePlan } from "@/services/geo";

/* ==========================================================================
   Investigation store — the single source of truth for the active
   investigation: config → fetched series → computed analyses.
   Only configs, history and saved reports are persisted (series are cached
   in IndexedDB by the POWER client, so re-runs are fast).
   ========================================================================== */

export type PrimaryMethod = "mk-sen" | "ols-ar1";
export type RunStatus = "idle" | "loading" | "ready" | "error";

export interface AnalysisEntry {
  seriesId: string;
  result?: AnalysisResult;
  error?: string;
}

export interface SavedReport {
  id: string;
  title: string;
  createdAt: string;
  config: InvestigationConfig;
  /** Frozen copies so a report stays reproducible even if data changes. */
  series: TimeSeries[];
  analyses: AnalysisResult[];
  interpretation: string[];
  primary: PrimaryMethod;
}

interface State {
  config: InvestigationConfig | null;
  status: RunStatus;
  progress: FetchProgress | null;
  error: string | null;
  warnings: string[];
  series: Record<string, TimeSeries>;
  analyses: Record<string, AnalysisEntry>;
  plans: Record<string, SamplePlan>;
  usedSnapshot: boolean;
  primary: PrimaryMethod;
  alpha: number;
  history: InvestigationConfig[];
  reports: SavedReport[];

  run: (config: InvestigationConfig) => Promise<void>;
  cancel: () => void;
  addSeries: (series: TimeSeries, region?: Region) => void;
  loadBundled: (snapshotId: string, variableId: string, question?: string) => Promise<void>;
  /** Open a guided demo instantly from its precomputed real-data snapshots (falls back to a live run). */
  openDemo: (demo: DemoInvestigation) => Promise<void>;
  setPrimary: (p: PrimaryMethod) => void;
  setAlpha: (a: number) => void;
  saveReport: (report: SavedReport) => void;
  deleteReport: (id: string) => void;
  clear: () => void;
}

let controller: AbortController | null = null;

export function analyse(series: TimeSeries, primary: PrimaryMethod, alpha: number): AnalysisEntry {
  const v = getVariable(series.variableId);
  // Imported files may use other units (e.g. IMERG mm/hr); only sum when units match the catalog.
  const unitsMatch = !v || series.unit.trim() === v.unit.trim();
  try {
    const result = analyzeSeries(series, {
      alpha,
      primary,
      annualAgg: unitsMatch ? (v?.annualAgg ?? "mean") : "mean",
      annualSumFactor: unitsMatch ? v?.annualSumFactor : undefined,
    });
    return { seriesId: series.id, result };
  } catch (e) {
    return { seriesId: series.id, error: (e as Error).message || "Analysis failed" };
  }
}

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 18);

export const useInvestigation = create<State>()(
  persist(
    (set, get) => ({
      config: null,
      status: "idle",
      progress: null,
      error: null,
      warnings: [],
      series: {},
      analyses: {},
      plans: {},
      usedSnapshot: false,
      primary: "mk-sen",
      alpha: 0.05,
      history: [],
      reports: [],

      run: async (config) => {
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal;
        set({
          config,
          status: "loading",
          error: null,
          warnings: [],
          series: {},
          analyses: {},
          plans: {},
          usedSnapshot: false,
          progress: { done: 0, total: 1, phase: "plan", message: "Preparing investigation…" },
          history: [config, ...get().history.filter((h) => h.id !== config.id)].slice(0, 12),
        });
        try {
          const allSeries: Record<string, TimeSeries> = {};
          const plans: Record<string, SamplePlan> = {};
          const warnings: string[] = [];
          let usedSnapshot = false;
          const nRegions = config.regions.length;
          for (const [i, region] of config.regions.entries()) {
            const res = await fetchRegionSeries(region, config.variableIds, config.startYear, config.endYear, {
              signal,
              onProgress: (p) =>
                set({
                  progress: {
                    ...p,
                    message: nRegions > 1 ? `${region.name} (${i + 1}/${nRegions}) — ${p.message}` : p.message,
                  },
                }),
            });
            for (const s of res.series) allSeries[s.id] = s;
            if (res.plan) plans[region.id] = res.plan;
            warnings.push(...res.warnings);
            usedSnapshot ||= res.usedSnapshot;
          }
          if (signal.aborted) return;
          const { primary, alpha } = get();
          const analyses: Record<string, AnalysisEntry> = {};
          for (const s of Object.values(allSeries)) analyses[s.id] = analyse(s, primary, alpha);
          set({
            series: allSeries,
            analyses,
            plans,
            warnings: [...new Set(warnings)],
            usedSnapshot,
            status: Object.keys(allSeries).length ? "ready" : "error",
            error: Object.keys(allSeries).length
              ? null
              : "None of the selected variables can be fetched live for this region. Import a CSV or choose a NASA POWER variable.",
            progress: null,
          });
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          set({ status: "error", error: (e as Error).message || "Something went wrong while fetching data.", progress: null });
        }
      },

      cancel: () => {
        controller?.abort();
        set({ status: get().series && Object.keys(get().series).length ? "ready" : "idle", progress: null });
      },

      addSeries: (series, region) => {
        const { primary, alpha } = get();
        const cfg: InvestigationConfig =
          get().config ?? {
            id: newId(),
            question: `What does the imported ${series.label} record show?`,
            variableIds: [series.variableId],
            regions: region ? [region] : [],
            startYear: Math.floor(series.points[0]?.t ?? 2000),
            endYear: Math.floor(series.points[series.points.length - 1]?.t ?? 2020),
            resolution: "monthly",
            methods: ["mann-kendall", "sen", "ols", "ci"],
            alpha,
            createdAt: new Date().toISOString(),
          };
        set((s) => ({
          config: {
            ...cfg,
            variableIds: [...new Set([...cfg.variableIds, series.variableId])],
            regions: region && !cfg.regions.some((r) => r.id === region.id) ? [...cfg.regions, region] : cfg.regions,
          },
          series: { ...s.series, [series.id]: series },
          analyses: { ...s.analyses, [series.id]: analyse(series, primary, alpha) },
          status: "ready",
          error: null,
        }));
      },

      loadBundled: async (snapshotId, variableId, question) => {
        set({ status: "loading", error: null, progress: { done: 0, total: 1, phase: "snapshot", message: "Loading bundled dataset…" } });
        const s = await loadBundledSeries(snapshotId);
        if (!s) {
          set({ status: "error", error: `Bundled dataset "${snapshotId}" is not available in this build.`, progress: null });
          return;
        }
        const series = { ...s, variableId: variableId || s.variableId };
        const named = NAMED_REGION_BY_ID[series.regionId];
        const loc = (series.provenance as { location?: { lon: number; lat: number } }).location;
        const center: [number, number] = named?.center ?? (loc ? [loc.lon, loc.lat] : [0, 0]);
        const region: Region = named ?? {
          id: series.regionId,
          name: series.label.split("·").pop()?.trim() || series.regionId,
          kind: "point",
          bbox: { west: center[0] - 1, south: center[1] - 1, east: center[0] + 1, north: center[1] + 1 },
          center,
        };
        const { primary, alpha } = get();
        const t0 = series.points.find((p) => p.v !== null)?.t ?? 2000;
        const t1 = [...series.points].reverse().find((p) => p.v !== null)?.t ?? 2020;
        const config: InvestigationConfig = {
          id: newId(),
          question: question ?? `Is ${getVariable(variableId)?.name.toLowerCase() ?? "this variable"} changing? (${series.label})`,
          variableIds: [series.variableId],
          regions: [region],
          startYear: Math.floor(t0),
          endYear: Math.floor(t1),
          resolution: "monthly",
          methods: ["mann-kendall", "sen", "ols", "ci", "seasonal"],
          alpha,
          createdAt: new Date().toISOString(),
        };
        set({
          config,
          series: { [series.id]: series },
          analyses: { [series.id]: analyse(series, primary, alpha) },
          plans: {},
          status: "ready",
          progress: null,
          warnings: [],
          usedSnapshot: true,
          history: [config, ...get().history].slice(0, 12),
        });
      },

      openDemo: async (demo) => {
        controller?.abort();
        set({ status: "loading", error: null, warnings: [], progress: { done: 0, total: 1, phase: "snapshot", message: "Opening the precomputed demo…" } });
        const regions = await resolveDemoRegions(demo.regions);
        const { primary, alpha } = get();
        const config: InvestigationConfig = {
          id: newId(),
          question: demo.question,
          variableIds: demo.variableIds,
          regions,
          startYear: demo.startYear,
          endYear: demo.endYear,
          resolution: "monthly",
          methods: ["mann-kendall", "sen", "ols", "ci", "seasonal"],
          alpha,
          createdAt: new Date().toISOString(),
          demoId: demo.id,
        };
        const pre = await loadDemoSnapshots(demo, regions);
        if (!pre) return get().run(config);
        const series: Record<string, TimeSeries> = {};
        const analyses: Record<string, AnalysisEntry> = {};
        for (const s of pre.series) {
          series[s.id] = s;
          analyses[s.id] = analyse(s, primary, alpha);
        }
        set({
          config,
          series,
          analyses,
          plans: pre.plans,
          status: "ready",
          error: null,
          progress: null,
          warnings: [],
          usedSnapshot: true,
          history: [config, ...get().history.filter((h) => h.demoId !== demo.id)].slice(0, 12),
        });
      },

      setPrimary: (primary) => {
        const { series, alpha } = get();
        const analyses: Record<string, AnalysisEntry> = {};
        for (const s of Object.values(series)) analyses[s.id] = analyse(s, primary, alpha);
        set({ primary, analyses });
      },

      setAlpha: (alpha) => {
        const { series, primary } = get();
        const analyses: Record<string, AnalysisEntry> = {};
        for (const s of Object.values(series)) analyses[s.id] = analyse(s, primary, alpha);
        set({ alpha, analyses });
      },

      saveReport: (report) => set((s) => ({ reports: [report, ...s.reports.filter((r) => r.id !== report.id)].slice(0, 20) })),
      deleteReport: (id) => set((s) => ({ reports: s.reports.filter((r) => r.id !== id) })),
      clear: () => set({ config: null, status: "idle", series: {}, analyses: {}, plans: {}, error: null, warnings: [], progress: null }),
    }),
    {
      name: "earthscope:v1",
      storage: createJSONStorage(() => {
        try {
          const k = "__es_probe";
          localStorage.setItem(k, "1");
          localStorage.removeItem(k);
          return localStorage;
        } catch {
          const mem = new Map<string, string>();
          return {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => void mem.set(k, v),
            removeItem: (k: string) => void mem.delete(k),
          };
        }
      }),
      partialize: (s) => ({ history: s.history, reports: s.reports, primary: s.primary, alpha: s.alpha, config: s.config }),
    },
  ),
);

/** Convenience selectors */
export const selectSeriesList = (s: State) => Object.values(s.series);
export const selectAnalyses = (s: State) => s.analyses;
