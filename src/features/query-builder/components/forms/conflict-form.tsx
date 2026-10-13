import { FormLabel, Pick, Text } from "@/shared/components/builder-canvas";
import type { Column } from "../../lib/columns";
import { emptySet, type ConflictForm } from "../../lib/forms/writes";
import { quoteIdent, type Dialect } from "../../lib/sql-text";
import { SetRows } from "./set-form";

const label = (cols: string[]) =>
  cols.length > 0 ? `(${cols.join(", ")})` : "";

/** ON CONFLICT: the key the conflict is on (the table's primary key or a
 *  unique index), then DO NOTHING, or DO UPDATE with SET rows that can use
 *  `excluded.<column>` and an optional WHERE. */
export function ConflictBody({
  f,
  columns,
  excluded,
  keys,
  dialect,
  onF,
  newMarker,
}: {
  f: ConflictForm;
  /** The table's own columns. */
  columns: Column[];
  /** `excluded.<column>` for each inserted column. */
  excluded: Column[];
  keys: string[][] | undefined;
  dialect: Dialect;
  onF: (f: ConflictForm) => void;
  newMarker?: () => number;
}) {
  const sets = (keys ?? []).map((k) => k.map((c) => quoteIdent(c, dialect)));
  const current = JSON.stringify(f.target);
  const options: [string, string][] = [
    [JSON.stringify([]), "any conflict"],
    ...sets.map((k): [string, string] => [JSON.stringify(k), label(k)]),
  ];
  if (!options.some(([v]) => v === current))
    options.push([current, label(f.target)]);
  const needs_target =
    f.action === "update" && f.target.length === 0 && dialect === "postgresql";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[auto_1fr_auto_8rem] items-center gap-1.5">
        <FormLabel>On</FormLabel>
        <Pick
          label="Conflict target"
          value={current}
          options={options}
          mono
          onValue={(v) => onF({ ...f, target: JSON.parse(v) as string[] })}
        />
        <FormLabel>do</FormLabel>
        <Pick
          label="Conflict action"
          value={f.action}
          options={[
            ["nothing", "NOTHING"],
            ["update", "UPDATE"],
          ]}
          onValue={(v) =>
            onF({
              ...f,
              action: v as ConflictForm["action"],
              set: v === "update" && f.set.length === 0 ? [emptySet()] : f.set,
            })
          }
        />
      </div>
      {keys && sets.length === 0 && (
        <p className="text-muted-foreground text-small px-1">
          The table has no primary key or unique index to match on.
        </p>
      )}
      {needs_target && (
        <p className="text-muted-foreground text-small px-1">
          DO UPDATE needs the key it matches on.
        </p>
      )}
      {f.action === "update" && (
        <>
          <FormLabel>Set</FormLabel>
          <SetRows
            rows={f.set}
            columns={columns}
            suggest={[...excluded, ...columns]}
            onRows={(set) => onF({ ...f, set })}
            newMarker={newMarker}
          />
          <Text
            label="Only when"
            value={f.where}
            placeholder="only when, such as orders.total < excluded.total"
            onValue={(where) => onF({ ...f, where })}
            mono
          />
        </>
      )}
    </div>
  );
}
