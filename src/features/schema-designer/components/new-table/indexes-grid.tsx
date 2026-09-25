import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { ColumnChips } from "./column-chips";
import { EMPTY_HINT, TD, TH, ROW_PAD, TD_NUM, TH_NUM } from "./grid-styles";
import type { IndexDef } from "./model";

interface Props {
  indexes: IndexDef[];
  /** Names of the columns typed so far. */
  columns: string[];
  onPatch: (idx: number, patch: Partial<IndexDef>) => void;
  onRemove: (idx: number) => void;
}

/** Indexes made together with the table, right after it. */
export function IndexesGrid({ indexes, columns, onPatch, onRemove }: Props) {
  if (indexes.length === 0)
    return (
      <p className={EMPTY_HINT}>
        No indexes. Add one to speed up lookups on these columns.
      </p>
    );
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr>
          <th className={`${TH_NUM} w-9 text-center`}>#</th>
          <th className={`${TH} w-16`}>Actions</th>
          <th className={`${TH} min-w-48`}>Name</th>
          <th className={TH}>Columns</th>
          <th className={`${TH} w-24`}>Unique</th>
        </tr>
      </thead>
      <tbody>
        {indexes.map((ix, idx) => (
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
                aria-label="Remove index"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemove(idx)}
              >
                <X className="size-4" />
              </Button>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                placeholder="made from the columns"
                aria-label={`Name of index ${idx + 1}`}
                value={ix.name}
                onChange={(e) => onPatch(idx, { name: e.target.value })}
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <ColumnChips
                columns={columns}
                value={ix.columns}
                onChange={(c) => onPatch(idx, { columns: c })}
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <div className="flex justify-center">
                <Checkbox
                  checked={ix.unique}
                  aria-label={`Index ${idx + 1} is unique`}
                  onCheckedChange={(v) => onPatch(idx, { unique: v === true })}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
