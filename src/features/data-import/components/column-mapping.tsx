import type { ColumnInfo, DbKind } from "@/shared/api";
import { newFieldFor, type Mapping } from "../lib/mapping";
import { inferKind } from "../lib/infer-types";
import { typeName } from "../lib/build-create-sql";
import type { ParsedFile } from "../lib/types";

interface Props {
  columns: ColumnInfo[];
  parsed: ParsedFile;
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
  /** Document stores only: fields this import will create. */
  db?: DbKind;
  added?: ColumnInfo[];
  onAdded?: (a: ColumnInfo[]) => void;
}

const NEW_FIELD = "\u0000new";

/** One row per file column: pick the target column it feeds, or skip it.
 *  A target column takes only one file column. */
export function ColumnMapping({
  columns,
  parsed,
  mapping,
  onMapping,
  db,
  added,
  onAdded,
}: Props) {
  const canAdd = !!added && !!onAdded;
  const isAdded = (name: string) => !!added?.some((a) => a.name === name);
  const targetOf = (i: number) => {
    const name = columns.find((c) => mapping[c.name] === i)?.name ?? "";
    return isAdded(name) ? NEW_FIELD : name;
  };
  function pick(i: number, target: string) {
    const next: Mapping = { ...mapping };
    for (const c of columns) if (next[c.name] === i) next[c.name] = null;
    let keep = added ?? [];
    if (canAdd) {
      // Drop the field this file column was creating before, then make a
      // fresh one if it is asked for again.
      const old = columns.find((c) => mapping[c.name] === i && isAdded(c.name));
      if (old) {
        delete next[old.name];
        keep = keep.filter((a) => a.name !== old.name);
      }
      if (target === NEW_FIELD) {
        const kind = inferKind(parsed.rows.map((r) => r[i] ?? ""));
        const field = newFieldFor(
          parsed.header[i],
          i,
          columns.map((c) => c.name),
          typeName(kind, db),
        );
        keep = [...keep, field];
        next[field.name] = i;
      }
      onAdded(keep);
    }
    if (target !== "" && target !== NEW_FIELD) next[target] = i;
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
                {canAdd && <option value={NEW_FIELD}>Add as new field</option>}
                {columns
                  .filter((c) => !isAdded(c.name))
                  .map((c) => (
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
