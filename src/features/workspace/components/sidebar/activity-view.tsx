import { ActivityFeed } from "@/features/activity";
import type { ActivityEntry } from "@/shared/api";

/** Activity-mode sidebar content: the live backend-command feed. */
export function ActivityView({
  conn_id,
  on_close,
  on_select,
}: {
  conn_id: string;
  on_close?: () => void;
  on_select?: (entry: ActivityEntry) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <ActivityFeed
        conn_id={conn_id || undefined}
        on_close={on_close ?? (() => {})}
        on_select={on_select}
      />
    </div>
  );
}
