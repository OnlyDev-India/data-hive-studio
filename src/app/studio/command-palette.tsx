import { useEffect, useMemo, useRef, useState } from "react";
import {
  Code,
  History,
  House,
  Search,
  SquarePlus,
  Table2,
  Terminal,
} from "lucide-react";
import { Dialog, DialogContent } from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";

interface Command {
  id: string;
  label: string;
  hint?: string;
  /** Shown next to the label (connection / scope). */
  scope?: string;
  icon: React.ReactNode;
  run: () => void;
  /** Disabled commands still render but can't be run. */
  disabled?: boolean;
}

/** VS Code-style command palette, opened with Cmd/Ctrl+Shift+P. Commands are
 *  rebuilt from the live store each time the palette opens, so they reflect
 *  the current open connections, view, and active tab actions. */
export function CommandPalette() {
  const open = useStudioStore((s) => s.commandPaletteOpen);
  const setOpen = useStudioStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input_ref = useRef<HTMLInputElement>(null);

  useShortcuts([
    {
      key: "p",
      mod: true,
      shift: true,
      handler: () => setOpen(!useStudioStore.getState().commandPaletteOpen),
    },
  ]);

  // Reset the query + highlight whenever the palette opens.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line -- intentional reset on open
      setQuery("");
      setSelected(0);
      // Focus after the portal mounts.
      requestAnimationFrame(() => input_ref.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const s = useStudioStore.getState();
    const list: Command[] = [];

    const active_conn =
      s.open.length === 0
        ? null
        : (s.open.find((c) => c.id === s.activeId) ?? s.open[0]);
    const is_mongo = active_conn?.kind === "mongodb";
    const conn_scope = active_conn?.name;

    // Global view navigation
    list.push({
      id: "view.home",
      label: "Go to Home",
      hint: "Connection landing page",
      icon: <House className="size-4" />,
      run: () => s.setView("home"),
    });
    list.push({
      id: "conn.close",
      label: "Disconnect current connection",
      hint: "Close the active connection",
      icon: <Terminal className="size-4" />,
      disabled: !active_conn,
      run: () => {
        if (active_conn) void import("@/shared/api").then(({ closeConnection }) =>
          closeConnection(active_conn.id).then(() =>
            useStudioStore.getState().closeConn(active_conn.id),
          ),
        );
      },
    });

    // Connection-scoped commands
    if (active_conn) {
      if (!is_mongo) {
        list.push({
          id: "tab.new-sql",
          label: "New SQL editor",
          hint: "Open a blank query tab",
          scope: conn_scope,
          icon: <Code className="size-4" />,
          run: () => s.openSql(active_conn.id),
        });
        list.push({
          id: "tab.new-table",
          label: "New table",
          hint: "Design and create a table",
          scope: conn_scope,
          icon: <SquarePlus className="size-4" />,
          run: () => s.openNewTable(active_conn.id),
        });
      } else {
        list.push({
          id: "tab.mongo-console",
          label: "New NoSQL console",
          hint: "JSON find / aggregate / shell commands",
          scope: conn_scope,
          icon: <Terminal className="size-4" />,
          run: () => {
            void listDatabasesAndOpen(active_conn.id);
          },
        });
      }
      list.push({
        id: "sidebar.tables",
        label: "Browse tables",
        hint: "Show the tables sidebar",
        scope: conn_scope,
        icon: <Table2 className="size-4" />,
        run: () => {
          s.setActivityOpen(false);
          s.setSidebarOpen(true);
          s.setView("workspace");
        },
      });
      list.push({
        id: "panel.activity",
        label: "Activity",
        hint: "Backend command log",
        scope: conn_scope,
        icon: <History className="size-4" />,
        run: () => {
          s.setSidebarOpen(false);
          s.setActivityOpen(true);
          s.setView("workspace");
        },
      });
    }

    return list;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.hint ?? "").toLowerCase().includes(q) ||
        (c.scope ?? "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Keep the highlight within range as the list shrinks/grows.
  useEffect(() => {
    // eslint-disable-next-line -- intentional sync adjustment
    setSelected((sel) => Math.max(0, Math.min(sel, filtered.length - 1)));
  }, [filtered.length]);

  const runCommand = (cmd: Command | undefined) => {
    if (!cmd || cmd.disabled) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-xl"
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <Input
            ref={input_ref}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="scrollbar-thin max-h-[min(60vh,24rem)] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No matching commands
            </p>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
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
                  <span className="font-medium">{cmd.label}</span>
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
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Best-effort initial database context for a fresh Mongo console: reuse the
 *  connection's last-used db, else the first database on the server. */
async function listDatabasesAndOpen(connId: string) {
  const { listDatabases } = await import("@/shared/api");
  const s = useStudioStore.getState();
  let database = s.recentParams[connId]?.database ?? "";
  if (!database) {
    try {
      const dbs = await listDatabases(connId);
      database = dbs[0] ?? "";
    } catch {
      /* console still opens — `use <db>` sets context */
    }
  }
  s.openMongoConsole(connId, database);
}
