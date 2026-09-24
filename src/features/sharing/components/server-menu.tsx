import { useEffect, useState } from "react";
import {
  Ban,
  Building2,
  Cloud,
  KeyRound,
  LogOut,
  Mail,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
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
  serversList,
  serversMyInvites,
  serversRemove,
  friendlyConnectError,
  isNoOrgAccess,
  type PendingInvite,
  type ServerProfileView,
} from "@/shared/api/client";
import { serversSignOut } from "@/shared/api/server-sessions";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import {
  ConnectServerForm,
  type ConnectResult,
} from "@/shared/components/connect-server-dialog";
import { SignInAgainDialog } from "./sign-in-again-dialog";
import {
  InvitationsDialog,
  NewOrgDialog,
  type SignedInServer,
} from "./server-menu-orgs";

/** The server as the person knows it: its address, or the profile's name when
 *  the address is the page's own origin (web). */
function serverLabel(p: ServerProfileView): string {
  if (!p.url) return p.name;
  try {
    return new URL(p.url).host;
  } catch {
    return p.url;
  }
}

/** One entry per server address: every profile on a server shares one device
 *  session, so Sign out belongs to the server, not the profile. */
function distinctServers(profiles: ServerProfileView[]): ServerProfileView[] {
  return [...new Map(profiles.map((p) => [p.url, p])).values()];
}

