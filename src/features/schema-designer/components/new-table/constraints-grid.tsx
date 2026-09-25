import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { ColumnChips } from "./column-chips";
import { EMPTY_HINT, TD, TH, ROW_PAD, TD_NUM, TH_NUM } from "./grid-styles";
import type { ConstraintDef } from "./model";

interface Props {
  constraints: ConstraintDef[];
  columns: string[];
  onPatch: (idx: number, patch: Partial<ConstraintDef>) => void;
  onRemove: (idx: number) => void;
}

/** Table level rules: UNIQUE across several columns, or a CHECK expression. */
export function ConstraintsGrid({
  constraints,
  columns,
  onPatch,
  onRemove,
}: Props) {
  if (constraints.length === 0)
    return (
      <p className={EMPTY_HINT}>
        No constraints. Add a UNIQUE over several columns, or a CHECK rule.
      </p>
    );
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr>
          <th className={`${TH_NUM} w-9 text-center`}>#</th>
          <th className={`${TH} w-16`}>Actions</th>
          <th className={`${TH} w-32`}>Type</th>
          <th className={`${TH} min-w-48`}>Name</th>
          <th className={TH}>Definition</th>
        </tr>
      </thead>
      <tbody>
        {constraints.map((k, idx) => (
          <tr key={idx}>
            <td
              className={`${TD_NUM} ${ROW_PAD} text-muted-foreground text-center text-xs`}
            >
              {idx + 1}
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Remove constraint"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemove(idx)}
              >
                <X className="size-4" />
              </Button>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <select
                className="bg-input/30 h-7 w-full rounded-md border px-2 text-sm"
                aria-label={`Type of constraint ${idx + 1}`}
                value={k.kind}
                onChange={(e) =>
                  onPatch(idx, {
                    kind: e.target.value as ConstraintDef["kind"],
                  })
                }
              >
                <option value="UNIQUE">UNIQUE</option>
                <option value="CHECK">CHECK</option>
              </select>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                placeholder="optional"
                aria-label={`Name of constraint ${idx + 1}`}
                value={k.name}
                onChange={(e) => onPatch(idx, { name: e.target.value })}
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              {k.kind === "CHECK" ? (
                <Input
                  className="font-mono"
                  placeholder="qty > 0"
                  aria-label={`Expression of constraint ${idx + 1}`}
                  value={k.expr}
                  onChange={(e) => onPatch(idx, { expr: e.target.value })}
                />
              ) : (
                <ColumnChips
                  columns={columns}
                  value={k.columns}
                  onChange={(c) => onPatch(idx, { columns: c })}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
