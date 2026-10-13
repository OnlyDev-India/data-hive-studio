import { Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  createTemplate,
  treeMenuItems,
  TreeRowMenu,
  type TreeAction,
} from "@/shared/components/tree-menu";
import { refreshMatview, type SchemaObjectKind } from "@/shared/api";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
import { depthPadding, filterObjects, objectKey } from "./catalog-tree-utils";
import {
  TreeToggleRow,
  LazyObjectRows,
  LazyTableRows,
} from "./catalog-tree-rows";
import { CATEGORIES, copy_name, type CatalogTree } from "./use-catalog-tree";

/** The Postgres catalog tree: databases, their schemas and categories,
 *  Extensions, and Users & Privileges. */
export function PgTree({
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
    open_ddl,
    setDdlName,
    ensure_schemas,
    ensure_extensions,
    ensure_objects,
    refresh_sibling_objects,
    refresh_extensions,
    refresh_objects_under,
    refresh_database,
    collapse_all,
    expand_all_categories,
    open_object,
    searching,
    search_q,
    schema_table_match,
    db_table_match,
  } = tree;
  const open_structure = useStudioStore((s) => s.openStructure);
  const openRolesTab = useStudioStore((s) => s.openRolesTab);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const open_import = useStudioStore((s) => s.openImport);
  const open_table_dialog = useStudioStore((s) => s.openTableDialog);
  const open_relation_diagram = useStudioStore((s) => s.openRelationDiagram);
  const set_disconnect_pending = useStudioStore(
    (s) => s.setDisconnectPendingId,
  );
  const open_sql = useStudioStore((s) => s.openSql);
  const open_new_table = useStudioStore((s) => s.openNewTable);
  const read_only = !!conn_info?.read_only;

  /** A SQL tab on `db`, seeded with `text`. */
  const sql_tab_on = (db: string, text?: string) =>
    open_sql(conn_id, text, undefined, undefined, {
      database: db === pg_current_db ? undefined : db,
    });
  const new_table_in = (db: string, schema: string) =>
    open_new_table(conn_id, undefined, {
      database: db === pg_current_db ? undefined : db,
      schema,
    });

  const on_database_action = (db: string, a: TreeAction) => {
    switch (a) {
      case "refresh":
        return refresh_database(db);
      case "create":
        setDdlName("");
        return open_ddl("schema-create", "", db);
      case "sql_tab":
        return sql_tab_on(db);
      case "copy_name":
        return void copy_name(db);
      case "collapse_all":
        return collapse_all(`db:${db}`);
      case "set_default":
        return set_default_database(db);
      case "disconnect":
        // Any database but the LAST one connected just drops that one. The
        // last one falls through to the whole connection teardown, same as
        // the title bar's Disconnect, with its confirmation.
        return connected_dbs.size === 1 && connected_dbs.has(db)
          ? set_disconnect_pending(conn_id)
          : disconnect_database(db);
    }
  };

  const on_schema_action = (db: string, schema: string, a: TreeAction) => {
    const schema_id = `db:${db}/schema:${schema}`;
    switch (a) {
      case "refresh":
        return refresh_objects_under(`${db}\n${schema}\n`);
      case "create":
        return new_table_in(db, schema);
      case "sql_tab":
        return sql_tab_on(db, createTemplate("search_path", schema, "pg"));
      case "expand_all":
        return expand_all_categories(db, schema);
      case "copy_name":
        return void copy_name(schema);
      case "collapse_all":
        return collapse_all(schema_id);
      case "relation_diagram":
        return open_relation_diagram(conn_id, {
          database: db === pg_current_db ? undefined : db,
          schema,
        });
      case "close_tabs":
        return close_schema_tabs(db, schema);
      case "drop_schema":
        return open_ddl("schema-drop", schema);
    }
  };

  const on_category_action = (
    db: string,
    schema: string,
    kind: SchemaObjectKind,
    a: TreeAction,
  ) => {
    if (a === "refresh")
      return refresh_sibling_objects({ database: db, schema, kind });
    if (a !== "create") return;
    if (kind === "table") return new_table_in(db, schema);
    sql_tab_on(db, createTemplate(kind, schema, "pg"));
  };

  return (
    <div className="text-small flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {(pg_databases ?? [])
        .filter((db) => !searching || db_table_match(db))
        .map((db) => {
          const db_id = `db:${db}`;
          const db_expanded = searching || tree_expanded.has(db_id);
          const is_current_db = db === pg_current_db;
          const is_connected_db = connected_dbs.has(db);
          // Every database's schema list lives in `schema_lists` and is
          // fetched on first expand — primary and sibling alike.
          const schemas_state: "loading" | string[] | null =
            schema_lists[db] ?? "loading";
          const visible_schemas: string[] | null = Array.isArray(schemas_state)
            ? searching
              ? schemas_state.filter((s) => schema_table_match(db, s))
              : schemas_state
            : null;
          // Extensions aren't schema-owned (same set regardless of which
          // schema you're looking at), so this is a sibling of the schema
          // list itself, not nested under any one schema.
          const ext_id = `${db_id}/extensions`;
          const ext_expanded = tree_expanded.has(ext_id);
          const ext_state = extension_lists[db];
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
                  kind: "pg_database",
                  readOnly: read_only,
                  canSetDefault: db !== default_db,
                  canDisconnect: is_current_db || is_connected_db,
                })}
                onPick={(a) => on_database_action(db, a)}
              >
                {db_row}
              </TreeRowMenu>
              {db_expanded &&
                schemas_state !== "loading" &&
                (visible_schemas === null ? (
                  <p
                    className="text-muted-foreground text-body py-1"
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
                        <TreeRowMenu
                          items={treeMenuItems({
                            kind: "pg_schema",
                            readOnly: read_only,
                            isCurrentDb: is_current_db,
                            isActiveSchema: is_active_schema,
                            isConnectedSchema: is_connected_schema,
                            isPublic: schema === "public",
                          })}
                          onPick={(a) => on_schema_action(db, schema, a)}
                        >
                          {schema_row}
                        </TreeRowMenu>
                        {schema_expanded &&
                          CATEGORIES.map((cat) => {
                            const cat_id = `${schema_id}/kind:${cat.kind}`;
                            // Only Tables is eagerly fetched for search (see
                            // `schema_table_match`), so it's the only category
                            // search force-expands.
                            const cat_expanded =
                              (searching && cat.kind === "table") ||
                              tree_expanded.has(cat_id);
                            const cache_key = objectKey(db, schema, cat.kind);
                            const cat_state =
                              searching && cat.kind === "table"
                                ? filterObjects(
                                    object_lists[cache_key],
                                    search_q,
                                  )
                                : object_lists[cache_key];
                            const db_target =
                              db === pg_current_db ? undefined : db;
                            return (
                              <div key={cat.kind}>
                                <TreeRowMenu
                                  items={treeMenuItems({
                                    kind: "pg_category",
                                    readOnly: read_only,
                                    category: cat.kind,
                                  })}
                                  onPick={(a) =>
                                    on_category_action(db, schema, cat.kind, a)
                                  }
                                >
                                  <TreeToggleRow
                                    kind={cat.kind}
                                    label={cat.label}
                                    expanded={cat_expanded}
                                    depth={2}
                                    loading={
                                      cat_state === "loading" ||
                                      (cat_expanded && cat_state === undefined)
                                    }
                                    onClick={() => {
                                      toggle_tree(cat_id);
                                      if (!cat_expanded) {
                                        ensure_objects(db, schema, cat.kind);
                                      }
                                    }}
                                  />
                                </TreeRowMenu>
                                {cat_expanded &&
                                  (cat.kind === "table" ||
                                  cat.kind === "view" ||
                                  cat.kind === "materialized_view" ? (
                                    <LazyTableRows
                                      read_only={!!conn_info?.read_only}
                                      state={cat_state}
                                      empty_label={`No ${cat.label.toLowerCase()}.`}
                                      depth={3}
                                      kind={cat.kind}
                                      on_view_structure={(name) =>
                                        open_structure(
                                          conn_id,
                                          name,
                                          db_target,
                                          schema,
                                        )
                                      }
                                      on_compare={(name) =>
                                        compare_with(name, db_target, schema)
                                      }
                                      on_query_builder={
                                        conn_info &&
                                        ((name) =>
                                          openQueryBuilderFor(conn_info, {
                                            database: db_target,
                                            schema,
                                            table: name,
                                          }))
                                      }
                                      on_view_grants={(name) =>
                                        open_table_dialog({
                                          kind: "grants",
                                          connId: conn_id,
                                          table: name,
                                          database: db_target,
                                          schema,
                                          objectKind: cat.kind,
                                        })
                                      }
                                      on_copy={(name) => void copy_name(name)}
                                      on_refresh_matview={
                                        cat.kind === "materialized_view"
                                          ? (name) =>
                                              void (async () => {
                                                try {
                                                  await refreshMatview(
                                                    conn_id,
                                                    name,
                                                    db_target,
                                                    schema,
                                                  );
                                                  refresh_sibling_objects({
                                                    database: db,
                                                    schema,
                                                    kind: cat.kind,
                                                  });
                                                  push_notification({
                                                    kind: "success",
                                                    title:
                                                      "Materialized view refreshed",
                                                    detail: name,
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
                                      on_duplicate={(name) =>
                                        open_table_dialog({
                                          kind: "duplicate",
                                          connId: conn_id,
                                          table: name,
                                          database: db_target,
                                          schema,
                                          objectKind: cat.kind,
                                        })
                                      }
                                      on_import={(name) =>
                                        open_import({
                                          connId: conn_id,
                                          table: name,
                                          database: db_target,
                                          schema,
                                          onImported: on_refresh,
                                        })
                                      }
                                      on_drop={(name) =>
                                        open_table_dialog({
                                          kind: "drop",
                                          connId: conn_id,
                                          table: name,
                                          database: db_target,
                                          schema,
                                          objectKind: cat.kind,
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
                                      collapsible_extra={cat.kind === "type"}
                                      on_copy={(name) => void copy_name(name)}
                                    />
                                  ))}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })
                ))}
              {db_expanded && (
                <div>
                  <TreeRowMenu
                    items={treeMenuItems({
                      kind: "pg_extensions",
                      readOnly: read_only,
                    })}
                    onPick={(a) =>
                      a === "refresh"
                        ? refresh_extensions(db)
                        : sql_tab_on(
                            db,
                            createTemplate("extension", undefined, "pg"),
                          )
                    }
                  >
                    <TreeToggleRow
                      kind="extension"
                      label="Extensions"
                      expanded={ext_expanded}
                      depth={1}
                      loading={
                        ext_state === "loading" ||
                        (ext_expanded && ext_state === undefined)
                      }
                      onClick={() => {
                        toggle_tree(ext_id);
                        if (!ext_expanded) ensure_extensions(db);
                      }}
                    />
                  </TreeRowMenu>
                  {ext_expanded && (
                    <LazyObjectRows
                      state={ext_state}
                      empty_label="No extensions."
                      depth={2}
                      on_copy={(name) => void copy_name(name)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      <TreeRowMenu
        items={treeMenuItems({ kind: "pg_roles", readOnly: read_only })}
        onPick={(a) =>
          a === "open"
            ? openRolesTab(conn_id)
            : // Roles are server wide, so the primary database is fine.
              open_sql(conn_id, createTemplate("role", undefined, "pg"))
        }
      >
        <TreeToggleRow
          kind="users"
          label="Users & Privileges"
          expanded={false}
          chevron={false}
          depth={0}
          onClick={() => openRolesTab(conn_id)}
        />
      </TreeRowMenu>
      <Button
        variant={"ghost"}
        type="button"
        className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex items-center gap-1.5 rounded py-1 text-left"
        style={depthPadding(0)}
        disabled={!!conn_info?.read_only}
        title={
          conn_info?.read_only
            ? "Read only connection: this change is refused"
            : undefined
        }
        onClick={() => {
          setDdlName("");
          open_ddl("db-create");
        }}
      >
        <Plus className="size-3 shrink-0" />
        New database
      </Button>
    </div>
  );
}
