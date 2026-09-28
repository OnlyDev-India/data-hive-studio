import { KeyRound, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { TYPE_OPTIONS, next_id, type ColDraft } from "./drafts";
import { EditableText } from "./editable-text";

const col_grid =
  "grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_3rem_2.5rem_minmax(0,1.1fr)_1.75rem] items-center gap-2";
const col_header = cn(
  col_grid,
  "sticky top-0 z-10 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground",
);
const col_row = cn(col_grid, "border-b px-3 py-1.5 text-sm last:border-0");

/** A blank column, as the tab bar's Add button appends it. */
export function new_col_draft(): ColDraft {
  return {
    id: next_id(),
    orig_name: null,
    orig_data_type: null,
    orig_not_null: null,
    orig_default: null,
    name: "",
    data_type: "",
    not_null: false,
    default_text: "",
    primary_key: false,
    dropped: false,
  };
}

/** One editable row per draft column. Adding a column is the tab bar's job. */
export function ColumnsPanel({
  cols,
  disabled = false,
  on_update,
  on_replace,
}: {
  cols: ColDraft[];
  /** True while an Apply is in flight — all editing is locked. */
  disabled?: boolean;
  on_update: (id: string, patch: Partial<ColDraft>) => void;
  /** Replace the whole list — used to remove a not-yet-saved column. */
  on_replace: (updater: (cs: ColDraft[]) => ColDraft[]) => void;
}) {
  return (
    <>
      <div>
        <div className={col_header}>
          <span>Name</span>
          <span>Type</span>
          <span title="NOT NULL">Null</span>
          <span title="Primary key">PK</span>
          <span>Default</span>
          <span />
        </div>
        {cols.map((c) => (
          <ColumnRow
            key={c.id}
            c={c}
            disabled={disabled}
            on_update={on_update}
            on_replace={on_replace}
          />
        ))}
      </div>
    </>
  );
}

function ColumnRow({
  c,
  disabled = false,
  on_update,
  on_replace,
}: {
  c: ColDraft;
  disabled?: boolean;
  on_update: (id: string, patch: Partial<ColDraft>) => void;
  on_replace: (updater: (cs: ColDraft[]) => ColDraft[]) => void;
}) {
  return (
    <div className={cn(col_row, c.dropped && "opacity-50")}>
      <div className="flex min-w-0 items-center gap-1.5">
        {c.primary_key && (
          <KeyRound className="text-primary size-3.5 shrink-0" />
        )}
        {c.dropped ? (
          <span className="truncate line-through">{c.name}</span>
        ) : (
          <EditableText
            value={c.name}
            ariaLabel="Column name"
            disabled={disabled}
            on_commit={(v) => on_update(c.id, { name: v })}
          />
        )}
      </div>
      {c.dropped ? (
        <span className="text-muted-foreground truncate line-through">
          {c.data_type}
        </span>
      ) : (
        <Select
          value={c.data_type}
          disabled={disabled}
          onValueChange={(v) => on_update(c.id, { data_type: v ?? "" })}
        >
          <SelectTrigger
            className="h-7 w-full text-sm"
            size="sm"
            aria-label="Column type"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(TYPE_OPTIONS.includes(c.data_type)
                ? TYPE_OPTIONS
                : [...TYPE_OPTIONS, c.data_type]
              ).map((t) => (
                <SelectItem key={t || "(none)"} value={t}>
                  {t === "" ? "(none)" : t}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {c.dropped ? (
        <span className="text-muted-foreground text-xs line-through">
          {c.not_null ? "NOT NULL" : "NULL"}
        </span>
      ) : (
        <Checkbox
          checked={c.not_null}
          title="NOT NULL"
          aria-label="NOT NULL"
          disabled={disabled}
          onCheckedChange={(v) => on_update(c.id, { not_null: v === true })}
        />
      )}
      <Checkbox
        checked={c.primary_key}
        title="Primary key"
        aria-label="Primary key"
        disabled={disabled}
        onCheckedChange={(v) => on_update(c.id, { primary_key: v === true })}
      />
      {c.dropped ? (
        <span className="text-muted-foreground truncate text-xs line-through">
          {c.orig_default ?? ""}
        </span>
      ) : (
        <EditableText
          value={c.default_text}
          placeholder="no default"
          ariaLabel="Default value"
          className="text-xs"
          disabled={disabled}
          on_commit={(v) => on_update(c.id, { default_text: v })}
        />
      )}
      <Button
        variant="ghost"
        size="iconXs"
        aria-label={c.dropped ? "Restore column" : "Drop column"}
        title={c.dropped ? "Restore column" : "Drop column"}
        disabled={disabled}
        onClick={() => {
          if (c.orig_name === null)
            on_replace((cs) => cs.filter((x) => x.id !== c.id));
          else on_update(c.id, { dropped: !c.dropped });
        }}
      >
        {c.dropped ? (
          <Undo2 className="size-3.5" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
