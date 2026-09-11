import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Plus, RefreshCw, Search, Star, Trash2, Unplug } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  createPgDatabase,
  createPgSchema,
  disconnectDatabase,
  dropPgDatabase,
  dropPgSchema,
  duplicateTable,
  executeOp,
  catalogOverview,
  quoteIdent,
  refreshMatview,
  runSql,
  listSchemasIn,
  listSchemaObjects,
  type SchemaObject,
  type SchemaObjectKind,
} from "@/shared/api";
import { useStudioStore, type StudioStore } from "@/shared/store";
import { depthPadding, filterObjects, objectKey, uniqueCopyName, timestampedCopyName } from "./catalog-tree-utils";
import { TreeToggleRow, LazyObjectRows, LazyTableRows } from "./catalog-tree-rows";
import { TableListItem } from "./table-list-item";
import {
  DropDialog,
  DuplicateDialog,
  DuplicateMongoDialog,
  GrantsDialog,
  DbSchemaDdlDialog,
  type DdlDialogState,
} from "./catalog-dialogs";

/** The fixed set of category rows under every Postgres schema node — order
 *  matches the reference tree. Users & Privileges is NOT here — roles are
 *  cluster-wide, not owned by any one database, so it renders once per
 *  connection, a sibling of the database list itself (see `is_pg &&` below),
 *  not nested under any database or schema. */
/** Identifies a catalog tree's cached `object_lists` entry (a sibling
 *  database/non-active-schema row) that needs invalidating + refetching
 *  once a drop/duplicate action against it succeeds — that cache only ever
 *  populates/reads for non-active rows (see `ensure_objects`), so this is
 *  never needed for the primary list, which refreshes through
 *  `on_refresh()`/`tables` instead. `database` here is always the RAW name
 *  (never normalized to `undefined` for "own database" the way the
 *  API-call `database` field elsewhere is — `ensure_objects` does that
 *  normalization itself). */
interface SiblingTarget {
  database: string;
  schema: string;
  kind: SchemaObjectKind;
}

const CATEGORIES: {
  kind: SchemaObjectKind;
  label: string;
}[] = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  {
    kind: "materialized_view",
    label: "Materialized Views",
  },
  {
    kind: "procedure",
    label: "Procedures",
  },
  {
    kind: "function",
    label: "Functions",
  },
  {
    kind: "sequence",
    label: "Sequences",
  },
  { kind: "type", label: "Types" },
];

/** Database browser: schema/database selectors (PG), searchable table list
 *  with context menus, server-object browsers and their dialogs. */