export function ServerMenu() {
  const [profiles, setProfiles] = useState<ServerProfileView[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [signInFor, setSignInFor] = useState<ServerProfileView | null>(null);
  const [invitesOpen, setInvitesOpen] = useState(false);
  const [newOrgFor, setNewOrgFor] = useState<SignedInServer | null>(null);
  const [invites, setInvites] = useState<Record<string, PendingInvite[]>>({});
  // Profiles whose org refused them (removed, or left): shown as such until a
  // later connect works, since being invited again brings access back.
  const [no_access, setNoAccess] = useState<Set<string>>(new Set());
  const serverSessions = useStudioStore((s) => s.serverSessions);
  const connectServer = useStudioStore((s) => s.connectServer);
  const refreshServers = useStudioStore((s) => s.refreshServers);
  const disconnectServer = useStudioStore((s) => s.disconnectServer);
  const serverBusy = useStudioStore((s) => s.serverBusy);
  const pushNotification = useStudioStore((s) => s.pushNotification);

  async function refresh() {
    try {
      setProfiles(await serversList());
    } catch {
      // Web build or keychain unavailable — menu still renders.
      setProfiles([]);
    }
  }

  // One entry per signed in server: every profile on an address shares one
  // session, so any one of them can ask for that server's invitations.
  const signed_in_servers: SignedInServer[] = distinctServers(
    profiles.filter((p) => p.signed_in),
  ).map((p) => ({ profileId: p.id, url: p.url, label: serverLabel(p) }));
  // A server where the person may create an organization right now, from the
  // `me` the session already holds (the server checks again on create).
  const creatable = signed_in_servers.filter((s) => {
    const sess = Object.values(serverSessions).find(
      (x) => x.profile.url === s.url,
    );
    return sess?.me.can_create_org === true;
  });
  const pending_count = signed_in_servers.reduce(
    (n, s) => n + (invites[s.url]?.length ?? 0),
    0,
  );

  async function refreshInvites(servers: SignedInServer[]) {
    const next: Record<string, PendingInvite[]> = {};
    await Promise.all(
      servers.map(async (s) => {
        try {
          next[s.url] = await serversMyInvites(s.profileId);
        } catch {
          // Offline or signed out: no count for this server.
          next[s.url] = [];
        }
      }),
    );
    setInvites(next);
  }

  // Reload the counts when the set of signed in servers changes.
  const server_key = signed_in_servers.map((s) => s.url).join("|");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on change
    void refreshInvites(signed_in_servers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on server_key
  }, [server_key]);

  useEffect(() => {
    // Async fetch — setState only fires after the IPC round trip resolves.
    // Runs again when a session connects or ends, so a sign out done from the
    // admin panel's My devices shows here too.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [serverSessions]);

  // Desktop: a renewal was refused, so a server's session ended without the
  // person asking. Its profiles, org and open tabs stay; the menu now offers
  // Sign in again. (The web page shows its own sign in dialog instead.)
  useEffect(() => {
    if (WEB) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("server-signed-out", (event) => {
        void refresh();
        pushNotification({
          kind: "info",
          title: "Signed out of a team server",
          detail: `${event.payload} ended your session. Choose Sign in again from the Team servers menu.`,
        });
      }).then((off) => {
        if (disposed) off();
        else unlisten = off;
      }),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once
  }, []);

  /** Show every profile on `server` as disconnected after its session ended
   *  (Sign out, or Sign out everywhere): they share one session. */
  async function afterSignedOut(server: ServerProfileView) {
    for (const p of profiles.filter((x) => x.url === server.url)) {
      if (serverSessions[p.id]) await disconnectServer(p.id);
    }
    void refresh();
  }

  async function signOut(server: ServerProfileView) {
    try {
      const told = await serversSignOut(server.id);
      if (!told) {
        pushNotification({
          kind: "info",
          title: "Signed out on this device",
          detail: `Couldn't reach ${serverLabel(server)}, so this device may still be listed under My devices there.`,
        });
      }
      await afterSignedOut(server);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't sign out",
        detail: String(e),
      });
    }
  }

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
            {profiles.length === 0 && !WEB && (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">
                No saved servers yet.
              </div>
            )}
            {/* Web: the page talks to the one server that served it, so show
                which one, with nothing to connect, remove or add. */}
            {WEB &&
              distinctServers(profiles).map((p) => (
                <div
                  key={p.url}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm"
                >
                  <Cloud className="text-muted-foreground size-3.5" />
                  <span className="flex-1 truncate">{serverLabel(p)}</span>
                  <span
                    className={
                      p.signed_in
                        ? "text-3xs font-medium text-emerald-600"
                        : "text-muted-foreground text-3xs"
                    }
                  >
                    {p.signed_in ? "connected" : "signed out"}
                  </span>
                </div>
              ))}
            {(WEB ? [] : profiles).map((p) => {
              const session = serverSessions[p.id];
              return (
                <DropdownMenuItem
                  key={p.id}
                  className="items-center gap-2"
                  onClick={async () => {
                    // Signed out: nothing to connect to until they sign in.
                    if (!p.signed_in) {
                      setSignInFor(p);
                      return;
                    }
                    try {
                      if (session) await disconnectServer(p.id);
                      else await connectServer(p.id);
                      setNoAccess((set) => {
                        const next = new Set(set);
                        next.delete(p.id);
                        return next;
                      });
                    } catch (e) {
                      if (isNoOrgAccess(e)) {
                        setNoAccess((set) => new Set(set).add(p.id));
                      }
                      pushNotification({
                        kind: "error",
                        title: "Server connection failed",
                        detail: friendlyConnectError(p.name, e),
                      });
                    }
                    void refresh();
                  }}
                >
                  {no_access.has(p.id) ? (
                    <Ban className="text-muted-foreground size-3.5" />
                  ) : !p.signed_in ? (
                    <KeyRound className="text-muted-foreground size-3.5" />
                  ) : session ? (
                    <LogOut className="text-muted-foreground size-3.5" />
                  ) : (
                    <Plug className="text-muted-foreground size-3.5" />
                  )}
                  <span className="flex-1 truncate">{p.name}</span>
                  <span
                    className={
                      no_access.has(p.id) || !p.signed_in
                        ? "text-3xs font-medium text-amber-600"
                        : session
                          ? "text-3xs font-medium text-emerald-600"
                          : "text-muted-foreground text-3xs"
                    }
                  >
                    {serverBusy
                      ? "…"
                      : no_access.has(p.id)
                        ? "no longer has access"
                        : !p.signed_in
                          ? "sign in again"
                          : session
                            ? "connected"
                            : "connect"}
                  </span>
                  <button
                    aria-label={`Remove ${p.name}`}
                    className="opacity-50 hover:opacity-100"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        if (session) await disconnectServer(p.id);
                        await serversRemove(p.id);
                      } catch (err) {
                        pushNotification({
                          kind: "error",
                          title: "Couldn't remove server",
                          detail: String(err),
                        });
                      }
                      void refresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          {distinctServers(profiles)
            .filter((p) => p.signed_in)
            .map((p) => (
              <DropdownMenuItem key={p.url} onClick={() => void signOut(p)}>
                <LogOut className="size-3.5" /> Sign out · {serverLabel(p)}
              </DropdownMenuItem>
            ))}
          {signed_in_servers.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setInvitesOpen(true)}>
                <Mail className="size-3.5" /> Invitations
                {pending_count > 0 && (
                  <span
                    aria-label={`${pending_count} pending`}
                    className="bg-primary text-primary-foreground text-3xs ml-auto rounded-full px-1.5 py-0.5 font-medium"
                  >
                    {pending_count}
                  </span>
                )}
              </DropdownMenuItem>
              {creatable.length > 0 && (
                <DropdownMenuItem onClick={() => setNewOrgFor(creatable[0])}>
                  <Building2 className="size-3.5" /> New organization…
                </DropdownMenuItem>
              )}
            </>
          )}
          {!WEB && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <Plus className="size-3.5" /> Add server…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SignInAgainDialog
        profile={signInFor}
        onOpenChange={(v) => !v && setSignInFor(null)}
        onSignedIn={async (p) => {
          // Reconnect in place: open tabs and unsaved work are left alone.
          if (serverSessions[p.id]) await refreshServers();
          else await connectServer(p.id);
          void refresh();
        }}
      />

      <InvitationsDialog
        open={invitesOpen}
        onOpenChange={setInvitesOpen}
        servers={signed_in_servers}
        invites={invites}
        onChanged={() => void refreshInvites(signed_in_servers)}
      />

      <NewOrgDialog
        open={newOrgFor !== null}
        onOpenChange={(v) => !v && setNewOrgFor(null)}
        server={newOrgFor}
      />

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
  const connectServer = useStudioStore((s) => s.connectServer);

  async function handle_connect(result: ConnectResult) {
    setError(null);
    try {
      await connectServer(result.profileId);
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
