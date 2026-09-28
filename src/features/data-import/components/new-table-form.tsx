import { Checkbox, Input } from "@/shared/components/ui";
import { KIND_LABELS, type InferredKind } from "../lib/infer-types";
import { typeName, type NewColumn } from "../lib/build-create-sql";
import type { DbKind } from "@/shared/api";
import { isDocumentDb } from "../lib/typed-cell";

interface Props {
  columns: NewColumn[];
  onColumns: (columns: NewColumn[]) => void;
  db: DbKind | undefined;
}

const KINDS = Object.keys(KIND_LABELS) as InferredKind[];

/** Check each new column's name and guessed type, and
 *  tick any that should be the primary key. */
export function NewTableForm({ columns, onColumns, db }: Props) {
  const docs = isDocumentDb(db);
  const set = (i: number, patch: Partial<NewColumn>) =>
    onColumns(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div>
      <div>
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground sticky top-0 z-10 text-xs">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">
                {docs ? "Field" : "Column"}
              </th>
              <th className="px-3 py-1.5 text-left font-medium">Type</th>
              {!docs && (
                <th className="px-3 py-1.5 text-left font-medium">
                  Primary key
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={c.from} className="border-t">
                <td className="px-3 py-1">
                  <Input
                    className="bg-input/30 h-8"
                    value={c.name}
                    aria-label={`Name for file column ${i + 1}`}
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                </td>
                <td className="px-3 py-1">
                  <select
                    className="bg-input/30 h-8 w-full rounded-md border px-2 text-sm"
                    aria-label={`Type for ${c.name}`}
                    value={c.kind}
                    onChange={(e) =>
                      set(i, { kind: e.target.value as InferredKind })
                    }
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]} ({typeName(k, db)})
                      </option>
                    ))}
                  </select>
                </td>
                {!docs && (
                  <td className="px-3 py-1">
                    <Checkbox
                      checked={c.primaryKey}
                      aria-label={`${c.name} is part of the primary key`}
                      onCheckedChange={(v) =>
                        set(i, { primaryKey: v === true })
                      }
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
