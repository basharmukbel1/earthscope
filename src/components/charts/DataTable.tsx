import { memo } from "react";

export type DataCell = string | number | null | undefined;

export interface DataTableProps {
  /** Table caption read by screen readers (what the chart shows). */
  caption: string;
  columns: string[];
  rows: DataCell[][];
  id?: string;
  /** Text used for null / missing cells. */
  missingText?: string;
  /** Visually hidden by default; set false to show it (e.g. a "table view" toggle). */
  hidden?: boolean;
}

/**
 * The accessible twin of every chart: a semantic table with the same values,
 * visually hidden but reachable with screen-reader table navigation.
 */
function DataTableImpl({ caption, columns, rows, id, missingText = "missing", hidden = true }: DataTableProps) {
  const table = (
    <table id={id} className={hidden ? undefined : "es-table"}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 ? (
                <th key={c} scope="row">
                  {cell ?? missingText}
                </th>
              ) : (
                <td key={c}>{cell == null || cell === "" ? missingText : cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
  // Tables ignore `overflow`, so the clip lives on a wrapper — otherwise a long
  // hidden table still extends the page's scrollable area.
  return hidden ? <div className="sr-only">{table}</div> : table;
}

export const DataTable = memo(DataTableImpl);
