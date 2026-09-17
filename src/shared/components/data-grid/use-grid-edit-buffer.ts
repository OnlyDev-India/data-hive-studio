import { useCallback, useRef, useState } from "react";
import { executeOp, type QueryResult } from "@/shared/api";
import { sql_ident, sql_literal } from "./grid";
import type { PendingChange } from "./grid-context";

interface PendingRow {
  id: number;
  values: (string | null)[];
  dirty: boolean;
}

/** Buffered editing state for a grid that isn't backed by a real, paginated
 *  table fetch — an arbitrary query's result set (see `QueryResultsGrid`).
 *  Deliberately a separate, standalone implementation rather than something
 *  extracted out of `grid.tsx`'s own `Grid`: `Grid` also owns pagination,
 *  FK-label resolution, bulk edit, column visibility/reorder and layout
 *  persistence — none of which apply to a one-off query result — and by now
 *  is too large/entangled a component to safely carve a shared piece out of
 *  without risking its well-exercised table-editing path. What IS shared is
 *  the PATTERN (buffer edits, target rows by primary key, apply as
 *  `executeOp` calls, describe as a diff/SQL, patch the loaded rows in place
 *  on success rather than reloading) — mirroring `Grid`'s own `apply_pending`
 *  exactly for that last part, since a full reload (re-running the query,
 *  with the grid area replaced by a loading skeleton while it does) is a
 *  jarring regression from the smooth in-place update a real table gets.
 *
 *  One simplification this affords, safe specifically because the caller
 *  only ever mounts this when the result is known to be editable (see
 *  `query-results-grid.tsx`'s own gating): rows are matched by PRIMARY KEY
 *  ONLY, never by full-row fallback — a table with no usable PK just isn't
 *  editable through this path (unlike `Grid`, which can fall back to
 *  matching every column because a real table fetch is always `SELECT *`;
 *  an arbitrary query might select only a handful of columns, and matching
 *  by a partial column set risks touching the wrong rows). */
