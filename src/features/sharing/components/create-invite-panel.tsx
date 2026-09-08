import { useState } from "react";
import { Check, Copy, Plus } from "lucide-react";
import { serversOrgInviteCreate } from "@/shared/api/client";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useStudioStore, type StudioStore } from "@/shared/store";
import { ROLES, type OrgRole } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui";

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Copy code"
      onClick={() => {
        void navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  );
}

/** Form to mint a shareable invite code for this organization. */
export function CreateInviteForm({
  profileId,
  orgId,
  on_created,
}: {
  profileId: string;
  orgId: string;
  on_created: () => void;
}) {
  const pushNotification = useStudioStore((s: StudioStore) => s.pushNotification);
  const [role, setRole] = useState<OrgRole>("member");
  const [max_uses, setMaxUses] = useState("");
  const [expires_days, setExpiresDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [created_code, setCreatedCode] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const maxUses = max_uses.trim() ? Number(max_uses.trim()) : null;
      const expiresMs = expires_days.trim()
        ? Date.now() + Number(expires_days.trim()) * 24 * 60 * 60 * 1000
        : null;
      const invite = await serversOrgInviteCreate(
        profileId,
        orgId,
        role,
        maxUses,
        expiresMs,
      );
      setCreatedCode(invite.code);
      pushNotification({ kind: "success", title: "Invite created" });
      on_created();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Failed to create invite",
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="ci-role">Role granted on redemption</Label>
        <Select id="ci-role" value={role} onValueChange={(v) => setRole(v as OrgRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ci-max-uses">Max uses (optional)</Label>
          <Input
            id="ci-max-uses"
            type="number"
            min={1}
            value={max_uses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ci-expires">Expires in (days, optional)</Label>
          <Input
            id="ci-expires"
            type="number"
            min={1}
            value={expires_days}
            onChange={(e) => setExpiresDays(e.target.value)}
            placeholder="Never"
          />
        </div>
      </div>

      <Button disabled={busy} onClick={() => void create()}>
        <Plus className="size-4" /> {busy ? "Creating…" : "Create invite"}
      </Button>

      {created_code && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
            Invite code — share it with whoever you're inviting
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">
              {created_code}
            </code>
            <CopyCode code={created_code} />
          </div>
        </div>
      )}
    </div>
  );
}
