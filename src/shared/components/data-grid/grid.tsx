import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  executeOp,
  executeOpStream,
  type QueryOp,
  type QueryResult,
  type TableSchema,
} from "@/shared/api";
import { useStudioStore, type GridBridge, type JsonRow } from "@/shared/store";
import { GridBody } from "./grid-body";
import { GridProvider } from "./grid-context";
import { useGridController } from "./grid-controller";
import {
  classify,
  type CellKind,
  type DistinctMap,
  type GridFilter,
} from "./types";

interface GridProps {
  conn_id: string;
  table: string;
  schema: TableSchema;
  revision: number;
  tab_key: string;
  filters: GridFilter[];
  custom_where: string;
  distinct: DistinctMap;
  on_refresh?: () => void;
  /** Called when an FK cell's jump icon is clicked — opens the referenced
   * table filtered to this value. */
  on_open_reference?: (
    table: string,
    column: string,
    value: string | null,
  ) => void;
  /** True while a schema Apply is in flight for this pane — blocks the grid. */
  props_busy?: boolean;
  /** False when this tab is hidden — pauses the row virtualizer so hidden
   *  grids don't measure garbage or keep stale rows mounted. */
}

// Render one cell value as a SQL literal. Values are always single-quoted —
// both SQLite and Postgres coerce string literals to the target column type,
// and escaping is just doubling the quote.
function sql_literal(v: string | null): string {
  return v === null ? "NULL" : `'${v.replaceAll("'", "''")}'`;
}

