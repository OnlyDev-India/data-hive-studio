import { useEffect, useState } from "react";
import { Columns3, GripVertical, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
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
export function ColumnVisibilityMenu({
  columns,
  hidden,
  on_toggle,
  on_reorder,
}: {
  /** Every column, in current display order (pin-partitioned,
   *  drag-reordered) — includes hidden ones, in their last-known spot. */
  columns: string[];
  hidden: string[];
  on_toggle: (col: string) => void;
  on_reorder: (dragged: string, target: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [drag_over, setDragOver] = useState<string | null>(null);
  const hidden_set = new Set(hidden);
  const q = query.trim().toLowerCase();
  const filtered = q ? columns.filter((c) => c.toLowerCase().includes(q)) : columns;
  // Applies to the FILTERED set, not every column — checking "select all"
  // while a search narrows the list only touches what's actually visible
  // here, same convention as a filtered list/inbox "select all".
  const filtered_hidden_count = filtered.filter((c) => hidden_set.has(c)).length;
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
      setDragging((from) => {
        setDragOver((to) => {
          if (from && to && from !== to) on_reorder(from, to);
          return null;
        });
        return null;
      });
    };
    window.addEventListener("mouseup", on_up);
    return () => window.removeEventListener("mouseup", on_up);
  }, [dragging, on_reorder]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            title="Columns"
            aria-label="Columns"
            className="shrink-0"
          />
        }
      >
        <Columns3 className="size-3.5" />
      </PopoverTrigger>
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
        <div className="text-muted-foreground border-border/60 flex items-center gap-2 border-b px-2 pt-1 pb-1.5 text-2xs font-medium">
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
                if (!q && dragging && dragging !== col) setDragOver(col);
              }}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs",
                // Insertion line above the target row — `on_reorder` always
                // drops before `col`, mirroring the header's own left-edge
                // indicator.
                drag_over === col && "border-primary bg-primary/10 border-t-2",
                dragging === col && "opacity-40",
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
                  setDragging(col);
                }}
              />
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={!hidden_set.has(col)}
                  onCheckedChange={() => on_toggle(col)}
                />
                <span className="truncate">{col}</span>
              </label>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
