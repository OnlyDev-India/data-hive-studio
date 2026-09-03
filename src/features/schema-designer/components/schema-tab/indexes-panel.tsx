import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Database as DbIcon,
  Lock,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
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
import { AddIndexDialog, type NewIndexDraft } from "./add-index-dialog";

/** "Indexes" accordion section: editable index rows, the add-index dialog and
 *  its trigger. Owns the dialog open state. */
export function IndexesPanel({
  idxs,
  columns,
  resolve_col,
  disabled = false,
  on_update,
  on_replace,
  /** MongoDB only: shows sparse/TTL/partial-filter fields and per-column
   *  sort direction — meaningless for SQL indexes, hidden otherwise. */
  mongo = false,
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
  mongo?: boolean;
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
              mongo={mongo}
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
          mongo={mongo}
          on_create={(draft: NewIndexDraft) => {
            on_replace((xs) => [
              ...xs,
              {
                id: next_id(),
                orig_name: null,
                orig_unique: null,
                orig_columns: null,
                orig_column_dirs: null,
                orig_sparse: null,
                orig_ttl_seconds: null,
                orig_partial_filter: null,
                name: draft.name,
                unique: draft.unique,
                columns: draft.columns,
                column_dirs: draft.column_dirs,
                sparse: draft.sparse,
                ttl_seconds: draft.ttl_seconds,
                partial_filter: draft.partial_filter,
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
  mongo = false,
  on_update,
  on_replace,
}: {
  ix: IdxDraft;
  disabled?: boolean;
  mongo?: boolean;
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
  const toggle_dir = (i: number) => {
    const next = [...ix.column_dirs];
    next[i] = (next[i] ?? 1) < 0 ? 1 : -1;
    on_update(ix.id, { column_dirs: next });
  };
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 border-b px-3 py-2 text-sm last:border-0",
        ix.dropped && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
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
        {!ix.dropped && mongo && (
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Switch
              checked={ix.sparse}
              aria-label="Sparse index"
              disabled={disabled}
              onCheckedChange={(v) => on_update(ix.id, { sparse: v === true })}
            />
            SPARSE
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {!ix.dropped && mongo
            ? ix.columns.map((c, i) => (
                <button
                  key={c}
                  type="button"
                  disabled={disabled}
                  title={`Sort ${(ix.column_dirs[i] ?? 1) < 0 ? "descending" : "ascending"} — click to flip`}
                  className="bg-muted text-muted-foreground hover:text-foreground flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs disabled:pointer-events-none"
                  onClick={() => toggle_dir(i)}
                >
                  {c}
                  {(ix.column_dirs[i] ?? 1) < 0 ? (
                    <ArrowDown className="size-3" />
                  ) : (
                    <ArrowUp className="size-3" />
                  )}
                </button>
              ))
            : (
                <span className="text-muted-foreground truncate text-xs">
                  {ix.columns.join(", ")}
                </span>
              )}
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
      {!ix.dropped && mongo && (
        <div className="flex flex-wrap items-center gap-2 pl-0.5">
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            TTL (s)
            <input
              type="number"
              min={0}
              disabled={disabled}
              value={ix.ttl_seconds ?? ""}
              placeholder="none"
              onChange={(e) =>
                on_update(ix.id, {
                  ttl_seconds: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="border-input bg-background focus-visible:ring-ring/50 h-6 w-20 rounded border px-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none"
            />
          </label>
          <span className="flex min-w-0 flex-1 items-center gap-1 text-xs">
            <span className="text-muted-foreground shrink-0">Partial</span>
            <EditableText
              value={ix.partial_filter}
              ariaLabel="Partial filter expression"
              placeholder={'none — e.g. { "status": "active" }'}
              disabled={disabled}
              className="font-mono"
              on_commit={(v) => on_update(ix.id, { partial_filter: v })}
            />
          </span>
        </div>
      )}
    </div>
  );
}
