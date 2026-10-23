import { ChevronDown, Copy, ListChecks, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  COLUMN_TYPES,
  LENGTH_TYPES,
  canAutoIncrement,
  defaultSuggestions,
  type ColumnDef,
} from "./model";
import {
  MYSQL_COLUMN_TYPES,
  MYSQL_LENGTH_TYPES,
  MYSQL_NUMERIC_TYPES,
  MYSQL_ON_UPDATE_TYPES,
  MYSQL_VALUE_TYPES,
} from "./mysql-model";
import { EMPTY_HINT, TD, TH, ROW_PAD, TD_NUM, TH_NUM } from "./grid-styles";

interface Props {
  columns: ColumnDef[];
  /** Only rows whose name contains this (case blind) are shown. */
  query: string;
  is_pg?: boolean;
  /** MySQL (spec 0025 AC-18): its types, plus Unsigned, On update and
   *  Comment columns. An ENUM or SET column's values go in Length. */
  is_mysql?: boolean;
  onPatch: (idx: number, f: (c: ColumnDef) => void) => void;
  onRemove: (idx: number) => void;
  onDuplicate: (idx: number) => void;
}

/** One row per column. Row numbers and edits follow the column's place in the
 *  list, not its place in the filtered view. */
export function ColumnsGrid({
  columns,
  query,
  is_pg,
  is_mysql = false,
  onPatch,
  onRemove,
  onDuplicate,
}: Props) {
  const types = is_mysql ? MYSQL_COLUMN_TYPES : COLUMN_TYPES;
  const takes_length = (t: string) =>
    is_mysql
      ? MYSQL_LENGTH_TYPES.has(t) || MYSQL_VALUE_TYPES.has(t)
      : LENGTH_TYPES.has(t);
  const length_hint = (t: string) =>
    MYSQL_VALUE_TYPES.has(t)
      ? "a, b, c"
      : t.endsWith("CHAR")
        ? "255"
        : t === "DECIMAL"
          ? "10,2"
          : "";
  const q = query.trim().toLowerCase();
  const rows = columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col }) => !q || col.name.toLowerCase().includes(q));
  return (
    <table className="text-body w-full min-w-max">
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
          {is_mysql && <th className={`${TH} w-24`}>Unsigned</th>}
          <th className={`${TH} min-w-36`}>Default</th>
          {is_mysql && <th className={`${TH} w-28`}>On update</th>}
          {is_mysql && <th className={`${TH} min-w-36`}>Comment</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ col, idx }) => (
          <tr key={idx}>
            <td
              className={`${TD_NUM} ${ROW_PAD} text-muted-foreground text-small text-center`}
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
                    if (!takes_length(c.data_type)) c.length = "";
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
                    {types.map((t) => (
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
                disabled={!takes_length(col.data_type)}
                placeholder={length_hint(col.data_type)}
                aria-label={
                  MYSQL_VALUE_TYPES.has(col.data_type) && is_mysql
                    ? `Values of column ${idx + 1}`
                    : `Length of column ${idx + 1}`
                }
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
                  disabled={!canAutoIncrement(col, columns, is_mysql)}
                  title={
                    canAutoIncrement(col, columns, is_mysql)
                      ? undefined
                      : is_mysql
                        ? "Needs an integer column that is the only primary key"
                        : "Needs an INTEGER column that is the only primary key"
                  }
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
            {is_mysql && (
              <td className={`${TD} ${ROW_PAD}`}>
                <div className="flex justify-center">
                  <Checkbox
                    checked={!!col.unsigned}
                    disabled={!MYSQL_NUMERIC_TYPES.has(col.data_type)}
                    aria-label={`Column ${idx + 1} is unsigned`}
                    onCheckedChange={(v) =>
                      onPatch(idx, (c) => (c.unsigned = v === true))
                    }
                  />
                </div>
              </td>
            )}
            <td className={`${TD} ${ROW_PAD}`}>
              {(() => {
                const options = defaultSuggestions(col, is_pg, is_mysql);
                return (
                  <div className="flex items-center gap-1">
                    <Input
                      className="font-mono"
                      placeholder="0"
                      aria-label={`Default of column ${idx + 1}`}
                      value={col.default}
                      onChange={(e) =>
                        onPatch(idx, (c) => (c.default = e.target.value))
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="iconXs"
                            disabled={options.length === 0}
                            aria-label={`Default values for column ${idx + 1}`}
                            title={
                              options.length === 0
                                ? "No suggested defaults"
                                : "Pick a default"
                            }
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {options.map((o) => (
                          <DropdownMenuItem
                            key={o}
                            className="font-mono"
                            onClick={() => onPatch(idx, (c) => (c.default = o))}
                          >
                            {o}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })()}
            </td>
            {is_mysql && (
              <td className={`${TD} ${ROW_PAD}`}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={!!col.on_update}
                    disabled={!MYSQL_ON_UPDATE_TYPES.has(col.data_type)}
                    title="ON UPDATE CURRENT_TIMESTAMP"
                    aria-label={`Column ${idx + 1} updates its time on every change`}
                    onCheckedChange={(v) =>
                      onPatch(idx, (c) => (c.on_update = v === true))
                    }
                  />
                  Now
                </label>
              </td>
            )}
            {is_mysql && (
              <td className={`${TD} ${ROW_PAD}`}>
                <Input
                  placeholder="what it holds"
                  aria-label={`Comment of column ${idx + 1}`}
                  value={col.comment ?? ""}
                  onChange={(e) =>
                    onPatch(idx, (c) => (c.comment = e.target.value))
                  }
                />
              </td>
            )}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={is_mysql ? 13 : 10} className={EMPTY_HINT}>
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
