import { useEffect, useRef, useState, useCallback } from "react";
import {
  mongoFieldTree,
  tableSchema,
  type FieldShape,
  type TableSchema,
} from "@/shared/api";
import { type FilterColumn } from "@/shared/components/data-grid/filter-bar";
import { Grid } from "@/shared/components/data-grid/grid";
import { QueryLoadingOverlay } from "@/shared/components/data-grid/query-loading-overlay";
import { GridLoadState } from "@/shared/components/data-grid/grid-load-state";
import { GridActionBar } from "@/shared/components/data-grid/grid-action-bar";
import { SchemaActionBar } from "@/shared/components/data-grid/schema-action-bar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { JsonViewer } from "@/features/inspector";
import { useBottomPanelSize } from "@/shared/hooks/use-bottom-panel-size";
import { ModeTabs } from "./mode-tabs";
import { FieldsTree, MongoSchemaEditor } from "@/features/schema-designer";
import { useStudioStore, usePaneMode } from "@/shared/store";
import type { GridFilter } from "@/shared/components/data-grid/types";
import { AlertCircle } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export function MongoCollectionPane({
  conn_id,
  tab_key,
  database,
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

  const {
    panelRef: bottomPanelRef,
    defaultLayout,
    onLayoutChanged,
    defaultSize: bottomDefaultSize,
    bottomPanelOpen,
  } = useBottomPanelSize({
    conn_id,
    tab_key,
    panelIds: ["top-panel", "bottom-panel"],
    storage: localStorage,
  });

  const schemaEdit = useStudioStore((s) => s.schemaEdits[tab_key] ?? null);
  const schemaPane = useStudioStore((s) => s.schemaPanes[tab_key] ?? null);
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

  // The Fields view's nested shape (spec 0001) — fetched independently of
  // `schema`/`table_schema` above so its own sampling pass never touches
  // `ColumnInfo`/the grid's column headers. Lazy: only once the Schema tab
  // is actually viewed (AC-9), not on every pane mount.
  const [field_tree, setFieldTree] = useState<FieldShape[] | null>(null);
  const [field_tree_loading, setFieldTreeLoading] = useState(false);
  const [field_tree_error, setFieldTreeError] = useState<string | null>(null);
  // Tracks which (connection, collection, schema_rev) the last fetch/fetch
  // in flight covers, so switching Schema → Data → Schema doesn't
  // refetch — only a real target change or the Refresh-driven `schema_rev`
  // bump does.
  const field_tree_key = `${conn_id}:${database}:${collection}:${schema_rev}`;
  const field_tree_fetched_key = useRef<string | null>(null);

  // A plain action-bar Refresh re-reads this same collection's data. It must
  // re-bump the grid revision (refetch) but must NOT signal the sidebar
  // (on_modified -> bumpTables would spin its tree loading).
  const refresh_data_only = useCallback(() => setRefreshRev((r) => r + 1), []);

  // Applying an index change needs a fresh schema (new/dropped index shows
  // up in the Indexes panel) — bumping this re-runs the fetch below.
  const reload_schema = useCallback(() => setSchemaRev((r) => r + 1), []);

  // Each surface is built the first time its tab is shown, then stays mounted.
  // Opening straight on Schema therefore never runs the data query. Adjusted
  // during render, React's pattern for state derived from a prop.
  // A tab brought back by a reconnect waits for a reload before its rows.
  const paused = useStudioStore((s) => !!s.pausedTabs[tab_key]);
  const resume_tab = useStudioStore((s) => s.resumeTab);
  const [data_opened, setDataOpened] = useState(mode === "data" && !paused);
  if (mode === "data" && !paused && !data_opened) setDataOpened(true);
  const [schema_opened, setSchemaOpened] = useState(mode === "schema");
  if (mode === "schema" && !schema_opened) setSchemaOpened(true);

  // The structure (a document sample plus the index list) waits until the
  // first page of documents has settled, loaded or failed, so the grid isn't
  // blank for its round trips. The Schema tab needs it at once.
  const [data_settled, setDataSettled] = useState(false);
  if (!data_settled && data_opened && gridBridge && !gridBridge.loading) {
    setDataSettled(true);
  }
  const schema_wanted = mode === "schema" || data_settled;

  useEffect(() => {
    if (!schema_wanted) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await tableSchema(conn_id, collection, database);
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
  }, [conn_id, collection, schema_rev, database, schema_wanted]);

  useEffect(() => {
    if (mode !== "schema") return;
    if (field_tree_fetched_key.current === field_tree_key) return;
    field_tree_fetched_key.current = field_tree_key;
    let cancelled = false;
    setFieldTreeLoading(true);
    setFieldTreeError(null);
    void (async () => {
      try {
        const tree = await mongoFieldTree(conn_id, database, collection);
        if (!cancelled) setFieldTree(tree);
      } catch (e) {
        if (!cancelled) setFieldTreeError(String(e));
      } finally {
        if (!cancelled) setFieldTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, field_tree_key, conn_id, database, collection]);

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
  // Header's own per-column quick filter — upserts (or removes) the one
  // `op: "in"` filter for `col`, leaving every other filter untouched.
  const set_column_filter = (col: string, values: string[] | null) => {
    setFilters((cur) => {
      const without = cur.filter((f) => !(f.column === col && f.op === "in"));
      if (values === null) return without;
      const id = without.reduce((m, f) => Math.max(m, f.id), 0) + 1;
      return [
        ...without,
        { id, column: col, op: "in", value: "", values, conjunction: "AND" },
      ];
    });
  };

  // Usable before the structure arrives: the documents' own field names stand
  // in for it (untyped), and the raw query box never needed columns at all.
  const result_columns = gridBridge?.all_columns;
  const columns: FilterColumn[] = schema
    ? schema.columns.map((c) => ({
        name: c.name,
        data_type: c.data_type,
      }))
    : (result_columns ?? []).map((name) => ({ name, data_type: "" }));

  // Measured from this pane's own root — not GridActionBar's own rendered
  // width, which shrinks the instant it collapses (see that file's doc
  // comment for why that would permanently lock in "too narrow").
  const pane_ref = useRef<HTMLDivElement>(null);
  // const compact_toolbar = usePaneCompactWidth(pane_ref);

  // One continuous elapsed-time origin for the whole loading span, and the
  // overlay stays mounted continuously across it. The grid mounts and reads
  // its initial `loading: true`, but only an *effect* pushes that into
  // `gridBridges` — a moment after commit, hence the `!gridBridge` term:
  // without it, and the grace delay below, `is_loading` would visit `false`
  // for that one render, unmounting/remounting the overlay and resetting its
  // timer. Scoped to whichever mode is showing: the Data tab waits on the
  // grid's own fetch only (the structure loads after it), the Schema tab on
  // the structure and a schema Apply.
  const is_loading =
    !failed &&
    !(paused && mode === "data") &&
    (mode === "data"
      ? !gridBridge || !!gridBridge.loading
      : !schema || !!schemaEdit?.busy);
  const [loading_start, setLoadingStart] = useState<number | null>(null);
  useEffect(() => {
    if (is_loading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a performance.now() timestamp (an external clock, not derivable from props/state) to the moment loading actually starts; can't be computed during render
      setLoadingStart((cur) => cur ?? performance.now());
      return;
    }
    const id = setTimeout(() => setLoadingStart(null), 50);
    return () => clearTimeout(id);
  }, [is_loading]);

  return (
    <div ref={pane_ref} className="flex h-full min-h-0 flex-col">
      <div className="bg-background flex min-h-8 w-full items-center gap-1 border-b px-3">
        <div className="flex items-center gap-1">
          <ModeTabs
            mode={mode}
            warn_no_pk={!!schema && schema.columns.every((c) => !c.primary_key)}
            on_change={setMode}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {mode === "data" && gridBridge && (
            <GridActionBar
              bridge={gridBridge}
              conn_id={conn_id}
              pane_ref={pane_ref}
              filter_bar={{
                columns,
                distinct: {},
                filters,
                custom_where,
                on_add: add_filter,
                on_remove: remove_filter,
                on_set_conjunction: set_filter_conjunction,
                on_clear: clear_filters,
                on_custom_where: setCustomWhere,
                kind: "mongo",
              }}
              bulk_edit={{ columns, distinct: {} }}
            />
          )}
          {mode === "schema" && (schemaEdit || schemaPane) && (
            <SchemaActionBar
              schemaEdit={schemaEdit}
              schemaPane={schemaPane}
              drop_label="Drop collection"
              pane_ref={pane_ref}
              conn_id={conn_id}
            />
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {failed && (
          <div
            role="alert"
            className={cn(
              "flex flex-col gap-2",
              mode === "data"
                ? "border-destructive/30 bg-destructive/5 shrink-0 border-b px-3 py-1.5"
                : "items-center px-3 py-8 text-center",
            )}
          >
            <p className="text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              {mode === "data"
                ? `Couldn’t load the structure of “${collection}”, so editing is off.`
                : `Failed to load collection “${collection}”.`}
            </p>
            {fail_error && (
              <pre
                className={cn(
                  "border-destructive/30 bg-destructive/5 text-destructive overflow-x-auto rounded-md border p-2 text-left font-mono text-xs whitespace-pre-wrap",
                  mode === "data" ? "max-h-20 overflow-y-auto" : "max-w-lg",
                )}
              >
                {fail_error}
              </pre>
            )}
          </div>
        )}
        {/* Both surfaces stay mounted once built (hidden while inactive), same
            as the SQL TablePane: the grid keeps its rows/scroll and never
            refetches on a mode switch, and the schema editor keeps its
            drafts. */}
        {paused && mode === "data" && (
          <GridLoadState kind="paused" on_reload={() => resume_tab(tab_key)} />
        )}
        {data_opened && (
          <div
            className={cn(
              "min-h-0 flex-1 flex-col",
              mode === "data" ? "flex" : "hidden",
            )}
          >
            {/* `Grid` always sits in this same ResizablePanelGroup/
                ResizablePanel slot regardless of `bottomPanelOpen` — see
                the identical note in `table-pane.tsx` for why. */}
            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
              defaultLayout={defaultLayout}
              onLayoutChanged={onLayoutChanged}
            >
              <ResizablePanel
                id="top-panel"
                minSize="30%"
                className={cn("flex-col", bottomPanelOpen && "border-b")}
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
                  database={database}
                  on_column_filter={set_column_filter}
                />
              </ResizablePanel>
              <ResizableHandle className="bg-background hover:bg-accent h-1!" />
              <ResizablePanel
                id="bottom-panel"
                defaultSize={bottomDefaultSize}
                minSize={10}
                collapsible
                collapsedSize={0}
                className="min-h-0 flex-col"
                panelRef={bottomPanelRef}
              >
                <JsonViewer conn_id={conn_id} tab_key={tab_key} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
        {schema_opened && schema && (
          <div
            className={cn(
              "min-h-0 flex-1",
              mode === "schema" ? "flex flex-col" : "hidden",
            )}
          >
            <MongoSchemaView
              conn_id={conn_id}
              database={database}
              tab_key={tab_key}
              collection={collection}
              schema={schema}
              field_tree={field_tree}
              field_tree_loading={field_tree_loading}
              field_tree_error={field_tree_error}
              on_index_applied={() => {
                reload_schema();
                on_modified();
              }}
              on_dropped={on_modified}
            />
          </div>
        )}
        {/* One overlay for the whole span, including the moment before the
            grid has published its own bridge, so its style never swaps. */}
        {loading_start !== null && (
          <QueryLoadingOverlay
            startedAt={loading_start}
            // Only the documents fetch can be given up on; the Schema tab's
            // wait has nothing to stop.
            onStop={mode === "data" ? gridBridge?.stop : undefined}
          />
        )}
      </div>
    </div>
  );
}

/** Schema view for a Mongo collection: the nested "Fields" view (spec 0001;
 *  Mongo is schemaless — fields are sampled from the first 200 documents,
 *  there's no column DDL to edit) plus a real, editable index manager
 *  (indexes ARE a per-collection concept in Mongo, unlike columns). */
function MongoSchemaView({
  conn_id,
  database,
  tab_key,
  collection,
  schema,
  field_tree,
  field_tree_loading,
  field_tree_error,
  on_index_applied,
  on_dropped,
}: {
  conn_id: string;
  database: string;
  tab_key: string;
  collection: string;
  schema: TableSchema;
  field_tree: FieldShape[] | null;
  field_tree_loading: boolean;
  field_tree_error: string | null;
  on_index_applied: () => void;
  on_dropped: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="flex flex-col gap-4">
        <FieldsTree
          fields={field_tree}
          loading={field_tree_loading}
          error={field_tree_error}
        />
        <MongoSchemaEditor
          conn_id={conn_id}
          database={database}
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
