import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";
import { useTheme } from "@/shared/theme/theme";
import { listTables, type TableInfo } from "@/shared/api";
import {
  buildCommandItems,
  buildConnectionItems,
  buildDisconnectItems,
  buildOpenTabItems,
  buildQuickOpenItems,
  buildSchemaOpenItems,
  buildTableItems,
  labelForMode,
  modeNeedsTables,
  resolveMode,
  type PaletteItem,
  type PaletteMode,
} from "./command-palette-items";

/** Wrap the first case-insensitive occurrence of `query` in `text` with a
 *  highlighted background — shows exactly what matched, like a find-in-page
 *  hit. No match (or empty query) returns the text untouched. */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-yellow-300/40 text-inherit dark:bg-yellow-300/25">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** VS Code-style palette, opened with Cmd/Ctrl+P (quick-open: jump to an open
 *  tab, a table/collection, or another open connection) or Cmd/Ctrl+Shift+P
 *  (opens straight into the app-command list). A recognized prefix (`>` for
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
      // eslint-disable-next-line -- intentional reset on open
      setQuery("");
      setChip(
        initialChip
          ? { mode: initialChip, label: labelForMode(initialChip, paletteKeywords) }
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

  // Table/collection list for the modes that need it — fetched once per
  // palette-open (not per keystroke); `listTables` is already deduped
  // against the sidebar's own fetch for the same connection. `loadedFor`
  // (vs. the key the current render actually wants) derives the loading
  // flag instead of toggling a separate boolean synchronously in the effect.
  const want_tables = open && modeNeedsTables(mode) && !!active_conn_id;
  const load_key = want_tables ? active_conn_id : null;
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const tablesLoading = want_tables && loadedFor !== load_key;
  useEffect(() => {
    if (!load_key) return;
    let cancelled = false;
    void listTables(load_key)
      .then((t) => {
        if (!cancelled) setTables(t);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(load_key);
      });
    return () => {
      cancelled = true;
    };
  }, [load_key]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    switch (mode) {
      case "commands":
        return buildCommandItems({ toggle: theme.toggle, dark: theme.dark });
      case "schema-open":
        return buildSchemaOpenItems(tables, tablesLoading);
      case "tables-only":
        return buildTableItems(tables, tablesLoading);
      case "connections-only":
        return buildConnectionItems();
      case "tabs-only":
        return buildOpenTabItems();
      case "disconnect-only":
        return buildDisconnectItems();
      case "quick-open":
        return buildQuickOpenItems(tables, tablesLoading, paletteKeywords);
    }
  }, [open, mode, tables, tablesLoading, theme.toggle, theme.dark, paletteKeywords]);

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
    // eslint-disable-next-line -- intentional sync adjustment
    setSelected((sel) => Math.max(0, Math.min(sel, filtered.length - 1)));
  }, [filtered.length]);

  const runCommand = (cmd: PaletteItem | undefined) => {
    if (!cmd || cmd.disabled) return;
    if (cmd.fillQuery !== undefined) {
      // Filter-hint items ARE a full prefix — snap straight to a chip
      // instead of leaving the raw prefix text sitting in the input.
      const resolved = resolveMode(cmd.fillQuery, paletteKeywords);
      setChip(
        resolved.mode === "quick-open"
          ? null
          : { mode: resolved.mode, label: labelForMode(resolved.mode, paletteKeywords) },
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
      setSelected((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
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
        return "Search tabs, tables, connections…";
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-xl"
      >
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
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="scrollbar-thin max-h-[min(60vh,24rem)] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {mode !== "commands" && !active_conn_id
                ? "Open a connection to browse tables and tabs."
                : "No matching results"}
            </p>
          ) : (
            (() => {
              let last_section: string | undefined;
              return filtered.map((cmd, i) => {
                const show_header = cmd.section !== last_section;
                last_section = cmd.section;
                return (
                  <div key={cmd.id}>
                    {show_header && cmd.section && (
                      <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide uppercase">
                        {cmd.section}
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={cmd.disabled}
                      onClick={() => runCommand(cmd)}
                      onMouseEnter={() => setSelected(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm",
                        i === selected
                          ? "bg-primary/10 text-primary"
                          : "text-foreground",
                        cmd.disabled && "opacity-40",
                      )}
                    >
                      <span className="text-muted-foreground shrink-0">
                        {cmd.icon}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
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
                    </button>
                  </div>
                );
              });
            })()
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
