import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import type { DiffGridRow, DiffRowAction } from "./types";

const ADDED = "bg-diff-add text-diff-add-foreground";
const REMOVED = "bg-diff-remove text-diff-remove-foreground";
const CELL = "px-2 py-1.5 font-mono break-all";
const SIGN = "px-1 py-1.5 select-none";
const LINE_PX = 30;

/** An explicit null reads NULL; a column the row doesn't carry stays blank. */
function cell_value(v: string | null | undefined) {
  return v === null ? <span className="italic opacity-60">NULL</span> : v;
}

/** Virtualized row diff: one entry per insert/delete, a red row above a
 *  green row per update. Rows are selectable only when both `selected` and
 *  `on_toggle` are passed; `row_actions` adds a hover menu to each row's
 *  gutter. Owns its scroll box, so give it a height (or a max height)
 *  through `className`. */
export function RowDiffGrid({
  rows,
  columns,
  gutter_label = "Row",
  selected,
  on_toggle,
  row_actions,
  className,
}: {
  rows: DiffGridRow[];
  columns: string[];
  gutter_label?: string;
  selected?: Set<string>;
  on_toggle?: (id: string, on: boolean) => void;
  row_actions?: (row: DiffGridRow, index: number) => DiffRowAction[];
  className?: string;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const selectable = !!selected && !!on_toggle;

  const gutter_rem = useMemo(() => {
    let longest = gutter_label.length;
    for (const r of rows) longest = Math.max(longest, r.label?.length ?? 0);
    const text = Math.min(16, Math.max(3, longest * 0.55 + 1));
    return text + (selectable ? 1.5 : 0) + (row_actions ? 1.5 : 0);
  }, [rows, gutter_label, selectable, row_actions]);

  const template = `${gutter_rem}rem 1.25rem repeat(${columns.length}, minmax(6rem, 1fr))`;
  const min_width = `${gutter_rem + 1.25 + columns.length * 6}rem`;

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer instance is stable; the rule can't see that
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (rows[i].kind === "update" ? 2 : 1) * LINE_PX,
    getItemKey: (i) => rows[i].id,
    overscan: 12,
  });

  return (
    <div ref={setScroller} className={cn("overflow-auto", className)}>
      <div className="text-small" style={{ minWidth: min_width }}>
        <div
          className="bg-background text-muted-foreground sticky top-0 z-10 grid border-b font-medium"
          style={{ gridTemplateColumns: template }}
        >
          <div className="px-2 py-1.5">{gutter_label}</div>
          <div />
          {columns.map((col) => (
            <div key={col} className="truncate px-2 py-1.5" title={col}>
              {col}
            </div>
          ))}
        </div>
        <div
          className="relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((v) => {
            const r = rows[v.index];
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className={cn(
                  "group/row absolute inset-x-0 top-0 grid border-b",
                  selectable && !selected.has(r.id) && "opacity-50",
                )}
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${v.start}px)`,
                }}
              >
                <div
                  className={cn(
                    "flex items-start gap-1.5 px-2 py-1.5",
                    r.kind === "update" && "row-span-2",
                  )}
                >
                  {selectable && (
                    <Checkbox
                      style={{ width: 16, height: 16 }}
                      checked={selected.has(r.id)}
                      onCheckedChange={(on) => on_toggle(r.id, on === true)}
                      aria-label="Include this row"
                    />
                  )}
                  <span
                    className="text-muted-foreground truncate font-mono"
                    title={r.label}
                  >
                    {r.label}
                  </span>
                  {row_actions && (
                    <RowActions actions={row_actions(r, v.index)} />
                  )}
                </div>
                <DiffLine row={r} columns={columns} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RowActions({ actions }: { actions: DiffRowAction[] }) {
  const trigger_class =
    "text-muted-foreground hover:text-foreground rounded-inset ml-auto shrink-0 p-0.5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100";
  if (actions.length === 0) return null;
  if (actions.length === 1) {
    const [a] = actions;
    return (
      <button
        type="button"
        className={trigger_class}
        title={a.label}
        aria-label={a.label}
        onClick={a.run}
      >
        <ExternalLink className="size-3.5" />
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={trigger_class}
            aria-label="Row actions"
          />
        }
      >
        <ExternalLink className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} onClick={a.run}>
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiffLine({ row, columns }: { row: DiffGridRow; columns: string[] }) {
  if (row.kind !== "update") {
    const is_insert = row.kind === "insert";
    const values = (is_insert ? row.after : row.before) ?? {};
    return (
      <>
        <div
          className={cn(
            SIGN,
            is_insert
              ? "text-diff-add-foreground"
              : "text-diff-remove-foreground",
          )}
        >
          {is_insert ? "+" : "−"}
        </div>
        {columns.map((col) => (
          <div key={col} className={cn(CELL, is_insert ? ADDED : REMOVED)}>
            {cell_value(values[col])}
          </div>
        ))}
      </>
    );
  }

  const before = row.before ?? {};
  const after = row.after ?? {};
  const changed = row.changed ? new Set(row.changed) : null;
  const marked = (side: Record<string, string | null>, col: string) =>
    changed ? changed.has(col) : Object.hasOwn(side, col);
  return (
    <>
      <div className={cn(SIGN, "text-diff-remove-foreground")}>−</div>
      {columns.map((col) => (
        <div
          key={col}
          className={cn(
            CELL,
            marked(before, col) ? REMOVED : "text-muted-foreground",
          )}
        >
          {cell_value(before[col])}
        </div>
      ))}
      <div className={cn(SIGN, "text-diff-add-foreground")}>+</div>
      {columns.map((col) => (
        <div
          key={col}
          className={cn(
            CELL,
            marked(after, col) ? ADDED : "text-muted-foreground",
          )}
        >
          {cell_value(after[col])}
        </div>
      ))}
    </>
  );
}
