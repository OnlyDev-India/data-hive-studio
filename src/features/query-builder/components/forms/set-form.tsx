import { Pick, Rows, Text } from "@/shared/components/builder-canvas";
import type { Column } from "../../lib/columns";
import { emptySet, type SetRow } from "../../lib/forms/writes";
import { SubqueryChip } from "./chain-forms";
import { ColumnInput } from "./inputs";

const MODES: [string, string][] = [
  ["value", "value"],
  ["expr", "expression"],
  ["default", "DEFAULT"],
];

const WITH_SUB: [string, string][] = [...MODES, ["sub", "subquery"]];

/** `column = value` rows: SET, and ON CONFLICT's DO UPDATE. A value is a
 *  literal typed by its column, an expression as written, or DEFAULT. */
export function SetRows({
  rows,
  columns,
  suggest = columns,
  onRows,
  newMarker,
}: {
  rows: SetRow[];
  /** The target's columns, for the left side. */
  columns: Column[];
  /** What an expression box offers. */
  suggest?: Column[];
  onRows: (rows: SetRow[]) => void;
  /** Offers a subquery value, given where its marker comes from. */
  newMarker?: () => number;
}) {
  return (
    <Rows<SetRow>
      rows={rows}
      add="Add column"
      blank={emptySet()}
      onRows={onRows}
      cols="grid-cols-[1fr_6rem_1fr_1.5rem]"
      render={(r, set) => (
        <>
          <ColumnInput
            columns={columns}
            value={r.column}
            onValue={(column) => set({ ...r, column })}
          />
          <Pick
            label="Set to"
            value={r.mode}
            options={newMarker || r.mode === "sub" ? WITH_SUB : MODES}
            onValue={(mode) => {
              if (mode === r.mode) return;
              if (mode === "sub" && newMarker)
                set({
                  ...r,
                  mode: "sub",
                  value: String(newMarker()),
                  kind: null,
                });
              else
                set({
                  ...r,
                  mode: mode as SetRow["mode"],
                  value: r.mode === "sub" ? "" : r.value,
                  kind: null,
                });
            }}
          />
          {r.mode === "default" ? (
            <span />
          ) : r.mode === "sub" ? (
            <SubqueryChip />
          ) : r.mode === "expr" ? (
            <ColumnInput
              columns={suggest}
              value={r.value}
              placeholder="expression"
              onValue={(value) => set({ ...r, value })}
            />
          ) : (
            <Text
              label="Value"
              value={r.value}
              placeholder="value"
              onValue={(value) => set({ ...r, value, kind: null })}
              mono
            />
          )}
        </>
      )}
    />
  );
}
