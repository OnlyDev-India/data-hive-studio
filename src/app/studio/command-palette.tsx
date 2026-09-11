import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useActiveConnection, useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";
import { useTheme } from "@/shared/theme/theme";
import {
  buildCommandItems,
  buildConnectionItems,
  buildDisconnectItems,
  buildFilterHints,
  buildOpenTabItems,
  buildSchemaOpenItems,
  buildTableItems,
  fetchSiblingTables,
  labelForMode,
  modeNeedsTables,
  resolveMode,
  tableMatches,
  type PaletteItem,
  type PaletteMode,
  type PaletteTable,
} from "./command-palette-items";
import { listTables, type TableInfo } from "@/shared/api";
import { Button } from "@/shared/components/ui";

/** Wrap the first case-insensitive occurrence of `query` in `text` with a
 *  highlighted TEXT (color, not a background block) — shows exactly what
 *  matched, like a find-in-page hit. No match (or empty query) returns the
 *  text untouched. */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent font-semibold text-primary">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** VS Code-style palette, opened with Cmd/Ctrl+P (quick-open) or Cmd/Ctrl+Shift+P
 *  (opens straight into the app-command list). With no prefix typed, quick-open
 *  shows only the discoverable filter-hint chips (`table:`, `conn:`, `tab:`, …)
 *  — jumping to a table/collection, tab, or connection needs its own prefix, so
 *  results are always unambiguous about which connection/schema they belong to
 *  (see `modeNeedsTables`). A recognized prefix (`>` for
 *  commands, `schema:` to open a table/collection's Schema view instead of
 *  Data, `table:`/`conn:`/`tab:` to narrow quick-open to just one of its
 *  three sections) is plain text right up until it's fully typed — at that
 *  point it "snaps" into a highlighted chip in the input (see the input's
 *  onChange), and Backspace with the cursor right after it removes the whole
 *  chip in one press instead of peeling it off character by character (see
 *  onKeyDown). Items are rebuilt from the live store every time the palette
 *  opens (and as the fetched table list arrives), so they always reflect the
 *  current open connections/tabs. */
