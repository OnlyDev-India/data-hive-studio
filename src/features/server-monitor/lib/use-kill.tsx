import { useCallback, useState, type ReactNode } from "react";
import {
  isProductionEnv,
  monitorKill,
  type KillAction,
  type SessionRow,
} from "@/shared/api";
import { useWriteConfirm } from "@/shared/hooks/use-write-confirm";
import { useStudioStore } from "@/shared/store";
import {
  ACTION_LABEL,
  displayDuration,
  firstLine,
  formatDuration,
} from "./sessions";

const DESCRIPTION: Record<KillAction, string> = {
  cancel: "This stops the query this session is running. The session stays open.",
  terminate:
    "This ends the whole session. Its open transaction is rolled back and the client is disconnected.",
  kill_op: "This stops the operation on the server.",
};

const CONFIRM_LABEL: Record<KillAction, string> = {
  cancel: "Cancel query",
  terminate: "Terminate session",
  kill_op: "Kill operation",
};

/** Ask, then kill (AC-12, AC-13, AC-15). Every kill asks first, with the
 *  query's first line, user, database and duration; Terminate on a
 *  Production connection also asks for the connection's name. The answer
 *  becomes a toast. `kill` resolves true once a kill was sent, so the caller
 *  can refresh at once. */
export function useKill(conn_id: string): {
  kill: (row: SessionRow, action: KillAction) => Promise<boolean>;
  /** True while the confirm is open (the list stays frozen). */
  confirming: boolean;
  dialog: ReactNode;
} {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const push = useStudioStore((s) => s.pushNotification);
  const { ask, dialog } = useWriteConfirm(conn_id);
  const [confirming, setConfirming] = useState(false);

  const kill = useCallback(
    async (row: SessionRow, action: KillAction) => {
      const reasons = [
        `User ${row.user ?? "unknown"} · database ${row.database ?? "unknown"} · ${formatDuration(displayDuration(row))}`,
      ];
      if (row.is_this_app) reasons.push("This may be one of your own editor runs");
      const production = !!conn && isProductionEnv(conn);
      if (production) reasons.push("This is a Production connection.");
      setConfirming(true);
      const ok = await ask({
        items: [
          {
            text:
              firstLine(row.query) ||
              (row.query_hidden ? "Query hidden by the server" : "No query text"),
            reasons,
          },
        ],
        title: `${ACTION_LABEL[action]} ${row.id}?`,
        description: DESCRIPTION[action],
        confirm_label: CONFIRM_LABEL[action],
        type_to_confirm:
          production && action === "terminate" ? conn?.name : undefined,
      });
      setConfirming(false);
      if (!ok) return false;
      try {
        const out = await monitorKill(conn_id, {
          action,
          id: row.id,
          backend_start: row.backend_start,
          run_id: row.run_id,
        });
        switch (out.result) {
          case "done":
            push({ kind: "success", title: `${ACTION_LABEL[action]}: done` });
            break;
          case "stopped_run":
            push({ kind: "success", title: "Stopped your editor run" });
            break;
          case "gone":
            push({ kind: "info", title: "That session already ended" });
            break;
          case "refused":
            push({
              kind: "error",
              title: "The server refused",
              detail: out.message ?? undefined,
            });
            break;
        }
      } catch (e) {
        push({
          kind: "error",
          title: `${ACTION_LABEL[action]} failed`,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      return true;
    },
    [ask, conn, conn_id, push],
  );

  return { kill, confirming, dialog };
}
