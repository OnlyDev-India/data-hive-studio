import { Pick } from "@/shared/components/builder-canvas";
import type { Column } from "../../lib/columns";
import type { ReturningForm } from "../../lib/forms/writes";
import { SelectBody } from "./select-form";

/** RETURNING: every column, or picked columns with aliases. */
export function ReturningBody({
  f,
  columns,
  onF,
}: {
  f: ReturningForm;
  columns: Column[];
  onF: (f: ReturningForm) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="w-44">
        <Pick
          label="Return"
          value={f.all ? "all" : "list"}
          options={[
            ["all", "every column (*)"],
            ["list", "these columns"],
          ]}
          onValue={(v) => onF({ ...f, all: v === "all" })}
        />
      </div>
      {!f.all && (
        <SelectBody
          items={f.items}
          columns={columns}
          onItems={(items) => onF({ ...f, items })}
        />
      )}
    </div>
  );
}
