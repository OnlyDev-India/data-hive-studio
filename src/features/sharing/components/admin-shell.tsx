import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { AdminDashboard } from "./admin-dashboard";

export function AdminShell({
  sessions,
}: {
  sessions: {
    profile: { id: string; name: string };
    me: { is_admin: boolean };
  }[];
}) {
  const [active_idx, set_active_idx] = useState(0);
  const active = sessions[active_idx];
  if (!active) return null;

  return (
    <div className="bg-background flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
      {sessions.length > 1 && (
        <div className="bg-muted/40 flex gap-1 border-b px-4 pt-2">
          {sessions.map((s, i) => (
            <button
              key={s.profile.id}
              onClick={() => set_active_idx(i)}
              className={cn(
                "rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium",
                i === active_idx
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.profile.name}
            </button>
          ))}
        </div>
      )}
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <ShieldCheck className="text-primary size-5" />
        <h1 className="text-base font-semibold">Team admin</h1>
        <span className="text-muted-foreground ml-1 text-xs">
          · {active.profile.name}
        </span>
      </header>
      <main className="w-full flex-1">
        <AdminDashboard profileId={active.profile.id} />
      </main>
    </div>
  );
}
