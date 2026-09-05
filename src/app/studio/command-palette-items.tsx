import type { ReactNode } from "react";
import {
  Code,
  History,
  House,
  Moon,
  Plug,
  SlidersHorizontal,
  SquarePlus,
  Sun,
  Table2,
  Terminal,
  Unplug,
} from "lucide-react";
import {
  findOwnerLeaf,
  tabKey,
  tabLabel,
  useStudioStore,
  type PaletteKeywords,
} from "@/shared/store";
import { TabTypeIcon } from "@/shared/components/tab-type-icon";
import { DBIcons } from "@/shared/components/icons/types";
import type { TableInfo } from "@/shared/api";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  /** Shown next to the label (connection / scope). */
  scope?: string;
  /** Groups items under a header in quick-open/schema-open mode. Items
   *  without a section (commands mode) render as one flat list, matching
   *  the palette's original behavior. */
  section?: string;
  icon: ReactNode;
  run: () => void;
  /** Disabled items still render but can't be run. */
  disabled?: boolean;
  /** Filter-hint items (e.g. `schema:`) don't run/close the palette on
   *  select — they fill the query with this text instead, so the user can
   *  keep typing the rest (name/search) within that mode. */
  fillQuery?: string;
}

export type PaletteMode =
  | "commands"
  | "schema-open"
  | "quick-open"
  | "tables-only"
  | "connections-only"
  | "tabs-only"
  | "disconnect-only";

/** Every one of these (`>` included) is plain query text, not a separate UI
 *  state — typing/deleting a prefix switches mode live, and `rest` (the text
 *  after it) is what filters that mode's item list. The other five are
 *  user-customizable (Settings → Command Palette); `>` never is. */
export function resolveMode(
  query: string,
  keywords: PaletteKeywords,
): { mode: PaletteMode; rest: string } {
  if (query.startsWith(">")) {
    return { mode: "commands", rest: query.slice(1).trimStart() };
  }
  // `?? ""` guards against a stale persisted keyword set missing a key that
  // was added after it was saved — see `merge` in store.ts for the actual
  // fix; this is defense in depth so a gap here can never crash `.sort()`.
  const checks: [string, PaletteMode][] = [
    [keywords.schema ?? "", "schema-open"],
    [keywords.table ?? "", "tables-only"],
    [keywords.conn ?? "", "connections-only"],
    [keywords.tab ?? "", "tabs-only"],
    [keywords.diss ?? "", "disconnect-only"],
  ];
  // Longest keyword first, so a short custom keyword can't shadow a longer
  // one it happens to start with (e.g. table: "t" vs conn: "tc").
  checks.sort((a, b) => b[0].length - a[0].length);
  const q_lower = query.toLowerCase();
  for (const [prefix, mode] of checks) {
    if (prefix && q_lower.startsWith(prefix.toLowerCase())) {
      return { mode, rest: query.slice(prefix.length).trimStart() };
    }
  }
  return { mode: "quick-open", rest: query };
}

/** Whether a mode's item list depends on the fetched table/collection list —
 *  drives whether the palette bothers fetching at all. */
export function modeNeedsTables(mode: PaletteMode): boolean {
  return mode === "quick-open" || mode === "schema-open" || mode === "tables-only";
}

/** The trigger text a mode's chip shows once fully typed/selected — the
 *  inverse of `resolveMode`'s prefix matching. */
export function labelForMode(mode: PaletteMode, keywords: PaletteKeywords): string {
  switch (mode) {
    case "commands":
      return ">";
    case "schema-open":
      return keywords.schema ?? "";
    case "tables-only":
      return keywords.table ?? "";
    case "connections-only":
      return keywords.conn ?? "";
    case "tabs-only":
      return keywords.tab ?? "";
    case "disconnect-only":
      return keywords.diss ?? "";
    case "quick-open":
      return "";
  }
}

/** The active connection (falls back to the first open one), or null with
 *  nothing open — also used by the native menu bar's action handler
 *  (`app/studio/native-menu.ts`) to resolve what "current connection"
 *  means for its File/Connection items. */
export function activeConn() {
  const s = useStudioStore.getState();
  return s.open.length === 0
    ? null
    : (s.open.find((c) => c.id === s.activeId) ?? s.open[0]);
}

/** Best-effort initial database context for a fresh Mongo console/collection
 *  tab: reuse the connection's last-used db, else the first database on the
 *  server. Mirrors the same fallback the console entry point already used. */
