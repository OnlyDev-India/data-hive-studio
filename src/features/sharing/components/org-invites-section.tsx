import { useState } from "react";
import { Check, Copy, Loader2, Mail, Trash2, UserPlus } from "lucide-react";
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
  serversOrgInviteCreate,
  serversOrgInviteRevoke,
  type OrgEmailInvite,
} from "@/shared/api/client";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  INVITE_EXPIRY_DAYS,
  accessErrorMessage,
  type InviteExpiryDays,
} from "@/shared/api/server-access";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import { buildInviteMessage, openMailto } from "../invite-message";
import { invitableRoles } from "../org-rules";
import {
  EXPIRY_LABELS,
  STATUS_VARIANT,
  expiryKey,
  inviteWhen,
} from "./access-invites-section";
import type { OrgRole } from "./types";

/** Invite a person into this org by email. Only that person can accept, and
 *  the server sends no email: copy the message or open it in a mail app. */
export function OrgInvitesSection({
  invites,
  profileId,
  orgId,
  onChanged,
}: {
  invites: OrgEmailInvite[];
  profileId: string;
  orgId: string;
  onChanged: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const session = useStudioStore((s) => s.serverSessions[profileId]);
  const me = session?.me;
  const org = me?.orgs.find((o) => o.id === orgId);
  const roles = invitableRoles(org?.role);
  const server_address = WEB
    ? window.location.origin
    : (session?.profile.url ?? "");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [days, setDays] = useState<InviteExpiryDays>(
    DEFAULT_INVITE_EXPIRY_DAYS,
  );
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Snapshot on mount, not Date.now() in render (react-hooks/purity): the
  // "expires in" text is a hint that refreshes on the next load.
  const [now] = useState(() => Date.now());

  function message_for(inv: Pick<OrgEmailInvite, "email" | "role">) {
    return buildInviteMessage({
      inviterName: me?.name ?? me?.email ?? "Someone",
      orgName: org?.name ?? "the organization",
      role: inv.role,
      serverAddress: server_address,
      email: inv.email,
    });
  }

  async function copy_message(inv: OrgEmailInvite) {
    const { subject, body } = message_for(inv);
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(inv.id);
      setTimeout(() => setCopied((c) => (c === inv.id ? null : c)), 1500);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't copy the message",
        detail: String(e),
      });
    }
  }

  async function email_message(inv: OrgEmailInvite) {
    try {
      await openMailto(message_for(inv).mailto);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't open your mail app",
        detail: String(e),
      });
    }
  }

  async function invite() {
    const target = email.trim();
    if (busy || !target) return;
    setBusy(true);
    try {
      await serversOrgInviteCreate(profileId, orgId, target, role, days);
      pushNotification({
        kind: "success",
        title: `Invitation saved for ${target}`,
        detail: "Send them the message: Copy message or Email.",
      });
      setEmail("");
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't create the invitation",
        detail: accessErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(inv: OrgEmailInvite) {
    if (revoking !== inv.id) {
      setRevoking(inv.id);
      setTimeout(() => setRevoking((r) => (r === inv.id ? null : r)), 3000);
      return;
    }
    try {
      await serversOrgInviteRevoke(profileId, orgId, inv.id);
      pushNotification({ kind: "success", title: "Invitation revoked" });
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't revoke the invitation",
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
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="oi-email">Email to invite</Label>
            <Input
              id="oi-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="oi-role">Role</Label>
            <Select
              id="oi-role"
              value={role}
              onValueChange={(v) => setRole(v as OrgRole)}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="oi-expiry">Expires</Label>
            <Select
              id="oi-expiry"
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
            Only this email can accept. They sign in with Google or GitHub using
            it. No email is sent, so use Copy message or Email below.
          </p>
        </div>
      </form>

      {invites.length === 0 ? (
        <p className="text-muted-foreground py-2 text-xs">
          No invitations yet.
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
                  {inv.role} · {inviteWhen(inv, now)} · invited by{" "}
                  {inv.created_by}
                </div>
              </div>
              <Badge variant={STATUS_VARIANT[inv.status]} className="shrink-0">
                {inv.status}
              </Badge>
              {inv.status !== "used" && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2"
                    aria-label={`Copy message for ${inv.email}`}
                    onClick={() => void copy_message(inv)}
                  >
                    {copied === inv.id ? (
                      <Check className="size-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    Copy message
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2"
                    aria-label={`Email ${inv.email}`}
                    onClick={() => void email_message(inv)}
                  >
                    <Mail className="size-3.5" /> Email
                  </Button>
                  <Button
                    size={revoking === inv.id ? "icon" : "default"}
                    variant={revoking === inv.id ? "destructive" : "ghost"}
                    className="h-7 w-auto shrink-0 px-2"
                    title={
                      revoking === inv.id ? "Click again to confirm" : "Revoke"
                    }
                    aria-label={`Revoke invitation for ${inv.email}`}
                    onClick={() => void revoke(inv)}
                  >
                    <Trash2 className="size-3.5" />
                    {revoking === inv.id && (
                      <span className="text-3xs ml-0.5">confirm</span>
                    )}
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
