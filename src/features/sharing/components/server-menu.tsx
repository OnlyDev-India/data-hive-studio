import { useEffect, useState } from "react";
import { Cloud, LogOut, Plug, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  serversAdd,
  serversList,
  serversRemove,
  type ServerProfileView,
} from "@/shared/api/client";
import { useStudioStore } from "@/shared/store";
import {
  ConnectServerForm,
  type ConnectResult,
} from "@/shared/components/connect-server-dialog";

export function ServerMenu() {
  const [profiles, setProfiles] = useState<ServerProfileView[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const serverSessions = useStudioStore((s) => s.serverSessions);
  const connectServer = useStudioStore((s) => s.connectServer);
  const disconnectServer = useStudioStore((s) => s.disconnectServer);
  const serverBusy = useStudioStore((s) => s.serverBusy);

  async function refresh() {
    try {
      setProfiles(await serversList());
    } catch {
      // Web build or keychain unavailable — menu still renders.
      setProfiles([]);
    }
  }

  useEffect(() => {
    // Async fetch — setState only fires after the IPC round trip resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" aria-label="Team servers">
                    <Cloud className="size-5" />
                  </Button>
                }
              />
            }
          />
          <TooltipContent side="right">Team servers</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Team servers</DropdownMenuLabel>
            {profiles.length === 0 && (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">
                No saved servers yet.
              </div>
            )}
            {profiles.map((p) => {
              const session = serverSessions[p.id];
              return (
                <DropdownMenuItem
                  key={p.id}
                  className="items-center gap-2"
                  onClick={async () => {
                    if (session) await disconnectServer(p.id);
                    else await connectServer(p.id);
                    void refresh();
                  }}
                >
                  {session ? (
                    <LogOut className="text-muted-foreground size-3.5" />
                  ) : (
                    <Plug className="text-muted-foreground size-3.5" />
                  )}
                  <span className="flex-1 truncate">{p.name}</span>
                  <span
                    className={
                      session
                        ? "text-[10px] font-medium text-emerald-600"
                        : "text-muted-foreground text-[10px]"
                    }
                  >
                    {serverBusy ? "…" : session ? "connected" : "connect"}
                  </span>
                  <button
                    aria-label={`Remove ${p.name}`}
                    className="opacity-50 hover:opacity-100"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (session) await disconnectServer(p.id);
                      await serversRemove(p.id);
                      void refresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Add server…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={refresh}
      />
    </>
  );
}

function AddServerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function handle_connect(result: ConnectResult) {
    setError(null);
    try {
      await serversAdd(
        result.server_name || "team-server",
        result.server_url || "",
        result.token,
        result.team_name,
      );
      onOpenChange(false);
      onAdded();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add team server</DialogTitle>
        </DialogHeader>
        <ConnectServerForm
          on_connect={(r) => void handle_connect(r)}
          show_server_fields
          error={error}
        />
      </DialogContent>
    </Dialog>
  );
}
