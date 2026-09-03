import { openDatabasePath, type ConnectionInfo } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

// Reopen a recent database. If the backend connection is still alive (same
// session) this just activates it; after a restart or disconnect it reopens
// the file from its stored path so the user never has to browse again.
export async function reopenRecent(conn: ConnectionInfo) {
  const open = useStudioStore.getState().open;
  if (open.some((c) => c.id === conn.id)) {
    useStudioStore.getState().openConn(conn);
    return;
  }
  if (!conn.source_path) return;
  try {
    const fresh = await openDatabasePath(conn.source_path);
    useStudioStore.getState().openConn(fresh);
  } catch {
    // File may have been moved or deleted; fall through to the home screen.
  }
}
