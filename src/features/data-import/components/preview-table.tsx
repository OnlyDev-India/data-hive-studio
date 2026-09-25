import { useMemo } from "react";
import type { ColumnInfo, DbKind } from "@/shared/api";
import type { Mapping } from "../lib/mapping";
import { convertRow, makeContext } from "../lib/prepare";
import type { ParsedFile } from "../lib/types";

const PREVIEW_ROWS = 50;

interface Props {
  parsed: ParsedFile;
  mapping: Mapping;
  columns: ColumnInfo[];
  db: DbKind | undefined;
  emptyAsText: boolean;
  /** A new collection: show the typed values that will be sent. */
  newCollection?: boolean;
}

function show(v: unknown): string {
  if (v === null) return "NULL";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** The first 50 rows as they will be written: after mapping, the empty cell
 *  rule and value conversion. A cell that fails its type check is red. */
export function PreviewTable({
  parsed,
  mapping,
  columns,
  db,
  emptyAsText,
  newCollection,
}: Props) {
  const view = useMemo(() => {
    const ctx = makeContext(
      parsed,
      mapping,
      columns,
      db,
      emptyAsText,
      newCollection,
    );
    return {
      names: ctx.targets.map((t) => t.name),
      rows: parsed.rows.slice(0, PREVIEW_ROWS).map((r, i) => ({
        ...convertRow(r, ctx),
        sourceRow: parsed.sourceRows[i],
      })),
    };
  }, [parsed, mapping, columns, db, emptyAsText, newCollection]);

  if (view.names.length === 0) {
    return (
      <p className="text-muted-foreground p-3 text-sm">
        Map at least one column to see the rows.
      </p>
    );
  }
  return (
    <div>
      <table className="w-full text-xs">
        <thead className="bg-muted text-muted-foreground sticky top-0 z-10">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Row</th>
            {view.names.map((n) => (
              <th key={n} className="px-2 py-1 text-left font-medium">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => (
            <tr
              key={r.sourceRow}
              className={`border-t ${r.rowProblem ? "bg-destructive/10" : ""}`}
              title={r.rowProblem ?? undefined}
            >
              <td className="text-muted-foreground px-2 py-1">{r.sourceRow}</td>
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={`max-w-48 truncate px-2 py-1 ${
                    r.problems[i] ? "bg-destructive/15 text-destructive" : ""
                  } ${c === null || r.omit[i] ? "text-muted-foreground italic" : ""}`}
                  title={r.problems[i] ?? undefined}
                >
                  {r.omit[i] ? "(left out)" : show(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
