import {
  connectSaved,
  needsPassword,
  reopenRecent,
} from "@/features/connections";
import type { ConnectionInfo } from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { stableConnKey, useStudioStore } from "@/shared/store";

/** Reconnects the saved (or recent SQLite) connection behind a stable key
 *  while staying on the current workspace. Resolves to the new connection,
 *  or to a message saying why it couldn't. */
export async function reopenByKey(
  conn_key: string,
): Promise<ConnectionInfo | string> {
  const s = useStudioStore.getState();
  const back_to = s.activeId;
  let conn: ConnectionInfo | undefined;
  try {
    const saved = Object.entries(s.savedLocal).find(([name, p]) => {
      const kind = p.kind || "postgres";
      return (
        stableConnKey({
          kind: kind === "documentdb" ? "mongodb" : kind,
          name,
          source_path: p.source_path,
        }) === conn_key
      );
    });
    if (saved) {
      const [name, p] = saved;
      if (needsPassword(p, WEB))
        return "Enter this connection's password from the home screen.";
      conn = await connectSaved(p.kind || "postgres", { ...p, name });
    } else {
      const recent = s.recent.find((c) => stableConnKey(c) === conn_key);
      if (!recent?.source_path)
        return "This connection isn't saved. Open it from the home screen.";
      await reopenRecent(recent);
      conn = useStudioStore
        .getState()
        .open.find((c) => stableConnKey(c) === conn_key);
      if (!conn) return "Couldn't reopen this database file.";
    }
  } catch (e) {
    return `Connection failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (back_to && back_to !== conn.id)
    useStudioStore.getState().setActive(back_to);
  return conn;
}
