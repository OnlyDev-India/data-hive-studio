import { create } from "zustand";
import {
  cancelRun,
  compareData,
  type CompareDataRequest,
  type DiffCounts,
  type DiffRow,
  type KeyVal,
  type RowsRead,
} from "@/shared/api";
import type { DiffGridRow } from "@/shared/components/diff-grid";
import { useStudioStore } from "@/shared/store";

export const DIFF_PAGE_SIZE = 50_000;

/** How often arriving rows are handed to the grid while a diff runs. */
const FLUSH_MS = 120;

/** What a diff compares; each page runs it again from a different key. */
export type DataRequest = Omit<
  CompareDataRequest,
  "run_id" | "after_key" | "count_all" | "page_size"
>;

export interface RowKey {
  key: KeyVal[];
  display: string[];
}

/** One compare tab's data diff. Session only: never persisted. */
export interface DataRun {
  /** The setup it ran with; a different current setup means it is stale. */
  sig: string;
  req: DataRequest;
  run_id: string;
  left_conn: string;
  status: "running" | "done" | "stopped" | "error";
  stopping: boolean;
  columns: string[];
  key_columns: string[];
  counts: DiffCounts;
  rows_read: RowsRead;
  rows: DiffGridRow[];
  /** Each row's key, parallel to `rows`. */
  keys: RowKey[];
  /** Known once the first page's run read both sides to the end; later
   *  pages keep the first run's counts and total. */
  total_diffs: number | null;
  next_key: KeyVal[] | null;
  /** 0 based. */
  page: number;
  /** The key each page starts after; `page_starts[0]` is null. */
  page_starts: (KeyVal[] | null)[];
  error: string | null;
}

const ZERO_COUNTS: DiffCounts = {
  identical: 0,
  changed: 0,
  left_only: 0,
  right_only: 0,
};

const useRuns = create<{ runs: Record<string, DataRun> }>(() => ({
  runs: {},
}));

export function useDataRun(tab_key: string): DataRun | null {
  return useRuns((s) => s.runs[tab_key] ?? null);
}

/** Update a tab's run, only while it is still the same run. */
function patch(tab_key: string, run_id: string, p: Partial<DataRun>) {
  useRuns.setState((s) => {
    const cur = s.runs[tab_key];
    if (!cur || cur.run_id !== run_id) return s;
    return { runs: { ...s.runs, [tab_key]: { ...cur, ...p } } };
  });
}

function record(
  columns: string[],
  values: (string | null)[] | undefined,
): Record<string, string | null> | undefined {
  if (!values) return undefined;
  const out: Record<string, string | null> = {};
  columns.forEach((c, i) => (out[c] = values[i] ?? null));
  return out;
}

/** Right reads as "before", left as "after": what would change on the right
 *  to make it match the left. */
export function to_grid_row(
  r: DiffRow,
  i: number,
  columns: string[],
): DiffGridRow {
  return {
    id: String(i),
    kind:
      r.kind === "left_only"
        ? "insert"
        : r.kind === "right_only"
          ? "delete"
          : "update",
    label: r.key_display.join(", "),
    before: record(columns, r.right),
    after: record(columns, r.left),
    changed: r.changed?.map((c) => columns[c]),
  };
}

/** Runs the diff from the first page, reading both sides to the end so the
 *  counts and the total are complete. */
export function start_data_diff(
  tab_key: string,
  sig: string,
  req: DataRequest,
): Promise<void> {
  return run_page(tab_key, sig, req, 0, [null], ZERO_COUNTS, null, true);
}

/** Moves to the next or the previous page of a finished diff. Later pages
 *  resume after a saved key and stop once the page is full. */
