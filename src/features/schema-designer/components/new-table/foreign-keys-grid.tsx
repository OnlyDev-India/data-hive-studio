import { KeyRound, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { EMPTY_HINT, TD, TH, ROW_PAD, TD_NUM, TH_NUM } from "./grid-styles";
import {
  FK_ACTIONS,
  type ColumnDef,
  type FkAction,
  type FkDef,
  type RefTableMeta,
} from "./model";

interface Props {
  fks: FkDef[];
  columns: ColumnDef[];
  tableNames: string[];
  refMeta: Record<string, RefTableMeta>;
  onPatch: (idx: number, f: (k: FkDef) => void) => void;
  onRemove: (idx: number) => void;
}

function ActionSelect({
  value,
  label,
  onChange,
}: {
  value: FkAction;
  label: string;
  onChange: (v: FkAction) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange((v ?? "NO ACTION") as FkAction)}
    >
      <SelectTrigger className="w-full" size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {FK_ACTIONS.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Foreign keys — reference real tables and columns through pickers. */
export function ForeignKeysGrid({
  fks,
  columns,
  tableNames,
  refMeta,
  onPatch,
  onRemove,
}: Props) {
  if (fks.length === 0)
    return (
      <p className={EMPTY_HINT}>
        No foreign keys. Add one to reference another table. The target column
        must be that table's primary key (
        <KeyRound className="inline size-3 text-amber-500" />) or UNIQUE (·U).
      </p>
    );
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr>
          <th className={`${TH_NUM} w-9 text-center`}>#</th>
          <th className={`${TH} w-16`}>Actions</th>
          <th className={`${TH} w-44`}>Column</th>
          <th className={`${TH} w-48`}>References table</th>
          <th className={`${TH} w-48`}>References column</th>
          <th className={`${TH} w-40`}>On delete</th>
          <th className={`${TH} w-40`}>On update</th>
        </tr>
      </thead>
      <tbody>
        {fks.map((fk, idx) => {
          const meta = refMeta[fk.ref_table];
          const targets = (meta?.cols ?? []).filter((c) =>
            meta?.valid_targets.includes(c),
          );
          return (
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
                  aria-label="Remove foreign key"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(idx)}
                >
                  <X className="size-4" />
                </Button>
              </td>
              <td className={`${TD} ${ROW_PAD}`}>
                <Select
                  value={fk.column || undefined}
                  onValueChange={(v) =>
                    onPatch(idx, (k) => (k.column = v ?? ""))
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    size="sm"
                    aria-label="Local column"
                  >
                    <SelectValue placeholder="local column" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {columns
                        .filter((c) => c.name.trim())
                        .map((c) => (
                          <SelectItem key={c.name} value={c.name.trim()}>
                            {c.name.trim()}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </td>
              <td className={`${TD} ${ROW_PAD}`}>
                <Select
                  value={fk.ref_table || undefined}
                  onValueChange={(v) =>
                    onPatch(idx, (k) => (k.ref_table = v ?? ""))
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    size="sm"
                    aria-label="Referenced table"
                  >
                    <SelectValue placeholder="table" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {tableNames.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </td>
              <td className={`${TD} ${ROW_PAD}`}>
                {/* key remounts on table switch: Base UI's Select goes
                    uncontrolled when value is undefined, so without this it
                    keeps displaying the previous table's selection. */}
                <Select
                  key={fk.ref_table}
                  value={fk.ref_column || undefined}
                  disabled={!fk.ref_table}
                  onValueChange={(v) =>
                    onPatch(idx, (k) => (k.ref_column = v ?? ""))
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    size="sm"
                    aria-label="Referenced column"
                  >
                    <SelectValue
                      placeholder={
                        targets.length <= 0
                          ? "No Primary or unique key"
                          : fk.ref_table
                            ? "column"
                            : "pick a table"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {targets.length <= 0 && (
                        <SelectItem value="empty" disabled>
                          No Primary or unique key
                        </SelectItem>
                      )}
                      {targets.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                          {meta?.pk === c ? (
                            <KeyRound className="size-4 text-amber-500!" />
                          ) : (
                            " ·U"
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </td>
              <td className={`${TD} ${ROW_PAD}`}>
                <ActionSelect
                  value={fk.on_delete}
                  label="On delete"
                  onChange={(v) => onPatch(idx, (k) => (k.on_delete = v))}
                />
              </td>
              <td className={`${TD} ${ROW_PAD}`}>
                <ActionSelect
                  value={fk.on_update}
                  label="On update"
                  onChange={(v) => onPatch(idx, (k) => (k.on_update = v))}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