export async function resolveMongoDatabase(connId: string): Promise<string> {
  const s = useStudioStore.getState();
  let database = s.recentParams[connId]?.database ?? "";
  if (!database) {
    try {
      const { listDatabases } = await import("@/shared/api");
      const dbs = await listDatabases(connId);
      database = dbs[0] ?? "";
    } catch {
      /* console/collection still opens — `use <db>` sets context */
    }
  }
  return database;
}

export async function openMongoDatabaseAndConsole(
  connId: string,
  seedText?: string,
  seedFileName?: string,
) {
  const database = await resolveMongoDatabase(connId);
  useStudioStore
    .getState()
    .openMongoConsole(connId, database, seedText, seedFileName);
}

async function openMongoCollection(connId: string, name: string) {
  const database = await resolveMongoDatabase(connId);
  useStudioStore.getState().openMongo(connId, database, name);
}

async function openMongoCollectionSchema(connId: string, name: string) {
  await openMongoCollection(connId, name);
  const s = useStudioStore.getState();
  const tab = s.workspaces[connId]?.active;
  if (tab) s.setPaneMode(connId, tabKey(tab), "schema");
}

/** `>` mode — the app-level command list (unchanged behavior/commands),
 *  plus a theme toggle. */
export function buildCommandItems(theme: {
  toggle: () => void;
  dark: boolean;
}): PaletteItem[] {
  const s = useStudioStore.getState();
  const list: PaletteItem[] = [];

  const active_conn = activeConn();
  const is_mongo = active_conn?.kind === "mongodb";
  const conn_scope = active_conn?.name;

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
      if (active_conn) s.setDisconnectPendingId(active_conn.id);
    },
  });

  if (active_conn) {
    // SQL editor stays available for Mongo too (SQL-on-Mongo translation) —
    // only "Create table" (no DDL-table concept in Mongo) and "New NoSQL
    // console" (meaningless for a SQL database) are kind-exclusive.
    list.push({
      id: "tab.new-sql",
      label: "New SQL editor",
      hint: "Open a blank query tab",
      scope: conn_scope,
      icon: <Code className="size-4" />,
      run: () => s.openSql(active_conn.id),
    });
    if (!is_mongo) {
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
          void openMongoDatabaseAndConsole(active_conn.id);
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
        s.openLeftPanel("tables");
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
        s.openLeftPanel("activity");
        s.setView("workspace");
      },
    });
  }

  list.push({
    id: "theme.toggle",
    label: "Toggle dark/light mode",
    hint: theme.dark ? "Switch to light theme" : "Switch to dark theme",
    icon: theme.dark ? (
      <Sun className="size-4" />
    ) : (
      <Moon className="size-4" />
    ),
    run: theme.toggle,
  });

  return list;
}

/** `tab:` prefix mode (and a section of default quick-open) — jump to an
 *  already-open tab in the active connection's workspace. */
export function buildOpenTabItems(): PaletteItem[] {
  const s = useStudioStore.getState();
  const active_conn = activeConn();
  if (!active_conn) return [];
  const ws = s.workspaces[active_conn.id];
  return (ws?.tabs ?? []).map((tab) => {
    const key = tabKey(tab);
    return {
      id: `tab:${key}`,
      label: tabLabel(tab, s.seedFileNames[key]),
      section: "Open tabs",
      icon: <TabTypeIcon tab={tab} className="size-4" />,
      run: () => {
        const cur = useStudioStore.getState().workspaces[active_conn.id];
        const owner = cur && findOwnerLeaf(cur.layout, key);
        if (owner) s.selectTab(active_conn.id, owner.id, tab);
      },
    };
  });
}

/** `table:` prefix mode (and a section of default quick-open) — open a
 *  table/collection's Data view. */
export function buildTableItems(
  tables: TableInfo[] | null,
  tables_loading: boolean,
): PaletteItem[] {
  const s = useStudioStore.getState();
  const active_conn = activeConn();
  if (!active_conn) return [];
  const is_mongo = active_conn.kind === "mongodb";
  const noun = is_mongo ? "Collections" : "Tables";

  if (tables_loading) {
    return [
      {
        id: "tables:loading",
        label: `Loading ${noun.toLowerCase()}…`,
        section: noun,
        icon: <Table2 className="size-4" />,
        disabled: true,
        run: () => {},
      },
    ];
  }
  return (tables ?? []).slice(0, 100).map((t) => ({
    id: `table:${t.name}`,
    label: t.name,
    hint: t.kind,
    section: noun,
    icon: <Table2 className="size-4" />,
    run: () => {
      if (is_mongo) void openMongoCollection(active_conn.id, t.name);
      else s.openTable(active_conn.id, t.name);
    },
  }));
}

