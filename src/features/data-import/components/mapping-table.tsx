import type { ColumnInfo } from "@/shared/api";
import type { Mapping } from "../lib/mapping";
import type { ParsedFile } from "../lib/types";

interface Props {
  columns: ColumnInfo[];
  parsed: ParsedFile;
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
}

/** One row per target column: pick the file column that feeds it, or none.
 *  A file column can feed only one target. */
export function MappingTable({ columns, parsed, mapping, onMapping }: Props) {
  const used = new Set(Object.values(mapping).filter((v) => v !== null));
  return (
    <div className="max-h-52 overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-xs">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Column</th>
            <th className="px-3 py-1.5 text-left font-medium">From file</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} className="border-t">
              <td className="px-3 py-1.5">
                {c.name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {c.data_type}
                  {c.not_null && c.default === null ? " · required" : ""}
                </span>
              </td>
              <td className="px-3 py-1.5">
                <select
                  className="bg-background h-7 w-full rounded-md border px-2 text-sm"
                  aria-label={`File column for ${c.name}`}
                  value={mapping[c.name] ?? ""}
                  onChange={(e) =>
                    onMapping({
                      ...mapping,
                      [c.name]:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">Not imported (use default)</option>
                  {parsed.header.map((h, i) => (
                    <option
                      key={i}
                      value={i}
                      disabled={used.has(i) && mapping[c.name] !== i}
                    >
                      {h || `(column ${i + 1})`}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
