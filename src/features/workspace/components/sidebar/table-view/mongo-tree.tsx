import {
  treeMenuItems,
  TreeRowMenu,
  type TreeAction,
} from "@/shared/components/tree-menu";
import { useStudioStore } from "@/shared/store";
import { filterObjects, objectKey } from "./catalog-tree-utils";
import { TreeToggleRow, LazyTableRows } from "./catalog-tree-rows";
import { copy_name, type CatalogTree } from "./use-catalog-tree";

/** The Mongo catalog tree: one row per database, its collections below. */
export function MongoTree({
  tree,
  on_refresh,
}: {
  tree: CatalogTree;
  on_refresh: () => void;
}) {
  const {
    conn_id,
    conn_info,
    pg_databases,
    pg_active_schema,
    default_db,
    set_default_database,
    compare_with,
    object_lists,
    tree_expanded,
    toggle_tree,
    ensure_objects,
    refresh_sibling_objects,
    open_object,
    searching,
    search_q,
    mongo_db_match,
  } = tree;
  const open_structure = useStudioStore((s) => s.openStructure);
  const open_import = useStudioStore((s) => s.openImport);
  const open_table_dialog = useStudioStore((s) => s.openTableDialog);
  const open_aggregation = useStudioStore((s) => s.openAggregation);
  const open_relation_diagram = useStudioStore((s) => s.openRelationDiagram);
  const set_disconnect_pending = useStudioStore(
    (s) => s.setDisconnectPendingId,
  );
  const open_new_table = useStudioStore((s) => s.openNewTable);
  const open_console = useStudioStore((s) => s.openMongoConsole);

  const on_database_action = (db: string, a: TreeAction) => {
    switch (a) {
      case "refresh":
        return refresh_sibling_objects({
          database: db,
          schema: "",
          kind: "table",
        });
      case "create":
        return open_new_table(conn_id, undefined, { database: db });
      case "console":
        return open_console(conn_id, db);
      case "copy_name":
        return void copy_name(db);
      case "relation_diagram":
        return open_relation_diagram(conn_id, { database: db });
      case "set_default":
        return set_default_database(db);
      case "disconnect":
        // One client serves every Mongo database, so there is no per
        // database disconnect: any row ends the whole connection.
        return set_disconnect_pending(conn_id);
    }
  };

  return (
    <div className="text-small flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {(pg_databases ?? [])
        .filter((db) => !searching || mongo_db_match(db))
        .map((db) => {
          const db_id = `db:${db}`;
          const db_expanded = searching || tree_expanded.has(db_id);
          // Mongo has no separate "database" vs "schema" concept — the
          // second selector slot (`pg_active_schema`) is repurposed for its
          // one and only level, the active database.
          const is_active_db = db === pg_active_schema;
          const cache_key = objectKey(db, "", "table");
          const db_row = (
            <TreeToggleRow
              kind="database"
              stateless
              label={db}
              expanded={db_expanded}
              active={is_active_db}
              depth={0}
              loading={
                object_lists[cache_key] === "loading" ||
                (db_expanded && object_lists[cache_key] === undefined)
              }
              onClick={() => {
                toggle_tree(db_id);
                if (!db_expanded) {
                  ensure_objects(db, "", "table");
                }
              }}
              suffix={
                db === default_db ? (
                  <span className="text-muted-foreground text-caption font-medium">
                    Default
                  </span>
                ) : undefined
              }
            />
          );
          return (
            <div key={db}>
              <TreeRowMenu
                items={treeMenuItems({
                  kind: "mongo_database",
                  readOnly: !!conn_info?.read_only,
                  canSetDefault: db !== default_db,
                })}
                onPick={(a) => on_database_action(db, a)}
              >
                {db_row}
              </TreeRowMenu>
              {db_expanded && (
                <LazyTableRows
                  read_only={!!conn_info?.read_only}
                  state={
                    searching
                      ? filterObjects(object_lists[cache_key], search_q)
                      : object_lists[cache_key]
                  }
                  empty_label="No collections."
                  kind="table"
                  depth={1}
                  is_mongo
                  on_view_structure={(name) =>
                    open_structure(conn_id, name, db, "")
                  }
                  on_compare={(name) => compare_with(name, db)}
                  on_aggregate={(name) => open_aggregation(conn_id, db, name)}
                  on_copy={(name) => void copy_name(name)}
                  on_duplicate={(name) =>
                    open_table_dialog({
                      kind: "duplicate",
                      connId: conn_id,
                      table: name,
                      database: db,
                      objectKind: "table",
                    })
                  }
                  on_import={(name) =>
                    open_import({
                      connId: conn_id,
                      table: name,
                      database: is_active_db ? undefined : db,
                      onImported: on_refresh,
                    })
                  }
                  on_drop={(name) =>
                    open_table_dialog({
                      kind: "drop",
                      connId: conn_id,
                      table: name,
                      database: db,
                      objectKind: "table",
                    })
                  }
                  on_open={(name) => void open_object(db, "", name, "table")}
                />
              )}
            </div>
          );
        })}
    </div>
  );
}
