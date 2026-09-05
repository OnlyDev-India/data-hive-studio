import { ActivityFeed } from "@/features/activity";
import type { ActivityEntry } from "@/shared/api";

/** Activity-mode sidebar content: the live backend-command feed. */
export function ActivityView({
  conn_id,
  conn_key,
  on_select,
}: {
  conn_id: string;
  /** This connection's stable identity — see `stableConnKey` in
   *  workspace-persistence.ts. */
  conn_key?: string;
  on_select?: (entry: ActivityEntry) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <ActivityFeed
        conn_id={conn_id || undefined}
        conn_key={conn_key}
        on_select={on_select}
      />
    </div>
  );
}