export function useGridEditBuffer(opts: {
  conn_id: string;
  table: string;
  database?: string;
  schema_name?: string;
  pk_columns: string[];
  result: QueryResult;
  on_refresh: () => void;
}) {
  const { conn_id, table, database, schema_name, pk_columns, result, on_refresh } =
    opts;

  // The rows actually shown — starts as `result.rows` and gets patched in
  // place by a successful Apply, same as `Grid`'s own `result` state. Resyncs
  // to `result.rows` whenever a genuinely NEW result arrives (a manual
  // refresh, or `on_refresh()` firing because an insert/zero-affected write
  // needed a real reload) — the "adjust state during render" pattern
  // `grid.tsx`'s own `prev_query`/`setPage(0)` already uses for the same
  // reason: an effect would show the stale rows for one extra frame first.
  const [prev_result, setPrevResult] = useState(result);
  const [display_rows, setDisplayRows] = useState(result.rows);
  if (prev_result !== result) {
    setPrevResult(result);
    setDisplayRows(result.rows);
  }

  const [pending, setPending] = useState<PendingRow[]>([]);
  const pending_id_ref = useRef(0);
  const [dirty_cells, setDirtyCells] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [deleted_rows, setDeletedRows] = useState<Set<number>>(new Set());
  const [op_running, setOpRunning] = useState(false);

  // Target one row by primary key: every PK column must exist in the
  // currently DISPLAYED row (not necessarily `result`'s own original row —
  // a prior successful edit may have already patched `display_rows` without
  // a refetch) with a non-null value. `null` means this row can't be safely
  // targeted (edits/deletes on it are skipped at Apply, same as `Grid`'s own
  // `pk_match` returning null falls through to a full-row match there — no
  // fallback here, see this hook's own doc comment for why).
  const pk_match = useCallback(
    (row_idx: number): Record<string, string | null> | null => {
      // No PK columns to match on means no safe target at all — an empty
      // match object would otherwise build a WHERE clause with zero
      // conditions, i.e. "every row". The caller only ever mounts this hook
      // with a non-empty `pk_columns` (see the doc comment above), but this
      // guard makes that a hard invariant rather than an assumption.
      if (pk_columns.length === 0) return null;
      const ri = row_idx - pending.length;
      const row_data = display_rows[ri];
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
    [display_rows, result.columns, pk_columns, pending.length],
  );

  const delete_row = useCallback(
    (ri: number) => {
      const real = ri - pending.length;
      if (real < 0) return;
      setDeletedRows((cur) => (cur.has(real) ? cur : new Set(cur).add(real)));
    },
    [pending.length],
  );

  // Duplicate every row touched by the current selection as drafts. Columns
  // covered by the primary key are left blank so the DB assigns a fresh one.
  const clone_into_pending = useCallback(
    (ris: number[]) => {
      const unique = new Set(pk_columns);
      setPending((cur) => {
        const base_len = cur.length;
        const drafts = ris
          .map((ri) => display_rows[ri - base_len])
          .filter((src): src is (string | null)[] => !!src)
          .map((src) => ({
            id: ++pending_id_ref.current,
            values: result.columns.map((c, ci) =>
              unique.has(c) ? null : (src[ci] ?? null),
            ),
            dirty: false,
          }));
        return drafts.length > 0 ? [...drafts, ...cur] : cur;
      });
    },
    [display_rows, result.columns, pk_columns],
  );

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

  const on_edit_cell = useCallback(
    (row: number, col: string, value: string | null) => {
      const real = row - pending.length;
      if (real < 0) return;
      const original =
        display_rows[real]?.[result.columns.indexOf(col)] ?? null;
      const norm = (v: string | null) => (v === null || v === "" ? "" : v);
      setDirtyCells((cur) => {
        const key = `${col}\u0000${real}`;
        const next = new Map(cur);
        if (norm(value) === norm(original)) next.delete(key);
        else next.set(key, value);
        return next;
      });
    },
    [pending.length, display_rows, result.columns],
  );

  const on_pending_edit = useCallback(
    (row: number, col: string, value: string | null) => {
      setPending((cur) => {
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
    [result.columns],
  );

  const start_pending = useCallback(() => {
    setPending((cur) => [
      {
        id: ++pending_id_ref.current,
        values: result.columns.map(() => null),
        dirty: false,
      },
      ...cur,
    ]);
  }, [result.columns]);

  const on_remove_pending = useCallback((row: number) => {
    setPending((cur) => cur.filter((_, i) => i !== row));
  }, []);

  const cancel_pending = useCallback(() => {
    setPending([]);
    setDirtyCells(new Map());
    setDeletedRows(new Set());
  }, []);

  // Apply every buffered change, mirroring `Grid`'s own `apply_pending`:
  // updates/deletes patch `display_rows` in place (optimistic) once they
  // succeed — the resulting values are already known, so no refetch SELECT
  // is needed. Inserts still refetch (the database assigns defaults/
  // autoincrement we can't know locally), and so does any write that
  // reports zero affected rows, meaning the result no longer matches the DB.
  const apply_pending = useCallback(
    (keepIds?: Set<string>) => {
      const cols = result.columns;
      if (cols.length === 0) return;
      const ins = keepIds
        ? pending.filter((p) => keepIds.has(`ins:${p.id}`))
        : pending;
      const edits = keepIds
        ? new Map([...dirty_cells].filter(([k]) => keepIds.has(k)))
        : dirty_cells;
      const dels = keepIds
        ? new Set([...deleted_rows].filter((r) => keepIds.has(`del:${r}`)))
        : deleted_rows;
      const ins_len = ins.length;

      const patches: { real: number; col: string; value: string | null }[] = [];
      const ops: Promise<QueryResult>[] = [];
      for (const p of ins) {
        const values = Object.fromEntries(
          cols.map((c, ci) => [c, p.values[ci] ?? null]),
        );
        ops.push(
          executeOp(
            conn_id,
            { kind: "insert", table, values, skip_empty: true },
            database,
            schema_name,
          ),
        );
      }
      for (const [key, value] of edits) {
        const sep = key.indexOf("\u0000");
        if (sep < 0) continue;
        const col = key.slice(0, sep);
        const real = Number(key.slice(sep + 1));
        if (dels.has(real)) continue;
        const match_row = pk_match(real + ins_len);
        if (!match_row) continue;
        patches.push({ real, col, value });
        ops.push(
          executeOp(
            conn_id,
            { kind: "update", table, set: { [col]: value }, match_row },
            database,
            schema_name,
          ),
        );
      }
      for (const real of dels) {
        const match_row = pk_match(real + ins_len);
        if (match_row) {
          ops.push(
            executeOp(
              conn_id,
              { kind: "delete", table, match_row },
              database,
              schema_name,
            ),
          );
        }
      }
      if (ops.length === 0) return;
      const inserted = ins_len;
      // Highest index first so splices don't shift later targets.
      const deleted_sorted = [...dels].sort((a, b) => b - a);
      setOpRunning(true);
      void Promise.all(ops)
        .then((outcomes) => {
          setPending([]);
          setDirtyCells(new Map());
          setDeletedRows(new Set());
          if (inserted > 0 || outcomes.some((r) => r.rows_affected === 0)) {
            // A fresh row the DB assigned defaults to, or a write that
            // silently matched nothing (the result no longer reflects the
            // DB) — both need a real re-run, not a patch.
            on_refresh();
            return;
          }
          setDisplayRows((cur) => {
            const rows = cur.map((r) => [...r]);
            for (const p of patches) {
              const ci = cols.indexOf(p.col);
              if (ci >= 0 && rows[p.real]) rows[p.real][ci] = p.value;
            }
            for (const real of deleted_sorted) rows.splice(real, 1);
            return rows;
          });
        })
        .finally(() => setOpRunning(false));
    },
    [
      pending,
      dirty_cells,
      deleted_rows,
      result.columns,
      table,
      conn_id,
      database,
      schema_name,
      pk_match,
      on_refresh,
    ],
  );

  const build_pending_changes = useCallback((): PendingChange[] => {
    const cols = result.columns;
    const changes: PendingChange[] = [];
    for (const p of pending) {
      changes.push({
        id: `ins:${p.id}`,
        kind: "insert",
        row: -1,
        values: p.values,
        value_columns: cols,
      });
    }
    for (const [key, value] of dirty_cells) {
      const sep = key.indexOf("\u0000");
      if (sep < 0) continue;
      const col = key.slice(0, sep);
      const real = Number(key.slice(sep + 1));
      if (deleted_rows.has(real)) continue;
      const ci = cols.indexOf(col);
      changes.push({
        id: key,
        kind: "update",
        row: real + 1,
        column: col,
        before: ci >= 0 ? (display_rows[real]?.[ci] ?? null) : null,
        after: value,
      });
    }
    for (const real of deleted_rows) {
      const row_data = display_rows[real];
      if (!row_data) continue;
      changes.push({
        id: `del:${real}`,
        kind: "delete",
        row: real + 1,
        values: row_data,
        value_columns: cols,
      });
    }
    return changes;
  }, [result.columns, display_rows, pending, dirty_cells, deleted_rows]);

  const build_pending_sql = useCallback((): string | null => {
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
      const match_row = pk_match(real + pending.length);
      if (!match_row) continue;
      stmts.push(
        `UPDATE ${sql_ident(table)}\nSET ${sql_ident(col)} = ${sql_literal(value)}\nWHERE ${where_of(match_row)};`,
      );
    }
    for (const real of deleted_rows) {
      const match_row = pk_match(real + pending.length);
      if (!match_row) continue;
      stmts.push(`DELETE FROM ${sql_ident(table)}\nWHERE ${where_of(match_row)};`);
    }
    return stmts.length > 0 ? stmts.join("\n\n") : null;
  }, [result.columns, pending, dirty_cells, deleted_rows, pk_match, table]);

  return {
    display_rows,
    pending,
    dirty_cells,
    deleted_rows,
    on_edit_cell,
    on_pending_edit,
    on_remove_pending,
    set_null,
    delete_row,
    clone_into_pending,
    start_pending,
    apply_pending,
    cancel_pending,
    build_pending_changes,
    build_pending_sql,
    pending_exists:
      pending.length > 0 || dirty_cells.size > 0 || deleted_rows.size > 0,
    pending_count: pending.length + deleted_rows.size + dirty_cells.size,
    op_running,
  };
}
