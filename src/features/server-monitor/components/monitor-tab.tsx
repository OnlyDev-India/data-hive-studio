import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Info,
  Lock,
  Pause,
  Play,
  RefreshCw,
  Unplug,
} from "lucide-react";
import {
  canMonitor,
  monitorKillLocked,
  type SessionRow,
} from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  DEFAULT_MONITOR_SETTINGS,
  MONITOR_REFRESH_CHOICES,
  useStudioStore,
  type MonitorRefreshMs,
} from "@/shared/store";
import { cn } from "@/shared/lib/utils";
import {
  distinctValues,
  filterSessions,
  MAX_MONITOR_ROWS,
  slowCount,
  type MonitorFilters,
  type RowAction,
} from "../lib/sessions";
import { useMonitorPoll } from "../lib/use-monitor-poll";
import { useKill } from "../lib/use-kill";
import { openSqlAndRun } from "../lib/open-and-run";
import { useDocumentVisible, useNow } from "../lib/use-visibility";
import { StatsStrip } from "./stats-strip";
import { MonitorFiltersBar } from "./monitor-filters";
import { SessionsTable } from "./sessions-table";
import { LocksView } from "./locks-view";
import { SessionDetail } from "./session-detail";

function rateLabel(ms: MonitorRefreshMs): string {
  return ms === 0 ? "Paused" : `Every ${ms / 1000} s`;
}

/** A plain one line notice above the list. */
function Notice({
  tone,
  icon: Icon,
  children,
  action,
}: {
  tone: "info" | "warning" | "destructive";
  icon: typeof Info;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn(
        "rounded-control text-small flex items-start gap-2 border px-3 py-2",
        tone === "info" && "border-info/30 bg-info/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "destructive" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          tone === "info" && "text-info-dark",
          tone === "warning" && "text-warning-dark",
          tone === "destructive" && "text-destructive",
        )}
      />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** A whole tab message: the monitor cannot show anything right now. */
function FullState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof Info;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="bg-muted rounded-pill flex size-10 items-center justify-center">
        <Icon className="text-muted-foreground size-5" />
      </span>
      <h2 className="text-heading font-semibold">{title}</h2>
      <div className="text-muted-foreground text-body max-w-md">{body}</div>
      {action}
    </div>
  );
}

/** The live server monitor tab (spec 0025): what the server is doing right
 *  now, refreshed on its own, with a way to stop a runaway query. */
