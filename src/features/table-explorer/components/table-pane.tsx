import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { usePaneMode, useStudioStore } from "@/shared/store";
import { executeOp, tableSchema, type TableSchema } from "@/shared/api";
import { FilterBar } from "@/shared/components/data-grid/filter-bar";
import { Grid } from "@/shared/components/data-grid/grid";
import {
  DISTINCT_LIMIT,
  type DistinctMap,
  type GridFilter,
} from "@/shared/components/data-grid/types";
import { cn } from "@/shared/lib/utils";
import { ModeTabs } from "./mode-tabs";
import { Loader2 } from "lucide-react";

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await tableSchema(conn_id, table);
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
  }, [conn_id, table, revision, refresh_rev]);

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
            const res = await executeOp(conn_id, {
              kind: "select_distinct",
              table,
              column: col,
              limit: DISTINCT_LIMIT,
            });
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
  }, [conn_id, table, combined_rev, distinct_cols, is_postgres]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-background flex shrink-0 items-center gap-1 border-b px-3">
        {/* Views/matviews have no editable schema — hide the Schema tab. */}
        {is_table ? (
          <ModeTabs
            mode={mode}
            warn_no_pk={!!schema && schema.columns.every((c) => !c.primary_key)}
            on_change={setMode}
          />
        ) : (
          <span className="text-muted-foreground px-1 py-1 text-xs font-medium">
            {schema?.kind === "matview" ? "Materialized view" : "View"} ·
            read-only data
          </span>
        )}
        {mode === "data" && schema && (
          <div className="ml-auto flex items-center">
            <FilterBar
              columns={schema.columns.map((c) => ({
                name: c.name,
                data_type: c.data_type,
              }))}
              distinct={distinct}
              filters={filters}
              custom_where={custom_where}
              on_add={add_filter}
              on_remove={remove_filter}
              on_set_conjunction={set_filter_conjunction}
              on_clear={clear_filters}
              on_custom_where={setCustomWhere}
            />
          </div>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {failed ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-destructive text-sm">
              Failed to load schema for “{table}”.
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
              {/* Both surfaces stay mounted (hidden while inactive): the grid
                keeps its rows/scroll when you visit Schema, and Schema keeps
                its drafts. Revisions still refresh data in the background. */}
              <div
                className={cn(
                  "min-h-0 flex-1 flex-col",
                  mode === "data" ? "flex" : "hidden",
                )}
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
                />
              </div>
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
                  />
                </Suspense>
              </div>
            </>
          )
        )}
        {(!schema || schema_busy || grid_loading) && (
          <div className="bg-background/60 absolute inset-0 z-80 flex items-center justify-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}
      </div>
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
