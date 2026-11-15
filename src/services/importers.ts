import type { Point, TimeSeries } from "@/types/domain";
import { decimalYear, monthKey } from "./aggregate";

/* ==========================================================================
   Import time series exported from the challenge's data tools:
   - Giovanni area-averaged time series CSV (metadata header + time,mean_*)
   - AppEEARS point-sample CSV (Date + product band columns)
   - NOAA Climate Data Online CSV (DATE + element columns, daily or monthly)
   - KNMI Climate Explorer text ("# comments", year+12 months or year month value)
   - Generic date,value CSV / TSV
   Daily data are aggregated to monthly means (≥ 10 valid days per month).
   ========================================================================== */

export type ImportFormat = "giovanni" | "appeears" | "cdo" | "knmi" | "generic";

export interface ParsedTable {
  format: ImportFormat;
  meta: Record<string, string>;
  columns: string[]; // candidate value columns
  defaultColumn: string;
  rows: { date: string; values: Record<string, number | null> }[];
  fillValues: number[];
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

const EXCLUDE_COL = /^(id|station|name|latitude|longitude|lat|lon|elevation|category|modis_tile|date|time|.*_line_y_.*|.*_sample_x_.*|.*qc.*|.*qa.*|.*reliability.*|.*_attributes)$/i;

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === delim && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Normalise many date spellings to "YYYY-MM-DD" | "YYYY-MM" | "YYYY". */
export function normaliseDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^A(\d{4})(\d{3})$/); // MODIS AYYYYDDD
  if (m) {
    const d = new Date(Date.UTC(+m[1], 0, +m[2]));
    return d.toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  return null;
}

const toNum = (s: string | undefined, fills: number[]): number | null => {
  if (s === undefined) return null;
  const t = s.replace(/^"|"$/g, "").trim();
  if (t === "" || /^(nan|na|null|-|m|missing)$/i.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  if (fills.some((f) => Math.abs(v - f) < 1e-6 * Math.max(1, Math.abs(f)))) return null;
  if (v <= -9990 || v >= 9.9e30) return null;
  return v;
};

function parseKnmi(lines: string[], warnings: string[]): ParsedTable {
  const rows: ParsedTable["rows"] = [];
  const meta: Record<string, string> = {};
  for (const line of lines) {
    if (line.startsWith("#")) {
      const kv = line.slice(1).split("::");
      if (kv.length === 2) meta[kv[0].trim()] = kv[1].trim();
      continue;
    }
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length >= 13 && parts.every(Number.isFinite)) {
      const y = parts[0];
      for (let m = 1; m <= 12; m++) {
        const v = parts[m];
        rows.push({ date: monthKey(y, m), values: { value: v <= -999 ? null : v } });
      }
    } else if (parts.length === 3 && parts.every(Number.isFinite)) {
      rows.push({ date: monthKey(parts[0], parts[1]), values: { value: parts[2] <= -999 ? null : parts[2] } });
    } else if (parts.length === 2 && parts.every(Number.isFinite)) {
      const y = Math.floor(parts[0]);
      const frac = parts[0] - y;
      const m = Math.min(12, Math.max(1, Math.round(frac * 12 + 0.5)));
      rows.push({ date: frac > 0 ? monthKey(y, m) : String(y), values: { value: parts[1] <= -999 ? null : parts[1] } });
    }
  }
  if (!rows.length) throw new ImportError("Could not find KNMI-style numeric rows in this file.");
  warnings.push("Interpreted as KNMI Climate Explorer text series.");
  return { format: "knmi", meta, columns: ["value"], defaultColumn: "value", rows, fillValues: [-999.9], warnings };
}

