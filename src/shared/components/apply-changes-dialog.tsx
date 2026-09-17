import { Fragment, useMemo, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
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

/** One entry in a review-before-apply dialog, shaped for a real unified-diff
 *  rendering: "add" sets only `after` (one green line), "drop" sets only
 *  `before` (one red line), "alter" sets both — full reconstructed lines,
 *  not just the changed fragment, so it reads like a real line diff instead
 *  of a fragment list. The single shared shape (and the single dialog below)
 *  is used everywhere in the app something needs a "here's what's about to
 *  change" review — the data grid's pending row edits and the schema
 *  designer's DDL batch — so the visual language never diverges between
 *  them. */
export interface DiffChange {
  id: string;
  kind: "add" | "drop" | "alter";
  /** Small muted label above the diff lines, e.g. "row", "column", "index". */
  entity: string;
  /** The name/identifier this change is about. */
  title: string;
  before?: string;
  after?: string;
}

/** One CHANGED TABLE ROW for the grid-formatted review below (`rows` prop) —
 *  the data grid's own review, as an alternative to the text-hunk `changes`
 *  shape above. `columns` is just whatever this one row touched; the caller
 *  (`RowDiffGrid`) unions it across every row to build the grid's header.
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

export function ApplyChangesDialog({
  title = "Review changes",
  changes,
  rows,
  /** Per-item checkboxes to exclude entries before applying — only safe
   *  when every change is independent of the others (the grid's row/cell
   *  edits). Schema DDL isn't: a trigger edit is a drop+create pair, an
   *  index rebuild follows a column rename — excluding half of a pair would
   *  silently build broken SQL, so that caller renders without selection,
   *  an all-or-nothing gate instead of a picker. */
  selectable = false,
  applying = false,
  on_apply,
  on_close,
}: {
  title?: string;
  /** Text-hunk rendering (schema DDL review) — mutually exclusive with
   *  `rows` below; pass exactly one. */
  changes?: DiffChange[];
  /** Grid rendering (the data grid's row/cell review) — see
   *  `RowDiffChange`'s own doc comment. */
  rows?: RowDiffChange[];
  selectable?: boolean;
  applying?: boolean;
  on_apply: (keepIds: Set<string>) => void;
  on_close: () => void;
}) {
  // Selection is keyed per rendered entry: a `DiffChange.id` for the hunk
  // list, or a `RowDiffChange`'s first underlying id (a stable
  // representative — see its doc comment) for the grid, one row at a time.
  const entry_keys = useMemo(
    () => (rows ? rows.map((r) => r.ids[0]) : (changes ?? []).map((c) => c.id)),
    [rows, changes],
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
      for (const c of changes ?? []) {
        if (selectable && !selected.has(c.id)) continue;
        if (c.kind === "add") add++;
        else if (c.kind === "alter") alter++;
        else drop++;
      }
    }
    return { add, alter, drop };
  }, [rows, changes, selected, selectable]);

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
      on_apply(
        selectable
          ? new Set(selected)
          : new Set((changes ?? []).map((c) => c.id)),
      );
    }
    on_close();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !applying && on_close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {selectable
              ? `${all} staged change${all === 1 ? "" : "s"}. Uncheck anything you don’t want to apply.`
              : `${all} change${all === 1 ? "" : "s"} will run as one transaction — all or nothing.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 text-xs">
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
            <span className="text-emerald-600 dark:text-emerald-400">
              +{counts.add}
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              ~{counts.alter}
            </span>
            <span className="text-red-600 dark:text-red-400">
              -{counts.drop}
            </span>
          </span>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border">
          {rows ? (
            <RowDiffGrid
              rows={rows}
              selectable={selectable}
              selected={selected}
              on_toggle={toggle}
            />
          ) : (
            <div className="divide-y">
              {(changes ?? []).map((c) => (
                <DiffHunk
                  key={c.id}
                  change={c}
                  selectable={selectable}
                  selected={selected.has(c.id)}
                  on_toggle={(on) => toggle(c.id, on)}
                />
              ))}
            </div>
          )}
          {all === 0 && (
            <div className="text-muted-foreground p-6 text-center text-sm">
              No changes to review.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={on_close}>
            Cancel
          </Button>
          <Button disabled={applying || checked === 0} onClick={confirm}>
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

/** Grid-formatted review for `RowDiffChange[]` (the data grid's row/cell
 *  pending edits) — column headers across the top (the union of every
 *  column touched across `rows`, in first-appearance order), one row per
 *  insert/delete, a stacked red-then-green row pair per update (a real
 *  line-replace, same visual language as `DiffLine` below just laid out as
 *  a grid instead of a text block). Selection is per `RowDiffChange`, not
 *  per underlying id — one checkbox per row (pair), spanning both of an
 *  update's rows. */
function RowDiffGrid({
  rows,
  selectable,
  selected,
  on_toggle,
}: {
  rows: RowDiffChange[];
  selectable: boolean;
  selected: Set<string>;
  on_toggle: (key: string, on: boolean) => void;
}) {
  const columns = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of rows) {
      for (const col of r.columns) {
        if (!seen.has(col)) {
          seen.add(col);
          ordered.push(col);
        }
      }
    }
    return ordered;
  }, [rows]);

  const cell_cls = "min-w-24 border-b px-2 py-1.5 font-mono break-all";
  const added = "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  const removed = "bg-red-500/10 text-red-800 dark:text-red-300";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-2 py-1.5 text-left font-medium">
              Row
            </th>
            <th className="w-5" />
            {columns.map((col) => (
              <th
                key={col}
                className="text-muted-foreground min-w-24 px-2 py-1.5 text-left font-medium"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = r.ids[0];
            const is_selected = selected.has(key);
            const row_cls = cn(selectable && !is_selected && "opacity-50");
            const gutter = (
              <td
                rowSpan={r.kind === "update" ? 2 : 1}
                className="border-b px-2 py-1.5 align-top"
              >
                <div className="flex items-center gap-1.5">
                  {selectable && (
                    <Checkbox
                      // Pinned in px, bypassing whatever's inflating the
                      // shared component's own `size-4` inside this table
                      // (base-ui's checkbox root has no intrinsic size of
                      // its own, so it's most likely a `--spacing`
                      // CSS-variable conflict specific to a table context,
                      // not a class-merge bug) — guaranteed correct
                      // regardless of the actual cause.
                      style={{ width: 16, height: 16 }}
                      checked={is_selected}
                      onCheckedChange={(v) => on_toggle(key, v === true)}
                      aria-label="Include this row"
                    />
                  )}
                  <span className="text-muted-foreground font-mono">
                    {r.row}
                  </span>
                </div>
              </td>
            );

            if (r.kind === "update") {
              return (
                <Fragment key={key}>
                  <tr className={row_cls}>
                    {gutter}
                    <td className="border-b px-1 py-1.5 text-red-600 select-none dark:text-red-400">
                      −
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={cn(
                          cell_cls,
                          Object.hasOwn(r.before, col) && removed,
                        )}
                      >
                        {r.before[col] ?? ""}
                      </td>
                    ))}
                  </tr>
                  <tr className={row_cls}>
                    <td className="border-b px-1 py-1.5 text-emerald-600 select-none dark:text-emerald-400">
                      +
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={cn(
                          cell_cls,
                          Object.hasOwn(r.after, col) && added,
                        )}
                      >
                        {r.after[col] ?? ""}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            }

            const is_insert = r.kind === "insert";
            const values = is_insert ? r.after : r.before;
            return (
              <tr key={key} className={row_cls}>
                {gutter}
                <td
                  className={cn(
                    "border-b px-1 py-1.5 select-none",
                    is_insert
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400",
                  )}
                >
                  {is_insert ? "+" : "−"}
                </td>
                {columns.map((col) => (
                  <td
                    key={col}
                    className={cn(cell_cls, is_insert ? added : removed)}
                  >
                    {values[col] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One "hunk": a collapsible heading (entity + name) over one or two full
 *  diff lines. `before`/`after` are each rendered as their OWN full line —
 *  a complete reconstructed value/definition, not just the changed
 *  fragment — so an alter reads as a real line replace (red line directly
 *  above green), matching how GitHub/VS Code render a modified line.
 *  Starts expanded — collapsing is for skimming past changes you already
 *  trust (a long trigger body, a bulk of untouched-looking row edits), not
 *  for hiding anything by default. */
function DiffHunk({
  change: c,
  selectable,
  selected,
  on_toggle,
}: {
  change: DiffChange;
  selectable: boolean;
  selected: boolean;
  on_toggle: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2",
        selectable && !selected && "opacity-50",
      )}
    >
      {selectable && (
        <Checkbox
          className="mt-1"
          checked={selected}
          onCheckedChange={(v) => on_toggle(v === true)}
          aria-label="Include this change"
        />
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-muted-foreground text-3xs mb-1 flex w-full items-baseline gap-1.5 text-left tracking-wide uppercase"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 self-center transition-transform",
              open && "rotate-90",
            )}
          />
          <span>{c.entity}</span>
          <span className="text-foreground/70 min-w-0 truncate normal-case">
            {c.title}
          </span>
        </button>
        {open && (
          <div className="overflow-hidden rounded border font-mono text-xs leading-5">
            {c.before !== undefined && <DiffLine sign="-" text={c.before} />}
            {c.after !== undefined && <DiffLine sign="+" text={c.after} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffLine({ sign, text }: { sign: "+" | "-"; text: string }) {
  return (
    <div
      className={cn(
        "flex gap-2 px-2 py-1",
        sign === "+"
          ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : "bg-red-500/10 text-red-800 dark:text-red-300",
      )}
    >
      <span className="w-3 shrink-0 opacity-70 select-none">{sign}</span>
      <span className="min-w-0 break-all whitespace-pre-wrap">{text}</span>
    </div>
  );
}
