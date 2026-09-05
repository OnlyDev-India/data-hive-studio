import { Unplug } from "lucide-react";
import { useStudioStore } from "../store";
import type { ConnectionInfo } from "../api";
import { cn } from "../lib/utils";

/** Trigger for the confirm-disconnect dialog (`DisconnectDialog`, mounted
 *  once in `Studio`) — just requests it open for `conn`. The dialog itself
 *  is shared with the command palette's disconnect commands so there's one
 *  confirmation flow, not one per trigger. */
const DisconnectDbBtn = ({ conn }: { conn: ConnectionInfo | null }) => {
  const setPendingId = useStudioStore((s) => s.setDisconnectPendingId);
  return (
    <span
      aria-disabled={!conn}
      className={cn(
        "hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded-sm p-0.5",
        !conn && "cursor-not-allowed opacity-50",
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!conn) return;
        setPendingId(conn.id);
      }}
    >
      <Unplug className="size-3.5" />
    </span>
  );
};

export default DisconnectDbBtn;
