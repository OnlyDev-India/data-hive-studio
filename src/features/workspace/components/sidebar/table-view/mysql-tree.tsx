import {
  treeMenuItems,
  TreeRowMenu,
  type TreeAction,
} from "@/shared/components/tree-menu";
import { useStudioStore } from "@/shared/store";
import { filterObjects, objectKey } from "./catalog-tree-utils";
import { LazyTableRows, TreeToggleRow } from "./catalog-tree-rows";
import { copy_name, type CatalogTree } from "./use-catalog-tree";

/** Hidden unless "Show system databases" is on (spec 0025 AC-6; the toggle
 *  arrives with the full sidebar, build plan slice 6). */
export const MYSQL_SYSTEM_DATABASES = [
  "mysql",
  "sys",
  "information_schema",
  "performance_schema",
];

/** The MySQL and MariaDB catalog tree (spec 0025 AC-5): one row per
 *  database, its tables below. There is no schema level. */
export function MySqlTree({ tree }: { tree: CatalogTree }) {
  const {
    conn_id,
    conn_info,
    pg_databases,
    pg_current_db,
    object_lists,
    tree_expanded,
    toggle_tree,
    ensure_objects,
    refresh_sibling_objects,
    open_object,
    collapse_all,
    searching,
    search_q,
  } = tree;
  const open_structure = useStudioStore((s) => s.openStructure);
  const open_sql = useStudioStore((s) => s.openSql);

  const databases = (pg_databases ?? []).filter(
    (db) => !MYSQL_SYSTEM_DATABASES.includes(db.toLowerCase()),
  );
  const matches = (db: string) =>
    db.toLowerCase().includes(search_q) ||
    !!filterObjects(object_lists[objectKey(db, "", "table")], search_q)?.length;

  const on_database_action = (db: string, a: TreeAction) => {
    switch (a) {
      case "refresh":
        return refresh_sibling_objects({
          database: db,
          schema: "",
          kind: "table",
        });
      case "sql_tab":
        return open_sql(conn_id, undefined, undefined, undefined, {
          database: db === pg_current_db ? undefined : db,
        });
      case "copy_name":
        return void copy_name(db);
      case "collapse_all":
        return collapse_all(`db:${db}`);
    }
  };

  return (
    <div className="text-small flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {databases.length === 0 && (
        <p className="text-muted-foreground px-1.5 py-1">No databases.</p>
      )}
      {databases
        .filter((db) => !searching || matches(db))
        .map((db) => {
          const db_id = `db:${db}`;
          const expanded = searching || tree_expanded.has(db_id);
          const cache_key = objectKey(db, "", "table");
          return (
            <div key={db}>
              <TreeRowMenu
                items={treeMenuItems({ kind: "mysql_database" })}
                onPick={(a) => on_database_action(db, a)}
              >
                <TreeToggleRow
                  kind="database"
                  stateless
                  label={db}
                  expanded={expanded}
                  active={db === pg_current_db}
                  depth={0}
                  loading={
                    object_lists[cache_key] === "loading" ||
                    (expanded && object_lists[cache_key] === undefined)
                  }
                  onClick={() => {
                    toggle_tree(db_id);
                    if (!expanded) ensure_objects(db, "", "table");
                  }}
                  suffix={
                    db === pg_current_db ? (
                      <span className="text-muted-foreground text-caption font-medium">
                        Default
                      </span>
                    ) : undefined
                  }
                />
              </TreeRowMenu>
              {expanded && (
                <LazyTableRows
                  read_only={!!conn_info?.read_only}
                  state={
                    searching
                      ? filterObjects(object_lists[cache_key], search_q)
                      : object_lists[cache_key]
                  }
                  empty_label="No tables."
                  kind="table"
                  depth={1}
                  on_view_structure={(name) =>
                    open_structure(
                      conn_id,
                      name,
                      db === pg_current_db ? undefined : db,
                      undefined,
                    )
                  }
                  on_copy={(name) => void copy_name(name)}
                  on_open={(name) => void open_object(db, "", name, "table")}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}
