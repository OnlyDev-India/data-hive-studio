import type { SessionState } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { STATE_LABEL } from "../lib/sessions";

const STATE_TONE: Record<SessionState, string> = {
  active: "bg-success/10 text-success-dark border-success/30",
  waiting: "bg-warning/10 text-warning-dark border-warning/40",
  idle_in_tx: "bg-info/10 text-info-dark border-info/30",
  idle: "bg-muted text-muted-foreground border-transparent",
};

export function StateBadge({ state }: { state: SessionState }) {
  return (
    <span
      className={cn(
        "rounded-pill text-caption truncate border px-1.5 py-px font-medium",
        STATE_TONE[state],
      )}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/** A session that belongs to this app launch (AC-11). */
export function ThisAppTag() {
  return (
    <span
      title="A session this DH Studio window opened"
      className="bg-primary/10 text-primary rounded-pill text-caption shrink-0 px-1.5 py-px font-medium"
    >
      This app
    </span>
  );
}
