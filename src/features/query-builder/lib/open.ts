import { getActiveSchema } from "@/shared/api";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
import { parseBack } from "./parse-back";

/** Open a new query builder tab on a Postgres or SQLite connection,
 *  starting with a FROM card for `table` when given. With no schema named,
 *  a Postgres tab takes the connection's active one. */
export async function openQueryBuilderOn(
  conn_id: string,
  target: { database?: string; schema?: string; table?: string } = {},
) {
  const conn = useStudioStore.getState().open.find((c) => c.id === conn_id);
  if (!conn) return;
  const schema =
    conn.kind === "postgres" && target.schema === undefined
      ? await getActiveSchema(conn_id).catch(() => undefined)
      : target.schema;
  openQueryBuilderFor(conn, { ...target, schema: schema || undefined });
}

/** Open the SELECT `text` as cards in a new query builder tab, on the
 *  editor's database and schema. A query the cards can't hold opens
 *  nothing and says why. */
export async function openQueryBuilderText(
  conn_id: string,
  text: string,
  target: { database?: string; schema?: string },
): Promise<boolean> {
  const s = useStudioStore.getState();
  const conn = s.open.find((c) => c.id === conn_id);
  if (!conn) return false;
  const r = parseBack(text, conn.kind === "postgres" ? "postgresql" : "sqlite");
  if (!r.ok) {
    s.pushNotification({
      kind: "error",
      title: "Can't open this query in the builder",
      detail: r.error,
    });
    return false;
  }
  const schema =
    conn.kind === "postgres" && target.schema === undefined
      ? await getActiveSchema(conn_id).catch(() => undefined)
      : target.schema;
  openQueryBuilderFor(conn, {
    database: target.database,
    schema: schema || undefined,
    clauses: r.clauses,
  });
  return true;
}
