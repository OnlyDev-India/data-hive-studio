import { Copy, ListChecks, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { COLUMN_TYPES, LENGTH_TYPES, type ColumnDef } from "./model";
import { EMPTY_HINT, TD, TH, ROW_PAD, TD_NUM, TH_NUM } from "./grid-styles";

interface Props {
  columns: ColumnDef[];
  /** Only rows whose name contains this (case blind) are shown. */
  query: string;
  onPatch: (idx: number, f: (c: ColumnDef) => void) => void;
  onRemove: (idx: number) => void;
  onDuplicate: (idx: number) => void;
}

/** One row per column. Row numbers and edits follow the column's place in the
 *  list, not its place in the filtered view. */
export function ColumnsGrid({
  columns,
  query,
  onPatch,
  onRemove,
  onDuplicate,
}: Props) {
  const q = query.trim().toLowerCase();
  const rows = columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col }) => !q || col.name.toLowerCase().includes(q));
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr>
          <th className={`${TH_NUM} w-9 text-center`}>#</th>
          <th className={`${TH} w-28`}>Actions</th>
          <th className={`${TH} min-w-44`}>Column</th>
          <th className={`${TH} w-40`}>Type</th>
          <th className={`${TH} w-24`}>Length</th>
          <th className={`${TH} w-28`}>Nullable</th>
          <th className={`${TH} w-24`}>Primary Key</th>
          <th className={`${TH} w-24`}>Auto Increment</th>
          <th className={`${TH} w-24`}>Unique</th>
          <th className={`${TH} min-w-36`}>Default</th>
          <th className={`${TH} min-w-40`}>Check</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ col, idx }) => (
          <tr key={idx}>
            <td
              className={`${TD_NUM} ${ROW_PAD} text-muted-foreground text-center text-xs`}
            >
              {idx + 1}
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Duplicate column"
                  title="Duplicate column"
                  onClick={() => onDuplicate(idx)}
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Remove column"
                  title="Remove column"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(idx)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                placeholder="column_name"
                aria-label={`Name of column ${idx + 1}`}
                value={col.name}
                onChange={(e) => onPatch(idx, (c) => (c.name = e.target.value))}
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Select
                value={col.data_type}
                onValueChange={(v) =>
                  onPatch(idx, (c) => {
                    c.data_type = v ?? "";
                    if (!LENGTH_TYPES.has(c.data_type)) c.length = "";
                  })
                }
              >
                <SelectTrigger
                  className="w-full font-mono"
                  size="sm"
                  aria-label={`Type of column ${idx + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COLUMN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                className="font-mono"
                disabled={!LENGTH_TYPES.has(col.data_type)}
                placeholder={col.data_type.endsWith("CHAR") ? "255" : ""}
                aria-label={`Length of column ${idx + 1}`}
                value={col.length}
                onChange={(e) =>
                  onPatch(idx, (c) => (c.length = e.target.value))
                }
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={!col.not_null}
                  aria-label={`Column ${idx + 1} is nullable`}
                  onCheckedChange={(v) =>
                    onPatch(idx, (c) => (c.not_null = v !== true))
                  }
                />
                {col.not_null ? "No" : "Yes"}
              </label>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <div className="flex justify-center">
                <Checkbox
                  checked={col.primary_key}
                  aria-label={`Column ${idx + 1} is a primary key`}
                  onCheckedChange={(v) =>
                    onPatch(idx, (c) => (c.primary_key = v === true))
                  }
                />
              </div>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <div className="flex justify-center">
                <Checkbox
                  checked={col.auto_increment}
                  aria-label={`Column ${idx + 1} auto increments`}
                  onCheckedChange={(v) =>
                    onPatch(idx, (c) => (c.auto_increment = v === true))
                  }
                />
              </div>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <div className="flex justify-center">
                <Checkbox
                  checked={col.unique}
                  aria-label={`Column ${idx + 1} is unique`}
                  onCheckedChange={(v) =>
                    onPatch(idx, (c) => (c.unique = v === true))
                  }
                />
              </div>
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                className="font-mono"
                placeholder="0"
                aria-label={`Default of column ${idx + 1}`}
                value={col.default}
                onChange={(e) =>
                  onPatch(idx, (c) => (c.default = e.target.value))
                }
              />
            </td>
            <td className={`${TD} ${ROW_PAD}`}>
              <Input
                className="font-mono"
                placeholder="qty > 0"
                aria-label={`Check of column ${idx + 1}`}
                value={col.check}
                onChange={(e) =>
                  onPatch(idx, (c) => (c.check = e.target.value))
                }
              />
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={11} className={EMPTY_HINT}>
              <ListChecks className="mr-2 inline size-4" />
              {columns.length === 0
                ? "No columns yet. Add one, or copy fields from another table."
                : "No column matches your search."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
