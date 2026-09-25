import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  EyeOff,
  KeyRound,
  Pin,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { ColumnQuickFilter } from "./column-quick-filter";
import { cellKey, useGrid } from "./grid-context";

interface HeaderCellProps {
  col: string;
  is_sorted: boolean;
  is_asc: boolean;
  /** This column's 0-based priority in the active multi-column sort, or
   *  `null` when it isn't sorted. Only shown as a badge once more than one
   *  column is sorted — a single sort looks exactly as it always has. */
  sort_index: number | null;
  is_pinned: boolean;
  /** Sticky left offset when pinned (0 otherwise). */
  px: number;
  width: number;
}

const KEY_TITLES: Record<string, string> = {
  primary: "Primary key",
  foreign: "Foreign key",
  both: "Primary + foreign key",
};

const MIN_COL_W_PX = 64;
/** Pointer must move this many px from mousedown before a header press
 *  counts as a drag instead of a click — matches `use-tab-drag.ts`'s own
 *  threshold. Below it, the press falls through as a normal click (column
 *  select, sort-menu chevron, …). */
const DRAG_THRESHOLD_PX = 4;

/** Module-level, not per-cell state: a drag's mouseup/click lands wherever
 *  the pointer currently is, which is very often a DIFFERENT header cell
 *  than the one the drag started on — same reasoning as `use-tab-drag.ts`'s
 *  own `suppress_next_click`. Set the instant a press crosses the drag
 *  threshold, consumed by whichever cell's `onClickCapture` sees the
 *  resulting click. */
let suppress_next_header_click = false;
function consumeSuppressedHeaderClick(): boolean {
  if (suppress_next_header_click) {
    suppress_next_header_click = false;
    return true;
  }
  return false;
}