export function MonitorTab({
  conn_id,
  active,
}: {
  conn_id: string;
  tab_key: string;
  /** This tab is the one in front in its pane. */
  active: boolean;
}) {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const workspace_shown = useStudioStore(
    (s) => s.activeId === conn_id && s.view === "workspace",
  );
  const settings =
    useStudioStore((s) => s.monitorSettings[conn_id]) ??
    DEFAULT_MONITOR_SETTINGS;
  const set_settings = useStudioStore((s) => s.setMonitorSettings);
  const params = useStudioStore((s) => s.recentParams[conn_id]);
  const open_sql = useStudioStore((s) => s.openSql);
  const open_console = useStudioStore((s) => s.openMongoConsole);
  const current_db = params?.database || conn?.name || null;
  const doc_visible = useDocumentVisible();
  const visible = active && workspace_shown && doc_visible;

  const [selected, setSelected] = useState<string | null>(null);
  const [menus_open, setMenusOpen] = useState(0);
  const [tab, setTab] = useState<"sessions" | "locks">("sessions");
  const [flat, setFlat] = useState(false);
  const [filters, setFilters] = useState<MonitorFilters>({
    database: current_db,
    user: null,
    state: "all",
    search: "",
  });
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let alive = true;
    void monitorKillLocked().then((l) => alive && setLocked(l));
    return () => {
      alive = false;
    };
  }, []);

  const { kill, confirming, dialog } = useKill(conn_id);
  // The list freezes while a row is selected or a row menu or confirm is
  // open (AC-9).
  const poll = useMonitorPoll(conn_id, {
    visible,
    connected: !!conn,
    frozen: selected !== null || menus_open > 0 || confirming,
    refresh_ms: settings.refresh_ms,
  });
  const now = useNow(visible && poll.receivedAt !== null);

  const snap = poll.snapshot;
  const engine = snap?.engine ?? (conn?.kind === "mongodb" ? "mongodb" : "postgres");
  const rows = useMemo(
    () => (snap ? filterSessions(snap.sessions, filters, settings.show_idle) : []),
    [snap, filters, settings.show_idle],
  );
  const databases = useMemo(() => {
    const list = snap ? distinctValues(snap.sessions, (r) => r.database) : [];
    if (filters.database && !list.includes(filters.database)) list.unshift(filters.database);
    return list;
  }, [snap, filters.database]);
  const users = useMemo(
    () => (snap ? distinctValues(snap.sessions, (r) => r.user) : []),
    [snap],
  );
  const selected_row = snap?.sessions.find((r) => r.id === selected) ?? null;
  const slow = snap ? slowCount(snap.sessions, settings.slow_ms) : 0;
  const lock_badge = snap?.counts.blocked ?? 0;

  const resume = () => {
    setSelected(null);
    setMenusOpen(0);
  };
  const on_action = async (row: SessionRow, a: RowAction) => {
    if (!a.enabled) return;
    if (await kill(row, a.action)) {
      // The session may be gone: let go of it, and refresh at once (AC-13).
      resume();
      poll.refreshNow();
    }
  };
  const on_menu_open = (open: boolean) =>
    setMenusOpen((n) => Math.max(0, n + (open ? 1 : -1)));
  const target_db = (row: SessionRow) =>
    row.database && row.database !== current_db ? row.database : undefined;
  const open_in_editor = (row: SessionRow) => {
    if (!row.query) return;
    if (engine === "mongodb")
      open_console(conn_id, row.database ?? current_db ?? "admin", row.query);
    else open_sql(conn_id, row.query, undefined, undefined, { database: target_db(row) });
  };
  const explain = (row: SessionRow) => {
    if (!row.query) return;
    openSqlAndRun(conn_id, `EXPLAIN ${row.query.trim().replace(/;\s*$/, "")}`, {
      database: target_db(row),
    });
  };

  if (!conn) {
    return (
      <FullState
        icon={Unplug}
        title="Disconnected"
        body="The monitor stopped. It starts again when the connection is back."
      />
    );
  }
  if (!canMonitor(conn.kind)) {
    return (
      <FullState
        icon={Activity}
        title="No server monitor here"
        body="The server monitor works on PostgreSQL and MongoDB connections."
      />
    );
  }
  if (poll.status === "blocked") {
    return (
      <FullState
        icon={Lock}
        title="Can't monitor this server"
        body={poll.error}
        action={
          <Button variant="outline" onClick={poll.retry}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const age = poll.receivedAt === null ? null : Math.max(0, Math.round((now - poll.receivedAt) / 1000));

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected !== null && menus_open === 0 && !confirming) {
          e.preventDefault();
          resume();
        }
      }}
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary/10 rounded-control flex size-8 shrink-0 items-center justify-center">
            <Activity className="text-primary size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-title font-semibold">Server monitor</h1>
            <p className="text-muted-foreground text-small truncate">
              {conn.name}
              {snap && <> · {snap.server_version.split(" (")[0]}</>}
              {snap?.node_note && <> · {snap.node_note}</>}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-small tabular-nums" aria-live="polite">
            {poll.status === "frozen" ? (
              <button
                type="button"
                onClick={resume}
                className="bg-accent rounded-pill text-small text-foreground inline-flex items-center gap-1 px-2 py-0.5 font-medium"
                title="Resume (Esc)"
              >
                <Pause className="size-3" />
                Paused while you look · Resume
              </button>
            ) : poll.status === "paused" ? (
              "Paused"
            ) : age === null ? (
              "Reading the server…"
            ) : poll.slowSeconds !== null ? (
              <span className="text-warning-dark">
                Refreshing every {poll.slowSeconds} s (server is slow)
              </span>
            ) : (
              `Updated ${age}s ago`
            )}
          </span>
          <Select
            value={String(settings.refresh_ms)}
            onValueChange={(v) =>
              v != null &&
              set_settings(conn_id, { refresh_ms: Number(v) as MonitorRefreshMs })
            }
          >
            <SelectTrigger size="sm" aria-label="Refresh rate" className="text-small h-7 w-32">
              <SelectValue>
                {(v: string) => rateLabel(Number(v) as MonitorRefreshMs)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONITOR_REFRESH_CHOICES.map((ms) => (
                <SelectItem key={ms} value={String(ms)}>
                  {rateLabel(ms)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="iconSm"
            className="size-7"
            aria-label="Refresh now"
            title="Refresh now"
            disabled={poll.status !== "polling" && poll.status !== "paused"}
            onClick={poll.refreshNow}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 border-b px-4 py-3">
        {snap ? (
          <StatsStrip counts={snap.counts} slow={slow} />
        ) : (
          <div className="flex gap-2" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="bg-muted rounded-control h-12 w-20 animate-pulse" />
            ))}
          </div>
        )}
        {poll.status === "failed" && (
          <Notice
            tone="destructive"
            icon={AlertTriangle}
            action={
              <Button variant="outline" size="sm" onClick={poll.retry}>
                <Play className="size-3" />
                Retry
              </Button>
            }
          >
            <p className="font-medium">Paused after 3 failed refreshes</p>
            <p className="text-muted-foreground break-words">{poll.error}</p>
          </Notice>
        )}
        {snap?.visibility.missing.includes("pg_read_all_stats") && (
          <Notice tone="info" icon={Info}>
            Other users' queries are hidden by the server. A superuser can show
            them with{" "}
            <code className="font-mono">
              GRANT pg_read_all_stats TO {params?.user || "your_role"};
            </code>
          </Notice>
        )}
        {snap?.visibility.missing.includes("inprog") && (
          <Notice tone="info" icon={Info}>
            You see only your own operations. A role with the{" "}
            <code className="font-mono">inprog</code> action shows everyone's.
          </Notice>
        )}
        {locked && (
          <Notice tone="warning" icon={Lock}>
            This server is read only, so cancelling and killing are off.
            Viewing still works.
          </Notice>
        )}
        {snap && snap.total_sessions > MAX_MONITOR_ROWS && (
          <Notice tone="warning" icon={Info}>
            Showing {MAX_MONITOR_ROWS.toLocaleString("en-US")} of{" "}
            {snap.total_sessions.toLocaleString("en-US")} sessions, longest
            running first.
          </Notice>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div role="tablist" aria-label="Monitor views" className="bg-muted rounded-control flex p-0.5">
          {(["sessions", "locks"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-inset text-small flex items-center gap-1.5 px-3 py-1 font-medium",
                tab === t ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "sessions" ? "Sessions" : "Locks"}
              {t === "locks" && lock_badge > 0 && (
                <span
                  aria-label={`${lock_badge} blocked`}
                  className="bg-destructive text-destructive-foreground rounded-pill text-caption min-w-4 px-1 tabular-nums"
                >
                  {lock_badge}
                </span>
              )}
            </button>
          ))}
        </div>
        {tab === "sessions" ? (
          <div className="min-w-0 flex-1">
            <MonitorFiltersBar
              filters={filters}
              databases={databases}
              users={users}
              show_idle={settings.show_idle}
              slow_ms={settings.slow_ms}
              on_filters={setFilters}
              on_show_idle={(show_idle) => set_settings(conn_id, { show_idle })}
              on_slow_ms={(slow_ms) => set_settings(conn_id, { slow_ms })}
            />
          </div>
        ) : (
          engine === "postgres" && (
            <label className="text-small ml-auto flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={flat}
                onChange={(e) => setFlat(e.target.checked)}
                className="accent-primary"
              />
              Flat
            </label>
          )
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!snap ? (
            <div className="flex flex-col gap-1 p-3" aria-label="Loading sessions">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="bg-muted rounded-inset h-6 animate-pulse" />
              ))}
            </div>
          ) : tab === "locks" ? (
            <LocksView
              snapshot={snap}
              flat={flat}
              engine={engine}
              selected={selected}
              locked={locked}
              on_select={setSelected}
              on_action={(row, a) => void on_action(row, a)}
              on_menu_open={on_menu_open}
            />
          ) : rows.length === 0 ? (
            <FullState
              icon={Activity}
              title={snap.sessions.length === 0 ? "No other sessions" : "No sessions match"}
              body={
                snap.sessions.length === 0
                  ? "Nothing else is connected to this server right now."
                  : settings.show_idle
                    ? "Try another database, user or state, or clear the search."
                    : "Idle sessions are hidden. Turn on Show idle, or loosen the filters."
              }
            />
          ) : (
            <SessionsTable
              rows={rows}
              engine={engine}
              slow_ms={settings.slow_ms}
              selected={selected}
              locked={locked}
              on_select={setSelected}
              on_clear={resume}
              on_action={(row, a) => void on_action(row, a)}
              on_menu_open={on_menu_open}
            />
          )}
        </div>
        {selected_row && (
          <SessionDetail
            row={selected_row}
            engine={engine}
            locked={locked}
            received_at={poll.receivedAt}
            on_close={resume}
            on_action={(row, a) => void on_action(row, a)}
            on_open_in_editor={open_in_editor}
            on_explain={explain}
          />
        )}
      </div>
      {dialog}
    </div>
  );
}
