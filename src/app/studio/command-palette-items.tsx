import type { ReactNode } from "react";
import {
  Code,
  History,
  House,
  Monitor,
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
import type { ThemeMode } from "@/shared/theme/theme";
import { listDatabases, listSchemaObjects, type TableInfo } from "@/shared/api";
import { DBIcons, IconTypeMap } from "@/shared/components/icons/types";

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
 *  drives whether the palette bothers fetching at all. Deliberately excludes
 *  "quick-open" (no prefix): with several connections/schemas open, a table
 *  list mixed into the unscoped default was either the wrong connection's
 *  tables or last-active-schema-only — a table now only appears once the
 *  user types its own prefix, which is unambiguous about which connection/
 *  schema it's listing. */
export function modeNeedsTables(mode: PaletteMode): boolean {
  return mode === "schema-open" || mode === "tables-only";
}

/** The trigger text a mode's chip shows once fully typed/selected — the
 *  inverse of `resolveMode`'s prefix matching. */
export function labelForMode(
  mode: PaletteMode,
  keywords: PaletteKeywords,
): string {
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

/** `database`, when given, opens exactly that database (a sibling database
 *  found via `fetchAllTables` below) instead of falling back to the
 *  connection's own last-used/default one. */
async function openMongoCollection(
  connId: string,
  name: string,
  database?: string,
) {
  const db = database ?? (await resolveMongoDatabase(connId));
  useStudioStore.getState().openMongo(connId, db, name);
}

async function openMongoCollectionSchema(
  connId: string,
  name: string,
  database?: string,
) {
  await openMongoCollection(connId, name, database);
  const s = useStudioStore.getState();
  const tab = s.workspaces[connId]?.active;
  if (tab) s.setPaneMode(connId, tabKey(tab), "schema");
}

/** A table/collection found for the palette's `table:`/`schema:` modes —
 *  `database` is set only for a SIBLING database (not the connection's own
 *  current one), so `run()` knows to pass an explicit override instead of
 *  relying on ambient connection state. */
export interface PaletteTable extends TableInfo {
  database?: string;
}

/** Whether `t` matches search text `q` (already trimmed/lowercased) — name
 *  or kind, the same two fields the results list itself shows. Shared by
 *  `previewOrMatch` below and by the palette's own "does the connection's
 *  own database already have a match" check, which decides whether sibling
 *  databases need fetching at all (see `fetchSiblingTables`). */
export function tableMatches(t: TableInfo, q: string): boolean {
  return t.name.toLowerCase().includes(q) || t.kind.toLowerCase().includes(q);
}

/** Tables/collections from every OTHER database reachable through this
 *  connection — the sidebar can browse sibling databases (Postgres: a
 *  secondary pool via `pool_for`; MongoDB: any database on the same server,
 *  no extra connection needed), so the palette should be able to find them
 *  too. Deliberately NOT fetched eagerly alongside the connection's own
 *  tables — only called once a typed search comes up empty against the own
 *  database (see the `need_siblings` effect in `command-palette.tsx`), so a
 *  connection with many sibling databases doesn't pay for this on every
 *  palette open, only when the result would otherwise be "not found."
 *  Scoped to each sibling's `public` schema for Postgres (MongoDB has no
 *  schema layer) — one round trip per sibling database rather than
 *  enumerating every schema of every database. Best-effort: a sibling that
 *  fails to list (permissions, network) is just skipped, never an error. */
export async function fetchSiblingTables(
  connId: string,
  isMongo: boolean,
): Promise<PaletteTable[]> {
  const own_db = useStudioStore.getState().recentParams[connId]?.database;
  let siblings: string[];
  try {
    siblings = (await listDatabases(connId)).filter((d) => d !== own_db);
  } catch {
    return [];
  }

  const results = await Promise.allSettled(
    siblings.map((db) =>
      listSchemaObjects(connId, isMongo ? "" : "public", "table", db).then(
        (objs) => objs.map((o) => ({ name: o.name, kind: "table", database: db })),
      ),
    ),
  );
  const entries: PaletteTable[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") entries.push(...r.value);
  }
  return entries;
}

/** `>` mode — the app-level command list (unchanged behavior/commands),
 *  plus a "Theme" section listing all three modes explicitly. */
export function buildCommandItems(theme: {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
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

  const theme_options: { id: ThemeMode; label: string; icon: ReactNode }[] = [
    { id: "light", label: "Light", icon: <Sun className="size-4" /> },
    { id: "dark", label: "Dark", icon: <Moon className="size-4" /> },
    { id: "system", label: "System", icon: <Monitor className="size-4" /> },
  ];
  for (const opt of theme_options) {
    list.push({
      id: `theme.${opt.id}`,
      label: opt.label,
      section: "Theme",
      scope: theme.mode === opt.id ? "Current" : undefined,
      icon: opt.icon,
      run: () => theme.setMode(opt.id),
    });
  }

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
      icon: IconTypeMap[tab.kind],
      run: () => {
        const cur = useStudioStore.getState().workspaces[active_conn.id];
        const owner = cur && findOwnerLeaf(cur.layout, key);
        if (owner) s.selectTab(active_conn.id, owner.id, tab);
      },
    };
  });
}

/** Empty query → a short preview (just enough to show something's there,
 *  not the whole list); typed query → every match, not just whatever
 *  happened to land in the first `PREVIEW_COUNT`. Either way capped at
 *  `MATCH_CAP` — the results list renders every returned item (no
 *  pagination), so this is what keeps a huge schema from dumping thousands
 *  of DOM nodes at once. */
const PREVIEW_COUNT = 8;
const MATCH_CAP = 50;
function previewOrMatch(tables: PaletteTable[] | null, query: string): PaletteTable[] {
  const source = tables ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return source.slice(0, PREVIEW_COUNT);
  return source
    .filter(
      (t) => t.name.toLowerCase().includes(q) || t.kind.toLowerCase().includes(q),
    )
    .slice(0, MATCH_CAP);
}

/** `table:` prefix mode — open a table/collection's Data view. */
export function buildTableItems(
  tables: PaletteTable[] | null,
  tables_loading: boolean,
  query: string,
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
  return previewOrMatch(tables, query).map((t) => ({
    id: `table:${t.database ?? ""}:${t.name}`,
    label: t.name,
    hint: t.kind,
    // Which sibling database this came from — blank (the connection's own
    // current database) needs no callout.
    scope: t.database,
    section: noun,
    icon: <Table2 className="size-4" />,
    run: () => {
      if (is_mongo) void openMongoCollection(active_conn.id, t.name, t.database);
      else s.openTable(active_conn.id, t.name, undefined, t.database, t.database ? "public" : undefined);
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

/** `schema:` prefix mode — same table/collection list as quick-open, but
 *  every result opens in its Schema view instead of its Data view. */
export function buildSchemaOpenItems(
  tables: PaletteTable[] | null,
  tables_loading: boolean,
  query: string,
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
  return previewOrMatch(tables, query).map((t) => ({
    id: `schema:${t.database ?? ""}:${t.name}`,
    label: t.name,
    hint: `Open ${is_mongo ? "collection" : "table"} schema`,
    scope: t.database,
    icon: <Table2 className="size-4" />,
    run: () => {
      if (is_mongo) void openMongoCollectionSchema(active_conn.id, t.name, t.database);
      else s.openStructure(active_conn.id, t.name, t.database, t.database ? "public" : undefined);
    },
  }));
}
