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

/** Open a .db/.sqlite/.sqlite3 file the OS handed us — "Open with DH
 *  Studio", double-clicking a file with DH Studio set as the default app,
 *  or a file dropped on the Dock icon. Unlike `reopenRecent`, a failure
 *  here is a deliberate user action gone wrong, so it's surfaced as a
 *  notification rather than silently falling back to the home screen. */
export async function openFileFromOs(path: string) {
  try {
    const conn = await openDatabasePath(path);
    useStudioStore.getState().openConn(conn);
  } catch (e) {
    useStudioStore.getState().pushNotification({
      kind: "error",
      title: "Couldn't open file",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
