import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import {
  resultRowCount,
  type QueryResult,
  type TableSchema,
} from "@/shared/api";
import { useStudioStore, type GridBridge, type JsonRow } from "@/shared/store";
import { GridBody } from "./grid-body";
import { GridProvider } from "./grid-context";
import { useGridController } from "./grid-controller";
import { useGridEditBuffer } from "./use-grid-edit-buffer";
import { GridActionBar } from "./grid-action-bar";
import { ResultViewTabs, type ResultView } from "./result-view-tabs";
import { classify, type CellKind } from "./types";

/** The host (`SqlResults`/`MongoResults` in editor-tab.tsx) resolved this
 *  result to a single, real table/collection — its schema is what makes
 *  editing possible at all. `QueryResultsGrid` still independently checks
 *  every PK column actually made it into `result.columns` before allowing
 *  edits: the query might have selected only a subset of columns. */
export interface QueryResultEditableSource {
  table: string;
  schema: TableSchema;
}

/**
 * The same Excel-like grid used for table data, shown for an arbitrary SQL
 * query's (or Mongo console command's) result — plus, above it, a Result /
 * Summary / Query switcher and, when the host resolved the result to a
 * single real table/collection with a usable primary key, the same row
 * editing (cell edits, add/delete row, Apply) and toolbar a real table gets.
 * Otherwise the grid stays read-only, same as before. Sorting happens
 * in-memory when read-only (descending keeps NULLs at the bottom, matching a
 * SQL engine's default) — an editable result sorts by fetch order only, see
 * `use-grid-edit-buffer.ts`'s doc comment for why mixing the two is unsafe.
 */
