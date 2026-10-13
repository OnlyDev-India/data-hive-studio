import { Pick, Rows } from "@/shared/components/builder-canvas";
import type { Column } from "../../lib/columns";
import type { Sort } from "../../lib/forms/lists";
import { ColumnInput } from "./inputs";

export function OrderBody({
  items,
  columns,
  onItems,
}: {
  items: Sort[];
  columns: Column[];
  onItems: (items: Sort[]) => void;
}) {
  return (
    <Rows<Sort>
      rows={items}
      add="Add sort column"
      blank={{ expr: "", dir: "ASC" }}
      onRows={onItems}
      cols="grid-cols-[1fr_7rem_1.5rem]"
      render={(r, set) => (
        <>
          <ColumnInput
            columns={columns}
            value={r.expr}
            onValue={(expr) => set({ ...r, expr })}
          />
          <Pick
            label="Direction"
            value={r.dir}
            options={[
              ["ASC", "ascending"],
              ["DESC", "descending"],
            ]}
            onValue={(dir) => set({ ...r, dir: dir as Sort["dir"] })}
          />
        </>
      )}
    />
  );
}
