import { Fragment, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
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

/** One CHANGED TABLE ROW for the grid-formatted review below (`rows` prop) —
 *  the data grid's own review, as an alternative to the DDL grid shape
 *  below. `columns` is just whatever this one row touched; the caller
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

/** One property row in the "Table properties" panel — table rename and
 *  primary key change both use this shape (a label plus before/after);
 *  both are at most one row and always an alter, never an insert or
 *  delete. */
export interface DdlPropertyRow {
  id: string;
  label: string;
  before?: string;
  after?: string;
}

/** One column change, decomposed into real fields (unlike the other DDL
 *  entities below) since columns are the highest volume DDL entity and the
 *  one whose sub-fields are most useful to see separately. An "update" row
 *  renders as a red row directly above a green row, matching `RowDiffGrid`'s
 *  own update pattern. */
export interface DdlColumnRow {
  id: string;
  kind: "insert" | "update" | "delete";
  before?: { name: string; type: string; nullable: boolean; default: string };
  after?: { name: string; type: string; nullable: boolean; default: string };
}

/** One index or foreign key change — still one opaque definition line (the
 *  existing `idx_line(...)`/foreign key line text), just shown as a
 *  Name+Definition grid row instead of a text hunk. */
export interface DdlNamedRow {
  id: string;
  kind: "insert" | "update" | "delete";
  name: string;
  before?: string;
  after?: string;
}

/** One trigger change — the full SQL body, rendered as a full width colored
 *  row rather than squeezed into a normal cell. */
export interface DdlTriggerRow {
  id: string;
  kind: "insert" | "update" | "delete";
  name: string;
  before?: string;
  after?: string;
}

/** One entity-typed section of a DDL review (schema designer / Mongo schema
 *  editor). A section only exists in the array when that entity type
 *  actually changed — no empty sections. Table rename and primary key
 *  change render together as one "Table properties" panel in `DdlDiffGrid`
 *  even though they're separate section entries here. */
export type DdlDiffSection =
  | { entity: "table" | "primary key"; rows: DdlPropertyRow[] }
  | { entity: "column"; rows: DdlColumnRow[] }
  | { entity: "index" | "foreign key"; rows: DdlNamedRow[] }
  | { entity: "trigger"; rows: DdlTriggerRow[] };

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
            <DdlDiffGrid sections={ddl ?? []} />
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
 *  line-replace, same visual language as the DDL grid below just laid out
 *  around dynamic column headers instead of fixed fields). Selection is per
 *  `RowDiffChange`, not per underlying id — one checkbox per row (pair),
 *  spanning both of an update's rows. */
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
            <th className="text-muted-foreground w-16 px-2 py-1.5 text-left font-medium">
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

/** Grid-formatted review for `DdlDiffSection[]` (schema designer / Mongo
 *  schema editor DDL review) — one small table per entity category present
 *  in `sections` (never an empty one), each row styled with the same
 *  insert/update/delete conventions `RowDiffGrid` uses (an update renders
 *  as a red row directly above a green row). Table rename and primary key
 *  change share one "Table properties" panel since both are at most one
 *  row and always an alter. Always rendered read only (no checkboxes): DDL
 *  review is never selectable, see the key invariant on
 *  `ApplyChangesDialog`. */
function DdlDiffGrid({ sections }: { sections: DdlDiffSection[] }) {
  const properties = sections
    .filter(
      (s): s is { entity: "table" | "primary key"; rows: DdlPropertyRow[] } =>
        s.entity === "table" || s.entity === "primary key",
    )
    .flatMap((s) => s.rows);
  const columns =
    sections.find(
      (s): s is { entity: "column"; rows: DdlColumnRow[] } =>
        s.entity === "column",
    )?.rows ?? [];
  const indexes =
    sections.find(
      (s): s is { entity: "index"; rows: DdlNamedRow[] } =>
        s.entity === "index",
    )?.rows ?? [];
  const foreign_keys =
    sections.find(
      (s): s is { entity: "foreign key"; rows: DdlNamedRow[] } =>
        s.entity === "foreign key",
    )?.rows ?? [];
  const triggers =
    sections.find(
      (s): s is { entity: "trigger"; rows: DdlTriggerRow[] } =>
        s.entity === "trigger",
    )?.rows ?? [];

  return (
    <div className="divide-y">
      {properties.length > 0 && (
        <DdlSection label="Table properties">
          <PropertyTable rows={properties} />
        </DdlSection>
      )}
      {columns.length > 0 && (
        <DdlSection label="Columns">
          <ColumnTable rows={columns} />
        </DdlSection>
      )}
      {indexes.length > 0 && (
        <DdlSection label="Indexes">
          <NamedTable rows={indexes} />
        </DdlSection>
      )}
      {foreign_keys.length > 0 && (
        <DdlSection label="Foreign keys">
          <NamedTable rows={foreign_keys} />
        </DdlSection>
      )}
      {triggers.length > 0 && (
        <DdlSection label="Triggers">
          <TriggerRows rows={triggers} />
        </DdlSection>
      )}
    </div>
  );
}

function DdlSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="text-muted-foreground text-3xs px-3 pb-1 font-medium tracking-wide uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

function PropertyTable({ rows }: { rows: DdlPropertyRow[] }) {
  return (
    <div className="overflow-x-auto px-3">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground py-1 pr-3 text-left font-medium">
              Property
            </th>
            <th className="text-muted-foreground py-1 pr-3 text-left font-medium">
              Before
            </th>
            <th className="text-muted-foreground py-1 text-left font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="text-muted-foreground py-1.5 pr-3 align-top font-medium whitespace-nowrap">
                {r.label}
              </td>
              <td className="bg-red-500/10 py-1.5 pr-3 font-mono break-all text-red-800 dark:text-red-300">
                {r.before ?? ""}
              </td>
              <td className="bg-emerald-500/10 py-1.5 font-mono break-all text-emerald-800 dark:text-emerald-300">
                {r.after ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DDL_COLUMN_FIELDS = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "nullable", label: "Nullable" },
  { key: "default", label: "Default" },
] as const;

function ColumnTable({ rows }: { rows: DdlColumnRow[] }) {
  const cell_cls = "min-w-24 border-b px-2 py-1.5 font-mono break-all";
  const added = "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  const removed = "bg-red-500/10 text-red-800 dark:text-red-300";

  const cell = (
    v: DdlColumnRow["before"],
    key: (typeof DDL_COLUMN_FIELDS)[number]["key"],
  ) => {
    if (!v) return "";
    if (key === "nullable") return v.nullable ? "yes" : "no";
    return v[key];
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="w-5" />
            {DDL_COLUMN_FIELDS.map((f) => (
              <th
                key={f.key}
                className="text-muted-foreground min-w-24 px-2 py-1.5 text-left font-medium"
              >
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === "update") {
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className="border-b px-1 py-1.5 text-red-600 select-none dark:text-red-400">
                      −
                    </td>
                    {DDL_COLUMN_FIELDS.map((f) => (
                      <td key={f.key} className={cn(cell_cls, removed)}>
                        {cell(r.before, f.key)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="border-b px-1 py-1.5 text-emerald-600 select-none dark:text-emerald-400">
                      +
                    </td>
                    {DDL_COLUMN_FIELDS.map((f) => (
                      <td key={f.key} className={cn(cell_cls, added)}>
                        {cell(r.after, f.key)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            }
            const is_insert = r.kind === "insert";
            const values = is_insert ? r.after : r.before;
            return (
              <tr key={r.id}>
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
                {DDL_COLUMN_FIELDS.map((f) => (
                  <td
                    key={f.key}
                    className={cn(cell_cls, is_insert ? added : removed)}
                  >
                    {cell(values, f.key)}
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

/** Index / foreign key rows — each still just one opaque definition line, so
 *  the grid here is Name + Definition, not fully decomposed fields (see
 *  spec 0003's Option 3 scope cut). */
function NamedTable({ rows }: { rows: DdlNamedRow[] }) {
  const line_cls = "px-2 py-1.5 font-mono break-all";
  const added = "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  const removed = "bg-red-500/10 text-red-800 dark:text-red-300";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-2 py-1.5 text-left font-medium">
              Name
            </th>
            <th className="text-muted-foreground px-2 py-1.5 text-left font-medium">
              Definition
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const is_insert = r.kind === "insert";
            const text = is_insert ? r.after : r.before;
            return (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="text-muted-foreground px-2 py-1.5 align-top font-mono">
                  {r.name}
                </td>
                <td className={cn(line_cls, is_insert ? added : removed)}>
                  {text ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Trigger rows — the full SQL body doesn't fit a normal cell, so each row
 *  renders full width instead (red for the old body, green for the new
 *  one), inside the same section container as the other entity tables. */
function TriggerRows({ rows }: { rows: DdlTriggerRow[] }) {
  return (
    <div className="space-y-1 px-3">
      {rows.map((r) => {
        const is_insert = r.kind === "insert";
        const text = is_insert ? r.after : r.before;
        return (
          <div
            key={r.id}
            className={cn(
              "overflow-hidden rounded border",
              is_insert
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "bg-red-500/10 text-red-800 dark:text-red-300",
            )}
          >
            <div className="text-3xs flex items-baseline gap-1.5 border-b border-current/20 px-2 py-1 font-medium tracking-wide uppercase opacity-80">
              <span className="select-none">{is_insert ? "+" : "−"}</span>
              <span className="normal-case">{r.name}</span>
            </div>
            <div className="px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">
              {text ?? ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
