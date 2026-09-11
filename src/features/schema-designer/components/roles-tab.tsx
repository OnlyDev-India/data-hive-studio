import { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Users } from "lucide-react";
import { listRoleDetails, type RoleDetail } from "@/shared/api";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-3xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="wrap-break-words font-mono text-xs">{children}</span>
    </div>
  );
}

/** Server-wide roles + a per-role detail panel — Postgres's "Users &
 *  Privileges", opened as a real tab instead of the sidebar's cramped inline
 *  expand. Read-only: no GRANT/REVOKE editor (that needs a grants-enumeration
 *  query and execution commands this pass doesn't build). */
export function RolesTab({ conn_id }: { conn_id: string; tab_key: string }) {
  const [roles, setRoles] = useState<RoleDetail[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await listRoleDetails(conn_id);
        if (!cancelled) {
          setRoles(r);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id]);

  const filtered = useMemo(
    () =>
      (roles ?? []).filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [roles, search],
  );

  const active = filtered.find((r) => r.name === selected) ?? filtered[0];

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-muted-foreground max-w-sm text-sm">
          Couldn't load roles for this connection.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-64 shrink-0 flex-col border-r">
        <div className="border-b p-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles…"
            className="h-7 text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {roles === null ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              Loading roles…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              No roles match your search.
            </p>
          ) : (
            filtered.map((r) => (
              <button
                key={r.name}
                onClick={() => setSelected(r.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  active?.name === r.name
                    ? "bg-accent"
                    : "hover:bg-accent/50",
                )}
              >
                {r.superuser ? (
                  <ShieldCheck className="text-amber-500 size-3.5 shrink-0" />
                ) : (
                  <Users className="text-muted-foreground size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">
                  {r.name}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!active ? (
          <p className="text-muted-foreground text-sm">
            Select a role to see its attributes.
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <div className="flex items-center gap-2">
              {active.superuser ? (
                <ShieldCheck className="text-amber-500 size-4 shrink-0" />
              ) : (
                <Users className="text-muted-foreground size-4 shrink-0" />
              )}
              <h2 className="min-w-0 truncate font-mono text-sm font-semibold">
                {active.name}
              </h2>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {active.attributes.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  No special attributes.
                </span>
              ) : (
                active.attributes.map((a) => (
                  <span
                    key={a}
                    className="bg-accent rounded px-1.5 py-px text-2xs font-medium"
                  >
                    {a}
                  </span>
                ))
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Connection limit">
                {active.conn_limit < 0 ? "Unlimited" : active.conn_limit}
              </Field>
              <Field label="Valid until">
                {active.valid_until ?? "No expiry"}
              </Field>
              <Field label="Member of">
                {active.member_of.length > 0
                  ? active.member_of.join(", ")
                  : "—"}
              </Field>
            </div>

            {active.comment && (
              <Field label="Comment">{active.comment}</Field>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
