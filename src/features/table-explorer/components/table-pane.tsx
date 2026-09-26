import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { usePaneMode, useStudioStore } from "@/shared/store";
import { executeOp, tableSchema, type TableSchema } from "@/shared/api";
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
import {
  DISTINCT_LIMIT,
  type DistinctMap,
  type GridFilter,
} from "@/shared/components/data-grid/types";
import { cn } from "@/shared/lib/utils";
import { ModeTabs } from "./mode-tabs";
import { useBottomPanelSize } from "@/shared/hooks/use-bottom-panel-size";

// The schema editor is a large surface; load it only when its tab first
// renders (it stays mounted afterwards so drafts survive mode switches).
const SchemaTab = lazy(() =>
  import("@/features/schema-designer").then((m) => ({ default: m.SchemaTab })),
);

/**
 * A table tab's content: the Data | Schema mode switch with the filter bar in
 * the header, the data grid for "data", and the schema editor for "schema".
 * The schema editor stays mounted (hidden while data shows) so unsaved drafts
 * survive switching modes.
 */
export function TablePane({
  conn_id,
  tab_key,
  table,
  revision,
  on_modified,
  initial_filters,
  on_open_reference,
  database,
  schema: db_schema,
}: {
  conn_id: string;
  tab_key: string;
  table: string;
  revision: number;
  on_modified: () => void;
  /** Filters the pane starts with (e.g. an FK jump from another table). */
  initial_filters?: GridFilter[];
  /** Called when an FK cell's jump icon is clicked in this table's grid. */
  on_open_reference?: (
    table: string,
    column: string,
    value: string | null,
  ) => void;
  /** `undefined` = this connection's own primary database/active schema —
   *  set when this tab was opened from a database/schema other than the
   *  connection's own (the sidebar catalog tree's multi-database browsing —
   *  see `open_object` in tables-view.tsx). */
  database?: string;
  schema?: string;
}) {
  const mode = usePaneMode(conn_id, tab_key);
  const setPaneMode = useStudioStore((s) => s.setPaneMode);
  // A schema Apply is in flight for this pane → the grid shows its busy
  // overlay and refuses edits until the transaction resolves.
  // Grid's own fetch state (page/filter/refresh) — same treatment as Apply.
  const schema_busy = useStudioStore((s) => !!s.schemaEdits[tab_key]?.busy);
  // Grid fetch state — display-only here. NEVER feed it back into the grid
  // as props_busy: the grid publishes this flag itself, so round-tripping it
  // would create a feedback loop stuck at true.
  const grid_loading = useStudioStore((s) => !!s.gridBridges[tab_key]?.loading);
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
  const setMode = useCallback(
    (m: "data" | "schema") => setPaneMode(conn_id, tab_key, m),
    [setPaneMode, conn_id, tab_key],
  );

  // Data pane state: schema, distinct values, and the UI filters (also used by
  // the FilterBar in this pane's header).
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [failed, setFailed] = useState(false);
  const [fail_error, setFailError] = useState<string | null>(null);
  const [refresh_rev, setRefreshRev] = useState(0);
  const [distinct, setDistinct] = useState<DistinctMap>({});
  const [filters, setFilters] = useState<GridFilter[]>(initial_filters ?? []);
  const [custom_where, setCustomWhere] = useState("");

  // Stable callback so the grid bridge memo doesn't recompute every render.
  const bump_refresh = useCallback(() => setRefreshRev((r) => r + 1), []);

  // Views/matviews expose data but no editable schema.
  const is_table = (schema?.kind || "table") === "table";

  const combined_rev = revision + refresh_rev;

  // Each surface is built the first time its tab is shown and then stays
  // mounted (the grid keeps its rows and scroll, the schema editor its
  // drafts). Opening straight on Schema therefore never runs the data query.
  // Adjusted during render, React's pattern for state derived from a prop.
  // A tab brought back by a reconnect waits for a reload before its rows.
  const paused = useStudioStore((s) => !!s.pausedTabs[tab_key]);
  const resume_tab = useStudioStore((s) => s.resumeTab);
  const [data_opened, setDataOpened] = useState(mode === "data" && !paused);
  if (mode === "data" && !paused && !data_opened) setDataOpened(true);
  const [schema_opened, setSchemaOpened] = useState(mode === "schema");
  if (mode === "schema" && !schema_opened) setSchemaOpened(true);

  // The table's structure is seven catalog queries and the rows only need
  // one: fetching it first left the grid blank for the whole schema round
  // trip, and the burst of new connections could time the pool out. So it
  // waits until the first page of rows has settled (loaded or failed), unless
  // the Schema tab is what is showing, which needs it right away.
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
        const s = await tableSchema(conn_id, table, database, db_schema);
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
  }, [
    conn_id,
    table,
    revision,
    refresh_rev,
    database,
    db_schema,
    schema_wanted,
  ]);

  // Bounded distinct values for enum/bool columns (dropdown editors + filters).
  // Booleans are special-cased: their domain is FIXED (true/false), so on
  // Postgres we never spend a DISTINCT query rediscovering it. SQLite keeps
  // querying because its booleans may legitimately be stored as 0/1.
  const is_postgres = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.kind === "postgres",
  );
  const distinct_cols = useMemo(
    () =>
      (schema?.columns ?? [])
        .filter((c) => {
          const t = c.data_type.toLowerCase();
          return (
            t.includes("enum") ||
            t.includes("bool") ||
            (c.enum_values?.length ?? 0) > 0
          );
        })
        .map((c) => c.name),
    [schema],
  );

  useEffect(() => {
    if (distinct_cols.length === 0) return;
    let cancelled = false;
    void (async () => {
      // Fetch every enum/bool column in parallel — each is an independent
      // query and the pool serves them concurrently.
      const entries = await Promise.all(
        distinct_cols.map(async (col) => {
          try {
            // Native enum columns already know their labels — no query needed.
            const declared = schema?.columns.find((c) => c.name === col);
            if ((declared?.enum_values?.length ?? 0) > 0) {
              return [col, declared!.enum_values!] as const;
            }
            if (
              is_postgres &&
              (declared?.data_type ?? "").toLowerCase().includes("bool")
            ) {
              return [col, ["true", "false"] as (string | null)[]] as const;
            }
            const res = await executeOp(
              conn_id,
              {
                kind: "select_distinct",
                table,
                column: col,
                limit: DISTINCT_LIMIT,
              },
              database,
              db_schema,
            );
            return [col, res.rows.map((r) => r[0] ?? null)] as const;
          } catch {
            return [col, [] as (string | null)[]] as const;
          }
        }),
      );
      if (cancelled) return;
      const map: DistinctMap = {};
      for (const [col, values] of entries) map[col] = values;
      setDistinct(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    conn_id,
    table,
    combined_rev,
    distinct_cols,
    is_postgres,
    schema,
    database,
    db_schema,
  ]);

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

  const clear_filters = () => {
    setFilters([]);
    setCustomWhere("");
  };

  // The filter bar's column list: the table's structure once it is here (with
  // real types), else the column names of the rows already on screen.
  const result_columns = gridBridge?.all_columns;
  const filter_columns = useMemo(
    () =>
      schema
        ? schema.columns.map((c) => ({
            name: c.name,
            data_type: c.data_type,
          }))
        : (result_columns ?? []).map((name) => ({ name, data_type: "" })),
    [schema, result_columns],
  );

  // Measured from this pane's own root — not GridActionBar's own rendered
  // width, which shrinks the instant it collapses (see that file's doc
  // comment for why that would permanently lock in "too narrow").
  const pane_ref = useRef<HTMLDivElement>(null);

  // One continuous elapsed-time origin for the whole loading span, and the
  // overlay stays mounted continuously across it. The grid mounts and reads
  // its initial `loading: true`, but only an *effect* pushes that into
  // `gridBridges` — a moment after commit, hence the `!gridBridge` term:
  // without it, and the grace delay below, `is_loading` would visit `false`
  // for that one render, unmounting/remounting the overlay and resetting its
  // timer. Scoped to whichever mode is showing: the Data tab waits on the
  // grid's own fetch only (the structure loads after it, in the background),
  // the Schema tab on the structure and a schema Apply.
  const is_loading =
    !failed &&
    !(paused && mode === "data") &&
    (mode === "data" ? !gridBridge || grid_loading : !schema || schema_busy);
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
        {/* Views/matviews have no editable schema — hide the Schema tab. */}
        <div className="flex items-center gap-1">
          {is_table ? (
            <ModeTabs
              mode={mode}
              warn_no_pk={
                !!schema && schema.columns.every((c) => !c.primary_key)
              }
              on_change={setMode}
            />
          ) : (
            <span className="text-muted-foreground px-1 py-1 text-xs font-medium">
              {schema?.kind === "matview" ? "Materialized view" : "View"} ·
              read-only data
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {mode === "data" && gridBridge && (
            <GridActionBar
              bridge={gridBridge}
              conn_id={conn_id}
              pane_ref={pane_ref}
              // Usable before the structure arrives: the rows' own column
              // names stand in for it (untyped, so text filters), and the
              // raw WHERE box never needed columns at all.
              filter_bar={{
                columns: filter_columns,
                distinct,
                filters,
                custom_where,
                on_add: add_filter,
                on_remove: remove_filter,
                on_set_conjunction: set_filter_conjunction,
                on_clear: clear_filters,
                on_custom_where: setCustomWhere,
              }}
              bulk_edit={
                schema
                  ? {
                      columns: schema.columns.map((c) => ({
                        name: c.name,
                        data_type: c.data_type,
                      })),
                      distinct,
                    }
                  : undefined
              }
            />
          )}
          {mode === "schema" && (schemaEdit || schemaPane) && (
            <SchemaActionBar
              schemaEdit={schemaEdit}
              schemaPane={schemaPane}
              drop_label="Drop table"
              pane_ref={pane_ref}
              conn_id={conn_id}
            />
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {failed && (
          <SchemaLoadError
            table={table}
            error={fail_error}
            // Under the Data tab the rows are still usable, so the message
            // sits above them instead of replacing them.
            compact={mode === "data"}
          />
        )}
        {/* Both surfaces stay mounted once built (hidden while inactive): the
            grid keeps its rows/scroll when you visit Schema, and Schema keeps
            its drafts. Revisions still refresh data in the background. */}
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
                ResizablePanel slot regardless of `bottomPanelOpen` —
                only the JSON panel+handle mount/unmount — so toggling it
                never remounts the grid (losing scroll position, buffered
                edits, etc.). The JSON panel's OWN size, though, is a
                plain `defaultSize` literal fed from `useBottomPanelSize`
                (not `react-resizable-panels`' own `defaultLayout`
                persistence) — see that hook's doc comment for why. */}
            <ResizablePanelGroup
              orientation="vertical"
              className="min-h-0 flex-1"
              onLayoutChanged={onLayoutChanged}
              defaultLayout={defaultLayout}
            >
              <ResizablePanel
                id="top-panel"
                minSize="30%"
                className={cn("flex-col", bottomPanelOpen && "border-b")}
              >
                <Grid
                  conn_id={conn_id}
                  table={table}
                  schema={schema}
                  revision={combined_rev}
                  tab_key={tab_key}
                  filters={filters}
                  custom_where={custom_where}
                  distinct={distinct}
                  props_busy={schema_busy}
                  on_refresh={bump_refresh}
                  on_open_reference={on_open_reference}
                  database={database}
                  schema_name={db_schema}
                  on_column_filter={set_column_filter}
                />
              </ResizablePanel>
              <ResizableHandle className="bg-background hover:bg-accent h-0.5!" />

              <ResizablePanel
                id="bottom-panel"
                defaultSize={bottomDefaultSize}
                minSize={0}
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
              mode === "schema" && is_table ? "flex flex-col" : "hidden",
            )}
          >
            <Suspense fallback={<SchemaFallback />}>
              <SchemaTab
                conn_id={conn_id}
                table={table}
                store_key={tab_key}
                on_modified={on_modified}
                on_applied={() => setMode("data")}
                database={database}
                schema_name={db_schema}
                initial_schema={schema}
              />
            </Suspense>
          </div>
        )}
        {/* Covers the whole loading span, including the moment before the
            grid has published its own bridge. */}
        {loading_start !== null && (
          <QueryLoadingOverlay
            startedAt={loading_start}
            // Only the rows fetch can be given up on; the Schema tab's wait
            // (structure, an Apply in flight) has nothing to stop.
            onStop={mode === "data" ? gridBridge?.stop : undefined}
          />
        )}
      </div>
    </div>
  );
}

function SchemaLoadError({
  table,
  error,
  compact,
}: {
  table: string;
  error: string | null;
  compact: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-2",
        compact
          ? "border-destructive/30 bg-destructive/5 shrink-0 border-b px-3 py-1.5"
          : "items-center px-3 py-8 text-center",
      )}
    >
      <p className="text-destructive text-sm">
        {compact
          ? `Couldn't load the structure of “${table}”, so editing is off.`
          : `Failed to load schema for “${table}”.`}
      </p>
      {error && (
        <pre
          className={cn(
            "border-destructive/30 bg-destructive/5 text-destructive overflow-x-auto rounded-md border p-2 text-left font-mono text-xs whitespace-pre-wrap",
            compact ? "max-h-20 overflow-y-auto" : "max-w-lg",
          )}
        >
          {error}
        </pre>
      )}
    </div>
  );
}

function SchemaFallback() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
