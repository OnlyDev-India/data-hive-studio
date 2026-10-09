import { quoteIdent } from "@/shared/lib/sql-ident";
import { useStudioStore } from "./store";
import { selectQuery, type BuilderQuery } from "./types";

/** Open a new query builder tab with `queries`, else one SELECT query on
 *  `table`, in that database and schema. `database` undefined is the
 *  connection's own; a Postgres tab with no schema named lands in
 *  `public`. */
export function openQueryBuilderFor(
  conn: { id: string; kind: string },
  t: {
    database?: string;
    schema?: string;
    table?: string;
    queries?: BuilderQuery[];
  },
) {
  const pg = conn.kind === "postgres";
  if (!pg && conn.kind !== "sqlite") return;
  const body = t.table ? quoteIdent(t.table, pg ? "postgresql" : "sqlite") : "";
  const queries = t.queries ?? [selectQuery(body)];
  useStudioStore.getState().openQueryBuilder(conn.id, {
    database: pg ? (t.database ?? null) : null,
    schema: pg ? (t.schema ?? "public") : null,
    queries,
    picked_query_ids: queries.length > 0 ? [queries[0].id] : [],
  });
}
