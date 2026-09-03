import { cn } from "@/shared/lib/utils";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Cell } from "./cell";
import { HeaderCell } from "./header-cell";
import { useGrid } from "./grid-context";

/**
 * Presentational shell of the grid: renders the header row and the data rows.
 * All state and event handling lives in the grid context ({@link useGrid}),
 * so this component intentionally takes no props.
 *
 * The root div is the scroll container (and the virtualizer's scroll element):
 * only the visible window of rows is mounted, each absolutely positioned at
 * its virtual offset inside a spacer sized to the full row count. Rows are
 * single-line truncated, so heights are uniform; they are still measured on
 * mount so the estimate never has to be exact.
 */
export function GridBody() {
  const ctx = useGrid();
  const { view, rows, row_offset, pinned, pending_count } = ctx;
  const { column_order, col_meta, pin_px, width_of } = view;

  const root_mouse_down = ctx.on_root_mouse_down;
  const on_root_ready = ctx.on_root_ready;
  const root_mouse_up = ctx.stop_drag;
  const root_keydown = ctx.on_root_keydown;

  const virt = ctx.row_virtualizer;
  const items = virt.getVirtualItems();

  const headers = column_order.map(
    (col) =>
      [
        col,
        ctx.sort_col === col,
        pinned.includes(col),
        pin_px[col] ?? 0,
      ] as const,
  );

  return (
    <div
      ref={(el) => on_root_ready(el)}
      tabIndex={0}
      className="h-full overflow-auto outline-none"
      onMouseDown={(e) => root_mouse_down(e)}
      onMouseUp={() => root_mouse_up()}
      onMouseLeave={() => root_mouse_up()}
      onKeyDown={(e) => root_keydown(e)}
    >
      {/* Header: corner cell (row-number gutter header) then column headers.
          Sticks to the top of the scroller while rows window underneath. */}
      <div className="bg-muted text-muted-foreground sticky top-0 z-8 flex w-max min-w-full border-b text-xs font-medium select-none">
        <div className="border-border/40 bg-muted sticky left-0 z-8 flex w-12 shrink-0 items-center justify-center border-r text-[11px]">
          <span>#</span>
        </div>
        {headers.map(([col, isSorted, isPinned, px]) => (
          <HeaderCell
            key={col}
            col={col}
            is_sorted={isSorted}
            is_asc={ctx.sort_asc}
            is_pinned={isPinned}
            px={px}
            width={width_of(col)}
          />
        ))}
      </div>
      {/* Rows: each row starts with its row-number gutter. The container is a
          spacer as tall as the full row count; mounted rows are offset to
          their virtual position. */}
      <div
        className="relative w-max min-w-full"
        style={{ height: virt.getTotalSize() }}
      >
        {items.map((vi) => {
          const idx = vi.index;
          const gutter_sel = column_order.some((c) =>
            ctx.selected.has(`${idx}\u0000${c}`),
          );
          const is_pending = idx < pending_count;
          const is_deleted = ctx.row_deleted(idx);
          return (
            <div
              key={idx}
              data-index={idx}
              ref={virt.measureElement}
              className={cn(
                "hover:bg-muted/30 absolute top-0 left-0 flex w-max border-b transition-colors",
                is_pending && "bg-yellow-300/10",
                is_deleted && "bg-destructive/10",
              )}
              style={{
                // Absolute + top (instead of transform) keeps rows OUT of
                // their own stacking contexts, so the editing cell's z-index
                // works globally against every other cell/row.
                top: `${vi.start}px`,
              }}
            >
              <div
                className={cn(
                  "border-border/40 bg-muted text-muted-foreground sticky left-0 z-7 flex w-12 shrink-0 cursor-pointer items-center justify-center border-r text-[11px] select-none",
                  gutter_sel &&
                    "bg-primary text-primary-foreground font-medium",
                  is_pending && "bg-yellow-300/20",
                  is_deleted && "bg-destructive/15 text-destructive",
                )}
                title={`Select row ${row_offset + idx + 1}`}
                onMouseDown={(e) => {
                  const add = e.metaKey || e.ctrlKey;
                  const range = e.shiftKey;
                  ctx.start_drag({
                    row: idx,
                    col: "",
                    add,
                    range,
                    gutter: true,
                  });
                }}
                onMouseEnter={() => {
                  ctx.drag_to({
                    row: idx,
                    col: "",
                    add: false,
                    range: false,
                    gutter: true,
                  });
                }}
              >
                {is_pending ? (
                  <Button
                    variant="ghost"
                    size="iconXs"
                    className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive size-4"
                    aria-label="Discard new row"
                    title="Discard new row"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.on_remove_pending(idx);
                    }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : (
                  row_offset + idx + 1
                )}
              </div>
              {col_meta.map(([col], dci) => (
                <Cell key={`${col}-${idx}`} row={idx} col={col} dci={dci} />
              ))}
            </div>
          );
        })}
      </div>
      {rows.length === 0 && (
        <p className="text-muted-foreground px-3 py-8 text-center text-sm">
          No rows.
        </p>
      )}
    </div>
  );
}
