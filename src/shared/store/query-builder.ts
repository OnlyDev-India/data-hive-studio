import { quoteIdent } from "@/shared/lib/sql-ident";
import { useStudioStore } from "./store";
import { fromClause, type Clause } from "./types";

/** Open a new query builder tab with `clauses`, else a FROM card for
 *  `table`, in that database and schema. `database` undefined is the
 *  connection's own; a Postgres tab with no schema named lands in
 *  `public`. */
export function openQueryBuilderFor(
  conn: { id: string; kind: string },
  t: { database?: string; schema?: string; table?: string; clauses?: Clause[] },
) {
  const pg = conn.kind === "postgres";
  if (!pg && conn.kind !== "sqlite") return;
  const body = t.table ? quoteIdent(t.table, pg ? "postgresql" : "sqlite") : "";
  useStudioStore.getState().openQueryBuilder(conn.id, {
    database: pg ? (t.database ?? null) : null,
    schema: pg ? (t.schema ?? "public") : null,
    clauses: t.clauses ?? [fromClause(body)],
  });
}