/** `conn:` prefix mode (and a section of default quick-open) — switch to
 *  another currently-open connection. */
export function buildConnectionItems(): PaletteItem[] {
  const s = useStudioStore.getState();
  const active_conn = activeConn();
  return s.open
    .filter((c) => c.id !== active_conn?.id)
    .map((c) => {
      const Icon = DBIcons[c.kind];
      return {
        id: `conn:${c.id}`,
        label: c.name,
        hint: c.kind,
        section: "Connections",
        icon: Icon ? <Icon className="size-4" /> : <Plug className="size-4" />,
        run: () => {
          s.setActive(c.id);
          s.setView("workspace");
        },
      };
    });
}

/** `diss:` prefix mode — disconnect any currently-open connection (not just
 *  the active one, unlike the `>` "Disconnect current connection" command). */
export function buildDisconnectItems(): PaletteItem[] {
  const s = useStudioStore.getState();
  return s.open.map((c) => {
    const Icon = DBIcons[c.kind];
    return {
      id: `diss:${c.id}`,
      label: c.name,
      hint: `Disconnect this ${c.kind} connection`,
      icon: Icon ? <Icon className="size-4" /> : <Unplug className="size-4" />,
      run: () => {
        useStudioStore.getState().setDisconnectPendingId(c.id);
      },
    };
  });
}

/** The palette's prefix keywords, surfaced as selectable suggestions so
 *  they're discoverable without already knowing the syntax — picking one
 *  fills the query with that prefix (via `fillQuery`) instead of running
 *  anything, so the user can keep typing the rest right after it. */
export function buildFilterHints(keywords: PaletteKeywords): PaletteItem[] {
  const hints: { prefix: string; fill: string; hint: string }[] = [
    { prefix: ">", fill: "> ", hint: "Run an app command" },
    {
      prefix: keywords.schema,
      fill: keywords.schema,
      hint: "Open a table/collection's schema view",
    },
    {
      prefix: keywords.table,
      fill: keywords.table,
      hint: "Search tables/collections only",
    },
    {
      prefix: keywords.conn,
      fill: keywords.conn,
      hint: "Search open connections only",
    },
    { prefix: keywords.tab, fill: keywords.tab, hint: "Search open tabs only" },
    {
      prefix: keywords.diss,
      fill: keywords.diss,
      hint: "Disconnect an open connection",
    },
  ];
  return hints
    .filter((h) => h.prefix.trim().length > 0)
    .map((h) => ({
      id: `hint:${h.prefix}`,
      label: h.prefix,
      hint: h.hint,
      section: "Filters",
      icon: <SlidersHorizontal className="size-4" />,
      fillQuery: h.fill,
      run: () => {},
    }));
}

/** Default (no prefix) mode — the three browsing sections plus the
 *  discoverable filter hints, combined. `diss:`'s disconnect ACTIONS are
 *  deliberately not mixed in here (only reachable via its own prefix) — a
 *  destructive action has no business sitting in the default browse list. */
export function buildQuickOpenItems(
  tables: TableInfo[] | null,
  tables_loading: boolean,
  keywords: PaletteKeywords,
): PaletteItem[] {
  return [
    ...buildOpenTabItems(),
    ...buildTableItems(tables, tables_loading),
    ...buildConnectionItems(),
    ...buildFilterHints(keywords),
  ];
}

/** `schema:` prefix mode — same table/collection list as quick-open, but
 *  every result opens in its Schema view instead of its Data view. */
export function buildSchemaOpenItems(
  tables: TableInfo[] | null,
  tables_loading: boolean,
): PaletteItem[] {
  const active_conn = activeConn();
  if (!active_conn) return [];
  const is_mongo = active_conn.kind === "mongodb";
  const noun = is_mongo ? "collections" : "tables";

  if (tables_loading) {
    return [
      {
        id: "schema:loading",
        label: `Loading ${noun}…`,
        icon: <Table2 className="size-4" />,
        disabled: true,
        run: () => {},
      },
    ];
  }

  const s = useStudioStore.getState();
  return (tables ?? []).slice(0, 100).map((t) => ({
    id: `schema:${t.name}`,
    label: t.name,
    hint: `Open ${is_mongo ? "collection" : "table"} schema`,
    icon: <Table2 className="size-4" />,
    run: () => {
      if (is_mongo) void openMongoCollectionSchema(active_conn.id, t.name);
      else s.openStructure(active_conn.id, t.name);
    },
  }));
}
