import { useStudioStore } from "@/shared/store";
import { AdminShell } from "./admin-shell";

/**
 * Root entry — only renders when at least one admin-scoped server session
 * is live. Delegates to {@link AdminShell} which handles the server
 * switcher and tabbed dashboard.
 */
export function AdminConsole() {
  const sessions = useStudioStore((s) => s.serverSessions);
  const admin_sessions = Object.values(sessions).filter((s) => s.me.is_admin);
  if (!admin_sessions.length) return null;
  return <AdminShell sessions={admin_sessions} />;
}
