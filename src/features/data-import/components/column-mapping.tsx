import type { ColumnInfo } from "@/shared/api";
import type { Mapping } from "../lib/mapping";
import type { ParsedFile } from "../lib/types";

interface Props {
  columns: ColumnInfo[];
  parsed: ParsedFile;
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
}

/** One row per file column: pick the target column it feeds, or skip it.
 *  A target column takes only one file column. */
export function ColumnMapping({ columns, parsed, mapping, onMapping }: Props) {
  const targetOf = (i: number) =>
    columns.find((c) => mapping[c.name] === i)?.name ?? "";
  function pick(i: number, target: string) {
    const next: Mapping = { ...mapping };
    for (const c of columns) if (next[c.name] === i) next[c.name] = null;
    if (target !== "") next[target] = i;
    onMapping(next);
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted text-muted-foreground sticky top-0 z-10 text-xs">
        <tr>
          <th className="border-b px-3 py-2 text-left font-medium">Source</th>
          <th className="border-b px-3 py-2 text-left font-medium">Target</th>
        </tr>
      </thead>
      <tbody>
        {parsed.header.map((h, i) => (
          <tr key={i}>
            <td className="px-3 py-1.5 font-mono">
              {h || `(column ${i + 1})`}
            </td>
            <td className="px-3 py-1.5">
              <select
                className="bg-input/30 h-8 w-full rounded-md border px-2 font-mono text-sm"
                aria-label={`Target for ${h || `column ${i + 1}`}`}
                value={targetOf(i)}
                onChange={(e) => pick(i, e.target.value)}
              >
                <option value="">Skip</option>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.not_null && c.default === null ? " (required)" : ""}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
