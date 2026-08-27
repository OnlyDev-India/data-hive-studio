import { useState } from "react";
import { Database as DbIcon, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import {
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/shared/components/ui/accordion";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { next_id, type IdxDraft, idx_is_dirty } from "./drafts";
import { EditableText } from "./editable-text";
import { AddIndexDialog } from "./add-index-dialog";

/** "Indexes" accordion section: editable index rows, the add-index dialog and
 *  its trigger. Owns the dialog open state. */
export function IndexesPanel({
  idxs,
  columns,
  resolve_col,
  disabled = false,
  on_update,
  on_replace,
}: {
  idxs: IdxDraft[];
  /** Kept (non-dropped) column names available for new indexes. */
  columns: string[];
  /** Maps original column names to final names so renames are visible. */
  resolve_col: (n: string) => string;
  /** True while an Apply is in flight — all editing is locked. */
  disabled?: boolean;
  on_update: (id: string, patch: Partial<IdxDraft>) => void;
  on_replace: (updater: (xs: IdxDraft[]) => IdxDraft[]) => void;
}) {
  const [add_idx, setAdd_idx] = useState(false);

  return (
    <AccordionItem value="indexes">
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          <DbIcon className="size-4" />
          Indexes
          <Badge variant="muted">{idxs.length}</Badge>
          {idxs.some((ix) => idx_is_dirty(ix, resolve_col)) && (
            <Badge variant="warning">edited</Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="overflow-hidden rounded-md border">
          {idxs.map((ix) => (
            <IndexRow
              key={ix.id}
              ix={ix}
              disabled={disabled}
              on_update={on_update}
              on_replace={on_replace}
            />
          ))}
          <button
            type="button"
            disabled={disabled}
            className="text-muted-foreground hover:bg-muted/50 flex w-full items-center gap-2 border-t px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setAdd_idx(true)}
          >
            <Plus className="size-3.5" />
            Add index
          </button>
        </div>
        <AddIndexDialog
          open={add_idx}
          on_close={() => setAdd_idx(false)}
          columns={columns}
          on_create={(name, unique, columns) => {
            on_replace((xs) => [
              ...xs,
              {
                id: next_id(),
                orig_name: null,
                orig_unique: null,
                orig_columns: null,
                name,
                unique,
                columns,
                dropped: false,
                system: false,
              },
            ]);
          }}
        />
      </AccordionPanel>
    </AccordionItem>
  );
}

function IndexRow({
  ix,
  disabled = false,
  on_update,
  on_replace,
}: {
  ix: IdxDraft;
  disabled?: boolean;
  on_update: (id: string, patch: Partial<IdxDraft>) => void;
  on_replace: (updater: (xs: IdxDraft[]) => IdxDraft[]) => void;
}) {
  // Constraint-backed indexes (UNIQUE / PRIMARY KEY) cannot be dropped or
  // altered in SQLite — render them read-only instead of offering edits that
  // are guaranteed to fail on Apply.
  if (ix.system) {
    return (
      <div className="bg-muted/30 text-muted-foreground flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        <span className="font-medium">{ix.name}</span>
        {ix.unique && <Badge variant="muted">UNIQUE</Badge>}
        <span
          className="ml-auto truncate text-xs"
          title="Backed by a table constraint — change the table definition to modify it"
        >
          table constraint
        </span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm last:border-0",
        ix.dropped && "opacity-50",
      )}
    >
      {ix.dropped ? (
        <span className="font-medium line-through">{ix.name}</span>
      ) : (
        <EditableText
          value={ix.name}
          ariaLabel="Index name"
          className="font-medium"
          disabled={disabled}
          on_commit={(v) => on_update(ix.id, { name: v })}
        />
      )}
      {ix.dropped && <Badge variant="warning">drops on Apply</Badge>}
      {!ix.dropped && (
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Switch
            checked={ix.unique}
            aria-label="Unique index"
            disabled={disabled}
            onCheckedChange={(v) => on_update(ix.id, { unique: v === true })}
          />
          UNIQUE
        </label>
      )}
      <span className="text-muted-foreground ml-auto truncate text-xs">
        {ix.columns.join(", ")}
      </span>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label={ix.dropped ? "Restore index" : "Drop index"}
        title={ix.dropped ? "Restore index" : "Drop index"}
        disabled={disabled}
        onClick={() => {
          if (ix.orig_name === null)
            on_replace((xs) => xs.filter((x) => x.id !== ix.id));
          else on_update(ix.id, { dropped: !ix.dropped });
        }}
      >
        {ix.dropped ? (
          <Undo2 className="size-3.5" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
