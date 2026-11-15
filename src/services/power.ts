import { cacheGet, cacheSet } from "./cache";

/* ==========================================================================
   NASA POWER API client (https://power.larc.nasa.gov/) — CORS-enabled, no key.
   Monthly point endpoint: up to 20 parameters per request; values keyed
   "YYYYMM" (MM = 13 is the annual value and is ignored); −999 = missing.
   Concurrency-limited, retried with exponential backoff + jitter, in-flight
   requests de-duplicated, responses cached in IndexedDB.
   ========================================================================== */

export const POWER_BASE = "https://power.larc.nasa.gov/api/temporal/monthly/point";
export const POWER_FILL = -999;

export type MonthlyValues = Record<string, number | null>; // "YYYY-MM" -> value
export type PowerPointData = Record<string, MonthlyValues>; // parameter -> values

export interface PowerPointRequest {
  lat: number;
  lon: number;
  parameters: string[];
  start: number;
  end: number;
  signal?: AbortSignal;
}

export class PowerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "PowerError";
  }
}

const MAX_CONCURRENCY = 3;
let active = 0;
const queue: (() => void)[] = [];
const inflight = new Map<string, Promise<PowerPointData>>();

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    const go = () => {
      active++;
      resolve();
    };
    if (active < MAX_CONCURRENCY) go();
    else queue.push(go);
  });
}
function release() {
  active--;
  const next = queue.shift();
  if (next) next();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

export function powerUrl(req: Omit<PowerPointRequest, "signal">): string {
  const q = new URLSearchParams({
    parameters: req.parameters.join(","),
    community: "AG",
    longitude: req.lon.toFixed(4),
    latitude: req.lat.toFixed(4),
    start: String(req.start),
    end: String(req.end),
    format: "JSON",
  });
  return `${POWER_BASE}?${q.toString()}`;
}

function parseResponse(json: unknown, parameters: string[]): PowerPointData {
  const params = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })?.properties?.parameter;
  if (!params) {
    const msgs = (json as { messages?: string[]; errors?: string[] })?.errors ?? (json as { messages?: string[] })?.messages;
    throw new PowerError(`NASA POWER returned no data${msgs?.length ? `: ${msgs.join("; ")}` : ""}`, undefined, false);
  }
  const out: PowerPointData = {};
  for (const p of parameters) {
    const raw = params[p] ?? {};
    const vals: MonthlyValues = {};
    for (const [k, v] of Object.entries(raw)) {
      const mm = k.slice(4);
      if (mm === "13") continue; // annual value
      vals[`${k.slice(0, 4)}-${mm}`] = v === POWER_FILL || v === null || !Number.isFinite(v) ? null : v;
    }
    out[p] = vals;
  }
  return out;
}

/** Fetch monthly values for one location (cached, de-duplicated, retried). */
export async function fetchPowerPoint(req: PowerPointRequest): Promise<PowerPointData> {
  const params = [...new Set(req.parameters)].sort();
  const key = `power:v1:${req.lat.toFixed(3)}:${req.lon.toFixed(3)}:${req.start}-${req.end}:${params.join(",")}`;
  const cached = await cacheGet<PowerPointData>(key);
  if (cached) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    await acquire();
    try {
      const url = powerUrl({ ...req, parameters: params });
      let lastErr: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          const res = await fetch(url, { signal: req.signal });
          if (res.status === 429 || res.status >= 500) throw new PowerError(`NASA POWER HTTP ${res.status}`, res.status, true);
          if (!res.ok) throw new PowerError(`NASA POWER HTTP ${res.status}`, res.status, false);
          const data = parseResponse(await res.json(), params);
          void cacheSet(key, data);
          return data;
        } catch (e) {
          if ((e as Error).name === "AbortError") throw e;
          lastErr = e;
          if (e instanceof PowerError && !e.retryable) throw e;
          const backoff = Math.min(8000, 600 * 2 ** attempt) * (0.6 + Math.random() * 0.8);
          await sleep(backoff, req.signal);
        }
      }
      throw lastErr instanceof Error
        ? new PowerError(`Could not reach NASA POWER after several attempts (${lastErr.message}).`)
        : new PowerError("Could not reach NASA POWER.");
    } finally {
      release();
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** POWER's MERRA-2 grid: 0.5° latitude × 0.625° longitude cell centres. */
export const POWER_GRID = { dLat: 0.5, dLon: 0.625 };

export function snapToPowerGrid(lon: number, lat: number): [number, number] {
  const sLat = Math.max(-89.75, Math.min(89.75, Math.round(lat / POWER_GRID.dLat) * POWER_GRID.dLat));
  let sLon = Math.round(lon / POWER_GRID.dLon) * POWER_GRID.dLon;
  if (sLon > 180) sLon -= 360;
  if (sLon < -180) sLon += 360;
  return [sLon, sLat];
}
