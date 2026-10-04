import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DdlDiffGrid,
  RowDiffGrid,
  type DdlDiffSection,
  type DiffGridRow,
} from "@/shared/components/diff-grid";

/** One CHANGED TABLE ROW for the grid-formatted review below (`rows` prop) —
 *  the data grid's own review, as an alternative to the DDL grid shape
 *  below. `columns` is just whatever this one row touched; the dialog
 *  unions it across every row to build the grid's header.
 *  `ids` collects every underlying `PendingChange.id` this entry represents
 *  (several cell edits on the same row merge into ONE `RowDiffChange` — see
 *  `pending_changes_to_row_diff`) — selection is per ROW here, so
 *  (de)selecting one toggles all of `ids` together in the `keepIds` set
 *  `on_apply` receives. */
export interface RowDiffChange {
  ids: string[];
  kind: "insert" | "update" | "delete";
  row: number;
  columns: string[];
  before: Record<string, string>;
  after: Record<string, string>;
}

/** Every row id in `sections`, with a `kind` for the header's +/~/- counts.
 *  Table/primary key rows have no `kind` of their own (they're always an
 *  alter), so they count as "update". */
function flatten_ddl(
  sections: DdlDiffSection[],
): { id: string; kind: "insert" | "update" | "delete" }[] {
  const out: { id: string; kind: "insert" | "update" | "delete" }[] = [];
  for (const s of sections) {
    switch (s.entity) {
      case "table":
      case "primary key":
        for (const r of s.rows) out.push({ id: r.id, kind: "update" });
        break;
      case "column":
      case "index":
      case "foreign key":
      case "trigger":
        for (const r of s.rows) out.push({ id: r.id, kind: r.kind });
        break;
    }
  }
  return out;
}

function to_grid_row(r: RowDiffChange): DiffGridRow {
  return {
    id: r.ids[0],
    kind: r.kind,
    label: String(r.row),
    ...(r.kind !== "insert" ? { before: r.before } : {}),
    ...(r.kind !== "delete" ? { after: r.after } : {}),
  };
}

/** Every column any row touched, in first appearance order. */
function union_columns(rows: RowDiffChange[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const col of r.columns) seen.add(col);
  return [...seen];
}

export function ApplyChangesDialog({
  title = "Review changes",
  ddl,
  rows,
  /** Per-item checkboxes to exclude entries before applying — only safe
   *  when every change is independent of the others (the grid's row/cell
   *  edits). Schema DDL isn't: a trigger edit is a drop+create pair, an
   *  index rebuild follows a column rename — excluding half of a pair would
   *  silently build broken SQL, so that caller renders without selection,
   *  an all-or-nothing gate instead of a picker. */
  selectable = false,
  applying = false,
  notice,
  disabled_reason,
  on_apply,
  on_close,
}: {
  title?: string;
  /** The connection's label and lock (spec 0007), shown as a chip in the
   *  title. This review is itself the confirmation before a write, so on a
   *  Production connection it says where the change is going. */
  /** Grid rendering for a schema DDL review — mutually exclusive with
   *  `rows` below; pass exactly one. */
  ddl?: DdlDiffSection[];
  /** Grid rendering (the data grid's row/cell review) — see
   *  `RowDiffChange`'s own doc comment. */
  rows?: RowDiffChange[];
  selectable?: boolean;
  applying?: boolean;
  /** Shown above the changes (warnings about what applying does). */
  notice?: React.ReactNode;
  /** Why Apply is off, when it is (a read only target). */
  disabled_reason?: string;
  on_apply: (keepIds: Set<string>) => void;
  on_close: () => void;
}) {
  // Selection is keyed per rendered entry: a flattened DDL row id, or a
  // `RowDiffChange`'s first underlying id (a stable representative — see
  // its doc comment) for the grid, one row at a time.
  const entry_keys = useMemo(
    () =>
      rows
        ? rows.map((r) => r.ids[0])
        : flatten_ddl(ddl ?? []).map((e) => e.id),
    [rows, ddl],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(entry_keys),
  );

  const counts = useMemo(() => {
    let add = 0,
      alter = 0,
      drop = 0;
    if (rows) {
      for (const r of rows) {
        if (selectable && !selected.has(r.ids[0])) continue;
        if (r.kind === "insert") add++;
        else if (r.kind === "update") alter++;
        else drop++;
      }
    } else {
      for (const e of flatten_ddl(ddl ?? [])) {
        if (selectable && !selected.has(e.id)) continue;
        if (e.kind === "insert") add++;
        else if (e.kind === "update") alter++;
        else drop++;
      }
    }
    return { add, alter, drop };
  }, [rows, ddl, selected, selectable]);

  const grid_rows = useMemo(() => rows?.map(to_grid_row), [rows]);
  const grid_columns = useMemo(() => union_columns(rows ?? []), [rows]);

  const all = entry_keys.length;
  const checked = selectable ? selected.size : all;
  const some = selectable && checked > 0 && checked < all;

  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle_all = (on: boolean) =>
    setSelected(on ? new Set(entry_keys) : new Set());

  const confirm = () => {
    if (rows) {
      const keep = new Set<string>();
      for (const r of rows) {
        if (!selectable || selected.has(r.ids[0])) {
          for (const id of r.ids) keep.add(id);
        }
      }
      on_apply(keep);
    } else {
      on_apply(selectable ? new Set(selected) : new Set(entry_keys));
    }
    on_close();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !applying && on_close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
          <DialogDescription>
            {selectable
              ? `${all} staged change${all === 1 ? "" : "s"}. Uncheck anything you don’t want to apply.`
              : `${all} change${all === 1 ? "" : "s"} will run as one transaction — all or nothing.`}
          </DialogDescription>
        </DialogHeader>

        <div className="text-small flex items-center gap-4">
          {selectable && (
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={all > 0 && checked === all}
                onCheckedChange={(v) => toggle_all(v === true)}
                indeterminate={some}
              />
              Select all
            </label>
          )}
          <span className="text-muted-foreground flex items-center gap-1.5 font-mono">
            <span className="text-diff-add-foreground">+{counts.add}</span>
            <span className="text-diff-change-foreground">~{counts.alter}</span>
            <span className="text-diff-remove-foreground">-{counts.drop}</span>
          </span>
        </div>

        {notice}

        <div className="rounded-control overflow-hidden border">
          {grid_rows ? (
            <RowDiffGrid
              className="max-h-96"
              rows={grid_rows}
              columns={grid_columns}
              selected={selectable ? selected : undefined}
              on_toggle={selectable ? toggle : undefined}
            />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <DdlDiffGrid sections={ddl ?? []} />
            </div>
          )}
          {all === 0 && (
            <div className="text-muted-foreground text-body p-6 text-center">
              No changes to review.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={on_close}>
            Cancel
          </Button>
          <Button
            disabled={applying || checked === 0 || !!disabled_reason}
            title={disabled_reason}
            onClick={confirm}
          >
            {applying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Apply {checked} change{checked === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
