import { useMemo } from "react";
import { envColorKey, tidyEnvLabel, type ConnGuard } from "@/shared/api";
import type { ConnectionInfo } from "@/shared/api";
import { useStudioStore, type SavedConnParams } from "@/shared/store";

// A connection's read only flag and label are fixed when it connects (spec
// 0007), so editing the saved connection while it is open changes nothing on
// the live one until it reconnects. These helpers find the saved connection
// behind an open one and say whether the two now disagree.

/** True when two guards would look or behave differently: read only,
 *  confirm before writes, or the label and its colour. */
export function guardsDiffer(a: ConnGuard, b: ConnGuard): boolean {
  return (
    !!a.read_only !== !!b.read_only ||
    !!a.confirm_writes !== !!b.confirm_writes ||
    (tidyEnvLabel(a.env_label) ?? "") !== (tidyEnvLabel(b.env_label) ?? "") ||
    envColorKey(a) !== envColorKey(b)
  );
}

function sameKind(conn: ConnectionInfo, saved: SavedConnParams): boolean {
  // A DocumentDB profile connects as MongoDB.
  const saved_kind = saved.kind === "documentdb" ? "mongodb" : saved.kind;
  return (saved_kind ?? "postgres") === conn.kind;
}

/** The name of the saved connection an open one came from, or null. The link
 *  is the display name the connect form recorded with the live connection's
 *  parameters; when that is missing (a connection opened without a name), it
 *  falls back to the same server, user and database, or for SQLite the same
 *  file. */
export function savedNameFor(
  conn: ConnectionInfo,
  recent: SavedConnParams | undefined,
  saved_local: Record<string, SavedConnParams>,
): string | null {
  if (
    recent?.name &&
    saved_local[recent.name] &&
    sameKind(conn, saved_local[recent.name])
  ) {
    return recent.name;
  }
  for (const [name, saved] of Object.entries(saved_local)) {
    if (!sameKind(conn, saved)) continue;
    if (conn.kind === "sqlite") {
      if (conn.source_path && saved.source_path === conn.source_path)
        return name;
      continue;
    }
    if (
      recent &&
      saved.host === recent.host &&
      saved.port === recent.port &&
      saved.user === recent.user &&
      saved.database === recent.database
    ) {
      return name;
    }
  }
  return null;
}

/** The saved connection an open one came from, when its guard now differs
 *  from the live one's. Null when there is no saved connection or nothing
 *  changed. */
export function pendingGuardChange(
  conn: ConnectionInfo,
  recent: SavedConnParams | undefined,
  saved_local: Record<string, SavedConnParams>,
): { name: string; saved: SavedConnParams } | null {
  const name = savedNameFor(conn, recent, saved_local);
  if (!name) return null;
  const saved = saved_local[name];
  return guardsDiffer(conn, saved) ? { name, saved } : null;
}

/** For the sidebar: does this open connection have a saved change waiting
 *  for a reconnect? */
export function usePendingGuardChange(conn_id: string) {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const recent = useStudioStore((s) => s.recentParams[conn_id]);
  const saved_local = useStudioStore((s) => s.savedLocal);
  return useMemo(
    () => (conn ? pendingGuardChange(conn, recent, saved_local) : null),
    [conn, recent, saved_local],
  );
}
