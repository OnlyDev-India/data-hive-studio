import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  INVITE_EXPIRY_DAYS,
  accessErrorMessage,
  serverInviteCreate,
  serverInviteRevoke,
  serverInvitesList,
  type InviteExpiryDays,
  type ServerInvite,
} from "@/shared/api/server-access";
import { useStudioStore } from "@/shared/store";

const EXPIRY_LABELS: Record<string, string> = {
  "1": "1 day",
  "7": "7 days",
  "30": "30 days",
  never: "Never",
};

const expiryKey = (d: InviteExpiryDays) => (d === null ? "never" : String(d));

/** When an invite stops working, or that it never does. */
export function inviteWhen(inv: ServerInvite, now: number): string {
  if (inv.status === "used") {
    return inv.used_by ? `Joined as ${inv.used_by}` : "Used";
  }
  if (inv.expires_ms === null) return "Never expires";
  const days = Math.ceil((inv.expires_ms - now) / 86_400_000);
  if (inv.status === "expired") return "Expired";
  return days <= 1 ? "Expires within a day" : `Expires in ${days} days`;
}

const STATUS_VARIANT = {
  open: "default",
  used: "secondary",
  expired: "outline",
} as const;

/** Invite people by email and manage the invites. The person signs in with
 *  Google or GitHub using the invited email and lands in their account. No
 *  email is sent: tell them yourself. */
export function AccessInvitesSection({ profileId }: { profileId: string }) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [invites, setInvites] = useState<ServerInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [days, setDays] = useState<InviteExpiryDays>(
    DEFAULT_INVITE_EXPIRY_DAYS,
  );
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Snapshot on mount, not Date.now() in render (react-hooks/purity): the
  // "expires in" text is a hint that refreshes on the next load.
  const [now] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      setInvites(await serverInvitesList(profileId));
    } catch (e) {
      setInvites([]);
      pushNotification({
        kind: "error",
        title: "Couldn't load invites",
        detail: accessErrorMessage(e),
      });
    }
  }, [profileId, pushNotification]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void refresh();
  }, [refresh]);

  async function invite() {
    const target = email.trim();
    if (busy || !target) return;
    setBusy(true);
    try {
      await serverInviteCreate(profileId, target, days);
      pushNotification({
        kind: "success",
        title: `Invite saved for ${target}`,
      });
      setEmail("");
      await refresh();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't create the invite",
        detail: accessErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inv: ServerInvite) {
    if (revoking !== inv.id) {
      setRevoking(inv.id);
      setTimeout(() => setRevoking((r) => (r === inv.id ? null : r)), 3000);
      return;
    }
    try {
      await serverInviteRevoke(profileId, inv.id);
      pushNotification({ kind: "success", title: "Invite revoked" });
      await refresh();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't revoke the invite",
        detail: accessErrorMessage(e),
      });
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 rounded-md border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-email">Email to invite</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-expiry">Expires</Label>
            <Select
              id="invite-expiry"
              value={expiryKey(days)}
              onValueChange={(v) =>
                setDays(v === "never" ? null : (Number(v) as InviteExpiryDays))
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITE_EXPIRY_DAYS.map((d) => (
                  <SelectItem key={expiryKey(d)} value={expiryKey(d)}>
                    {EXPIRY_LABELS[expiryKey(d)]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            Invite
          </Button>
          <p className="text-muted-foreground text-xs">
            They sign in with Google or GitHub using this email. No email is
            sent, so let them know.
          </p>
        </div>
      </form>

      {invites === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-4 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading invites…
        </div>
      ) : invites.length === 0 ? (
        <p className="text-muted-foreground py-2 text-xs">
          No invites yet. Only people you invite can get an account.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{inv.email}</div>
                <div className="text-muted-foreground text-2xs truncate">
                  {inviteWhen(inv, now)} · invited by {inv.created_by}
                </div>
              </div>
              <Badge variant={STATUS_VARIANT[inv.status]} className="shrink-0">
                {inv.status}
              </Badge>
              {inv.status !== "used" && (
                <Button
                  size={revoking === inv.id ? "icon" : "default"}
                  variant={revoking === inv.id ? "destructive" : "ghost"}
                  className="h-7 w-auto shrink-0 px-2"
                  title={
                    revoking === inv.id ? "Click again to confirm" : "Revoke"
                  }
                  aria-label={`Revoke invite for ${inv.email}`}
                  onClick={() => void revoke(inv)}
                >
                  <Trash2 className="size-3.5" />
                  {revoking === inv.id && (
                    <span className="text-3xs ml-0.5">confirm</span>
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
