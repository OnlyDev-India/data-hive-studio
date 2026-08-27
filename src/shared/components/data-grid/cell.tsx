import { cn } from "@/shared/lib/utils";
import { CellEditor } from "./cell-editor";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  Braces,
  Clipboard,
  CopyPlus,
  Database,
  ExternalLink,
  FileJson,
  FileText,
  Pencil,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useGrid, cellKey } from "./grid-context";
import {
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  type CellKind,
} from "./types";

/** Truthy test for stored boolean text (SQLite keeps booleans as 0/1). */
function isTruthy(v: string | null): boolean {
  return v === "1" || v?.toLowerCase() === "true";
}

interface CellProps {
  row: number;
  col: string;
  /** Display (column-order) index, used for scrolling + data-cell lookup. */
  dci: number;
}

export function Cell({ row, col, dci }: CellProps) {
  const ctx = useGrid();
  const {
    view,
    editing,
    selected,
    editable,
    pending_count,
    kinds,
    cell_dirty,
    row_deleted,
  } = ctx;
  const { col_index_of, pin_px, width_of, sel_bounds } = view;

  const ci = col_index_of[col] ?? 0;
  const value = ctx.rows[row]?.[ci] ?? null;
  const key = cellKey(row, col);
  const is_selected = selected.has(key);
  const is_pending = row < pending_count;
  const dirty = cell_dirty(row, col);
  const deleted = row_deleted(row);
  const is_editing =
    editing !== null && editing[0] === row && editing[1] === col;
  const pinned = ctx.pinned.includes(col);
  const width = width_of(col);
  const px = pinned ? (pin_px[col] ?? 0) : 0;
  const kind: CellKind = kinds[col] ?? "text";

  const in_net = is_selected && sel_bounds !== null;
  const col_ci = col_index_of[col];
  const sel_edges =
    in_net && sel_bounds !== null
      ? (row === sel_bounds.min_r ? EDGE_TOP : 0) |
        (row === sel_bounds.max_r ? EDGE_BOTTOM : 0) |
        (col_ci === sel_bounds.min_ci ? EDGE_LEFT : 0) |
        (col_ci === sel_bounds.max_ci ? EDGE_RIGHT : 0)
      : 0;
  const is_anchor =
    is_selected &&
    ctx.sel_anchor !== null &&
    cellKey(ctx.sel_anchor[0], ctx.sel_anchor[1]) === key;
  const is_handle =
    in_net &&
    sel_bounds !== null &&
    row === sel_bounds.max_r &&
    col_ci === sel_bounds.max_ci;

  // Boolean columns render an inline checkbox instead of text; clicking it
  // toggles the value in place (buffered like any other edit).
  const is_bool = (ctx.kinds[col] ?? "text") === "bool";
  const can_edit = editable || is_pending;
  const truthy = isTruthy(value);
  const toggle_bool = () => {
    const next = truthy ? "0" : "1";
    if (is_pending) ctx.on_pending_edit(row, col, next);
    else ctx.on_edit_cell(row, col, next);
  };

  // The selection "net" is drawn with inset box-shadows so no border widths
  // are added and the cell content never shifts. The start/anchor cell gets a
  // full highlight box; the remaining selected cells get only their outer
  // net edges.
  const net_shadows: string[] = [];
  if (is_selected && is_anchor) {
    net_shadows.push("inset 0 0 0 2px var(--selection-border)");
  } else if (is_selected) {
    if ((sel_edges & EDGE_TOP) !== 0)
      net_shadows.push("inset 0 2px 0 0 var(--selection-border)");
    if ((sel_edges & EDGE_RIGHT) !== 0)
      net_shadows.push("inset -2px 0 0 0 var(--selection-border)");
    if ((sel_edges & EDGE_BOTTOM) !== 0)
      net_shadows.push("inset 0 -2px 0 0 var(--selection-border)");
    if ((sel_edges & EDGE_LEFT) !== 0)
      net_shadows.push("inset 2px 0 0 0 var(--selection-border)");
  }
  const boxShadow = is_editing
    ? "inset 0 0 0 2px var(--color-primary)"
    : net_shadows.length > 0
      ? net_shadows.join(", ")
      : undefined;

  const cellClass = cn(
    "group/cell relative flex min-w-0 items-center overflow-visible border-r border-border/40 px-3 py-1.5 text-sm w-36 shrink-0 cursor-cell select-none",
    is_selected && "bg-primary/15",
    dirty && !is_selected && "bg-yellow-300/10",
    deleted && "line-through",
    pinned && "sticky z-30 bg-background",
    is_editing && "p-0",
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">
        <div
          className={cellClass}
          data-cell={`${row}:${dci}`}
          style={{
            width,
            boxShadow,
            // The editing cell elevates above sibling rows (virtualizer
            // transforms create per-row stacking contexts) so its editor —
            // and any overlay it opens — covers later rows, while still
            // sitting UNDER the header/gutter/pinned chrome (z-30/z-40).
            // position: "relative",
            zIndex: is_editing ? 40 : pinned ? 50 : undefined,
            ...(pinned ? { left: `${px}px` } : {}),
          }}
          onMouseDown={(e) => {
            // Keep the editor open for clicks inside the cell: letting the
            // event reach the grid root would steal focus from the editor
            // input, whose blur handler commits and closes.
            if (is_editing) {
              e.stopPropagation();
              return;
            }
            if (e.button !== 0) return;
            ctx.start_drag({
              row,
              col,
              add: e.metaKey || e.ctrlKey,
              range: e.shiftKey,
              gutter: false,
            });
          }}
          onMouseEnter={() => {
            if (is_editing) return;
            ctx.drag_to({ row, col, add: false, range: false, gutter: false });
          }}
          onDoubleClick={() => {
            // Bool cells toggle in place instead of opening an editor.
            if (is_bool && can_edit) {
              toggle_bool();
              return;
            }
            ctx.open_editor({
              row,
              col,
              add: false,
              range: false,
              gutter: false,
            });
          }}
          onContextMenu={(e) => {
            if (is_editing) {
              e.stopPropagation();
              return;
            }
            ctx.menu_select(row, col);
          }}
        >
          {is_editing && (editable || is_pending) ? (
            <CellEditor key={`${col}-${row}`} />
          ) : is_bool ? (
            <Checkbox
              checked={truthy}
              indeterminate={value === null}
              disabled={!can_edit}
              className="size-3.5"
              title={value === null ? "NULL" : undefined}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (can_edit) toggle_bool();
              }}
            />
          ) : value !== null ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground italic">NULL</span>
          )}
          {/* FK jump: opens the referenced table filtered to this value. */}
          {ctx.fk_targets?.[col] && !is_editing && (
            <Button
              variant="ghost"
              size="iconXs"
              title={`Open ${ctx.fk_targets[col].table}`}
              className={cn(
                "bg-background/90 text-muted-foreground hover:bg-muted hover:text-primary absolute top-1/2 right-1 z-10 size-5 -translate-y-1/2 rounded shadow-sm",
                is_selected
                  ? "opacity-100"
                  : "opacity-0 group-hover/cell:opacity-100",
              )}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const fk = ctx.fk_targets?.[col];
                if (fk) ctx.on_open_reference?.(fk.table, fk.column, value);
              }}
            >
              <ExternalLink className="size-3" />
            </Button>
          )}
          {/* Excel-style fill handle (visual anchor) on the last cell of the net. */}
          {is_handle && !is_editing && (
            <div className="border-background bg-primary absolute -right-1 -bottom-1 size-2 cursor-crosshair rounded-full border" />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {editable && (
          <ContextMenuItem onSelect={() => ctx.menu_edit(row, col)}>
            <Pencil className="size-3.5" />
            Edit cell
          </ContextMenuItem>
        )}
        {editable && kind != "text" && (
          <ContextMenuItem onSelect={() => ctx.menu_edit(row, col, true)}>
            <TextCursorInput className="size-3.5" />
            Edit cell as Text
          </ContextMenuItem>
        )}
        {ctx.menu_clone_row && !is_pending && (
          <ContextMenuItem onSelect={() => ctx.menu_clone_row?.(row)}>
            <CopyPlus className="size-3.5" />
            Clone row
          </ContextMenuItem>
        )}
        {ctx.menu_show_json && !is_pending && (
          <ContextMenuItem onSelect={() => ctx.menu_show_json?.()}>
            <Braces className="size-3.5" />
            View JSON
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={ctx.menu_copy}>
          <Clipboard className="size-3.5" />
          Copy as Excel
        </ContextMenuItem>
        {ctx.menu_copy_as && (
          <>
            <ContextMenuItem onSelect={() => ctx.menu_copy_as?.(row, "json")}>
              <FileJson className="size-3.5" />
              Copy as JSON
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => ctx.menu_copy_as?.(row, "markdown")}
            >
              <FileText className="size-3.5" />
              Copy as Markdown
            </ContextMenuItem>
            {ctx.table.trim().length > 0 && (
              <ContextMenuItem onSelect={() => ctx.menu_copy_as?.(row, "sql")}>
                <Database className="size-3.5" />
                Copy as SQL
              </ContextMenuItem>
            )}
          </>
        )}
        {editable && !is_pending && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => ctx.menu_delete(row)}
            >
              <Trash2 className="size-3.5" />
              Delete row
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