export function QueryResultsGrid({
  result,
  conn_id,
  tab_key,
  query_text,
  message,
  editable_source,
  database,
  schema_name,
  on_refresh,
}: {
  result: QueryResult;
  conn_id: string;
  tab_key: string;
  /** The exact statement/command that produced this result — shown in the
   *  Query view. */
  query_text: string;
  /** Extra free-text status (e.g. Mongo's own "switched database" message),
   *  shown in the Summary view when present. */
  message?: string;
  editable_source?: QueryResultEditableSource | null;
  database?: string;
  schema_name?: string;
  /** Re-runs the original query. Required for editing to actually be
   *  offered — there's no live pagination to patch in place after an Apply,
   *  so a fresh re-run is how the grid reflects the write. */
  on_refresh?: () => void;
}) {
  const pane_ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ResultView>("result");

  const setJsonRow = useStudioStore((s) => s.setJsonRow);
  // A read only connection (spec 0007) never offers editing, whatever the
  // query returned.
  const read_only = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.read_only ?? false,
  );
  const json_scope = `${conn_id}\u0000${tab_key}`;
  const sync_json = useCallback(
    (row: JsonRow) => setJsonRow(json_scope, { ...row, kind: "sql" }),
    [setJsonRow, json_scope],
  );
  // The JSON detail panel is a per-tab bottom split under a table/collection
  // grid (see `table-pane.tsx`) — this grid has no such panel to open yet.
  const open_json = useCallback(() => {}, []);
  // A new query's result invalidates whatever row was published for this tab.
  useEffect(() => {
    setJsonRow(json_scope, null);
  }, [result, json_scope, setJsonRow]);

  const pk_columns = useMemo(
    () =>
      editable_source?.schema.columns
        .filter((c) => c.primary_key)
        .map((c) => c.name) ?? [],
    [editable_source],
  );
  // Editable only when every PK column the schema declares is actually
  // present in what the query returned — see `QueryResultEditableSource`'s
  // own doc comment.
  const editable =
    !read_only &&
    !!editable_source &&
    !!on_refresh &&
    pk_columns.length > 0 &&
    pk_columns.every((c) => result.columns.includes(c));

  const kinds: Record<string, CellKind> = useMemo(() => {
    if (!editable_source) {
      // No declared types for a plain read-only result — fine, cells stay
      // read-only either way.
      return Object.fromEntries(
        result.columns.map((c) => [c, "text" as CellKind]),
      );
    }
    return Object.fromEntries(
      editable_source.schema.columns.map((c) => [
        c.name,
        c.is_array && (c.enum_values?.length ?? 0) > 0
          ? ("array" as CellKind)
          : classify(c.data_type.toLowerCase()),
      ]),
    );
  }, [editable_source, result.columns]);
  const types = useMemo(
    () =>
      editable_source
        ? Object.fromEntries(
            editable_source.schema.columns.map((c) => [c.name, c.data_type]),
          )
        : undefined,
    [editable_source],
  );
  const nullable = useMemo(
    () =>
      editable_source
        ? Object.fromEntries(
            editable_source.schema.columns.map((c) => [c.name, !c.not_null]),
          )
        : undefined,
    [editable_source],
  );
  const key_kinds = useMemo(() => {
    if (!editable_source) return undefined;
    const map: Record<string, "primary" | "foreign" | "both"> = {};
    for (const c of editable_source.schema.columns) {
      if (c.primary_key) map[c.name] = "primary";
    }
    for (const fk of editable_source.schema.foreign_keys) {
      map[fk.column] = map[fk.column] === "primary" ? "both" : "foreign";
    }
    return map;
  }, [editable_source]);

  // Called unconditionally (rules of hooks) — its outputs are only ever
  // wired into the controller/action bar when `editable` is true, and its
  // own `pk_match` refuses to match anything when `pk_columns` is empty
  // regardless, so this is inert otherwise.
  const edit = useGridEditBuffer({
    conn_id,
    table: editable_source?.table ?? "",
    database,
    schema_name,
    pk_columns: editable ? pk_columns : [],
    result,
    on_refresh: on_refresh ?? (() => {}),
  });

  const ctl = useGridController({
    rows: editable ? edit.display_rows : result.rows,
    // A streamed result's array can be longer than what was last announced.
    row_count: editable ? undefined : result.row_count,
    columns: result.columns,
    row_offset: 0,
    editable,
    loading: edit.op_running,
    pk_columns: editable ? pk_columns : [],
    conn_id: editable ? conn_id : "",
    table: editable ? (editable_source?.table ?? "") : "",
    kinds,
    types,
    key_kinds,
    nullable,
    distinct: {},
    // A live table's sort re-queries the server in-order; a query result has
    // no backend to re-sort against, so an editable one sorts by fetch order
    // only (see use-grid-edit-buffer.ts) — a read-only one keeps its
    // existing in-memory sort.
    client_sort: !editable,
    on_modified: () => {},
    on_set_null: editable ? edit.set_null : () => {},
    on_delete_row: editable ? edit.delete_row : () => {},
    on_clone_row: editable ? edit.clone_into_pending : undefined,
    pending_rows: editable ? edit.pending : undefined,
    on_pending_edit: editable ? edit.on_pending_edit : undefined,
    on_remove_pending: editable ? edit.on_remove_pending : undefined,
    dirty_cells: editable ? edit.dirty_cells : undefined,
    deleted_rows: editable ? edit.deleted_rows : undefined,
    on_edit_cell: editable ? edit.on_edit_cell : undefined,
    on_cell_changed: sync_json,
    on_open_json: open_json,
  });

  // Mark every FULLY selected row for deletion — mirrors `Grid`'s own
  // `do_delete`.
  const do_delete = useCallback(() => {
    const total_cols = result.columns.length;
    const by_row = new Map<number, number>();
    for (const key of ctl.selected) {
      const sep = key.indexOf("\u0000");
      const r = Number(key.slice(0, sep));
      by_row.set(r, (by_row.get(r) ?? 0) + 1);
    }
    for (const [r, n] of by_row) {
      if (n === total_cols) edit.delete_row(r);
    }
  }, [result.columns.length, ctl.selected, edit]);

  const bridge: GridBridge = useMemo(
    () => ({
      rows: edit.display_rows.length,
      total: edit.display_rows.length,
      loading: edit.op_running,
      total_pages: 1,
      page: 0,
      set_page: () => {},
      page_size: Math.max(edit.display_rows.length, 1),
      set_page_size: () => {},
      selected_cell_count: ctl.selected.size,
      editable: true,
      table: editable_source?.table ?? "",
      bulk_edit_selection: ctl.bulk_edit_selection,
      all_columns: ctl.view.full_column_order,
      hidden_columns: [...ctl.hidden_columns],
      toggle_column_visibility: ctl.toggle_column_visibility,
      reorder_column: ctl.reorder_column,
      reveal_column: ctl.reveal_column,
      elapsed_ms: result.elapsed_ms,
      delete_rows: do_delete,
      pending_exists: edit.pending_exists,
      pending_count: edit.pending_count,
      start_pending: edit.start_pending,
      apply_pending: edit.apply_pending,
      cancel_pending: edit.cancel_pending,
      get_pending_sql: edit.build_pending_sql,
      get_pending_changes: edit.build_pending_changes,
      refresh: () => on_refresh?.(),
      get_export: () => ({
        table: editable_source?.table ?? "",
        columns: result.columns,
        rows: edit.display_rows,
        types: types ?? {},
      }),
      get_filtered_op: () => ({
        kind: "select",
        table: editable_source?.table ?? "",
      }),
      database,
      schema_name,
    }),
    [
      result,
      ctl.selected.size,
      ctl.bulk_edit_selection,
      ctl.view.full_column_order,
      ctl.hidden_columns,
      ctl.toggle_column_visibility,
      ctl.reorder_column,
      ctl.reveal_column,
      do_delete,
      edit,
      editable_source,
      types,
      on_refresh,
      database,
      schema_name,
    ],
  );

  return (
    <div ref={pane_ref} className="flex min-h-0 flex-1 flex-col">
      <div className="bg-background flex min-h-8 shrink-0 items-center justify-between gap-1 border-b px-2">
        <ResultViewTabs active={view} on_change={setView} />
        {editable && (
          <GridActionBar
            bridge={bridge}
            conn_id={conn_id}
            pane_ref={pane_ref}
            bulk_edit={
              editable_source
                ? {
                    columns: editable_source.schema.columns.map((c) => ({
                      name: c.name,
                      data_type: c.data_type,
                    })),
                    distinct: {},
                  }
                : undefined
            }
          />
        )}
      </div>
      {view === "summary" ? (
        <ResultSummary result={result} message={message} />
      ) : view === "query" ? (
        <ResultQueryText text={query_text} />
      ) : (
        <div className="min-h-0 flex-1 border" data-selectable>
          {ctl.row_count === 0 && !result.error ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              No rows.
            </p>
          ) : (
            <GridProvider value={ctl}>
              <GridBody />
            </GridProvider>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ResultSummary({
  result,
  message,
}: {
  result: QueryResult;
  message?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="max-w-md">
        <SummaryRow label="Status" value={result.error ? "Error" : "OK"} />
        <SummaryRow label="Elapsed" value={`${result.elapsed_ms} ms`} />
        <SummaryRow
          label={result.is_select ? "Rows returned" : "Rows affected"}
          value={String(
            result.is_select ? resultRowCount(result) : result.rows_affected,
          )}
        />
        {message && <SummaryRow label="Message" value={message} />}
      </div>
      {result.error && (
        <pre className="border-destructive/30 bg-destructive/5 text-destructive mt-3 max-w-2xl overflow-x-auto rounded-md border p-2.5 text-xs whitespace-pre-wrap">
          {result.error}
        </pre>
      )}
    </div>
  );
}

function ResultQueryText({ text }: { text: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <pre className="bg-muted/40 max-w-full overflow-x-auto rounded-md border p-2.5 font-mono text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}
