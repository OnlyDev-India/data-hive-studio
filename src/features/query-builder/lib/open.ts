import { getActiveSchema } from "@/shared/api";
import { sqlDialectOf } from "@/shared/lib/sql-ident";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
import { MAX_STATEMENTS, parseStatements, splitStatements } from "./parse-back";

/** Open a new query builder tab on a Postgres, SQLite or MySQL connection,
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

/** Open every statement in `text` as queries in one new query builder
 *  tab, on the editor's database and schema: cards where they fit, SQL
 *  statements where not. More than `MAX_STATEMENTS` opens nothing. */
export async function openQueryBuilderText(
  conn_id: string,
  text: string,
  target: { database?: string; schema?: string },
): Promise<boolean> {
  const s = useStudioStore.getState();
  const conn = s.open.find((c) => c.id === conn_id);
  if (!conn) return false;
  const dialect = sqlDialectOf(conn.kind);
  const statements = splitStatements(text, dialect);
  if (statements.length > MAX_STATEMENTS) {
    s.pushNotification({
      kind: "error",
      title: "Too many statements for one builder tab",
      detail: `This holds ${statements.length} statements, and a builder tab opens at most ${MAX_STATEMENTS}. Select a part of it, then open that.`,
    });
    return false;
  }
  const queries = parseStatements(text, dialect);
  if (queries.length === 0) return false;
  const schema =
    conn.kind === "postgres" && target.schema === undefined
      ? await getActiveSchema(conn_id).catch(() => undefined)
      : target.schema;
  openQueryBuilderFor(conn, {
    database: target.database,
    schema: schema || undefined,
    queries,
  });
  return true;
}