// Double-quoted identifier (works for SQLite and Postgres alike).
function sql_ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function Grid({
  conn_id,
  table,
  schema,
  revision,
  tab_key,
  filters,
  custom_where,
  distinct,
  on_refresh,
  on_open_reference,
  props_busy = false,
}: GridProps) {
  const [page, setPage] = useState(0);
  const [page_size, setPageSize] = useState(50);
  const [local_rev, setLocalRev] = useState(0);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [total, setTotal] = useState(0);
  /** Last fetched total + the fetch identity it belongs to — lets page flips
   *  and sorts skip the COUNT round trip entirely. */
  const count_cache = useRef<{ key: string; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [op_running, setOpRunning] = useState(false);
  /** External busy signal (e.g. a schema Apply is in flight) — treated the
   *  same as a data fetch: overlay + edit lock. */
  const external_busy = !!props_busy;
  const show_loading = loading || external_busy || op_running;
  const [op_error, setOpError] = useState<string | null>(null);
  /** New (not-yet-inserted) rows being drafted in the grid before Apply. The
   * first entry is the most recently added and is pinned to the top of the grid. */
  interface PendingRow {
    id: number;
    values: (string | null)[];
    dirty: boolean;
  }
  const [pending, setPending] = useState<PendingRow[]>([]);
  const pending_id_ref = useRef(0);
  /** Buffered cell edits on real rows, keyed by `${col}\u0000${realRow}`. The
   * grid shows these immediately; they only hit the DB on Apply. */
  const [dirty_cells, setDirtyCells] = useState<Map<string, string | null>>(
    new Map(),
  );
  /** Real row indices (into the current page) marked for deletion, awaiting Apply. */
  const [deleted_rows, setDeletedRows] = useState<Set<number>>(new Set());

  // Run a mutation, clearing any previous error and refreshing on success, or
  // showing the backend error so a failed op is never silently swallowed.
  const run_op = useCallback((p: Promise<unknown>, success?: () => void) => {
    // Writes (row apply/delete/edit) share the same busy treatment as
    // fetches: overlay on, controls locked until the promise settles.
    setOpRunning(true);
    void p
      .then(() => {
        setOpError(null);
        success?.();
      })
      .catch((e) => setOpError(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpRunning(false));
  }, []);
  const clear_error = useCallback(() => setOpError(null), []);

  const setGridBridge = useStudioStore((s) => s.setGridBridge);
  const clearGridBridge = useStudioStore((s) => s.clearGridBridge);
  const setJsonRow = useStudioStore((s) => s.setJsonRow);
  const setRightSidebarOpen = useStudioStore((s) => s.setRightSidebarOpen);

  // The controller keeps the JSON viewer in sync with the anchor cell; the
  // viewer opens on the context-menu action.
  const sync_json = useCallback(
    (row: JsonRow) => setJsonRow(row),
    [setJsonRow],
  );
  const open_json = useCallback(
    () => setRightSidebarOpen(true),
    [setRightSidebarOpen],
  );

  const pk_columns = useMemo(
    () => schema.columns.filter((c) => c.primary_key).map((c) => c.name),
    [schema],
  );
  // Editing is enabled for real tables; Postgres views/matviews open
  // read-only. Updates/deletes target rows by primary key when one exists,
  // else by their full original contents.
  const editable = (schema.kind || "table") === "table";

  // Columns the database will want to assign itself: primary keys plus columns
  // covered by a UNIQUE index. Cloned drafts leave these empty so inserting
  // duplicates can't collide.
  const unique_columns = useMemo(() => {
    const set = new Set(pk_columns);
    for (const idx of schema.indexes) {
      if (idx.unique) for (const c of idx.columns) set.add(c);
    }
    return set;
  }, [schema, pk_columns]);

  const column_types = useMemo(
    () => Object.fromEntries(schema.columns.map((c) => [c.name, c.data_type])),
    [schema],
  );

  const key_kinds = useMemo(() => {
    const map: Record<string, "primary" | "foreign" | "both"> = {};
    for (const c of schema.columns) {
      if (c.primary_key) map[c.name] = "primary";
    }
    // A column can be both primary and foreign key (1:1 relations); keep both.
    for (const fk of schema.foreign_keys) {
      map[fk.column] = map[fk.column] === "primary" ? "both" : "foreign";
    }
    return map;
  }, [schema]);

  // Column name -> referenced table/column, so FK cells can jump to the
  // referenced record.
  const fk_targets = useMemo(
    () =>
      Object.fromEntries(
        schema.foreign_keys.map((fk) => [
          fk.column,
          { table: fk.referenced_table, column: fk.referenced_column },
        ]),
      ),
    [schema],
  );

  // Column name -> whether the column allows NULL (drives the NULL dropdown
  // option in cell editors; SQLite booleans are 0/1 integers, not NULL).
  const nullable = useMemo(
    () => Object.fromEntries(schema.columns.map((c) => [c.name, !c.not_null])),
    [schema],
  );

  // Map each column to its editor kind.
  const kinds = useMemo(
    () =>
      Object.fromEntries(
        schema.columns.map((c) => [
          c.name,
          classify(c.data_type.toLowerCase()),
        ]),
      ),
    [schema],
  );
  const kindsTyped = kinds as Record<string, CellKind>;

  const refresh = useCallback(() => setLocalRev((r) => r + 1), []);

  // New filters/WHERE clauses always restart browsing from the first page.
  // Adjusted during render (React's "storing information from previous renders"
  // pattern) rather than in an effect so page state stays in sync without a
  // cascading render.
  const [prev_query, setPrevQuery] = useState<{
    f: GridFilter[];
    w: string;
  } | null>(null);
  if (
    prev_query === null ||
    prev_query.f !== filters ||
    prev_query.w !== custom_where
  ) {
    setPrevQuery({ f: filters, w: custom_where });
    if (prev_query !== null) setPage(0);
  }

  // A raw WHERE clause written by the user takes precedence over UI filters.
  // Both are passed through as details; the backend adapter builds the SQL.
  const user_where = custom_where.trim() || undefined;

  const offset = page * page_size;

  // Full original contents of one page-row, used to target updates/deletes.
  // Pending rows sit at the top of the grid, so real-row lookups are offset
  // by them.
  const row_match = useCallback(
    (row_idx: number): Record<string, string | null> | null => {
      if (!result || result.columns.length === 0) return null;
      const ri = row_idx - pending.length;
      if (ri < 0) return null;
      const row_data = result.rows[ri];
      if (!row_data) return null;
      return Object.fromEntries(
        result.columns.map((c, i) => [c, row_data[i] ?? null]),
      );
    },
    [result, pending.length],
  );

  // Target one page-row by primary key alone: every PK column must exist in
  // the result with a non-null ORIGINAL value. Null when there is no usable
  // PK (no key, or a key part NULL — possible in SQLite) — callers fall back
  // to full-row matching. Original values keep the target stable even while
  // the user edits key columns of the same batch.
  const pk_match = useCallback(
    (row_idx: number): Record<string, string | null> | null => {
      if (!result || pk_columns.length === 0) return null;
      const ri = row_idx - pending.length;
      if (ri < 0) return null;
      const row_data = result.rows[ri];
      if (!row_data) return null;
      const out: Record<string, string | null> = {};
      for (const c of pk_columns) {
        const ci = result.columns.indexOf(c);
        if (ci < 0) return null;
        const v = row_data[ci] ?? null;
        if (v === null) return null;
        out[c] = v;
      }
      return out;
    },
    [result, pk_columns, pending.length],
  );

  // Best targeting for updates/deletes: PK when available, else every column.
  const match_for = useCallback(
    (row_idx: number): Record<string, string | null> | null =>
      pk_match(row_idx) ?? row_match(row_idx),
    [pk_match, row_match],
  );

  // A delete operation targeting one page-row by its best-match columns.
  const row_delete_op = useCallback(
    (row_idx: number): QueryOp | null => {
      const match_row = match_for(row_idx);
      return match_row ? { kind: "delete", table, match_row } : null;
    },
    [match_for, table],
  );

  // Delete a single row (context menu). Buffered: the row is marked for
  // deletion and only removed from the DB when Apply is hit.
  const delete_row = useCallback(
    (ri: number) => {
      const real = ri - pending.length;
      if (real < 0) return;
      setDeletedRows((cur) => {
        if (cur.has(real)) return cur;
        const next = new Set(cur);
        next.add(real);
        return next;
      });
    },
    [pending.length],
  );

  // Duplicate the clicked row as a draft (context menu). Rather than inserting
  // immediately, the row's values are copied into a new pending row pinned to
  // the top of the grid awaiting Apply. Columns with a UNIQUE/PK constraint are
  // left empty so the DB can assign a fresh value.
  const clone_into_pending = useCallback(
    (ri: number) => {
      setOpError(null);
      setPending((cur) => {
        if (!result) return cur;
        const src = result.rows[ri - cur.length];
        if (!src) return cur;
        const values = result.columns.map((c, ci) =>
          unique_columns.has(c) ? null : (src[ci] ?? null),
        );
        return [{ id: ++pending_id_ref.current, values, dirty: false }, ...cur];
      });
    },
    [result, unique_columns],
  );

  // Set a single cell to NULL (context menu). Buffered as a cell edit.
  const set_null = useCallback(
    (ri: number, col: string) => {
      const real = ri - pending.length;
      if (real < 0) return;
      setDirtyCells((cur) => {
        const next = new Map(cur);
        next.set(`${col}\u0000${real}`, null);
        return next;
      });
    },
    [pending.length],
  );

  // Buffer a cell edit on a real row. The grid shows the new value immediately
  // (the controller overlays it) and the cell is highlighted until Apply. If
  // the value is changed back to its original stored value, the edit is
  // dropped instead (null and empty string are treated as the same "nothing").
  const on_edit_cell = useCallback(
    (row: number, col: string, value: string | null) => {
      const real = row - pending.length;
      if (real < 0) return;
      const original =
        result?.rows[real]?.[result.columns.indexOf(col)] ?? null;
      const norm = (v: string | null) => (v === null || v === "" ? "" : v);
      setDirtyCells((cur) => {
        const key = `${col}\u0000${real}`;
        const next = new Map(cur);
        if (norm(value) === norm(original)) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      });
    },
    [pending.length, result],
  );

  // Start drafting a new row: pin a blank pending row to the top of the grid
  // and drop the user into the first cell. Nothing touches the DB yet.
  const start_pending = useCallback(() => {
    setOpError(null);
    setPending((cur) => {
      if (!result) return cur;
      return [
        {
          id: ++pending_id_ref.current,
          values: result.columns.map(() => null),
          dirty: false,
        },
        ...cur,
      ];
    });
  }, [result]);

  // Any edit made inside a pending row is buffered here (a null write means
  // the user explicitly set the cell to NULL via the editor).
  const on_pending_edit = useCallback(
    (row: number, col: string, value: string | null) => {
      setPending((cur) => {
        if (!cur || !result) return cur;
        const entry = cur[row];
        if (!entry) return cur;
        const ci = result.columns.indexOf(col);
        if (ci < 0) return cur;
        const values = [...entry.values];
        values[ci] = value;
        const next = cur.slice();
        next[row] = { ...entry, values, dirty: true };
        return next;
      });
    },
    [result],
  );

  // Discard a single drafted row (its gutter trash icon), leaving the rest of
  // the batch untouched.
  const remove_pending = useCallback((row: number) => {
    setPending((cur) => cur.filter((_, i) => i !== row));
  }, []);

  // Apply every buffered change: insert drafts, run each buffered cell edit,
  // then delete the marked rows. Updates and deletes patch the loaded page in
  // place (optimistic) — the resulting values are already on screen, so no
  // refetch SELECT is needed. Inserts still refetch (the database assigns
  // defaults/autoincrement we can't know locally), and so does any write that
  // reports zero affected rows, meaning the page no longer matches the DB.
  const apply_pending = useCallback(() => {
    if (!result) return;
    const cols = result.columns;
    if (cols.length === 0) return;
    const patches: { real: number; col: string; value: string | null }[] = [];
    const ops: Promise<unknown>[] = [];
    for (const p of pending) {
      // Columns with no value are left out of the INSERT so the database can
      // apply its defaults/autoincrement.
      const values = Object.fromEntries(
        cols.map((c, ci) => [c, p.values[ci] ?? null]),
      );
      ops.push(
        executeOp(conn_id, { kind: "insert", table, values, skip_empty: true }),
      );
    }
    for (const [key, value] of dirty_cells) {
      const sep = key.indexOf("\u0000");
      if (sep < 0) continue;
      const col = key.slice(0, sep);
      const real = Number(key.slice(sep + 1));
      if (deleted_rows.has(real)) continue;
      const match_row = match_for(real + pending.length);
      if (!match_row) continue;
      patches.push({ real, col, value });
      ops.push(
        executeOp(conn_id, {
          kind: "update",
          table,
          set: { [col]: value },
          match_row,
        }),
      );
    }
    for (const real of deleted_rows) {
      const op = row_delete_op(real + pending.length);
      if (op) ops.push(executeOp(conn_id, op));
    }
    if (ops.length === 0) return;
    const inserted = pending.length;
    // Highest index first so splices don't shift pending targets.
    const deleted_sorted = [...deleted_rows].sort((a, b) => b - a);
    let outcomes: QueryResult[] = [];
    run_op(
      Promise.all(ops).then((rs) => {
        outcomes = rs as QueryResult[];
      }),
      () => {
        setPending([]);
        setDirtyCells(new Map());
        setDeletedRows(new Set());
        if (inserted > 0 || outcomes.some((r) => r.rows_affected === 0)) {
          // Freshly inserted rows land on the last page; a zero-affected write
          // means the database moved under us. Both need a real refetch.
          setPage(Math.max(0, Math.ceil((total + inserted) / page_size) - 1));
          refresh();
          return;
        }
        // Optimistic: mirror the writes in the already-loaded rows.
        setResult((cur) => {
          if (!cur) return cur;
          const rows = cur.rows.map((r) => [...r]);
          for (const p of patches) {
            const ci = cur.columns.indexOf(p.col);
            if (ci >= 0 && rows[p.real]) rows[p.real][ci] = p.value;
          }
          for (const ri of deleted_sorted) rows.splice(ri, 1);
          return { ...cur, rows };
        });
        setTotal((t) => Math.max(0, t - deleted_rows.size));
      },
    );
  }, [
    pending,
    dirty_cells,
    deleted_rows,
    result,
    table,
    conn_id,
    run_op,
    total,
    page_size,
    refresh,
    match_for,
    row_delete_op,
  ]);

  const cancel_pending = useCallback(() => {
    setPending([]);
    setDirtyCells(new Map());
    setDeletedRows(new Set());
    setOpError(null);
  }, []);

  // Render every staged change as runnable SQL — INSERT per drafted row
  // (empty columns omitted so defaults apply), UPDATE per buffered cell edit,
  // DELETE per marked row — mirroring exactly what Apply executes.
  const build_pending_sql = useCallback((): string | null => {
    if (!result) return null;
    const cols = result.columns;
    if (cols.length === 0) return null;
    const where_of = (match_row: Record<string, string | null>): string =>
      Object.entries(match_row)
        .map(([c, v]) =>
          v === null
            ? `${sql_ident(c)} IS NULL`
            : `${sql_ident(c)} = ${sql_literal(v)}`,
        )
        .join("\n  AND ");
    const stmts: string[] = [];
    for (const p of pending) {
      const pairs = cols
        .map((c, ci) => [c, p.values[ci] ?? null] as const)
        .filter(([, v]) => v !== null);
      if (pairs.length === 0) continue;
      stmts.push(
        `INSERT INTO ${sql_ident(table)} (${pairs.map(([c]) => sql_ident(c)).join(", ")})\nVALUES (${pairs.map(([, v]) => sql_literal(v)).join(", ")});`,
      );
    }
    for (const [key, value] of dirty_cells) {
      const sep = key.indexOf("\u0000");
      if (sep < 0) continue;
      const col = key.slice(0, sep);
      const real = Number(key.slice(sep + 1));
      if (deleted_rows.has(real)) continue;
      const match_row = match_for(real + pending.length);
      if (!match_row) continue;
      stmts.push(
        `UPDATE ${sql_ident(table)}\nSET ${sql_ident(col)} = ${sql_literal(value)}\nWHERE ${where_of(match_row)};`,
      );
    }
    for (const real of deleted_rows) {
      const match_row = match_for(real + pending.length);
      if (!match_row) continue;
      stmts.push(
        `DELETE FROM ${sql_ident(table)}\nWHERE ${where_of(match_row)};`,
      );
    }
    return stmts.length > 0 ? stmts.join("\n\n") : null;
  }, [result, pending, dirty_cells, deleted_rows, match_for, table]);

  // Sort state + selection live in the controller; we read the sort cursor out
  // of it for the SQL below and a sort change restarts from page 0.
  const ctl = useGridController({
    rows: result?.rows ?? [],
    columns: result?.columns ?? [],
    row_offset: offset,
    editable,
    loading: show_loading,

    pk_columns,
    conn_id,
    table,
    kinds: kindsTyped,
    types: column_types,
    key_kinds,
    fk_targets,
    nullable,
    distinct,
    on_modified: () => {}, // edits are buffered; nothing to reload on editor close
    on_set_null: set_null,
    on_delete_row: delete_row,
    on_clone_row: clone_into_pending,
    pending_rows: pending,
    on_pending_edit,
    on_remove_pending: remove_pending,
    dirty_cells,
    deleted_rows,
    on_edit_cell,
    on_navigation_change: () => setPage(0),
    on_cell_changed: sync_json,
    on_open_json: open_json,
    on_open_reference,
  });

  // Load the current page + total count. The page SELECT streams its rows in
  // batches so large pages paint progressively; the count is a cheap
  // aggregate fetched alongside. The adapter builds both statements from the
  // same details (filters / raw WHERE / sort / pagination).
  useEffect(() => {
    let cancelled = false;
    // Accumulate streamed rows and flush to state at most once per frame so
    // fast local results don't trigger a render per batch.
    const acc: { cols: string[] | null; rows: (string | null)[][] } = {
      cols: null,
      rows: [],
    };
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (cancelled) return;
      // Hold the previous page on screen until real rows exist — avoids a
      // "No rows." flash between the header chunk and the first batch.
      if (acc.rows.length === 0) return;
      setResult({
        columns: acc.cols ?? [],
        rows: [...acc.rows],
        rows_affected: 0,
        is_select: true,
        error: null,
        elapsed_ms: 0,
      });
    };
    void (async () => {
      try {
        // The total only changes with data/filters/schema — NOT with paging
        // or sorting. Cache it per "count identity" so flipping pages costs
        // one round trip instead of two.
        // Every run of this effect IS a fetch — flag it so the refresh button
        // spins, the overlay blocks edits, and the action bar reflects it.
        setLoading(true);
        const count_key = JSON.stringify([
          conn_id,
          table,
          filters,
          user_where,
          revision,
          local_rev,
        ]);
        const need_count = count_cache.current?.key !== count_key;
        const [pageMeta, totalRes] = await Promise.all([
          executeOpStream(
            conn_id,
            {
              kind: "select",
              table,
              filters,
              custom_where: user_where,
              order_by: ctl.sort_col ?? undefined,
              order_dir: ctl.sort_asc ? "ASC" : "DESC",
              limit: page_size,
              offset,
            },
            (chunk) => {
              if (chunk.columns) acc.cols = chunk.columns;
              if (chunk.rows.length > 0) {
                acc.rows.push(...chunk.rows);
                if (!raf) raf = requestAnimationFrame(flush);
              }
            },
          ),
          need_count
            ? executeOp(conn_id, {
                kind: "count",
                table,
                filters,
                custom_where: user_where,
              })
            : Promise.resolve(null),
        ]);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (cancelled) return;
        // The resolved metadata is authoritative (columns/elapsed); pair it
        // with the accumulated rows.
        setResult({ ...pageMeta, rows: acc.rows });
        if (totalRes) {
          const next_total = Number(totalRes.rows?.[0]?.[0]) || 0;
          count_cache.current = { key: count_key, total: next_total };
          setTotal(next_total);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    conn_id,
    table,
    filters,
    user_where,
    ctl.sort_col,
    ctl.sort_asc,
    page_size,
    offset,
    revision,
    local_rev,
  ]);

  // Distinct values per column (bounded) are fetched by the owning pane and
  // passed in as `distinct` for enum-dropdown / bool editors.

  const total_pages = total === 0 ? 1 : Math.ceil(total / page_size);

  // Count rows that are FULLY selected (every column of the row is selected).
  const { selected_row_count, has_full_row } = useMemo(() => {
    if (!result) return { selected_row_count: 0, has_full_row: false };
    const total_cols = result.columns.length;
    const by_row = new Map<number, number>();
    for (const key of ctl.selected) {
      const sep = key.indexOf("\u0000");
      const r = Number(key.slice(0, sep));
      by_row.set(r, (by_row.get(r) ?? 0) + 1);
    }
    let count = 0;
    for (const n of by_row.values()) if (n === total_cols) count++;
    return { selected_row_count: count, has_full_row: count > 0 };
  }, [result, ctl.selected]);

  // Mark all fully-selected rows for deletion, awaiting Apply.
  const selected_set = ctl.selected;
  const do_delete = useCallback(() => {
    if (!result) return;
    const total_cols = result.columns.length;
    const by_row = new Map<number, number>();
    for (const key of selected_set) {
      const sep = key.indexOf("\u0000");
      const r = Number(key.slice(0, sep));
      by_row.set(r, (by_row.get(r) ?? 0) + 1);
    }
    const row_idxs = [...by_row.entries()]
      .filter(([, n]) => n === total_cols)
      .map(([r]) => r);
    if (row_idxs.length === 0) return;
    setDeletedRows((cur) => {
      const next = new Set(cur);
      let changed = false;
      for (const r of row_idxs) {
        const real = r - pending.length;
        if (real >= 0 && !next.has(real)) {
          next.add(real);
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [result, selected_set, pending.length]);

  // Expose this grid to the status bar (limit, pagination, delete, refresh,
  // and per-tab info) keyed by the owning tab.
  const bridge = useMemo<GridBridge>(
    () => ({
      rows: result?.rows.length ?? 0,
      total,
      total_pages,
      page,
      set_page: setPage,
      page_size,
      set_page_size: (n) => {
        setPageSize(n);
        setPage(0);
      },
      has_full_row,
      selected_count: selected_row_count,
      editable: editable && !show_loading,
      loading: show_loading,
      elapsed_ms: result?.elapsed_ms ?? null,
      pending_exists:
        pending.length > 0 || dirty_cells.size > 0 || deleted_rows.size > 0,
      pending_count: pending.length + deleted_rows.size + dirty_cells.size,
      start_pending,
      apply_pending,
      cancel_pending,
      get_pending_sql: build_pending_sql,
      delete_rows: () => {
        do_delete();
      },
      refresh: () => {
        refresh();
        on_refresh?.();
      },
      get_export: () => {
        if (!result) return null;
        return {
          table,
          columns: result.columns,
          rows: result.rows,
          types: column_types,
        };
      },
      get_filtered_op: () => ({
        kind: "select",
        table,
        filters,
        custom_where: user_where || undefined,
        order_by: ctl.sort_col ?? undefined,
        order_dir: ctl.sort_asc ? "ASC" : "DESC",
      }),
    }),
    [
      result,
      total,
      total_pages,
      page,
      page_size,
      has_full_row,
      selected_row_count,
      editable,
      show_loading,
      op_running,
      do_delete,
      refresh,
      on_refresh,
      pending,
      dirty_cells,
      deleted_rows,
      start_pending,
      apply_pending,
      cancel_pending,
      build_pending_sql,
      table,
      column_types,
      filters,
      user_where,
      ctl.sort_col,
      ctl.sort_asc,
    ],
  );

  useEffect(() => {
    setGridBridge(tab_key, bridge);
    return () => clearGridBridge(tab_key);
  }, [tab_key, bridge, setGridBridge, clearGridBridge]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {op_error && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate">{op_error}</span>
          <Button
            variant="ghost"
            size="iconXs"
            className="hover:bg-destructive/10 size-5"
            aria-label="Dismiss error"
            onClick={clear_error}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      {/* GridBody owns scrolling (it hosts the row virtualizer). */}
      <div
        className="relative min-h-0 flex-1 rounded-md border"
        data-selectable
      >
        {/* Spinners for both first load and refetch live in table-pane's
          overlay; this box just keeps its height so nothing jumps. */}
        {!result ? null : (
          <GridProvider value={ctl}>
            <GridBody />
          </GridProvider>
        )}
      </div>
    </div>
  );
}
