import { useState } from "react";
import { Database, Unplug } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ConnectionInfo } from "@/shared/api";
import { closeConnection } from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import { Button } from "@/shared/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button as DialogButton } from "@/shared/components/ui/button";
import PanelRightIcon from "@/shared/components/icons/panel-right";
import PanelLeftIcon from "@/shared/components/icons/panel-left";

interface ConnectionTabsProps {
  conns: ConnectionInfo[];
  active_id: string | null;
  on_switch: (id: string) => void;
}

export function ConnectionTabs({
  conns,
  active_id,
  on_switch,
}: ConnectionTabsProps) {
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar);
  const rightSidebarOpen = useStudioStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useStudioStore((s) => s.toggleRightSidebar);
  const closeConn = useStudioStore((s) => s.closeConn);

  const [disconnect_conn_id, set_disconnect_conn_id] = useState<string | null>(null);

  async function handle_disconnect() {
    if (!disconnect_conn_id) return;
    try {
      await closeConnection(disconnect_conn_id);
    } finally {
      closeConn(disconnect_conn_id);
      set_disconnect_conn_id(null);
    }
  }

  return (
    <>
      <Dialog open={disconnect_conn_id !== null} onOpenChange={(open) => !open && set_disconnect_conn_id(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect? Any unsaved changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogButton variant="outline" onClick={() => set_disconnect_conn_id(null)}>
              Cancel
            </DialogButton>
            <DialogButton variant="destructive" onClick={handle_disconnect}>
              Disconnect
            </DialogButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="bg-background flex items-end gap-1 overflow-x-auto border-b px-2 pt-1.5">
        {conns.map((conn) => {
          const active = conn.id === active_id;
          return (
            <div key={conn.id} className="relative flex items-center">
              <Button
                variant="ghost"
                onClick={() => on_switch(conn.id)}
                className={cn(
                  "max-w-48 shrink-0 rounded-b-none border border-b-0 px-3 py-1.5 font-normal",
                  active
                    ? "border-border bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                )}
              >
                <Database className="size-3.5 shrink-0" />
                <span className="truncate">{conn.name}</span>
              </Button>
              <Button
                variant="ghost"
                size="iconXs"
                className=""
                onClick={() => set_disconnect_conn_id(conn.id)}
                aria-label={`Disconnect from ${conn.name}`}
                title="Disconnect"
              >
                <Unplug className="size-3.5" />
              </Button>
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 self-center pb-1">
          <Button
            variant={"ghost"}
            size={"iconSm"}
            aria-label="Toggle the left sidebar"
            title={
              sidebarOpen ? "Hide the left sidebar" : "Show the left sidebar"
            }
            onClick={toggleSidebar}
          >
            <PanelLeftIcon className="size-4" isOpen={sidebarOpen} />
          </Button>
          <Button
            variant={"ghost"}
            size={"iconSm"}
            aria-label="Toggle the JSON viewer"
            title={
              rightSidebarOpen ? "Hide the JSON viewer" : "Show the JSON viewer"
            }
            onClick={toggleRightSidebar}
          >
            <PanelRightIcon className="size-4" isOpen={rightSidebarOpen} />
          </Button>
        </div>
      </div>
    </>
  );
}
