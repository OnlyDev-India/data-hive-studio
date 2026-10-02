import type {
  ConnectionInfo,
  GraphTable,
  SchemaGraph,
} from "@/shared/api/types";
import { stableConnKey, tabKey, useStudioStore } from "@/shared/store";
import type { TableAction } from "@/shared/components/table-menu";

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

/** Carry out a table menu pick from a diagram. Copy is the canvas's own. */
export function actFromDiagram(
  conn: ConnectionInfo,
  t: GraphTable,
  action: TableAction,
  database: string | undefined,
  graph: SchemaGraph,
) {
  const s = useStudioStore.getState();
  const db = conn.kind === "mongodb" ? (database ?? conn.name) : database;
  const schema = t.schema ?? undefined;
  switch (action) {
    case "open":
    case "structure":
      openFromDiagram(conn, t, action === "open" ? "data" : "schema", db);
      return;
    case "compare":
      s.openCompare(conn.id, {
        conn_id: conn.id,
        conn_key: stableConnKey(conn),
        ...(db !== undefined ? { database: db } : {}),
        ...(schema !== undefined ? { schema } : {}),
        table: t.name,
      });
      return;
    case "import":
      s.openImport({ connId: conn.id, table: t.name, database: db, schema });
      return;
    case "grants":
    case "duplicate":
    case "drop":
      s.openTableDialog({
        kind: action,
        connId: conn.id,
        table: t.name,
        database: db,
        schema,
        objectKind: "table",
        taken:
          action === "duplicate"
            ? graph.tables
                .filter(
                  (x) => !x.stub && (x.schema ?? null) === (t.schema ?? null),
                )
                .map((x) => x.name)
            : undefined,
      });
      return;
    case "copy":
    case "refresh_matview":
      return;
  }
}
