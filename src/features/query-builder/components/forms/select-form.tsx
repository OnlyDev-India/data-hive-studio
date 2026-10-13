import { Braces } from "lucide-react";
import { Rows, Text } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import type { Column } from "../../lib/columns";
import type { Picked } from "../../lib/forms/lists";
import { markerName, maskedMarker } from "../../lib/markers";
import { SubqueryChip } from "./chain-forms";
import { ColumnInput } from "./inputs";

/** Picked columns with aliases: the SELECT list, and RETURNING's. */
export function SelectBody({
  items,
  columns,
  onItems,
  newMarker,
}: {
  items: Picked[];
  columns: Column[];
  onItems: (items: Picked[]) => void;
  /** Offers a subquery column, given where its marker comes from. */
  newMarker?: () => number;
}) {
  return (
    <div className="flex flex-col">
      <Rows<Picked>
        rows={items}
        add="Add column"
        blank={{ expr: "", alias: "" }}
        onRows={onItems}
        cols="grid-cols-[1fr_1fr_1.5rem]"
        render={(r, set) => (
          <>
            {maskedMarker(r.expr) !== null ? (
              <SubqueryChip />
            ) : (
              <ColumnInput
                columns={columns}
                value={r.expr}
                onValue={(expr) => set({ ...r, expr })}
              />
            )}
            <Text
              label="Alias"
              value={r.alias}
              placeholder="as (optional)"
              onValue={(alias) => set({ ...r, alias })}
              mono
            />
          </>
        )}
      />
      {newMarker && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground self-start"
          onClick={() => {
            const n = newMarker();
            onItems([
              ...items,
              { expr: `(SELECT ${markerName(n)})`, alias: `sub${n}` },
            ]);
          }}
        >
          <Braces className="size-3" />
          Add subquery column
        </Button>
      )}
    </div>
  );
}
