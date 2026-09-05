import { useEffect, useState, useCallback } from "react";
import { tableSchema, type TableSchema } from "@/shared/api";
import {
  FilterBar,
  type FilterColumn,
} from "@/shared/components/data-grid/filter-bar";
import { Grid } from "@/shared/components/data-grid/grid";
import { ModeTabs } from "./mode-tabs";
import { MongoSchemaEditor } from "@/features/schema-designer";
import { useStudioStore, usePaneMode } from "@/shared/store";
import type { GridFilter } from "@/shared/components/data-grid/types";
import { AlertCircle, Loader2, KeyRound } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function MongoCollectionPane({
  conn_id,
  tab_key,
  collection,
  on_modified,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  collection: string;
  on_modified: () => void;
}) {
  // Subscribe to the grid's bridge so the pane re-renders with its live state
  // (rows / buffered edits / loading) — the grid is the only data view now.
  const gridBridge = useStudioStore((s) => s.gridBridges[tab_key]);
  const mode = usePaneMode(conn_id, tab_key);
  const setPaneMode = useStudioStore((s) => s.setPaneMode);
  const setMode = useCallback(
    (m: "data" | "schema") => setPaneMode(conn_id, tab_key, m),
    [setPaneMode, conn_id, tab_key],
  );

  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [failed, setFailed] = useState(false);
  const [fail_error, setFailError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const [custom_where, setCustomWhere] = useState("");
  const [refresh_rev, setRefreshRev] = useState(0);
  const [schema_rev, setSchemaRev] = useState(0);

  // A plain action-bar Refresh re-reads this same collection's data. It must
  // re-bump the grid revision (refetch) but must NOT signal the sidebar
  // (on_modified -> bumpTables would spin its tree loading).
  const refresh_data_only = useCallback(() => setRefreshRev((r) => r + 1), []);

  // Applying an index change needs a fresh schema (new/dropped index shows
  // up in the Indexes panel) — bumping this re-runs the fetch below.
  const reload_schema = useCallback(() => setSchemaRev((r) => r + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await tableSchema(conn_id, collection);
        if (!cancelled) {
          setSchema(s);
          setFailed(false);
        }
      } catch (e) {
        if (!cancelled) {
          setFailed(true);
          setFailError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, collection, schema_rev]);

  const add_filter = (filter: Omit<GridFilter, "id">) => {
    setFilters((cur) => {
      const id = cur.reduce((m, f) => Math.max(m, f.id), 0) + 1;
      return [
        ...cur,
        { ...filter, id, conjunction: filter.conjunction ?? "AND" },
      ];
    });
  };
  const remove_filter = (id: number) =>
    setFilters((cur) => cur.filter((f) => f.id !== id));
  const set_filter_conjunction = (id: number, conjunction: "AND" | "OR") =>
    setFilters((cur) =>
      cur.map((f) => (f.id === id ? { ...f, conjunction } : f)),
    );
  const clear_filters = () => {
    setFilters([]);
    setCustomWhere("");
  };

  const columns: FilterColumn[] = (schema?.columns ?? []).map((c) => ({
    name: c.name,
    data_type: c.data_type,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-background flex shrink-0 items-center gap-1 border-b px-3">
        <ModeTabs
          mode={mode}
          warn_no_pk={!!schema && schema.columns.every((c) => !c.primary_key)}
          on_change={setMode}
        />
        <div className="ml-auto flex items-center gap-1">
          {mode === "data" && (
            <FilterBar
              columns={columns}
              distinct={{}}
              filters={filters}
              custom_where={custom_where}
              on_add={add_filter}
              on_remove={remove_filter}
              on_set_conjunction={set_filter_conjunction}
              on_clear={clear_filters}
              on_custom_where={setCustomWhere}
            />
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {failed ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" /> Failed to load collection “
              {collection}”.
            </p>
            {fail_error && (
              <pre className="border-destructive/30 bg-destructive/5 text-destructive max-w-lg overflow-x-auto rounded-md border p-2 text-left font-mono text-xs whitespace-pre-wrap">
                {fail_error}
              </pre>
            )}
          </div>
        ) : (
          schema && (
            <>
              {/* Both surfaces stay mounted (hidden while inactive), same as
                  the SQL TablePane: the grid keeps its rows/scroll and never
                  refetches on a mode switch, and the schema editor keeps its
                  drafts. */}
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col",
                  mode === "data" ? "flex" : "hidden",
                )}
              >
                <Grid
                  conn_id={conn_id}
                  table={collection}
                  schema={schema}
                  revision={refresh_rev}
                  tab_key={tab_key}
                  filters={filters}
                  custom_where={custom_where}
                  distinct={{}}
                  on_refresh={refresh_data_only}
                  kind="mongo"
                />
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1",
                  mode === "schema" ? "flex flex-col" : "hidden",
                )}
              >
                <MongoSchemaView
                  conn_id={conn_id}
                  tab_key={tab_key}
                  collection={collection}
                  schema={schema}
                  on_index_applied={() => {
                    reload_schema();
                    on_modified();
                  }}
                  on_dropped={on_modified}
                />
              </div>
            </>
          )
        )}
        {mode === "data" &&
          !failed &&
          (gridBridge?.loading || !schema) && (
            <div className="bg-background/60 absolute inset-0 z-80 flex items-center justify-center">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
      </div>
    </div>
  );
}

/** Schema view for a Mongo collection: a read-only inferred-fields table
 *  (Mongo is schemaless — fields are sampled from the first 200 documents,
 *  there's no column DDL to edit) plus a real, editable index manager
 *  (indexes ARE a per-collection concept in Mongo, unlike columns). */
function MongoSchemaView({
  conn_id,
  tab_key,
  collection,
  schema,
  on_index_applied,
  on_dropped,
}: {
  conn_id: string;
  tab_key: string;
  collection: string;
  schema: TableSchema;
  on_index_applied: () => void;
  on_dropped: () => void;
}) {
  const grid =
    "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2";
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="flex flex-col gap-4">
        <div className="bg-background rounded-md border">
          <div className="border-b px-3 py-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="text-muted-foreground h-4 w-4" />
              <span>Inferred fields</span>
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Sampled from the first 200 documents (Mongo is schemaless).
            </p>
          </div>
          <div
            className={cn(
              grid,
              "text-muted-foreground border-b px-3 py-2 text-[11px] font-medium",
            )}
          >
            <span>Field</span>
            <span>Type</span>
            <span />
          </div>
          {schema.columns.map((c) => (
            <div key={c.name} className={cn(grid, "px-3 py-1.5 text-sm")}>
              <span className="font-mono">{c.name}</span>
              <span className="text-muted-foreground text-xs">{c.data_type}</span>
              <span />
            </div>
          ))}
        </div>
        <MongoSchemaEditor
          conn_id={conn_id}
          collection={collection}
          schema={schema}
          store_key={tab_key}
          on_applied={on_index_applied}
          on_dropped={on_dropped}
        />
      </div>
    </div>
  );
}