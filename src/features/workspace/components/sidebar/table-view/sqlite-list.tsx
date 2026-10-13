import type { SchemaObjectKind } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { refreshMatview } from "@/shared/api";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
import {
  createTemplate,
  treeMenuItems,
  TreeRowMenu,
} from "@/shared/components/tree-menu";
import { LazyTableRows, TreeToggleRow } from "./catalog-tree-rows";
import {
  copy_name,
  SQLITE_GROUP_ID,
  type CatalogTree,
} from "./use-catalog-tree";

const GROUPS = [
  { kind: "table", label: "Tables", empty: "No tables found." },
  { kind: "view", label: "Views", empty: "No views found." },
] as const;

/** A SQLite connection's sidebar: its tables and views, each under a
 *  collapsible header. */
export function SqliteList({
  tree,
  tables,
  active_table,
  reloading,
  on_open_table,
  on_refresh,
}: {
  tree: CatalogTree;
  tables: { name: string; kind: string }[] | null;
  active_table: string | null;
  reloading: boolean;
  on_open_table: (name: string) => void;
  on_refresh: () => void;
}) {
  const {
    conn_id,
    conn_info,
    compare_with,
    filtered_tables,
    selected_name,
    setSelectedName,
    list_ref,
    handle_nav_keys,
    tree_expanded,
    toggle_tree,
    searching,
  } = tree;
  const open_sql = useStudioStore((s) => s.openSql);
  const open_new_table = useStudioStore((s) => s.openNewTable);
  const open_structure = useStudioStore((s) => s.openStructure);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const open_import = useStudioStore((s) => s.openImport);
  const open_table_dialog = useStudioStore((s) => s.openTableDialog);
  const dialog_busy = useStudioStore((s) => s.tableDialogBusy);

  /** The kind a dialog target carries for a row of the list. */
  const object_kind_of = (name: string): SchemaObjectKind => {
    const k = filtered_tables.find((x) => x.name === name)?.kind;
    return k === "view"
      ? "view"
      : k === "matview" || k === "materialized_view"
        ? "materialized_view"
        : "table";
  };

  const rows_for = (
    state: { name: string; kind: string }[],
    empty_label: string,
  ) => (
    <LazyTableRows
      read_only={!!conn_info?.read_only}
      state={state}
      empty_label={empty_label}
      depth={1}
      selected_name={selected_name ?? active_table}
      disabled={dialog_busy}
      on_select={(name) => {
        setSelectedName(name);
        // Focus the list so arrow keys / Enter work right away
        // (WebKit does not focus buttons on click).
        list_ref.current?.focus();
      }}
      on_open={on_open_table}
      on_view_structure={(name) => open_structure(conn_id, name)}
      on_query_builder={
        conn_info && ((name) => openQueryBuilderFor(conn_info, { table: name }))
      }
      on_compare={(name) => compare_with(name)}
      on_copy={(name) => void copy_name(name)}
      on_duplicate={(name) =>
        open_table_dialog({
          kind: "duplicate",
          connId: conn_id,
          table: name,
          objectKind: object_kind_of(name),
          taken: (tables ?? []).map((t) => t.name),
        })
      }
      on_import={(name) =>
        open_import({
          connId: conn_id,
          table: name,
          onImported: on_refresh,
        })
      }
      on_drop={(name) =>
        open_table_dialog({
          kind: "drop",
          connId: conn_id,
          table: name,
          objectKind: object_kind_of(name),
        })
      }
      on_refresh_matview={(name) =>
        void (async () => {
          try {
            await refreshMatview(conn_id, name);
            on_refresh();
            push_notification({
              kind: "success",
              title: "Materialized view refreshed",
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
      }
    />
  );

  return (
    <div
      ref={list_ref}
      tabIndex={0}
      aria-busy={reloading}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto transition-opacity outline-none",
        // A reload of an already loaded list stays on screen and dims a
        // touch; only a true first load blanks it with skeletons.
        reloading && tables !== null && "opacity-60",
      )}
      onKeyDown={handle_nav_keys}
    >
      {tables === null ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-muted/60 rounded-control h-7 w-full animate-pulse"
            />
          ))}
        </div>
      ) : (
        GROUPS.map((g) => {
          const id = SQLITE_GROUP_ID[g.kind];
          const expanded = searching || tree_expanded.has(id);
          return (
            <div key={g.kind}>
              <TreeRowMenu
                items={treeMenuItems({
                  kind: "sqlite_group",
                  readOnly: !!conn_info?.read_only,
                  group: g.kind,
                })}
                onPick={(a) =>
                  a === "refresh"
                    ? on_refresh()
                    : g.kind === "table"
                      ? open_new_table(conn_id)
                      : open_sql(
                          conn_id,
                          createTemplate("view", undefined, "sqlite"),
                        )
                }
              >
                <TreeToggleRow
                  kind={g.kind}
                  label={g.label}
                  expanded={expanded}
                  depth={0}
                  loading={reloading}
                  onClick={() => toggle_tree(id)}
                />
              </TreeRowMenu>
              {expanded &&
                rows_for(
                  filtered_tables.filter(
                    (t) => (t.kind === "view") === (g.kind === "view"),
                  ),
                  g.empty,
                )}
            </div>
          );
        })
      )}
    </div>
  );
}
