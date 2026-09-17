import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { SearchQuery, findNext, findPrevious, setSearchQuery } from "@codemirror/search";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

/** Every match for `query`, plus which one (if any) the current selection
 *  sits on — `@codemirror/search` finds/highlights matches but doesn't
 *  expose a count on its own, so this walks the same cursor its `findNext`/
 *  `findPrevious` commands use. Cheap: only ever runs over one document,
 *  triggered by a keystroke or a button click, not on every render. */
function countMatches(
  view: EditorView,
  query: SearchQuery,
): { count: number; active: number } {
  if (!query.valid) return { count: 0, active: -1 };
  const cursor = query.getCursor(view.state);
  const sel = view.state.selection.main;
  let count = 0;
  let active = -1;
  let r = cursor.next();
  while (!r.done) {
    if (active === -1 && r.value.from === sel.from && r.value.to === sel.to) {
      active = count;
    }
    count++;
    r = cursor.next();
  }
  return { count, active };
}

/** Floating find-in-editor overlay (Mod-F / `editor.search`) — replaces
 *  `@codemirror/search`'s own default panel with one that matches the rest
 *  of the app, same shape as `GridSearchBar` (the data grid's own find):
 *  live count, next/prev, Escape to close. The library's search STATE and
 *  match highlighting (`search()` in `index.tsx`'s extensions) still do the
 *  actual work — this only supplies a different front end for it, driving
 *  the same `setSearchQuery`/`findNext`/`findPrevious` a hand-written panel
 *  would use. */
export function EditorSearchBar({
  open,
  onOpenChange,
  getView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getView: () => EditorView | null;
}) {
  const [query, setQuery] = useState("");
  const [{ count, active }, setMatchState] = useState({ count: 0, active: -1 });
  const query_ref = useRef(new SearchQuery({ search: "" }));
  const input_ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input_ref.current?.focus();
  }, [open]);

  const apply_query = (text: string) => {
    setQuery(text);
    const q = new SearchQuery({ search: text });
    query_ref.current = q;
    const view = getView();
    if (!view) return;
    view.dispatch({ effects: setSearchQuery.of(q) });
    setMatchState(text ? countMatches(view, q) : { count: 0, active: -1 });
  };

  const refresh_position = () => {
    const view = getView();
    if (!view) return;
    setMatchState(
      query ? countMatches(view, query_ref.current) : { count: 0, active: -1 },
    );
  };

  const go_next = () => {
    const view = getView();
    if (!view || !query) return;
    findNext(view);
    refresh_position();
  };
  const go_prev = () => {
    const view = getView();
    if (!view || !query) return;
    findPrevious(view);
    refresh_position();
  };
  const close = () => {
    onOpenChange(false);
    const view = getView();
    view?.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
    setQuery("");
    setMatchState({ count: 0, active: -1 });
    view?.focus();
  };

  if (!open) return null;

  return (
    <div className="bg-popover absolute top-2 right-2 z-30 flex items-center gap-1 rounded-md border p-1 shadow-md">
      <Search className="text-muted-foreground ml-1 size-3.5 shrink-0" />
      <Input
        ref={input_ref}
        value={query}
        onChange={(e) => apply_query(e.target.value)}
        placeholder="Find in editor…"
        className="h-6 w-40 border-none text-xs shadow-none focus-visible:ring-0"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) go_prev();
            else go_next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="text-muted-foreground text-2xs w-12 shrink-0 text-center tabular-nums">
        {count === 0 ? "0/0" : `${active + 1}/${count}`}
      </span>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Previous match"
        title="Previous match"
        disabled={count === 0}
        onClick={go_prev}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Next match"
        title="Next match"
        disabled={count === 0}
        onClick={go_next}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        aria-label="Close search"
        title="Close search"
        onClick={close}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
