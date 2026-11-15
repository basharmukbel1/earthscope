import type { AtlasLayer } from "@/types/domain";

/* Real Trend Atlas layers computed from NASA POWER by scripts/build-atlas.ts. */

const modules = import.meta.glob<{ default: AtlasLayer }>("../data/atlas/*.json");

export interface AtlasManifest {
  variables: { variableId: string; points: number; sigUp: number; sigDown: number; startYear?: number; endYear?: number }[];
  retrieved: string;
  [k: string]: unknown;
}

const cache = new Map<string, Promise<AtlasLayer | null>>();

export function loadAtlas(variableId: string): Promise<AtlasLayer | null> {
  if (!cache.has(variableId)) {
    const entry = Object.entries(modules).find(([p]) => p.endsWith(`/${variableId}.json`));
    cache.set(variableId, entry ? entry[1]().then((m) => m.default).catch(() => null) : Promise.resolve(null));
  }
  return cache.get(variableId)!;
}

export async function loadAtlasManifest(): Promise<AtlasManifest | null> {
  const entry = Object.entries(modules).find(([p]) => p.endsWith("/manifest.json"));
  if (!entry) return null;
  try {
    return (await entry[1]()).default as unknown as AtlasManifest;
  } catch {
    return null;
  }
}

export const ATLAS_VARIABLES: { id: string; label: string }[] = [
  { id: "t2m", label: "Air temperature" },
  { id: "precip", label: "Precipitation" },
  { id: "soil-surface", label: "Surface soil moisture" },
  { id: "water-vapor", label: "Water vapor" },
];

export function availableAtlasIds(): string[] {
  return Object.keys(modules)
    .map((p) => p.split("/").pop()!.replace(".json", ""))
    .filter((id) => id !== "manifest");
}
