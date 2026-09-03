import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui";
import { useStudioStore } from "../store";
import { closeConnection, type ConnectionInfo } from "../api";
import { CornerDownLeft, Unplug } from "lucide-react";
import { cn } from "../lib/utils";
import { useShortcuts } from "../hooks/use-shortcut";

const DisconnectDbBtn = ({ conn }: { conn: ConnectionInfo | null }) => {
  const [disconnect_conn_id, set_disconnect_conn_id] = useState<string | null>(
    null,
  );
  const closeConn = useStudioStore((s) => s.closeConn);

  async function handle_disconnect() {
    if (!disconnect_conn_id) return;
    try {
      await closeConnection(disconnect_conn_id);
    } finally {
      closeConn(disconnect_conn_id);
      set_disconnect_conn_id(null);
    }
  }
  // Escape already closes the dialog via Base UI's own built-in dialog
  // behavior — only Enter-to-confirm needs wiring up here.
  useShortcuts([{ key: "Enter", handler: () => void handle_disconnect() }], {
    enabled: disconnect_conn_id !== null,
  });
  return (
    <>
      <Dialog
        open={disconnect_conn_id !== null}
        onOpenChange={(open) => !open && set_disconnect_conn_id(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect? Any unsaved changes will be
              lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => set_disconnect_conn_id(null)}
            >
              Cancel
              <kbd className="bg-muted text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                ESC
              </kbd>
            </Button>
            <Button variant="secondary" onClick={handle_disconnect}>
              Disconnect
              <kbd className="bg-muted text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                <CornerDownLeft className="size-4" strokeWidth={1.75} />
              </kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span
        aria-disabled={!conn}
        className={cn(
          "hover:text-destructive hover:bg-destructive/10 cursor-pointer rounded-sm p-0.5",
          !conn && "cursor-not-allowed opacity-50",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!conn) return;
          set_disconnect_conn_id(conn.id);
        }}
      >
        <Unplug className="size-3.5" />
      </span>
    </>
  );
};

export default DisconnectDbBtn;