export function HeaderCell({
  col,
  is_sorted,
  is_asc,
  sort_index,
  is_pinned,
  px,
  width,
}: HeaderCellProps) {
  const ctx = useGrid();
  const type_label = ctx.types?.[col];
  const key_kind = ctx.key_kinds?.[col];
  const resize_col = ctx.on_resize_col;
  const auto_fit_col = ctx.auto_fit_col;
  const sort = ctx.on_sort;
  const clear_sort = ctx.on_clear_sort;
  const clear_all_sort = ctx.on_clear_all_sort;
  const sort_count = ctx.sort_keys.length;
  const toggle_pin = ctx.on_toggle_pin;
  const toggle_column_visibility = ctx.toggle_column_visibility;
  const start_column_drag = ctx.start_column_drag;
  const select_column = ctx.select_column;
  const col_dragging = ctx.col_drag?.col === col;
  const active_filter = ctx.filters?.find(
    (f) => f.column === col && f.op === "in",
  );
  const ci = ctx.col_index_of[col];
  // Every row of this column is selected (a header click, or the same cells
  // picked another way). The size check keeps the scan off the common case.
  const col_selected =
    ctx.row_count > 0 &&
    ctx.selected.size >= ctx.row_count &&
    Array.from({ length: ctx.row_count }, (_, r) => r).every((r) =>
      ctx.selected.has(cellKey(r, col)),
    );
  const quick_filter_values = useMemo(
    () => [...new Set(ctx.rows.map((r) => r[ci] ?? null))],
    [ctx.rows, ci],
  );

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag_start = useRef<{ x: number; w: number } | null>(null);
  // Column drag-reorder: press-and-hold anywhere in the header, not a
  // dedicated handle — so a plain click still has to be told apart from the
  // start of a drag (see `DRAG_THRESHOLD_PX`/`suppress_next_header_click`).
  const [col_pointer_down, setColPointerDown] = useState(false);
  const col_press_pos = useRef<{ x: number; y: number } | null>(null);
  // While a page query is in flight, header sort/pin actions pause — they
  // would just cancel and restart the running fetch.
  const busy = ctx.loading === true;

  const on_resize_col = useCallback(
    (px: number) => resize_col(col, px),
    [resize_col, col],
  );
  const on_auto_fit_col = () => auto_fit_col(col);
  const on_sort = (asc: boolean) => {
    if (busy) return;
    sort(col, asc);
  };
  const on_clear_sort = () => {
    if (busy) return;
    clear_sort(col);
  };
  const on_clear_all_sort = () => {
    if (busy) return;
    clear_all_sort();
  };
  const on_toggle_pin = () => {
    if (busy) return;
    toggle_pin(col);
  };

  // Track the pointer while resizing; widths update live (no layout shift).
  useEffect(() => {
    if (!dragging) return;
    const on_move = (e: MouseEvent) => {
      if (!drag_start.current) return;
      const dx = e.clientX - drag_start.current.x;
      on_resize_col(
        Math.max(MIN_COL_W_PX, Math.round(drag_start.current.w + dx)),
      );
    };
    const on_up = () => {
      drag_start.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", on_move);
    window.addEventListener("mouseup", on_up);
    return () => {
      window.removeEventListener("mousemove", on_move);
      window.removeEventListener("mouseup", on_up);
    };
  }, [dragging, on_resize_col]);

  // Waits for the drag threshold before engaging the actual column drag
  // (`ctx.start_column_drag`) — a plain click never crosses it, so it falls
  // through to the name button's own onClick untouched.
  useEffect(() => {
    if (!col_pointer_down) return;
    const on_move = (e: MouseEvent) => {
      const start = col_press_pos.current;
      if (!start) return;
      if (
        Math.abs(e.clientX - start.x) < DRAG_THRESHOLD_PX &&
        Math.abs(e.clientY - start.y) < DRAG_THRESHOLD_PX
      )
        return;
      col_press_pos.current = null;
      suppress_next_header_click = true;
      start_column_drag(col, e.clientX, e.clientY);
    };
    const on_up = () => setColPointerDown(false);
    window.addEventListener("mousemove", on_move);
    window.addEventListener("mouseup", on_up);
    return () => {
      window.removeEventListener("mousemove", on_move);
      window.removeEventListener("mouseup", on_up);
    };
  }, [col_pointer_down, col, start_column_drag]);

  const merged = cn(
    "relative h-full min-w-0 shrink-0 w-36",
    is_pinned && "sticky bg-muted z-40",
  );

  return (
    <div
      className={merged}
      style={{ width, ...(is_pinned ? { left: `${px}px` } : {}) }}
    >
      <div
        data-col={col}
        className={cn(
          "flex h-full w-full min-w-0 cursor-grab items-center gap-1 overflow-hidden px-2 active:cursor-grabbing",
          // Reordering happens live as the drag crosses into each column
          // (tracked by cursor position in `grid-controller.ts`, not this
          // cell's own hover state — see that file's `on_move` for why), so
          // the dragged column is already sitting at its live position —
          // this just marks which one it is.
          col_dragging && "bg-primary/10 ring-primary/50 ring-1 ring-inset",
          col_selected && "bg-primary/30 text-primary-foreground",
        )}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          col_press_pos.current = { x: e.clientX, y: e.clientY };
          setColPointerDown(true);
        }}
        onClickCapture={(e) => {
          if (consumeSuppressedHeaderClick()) e.stopPropagation();
        }}
      >
        <Tooltip onOpenChange={(o) => o && setCopied(false)}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden text-left",
                  is_sorted
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={(e) =>
                  select_column(col, {
                    add: e.metaKey || e.ctrlKey,
                    range: e.shiftKey,
                  })
                }
              />
            }
          >
            {key_kind && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5"
                title={KEY_TITLES[key_kind]}
              >
                {(key_kind === "primary" || key_kind === "both") && (
                  <KeyRound className="size-3 text-amber-500" />
                )}
                {(key_kind === "foreign" || key_kind === "both") && (
                  <KeyRound className="size-3 text-sky-500" />
                )}
              </span>
            )}
            {/* Name over type, so both stay readable in a narrow column
                without making the header taller than a row. */}
            <span className="flex min-w-0 flex-col items-start justify-center">
              <span className="max-w-full truncate leading-4">{col}</span>
              {type_label && (
                <span className="text-muted-foreground/60 text-3xs max-w-full truncate leading-3 font-normal tracking-wide uppercase">
                  {type_label}
                </span>
              )}
            </span>
          </TooltipTrigger>
          {(type_label || key_kind) && (
            <TooltipContent
              side="bottom"
              align="center"
              showArrow={false}
              className="bg-popover text-popover-foreground w-56 rounded-md border p-2.5 text-left text-xs shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Column</span>
                {type_label && (
                  <button
                    type="button"
                    title="Copy type"
                    aria-label="Copy type"
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(type_label)
                        .then(() => setCopied(true));
                    }}
                  >
                    {copied ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono">{col}</div>
              {type_label && (
                <>
                  <div className="text-muted-foreground mt-2">Type</div>
                  <div className="text-info-dark wrap-break-words mt-0.5 font-mono">
                    {type_label}
                  </div>
                </>
              )}
              {key_kind && (
                <>
                  <div className="text-muted-foreground mt-2">Key</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-0.5">
                      {(key_kind === "primary" || key_kind === "both") && (
                        <KeyRound className="size-3 text-amber-500" />
                      )}
                      {(key_kind === "foreign" || key_kind === "both") && (
                        <KeyRound className="size-3 text-sky-500" />
                      )}
                    </span>
                    {KEY_TITLES[key_kind]}
                  </div>
                </>
              )}
            </TooltipContent>
          )}
        </Tooltip>
        {is_sorted &&
          (is_asc ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          ))}
        {is_sorted && sort_index !== null && sort_count > 1 && (
          <span
            className="text-muted-foreground bg-muted text-3xs -ml-0.5 shrink-0 rounded-full px-1 leading-4 tabular-nums"
            title={`Sort priority ${sort_index + 1} of ${sort_count}`}
          >
            {sort_index + 1}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="iconXs"
          className="shrink-0 cursor-pointer"
          title="Column options"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="bg-popover absolute top-full left-0 z-50 mt-1 w-44 overflow-hidden rounded-md border p-1 shadow-md">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
              onClick={() => {
                on_sort(true);
                setOpen(false);
              }}
            >
              <ArrowUp className="size-3.5 shrink-0" />
              Sort ascending
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
              onClick={() => {
                on_sort(false);
                setOpen(false);
              }}
            >
              <ArrowDown className="size-3.5 shrink-0" />
              Sort descending
            </Button>
            <div className="bg-border mx-1 my-1 h-px" />
            {is_sorted && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
                onClick={() => {
                  on_clear_sort();
                  setOpen(false);
                }}
              >
                <X className="size-3.5 shrink-0" />
                Remove sort
              </Button>
            )}
            {sort_count > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
                onClick={() => {
                  on_clear_all_sort();
                  setOpen(false);
                }}
              >
                <X className="size-3.5 shrink-0" />
                Clear all sorts
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
              onClick={() => {
                on_toggle_pin();
                setOpen(false);
              }}
            >
              <Pin className="size-3.5 shrink-0" />
              {is_pinned ? "Unpin column" : "Pin column"}
            </Button>
            {ctx.on_column_filter && (
              <ColumnQuickFilter
                col={col}
                fallback_values={quick_filter_values}
                fetch_all={ctx.fetch_distinct_values}
                active_filter={active_filter}
                on_apply={(values) => ctx.on_column_filter!(col, values)}
                on_clear={() => ctx.on_column_filter!(col, null)}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5"
              onClick={() => {
                toggle_column_visibility(col);
                setOpen(false);
              }}
            >
              <EyeOff className="size-3.5 shrink-0" />
              Hide column
            </Button>
          </div>
        </>
      )}
      {/* Column resize handle */}
      <div
        className={cn(
          "absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors",
          dragging ? "bg-primary" : "hover:bg-primary/60",
        )}
        title="Resize column (double-click to auto-fit)"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          drag_start.current = { x: e.clientX, w: width };
          setDragging(true);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          drag_start.current = null;
          setDragging(false);
          on_auto_fit_col();
        }}
      />
    </div>
  );
}
