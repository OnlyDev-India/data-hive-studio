import { FolderOpen } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { pickDatabaseFile } from "@/shared/lib/platform";
import type { SqliteFormValues } from "../../lib/form-values";
import type { FormTabKey } from "../../lib/tab-fields";
import { GuardFields } from "../guard-fields";
import { TextRow, TypeRow } from "./fields";
import { FormRow } from "./form-row";

export function SqliteForm({
  values: v,
  patch,
  tab,
  errors,
  onChangeKind,
}: {
  values: SqliteFormValues;
  patch: (p: Partial<SqliteFormValues>) => void;
  tab: FormTabKey;
  errors: (field: string) => string | undefined;
  onChangeKind: () => void;
}) {
  if (tab === "safety") {
    return (
      <GuardFields
        idPrefix="sqlite"
        value={v.guard}
        onChange={(g) => patch({ guard: { ...v.guard, ...g } })}
      />
    );
  }

  const browse = async () => {
    const file = await pickDatabaseFile();
    if (file) patch({ path: file.path });
  };

  return (
    <div className="flex flex-col gap-3">
      <TextRow
        field="name"
        label="Name"
        placeholder="Defaults to the file name"
        value={v.name}
        onChange={(name) => patch({ name })}
      />
      <TypeRow kind="sqlite" onChange={onChangeKind} />
      <FormRow label="File" error={errors("path")}>
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={
              v.path
                ? "min-w-0 flex-1 truncate font-mono text-xs"
                : "text-muted-foreground min-w-0 flex-1 text-xs"
            }
            title={v.path ?? undefined}
          >
            {v.path ?? "No file chosen"}
          </p>
          <Button variant="outline" size="sm" onClick={() => void browse()}>
            <FolderOpen className="size-3.5" />
            Browse…
          </Button>
        </div>
      </FormRow>
    </div>
  );
}
