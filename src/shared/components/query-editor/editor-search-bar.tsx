import { useEffect, useRef, useState } from "react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  Search,
  X,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

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

/** Floating find/replace-in-editor overlay (Mod-F / `editor.search`) —
 *  replaces `@codemirror/search`'s own default panel with one that matches
 *  the rest of the app, same shape as `GridSearchBar` (the data grid's own
 *  find), plus a disclosure row for replace: live count, next/prev, case
 *  sensitive and regular expression toggles, replace one/all, Escape to
 *  close. The library's search STATE and match highlighting (`search()` in
 *  `index.tsx`'s extensions) still do the actual work — this only supplies a
 *  different front end for it, driving the same `setSearchQuery`/
 *  `findNext`/`findPrevious`/`replaceNext`/`replaceAll` a hand-written panel
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
  const [replaceText, setReplaceText] = useState("");
  // Persist across close/reopen (a mode the user set, not part of the
  // search text) — only the query text, replace text, and the disclosure
  // row reset on close, matching the existing reset-on-close behavior below.
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [{ count, active }, setMatchState] = useState({ count: 0, active: -1 });
  // Read in render (for the invalid-regex indicator below), so it lives in
  // state rather than the `query_ref`/`view` ref pair, which render must
  // never touch directly.
  const [queryValid, setQueryValid] = useState(true);
  const query_ref = useRef(new SearchQuery({ search: "" }));
  const input_ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input_ref.current?.focus();
  }, [open]);

  const dispatch_query = (q: SearchQuery) => {
    query_ref.current = q;
    setQueryValid(q.valid);
    const view = getView();
    if (!view) return;
    view.dispatch({ effects: setSearchQuery.of(q) });
    setMatchState(q.search ? countMatches(view, q) : { count: 0, active: -1 });
  };

  const build_query = (
    overrides: Partial<{
      search: string;
      caseSensitive: boolean;
      regexp: boolean;
      replace: string;
    }> = {},
  ) =>
    new SearchQuery({
      search: overrides.search ?? query,
      caseSensitive: overrides.caseSensitive ?? caseSensitive,
      regexp: overrides.regexp ?? useRegex,
      replace: overrides.replace ?? replaceText,
    });

  const apply_query = (text: string) => {
    setQuery(text);
    dispatch_query(build_query({ search: text }));
  };

  const apply_replace_text = (text: string) => {
    setReplaceText(text);
    dispatch_query(build_query({ replace: text }));
  };

  const toggle_case_sensitive = () => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    dispatch_query(build_query({ caseSensitive: next }));
  };

  const toggle_regex = () => {
    const next = !useRegex;
    setUseRegex(next);
    dispatch_query(build_query({ regexp: next }));
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
  const do_replace = () => {
    const view = getView();
    if (!view || !query || count === 0) return;
    replaceNext(view);
    refresh_position();
  };
  const do_replace_all = () => {
    const view = getView();
    if (!view || !query || count === 0) return;
    replaceAll(view);
    refresh_position();
  };
  const close = () => {
    onOpenChange(false);
    const view = getView();
    view?.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
    setQuery("");
    setReplaceText("");
    setShowReplace(false);
    setMatchState({ count: 0, active: -1 });
    view?.focus();
  };

  if (!open) return null;

  const query_invalid = useRegex && query !== "" && !queryValid;

  return (
    <div className="bg-popover absolute top-2 right-2 z-30 flex flex-col gap-1 rounded-md border p-1 shadow-md">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconXs"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          title={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          aria-controls="editor-search-replace-row"
          onClick={() => setShowReplace((v) => !v)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              showReplace && "rotate-90",
            )}
          />
        </Button>
        <Search className="text-muted-foreground size-3.5 shrink-0" />
        <Input
          ref={input_ref}
          value={query}
          onChange={(e) => apply_query(e.target.value)}
          placeholder="Find in editor…"
          aria-label="Find"
          aria-invalid={query_invalid}
          className={cn(
            "bg-muted h-6 w-40 border-none text-xs shadow-none focus-visible:ring-0",
            query_invalid && "text-destructive",
          )}
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
        <Button
          variant={caseSensitive ? "secondary" : "ghost"}
          size="iconXs"
          aria-label="Match case"
          title="Match case"
          aria-pressed={caseSensitive}
          className={caseSensitive ? "text-info hover:bg-info/15" : undefined}
          onClick={toggle_case_sensitive}
        >
          <CaseSensitive className="size-3.5" />
        </Button>
        <Button
          variant={useRegex ? "secondary" : "ghost"}
          size="iconXs"
          aria-label="Use regular expression"
          title="Use regular expression"
          aria-pressed={useRegex}
          className={useRegex ? "text-info hover:bg-info/15" : undefined}
          onClick={toggle_regex}
        >
          <Regex className="size-3.5" />
        </Button>
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
      {showReplace && (
        <div id="editor-search-replace-row" className="flex items-center gap-1">
          <span className="size-6 shrink-0" />
          <Replace className="text-muted-foreground size-3.5 shrink-0" />
          <Input
            value={replaceText}
            onChange={(e) => apply_replace_text(e.target.value)}
            placeholder="Replace…"
            aria-label="Replace with"
            className="bg-muted h-6 w-40 border-none text-xs shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                do_replace();
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            title="Replace the current match"
            disabled={count === 0}
            onClick={do_replace}
          >
            <Replace className="size-3.5" />
            Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            title="Replace every match"
            disabled={count === 0}
            onClick={do_replace_all}
          >
            <ReplaceAll className="size-3.5" />
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
