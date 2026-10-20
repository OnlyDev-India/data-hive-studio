import { useState } from "react";
import {
  createTemplate,
  treeMenuItems,
  TreeRowMenu,
  type TreeAction,
} from "@/shared/components/tree-menu";
import type { SchemaObjectKind } from "@/shared/api";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
import { filterObjects, objectKey } from "./catalog-tree-utils";
import {
  LazyObjectRows,
  LazyTableRows,
  TreeToggleRow,
} from "./catalog-tree-rows";
import { copy_name, type CatalogTree } from "./use-catalog-tree";
import { MYSQL_GROUPS, useMysqlTree } from "./use-mysql-tree";
import { MysqlDialogs } from "./mysql-dialogs";

/** The MySQL and MariaDB catalog tree (spec 0025 AC-5 to AC-7): the server
 *  row, its databases with their Tables, Views, Procedures, Functions,
 *  Triggers and Events, and Users & Privileges. There is no schema level. */
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
    refresh_database,
    refresh_everything,
    refresh_databases,
    open_object,
    collapse_all,
    compare_with,
    searching,
    search_q,
  } = tree;
  const my = useMysqlTree(tree);
  const open_structure = useStudioStore((s) => s.openStructure);
  const open_sql = useStudioStore((s) => s.openSql);
  const open_new_table = useStudioStore((s) => s.openNewTable);
  const open_table_dialog = useStudioStore((s) => s.openTableDialog);
  const open_roles = useStudioStore((s) => s.openRolesTab);
  const open_import = useStudioStore((s) => s.openImport);
  const open_relation_diagram = useStudioStore((s) => s.openRelationDiagram);
  const read_only = !!conn_info?.read_only;
  const [server_open, setServerOpen] = useState(true);
  const server_name = conn_info?.name ?? "Server";

  const list_of = (db: string, kind: SchemaObjectKind) => {
    const state = object_lists[objectKey(db, "", kind)];
    return searching ? filterObjects(state, search_q) : state;
  };
  const has_match = (db: string, kind: SchemaObjectKind) =>
    !!filterObjects(object_lists[objectKey(db, "", kind)], search_q)?.length;
  const matches = (db: string) =>
    db.toLowerCase().includes(search_q) ||
    MYSQL_GROUPS.some((g) => has_match(db, g.kind));

  const new_table_in = (db: string) =>
    open_new_table(conn_id, undefined, { database: my.db_arg(db) });
  const sql_tab_on = (db: string, text?: string) =>
    open_sql(conn_id, text, undefined, undefined, { database: my.db_arg(db) });

  const on_server_action = (a: TreeAction) => {
    switch (a) {
      case "refresh":
        refresh_databases();
        my.refresh_users();
        return refresh_everything();
      case "create":
        return my.setDialog({ kind: "create-db" });
      case "toggle_system_databases":
        return my.toggle_system();
      case "copy_name":
        return void copy_name(server_name);
      case "collapse_all":
        for (const db of pg_databases ?? []) collapse_all(`db:${db}`);
        return;
    }
  };

  const on_database_action = (db: string, a: TreeAction) => {
    switch (a) {
      case "refresh":
        return refresh_database(db);
      case "create":
        return new_table_in(db);
      case "sql_tab":
        return sql_tab_on(db);
      case "relation_diagram":
        return open_relation_diagram(conn_id, { database: my.db_arg(db) });
      case "copy_name":
        return void copy_name(db);
      case "expand_all":
        return my.expand_database(db);
      case "collapse_all":
        return collapse_all(`db:${db}`);
      case "drop_database":
        return my.setDialog({ kind: "drop-db", database: db });
    }
  };

  const on_group_action = (
    db: string,
    kind: SchemaObjectKind,
    a: TreeAction,
  ) => {
    if (a === "refresh")
      return refresh_sibling_objects({ database: db, schema: "", kind });
    if (a !== "create") return;
    if (kind === "table") return new_table_in(db);
    return sql_tab_on(db, createTemplate(kind, undefined, "mysql"));
  };

  /** One group's rows: tables and views get the table menu, the rest open
   *  their definition. */
  const group_rows = (db: string, kind: SchemaObjectKind, label: string) => {
    const state = list_of(db, kind);
    const empty_label = `No ${label.toLowerCase()}.`;
    const table_target = (table: string) => ({
      connId: conn_id,
      table,
      database: my.db_arg(db),
      objectKind: kind,
    });
    if (kind === "table" || kind === "view") {
      return (
        <LazyTableRows
          read_only={read_only}
          state={state}
          empty_label={empty_label}
          kind={kind}
          depth={3}
          on_open={(name) => void open_object(db, "", name, kind)}
          on_view_structure={(name) =>
            open_structure(conn_id, name, my.db_arg(db), undefined)
          }
          // Compare always names the database, so a side reopens on the
          // same one.
          on_compare={(name) => compare_with(name, db)}
          on_query_builder={
            conn_info &&
            ((name) =>
              openQueryBuilderFor(conn_info, {
                database: my.db_arg(db),
                table: name,
              }))
          }
          on_import={
            kind === "table"
              ? (name) =>
                  open_import({
                    connId: conn_id,
                    table: name,
                    database: my.db_arg(db),
                    onImported: () =>
                      refresh_sibling_objects({
                        database: db,
                        schema: "",
                        kind: "table",
                      }),
                  })
              : undefined
          }
          on_copy={(name) => void copy_name(name)}
          on_definition={
            kind === "view"
              ? (name) => my.open_definition(db, "view", name)
              : undefined
          }
          on_rename={
            kind === "table"
              ? (table) =>
                  my.setDialog({ kind: "rename-table", database: db, table })
              : undefined
          }
          on_duplicate={
            kind === "table"
              ? (name) =>
                  open_table_dialog({
                    kind: "duplicate",
                    ...table_target(name),
                  })
              : undefined
          }
          on_drop={(name) =>
            open_table_dialog({ kind: "drop", ...table_target(name) })
          }
        />
      );
    }
    return (
      <LazyObjectRows
        state={state}
        empty_label={empty_label}
        depth={3}
        on_copy={(name) => void copy_name(name)}
        on_open={(name) => my.open_definition(db, kind, name)}
      />
    );
  };

  return (
    <div className="text-small flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      <TreeRowMenu
        items={treeMenuItems({
          kind: "mysql_server",
          readOnly: read_only,
          showSystem: my.show_system,
        })}
        onPick={on_server_action}
      >
        <TreeToggleRow
          kind="server"
          label={server_name}
          expanded={server_open}
          depth={0}
          active
          onClick={() => setServerOpen((o) => !o)}
          suffix={
            my.show_system ? (
              <span className="text-muted-foreground text-caption font-medium">
                System shown
              </span>
            ) : undefined
          }
        />
      </TreeRowMenu>
      {server_open && (
        <>
          {my.databases.length === 0 && (
            <p className="text-muted-foreground px-1.5 py-1 pl-6">
              No databases.
            </p>
          )}
          {my.databases
            .filter((db) => !searching || matches(db))
            .map((db) => {
              const db_id = `db:${db}`;
              const db_expanded = searching || tree_expanded.has(db_id);
              return (
                <div key={db}>
                  <TreeRowMenu
                    items={treeMenuItems({
                      kind: "mysql_database",
                      readOnly: read_only,
                    })}
                    onPick={(a) => on_database_action(db, a)}
                  >
                    <TreeToggleRow
                      kind="database"
                      stateless
                      label={db}
                      expanded={db_expanded}
                      active={db === pg_current_db}
                      depth={1}
                      onClick={() => {
                        toggle_tree(db_id);
                        if (!db_expanded) ensure_objects(db, "", "table");
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
                  {db_expanded &&
                    MYSQL_GROUPS.filter(
                      (g) => !searching || has_match(db, g.kind),
                    ).map((g) => {
                      // Tables starts open, as it was before the other
                      // groups existed, so it tracks being closed; the
                      // rest start closed. Searching opens every group
                      // with a match.
                      const group_id =
                        g.kind === "table"
                          ? `${db_id}/kind:table:closed`
                          : `${db_id}/kind:${g.kind}`;
                      const state = object_lists[objectKey(db, "", g.kind)];
                      const expanded =
                        searching ||
                        tree_expanded.has(group_id) !== (g.kind === "table");
                      return (
                        <div key={g.kind}>
                          <TreeRowMenu
                            items={treeMenuItems({
                              kind: "mysql_group",
                              readOnly: read_only,
                              group: g.kind,
                            })}
                            onPick={(a) => on_group_action(db, g.kind, a)}
                          >
                            <TreeToggleRow
                              kind={g.kind}
                              label={g.label}
                              expanded={expanded}
                              depth={2}
                              loading={
                                state === "loading" ||
                                (expanded && state === undefined)
                              }
                              suffix={
                                Array.isArray(state) ? (
                                  <span className="text-muted-foreground text-caption">
                                    {state.length}
                                  </span>
                                ) : undefined
                              }
                              onClick={() => {
                                toggle_tree(group_id);
                                if (!expanded) ensure_objects(db, "", g.kind);
                              }}
                            />
                          </TreeRowMenu>
                          {expanded && group_rows(db, g.kind, g.label)}
                        </div>
                      );
                    })}
                </div>
              );
            })}
          {my.users_visible && (
            <TreeRowMenu
              items={treeMenuItems({
                kind: "mysql_users",
                readOnly: read_only,
              })}
              onPick={(a) =>
                a === "open"
                  ? open_roles(conn_id)
                  : a === "refresh"
                    ? my.refresh_users()
                    : open_sql(
                        conn_id,
                        createTemplate("role", undefined, "mysql"),
                      )
              }
            >
              <TreeToggleRow
                kind="users"
                label="Users & Privileges"
                expanded={false}
                chevron={false}
                depth={1}
                onClick={() => open_roles(conn_id)}
              />
            </TreeRowMenu>
          )}
        </>
      )}
      <MysqlDialogs
        conn_id={conn_id}
        dialog={my.dialog}
        on_close={() => my.setDialog(null)}
        on_create_database={my.create_database}
        on_drop_database={my.drop_database}
        on_rename_table={my.rename_table}
      />
    </div>
  );
}
