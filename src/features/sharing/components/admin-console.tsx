import { useStudioStore } from "@/shared/store";
import { canManageOrg } from "@/shared/api/client";
import { AdminShell } from "./admin-shell";

/**
 * Root entry — only renders when at least one connected server session's
 * user is an Owner/Admin of that session's org. Delegates to
 * {@link AdminShell}, which handles the org switcher and tabbed dashboard.
 */
export function AdminConsole() {
  const sessions = useStudioStore((s) => s.serverSessions);
  const admin_sessions = Object.values(sessions).filter((s) =>
    canManageOrg(s.me, s.profile.org_id),
  );
  if (!admin_sessions.length) return null;
  return <AdminShell sessions={admin_sessions} />;
}
