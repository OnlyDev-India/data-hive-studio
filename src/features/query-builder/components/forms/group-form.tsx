import {
  FormLabel,
  Pick,
  Rows,
  Text,
} from "@/shared/components/builder-canvas";
import type { Column } from "../../lib/columns";
import {
  AGGREGATES,
  type Aggregate,
  type GroupForm,
} from "../../lib/forms/lists";
import { ColumnInput } from "./inputs";

export function GroupBody({
  g,
  columns,
  onG,
}: {
  g: GroupForm;
  columns: Column[];
  onG: (g: GroupForm) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FormLabel>Group by</FormLabel>
      <Rows<string>
        rows={g.keys}
        add="Add key column"
        blank=""
        onRows={(keys) => onG({ ...g, keys })}
        cols="grid-cols-[1fr_1.5rem]"
        render={(k, set) => (
          <ColumnInput columns={columns} value={k} onValue={set} />
        )}
      />
      <FormLabel>Aggregates</FormLabel>
      <Rows<Aggregate>
        rows={g.aggregates}
        add="Add aggregate"
        blank={{ fn: "COUNT", arg: "*", alias: "" }}
        onRows={(aggregates) => onG({ ...g, aggregates })}
        cols="grid-cols-[7rem_1fr_1fr_1.5rem]"
        render={(a, set) => (
          <>
            <Pick
              label="Aggregate"
              value={a.fn}
              options={AGGREGATES.map((f) => [f, f])}
              mono
              onValue={(fn) =>
                set({
                  ...a,
                  fn: fn as Aggregate["fn"],
                  arg: fn === "COUNT" ? a.arg : a.arg === "*" ? "" : a.arg,
                })
              }
            />
            <ColumnInput
              columns={
                a.fn === "COUNT"
                  ? [{ name: "*", type: null }, ...columns]
                  : columns
              }
              value={a.arg}
              onValue={(arg) => set({ ...a, arg })}
            />
            <Text
              label="Alias"
              value={a.alias}
              placeholder="as"
              onValue={(alias) => set({ ...a, alias })}
              mono
            />
          </>
        )}
      />
    </div>
  );
}