export function TablesBrowser({
  conn_id,
  tables,
  active_table,
  on_open_table,
  on_refresh,
  reloading = false,
  search_value,
  on_search_change,
}: {
  conn_id: string;
  tables: { name: string; kind: string }[] | null;
  active_table: string | null;
  on_open_table: (name: string) => void;
  on_refresh: () => void;
  reloading?: boolean;
  search_value: string;
  on_search_change: (v: string) => void;
}) {
  const search = search_value;
  const [selected_name, setSelectedName] = useState<string | null>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  const [confirm_drop, setConfirmDrop] = useState<{
    name: string;
    kind: string;
    /** `undefined` = this connection's own primary database/active schema —
     *  set for a table opened from a sibling database/schema's catalog
     *  tree row (see `LazyTableRows`' on_drop wiring below). */
    database?: string;
    schema?: string;
    sibling?: SiblingTarget;
  } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropdown_error, setDropdownError] = useState<string | null>(null);
  const [confirm_duplicate, setConfirmDuplicate] = useState<{
    name: string;
    database?: string;
    schema?: string;
    sibling?: SiblingTarget;
  } | null>(null);
  const [dupe_name, setDupeName] = useState("");
  const [dupe_submitting, setDupeSubmitting] = useState(false);
  const [dupe_error, setDupeError] = useState<string | null>(null);

  // MongoDB's duplicate dialog is distinct from the SQL one above: the
  // default name is `<collection>_<timestamp>` (not `_copy`) and it offers a
  // "copy data" checkbox — Postgres/SQLite duplicate always copies data with
  // no such choice.
  const [confirm_duplicate_mongo, setConfirmDuplicateMongo] = useState<{
    name: string;
    /** `undefined` = `pg_active_schema` (Mongo's "current database" slot —
     *  see its own doc comment above) — set for a collection duplicated
     *  from a sibling database's catalog tree row. */
    database?: string;
    sibling?: SiblingTarget;
  } | null>(null);
  const [dupe_mongo_name, setDupeMongoName] = useState("");
  const [dupe_mongo_copy_data, setDupeMongoCopyData] = useState(true);
  const [dupe_mongo_submitting, setDupeMongoSubmitting] = useState(false);
  const [dupe_mongo_error, setDupeMongoError] = useState<string | null>(null);

  const store_open_table = useStudioStore((s) => s.openTable);
  const store_open_mongo = useStudioStore((s) => s.openMongo);
  const open_structure = useStudioStore((s) => s.openStructure);
  const openRolesTab = useStudioStore((s) => s.openRolesTab);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const set_disconnect_pending = useStudioStore(
    (s) => s.setDisconnectPendingId,
  );

  // ---- Postgres database / schema switcher -------------------------------
  const conn_kind = useStudioStore(
    (s: StudioStore) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const is_pg = conn_kind === "postgres";
  const is_mongo = conn_kind === "mongodb";
  /** "collection" for Mongo, "table" otherwise — used in dialog copy so a
   *  Mongo user isn't told they're dropping/duplicating a "table". */
  const noun = is_mongo ? "collection" : "table";
  const [pg_active_schema, setPgActiveSchema] = useState("public");
  // `null` = the initial database list hasn't loaded yet. Every database's
  // OWN schema list, including the primary's, is fetched lazily via
  // `schema_lists`/`ensure_schemas` below on first expand — no database
  // gets pre-loaded ahead of the others, so every row behaves identically.
  const [pg_databases, setPgDatabases] = useState<string[] | null>(null);
  /** Bumped after DDL so the schema/database lists refetch. */
  const [ddl_rev, setDdlRev] = useState(0);
  const [ddl_name, setDdlName] = useState("");

  const recent_params = useStudioStore((s) => s.recentParams[conn_id]);
  const recents_db = recent_params?.database;
  const conn_name = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.name,
  );
  const pg_current_db = recents_db ?? conn_name ?? "";
  const saved_local = useStudioStore((s) => s.savedLocal);
  const update_saved_local = useStudioStore((s) => s.updateSavedLocal);
  /** The saved connection profile (if any — `savedLocal` is name-keyed, and
   *  a `ConnectionInfo`'s own `name` is just the database it connected with,
   *  not that profile's display name, so there's no direct link back from a
   *  live connection to the entry that opened it) matching THIS connection's
   *  actual host/port/user, ignoring database — the target "Set as default
   *  database" below updates, so reopening that saved entry from the Home
   *  screen connects to the new default next time. */
  const matching_saved_local = useMemo(() => {
    if (!recent_params) return null;
    for (const [name, p] of Object.entries(saved_local)) {
      if (
        p.host === recent_params.host &&
        p.port === recent_params.port &&
        p.user === recent_params.user &&
        (p.kind ?? "postgres") === (recent_params.kind ?? "postgres")
      ) {
        return name;
      }
    }
    return null;
  }, [saved_local, recent_params]);
  /** Which database the "Default" badge marks — the saved connection's OWN
   *  `database` field when one is linked (updates immediately once "Set as
   *  default" changes it, unlike `pg_current_db`/`is_current_db`, which
   *  stay pinned to whatever THIS live session actually connected to and
   *  drive the bold styling + the rich active-schema table list; that
   *  binding can't change without a real reconnect, so the badge — a
   *  forward-looking "reopening this saved connection will target this
   *  database" label — is deliberately a separate signal from it, not the
   *  same one). Falls back to `pg_current_db` when there's no saved entry
   *  to redirect (nothing to mark as changing, so it just matches "now"). */
  const default_db = matching_saved_local
    ? (saved_local[matching_saved_local]?.database ?? pg_current_db)
    : pg_current_db;
  const set_default_database = useCallback(
    (db: string) => {
      if (!matching_saved_local) {
        push_notification({
          kind: "error",
          title: "No saved connection to update",
          detail:
            "Save this connection first, then a database here can become its default.",
        });
        return;
      }
      void update_saved_local(matching_saved_local, matching_saved_local, {
        ...saved_local[matching_saved_local],
        database: db,
      });
      push_notification({
        kind: "success",
        title: "Default database updated",
        detail: `"${matching_saved_local}" now reconnects to "${db}".`,
      });
    },
    [matching_saved_local, saved_local, update_saved_local, push_notification],
  );

  /** Close every open tab targeting `db` — used by every database row's own
   *  "Disconnect" (see `disconnect_database` below), primary and sibling
   *  alike; there's no separate backend "connection" per database to tear
   *  down, just this connection's own tabs pointed at it (see
   *  `connected_dbs` below). Disconnecting the whole connection is a
   *  separate action entirely, in the title bar. */
  const close_database_tabs = useCallback(
    (db: string) => {
      const tabs = useStudioStore.getState().workspaces[conn_id]?.tabs ?? [];
      for (const tab of tabs) {
        const tab_db =
          tab.kind === "table"
            ? (tab.database ?? pg_current_db)
            : tab.kind === "mongo" || tab.kind === "mongo-console"
              ? tab.database
              : null;
        if (tab_db === db) useStudioStore.getState().closeTab(conn_id, tab);
      }
    },
    [conn_id, pg_current_db],
  );

  /** Close every open tab targeting `(db, schema)` — the schema row's own
   *  "Close open tabs" context menu item, mirroring `close_database_tabs`
   *  above for a connected non-active schema. */
  const close_schema_tabs = useCallback(
    (db: string, schema: string) => {
      const tabs = useStudioStore.getState().workspaces[conn_id]?.tabs ?? [];
      for (const tab of tabs) {
        if (tab.kind !== "table") continue;
        const tab_db = tab.database ?? pg_current_db;
        const tab_schema =
          tab.schema ?? (tab_db === pg_current_db ? pg_active_schema : "");
        if (tab_db === db && tab_schema === schema) {
          useStudioStore.getState().closeTab(conn_id, tab);
        }
      }
    },
    [conn_id, pg_current_db, pg_active_schema],
  );

  // Schema lists per browsed sibling database (Postgres) — declared here
  // (rather than further down, where it's also used by `ensure_schemas`)
  // so `connected_dbs` can read it: once a sibling's entry exists, Postgres
  // has already opened a real secondary pool for it (see `PgAdapter::pool_for`),
  // regardless of whether any table tab was ever opened against it.
  const [schema_lists, setSchemaLists] = useState<
    Record<string, "loading" | string[] | null>
  >({});
  // Object (collection) lists per browsed database/schema/kind — same early
  // declaration, same reason: `connected_dbs` below also reads this for
  // Mongo, whose databases have no separate schema level, so browsing a
  // sibling's collections (`ensure_objects`) is the thing that signals it's
  // actually connected there, not a schema fetch.
  const [object_lists, setObjectLists] = useState<
    Record<string, "loading" | SchemaObject[] | null>
  >({});

  /** Every database this connection has an ACTUAL backend connection open
   *  for right now — the tree's green "connected" dot AND icon tint,
   *  distinct from `pg_current_db`/`pg_active_schema` (the connection's own/
   *  default database, shown BOLD — see the tree JSX below). This is not
   *  just "has an open table tab": expanding a sibling database's schemas
   *  already opens a real secondary pool on the backend (`pool_for`) before
   *  any table is ever opened, so it counts as connected from that point —
   *  a fetch entry in `schema_lists` is the frontend's own signal that this
   *  happened. Recomputed live as tabs/browsing state changes, so a
   *  database's indicator reflects the connection actually being live. */
  const conn_tabs = useStudioStore((s) => s.workspaces[conn_id]?.tabs);
  /** Databases explicitly disconnected via the sidebar's own "Disconnect"
   *  while at least one OTHER database was still connected — the primary
   *  (Postgres) / active (Mongo) database has no separate pool of its own
   *  to close (it IS the connection every sibling reuses), so the only
   *  thing a "disconnect just this one" click can actually do for it is
   *  stop counting it as connected here. Its own pool stays open/idle
   *  underneath until the whole connection eventually closes — harmless,
   *  same as any not-yet-evicted secondary pool. Re-included automatically
   *  the moment a new tab targets it again (the tab-derived membership
   *  below always wins over this exclusion), so this only matters while
   *  nothing is actually open against it. */
  const [manually_disconnected, setManuallyDisconnected] = useState<
    Set<string>
  >(new Set());
  const connected_dbs = useMemo(() => {
    const set = new Set<string>();
    if (is_pg && !manually_disconnected.has(pg_current_db)) {
      set.add(pg_current_db);
    }
    if (is_mongo && !manually_disconnected.has(pg_active_schema)) {
      set.add(pg_active_schema);
    }
    for (const tab of conn_tabs ?? []) {
      if (tab.kind === "table") set.add(tab.database ?? pg_current_db);
      else if (tab.kind === "mongo" || tab.kind === "mongo-console") {
        set.add(tab.database);
      }
    }
    if (is_pg) {
      for (const db of Object.keys(schema_lists)) {
        if (schema_lists[db] !== undefined) set.add(db);
      }
    }
    if (is_mongo) {
      // Mongo has no schema level — browsing a sibling's collections
      // (`ensure_objects(db, "", "table")`) is the equivalent signal that
      // it's actually being used, not just listed. `objectKey`'s own `\n`
      // separator never appears in a real database name.
      for (const key of Object.keys(object_lists)) {
        if (object_lists[key] === undefined) continue;
        set.add(key.split("\n")[0]);
      }
    }
    return set;
  }, [
    conn_tabs,
    is_pg,
    is_mongo,
    pg_current_db,
    pg_active_schema,
    schema_lists,
    object_lists,
    manually_disconnected,
  ]);

  // ---- Catalog tree: which nodes are expanded. Every node id is a
  // `/`-joined path (`db:x`, `db:x/schema:y`, `db:x/schema:y/kind:table`,
  // `db:x/roles`) so a database/schema/category can be expanded
  // independently of any other — unlike the old single
  // `pg_active_schema`-driven accordion, several can be open at once.
  // Declared here (ahead of where it's used everywhere else in the tree
  // below) so `disconnect_database` can also collapse a database's node.
  const [tree_expanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const toggle_tree = useCallback((id: string) => {
    setTreeExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Disconnect ONE database without touching the connection or any other
   *  database — there's no single "current db" once several are connected
   *  at once, every row (primary or sibling) behaves identically. The
   *  whole-connection disconnect is a separate action, in the title bar. */
  const disconnect_database = useCallback(
    (db: string) => {
      close_database_tabs(db);
      const is_own_default = db === pg_current_db || db === pg_active_schema;
      if (is_own_default) {
        setManuallyDisconnected((cur) => {
          if (cur.has(db)) return cur;
          const next = new Set(cur);
          next.add(db);
          return next;
        });
      }
      // Clear its browse-state too, primary/active included — not just
      // siblings: `connected_dbs`'s second pass counts a browsed-but-tabless
      // database as connected by scanning `schema_lists`/`object_lists`
      // directly, which would otherwise re-add the primary/active database
      // right back (bypassing `manually_disconnected` above) whenever it had
      // been expanded/browsed before this disconnect.
      if (is_pg) {
        setSchemaLists((cur) => {
          if (!(db in cur)) return cur;
          const next = { ...cur };
          delete next[db];
          return next;
        });
      } else if (is_mongo) {
        // Mongo's equivalent: its browse-state lives in `object_lists`
        // (no schema level to fetch separately), same reason as above.
        const prefix = `${db}\n`;
        setObjectLists((cur) => {
          let changed = false;
          const next = { ...cur };
          for (const key of Object.keys(next)) {
            if (key.startsWith(prefix)) {
              delete next[key];
              changed = true;
            }
          }
          return changed ? next : cur;
        });
      }
      // Collapse its tree node too — leaving it expanded after clearing
      // `schema_lists` above made `schemas_state` (`schema_lists[db] ??
      // "loading"`) read straight back as "loading" forever, since nothing
      // re-triggers `ensure_schemas` for an already-expanded row (that only
      // fires from the row's own onClick, on a fresh expand).
      const prefix = `db:${db}`;
      setTreeExpanded((cur) => {
        let changed = false;
        const next = new Set(cur);
        for (const id of next) {
          if (id === prefix || id.startsWith(`${prefix}/`)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : cur;
      });
      if (is_pg && !is_own_default) {
        // Fire the actual backend close alongside the UI cleanup above —
        // not awaited/blocking: even if this fails, the row already reads
        // as disconnected, and the secondary pool it was meant to close
        // will still fall out via its own normal idle eviction either way.
        disconnectDatabase(conn_id, db).catch((e: unknown) => {
          push_notification({
            kind: "error",
            title: `Couldn't fully disconnect "${db}"`,
            detail: String(e),
          });
        });
      }
    },
    [
      close_database_tabs,
      is_pg,
      is_mongo,
      pg_current_db,
      pg_active_schema,
      conn_id,
      push_notification,
    ],
  );

  /** Every `(database, schema)` pair with an actual open tab against it —
   *  the schema row's own green "connected" dot, mirroring `connected_dbs`
   *  one level down. Keyed the same way as `schema_id` in the tree JSX
   *  below (`db:<database>/schema:<schema>`) for a direct lookup at render
   *  time. The primary database's active schema counts unconditionally,
   *  same convention as the primary database itself in `connected_dbs`. */
  const connected_schemas = useMemo(() => {
    const set = new Set<string>();
    if (is_pg) set.add(`db:${pg_current_db}/schema:${pg_active_schema}`);
    for (const tab of conn_tabs ?? []) {
      if (tab.kind !== "table") continue;
      const db = tab.database ?? pg_current_db;
      const schema = tab.schema ?? (db === pg_current_db ? pg_active_schema : "");
      if (schema) set.add(`db:${db}/schema:${schema}`);
    }
    return set;
  }, [conn_tabs, is_pg, pg_current_db, pg_active_schema]);

  useEffect(() => {
    // Mongo has no schemas — its "schema switcher" slot below repurposes
    // this same fetch to switch the active DATABASE instead (via
    // `overview.databases`/`set_active_schema`, which the Mongo adapter
    // reuses for its database switch — see MONGODB_SUPPORT.md).
    if (!is_pg && !is_mongo) return;
    let cancelled = false;
    void (async () => {
      try {
        // `overview.schemas` (the primary database's own schema list) is
        // deliberately NOT used here — every database's schema list,
        // primary included, is only ever fetched on-demand via
        // `ensure_schemas` below, when its row is actually expanded.
        const overview = await catalogOverview(conn_id);
        if (cancelled) return;
        setPgDatabases(overview.databases);
        setPgActiveSchema(overview.active_schema);
      } catch {
        if (!cancelled) setPgDatabases(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, is_pg, is_mongo, ddl_rev]);

  // ---- Create/drop database & schema (Postgres DDL dialogs) ----
  const [ddl_dialog, setDdlDialog] = useState<DdlDialogState | null>(null);
  const [ddl_cascade, setDdlCascade] = useState(false);
  const [ddl_busy, setDdlBusy] = useState(false);
  const [ddl_error, setDdlError] = useState<string | null>(null);

  const open_ddl = (
    kind: "db-create" | "db-drop" | "schema-create" | "schema-drop",
    name = "",
  ) => {
    setDdlError(null);
    setDdlCascade(false);
    setDdlDialog({ kind, name });
  };

  const run_ddl = async () => {
    if (!ddl_dialog || ddl_busy) return;
    setDdlBusy(true);
    setDdlError(null);
    try {
      const name =
        ddl_dialog.kind === "db-drop" || ddl_dialog.kind === "schema-drop"
          ? ddl_dialog.name
          : ddl_name.trim();
      if (!name) throw new Error("Name must not be empty.");
      switch (ddl_dialog.kind) {
        case "db-create":
          await createPgDatabase(conn_id, name);
          break;
        case "db-drop":
          await dropPgDatabase(conn_id, name);
          break;
        case "schema-create":
          await createPgSchema(conn_id, name);
          break;
        case "schema-drop":
          await dropPgSchema(conn_id, name, ddl_cascade);
          if (pg_active_schema === name) setPgActiveSchema("public");
          break;
      }
      setDdlDialog(null);
      setDdlRev((r) => r + 1);
      if (
        ddl_dialog.kind === "schema-create" ||
        ddl_dialog.kind === "schema-drop"
      ) {
        on_refresh();
      }
    } catch (e) {
      setDdlError(String(e));
    } finally {
      setDdlBusy(false);
    }
  };

  const esc_lit = (v: string) => v.replace(/'/g, "''");

  /** `database === pg_current_db` means "this connection's own database" —
   *  passed as `undefined` so the backend takes the cheap primary-pool path
   *  instead of treating its own database as a sibling. */
  const db_arg = useCallback(
    (database: string) => (database === pg_current_db ? undefined : database),
    [pg_current_db],
  );
  const ensure_schemas = useCallback(
    (database: string) => {
      setSchemaLists((cur) => {
        if (cur[database] !== undefined) return cur;
        listSchemasIn(conn_id, db_arg(database))
          .then((rows) => setSchemaLists((c) => ({ ...c, [database]: rows })))
          .catch(() => setSchemaLists((c) => ({ ...c, [database]: null })));
        return { ...cur, [database]: "loading" };
      });
    },
    [conn_id, db_arg],
  );
  const ensure_objects = useCallback(
    (database: string, schema: string, kind: SchemaObjectKind) => {
      const key = objectKey(database, schema, kind);
      setObjectLists((cur) => {
        if (cur[key] !== undefined) return cur;
        listSchemaObjects(conn_id, schema, kind, db_arg(database))
          .then((rows) => setObjectLists((c) => ({ ...c, [key]: rows })))
          .catch(() => setObjectLists((c) => ({ ...c, [key]: null })));
        return { ...cur, [key]: "loading" };
      });
    },
    [conn_id, db_arg],
  );
  /** After a drop/duplicate against a sibling database/non-active-schema
   *  row succeeds, its cached `object_lists` entry is stale (still lists a
   *  dropped table, or is missing a freshly duplicated one) — `ensure_objects`
   *  only ever fetches once per key, so the entry has to be cleared before
   *  re-calling it, or the stale cache would just be served straight back. */
  const refresh_sibling_objects = useCallback(
    ({ database, schema, kind }: SiblingTarget) => {
      const key = objectKey(database, schema, kind);
      setObjectLists((cur) => {
        if (!(key in cur)) return cur;
        const next = { ...cur };
        delete next[key];
        return next;
      });
      ensure_objects(database, schema, kind);
    },
    [ensure_objects],
  );
  /** Open an object found anywhere in the catalog tree. Browsing (expanding
   *  tree nodes to see names) never touches the connection's active
   *  database/schema — the new `listSchemasIn`/`listSchemaObjects` calls
   *  take an explicit target and need no activation.
   *
   *  Opening one now stays on THIS SAME connection/tab either way — real
   *  simultaneous multi-database AND multi-schema support (backend
   *  `pool_for`/`database`/`schema` params threaded through table_schema/
   *  execute_op/etc., see postgres.rs and mongodb.rs) means a sibling
   *  database's OR a non-active schema's table never needs a reconnect or a
   *  forced switch: the new tab just carries its own `database`/`schema`
   *  explicitly, and every query it makes passes them explicitly instead of
   *  relying on the adapter's single ambient active-database/schema — so
   *  several databases' AND several schemas' tables can all stay open at
   *  once without one's queries clobbering another's. Only the PRIMARY
   *  database's ACTIVE schema stays "ambient" (`database`/`schema` both
   *  `undefined` — same behavior as before this existed): that's the one
   *  combination with the rich, already-fetched `active_tables_list_ui`
   *  treatment (search/context-menu/drop/duplicate) — everywhere else opens
   *  with the plain tree-only treatment, same tradeoff already accepted for
   *  sibling databases. */
  const open_object = useCallback(
    async (database: string, schema: string, name: string, kind: string) => {
      if (is_mongo) {
        // Mongo already resolves every call by its own explicit `database`
        // param (no adapter-wide ambient state to switch) — open directly,
        // on the same collection tab machinery.
        store_open_mongo(conn_id, database, name);
        return;
      }
      if (database === pg_current_db && schema === pg_active_schema) {
        on_open_table(name);
        return;
      }
      // A sibling database, or a non-active schema of THIS database — opens
      // directly with its own explicit database/schema, no forced switch.
      if (kind === "table" || kind === "view" || kind === "matview") {
        store_open_table(
          conn_id,
          name,
          undefined,
          database === pg_current_db ? undefined : database,
          schema,
        );
      }
    },
    [
      is_mongo,
      pg_current_db,
      pg_active_schema,
      conn_id,
      on_open_table,
      store_open_mongo,
      store_open_table,
    ],
  );

  // ---- Grants viewer for a table/view/matview ----
  const [grants_for, setGrantsFor] = useState<string | null>(null);
  const [grants_rows, setGrantsRows] = useState<(string | null)[][] | null>(
    null,
  );

  useEffect(() => {
    if (!grants_for || !is_pg) return;
    let cancelled = false;
    runSql(
      conn_id,
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='${esc_lit(pg_active_schema)}' AND table_name='${esc_lit(grants_for)}' ORDER BY 1, 2`,
    )
      .then((res) => {
        if (!cancelled) setGrantsRows(res.rows);
      })
      .catch(() => {
        if (!cancelled) setGrantsRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [grants_for, conn_id, is_pg, pg_active_schema]);

  // ---- List filtering + keyboard navigation ------------------------------
  const loading = tables === null || reloading;
  const pg_loading = (is_pg || is_mongo) && pg_databases === null;

  const filtered_tables = useMemo(() => {
    if (!tables) return [];
    const q = search.toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, search]);

  // ---- Catalog tree search: connected databases only, collapsed branches
  // included --------------------------------------------------------------
  // Search only ever looks at CONNECTED databases (Postgres: `pg_current_db`
  // plus any sibling database with a real open tab — see `connected_dbs`;
  // Mongo: `pg_active_schema`, its only level) — every other database is
  // hidden entirely while searching rather than searched into, so this
  // never needs to fan out across the whole server, only the (typically 1-3)
  // databases actually in use. Within those, it still reaches into collapsed
  // schemas: the search box has always matched table/collection names (see
  // `filtered_tables` above), and a schema the user hasn't expanded is
  // exactly what a collapsed branch is hiding. Other categories (Views,
  // Procedures, Roles, …) aren't eagerly fetched for this, so they're
  // unaffected by search either.
  const searching = search.trim().length > 0;
  const search_q = search.trim().toLowerCase();

  // Eagerly fetch every connected database's schemas — every database's
  // schema list is lazy/on-demand now, primary included (see the
  // `pg_databases` state's own doc comment above), so search needs to
  // explicitly pull all of them in, not just siblings. Then each of THEIR
  // Tables (the active schema's Tables already has `filtered_tables`,
  // nothing to fetch there). `ensure_schemas`/`ensure_objects` are no-ops
  // once cached, so re-running this on every keystroke just converges.
  useEffect(() => {
    if (!is_pg || !searching) return;
    for (const db of connected_dbs) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ensure_schemas only ever writes "loading" synchronously to claim the fetch; the real work is already async in its own .then().
      ensure_schemas(db);
    }
  }, [is_pg, searching, connected_dbs, ensure_schemas]);

  useEffect(() => {
    if (!is_pg || !searching) return;
    for (const db of connected_dbs) {
      const schemas = schema_lists[db];
      if (!Array.isArray(schemas)) continue;
      for (const schema of schemas) {
        if (db === pg_current_db && schema === pg_active_schema) continue;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- see the effect above.
        ensure_objects(db, schema, "table");
      }
    }
  }, [
    is_pg,
    searching,
    connected_dbs,
    pg_current_db,
    pg_active_schema,
    schema_lists,
    ensure_objects,
  ]);

  /** Is `database`/`schema` (or its Tables) a search match? Plain function,
   *  not memoized — a cheap substring/array check over a handful of
   *  databases/schemas, not worth a dependency array. */
  function schema_table_match(database: string, schema: string): boolean {
    if (schema.toLowerCase().includes(search_q)) return true;
    const is_active = database === pg_current_db && schema === pg_active_schema;
    if (is_active) return filtered_tables.length > 0;
    return !!filterObjects(
      object_lists[objectKey(database, schema, "table")],
      search_q,
    )?.length;
  }

  function db_table_match(database: string): boolean {
    if (!connected_dbs.has(database)) return false;
    if (database.toLowerCase().includes(search_q)) return true;
    const schemas = schema_lists[database];
    if (!Array.isArray(schemas)) return false;
    return schemas.some((schema) => schema_table_match(database, schema));
  }

  // Mongo's own version: no schema level, so this is just the direct
  // collection list per connected database (plus the active database's own
  // `filtered_tables` fast path).
  useEffect(() => {
    if (!is_mongo || !searching) return;
    for (const db of connected_dbs) {
      if (db === pg_active_schema) continue;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see the Postgres effects above.
      ensure_objects(db, "", "table");
    }
  }, [is_mongo, searching, connected_dbs, pg_active_schema, ensure_objects]);

  function mongo_db_match(database: string): boolean {
    if (!connected_dbs.has(database)) return false;
    if (database.toLowerCase().includes(search_q)) return true;
    if (database === pg_active_schema) return filtered_tables.length > 0;
    return !!filterObjects(
      object_lists[objectKey(database, "", "table")],
      search_q,
    )?.length;
  }

  const [prev_active, setPrevActive] = useState(active_table);
  if (prev_active !== active_table) {
    setPrevActive(active_table);
    setSelectedName(active_table);
  }

  const [prev_search, setPrevSearch] = useState(search);
  if (prev_search !== search) {
    setPrevSearch(search);
    const q = search.toLowerCase();
    if (q) {
      setSelectedName(
        tables?.find((t) => t.name.toLowerCase().includes(q))?.name ?? null,
      );
    }
  }

  useEffect(() => {
    if (!selected_name) return;
    list_ref.current
      ?.querySelector(`[data-table="${CSS.escape(selected_name)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected_name]);

  const move_selection = useCallback(
    (delta: number) => {
      if (!tables) return;
      if (filtered_tables.length === 0) return;
      const idx = filtered_tables.findIndex((t) => t.name === selected_name);
      const next =
        idx < 0
          ? 0
          : Math.min(filtered_tables.length - 1, Math.max(0, idx + delta));
      setSelectedName(filtered_tables[next].name);
    },
    [tables, filtered_tables, selected_name],
  );

  const open_selected = useCallback(() => {
    const name = selected_name ?? filtered_tables[0]?.name;
    if (!name) return;
    if (is_mongo) {
      // For MongoDB, we need to know which database the collection belongs to.
      // The tables list comes from the active database.
      store_open_mongo(conn_id, pg_current_db, name);
    } else {
      on_open_table(name);
    }
  }, [
    filtered_tables,
    selected_name,
    on_open_table,
    is_mongo,
    store_open_mongo,
    conn_id,
    pg_current_db,
  ]);

  const handle_nav_keys = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move_selection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move_selection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        open_selected();
      }
    },
    [move_selection, open_selected],
  );

  const do_drop = async () => {
    if (!confirm_drop || dropping) return;
    setDropping(true);
    setDropdownError(null);
    try {
      if (confirm_drop.kind === "table") {
        await executeOp(
          conn_id,
          { kind: "drop_table", table: confirm_drop.name },
          confirm_drop.database,
          confirm_drop.schema,
        );
      } else {
        // No `schema` param on `runSql` — the schema (when targeting a
        // non-default one) has to be qualified straight into the SQL text.
        const qualified = confirm_drop.schema
          ? `${quoteIdent(confirm_drop.schema)}.${quoteIdent(confirm_drop.name)}`
          : quoteIdent(confirm_drop.name);
        await runSql(
          conn_id,
          `DROP VIEW IF EXISTS ${qualified}`,
          "app",
          confirm_drop.database,
        );
      }
      setConfirmDrop(null);
      if (confirm_drop.sibling) refresh_sibling_objects(confirm_drop.sibling);
      on_refresh();
    } catch (e) {
      setDropdownError(String(e));
    } finally {
      setDropping(false);
    }
  };

  const copy_name = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Clipboard unavailable in this webview; ignore.
    }
  };

  const duplicate_table = async () => {
    if (!confirm_duplicate || dupe_submitting) return;
    const target = dupe_name.trim();
    if (!target) {
      setDupeError("Enter a name for the duplicate table.");
      return;
    }
    // `tables` only reflects the connection's own active schema — not a
    // meaningful check for a sibling database/schema's duplicate target,
    // so skip it there and let the backend reject a real collision.
    const taken =
      !confirm_duplicate.sibling &&
      (tables ?? []).some(
        (t) => t.name.toLowerCase() === target.toLowerCase(),
      );
    if (taken) {
      setDupeError(`A table named “${target}” already exists.`);
      return;
    }
    setDupeSubmitting(true);
    setDupeError(null);
    try {
      await duplicateTable(
        conn_id,
        confirm_duplicate.name,
        target,
        true,
        confirm_duplicate.database,
        confirm_duplicate.schema,
      );
      setConfirmDuplicate(null);
      if (confirm_duplicate.sibling)
        refresh_sibling_objects(confirm_duplicate.sibling);
      on_refresh();
      store_open_table(
        conn_id,
        target,
        undefined,
        confirm_duplicate.database,
        confirm_duplicate.schema,
      );
    } catch (e) {
      setDupeError(String(e));
    } finally {
      setDupeSubmitting(false);
    }
  };

  const ask_duplicate = (t: {
    name: string;
    database?: string;
    schema?: string;
    sibling?: SiblingTarget;
  }) => {
    setDupeError(null);
    setDupeName(uniqueCopyName(t.name, t.sibling ? [] : (tables ?? [])));
    setConfirmDuplicate(t);
  };

  const duplicate_collection_mongo = async () => {
    if (!confirm_duplicate_mongo || dupe_mongo_submitting) return;
    const target = dupe_mongo_name.trim();
    if (!target) {
      setDupeMongoError("Enter a name for the duplicate collection.");
      return;
    }
    // `tables` only reflects the active database — not meaningful for a
    // sibling database's duplicate target (see the SQL `duplicate_table`'s
    // same guard above).
    const taken =
      !confirm_duplicate_mongo.sibling &&
      (tables ?? []).some(
        (t) => t.name.toLowerCase() === target.toLowerCase(),
      );
    if (taken) {
      setDupeMongoError(`A collection named “${target}” already exists.`);
      return;
    }
    setDupeMongoSubmitting(true);
    setDupeMongoError(null);
    try {
      await duplicateTable(
        conn_id,
        confirm_duplicate_mongo.name,
        target,
        dupe_mongo_copy_data,
        confirm_duplicate_mongo.database,
      );
      setConfirmDuplicateMongo(null);
      if (confirm_duplicate_mongo.sibling)
        refresh_sibling_objects(confirm_duplicate_mongo.sibling);
      on_refresh();
      store_open_mongo(
        conn_id,
        confirm_duplicate_mongo.database ?? pg_active_schema,
        target,
      );
    } catch (e) {
      setDupeMongoError(String(e));
    } finally {
      setDupeMongoSubmitting(false);
    }
  };

  const ask_duplicate_mongo = (t: {
    name: string;
    database?: string;
    sibling?: SiblingTarget;
  }) => {
    setDupeMongoError(null);
    setDupeMongoCopyData(true);
    setDupeMongoName(
      timestampedCopyName(t.name, t.sibling ? [] : (tables ?? [])),
    );
    setConfirmDuplicateMongo(t);
  };

  // Search stays pinned at the very top of the sidebar (see `search_bar_ui`
  // below in the return) instead of living wherever the active Tables list
  // happens to be nested — it's the one thing that should always be
  // reachable without first expanding the right database/schema/category.
  // It still only searches/selects within that active list (the one list
  // wired to keyboard nav), same as before, just visually relocated.
  const search_bar_ui = (
    // The sidebar's own wrapper dropped its right padding so the tree's
    // scrollbar can hug the edge (see sidebar/index.tsx) — this row isn't
    // scrollable, so it keeps its own inset here instead.
    <div className="flex items-center gap-1 pr-2">
      <div className="relative min-w-0 flex-1">
        <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          className="pr-2 pl-7 text-xs"
          placeholder="Search tables…"
          value={search}
          disabled={loading}
          onChange={(e) => on_search_change(e.target.value)}
          onKeyDown={handle_nav_keys}
        />
      </div>
      <Button
        size="iconSm"
        variant="outline"
        aria-label={reloading ? "Refreshing tables" : "Refresh tables"}
        title="Reload all tables"
        className="size-7"
        disabled={reloading}
        onClick={on_refresh}
      >
        <RefreshCw className={cn("size-3.5", reloading && "animate-spin")} />
      </Button>
    </div>
  );

  // The connection's own active database(+schema for PG)'s "Tables"
  // category gets the full existing treatment — this list, keyboard nav,
  // drop/duplicate/rename dialogs — sourced from the `tables` prop the
  // workspace already fetches for it, not a new lazy fetch. This is ALSO
  // the entirety of a SQLite connection's sidebar (no database/schema tree
  // exists there), rendered unconditionally in that case below.
  const active_tables_list_ui = (
    <>
      <div
        ref={list_ref}
        tabIndex={0}
        aria-busy={reloading}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto outline-none transition-opacity",
          // A reload of an ALREADY-loaded list (switching schema back and
          // forth, a background refresh) stays on-screen and just dims a
          // touch — the spinning Refresh icon above already signals it's
          // in flight. Only a true first load (nothing to show yet) blanks
          // the list with skeletons; re-showing those on every reload was
          // the bug (a schema you'd already opened looked like it forgot
          // its tables every time you came back to it).
          reloading && tables !== null && "opacity-60",
        )}
        onKeyDown={handle_nav_keys}
      >
        {tables === null ? (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-muted/60 h-7 w-full animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : filtered_tables.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">
            No tables found.
          </p>
        ) : (
          filtered_tables.map((t) => (
            <TableListItem
              key={t.name}
              name={t.name}
              kind={t.kind}
              is_mongo={is_mongo}
              is_selected={t.name === (selected_name ?? active_table)}
              disabled={dupe_submitting || dupe_mongo_submitting}
              on_select={() => {
                setSelectedName(t.name);
                // Focus the list so arrow keys / Enter work right away
                // (WebKit does not focus buttons on click).
                list_ref.current?.focus();
              }}
              on_open={() => {
                if (is_mongo) {
                  store_open_mongo(conn_id, pg_current_db, t.name);
                } else {
                  on_open_table(t.name);
                }
              }}
              on_view_structure={() => open_structure(conn_id, t.name)}
              on_copy={() => void copy_name(t.name)}
              on_duplicate={() =>
                is_mongo ? ask_duplicate_mongo(t) : ask_duplicate(t)
              }
              on_drop={() => setConfirmDrop({ name: t.name, kind: t.kind })}
              on_view_grants={() => {
                setGrantsRows(null);
                setGrantsFor(t.name);
              }}
              on_refresh_matview={
                t.kind === "matview"
                  ? () =>
                      void (async () => {
                        try {
                          await refreshMatview(conn_id, t.name);
                          on_refresh();
                          push_notification({
                            kind: "success",
                            title: "Materialized view refreshed",
                            detail: t.name,
                          });
                        } catch (e) {
                          push_notification({
                            kind: "error",
                            title: "Refresh failed",
                            detail: String(e),
                          });
                        }
                      })()
                  : undefined
              }
            />
          ))
        )}
      </div>
    </>
  );

  return (
    <>
      {search_bar_ui}

      {/* Catalog tree — replaces the old dropdown-based database/schema
          switcher entirely: every row (database, schema, object category)
          is an independently click-to-expand disclosure, and several can be
          open at once (a genuinely nested tree, not a single-active
          accordion). Browsing NEVER switches the connection's active
          database/schema — `listSchemasIn`/`listSchemaObjects` take an
          explicit target and work for any of them. OPENING an object still
          can: see `open_object`'s own comment for why, and how it avoids
          ever adding a new connection-tab entry either way. */}
      {is_pg &&
        (pg_loading ? (
          <p className="text-muted-foreground px-1.5 py-1 text-xs">
            Loading databases…
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-xs">
            {(pg_databases ?? [])
              .filter((db) => !searching || db_table_match(db))
              .map((db) => {
                const db_id = `db:${db}`;
                const db_expanded = searching || tree_expanded.has(db_id);
                const is_current_db = db === pg_current_db;
                const is_connected_db = connected_dbs.has(db);
                // Every database's schema list lives in `schema_lists` and
                // is fetched on first expand — primary and sibling alike,
                // no special pre-loaded case for either.
                const schemas_state: "loading" | string[] | null =
                  schema_lists[db] ?? "loading";
                const visible_schemas: string[] | null = Array.isArray(
                  schemas_state,
                )
                  ? searching
                    ? schemas_state.filter((s) => schema_table_match(db, s))
                    : schemas_state
                  : null;
                const db_row = (
                  <TreeToggleRow
                    kind="database"
                    icon_badge={is_connected_db}
                    label={db}
                    expanded={db_expanded}
                    active={is_current_db}
                    depth={0}
                    loading={db_expanded && schemas_state === "loading"}
                    onClick={() => {
                      toggle_tree(db_id);
                      if (!db_expanded) ensure_schemas(db);
                    }}
                    suffix={
                      db === default_db ? (
                        <span className="text-muted-foreground text-3xs font-medium tracking-wide uppercase">
                          Default
                        </span>
                      ) : undefined
                    }
                  />
                );
                const can_set_default = db !== default_db;
                const can_disconnect = is_current_db || is_connected_db;
                return (
                  <div key={db}>
                    {can_set_default || can_disconnect ? (
                      <ContextMenu>
                        <ContextMenuTrigger className="contents">
                          {db_row}
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          {can_set_default && (
                            <ContextMenuItem
                              onSelect={() => set_default_database(db)}
                            >
                              <Star className="size-4" />
                              Set as default
                            </ContextMenuItem>
                          )}
                          {/* Primary or sibling, disconnecting any database
                              other than the LAST one connected just drops
                              that one — no popup, connection stays open.
                              The last one is different:
                              `disconnect_database` can't actually free
                              anything for it (there's no other database
                              left to keep the connection around for), so it
                              falls through to the real whole-connection
                              teardown instead — same as the title bar's own
                              Disconnect, and worth the confirmation since
                              THAT one loses unsaved work everywhere. */}
                          {can_disconnect && (
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() =>
                                connected_dbs.size === 1 &&
                                connected_dbs.has(db)
                                  ? set_disconnect_pending(conn_id)
                                  : disconnect_database(db)
                              }
                            >
                              <Unplug className="size-4" />
                              Disconnect
                            </ContextMenuItem>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    ) : (
                      db_row
                    )}
                    {db_expanded && schemas_state !== "loading" && (
                      visible_schemas === null ? (
                        <p
                          className="text-muted-foreground py-1 text-sm"
                          style={depthPadding(1)}
                        >
                          Failed to load schemas.
                        </p>
                      ) : (
                        visible_schemas.map((schema) => {
                          const schema_id = `${db_id}/schema:${schema}`;
                          const schema_expanded =
                            searching || tree_expanded.has(schema_id);
                          const is_active_schema =
                            is_current_db && schema === pg_active_schema;
                          const is_connected_schema =
                            connected_schemas.has(schema_id);
                          const schema_row = (
                            <TreeToggleRow
                              kind="folder"
                              label={schema}
                              expanded={schema_expanded}
                              active={is_active_schema}
                              depth={1}
                              onClick={() => toggle_tree(schema_id)}
                            />
                          );
                          return (
                            <div key={schema}>
                              {is_current_db ||
                              (is_connected_schema && !is_active_schema) ? (
                                <ContextMenu>
                                  <ContextMenuTrigger className="contents">
                                    {schema_row}
                                  </ContextMenuTrigger>
                                  <ContextMenuContent className="w-48">
                                    {is_connected_schema &&
                                      !is_active_schema && (
                                        <ContextMenuItem
                                          onSelect={() =>
                                            close_schema_tabs(db, schema)
                                          }
                                        >
                                          <Trash2 className="size-4" />
                                          Close open tabs
                                        </ContextMenuItem>
                                      )}
                                    {is_current_db && (
                                      <ContextMenuItem
                                        variant="destructive"
                                        disabled={schema === "public"}
                                        onSelect={() =>
                                          open_ddl("schema-drop", schema)
                                        }
                                      >
                                        <Trash2 className="size-4" />
                                        Drop schema…
                                      </ContextMenuItem>
                                    )}
                                  </ContextMenuContent>
                                </ContextMenu>
                              ) : (
                                schema_row
                              )}
                              {schema_expanded &&
                                CATEGORIES.map((cat) => {
                                  const cat_id = `${schema_id}/kind:${cat.kind}`;
                                  // Only Tables is eagerly fetched for
                                  // search (see `schema_table_match`), so
                                  // it's the only category search force-
                                  // expands — the rest keep their normal
                                  // manual expand state either way.
                                  const cat_expanded =
                                    (searching && cat.kind === "table") ||
                                    tree_expanded.has(cat_id);
                                  const is_active_tables =
                                    is_active_schema && cat.kind === "table";
                                  const cache_key = objectKey(
                                    db,
                                    schema,
                                    cat.kind,
                                  );
                                  const cat_state =
                                    searching && cat.kind === "table"
                                      ? filterObjects(
                                          object_lists[cache_key],
                                          search_q,
                                        )
                                      : object_lists[cache_key];
                                  return (
                                    <div key={cat.kind}>
                                      <TreeToggleRow
                                        kind={cat.kind}
                                        label={cat.label}
                                        expanded={cat_expanded}
                                        depth={2}
                                        loading={
                                          cat_expanded &&
                                          !is_active_tables &&
                                          (cat_state === "loading" ||
                                            cat_state === undefined)
                                        }
                                        onClick={() => {
                                          toggle_tree(cat_id);
                                          if (
                                            !cat_expanded &&
                                            !is_active_tables
                                          ) {
                                            ensure_objects(
                                              db,
                                              schema,
                                              cat.kind,
                                            );
                                          }
                                        }}
                                      />
                                      {cat_expanded &&
                                        (is_active_tables ? (
                                          <div style={depthPadding(3)}>
                                            {active_tables_list_ui}
                                          </div>
                                        ) : cat.kind === "table" ||
                                          cat.kind === "view" ||
                                          cat.kind === "materialized_view" ? (
                                          <LazyTableRows
                                            state={cat_state}
                                            empty_label={`No ${cat.label.toLowerCase()}.`}
                                            depth={3}
                                            kind={cat.kind}
                                            on_duplicate={(name) =>
                                              ask_duplicate({
                                                name,
                                                database:
                                                  db === pg_current_db
                                                    ? undefined
                                                    : db,
                                                schema,
                                                sibling: { database: db, schema, kind: cat.kind },
                                              })
                                            }
                                            on_drop={(name) =>
                                              setConfirmDrop({
                                                name,
                                                kind: cat.kind,
                                                database:
                                                  db === pg_current_db
                                                    ? undefined
                                                    : db,
                                                schema,
                                                sibling: { database: db, schema, kind: cat.kind },
                                              })
                                            }
                                            on_open={(name) =>
                                              void open_object(
                                                db,
                                                schema,
                                                name,
                                                cat.kind,
                                              )
                                            }
                                          />
                                        ) : (
                                          <LazyObjectRows
                                            state={cat_state}
                                            empty_label={`No ${cat.label.toLowerCase()}.`}
                                            depth={3}
                                            collapsible_extra={
                                              cat.kind === "type"
                                            }
                                          />
                                        ))}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })
                      ))}
                  </div>
                );
              })}
            <TreeToggleRow
              kind="users"
              label="Users & Privileges"
              expanded={false}
              chevron={false}
              depth={0}
              onClick={() => openRolesTab(conn_id)}
            />
            <Button
              variant={"ghost"}
              type="button"
              className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex items-center gap-1.5 rounded py-1 text-left"
              style={depthPadding(0)}
              onClick={() => {
                setDdlName("");
                open_ddl("db-create");
              }}
            >
              <Plus className="size-3 shrink-0" />
              New database
            </Button>
          </div>
        ))}

      {is_mongo &&
        (pg_loading ? (
          <p className="text-muted-foreground px-1.5 py-1 text-xs">
            Loading databases…
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-xs">
            {(pg_databases ?? [])
              .filter((db) => !searching || mongo_db_match(db))
              .map((db) => {
                const db_id = `db:${db}`;
                const db_expanded = searching || tree_expanded.has(db_id);
                // Mongo has no separate "database" vs "schema" concept — the
                // second selector slot (`pg_active_schema`) is repurposed for
                // its one and only level, the active database.
                const is_active_db = db === pg_active_schema;
                const is_connected_db = connected_dbs.has(db);
                const cache_key = objectKey(db, "", "table");
                const db_row = (
                  <TreeToggleRow
                    kind="database"
                    icon_badge={is_connected_db}
                    label={db}
                    expanded={db_expanded}
                    active={is_active_db}
                    depth={0}
                    loading={
                      db_expanded &&
                      !is_active_db &&
                      (object_lists[cache_key] === "loading" ||
                        object_lists[cache_key] === undefined)
                    }
                    onClick={() => {
                      toggle_tree(db_id);
                      if (!db_expanded && !is_active_db) {
                        ensure_objects(db, "", "table");
                      }
                    }}
                    suffix={
                      db === default_db ? (
                        <span className="text-muted-foreground text-3xs font-medium tracking-wide uppercase">
                          Default
                        </span>
                      ) : undefined
                    }
                  />
                );
                const can_set_default = db !== default_db;
                const can_disconnect = is_active_db || is_connected_db;
                return (
                  <div key={db}>
                    {can_set_default || can_disconnect ? (
                      <ContextMenu>
                        <ContextMenuTrigger className="contents">
                          {db_row}
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          {can_set_default && (
                            <ContextMenuItem
                              onSelect={() => set_default_database(db)}
                            >
                              <Star className="size-4" />
                              Set as default
                            </ContextMenuItem>
                          )}
                          {/* Same rule as the Postgres branch above — the
                              last connected database falls through to the
                              real whole-connection teardown instead. */}
                          {can_disconnect && (
                            <ContextMenuItem
                              variant="destructive"
                              onSelect={() =>
                                connected_dbs.size === 1 &&
                                connected_dbs.has(db)
                                  ? set_disconnect_pending(conn_id)
                                  : disconnect_database(db)
                              }
                            >
                              <Unplug className="size-4" />
                              Disconnect
                            </ContextMenuItem>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    ) : (
                      db_row
                    )}
                    {db_expanded &&
                      (is_active_db ? (
                        <div style={depthPadding(1)}>
                          {active_tables_list_ui}
                        </div>
                      ) : (
                        <LazyTableRows
                          state={
                            searching
                              ? filterObjects(object_lists[cache_key], search_q)
                              : object_lists[cache_key]
                          }
                          empty_label="No collections."
                          kind="table"
                          depth={1}
                          on_duplicate={(name) =>
                            ask_duplicate_mongo({
                              name,
                              database: db,
                              sibling: { database: db, schema: "", kind: "table" },
                            })
                          }
                          on_drop={(name) =>
                            setConfirmDrop({
                              name,
                              kind: "table",
                              database: db,
                              sibling: { database: db, schema: "", kind: "table" },
                            })
                          }
                          on_open={(name) =>
                            void open_object(db, "", name, "table")
                          }
                        />
                      ))}
                  </div>
                );
              })}
          </div>
        ))}

      {!is_pg && !is_mongo && active_tables_list_ui}

      <DropDialog
        open={confirm_drop !== null}
        on_open_change={(open) => {
          if (!open && !dropping) setConfirmDrop(null);
        }}
        noun={noun}
        name={confirm_drop?.name ?? ""}
        error={dropdown_error}
        busy={dropping}
        on_confirm={() => void do_drop()}
      />

      <DuplicateDialog
        open={confirm_duplicate !== null}
        on_open_change={(open) => {
          if (!open && !dupe_submitting) {
            setConfirmDuplicate(null);
            setDupeError(null);
          }
        }}
        name={confirm_duplicate?.name ?? ""}
        value={dupe_name}
        on_value_change={setDupeName}
        error={dupe_error}
        submitting={dupe_submitting}
        on_confirm={() => void duplicate_table()}
      />

      <DuplicateMongoDialog
        open={confirm_duplicate_mongo !== null}
        on_open_change={(open) => {
          if (!open && !dupe_mongo_submitting) {
            setConfirmDuplicateMongo(null);
            setDupeMongoError(null);
          }
        }}
        name={confirm_duplicate_mongo?.name ?? ""}
        value={dupe_mongo_name}
        on_value_change={setDupeMongoName}
        copy_data={dupe_mongo_copy_data}
        on_copy_data_change={setDupeMongoCopyData}
        error={dupe_mongo_error}
        submitting={dupe_mongo_submitting}
        on_confirm={() => void duplicate_collection_mongo()}
      />

      <GrantsDialog
        open={grants_for !== null}
        on_open_change={(o) => !o && setGrantsFor(null)}
        name={grants_for}
        rows={grants_rows}
      />

      <DbSchemaDdlDialog
        dialog={ddl_dialog}
        name_value={ddl_name}
        on_name_change={setDdlName}
        cascade={ddl_cascade}
        on_cascade_change={setDdlCascade}
        busy={ddl_busy}
        error={ddl_error}
        on_cancel={() => setDdlDialog(null)}
        on_confirm={() => void run_ddl()}
      />
    </>
  );
}
