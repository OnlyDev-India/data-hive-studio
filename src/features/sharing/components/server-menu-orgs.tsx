import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  serversInviteAccept,
  serversInviteDecline,
  serversOrgCreateNew,
  serversSaveProfile,
  type Organization,
  type PendingInvite,
} from "@/shared/api/client";
import { accessErrorMessage } from "@/shared/api/server-access";
import { WEB, deriveServerId, webAddServer } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import { FormError } from "@/shared/components/connect-server-dialog";

/** A server the person is signed in to: one profile stands for the server,
 *  since every profile on an address shares one session. */
export interface SignedInServer {
  /** Any profile on the server, to make calls through. */
  profileId: string;
  url: string;
  label: string;
}

/** Save a profile for `org` on `url` and connect it, so the org opens like
 *  any other. */
async function openOrg(url: string, org: Organization) {
  let profileId: string;
  if (WEB) {
    profileId = deriveServerId(url, org.id);
    webAddServer({ id: profileId, url, name: org.name, org_id: org.id });
  } else {
    profileId = (await serversSaveProfile(org.name, url, org.id)).id;
  }
  await useStudioStore.getState().connectServer(profileId);
}

/** Every invitation waiting for this person, on every server they are signed
 *  in to. Accepting one offers to open the org. */
export function InvitationsDialog({
  open,
  onOpenChange,
  servers,
  invites,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  servers: SignedInServer[];
  /** Pending invites keyed by server address. */
  invites: Record<string, PendingInvite[]>;
  /** Called after an accept or decline, so the count refreshes. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<
    { org: Organization; url: string }[]
  >([]);

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (e) {
      setError(accessErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const rows = servers.flatMap((s) =>
    (invites[s.url] ?? []).map((inv) => ({ server: s, inv })),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitations</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <FormError message={error} />
          {accepted.map(({ org, url }) => (
            <div
              key={org.id}
              className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                You joined {org.name}.
              </span>
              <Button
                size="sm"
                onClick={() =>
                  void run(org.id, async () => {
                    await openOrg(url, org);
                    setAccepted((a) => a.filter((x) => x.org.id !== org.id));
                    onOpenChange(false);
                  })
                }
              >
                Open {org.name}
              </Button>
            </div>
          ))}
          {rows.length === 0 && accepted.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No invitations waiting.
            </p>
          )}
          {rows.map(({ server, inv }) => (
            <div
              key={inv.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2"
            >
              <Building2 className="text-muted-foreground size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{inv.org_name}</div>
                <div className="text-muted-foreground text-2xs truncate">
                  {inv.role} · from {inv.inviter_name || inv.inviter_email} ·{" "}
                  {server.label}
                </div>
              </div>
              <Button
                size="sm"
                disabled={busy !== null}
                aria-label={`Accept invitation to ${inv.org_name}`}
                onClick={() =>
                  void run(inv.id, async () => {
                    const org = await serversInviteAccept(
                      server.profileId,
                      inv.id,
                    );
                    setAccepted((a) => [...a, { org, url: server.url }]);
                  })
                }
              >
                {busy === inv.id && (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                )}
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                aria-label={`Decline invitation to ${inv.org_name}`}
                onClick={() =>
                  void run(inv.id, () =>
                    serversInviteDecline(server.profileId, inv.id),
                  )
                }
              >
                Decline
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Create an organization on a server that allows this person to. Only
 *  offered when `me.can_create_org` says so; the server decides again. */
export function NewOrgDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  server: SignedInServer | null;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!server || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const org = await serversOrgCreateNew(server.url, name.trim());
      await openOrg(server.url, org);
      setName("");
      onOpenChange(false);
    } catch (e) {
      setError(accessErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New organization</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <FormError message={error} />
          <div className="grid gap-1.5">
            <Label htmlFor="new-org-name">Organization name</Label>
            <Input
              id="new-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc"
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Create organization
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
