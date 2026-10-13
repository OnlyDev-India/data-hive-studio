import { Network, RefreshCw, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { usePendingGuardChange } from "@/features/connections";
import type { SchemaObjectKind } from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import { DbSchemaDdlDialog } from "./catalog-dialogs";
import { useCatalogTree } from "./use-catalog-tree";
import { PgTree } from "./pg-tree";
import { MongoTree } from "./mongo-tree";
import { SqliteList } from "./sqlite-list";

/** Database browser: the search row, then the Postgres or Mongo catalog
 *  tree or the SQLite table list, and the database/schema dialog. */
export function TablesBrowser({
  conn_id,
  tables,
  active_table,
  on_open_table,
  on_refresh,
  reloading = false,
  search_value,
  on_search_change,
  object_created,
}: {
  conn_id: string;
  tables: { name: string; kind: string }[] | null;
  active_table: string | null;
  on_open_table: (name: string) => void;
  on_refresh: () => void;
  reloading?: boolean;
  search_value: string;
  on_search_change: (v: string) => void;
  /** A table/collection was just created somewhere outside this tree (New
   *  Table / Mongo's New Collection tab) — a NEW object reference every
   *  time one succeeds, so the tree re-fires even for a repeat creation
   *  with identical fields. `database`/`schema` empty string = this
   *  connection's own database / no schema (Mongo, or SQLite). */
  object_created?: {
    database: string;
    schema: string;
    kind: SchemaObjectKind;
  } | null;
}) {
  const search = search_value;
  const tree = useCatalogTree({
    conn_id,
    tables,
    active_table,
    on_open_table,
    on_refresh,
    search,
    object_created,
  });
  const { conn_info, is_pg, is_mongo, pg_databases } = tree;
  const open_relation_diagram = useStudioStore((s) => s.openRelationDiagram);
  // Saved settings changed while this connection was open (spec 0007): the
  // live one keeps its old flag and label until it reconnects.
  const pending_change = usePendingGuardChange(conn_id);

  const loading = tables === null || reloading;
  const pg_loading = (is_pg || is_mongo) && pg_databases === null;

  return (
    <>
      {/* Search stays pinned at the top of the sidebar. It searches and
          selects within the active list (the one wired to keyboard nav). A
          connection with a pending guard change gets a slim header row with
          its name above it (spec 0007). */}
      {conn_info && pending_change && (
        <div
          data-slot="sidebar-conn-flags"
          className="text-small flex min-w-0 items-center gap-1.5 pr-2"
        >
          <span className="min-w-0 truncate font-medium">{conn_info.name}</span>
          {pending_change && (
            <span
              role="status"
              title="You saved new read only or environment settings for this connection. They apply when you reconnect."
              className="text-warning-dark text-caption ml-auto shrink-0"
            >
              Change pending, reconnect to apply
            </span>
          )}
        </div>
      )}
      {/* The sidebar's own wrapper dropped its right padding so the tree's
          scrollbar can hug the edge (see sidebar/index.tsx) — this row isn't
          scrollable, so it keeps its own inset here instead. */}
      <div className="flex items-center gap-1 pr-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="text-small pr-2 pl-7"
            placeholder="Search tables…"
            value={search}
            disabled={loading}
            onChange={(e) => on_search_change(e.target.value)}
            onKeyDown={tree.handle_nav_keys}
          />
        </div>
        {!is_pg && !is_mongo && (
          <Button
            size="iconSm"
            variant="outline"
            aria-label="Open relation diagram"
            title="Open relation diagram"
            className="size-7"
            disabled={loading}
            onClick={() => open_relation_diagram(conn_id)}
          >
            <Network className="size-3.5" />
          </Button>
        )}
        <Button
          size="iconSm"
          variant="outline"
          aria-label={reloading ? "Refreshing tables" : "Refresh tables"}
          title="Reload all tables"
          className="size-7"
          disabled={reloading}
          onClick={tree.refresh_everything}
        >
          <RefreshCw className={cn("size-3.5", reloading && "animate-spin")} />
        </Button>
      </div>

      {(is_pg || is_mongo) && pg_loading && (
        <p className="text-muted-foreground text-small px-1.5 py-1">
          Loading databases…
        </p>
      )}
      {is_pg && !pg_loading && <PgTree tree={tree} on_refresh={on_refresh} />}
      {is_mongo && !pg_loading && (
        <MongoTree tree={tree} on_refresh={on_refresh} />
      )}
      {!is_pg && !is_mongo && (
        <SqliteList
          tree={tree}
          tables={tables}
          active_table={active_table}
          reloading={reloading}
          on_open_table={on_open_table}
          on_refresh={on_refresh}
        />
      )}

      <DbSchemaDdlDialog
        dialog={tree.ddl_dialog}
        name_value={tree.ddl_name}
        on_name_change={tree.setDdlName}
        cascade={tree.ddl_cascade}
        on_cascade_change={tree.setDdlCascade}
        busy={tree.ddl_busy}
        error={tree.ddl_error}
        on_cancel={() => tree.setDdlDialog(null)}
        on_confirm={() => void tree.run_ddl()}
      />
    </>
  );
}
