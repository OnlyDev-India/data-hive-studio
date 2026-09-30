import type { ConnectionInfo, GraphTable } from "@/shared/api/types";
import { tabKey, useStudioStore } from "@/shared/store";

/** Open a diagram box's table in its own tab, in the right database and
 *  schema. `database` undefined = the connection's own (Mongo: its name). */
export function openFromDiagram(
  conn: ConnectionInfo,
  t: GraphTable,
  view: "data" | "schema",
  database: string | undefined,
) {
  const s = useStudioStore.getState();
  if (conn.kind === "mongodb") {
    const db = database ?? conn.name;
    s.openMongo(conn.id, db, t.name);
    const opened = useStudioStore.getState().workspaces[conn.id]?.active;
    if (view === "schema" && opened?.kind === "mongo")
      s.setPaneMode(conn.id, tabKey(opened), "schema");
    return;
  }
  const schema = t.schema ?? undefined;
  if (view === "data")
    s.openTable(conn.id, t.name, undefined, database, schema);
  else s.openStructure(conn.id, t.name, database, schema);
}
