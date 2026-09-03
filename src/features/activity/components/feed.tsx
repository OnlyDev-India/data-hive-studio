import { useMemo, useState } from "react";
import { History, Trash2, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useStudioStore } from "@/shared/store";
import { clearActivity, type ActivityEntry } from "@/shared/api";
import { cn } from "@/shared/lib/utils";

/** Per-kind badge colors + labels for the feed. */
const KINDS: Record<string, { label: string; cls: string }> = {
  select: {
    label: "SELECT",
    cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  count: { label: "COUNT", cls: "bg-muted text-muted-foreground" },
  distinct: {
    label: "DISTINCT",
    cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  insert: {
    label: "INSERT",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  update: {
    label: "UPDATE",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  delete: {
    label: "DELETE",
    cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  drop_table: {
    label: "DROP",
    cls: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  sql: { label: "SQL", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  ddl: {
    label: "DDL",
    cls: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  },
  duplicate: {
    label: "CLONE",
    cls: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  },
  schema: {
    label: "SCHEMA",
    cls: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  },
  connect: {
    label: "CONNECT",
    cls: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  disconnect: { label: "CLOSE", cls: "bg-muted text-muted-foreground" },
};

function kindStyle(kind: string) {
  return (
    KINDS[kind] ?? {
      label: kind.toUpperCase(),
      cls: "bg-muted text-muted-foreground",
    }
  );
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
        "rounded-md border px-2 py-1.5",
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
        <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
          {fmtTime(entry.ts_ms)}
        </span>
        <span
          className={cn(
            "shrink-0 rounded px-1 py-px text-[10px] font-semibold",
            style.cls,
          )}
        >
          {style.label}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={entry.target}
        >
          {entry.target || "—"}
        </span>
        <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
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
          className="text-destructive mt-1 line-clamp-3 pl-18 text-xs"
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
  on_close,
  on_select,
}: {
  /** Restrict the feed to this connection's commands. */
  conn_id?: string;
  /** X button: collapse the left panel slot. */
  on_close: () => void;
  /** Clicking an entry: opens/updates the singleton Activity tab. */
  on_select?: (entry: ActivityEntry) => void;
}) {
  const full = useStudioStore((s) => s.activity);
  const detail = useStudioStore((s) => s.activityDetail);
  const clearEntries = useStudioStore((s) => s.clearActivityEntries);
  const [filter, setFilter] = useState("");

  const activity = useMemo(
    () => (conn_id ? full.filter((e) => e.conn_id === conn_id) : full),
    [full, conn_id],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return activity;
    return activity.filter(
      (e) =>
        e.kind.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q) ||
        (e.error?.toLowerCase().includes(q) ?? false),
    );
  }, [activity, filter]);

  const selected_id =
    detail && (!conn_id || detail.conn_id === conn_id) ? detail.entry.id : null;

  const on_clear = () => {
    void clearActivity().finally(clearEntries);
  };

  return (
    <>
      {/* Header row — mirrors the tables-mode toolbar rhythm. */}
      <div className="flex shrink-0 items-center gap-2">
        <History className="text-muted-foreground size-4 shrink-0" />
        <h2 className="text-sm font-semibold">Activity</h2>
        {activity.length > 0 && (
          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[10px] tabular-nums">
            {activity.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Clear activity"
            onClick={on_clear}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Close panel"
            onClick={on_close}
          >
            <X />
          </Button>
        </div>
      </div>
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by table, kind or error…"
        className="h-7 shrink-0 text-xs"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground px-1 py-6 text-center text-xs">
            {activity.length === 0
              ? "No commands yet — everything the backend runs shows up here."
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
