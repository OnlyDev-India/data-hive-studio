import { useMemo, useCallback, useEffect } from "react";
import type { QueryResult } from "@/shared/api";
import { useStudioStore, type JsonRow } from "@/shared/store";
import { GridBody } from "./grid-body";
import { GridProvider } from "./grid-context";
import { useGridController } from "./grid-controller";
import type { CellKind } from "./types";

/**
 * The same Excel-like grid used for table data, shown for an arbitrary SQL
 * query's result. Selection, drag-to-select, copy and column pinning all work;
 * there's no schema so rows are read-only. Sorting happens in-memory (descending
 * keeps NULLs at the bottom of ascending sorts, matching a SQL engine's default).
 */
export function QueryResultsGrid({
  result,
  conn_id,
  tab_key,
}: {
  result: QueryResult;
  conn_id: string;
  tab_key: string;
}) {
  const setJsonRow = useStudioStore((s) => s.setJsonRow);
  const setRightSidebarOpen = useStudioStore((s) => s.setRightSidebarOpen);
  const json_scope = `${conn_id}\u0000${tab_key}`;
  const sync_json = useCallback(
    (row: JsonRow) => setJsonRow(json_scope, { ...row, kind: "sql" }),
    [setJsonRow, json_scope],
  );
  const open_json = useCallback(
    () => setRightSidebarOpen(true),
    [setRightSidebarOpen],
  );
  // A new query's result invalidates whatever row was published for this tab.
  useEffect(() => {
    setJsonRow(json_scope, null);
  }, [result, json_scope, setJsonRow]);

  // All query cells are text (no declared types) – fine, cells are read-only.
  const kinds: Record<string, CellKind> = useMemo(
    () =>
      Object.fromEntries(result.columns.map((c) => [c, "text" as CellKind])),
    [result],
  );

  const ctl = useGridController({
    rows: result.rows,
    columns: result.columns,
    row_offset: 0,
    editable: false,
    pk_columns: [],
    conn_id: "",
    table: "",
    kinds,
    distinct: {},
    client_sort: true,
    on_modified() {},
    on_set_null() {},
    on_delete_row() {},
    on_cell_changed: sync_json,
    on_open_json: open_json,
  });

  return (
    <div className="min-h-0 flex-1 rounded-md border" data-selectable>
      {ctl.rows.length === 0 && !result.error ? (
        <p className="text-muted-foreground px-3 py-8 text-center text-sm">
          No rows.
        </p>
      ) : (
        <GridProvider value={ctl}>
          <GridBody />
        </GridProvider>
      )}
    </div>
  );
}