export function CommandPalette() {
  const open = useStudioStore((s) => s.commandPaletteOpen);
  const setOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // A recognized prefix (`>`, `schema:`, ...), once fully typed/selected,
  // renders as a highlighted chip instead of plain text in the input — see
  // the input's onChange for the "snap into a chip" logic and onKeyDown for
  // "Backspace at the start removes the whole chip in one press".
  const [chip, setChip] = useState<{ mode: PaletteMode; label: string } | null>(
    null,
  );
  const [initialChip, setInitialChip] = useState<PaletteMode | null>(null);
  // Bumped when a filter-hint fill (e.g. clicking "schema:") should return
  // focus to the input — a plain ref read has to happen inside an effect,
  // not the click handler itself, so this just signals that effect to run.
  const [refocusSignal, setRefocusSignal] = useState(0);
  const input_ref = useRef<HTMLInputElement>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  // Scrolling the list (the arrow-key scroll-into-view effect further down)
  // shifts rows under a cursor that never
  // actually moved — the browser still fires a real `mouseenter` for
  // whatever row ends up under it, and a plain `onMouseEnter={() =>
  // setSelected(i)}` obeys it, silently overwriting the keyboard selection
  // you just made. Only trust a mouseenter whose coordinates differ from
  // the last one we reacted to — that's the signature of an actual cursor
  // move, not content sliding underneath a stationary pointer.
  const last_hover_pos = useRef({ x: -1, y: -1 });
  // One stable handler (reading the row's index off the DOM instead of
  // closing over it per-row) rather than a fresh `(e) => ...` per list item
  // every render — required for the ref read above to be safe outside
  // render at all.
  const on_row_mouse_enter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { x, y } = last_hover_pos.current;
    last_hover_pos.current = { x: e.clientX, y: e.clientY };
    if (e.clientX === x && e.clientY === y) return;
    const idx = Number(e.currentTarget.dataset.index);
    if (Number.isFinite(idx)) setSelected(idx);
  }, []);
  const theme = useTheme();

  const paletteKeywords = useStudioStore((s) => s.paletteKeywords);

  useShortcuts([
    {
      key: "p",
      mod: true,
      shift: true,
      handler: () => {
        setInitialChip("commands");
        setOpen(!useStudioStore.getState().commandPaletteOpen);
      },
    },
    {
      key: "p",
      mod: true,
      handler: () => {
        setInitialChip(null);
        setOpen(!useStudioStore.getState().commandPaletteOpen);
      },
    },
  ]);

  // Reset the query/chip/highlight whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setChip(
        initialChip
          ? {
              mode: initialChip,
              label: labelForMode(initialChip, paletteKeywords),
            }
          : null,
      );
      setSelected(0);
      // Focus after the portal mounts.
      requestAnimationFrame(() => input_ref.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on open, not every initialChip change
  }, [open]);

  // Refocus the input after a filter-hint fill (see `refocusSignal` above) —
  // a click on the suggestion button would otherwise leave it focused.
  useEffect(() => {
    if (refocusSignal === 0) return;
    requestAnimationFrame(() => input_ref.current?.focus());
  }, [refocusSignal]);

  // Once a chip is showing, it alone determines the mode — the input's
  // `query` is purely the free-text search from that point on, no longer
  // re-parsed for prefixes (a literal ":" typed after the chip is just text).
  const { mode, rest } = useMemo(() => {
    if (chip) return { mode: chip.mode, rest: query };
    return resolveMode(query, paletteKeywords);
  }, [chip, query, paletteKeywords]);

  const active_conn_id = useStudioStore((s) => {
    if (s.open.length === 0) return null;
    return (s.open.find((c) => c.id === s.activeId) ?? s.open[0]).id;
  });
  const is_mongo = useActiveConnection()?.kind === "mongodb";

  // Table/collection list for the modes that need it — the connection's OWN
  // database is fetched eagerly, once per palette-open (not per keystroke).
  // Sibling databases are deliberately NOT fetched here — only once a typed
  // search comes up empty against the own database (see the effect below) —
  // so a connection with several sibling databases doesn't pay for that on
  // every palette open, only when the answer would otherwise be "not found."
  const want_tables = open && modeNeedsTables(mode) && !!active_conn_id;
  const load_key = want_tables ? active_conn_id : null;
  const [own_tables, setOwnTables] = useState<TableInfo[] | null>(null);
  const [own_loaded_for, setOwnLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!load_key) return;
    let cancelled = false;
    void listTables(load_key)
      .then((t) => {
        if (!cancelled) setOwnTables(t);
      })
      .catch(() => {
        if (!cancelled) setOwnTables([]);
      })
      .finally(() => {
        if (!cancelled) setOwnLoadedFor(load_key);
      });
    return () => {
      cancelled = true;
    };
  }, [load_key]);
  const own_ready = !want_tables || own_loaded_for === load_key;

  // Siblings: fetched lazily, once, the first time a typed query comes up
  // empty against `own_tables` — reset whenever the target connection
  // changes so a stale sibling list never survives a switch.
  const q = rest.trim().toLowerCase();
  const own_has_match = !q || (own_tables ?? []).some((t) => tableMatches(t, q));
  const need_siblings = want_tables && own_ready && !!q && !own_has_match;
  const [siblings, setSiblings] = useState<PaletteTable[] | null>(null);
  const [siblings_for, setSiblingsFor] = useState<string | null>(null);
  useEffect(() => {
    setSiblings(null);
    setSiblingsFor(null);
  }, [load_key]);
  useEffect(() => {
    if (!load_key || !need_siblings || siblings_for === load_key) return;
    let cancelled = false;
    setSiblingsFor(load_key);
    void fetchSiblingTables(load_key, is_mongo)
      .then((t) => {
        if (!cancelled) setSiblings(t);
      })
      .catch(() => {
        if (!cancelled) setSiblings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load_key, need_siblings, siblings_for, is_mongo]);

  // Empty query or a match in the own database → own results only (never
  // mixed with siblings). A typed query with nothing local → fall back to
  // whatever sibling search has found so far (empty/loading until it lands).
  const tables = useMemo<PaletteTable[] | null>(
    () => (!q || own_has_match ? own_tables : (siblings ?? [])),
    [q, own_has_match, own_tables, siblings],
  );
  const tablesLoading = want_tables && (!own_ready || (need_siblings && !siblings));

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    switch (mode) {
      case "commands":
        return buildCommandItems({ mode: theme.mode, setMode: theme.setMode });
      case "schema-open":
        return buildSchemaOpenItems(tables, tablesLoading, rest);
      case "tables-only":
        return buildTableItems(tables, tablesLoading, rest);
      case "connections-only":
        return buildConnectionItems();
      case "tabs-only":
        return buildOpenTabItems();
      case "disconnect-only":
        return buildDisconnectItems();
      case "quick-open":
        // No prefix typed yet — with several connections/schemas open,
        // eagerly mixing in tables/tabs/connections was either the wrong
        // connection's tables or a stale schema (see `modeNeedsTables`).
        // Each section is now reachable ONLY via its own prefix; the
        // unprefixed default just surfaces those prefixes as suggestions.
        return buildFilterHints(paletteKeywords);
    }
  }, [
    open,
    mode,
    rest,
    tables,
    tablesLoading,
    theme.mode,
    theme.setMode,
    paletteKeywords,
  ]);

  const filtered = useMemo(() => {
    const q = rest.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.hint ?? "").toLowerCase().includes(q) ||
        (c.scope ?? "").toLowerCase().includes(q),
    );
  }, [items, rest]);

  // Keep the highlight within range as the list shrinks/grows.
  useEffect(() => {
    setSelected((sel) => Math.max(0, Math.min(sel, filtered.length - 1)));
  }, [filtered.length]);

  // Flatten `filtered` (grouped by section) into one array the virtualizer
  // can index — a section header is its own row, interleaved with item rows.
  // `item_row_of[i]` maps a `filtered` index to its row index, so keyboard
  // navigation can scroll to a row that may not even be mounted yet.
  const { rows, item_row_of } = useMemo(() => {
    const rows: (
      | { type: "header"; label: string }
      | { type: "item"; cmd: PaletteItem; index: number }
    )[] = [];
    const item_row_of: number[] = [];
    let last_section: string | undefined;
    filtered.forEach((cmd, i) => {
      if (cmd.section !== last_section) {
        last_section = cmd.section;
        if (cmd.section) rows.push({ type: "header", label: cmd.section });
      }
      item_row_of[i] = rows.length;
      rows.push({ type: "item", cmd, index: i });
    });
    return { rows, item_row_of };
  }, [filtered]);

  // Options are memoized so tanstack never sees a brand-new options object on
  // every render — see the same pattern (and its comment) in grid-controller.ts.
  const virtualizer_options = useMemo(
    () => ({
      count: rows.length,
      getScrollElement: () => list_ref.current,
      estimateSize: (i: number) => (rows[i]?.type === "header" ? 28 : 32),
      overscan: 10,
    }),
    [rows],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer instance is stable; the rule can't see that
  const row_virtualizer = useVirtualizer(virtualizer_options);

  // The virtualizer's first measurement, on mount, can catch the Dialog's
  // content mid-open-animation (still `display: none`/zero-size before Base
  // UI flips it visible for the transition to register) — same class of bug
  // grid-controller.ts's `on_screen` reveal handling exists for. Without
  // this, the list renders empty until SOME OTHER state change (e.g.
  // typing) happens to trigger a remeasure. One explicit remeasure right
  // after the dialog opens is enough — the list's own content changes
  // (`rows.length` in `virtualizer_options`) keep it correct after that.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => row_virtualizer.measure());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row_virtualizer's methods are stable; only `open` should retrigger this
  }, [open]);

  // Arrow keys move `selected` but never touch the DOM directly, so without
  // this the highlighted row can march straight off the visible (scrolled)
  // area — the selection changes, nothing visibly does. A plain DOM
  // `scrollIntoView` doesn't work once the list is virtualized (the target
  // row may not even be mounted) — `scrollToIndex` is virtualizer-aware.
  useEffect(() => {
    const row_idx = item_row_of[selected];
    if (row_idx !== undefined) row_virtualizer.scrollToIndex(row_idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row_virtualizer's methods are stable; only `selected`/content should retrigger this
  }, [selected, item_row_of]);

  const runCommand = (cmd: PaletteItem | undefined) => {
    if (!cmd || cmd.disabled) return;
    if (cmd.fillQuery !== undefined) {
      // Filter-hint items ARE a full prefix — snap straight to a chip
      // instead of leaving the raw prefix text sitting in the input.
      const resolved = resolveMode(cmd.fillQuery, paletteKeywords);
      setChip(
        resolved.mode === "quick-open"
          ? null
          : {
              mode: resolved.mode,
              label: labelForMode(resolved.mode, paletteKeywords),
            },
      );
      setQuery("");
      setSelected(0);
      setRefocusSignal((n) => n + 1);
      return;
    }
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (i + 1) % Math.max(filtered.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(
        (i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(filtered[selected]);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (
      e.key === "Backspace" &&
      chip &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      // Cursor is right after the chip with nothing selected — one press
      // removes the whole prefix instead of doing nothing (there's no text
      // there to delete character-by-character).
      e.preventDefault();
      setChip(null);
      setSelected(0);
    }
  };

  const placeholder = (() => {
    switch (mode) {
      case "commands":
        return "Type a command…";
      case "schema-open":
        return "Open a table/collection's schema…";
      case "tables-only":
        return "Search tables/collections…";
      case "connections-only":
        return "Search open connections…";
      case "tabs-only":
        return "Search open tabs…";
      case "disconnect-only":
        return "Disconnect a connection…";
      case "quick-open":
        return `Type a prefix — ${paletteKeywords.table} ${paletteKeywords.conn} ${paletteKeywords.tab} ${paletteKeywords.schema} >…`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          {chip && (
            <Badge variant="secondary" className="shrink-0 font-mono">
              {chip.label}
            </Badge>
          )}
          <Input
            ref={input_ref}
            value={query}
            onChange={(e) => {
              const raw = e.target.value;
              if (!chip) {
                // A full prefix was just typed out — snap it into a chip
                // instead of leaving it as plain highlighted-nowhere text.
                const resolved = resolveMode(raw, paletteKeywords);
                if (resolved.mode !== "quick-open") {
                  setChip({
                    mode: resolved.mode,
                    label: labelForMode(resolved.mode, paletteKeywords),
                  });
                  setQuery(resolved.rest);
                  setSelected(0);
                  return;
                }
              }
              setQuery(raw);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="my-1 border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div
          ref={list_ref}
          className="max-h-[min(60vh,24rem)] scrollbar-thin overflow-y-auto p-1.5"
        >
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {mode !== "commands" && !active_conn_id
                ? "Open a connection to browse tables and tabs."
                : (mode === "tables-only" || mode === "schema-open") &&
                    rest.trim() &&
                    !tablesLoading
                  ? `Not found: "${rest.trim()}"`
                  : "No matching results"}
            </p>
          ) : (
            // Only the rows tanstack reports as in (or near) the visible
            // window are mounted — absolutely positioned at their computed
            // offset inside a spacer sized to the FULL list's height, so the
            // scrollbar still reflects every row even though most never
            // touch the DOM.
            <div
              style={{ height: row_virtualizer.getTotalSize(), position: "relative" }}
            >
              {row_virtualizer.getVirtualItems().map((v) => {
                const row = rows[v.index];
                const row_style: React.CSSProperties = {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                };
                if (row.type === "header") {
                  return (
                    <div
                      key={v.key}
                      style={row_style}
                      className="text-muted-foreground text-3xs flex items-end px-2.5 pb-1 font-medium tracking-wide uppercase"
                    >
                      {row.label}
                    </div>
                  );
                }
                const { cmd, index: i } = row;
                return (
                  <Button
                    key={v.key}
                    variant={"ghost"}
                    data-index={i}
                    disabled={cmd.disabled}
                    onClick={() => runCommand(cmd)}
                    onMouseEnter={on_row_mouse_enter}
                    style={row_style}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2.5 py-1 text-left text-sm",
                      i === selected ? "bg-primary/10 text-primary" : "text-foreground",
                      cmd.disabled && "opacity-40",
                    )}
                  >
                    <span className="text-muted-foreground shrink-0">
                      {cmd.icon}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-medium">
                        {highlightMatch(cmd.label, rest.trim())}
                      </span>
                      {cmd.hint && (
                        <span className="text-muted-foreground truncate text-xs">
                          {cmd.hint}
                        </span>
                      )}
                    </span>
                    {cmd.scope && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {cmd.scope}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
