import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useGrid } from "./grid-context";

/** Floating find-in-grid overlay (Ctrl/Cmd+F) — a small pill anchored to the
 *  grid's own top-right corner rather than pushed into the toolbar, matching
 *  the JSON viewer's own search bar in spirit (live count, next/prev,
 *  Escape to close) even though the underlying match/highlight mechanism is
 *  necessarily different (plain DOM cells here, not CodeMirror
 *  decorations). All of its own key handling stops propagation so it never
 *  also reaches the grid root's `useGridKeyboard` listener underneath. */
export function GridSearchBar() {
  const ctx = useGrid();
  const input_ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ctx.search_open) input_ref.current?.focus();
  }, [ctx.search_open]);

  if (!ctx.search_open) return null;

  const count = ctx.search_matches.length;
  const position = count === 0 ? 0 : ctx.search_active_index + 1;

  return (
    <div className="bg-popover absolute top-2 right-2 z-30 flex items-center gap-1 rounded-md border p-1 shadow-md">
      <Search className="text-muted-foreground ml-1 size-3.5 shrink-0" />
      <Input
        ref={input_ref}
        value={ctx.search_query}
        onChange={(e) => ctx.on_search_query(e.target.value)}
        placeholder="Find in grid…"
        className="h-6 w-40 border-none text-xs shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) ctx.on_search_prev();
            else ctx.on_search_next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            ctx.on_search_close();
          }
        }}
      />
      <span className="text-muted-foreground text-2xs w-12 shrink-0 text-center tabular-nums">
        {count === 0 ? "0/0" : `${position}/${count}`}
      </span>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Previous match"
        title="Previous match"
        disabled={count === 0}
        onClick={ctx.on_search_prev}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Next match"
        title="Next match"
        disabled={count === 0}
        onClick={ctx.on_search_next}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Close search"
        title="Close search"
        onClick={ctx.on_search_close}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
