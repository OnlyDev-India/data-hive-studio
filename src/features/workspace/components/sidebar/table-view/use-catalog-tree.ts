import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  createPgDatabase,
  createPgSchema,
  disconnectDatabase,
  dropPgDatabase,
  dropPgSchema,
  catalogOverview,
  listSchemasIn,
  listSchemaObjects,
  listExtensions,
  type SchemaObject,
  type SchemaObjectKind,
} from "@/shared/api";
import {
  stableConnKey,
  useStudioStore,
  type StudioStore,
} from "@/shared/store";
import { filterObjects, objectKey } from "./catalog-tree-utils";
import type { DdlDialogState } from "./catalog-dialogs";

/** Identifies a catalog tree's cached `object_lists` entry (a sibling
 *  database/non-active-schema row) that needs invalidating + refetching
 *  once a drop/duplicate action against it succeeds — that cache only ever
 *  populates/reads for non-active rows (see `ensure_objects`), so this is
 *  never needed for the primary list, which refreshes through
 *  `on_refresh()`/`tables` instead. `database` here is always the RAW name
 *  (never normalized to `undefined` for "own database" the way the
 *  API-call `database` field elsewhere is — `ensure_objects` does that
 *  normalization itself). */
export interface SiblingTarget {
  database: string;
  schema: string;
  kind: SchemaObjectKind;
}

/** The fixed set of category rows under every Postgres schema node — order
 *  matches the reference tree. Users & Privileges is NOT here — roles are
 *  cluster-wide, not owned by any one database, so it renders once per
 *  connection, a sibling of the database list itself, not nested under any
 *  database or schema. */
export const CATEGORIES: {
  kind: SchemaObjectKind;
  label: string;
}[] = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  { kind: "materialized_view", label: "Materialized Views" },
  { kind: "procedure", label: "Procedures" },
  { kind: "function", label: "Functions" },
  { kind: "sequence", label: "Sequences" },
  { kind: "type", label: "Types" },
];

export const SQLITE_GROUP_ID = {
  table: "sqlite/kind:table",
  view: "sqlite/kind:view",
} as const;

export interface CatalogTreeInput {
  conn_id: string;
  tables: { name: string; kind: string }[] | null;
  active_table: string | null;
  on_open_table: (name: string) => void;
  on_refresh: () => void;
  search: string;
  object_created?: {
    database: string;
    schema: string;
    kind: SchemaObjectKind;
  } | null;
}

export type CatalogTree = ReturnType<typeof useCatalogTree>;

/** Every fetch cache, expand state and helper the catalog tree needs, shared
 *  by the Postgres, Mongo and SQLite views. */
