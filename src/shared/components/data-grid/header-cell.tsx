import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Pin,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useGrid } from "./grid-context";

interface HeaderCellProps {
  col: string;
  is_sorted: boolean;
  is_asc: boolean;
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

export function HeaderCell({
  col,
  is_sorted,
  is_asc,
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
  const toggle_pin = ctx.on_toggle_pin;

  const [open, setOpen] = useState(false);
  const [type_open, setTypeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag_start = useRef<{ x: number; w: number } | null>(null);
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

  const merged = cn(
    "relative min-w-0 shrink-0 w-36",
    is_pinned && "sticky bg-muted z-40",
  );

  return (
    <div
      className={merged}
      style={{ width, ...(is_pinned ? { left: `${px}px` } : {}) }}
    >
      <div className="flex h-7 w-full min-w-0 items-center gap-1 overflow-hidden px-2">
        {/* Name + type, same line — clicking anywhere here shows column
            details (the type popover below). The sort/pin dropdown only
            opens from the chevron, its own separate click target. */}
        <button
          type="button"
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden text-left",
            is_sorted
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          title="Column details"
          onClick={() => {
            setCopied(false);
            setTypeOpen((o) => !o);
          }}
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
          <span className="truncate">{col}</span>
          {type_label && (
            <span className="text-muted-foreground/60 text-3xs shrink-0 truncate font-normal tracking-wide uppercase">
              {type_label}
            </span>
          )}
        </button>
        {is_sorted &&
          (is_asc ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          ))}
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
      {type_open && type_label && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setTypeOpen(false)}
          />
          <div className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 w-56 rounded-md border p-2.5 text-xs shadow-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Column</span>
              <button
                type="button"
                title="Copy type"
                aria-label="Copy type"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => {
                  void navigator.clipboard.writeText(type_label).then(() => {
                    setCopied(true);
                  });
                }}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
            </div>
            <div className="mt-0.5 truncate font-mono">{col}</div>
            <div className="text-muted-foreground mt-2">Type</div>
            <div className="text-info-dark wrap-break-words mt-0.5 font-mono">
              {type_label}
            </div>
          </div>
        </>
      )}
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
