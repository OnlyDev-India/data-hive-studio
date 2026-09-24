import { useState } from "react";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
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
  DEFAULT_LINK_EXPIRY_DAYS,
  DEFAULT_LINK_MAX_USES,
  LINK_EXPIRY_DAYS,
  MAX_LINK_USES,
  serversOrgLinkCreate,
  serversOrgLinkRevoke,
  type LinkExpiryDays,
  type OrgLink,
} from "@/shared/api/client";
import { accessErrorMessage } from "@/shared/api/server-access";
import { joinLink } from "@/shared/api/web-join";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";

const DAY_MS = 86_400_000;

/** Where a link stands: live with its time left, or why it no longer works. */
export function linkState(
  link: Pick<OrgLink, "max_uses" | "uses_count" | "expires_ms">,
  now: number,
): { live: boolean; text: string } {
  if (link.uses_count >= link.max_uses) {
    return { live: false, text: "Used up" };
  }
  if (link.expires_ms <= now) return { live: false, text: "Expired" };
  const days = Math.ceil((link.expires_ms - now) / DAY_MS);
  return {
    live: true,
    text: days <= 1 ? "Expires within a day" : `Expires in ${days} days`,
  };
}

/** Make and manage the org's shareable links. A link adds people who already
 *  have an account, as members, up to its use limit and before it expires. */
export function OrgLinksSection({
  links,
  profileId,
  orgId,
  onChanged,
}: {
  links: OrgLink[];
  profileId: string;
  orgId: string;
  onChanged: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const session = useStudioStore((s) => s.serverSessions[profileId]);
  const server_address = WEB
    ? window.location.origin
    : (session?.profile.url ?? "");

  const [max_uses, setMaxUses] = useState(String(DEFAULT_LINK_MAX_USES));
  const [days, setDays] = useState<LinkExpiryDays>(DEFAULT_LINK_EXPIRY_DAYS);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Snapshot on mount, not Date.now() in render (react-hooks/purity): the
  // "expires in" text is a hint that refreshes on the next load.
  const [now] = useState(() => Date.now());

  const uses = Number(max_uses);
  const uses_ok = Number.isInteger(uses) && uses >= 1 && uses <= MAX_LINK_USES;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't copy",
        detail: String(e),
      });
    }
  }

  async function create() {
    if (busy || !uses_ok) return;
    setBusy(true);
    try {
      await serversOrgLinkCreate(profileId, orgId, uses, days);
      pushNotification({ kind: "success", title: "Link created" });
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't create the link",
        detail: accessErrorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: OrgLink) {
    if (revoking !== link.code) {
      setRevoking(link.code);
      setTimeout(() => setRevoking((r) => (r === link.code ? null : r)), 3000);
      return;
    }
    try {
      await serversOrgLinkRevoke(profileId, orgId, link.code);
      pushNotification({ kind: "success", title: "Link revoked" });
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't revoke the link",
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
          void create();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ol-uses">People who can use it</Label>
            <Input
              id="ol-uses"
              type="number"
              min={1}
              max={MAX_LINK_USES}
              value={max_uses}
              onChange={(e) => setMaxUses(e.target.value)}
              aria-invalid={!uses_ok}
            />
            {!uses_ok && (
              <p className="text-destructive text-2xs">
                Enter a whole number from 1 to {MAX_LINK_USES}.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ol-expiry">Expires</Label>
            <Select
              id="ol-expiry"
              value={String(days)}
              onValueChange={(v) => setDays(Number(v) as LinkExpiryDays)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_EXPIRY_DAYS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d === 1 ? "1 day" : `${d} days`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !uses_ok}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Create link
          </Button>
          <p className="text-muted-foreground text-xs">
            Anyone with the link who already has an account here joins as a
            member. Share it only with people you trust.
          </p>
        </div>
      </form>

      {links.length === 0 ? (
        <p className="text-muted-foreground py-2 text-xs">No links yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {links.map((link) => {
            const st = linkState(link, now);
            const url = joinLink(server_address, link.code);
            return (
              <div
                key={link.code}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <Badge
                  variant={st.live ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {link.role}
                </Badge>
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-xs">
                    {url}
                  </code>
                  <div className="text-muted-foreground text-2xs">
                    {link.uses_count}/{link.max_uses} used · {st.text}
                  </div>
                </div>
                {st.live && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2"
                      aria-label="Copy link"
                      onClick={() => void copy(url, `l-${link.code}`)}
                    >
                      {copied === `l-${link.code}` ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      Copy link
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2"
                      aria-label="Copy code"
                      onClick={() => void copy(link.code, `c-${link.code}`)}
                    >
                      {copied === `c-${link.code}` ? (
                        <Check className="size-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      Copy code
                    </Button>
                  </>
                )}
                <Button
                  size={revoking === link.code ? "icon" : "default"}
                  variant={revoking === link.code ? "destructive" : "ghost"}
                  className="h-7 w-auto shrink-0 px-2"
                  aria-label="Revoke link"
                  title={
                    revoking === link.code
                      ? "Click again to confirm"
                      : "Revoke link"
                  }
                  onClick={() => void revoke(link)}
                >
                  <Trash2 className="size-3.5" />
                  {revoking === link.code && (
                    <span className="text-3xs ml-0.5">confirm</span>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
