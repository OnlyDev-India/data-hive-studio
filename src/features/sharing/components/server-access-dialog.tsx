import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import type { MeResult } from "@/shared/api/server-admin";
import { canInvite, canManageAccounts } from "@/shared/api/server-access";
import { AccessInvitesSection } from "./access-invites-section";
import { AccessPeopleSection } from "./access-people-section";

type AccessTab = "invites" | "people";

/**
 * Server access: who may join this server and with what server role. Owners
 * and admins get Invites. People (accounts, roles) is for owners and for
 * admins an owner switched "can manage roles" on for. Members never see this
 * (the menu does not offer it), and the server refuses their calls anyway.
 */
export function ServerAccessDialog({
  open,
  onOpenChange,
  profileId,
  serverName,
  me,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profileId: string;
  serverName: string;
  me: MeResult;
}) {
  const show_people = canManageAccounts(me);
  const [tab, setTab] = useState<AccessTab>("invites");
  const active: AccessTab = tab === "people" && !show_people ? "invites" : tab;
  const tabs: { key: AccessTab; label: string }[] = [
    { key: "invites", label: "Invites" },
    ...(show_people ? [{ key: "people" as const, label: "People" }] : []),
  ];

  if (!canInvite(me)) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Server access</DialogTitle>
          <DialogDescription>
            Who can sign in to {serverName}, and what they can manage.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b"
          role="tablist"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={active === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 cursor-pointer rounded-t-md border-b-2 px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors select-none",
                active === t.key
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {active === "invites" ? (
          <AccessInvitesSection profileId={profileId} />
        ) : (
          <AccessPeopleSection profileId={profileId} me={me} />
        )}

        {!show_people && (
          <p className="text-muted-foreground text-xs">
            Managing people is off for your account. Ask a server owner to turn
            on “Can manage roles” for you.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
