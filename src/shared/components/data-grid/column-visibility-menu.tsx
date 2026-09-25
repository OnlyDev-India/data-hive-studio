import { useEffect, useRef, useState } from "react";
import { GripVertical, Search } from "lucide-react";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

/** Toolbar button + popover: search, show/hide, and drag-reorder every
 *  column — the same `reorder_column`/`toggle_column_visibility` actions
 *  the header cells' own drag handle and "Hide column" menu item use, just
 *  reachable without a schema loaded wide enough to see every header. A
 *  `Popover` (not a `DropdownMenu`) specifically because a dropdown's
 *  auto-close-on-interior-interaction and focus trap fight both the search
 *  input and native HTML5 drag events. */
/** `order` with `dragged` moved into the slot `over` holds right now. Working
 *  from the live order (not the one the drag started with) is what lets the
 *  ghost go back to where it began: the row now sitting in that slot is the
 *  one to hover. */
function move_into_slot(order: string[], dragged: string, over: string) {
  const from = order.indexOf(dragged);
  const to = order.indexOf(over);
  if (from === -1 || to === -1 || from === to) return order;
  const next = order.filter((c) => c !== dragged);
  next.splice(to, 0, dragged);
  return next;
}

/** The (dragged, target) pair `on_reorder` needs to produce `final`, which
 *  drops after the target when moving down and before it when moving up. */
function reorder_args(
  start: string[],
  final: string[],
  dragged: string,
): [string, string] | null {
  const from = start.indexOf(dragged);
  const at = final.indexOf(dragged);
  if (from === -1 || at === -1 || from === at) return null;
  return [dragged, at > from ? final[at - 1] : final[at + 1]];
}

export function ColumnVisibilityMenu({
  columns,
  hidden,
  on_toggle,
  on_reorder,
  on_reveal,
  children,
}: {
  /** Every column, in current display order (pin-partitioned,
   *  drag-reordered) — includes hidden ones, in their last-known spot. */
  columns: string[];
  hidden: string[];
  on_toggle: (col: string) => void;
  on_reorder: (dragged: string, target: string) => void;
  /** A click on a column's name (not its checkbox): select it in the grid and
   *  scroll it into view. */
  on_reveal: (col: string) => void;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The dragged column and the order the list shows while it moves.
  const [drag, setDrag] = useState<{ col: string; order: string[] } | null>(
    null,
  );
  const dragging = drag?.col ?? null;
  const drag_ref = useRef(drag);
  useEffect(() => {
    drag_ref.current = drag;
  });
  const hidden_set = new Set(hidden);
  const q = query.trim().toLowerCase();
  const matching = q
    ? columns.filter((c) => c.toLowerCase().includes(q))
    : columns;
  // While dragging, the list shows the order the drop would give, with the
  // dragged row as the placeholder sitting where it will land.
  const filtered = drag && !q ? drag.order : matching;
  // Applies to the FILTERED set, not every column — checking "select all"
  // while a search narrows the list only touches what's actually visible
  // here, same convention as a filtered list/inbox "select all".
  const filtered_hidden_count = filtered.filter((c) =>
    hidden_set.has(c),
  ).length;
  const all_shown = filtered_hidden_count === 0;
  const some_hidden =
    filtered_hidden_count > 0 && filtered_hidden_count < filtered.length;
  const toggle_all = () => {
    for (const c of filtered) {
      if (all_shown ? !hidden_set.has(c) : hidden_set.has(c)) on_toggle(c);
    }
  };

  // Pointer-based drag, not HTML5 DnD — see `header-cell.tsx`'s own drag
  // handle for why (native DnD is flaky inside this app's Tauri WebView).
  useEffect(() => {
    if (!dragging) return;
    const on_up = () => {
      const cur = drag_ref.current;
      if (cur) {
        const args = reorder_args(columns, cur.order, cur.col);
        if (args) on_reorder(...args);
      }
      setDrag(null);
    };
    window.addEventListener("mouseup", on_up);
    return () => window.removeEventListener("mouseup", on_up);
  }, [dragging, columns, on_reorder]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger render={children} />
      <PopoverContent className="flex w-64 flex-col gap-2 p-2" align="start">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search columns…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="text-muted-foreground border-border/60 text-2xs flex items-center gap-2 border-b px-2 pt-1 pb-1.5 font-medium">
          <span className="size-3.5 shrink-0" />
          <Checkbox
            checked={all_shown}
            indeterminate={some_hidden}
            onCheckedChange={toggle_all}
            disabled={filtered.length === 0}
          />
          <span>Column</span>
        </div>
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">
              No matching columns.
            </p>
          )}
          {filtered.map((col) => (
            <div
              key={col}
              title={q ? "Clear the search to drag-reorder" : undefined}
              onMouseEnter={() => {
                if (!q && drag && drag.col !== col)
                  setDrag({
                    col: drag.col,
                    order: move_into_slot(drag.order, drag.col, col),
                  });
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs",
                // The ghost: the dragged column, drawn where it will drop.
                dragging === col &&
                  "border-primary bg-primary/10 border border-dashed opacity-60",
              )}
            >
              <GripVertical
                className={cn(
                  "text-muted-foreground/40 size-3.5 shrink-0",
                  q ? "opacity-30" : "cursor-grab",
                )}
                onMouseDown={(e) => {
                  if (q) return;
                  e.preventDefault();
                  setDrag({ col, order: columns });
                }}
              />
              <Checkbox
                checked={!hidden_set.has(col)}
                aria-label={`Show ${col}`}
                onCheckedChange={() => on_toggle(col)}
              />
              <button
                type="button"
                disabled={hidden_set.has(col)}
                title={
                  hidden_set.has(col)
                    ? "Show the column to select it"
                    : "Select column"
                }
                className="min-w-0 flex-1 cursor-pointer truncate text-left disabled:cursor-default disabled:opacity-60"
                onClick={() => on_reveal(col)}
              >
                {col}
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
