import { useMemo, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
import { useStudioStore } from "@/shared/store";
import { clearActivity, type ActivityEntry } from "@/shared/api";
import { cn } from "@/shared/lib/utils";

type Tone =
  "neutral" | "success" | "warning" | "destructive" | "info" | "primary";

/** Badge color says how risky the action was, the label says what it was. */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-light text-success-dark",
  warning: "bg-warning-light text-warning-dark",
  destructive: "bg-destructive-light text-destructive-dark",
  info: "bg-info-light text-info-dark",
  primary: "bg-primary-light text-primary-dark",
};

const KINDS: Record<string, { label: string; tone: Tone }> = {
  select: { label: "SELECT", tone: "neutral" },
  count: { label: "COUNT", tone: "neutral" },
  distinct: { label: "DISTINCT", tone: "neutral" },
  explain: { label: "EXPLAIN", tone: "neutral" },
  connect: { label: "CONNECT", tone: "neutral" },
  disconnect: { label: "CLOSE", tone: "neutral" },
  insert: { label: "INSERT", tone: "success" },
  duplicate: { label: "CLONE", tone: "success" },
  update: { label: "UPDATE", tone: "warning" },
  delete: { label: "DELETE", tone: "destructive" },
  drop_table: { label: "DROP", tone: "destructive" },
  ddl: { label: "DDL", tone: "info" },
  schema: { label: "SCHEMA", tone: "info" },
  sql: { label: "SQL", tone: "primary" },
};

function kindStyle(kind: string) {
  const { label, tone } = KINDS[kind] ?? {
    label: kind.toUpperCase(),
    tone: "neutral",
  };
  return { label, cls: TONE_CLASS[tone] };
}

function fmtTime(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(v: number) {
  if (v < 1) return "<1 ms";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

function EntryRow({
  entry,
  selected,
  onClick,
}: {
  entry: ActivityEntry;
  selected: boolean;
  onClick?: () => void;
}) {
  const style = kindStyle(entry.kind);
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "rounded-control border px-2 py-1.5",
        selected
          ? "border-primary/50 bg-primary/5"
          : entry.ok
            ? "bg-background"
            : "border-destructive/40 bg-destructive/5",
        onClick &&
          "hover:bg-muted/60 focus:bg-muted/60 cursor-pointer transition-colors focus:outline-none",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-caption shrink-0 font-mono">
          {fmtTime(entry.ts_ms)}
        </span>
        <span
          className={cn(
            "text-caption shrink-0 rounded px-1 py-px font-mono font-semibold",
            style.cls,
          )}
        >
          {style.label}
        </span>
        <span
          className="text-small min-w-0 flex-1 truncate font-mono"
          title={entry.target}
        >
          {entry.target || "—"}
        </span>
        <span className="text-muted-foreground text-caption shrink-0 tabular-nums">
          {entry.rows > 0 && (
            <>
              {entry.rows} row{entry.rows === 1 ? "" : "s"} ·{" "}
            </>
          )}
          {fmtDuration(entry.duration_ms)}
        </span>
      </div>
      {entry.error && (
        <p
          className="text-destructive text-small mt-1 line-clamp-3 pl-18"
          title={entry.error}
        >
          {entry.error}
        </p>
      )}
    </div>
  );
}

/** The backend-command log as SIDEBAR CONTENT — rendered inside the one
 *  persistent sidebar when its mode is "activity". Same frame, different
 *  content: nothing here owns width or open/close animation.
 *  Without `conn_id` (no connection open) the whole feed is shown — that's
 *  where failed connect attempts surface. */
export function ActivityFeed({
  conn_id,
  conn_key,
  on_select,
}: {
  /** Restrict the feed to this connection's commands. Matched against each
   *  entry's OWN `conn_key` when it has one (stable across reconnects); an
   *  entry lacking `conn_key` (logged before that field existed) falls back
   *  to matching this session's raw `conn_id` instead. */
  conn_id?: string;
  /** This connection's stable identity — see `stableConnKey` in
   *  workspace-persistence.ts. Also what scopes the clear-history button. */
  conn_key?: string;
  /** Clicking an entry: opens/updates the singleton Activity tab. */
  on_select?: (entry: ActivityEntry) => void;
}) {
  const full = useStudioStore((s) => s.activity);
  const detail = useStudioStore((s) => s.activityDetail);
  const clearEntriesFor = useStudioStore((s) => s.clearActivityEntriesFor);
  const show_app_activity = useStudioStore((s) => s.showAppActivity);
  const setShowAppActivity = useStudioStore((s) => s.setShowAppActivity);
  const [filter, setFilter] = useState("");

  const activity = useMemo(() => {
    if (!conn_id && !conn_key) return full;
    return full.filter((e) =>
      e.conn_key ? e.conn_key === conn_key : e.conn_id === conn_id,
    );
  }, [full, conn_id, conn_key]);

  // "app" = the app's own background work (schema prefetching for
  // autocomplete, cache warming) rather than something the user asked for.
  // Off by default — most people only care about what THEY ran. Entries
  // logged before this field existed have no `origin` at all; treat those
  // as "user" (the whole log used to be user-only) so old history doesn't
  // just vanish.
  const app_count = useMemo(
    () => activity.filter((e) => e.origin === "app").length,
    [activity],
  );
  const visible = useMemo(
    () =>
      show_app_activity ? activity : activity.filter((e) => e.origin !== "app"),
    [activity, show_app_activity],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (e) =>
        e.kind.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q) ||
        (e.error?.toLowerCase().includes(q) ?? false),
    );
  }, [visible, filter]);

  const selected_id =
    detail && (!conn_id || detail.conn_id === conn_id) ? detail.entry.id : null;

  const on_clear = () => {
    void clearActivity(conn_key, conn_id).finally(() =>
      clearEntriesFor(conn_key, conn_id),
    );
  };

  return (
    <>
      {/* Header row — mirrors the tables-mode toolbar rhythm. */}
      <div className="flex shrink-0 items-center gap-2">
        <History className="text-muted-foreground size-4 shrink-0" />
        <h2 className="text-body font-semibold">Activity</h2>
        {visible.length > 0 && (
          <span className="bg-muted text-muted-foreground text-caption rounded-full px-1.5 py-px tabular-nums">
            {visible.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={
              conn_id || conn_key
                ? "Clear this connection's activity"
                : "Clear activity"
            }
            title={
              conn_id || conn_key
                ? "Clear this connection's activity"
                : "Clear activity"
            }
            onClick={on_clear}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by table, kind or error…"
        className="text-small shrink-0"
      />
      <div className="flex shrink-0 items-center gap-1.5 px-0.5">
        <Switch
          id="show-app-activity"
          checked={show_app_activity}
          onCheckedChange={setShowAppActivity}
          className="h-4 w-8 [&>span]:size-3"
        />
        <Label
          htmlFor="show-app-activity"
          className="text-muted-foreground text-caption font-normal"
        >
          Show app queries{app_count > 0 ? ` (${app_count})` : ""}
        </Label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-small px-1 py-6 text-center">
            {activity.length === 0
              ? "No commands yet — everything the backend runs shows up here."
              : visible.length === 0
                ? "Nothing but app-run queries here — toggle above to see them."
                : "Nothing matches this filter."}
          </p>
        ) : (
          filtered.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              selected={e.id === selected_id}
              onClick={on_select ? () => on_select(e) : undefined}
            />
          ))
        )}
      </div>
    </>
  );
}