export function parseTable(text: string, filename = "data.csv"): ParsedTable {
  const warnings: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 3) throw new ImportError("The file is empty or too short to contain a time series.");

  if (lines.filter((l) => l.startsWith("#")).length > 2 || /\.(txt|dat)$/i.test(filename)) {
    const nonComment = lines.filter((l) => !l.startsWith("#"));
    if (nonComment.length && !/[,;\t]/.test(nonComment[0])) return parseKnmi(lines, warnings);
  }

  // Find header row: first row containing a date/time column name followed by numeric-looking rows.
  const delim = lines.slice(0, 40).some((l) => l.includes("\t") && !l.includes(",")) ? "\t" : lines.slice(0, 40).some((l) => l.includes(";") && !l.includes(",")) ? ";" : ",";
  const meta: Record<string, string> = {};
  const fillValues: number[] = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const cells = splitCsvLine(lines[i], delim);
    const lc = cells.map((c) => c.replace(/^"|"$/g, "").toLowerCase());
    if (lc.some((c) => c === "time" || c === "date" || c === "datetime" || c === "system:time_start")) {
      headerIdx = i;
      break;
    }
    // Giovanni metadata lines "Key:,Value"
    if (cells.length >= 2 && cells[0].endsWith(":")) {
      const key = cells[0].slice(0, -1);
      meta[key] = cells.slice(1).join(", ").replace(/^"|"$/g, "");
      const fm = key.match(/^Fill Value/i) ? Number(cells[1]) : NaN;
      if (Number.isFinite(fm)) fillValues.push(fm);
    }
  }
  if (headerIdx < 0) {
    // Generic two-column file without a recognised header
    const first = splitCsvLine(lines[0], delim);
    if (first.length >= 2 && normaliseDate(first[0])) {
      headerIdx = -1;
      const rows = lines
        .map((l) => splitCsvLine(l, delim))
        .map((c) => ({ date: normaliseDate(c[0]), v: toNum(c[1], fillValues) }))
        .filter((r): r is { date: string; v: number | null } => !!r.date)
        .map((r) => ({ date: r.date, values: { value: r.v } }));
      warnings.push("No header row found — assumed column 1 = date, column 2 = value.");
      return { format: "generic", meta, columns: ["value"], defaultColumn: "value", rows, fillValues, warnings };
    }
    throw new ImportError("Couldn't find a header with a 'time' or 'date' column. Export a time series CSV from Giovanni, AppEEARS or CDO.");
  }

  const header = splitCsvLine(lines[headerIdx], delim).map((h) => h.replace(/^"|"$/g, ""));
  const dateCol = header.findIndex((h) => /^(time|date|datetime|system:time_start)$/i.test(h));
  const dataLines = lines.slice(headerIdx + 1).map((l) => splitCsvLine(l, delim));

  const isGiovanni = header.some((h) => /^mean_/i.test(h)) || Object.keys(meta).some((k) => /User Start Date|URL to Reproduce/i.test(k));
  const isAppeears = header.some((h) => /^(MOD|MYD|VNP|SPL|MCD|ECO)\w*_\d{3}_/i.test(h)) || (header.includes("Latitude") && header.includes("MODIS_Tile"));
  const isCdo = header.includes("STATION") && header.includes("DATE");
  const format: ImportFormat = isGiovanni ? "giovanni" : isAppeears ? "appeears" : isCdo ? "cdo" : "generic";

  // Candidate numeric value columns.
  const columns = header.filter((h, i) => {
    if (i === dateCol || EXCLUDE_COL.test(h)) return false;
    let numeric = 0;
    for (const row of dataLines.slice(0, 50)) if (toNum(row[i], fillValues) !== null) numeric++;
    return numeric > 0;
  });
  if (!columns.length) throw new ImportError("Found a date column but no numeric value columns.");

  const preferred =
    columns.find((c) => /^mean_/i.test(c)) ??
    columns.find((c) => /ndvi|evi|lst|soil|precip|prcp|tavg|chlor|sst|aod|ozone/i.test(c)) ??
    columns[0];

  const rows: ParsedTable["rows"] = [];
  for (const cells of dataLines) {
    const date = normaliseDate(cells[dateCol] ?? "");
    if (!date) continue;
    const values: Record<string, number | null> = {};
    for (const c of columns) values[c] = toNum(cells[header.indexOf(c)], fillValues);
    rows.push({ date, values });
  }
  if (!rows.length) throw new ImportError("No rows with valid dates were found.");
  if (format === "appeears") {
    const ids = new Set(dataLines.map((c) => c[header.indexOf("ID")]).filter(Boolean));
    if (ids.size > 1) warnings.push(`File contains ${ids.size} sample points; values for the same date are averaged.`);
  }
  if (format === "giovanni" && meta["Title"]) warnings.push(`Giovanni series: ${meta["Title"]}`);
  return { format, meta, columns, defaultColumn: preferred, rows, fillValues, warnings };
}

/** Convert a parsed table column into a monthly (or annual) TimeSeries. */
export function tableToSeries(
  table: ParsedTable,
  column: string,
  info: { id: string; variableId: string; regionId: string; label: string; unit: string; filename: string },
): TimeSeries {
  const byMonth = new Map<string, { sum: number; n: number; days: Set<string> }>();
  const annual = new Map<number, number | null>();
  let daily = false;
  for (const r of table.rows) {
    const v = r.values[column];
    if (r.date.length === 4) {
      annual.set(+r.date, v ?? null);
      continue;
    }
    const key = r.date.slice(0, 7);
    if (r.date.length === 10) daily = true;
    const e = byMonth.get(key) ?? { sum: 0, n: 0, days: new Set<string>() };
    if (v !== null && v !== undefined) {
      e.sum += v;
      e.n++;
      e.days.add(r.date);
    }
    byMonth.set(key, e);
  }

  let points: Point[] = [];
  let resolution: TimeSeries["resolution"] = "monthly";
  if (byMonth.size) {
    const keys = [...byMonth.keys()].sort();
    const [y0, m0] = keys[0].split("-").map(Number);
    const [y1, m1] = keys[keys.length - 1].split("-").map(Number);
    for (let y = y0; y <= y1; y++) {
      for (let m = y === y0 ? m0 : 1; m <= (y === y1 ? m1 : 12); m++) {
        const k = monthKey(y, m);
        const e = byMonth.get(k);
        // Daily records need ≥ 10 valid days; 8/16-day composites (≤ 4 per month) need ≥ 1.
        const enough = e && e.n > 0 && (!daily || e.days.size >= 10 || e.n <= 4);
        points.push({ t: decimalYear(y, m), date: k, v: enough ? e!.sum / e!.n : null });
      }
    }
  } else {
    resolution = "annual";
    points = [...annual.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => ({ t: y + 0.5, date: String(y), v }));
  }

  const notes = [...table.warnings];
  if (daily) notes.push("Daily / composite values were averaged to monthly means.");
  return {
    id: info.id,
    variableId: info.variableId,
    regionId: info.regionId,
    label: info.label,
    unit: info.unit,
    resolution,
    points,
    provenance: {
      source: `Imported ${table.format === "generic" ? "file" : table.format.toUpperCase() + " export"} · ${info.filename} · column "${column}"`,
      mode: "import",
      retrieved: new Date().toISOString(),
      url: table.meta["URL to Reproduce Results"],
      sampling: table.meta["Bounding Box"] ? `Bounding box ${table.meta["Bounding Box"]}` : undefined,
      notes,
    },
  };
}