export function useCatalogTree({
  conn_id,
  tables,
  active_table,
  on_open_table,
  on_refresh,
  search,
  object_created,
}: CatalogTreeInput) {
  const [selected_name, setSelectedName] = useState<string | null>(null);
  const list_ref = useRef<HTMLDivElement>(null);

  const store_open_table = useStudioStore((s) => s.openTable);
  const store_open_mongo = useStudioStore((s) => s.openMongo);
  const push_notification = useStudioStore((s) => s.pushNotification);

  // ---- Postgres database / schema switcher -------------------------------
  const conn_kind = useStudioStore(
    (s: StudioStore) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const is_pg = conn_kind === "postgres";
  const is_mongo = conn_kind === "mongodb";
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
  const conn_info = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const open_compare = useStudioStore((s) => s.openCompare);
  /** A compare tab with this table as its left side. `database` undefined =
   *  the connection's own (Postgres); Mongo always names it. */
  const compare_with = (table: string, database?: string, schema?: string) => {
    if (!conn_info) return;
    open_compare(conn_id, {
      conn_id,
      conn_key: stableConnKey(conn_info),
      ...(database !== undefined ? { database } : {}),
      ...(schema !== undefined ? { schema } : {}),
      table,
    });
  };
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

  // Schema lists per browsed database (Postgres). Once a sibling's entry
  // exists, Postgres has already opened a real secondary pool for it (see
  // `PgAdapter::pool_for`), regardless of whether any table tab was ever
  // opened against it, so `connected_dbs` reads it.
  const [schema_lists, setSchemaLists] = useState<
    Record<string, "loading" | string[] | null>
  >({});
  // Object (collection) lists per browsed database/schema/kind.
  // `connected_dbs` below also reads this for Mongo, whose databases have no
  // separate schema level, so browsing a sibling's collections
  // (`ensure_objects`) is the thing that signals it's actually connected
  // there, not a schema fetch.
  const [object_lists, setObjectLists] = useState<
    Record<string, "loading" | SchemaObject[] | null>
  >({});
  // Installed extensions per browsed database (Postgres) — keyed by database
  // name alone: unlike `schema_lists`/`object_lists`, extensions aren't
  // schema-owned, so there's exactly one list per database, not one per
  // schema/kind combination.
  const [extension_lists, setExtensionLists] = useState<
    Record<string, "loading" | SchemaObject[] | null>
  >({});

  /** Every database this connection has an ACTUAL backend connection open
   *  for right now — the tree's green "connected" dot AND icon tint,
   *  distinct from `pg_current_db`/`pg_active_schema` (the connection's own/
   *  default database, shown BOLD). This is not just "has an open table
   *  tab": expanding a sibling database's schemas already opens a real
   *  secondary pool on the backend (`pool_for`) before any table is ever
   *  opened, so it counts as connected from that point — a fetch entry in
   *  `schema_lists` is the frontend's own signal that this happened.
   *  Recomputed live as tabs/browsing state changes, so a database's
   *  indicator reflects the connection actually being live. */
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
  // independently of any other, several at once.
  // SQLite's Tables and Views headers start open.
  const [tree_expanded, setTreeExpanded] = useState<Set<string>>(
    () => new Set([SQLITE_GROUP_ID.table, SQLITE_GROUP_ID.view]),
  );
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
   *  one level down. Keyed the same way as a schema row's id
   *  (`db:<database>/schema:<schema>`) for a direct lookup at render time.
   *  The primary database's active schema counts unconditionally, same
   *  convention as the primary database itself in `connected_dbs`. */
  const connected_schemas = useMemo(() => {
    const set = new Set<string>();
    if (is_pg) set.add(`db:${pg_current_db}/schema:${pg_active_schema}`);
    for (const tab of conn_tabs ?? []) {
      if (tab.kind !== "table") continue;
      const db = tab.database ?? pg_current_db;
      const schema =
        tab.schema ?? (db === pg_current_db ? pg_active_schema : "");
      if (schema) set.add(`db:${db}/schema:${schema}`);
    }
    return set;
  }, [conn_tabs, is_pg, pg_current_db, pg_active_schema]);

  useEffect(() => {
    // Mongo has no schemas — this same fetch gives it the database list and
    // the active DATABASE instead (via `overview.databases`/`active_schema`,
    // which the Mongo adapter reuses for its database switch).
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
  const ensure_extensions = useCallback(
    (database: string) => {
      setExtensionLists((cur) => {
        if (cur[database] !== undefined) return cur;
        listExtensions(conn_id, db_arg(database))
          .then((rows) =>
            setExtensionLists((c) => ({ ...c, [database]: rows })),
          )
          .catch(() => setExtensionLists((c) => ({ ...c, [database]: null })));
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
  const refresh_schemas = useCallback(
    (database: string) => {
      setSchemaLists((cur) => {
        if (!(database in cur)) return cur;
        const next = { ...cur };
        delete next[database];
        return next;
      });
      ensure_schemas(database);
    },
    [ensure_schemas],
  );
  const refresh_extensions = useCallback(
    (database: string) => {
      setExtensionLists((cur) => {
        if (!(database in cur)) return cur;
        const next = { ...cur };
        delete next[database];
        return next;
      });
      ensure_extensions(database);
    },
    [ensure_extensions],
  );
  /** Refetch every loaded object list whose key starts with `prefix`. */
  const refresh_objects_under = useCallback(
    (prefix: string) => {
      for (const key of Object.keys(object_lists)) {
        if (object_lists[key] === undefined || !key.startsWith(prefix))
          continue;
        const [database, schema, kind] = key.split("\n") as [
          string,
          string,
          SchemaObjectKind,
        ];
        refresh_sibling_objects({ database, schema, kind });
      }
    },
    [object_lists, refresh_sibling_objects],
  );
  /** A database row's Refresh: its schema and extension lists and every
   *  category list loaded under it, each only if already loaded. */
  const refresh_database = useCallback(
    (database: string) => {
      if (schema_lists[database] !== undefined) refresh_schemas(database);
      if (extension_lists[database] !== undefined) refresh_extensions(database);
      refresh_objects_under(`${database}\n`);
    },
    [
      schema_lists,
      extension_lists,
      refresh_schemas,
      refresh_extensions,
      refresh_objects_under,
    ],
  );
  /** Collapse a row and every row under it. */
  const collapse_all = useCallback((id: string) => {
    setTreeExpanded((cur) => {
      const next = new Set(
        [...cur].filter((x) => x !== id && !x.startsWith(`${id}/`)),
      );
      return next.size === cur.size ? cur : next;
    });
  }, []);
  /** Open a schema and all its category headers, fetching each list once. */
  const expand_all_categories = useCallback(
    (database: string, schema: string) => {
      const schema_id = `db:${database}/schema:${schema}`;
      setTreeExpanded((cur) => {
        const next = new Set(cur);
        next.add(schema_id);
        for (const cat of CATEGORIES) next.add(`${schema_id}/kind:${cat.kind}`);
        return next;
      });
      for (const cat of CATEGORIES) ensure_objects(database, schema, cat.kind);
    },
    [ensure_objects],
  );
  const open_ddl = (
    kind: "db-create" | "db-drop" | "schema-create" | "schema-drop",
    name = "",
    database?: string,
  ) => {
    setDdlError(null);
    setDdlCascade(false);
    setDdlDialog({ kind, name, database });
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
          await createPgSchema(
            conn_id,
            name,
            ddl_dialog.database === undefined
              ? undefined
              : db_arg(ddl_dialog.database),
          );
          if (ddl_dialog.database !== undefined)
            refresh_schemas(ddl_dialog.database);
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

  // A table/collection created outside this tree (New Table / New
  // Collection tabs) — refresh that node.
  useEffect(() => {
    if (!object_created) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external creation event, not deriving render state
    refresh_sibling_objects({
      database: object_created.database || pg_current_db,
      schema: object_created.schema,
      kind: object_created.kind,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `object_created` itself should retrigger this
  }, [object_created]);
  // A Drop or Duplicate from here or from a diagram: reload the node that
  // held the table. The change present at mount is old news.
  const catalog_change = useStudioStore((s) => s.catalogChanges[conn_id]);
  const seen_change = useRef(catalog_change?.seq);
  useEffect(() => {
    if (!catalog_change || catalog_change.seq === seen_change.current) return;
    seen_change.current = catalog_change.seq;
    const database = catalog_change.database ?? pg_current_db;
    const schema = catalog_change.schema ?? "";
    const own = is_mongo
      ? database === pg_current_db || database === pg_active_schema
      : database === pg_current_db && (!schema || schema === pg_active_schema);
    if (own) on_refresh();
    const kind = catalog_change.objectKind;
    if (object_lists[objectKey(database, schema, kind)] !== undefined)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external catalog change, not deriving render state
      refresh_sibling_objects({ database, schema, kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new change should retrigger this
  }, [catalog_change]);
  // The refresh button's actual handler: `on_refresh` alone only refetches
  // the primary database's flat `tables` list (see `SiblingTarget`) — every
  // OTHER already-loaded node (sibling databases, non-default schemas,
  // non-"table" categories) lives in `schema_lists`/`object_lists` here and
  // needs its own re-fetch, or a refresh would silently leave everything but
  // the primary list stale.
  const refresh_everything = useCallback(() => {
    on_refresh();
    for (const database of Object.keys(schema_lists)) {
      if (schema_lists[database] !== undefined) refresh_schemas(database);
    }
    refresh_objects_under("");
    for (const database of Object.keys(extension_lists)) {
      if (extension_lists[database] !== undefined) refresh_extensions(database);
    }
  }, [
    on_refresh,
    schema_lists,
    extension_lists,
    refresh_schemas,
    refresh_extensions,
    refresh_objects_under,
  ]);
  /** Open an object found anywhere in the catalog tree. Browsing never
   *  touches the connection's active database/schema, and opening one stays
   *  on THIS SAME connection either way: a sibling database's or a
   *  non-active schema's table opens with its own explicit
   *  `database`/`schema`, so several databases' and schemas' tables can stay
   *  open at once. Only the PRIMARY database's ACTIVE schema stays ambient
   *  (`database`/`schema` both `undefined`). */
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

  // ---- List filtering + keyboard navigation ------------------------------
  const filtered_tables = useMemo(() => {
    if (!tables) return [];
    const q = search.toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, search]);

  // ---- Catalog tree search: connected databases only, collapsed branches
  // included --------------------------------------------------------------
  // Search only ever looks at CONNECTED databases (see `connected_dbs`);
  // every other database is hidden entirely while searching rather than
  // searched into, so this never needs to fan out across the whole server.
  // Within those, it still reaches into collapsed schemas. Other categories
  // (Views, Procedures, Roles, …) aren't eagerly fetched for this, so
  // they're unaffected by search.
  const searching = search.trim().length > 0;
  const search_q = search.trim().toLowerCase();

  // Eagerly fetch every connected database's schemas, then each of THEIR
  // Tables. `ensure_schemas`/`ensure_objects` are no-ops once cached, so
  // re-running this on every keystroke just converges.
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

  /** Is `database`/`schema` (or its Tables) a search match? */
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

  /** The rows Up/Down walk, in screen order. On SQLite that is the Tables
   *  group then the Views group, skipping a collapsed one. */
  const nav_rows = useMemo(() => {
    if (is_pg || is_mongo) return filtered_tables;
    const shown = (g: "table" | "view") =>
      searching || tree_expanded.has(SQLITE_GROUP_ID[g]);
    return [
      ...(shown("table")
        ? filtered_tables.filter((t) => t.kind !== "view")
        : []),
      ...(shown("view")
        ? filtered_tables.filter((t) => t.kind === "view")
        : []),
    ];
  }, [is_pg, is_mongo, searching, tree_expanded, filtered_tables]);

  const move_selection = useCallback(
    (delta: number) => {
      if (!tables) return;
      if (nav_rows.length === 0) return;
      const idx = nav_rows.findIndex((t) => t.name === selected_name);
      const next =
        idx < 0 ? 0 : Math.min(nav_rows.length - 1, Math.max(0, idx + delta));
      setSelectedName(nav_rows[next].name);
    },
    [tables, nav_rows, selected_name],
  );

  const open_selected = useCallback(() => {
    const name = selected_name ?? nav_rows[0]?.name;
    if (!name) return;
    if (is_mongo) {
      // The tables list comes from the active database.
      store_open_mongo(conn_id, pg_current_db, name);
    } else {
      on_open_table(name);
    }
  }, [
    nav_rows,
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

  return {
    conn_id,
    conn_info,
    is_pg,
    is_mongo,
    pg_databases,
    pg_current_db,
    pg_active_schema,
    default_db,
    set_default_database,
    close_schema_tabs,
    compare_with,
    schema_lists,
    object_lists,
    extension_lists,
    connected_dbs,
    connected_schemas,
    tree_expanded,
    toggle_tree,
    disconnect_database,
    ddl_dialog,
    setDdlDialog,
    ddl_name,
    setDdlName,
    ddl_cascade,
    setDdlCascade,
    ddl_busy,
    ddl_error,
    open_ddl,
    run_ddl,
    db_arg,
    ensure_schemas,
    ensure_extensions,
    ensure_objects,
    refresh_sibling_objects,
    refresh_schemas,
    refresh_extensions,
    refresh_objects_under,
    refresh_database,
    collapse_all,
    expand_all_categories,
    refresh_everything,
    open_object,
    filtered_tables,
    searching,
    search_q,
    schema_table_match,
    db_table_match,
    mongo_db_match,
    selected_name,
    setSelectedName,
    list_ref,
    handle_nav_keys,
  };
}

export async function copy_name(name: string) {
  try {
    await navigator.clipboard.writeText(name);
  } catch {
    // Clipboard unavailable in this webview; ignore.
  }
}
