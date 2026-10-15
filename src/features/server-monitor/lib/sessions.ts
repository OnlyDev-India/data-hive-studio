import type {
  KillAction,
  MonitorEngine,
  SessionRow,
  SessionState,
} from "@/shared/api";

/** Most sessions one snapshot carries. Keep in step with
 *  `MAX_MONITOR_ROWS` in `crates/dh-core/src/db/monitor.rs`. */
export const MAX_MONITOR_ROWS = 2000;

/** The Sessions filters. Every change filters the last snapshot again, with
 *  no new request (AC-4). */
export interface MonitorFilters {
  /** null = All databases. */
  database: string | null;
  /** null = every user. */
  user: string | null;
  state: SessionState | "all";
  search: string;
}

export const STATE_LABEL: Record<SessionState, string> = {
  active: "Active",
  idle: "Idle",
  idle_in_tx: "Idle in transaction",
  waiting: "Waiting",
};

/** The duration a row shows and sorts by (AC-5): the time since its query
 *  started, or the transaction's age for an idle in transaction row. */
export function displayDuration(row: SessionRow): number | null {
  if (row.state === "idle_in_tx") return row.xact_ms ?? row.query_ms;
  if (row.state === "idle") return null;
  return row.query_ms;
}

/** An active row at or past the slow limit (AC-6). */
export function isSlow(row: SessionRow, slow_ms: number): boolean {
  return row.state === "active" && (row.query_ms ?? 0) >= slow_ms;
}

export function slowCount(rows: SessionRow[], slow_ms: number): number {
  return rows.reduce((n, r) => n + (isSlow(r, slow_ms) ? 1 : 0), 0);
}

/** Longest first; rows with no duration last, in their snapshot order. */
export function byDuration(a: SessionRow, b: SessionRow): number {
  return (displayDuration(b) ?? -1) - (displayDuration(a) ?? -1);
}

/** The rows the Sessions list shows (AC-4, AC-5). Plain idle sessions show
 *  only with Show idle on, or when the state filter asks for them; idle in
 *  transaction always shows. */
export function filterSessions(
  rows: SessionRow[],
  f: MonitorFilters,
  show_idle: boolean,
): SessionRow[] {
  const needle = f.search.trim().toLowerCase();
  return rows
    .filter((r) => {
      if (r.state === "idle" && !show_idle && f.state !== "idle") return false;
      if (f.state !== "all" && r.state !== f.state) return false;
      if (f.database !== null && r.database !== f.database) return false;
      if (f.user !== null && r.user !== f.user) return false;
      if (!needle) return true;
      return [r.query, r.app_name, r.client].some((v) =>
        v?.toLowerCase().includes(needle),
      );
    })
    .sort(byDuration);
}

/** Distinct non empty values of one field, sorted, for a filter's choices. */
export function distinctValues(
  rows: SessionRow[],
  pick: (r: SessionRow) => string | null,
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = pick(r);
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** "850ms", "4.2s", "2m 5s", "1h 3m". */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.floor(s - m * 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}

/** The first non blank line of a query, for the list and the confirm. A
 *  Mongo command is laid out over many lines and its first is only `{`, so
 *  a document is folded onto one line instead (its newlines are all layout). */
export function firstLine(query: string | null): string {
  if (!query) return "";
  const lines = query
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines[0]?.startsWith("{")) return lines.join(" ");
  return lines[0] ?? "";
}

/** One kill a row can offer, and why it is off when it is. */
export interface RowAction {
  action: KillAction;
  label: string;
  enabled: boolean;
  /** Tooltip for a disabled action. */
  reason?: string;
}

export const ACTION_LABEL: Record<KillAction, string> = {
  cancel: "Cancel query",
  terminate: "Terminate session",
  kill_op: "Kill operation",
};

const PG_RIGHTS =
  "Needs superuser, pg_signal_backend, or the session's own role (never a superuser's session)";

/** The kills a row offers (AC-12, AC-14, AC-15). Postgres: Cancel query on
 *  active and waiting rows, Terminate session on any row. Mongo: Kill
 *  operation on a running operation. `locked`: a team server started with
 *  `DH_READ_ONLY=1`. */
export function rowActions(
  row: SessionRow,
  engine: MonitorEngine,
  locked: boolean,
): RowAction[] {
  const running = row.state === "active" || row.state === "waiting";
  const off = (allowed: boolean, rights: string) =>
    locked
      ? { enabled: false, reason: "This server is read only" }
      : allowed
        ? { enabled: true }
        : { enabled: false, reason: rights };
  if (engine === "mongodb") {
    if (!running || row.id.startsWith("lsid:")) return [];
    return [
      {
        action: "kill_op",
        label: ACTION_LABEL.kill_op,
        ...off(
          row.can_cancel,
          "Needs the killop action, or an operation of your own",
        ),
      },
    ];
  }
  const hidden_rights = row.backend_start
    ? PG_RIGHTS
    : "Needs pg_read_all_stats to see this session's start time";
  const actions: RowAction[] = [];
  if (running)
    actions.push({
      action: "cancel",
      label: ACTION_LABEL.cancel,
      ...off(row.can_cancel, hidden_rights),
    });
  actions.push({
    action: "terminate",
    label: ACTION_LABEL.terminate,
    ...off(row.can_terminate, hidden_rights),
  });
  return actions;
}
