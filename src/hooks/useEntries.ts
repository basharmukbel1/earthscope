import { useMemo } from "react";
import type { AnalysisResult, Region, TimeSeries, Variable } from "@/types/domain";
import { getVariable } from "@/data/catalog";
import { useInvestigation } from "@/store/investigation";

export interface Entry {
  series: TimeSeries;
  result?: AnalysisResult;
  error?: string;
  variable: Variable;
  region: Region | undefined;
}

/** Joined view of the active investigation: series + analysis + variable + region. */
export function useEntries(): Entry[] {
  const series = useInvestigation((s) => s.series);
  const analyses = useInvestigation((s) => s.analyses);
  const config = useInvestigation((s) => s.config);
  return useMemo(() => {
    const regions = new Map((config?.regions ?? []).map((r) => [r.id, r]));
    return Object.values(series)
      .map((s) => {
        const v = getVariable(s.variableId);
        if (!v) return null;
        const a = analyses[s.id];
        return { series: s, result: a?.result, error: a?.error, variable: v, region: regions.get(s.regionId) } as Entry;
      })
      .filter((e): e is Entry => !!e);
  }, [series, analyses, config]);
}

export type ReadyEntry = Entry & { result: AnalysisResult };
export const isReady = (e: Entry): e is ReadyEntry => !!e.result;
