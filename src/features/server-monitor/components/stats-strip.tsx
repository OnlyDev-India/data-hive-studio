import type { MonitorCounts } from "@/shared/api";
import { cn } from "@/shared/lib/utils";

/** One count in the strip. `tone` colors a count that needs a look. */
function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning" | "destructive" | "info";
}) {
  const hot = value > 0 && tone;
  return (
    <div
      className={cn(
        "rounded-control flex min-w-20 flex-col gap-0.5 border px-3 py-1.5",
        hot === "warning" && "border-warning/40 bg-warning/10",
        hot === "destructive" && "border-destructive/40 bg-destructive/10",
        hot === "info" && "border-info/40 bg-info/10",
      )}
    >
      <span className="text-muted-foreground text-caption font-medium">
        {label}
      </span>
      <span
        className={cn(
          "text-heading font-semibold tabular-nums",
          hot === "warning" && "text-warning-dark",
          hot === "destructive" && "text-destructive",
          hot === "info" && "text-info-dark",
        )}
      >
        {value.toLocaleString("en-US")}
      </span>
    </div>
  );
}

/** The counts over the whole server, from the same snapshot as the list
 *  (AC-3). Slow is counted in the browser with the saved slow limit. */
export function StatsStrip({
  counts,
  slow,
}: {
  counts: MonitorCounts;
  slow: number;
}) {
  return (
    <div
      role="group"
      aria-label="Server counts"
      className="flex flex-wrap items-stretch gap-2"
    >
      <Stat label="Total" value={counts.total} />
      <Stat label="Active" value={counts.active} />
      <Stat label="Idle" value={counts.idle} />
      <Stat label="Idle in transaction" value={counts.idle_in_tx} tone="info" />
      <Stat label="Waiting" value={counts.waiting} tone="warning" />
      <Stat label="Blocked" value={counts.blocked} tone="destructive" />
      <Stat label="Slow" value={slow} tone="warning" />
    </div>
  );
}
