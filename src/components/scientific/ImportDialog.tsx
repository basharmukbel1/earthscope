import { useState } from "react";
import { FileUp } from "lucide-react";
import type { Region } from "@/types/domain";
import { Dialog, Select, TextInput } from "@/components/ui/Controls";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/States";
import { VARIABLES, TOOL_INFO, getVariable } from "@/data/catalog";
import { parseTable, tableToSeries, type ParsedTable } from "@/services/importers";
import { useInvestigation, newId } from "@/store/investigation";

/** Import a Giovanni / AppEEARS / CDO / KNMI / generic time series and analyse it. */
export function ImportDialog({ open, onClose, defaultVariable }: { open: boolean; onClose: () => void; defaultVariable?: string }) {
  const addSeries = useInvestigation((s) => s.addSeries);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [column, setColumn] = useState("");
  const [variableId, setVariableId] = useState(defaultVariable ?? "ndvi");
  const [regionName, setRegionName] = useState("");
  const [unit, setUnit] = useState(getVariable(defaultVariable ?? "ndvi")?.unit ?? "");

  const onFile = async (f: File) => {
    setError(null);
    setTable(null);
    setFileName(f.name);
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error("File is larger than 25 MB.");
      const text = await f.text();
      const t = parseTable(text, f.name);
      setTable(t);
      setColumn(t.defaultColumn);
      const bb = t.meta["Bounding Box"];
      if (bb && !regionName) setRegionName(`Box ${bb}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirm = () => {
    if (!table) return;
    const regionId = `import-${newId()}`;
    const name = regionName.trim() || "Imported area";
    const series = tableToSeries(table, column, {
      id: `${regionId}__${variableId}`,
      variableId,
      regionId,
      label: `${getVariable(variableId)?.name ?? "Variable"} · ${name}`,
      unit: unit || getVariable(variableId)?.unit || "",
      filename: fileName,
    });
    const valid = series.points.filter((p) => p.v !== null).length;
    if (valid < 24) {
      setError(`Only ${valid} valid values after parsing — need at least 24 monthly values (or 8 years).`);
      return;
    }
    const region: Region = { id: regionId, name, kind: "bbox", bbox: { west: -180, south: -90, east: 180, north: 90 }, center: [0, 0], context: "Imported time series (region defined by the source tool)." };
    addSeries(series, region);
    onClose();
    setTable(null);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Import a time series">
      <p className="text-sm text-[var(--color-ink-3)]">
        Export an area-averaged or point time series from{" "}
        {(["giovanni", "appeears", "hydrology", "cdo", "knmi"] as const).map((t, i, a) => (
          <span key={t}>
            <a className="text-[var(--color-ice)] hover:underline" href={TOOL_INFO[t].url} target="_blank" rel="noreferrer">
              {TOOL_INFO[t].label}
            </a>
            {i < a.length - 1 ? ", " : ""}
          </span>
        ))}{" "}
        and drop the CSV/TXT here. EARTHSCOPE detects the format, removes fill values and aggregates daily data to monthly means.
      </p>
      <label className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-bright)] bg-white/[0.02] px-6 py-8 text-center hover:border-[var(--color-cyan)]">
        <FileUp className="h-6 w-6 text-[var(--color-ice)]" />
        <span className="text-sm">{fileName || "Choose a .csv or .txt file"}</span>
        <span className="text-xs text-[var(--color-ink-4)]">Processed locally in your browser — nothing is uploaded.</span>
        <input type="file" accept=".csv,.txt,.tsv,.dat,text/csv,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {error && <ErrorState className="mt-4" title="Couldn't import this file" message={error} />}
      {table && (
        <div className="mt-5 space-y-4">
          <div className="text-xs text-[var(--color-ink-3)]">
            Detected <span className="font-mono text-[var(--color-cyan)]">{table.format.toUpperCase()}</span> · {table.rows.length} rows
            {table.warnings.length > 0 && <span className="block text-[var(--color-ink-4)]">{table.warnings.join(" ")}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Value column" value={column} onChange={(e) => setColumn(e.target.value)}>
              {table.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select
              label="Variable"
              value={variableId}
              onChange={(e) => {
                setVariableId(e.target.value);
                setUnit(getVariable(e.target.value)?.unit ?? "");
              }}
            >
              {VARIABLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            <TextInput label="Region name" value={regionName} onChange={(e) => setRegionName(e.target.value)} placeholder="e.g. Nile Delta" />
            <TextInput label="Unit (as in the file)" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm}>
              Analyse imported series
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
