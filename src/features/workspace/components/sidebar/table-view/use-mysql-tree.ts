import { useCallback, useEffect, useState } from "react";
import {
  applySchemaOps,
  createPgDatabase,
  dropPgDatabase,
  listRoles,
  MYSQL_SYSTEM_DATABASES,
  objectDefinition,
  type SchemaObjectKind,
} from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import type { CatalogTree } from "./use-catalog-tree";
import type { MysqlDialog } from "./mysql-dialogs";

/** The groups under every MySQL database, in tree order (spec 0025 AC-5). */
export const MYSQL_GROUPS: { kind: SchemaObjectKind; label: string }[] = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  { kind: "procedure", label: "Procedures" },
  { kind: "function", label: "Functions" },
  { kind: "trigger", label: "Triggers" },
  { kind: "event", label: "Events" },
];

/** What the MySQL tree adds on top of the shared catalog tree: the system
 *  database toggle, the Users & Privileges row's visibility, definition
 *  tabs, and the database and rename dialogs. */
export function useMysqlTree(tree: CatalogTree) {
  const {
    conn_id,
    pg_databases,
    pg_current_db,
    ensure_objects,
    refresh_sibling_objects,
    refresh_databases,
    close_database_tabs,
  } = tree;
  const show_system = useStudioStore(
    (s) => s.showSystemDatabases[conn_id] === true,
  );
  const set_show_system = useStudioStore((s) => s.setShowSystemDatabases);
  const open_sql = useStudioStore((s) => s.openSql);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const [dialog, setDialog] = useState<MysqlDialog | null>(null);

  /** `undefined` for the connection's own default database. */
  const db_arg = useCallback(
    (db: string) => (db === pg_current_db ? undefined : db),
    [pg_current_db],
  );

  const databases = (pg_databases ?? []).filter(
    (db) => show_system || !MYSQL_SYSTEM_DATABASES.includes(db.toLowerCase()),
  );

  // Users & Privileges shows only when the accounts can be read: the
  // backend answers a privilege error with an empty list, so empty or
  // failed both hide the row, with no toast (AC-5).
  const [users_rev, setUsersRev] = useState(0);
  const [users_visible, setUsersVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listRoles(conn_id).then(
      (rows) => !cancelled && setUsersVisible(rows.length > 0),
      () => !cancelled && setUsersVisible(false),
    );
    return () => {
      cancelled = true;
    };
  }, [conn_id, users_rev]);
  const refresh_users = () => setUsersRev((r) => r + 1);

  /** Opens the object's `SHOW CREATE` text in a SQL tab on its database. */
  const open_definition = (db: string, kind: SchemaObjectKind, name: string) =>
    void objectDefinition(conn_id, kind, name, db_arg(db)).then(
      (text) =>
        open_sql(conn_id, text, undefined, undefined, {
          database: db_arg(db),
        }),
      (e: unknown) =>
        push_notification({
          kind: "error",
          title: `Couldn't show the definition of ${name}`,
          detail: String(e),
        }),
    );

  /** Expand a database and every group under it, fetching each list once. */
  const expand_database = (db: string) => {
    // Tables is open unless closed, so only the other groups get an id.
    tree.collapse_all(`db:${db}/kind:table:closed`);
    tree.expand_ids([
      `db:${db}`,
      ...MYSQL_GROUPS.filter((g) => g.kind !== "table").map(
        (g) => `db:${db}/kind:${g.kind}`,
      ),
    ]);
    for (const g of MYSQL_GROUPS) ensure_objects(db, "", g.kind);
  };

  const create_database = async (
    name: string,
    charset: string,
    collation: string,
  ) => {
    await createPgDatabase(conn_id, name, { charset, collation });
    refresh_databases();
  };

  const drop_database = async (db: string) => {
    await dropPgDatabase(conn_id, db);
    close_database_tabs(db);
    refresh_databases();
  };

  const rename_table = async (db: string, table: string, to: string) => {
    await applySchemaOps(
      conn_id,
      [{ kind: "rename_table", table, new_name: to }],
      db_arg(db),
    );
    refresh_sibling_objects({ database: db, schema: "", kind: "table" });
  };

  return {
    databases,
    show_system,
    toggle_system: () => set_show_system(conn_id, !show_system),
    users_visible,
    refresh_users,
    db_arg,
    open_definition,
    expand_database,
    dialog,
    setDialog,
    create_database,
    drop_database,
    rename_table,
  };
}