export function turn_page(tab_key: string, dir: 1 | -1): Promise<void> {
  const run = useRuns.getState().runs[tab_key];
  if (!run || run.status !== "done" || run.total_diffs === null)
    return Promise.resolve();
  const page = run.page + dir;
  const starts = run.page_starts.slice(0, page + 1);
  if (dir === 1) {
    if (!run.next_key) return Promise.resolve();
    starts[page] = run.next_key;
  }
  if (page < 0 || starts[page] === undefined) return Promise.resolve();
  return run_page(
    tab_key,
    run.sig,
    run.req,
    page,
    starts,
    run.counts,
    run.total_diffs,
    false,
  );
}

async function run_page(
  tab_key: string,
  sig: string,
  req: DataRequest,
  page: number,
  page_starts: (KeyVal[] | null)[],
  first_counts: DiffCounts,
  first_total: number | null,
  count_all: boolean,
): Promise<void> {
  const prev = useRuns.getState().runs[tab_key];
  if (prev?.status === "running") void stop_data_diff(tab_key);

  const run_id = crypto.randomUUID();
  const offset = page * DIFF_PAGE_SIZE;
  const rows: DiffGridRow[] = [];
  const keys: RowKey[] = [];
  let counts = first_counts;
  let rows_read: RowsRead = { left: 0, right: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    patch(tab_key, run_id, {
      rows: rows.slice(),
      keys: keys.slice(),
      counts,
      rows_read,
    });
  };

  useRuns.setState((s) => ({
    runs: {
      ...s.runs,
      [tab_key]: {
        sig,
        req,
        run_id,
        left_conn: req.left.conn_id,
        status: "running",
        stopping: false,
        columns: req.columns,
        key_columns: req.key_columns,
        counts,
        rows_read,
        rows: [],
        keys: [],
        total_diffs: first_total,
        next_key: null,
        page,
        page_starts,
        error: null,
      },
    },
  }));

  try {
    const summary = await compareData(
      {
        ...req,
        run_id,
        after_key: page_starts[page] ?? null,
        count_all,
        page_size: DIFF_PAGE_SIZE,
      },
      (chunk) => {
        if (chunk.type === "rows") {
          for (const r of chunk.rows) {
            rows.push(to_grid_row(r, offset + rows.length, req.columns));
            keys.push({ key: r.key, display: r.key_display });
          }
        } else if (chunk.type === "progress") {
          if (count_all) counts = chunk.counts;
          rows_read = chunk.rows_read;
        } else {
          return;
        }
        timer ??= setTimeout(flush, FLUSH_MS);
      },
    );
    if (timer) clearTimeout(timer);
    patch(tab_key, run_id, {
      status: summary.status,
      stopping: false,
      rows: rows.slice(),
      keys: keys.slice(),
      counts: count_all ? summary.counts : first_counts,
      rows_read: summary.rows_read,
      total_diffs: count_all ? summary.total_diffs : first_total,
      next_key: summary.next_key,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    patch(tab_key, run_id, {
      status: "error",
      stopping: false,
      rows: [],
      keys: [],
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function stop_data_diff(tab_key: string): Promise<void> {
  const run = useRuns.getState().runs[tab_key];
  if (!run || run.status !== "running" || run.stopping) return;
  patch(tab_key, run.run_id, { stopping: true });
  try {
    await cancelRun(run.left_conn, run.run_id);
  } catch {
    patch(tab_key, run.run_id, { stopping: false });
  }
}

/** Forget a tab's results (a new setup, Swap). A running diff is stopped. */
export function clear_data_diff(tab_key: string): void {
  void stop_data_diff(tab_key);
  useRuns.setState((s) => {
    if (!(tab_key in s.runs)) return s;
    const runs = { ...s.runs };
    delete runs[tab_key];
    return { runs };
  });
}

// A closed compare tab takes its results (and any running diff) with it.
useStudioStore.subscribe((state, prev) => {
  if (state.compareTabs === prev.compareTabs) return;
  for (const key of Object.keys(useRuns.getState().runs)) {
    if (!(key in state.compareTabs)) clear_data_diff(key);
  }
});
