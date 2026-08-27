import { quoteIdent } from "../types";
import type {
  BuiltQuery,
  QueryDetails,
  SqlAdapter,
  WhereClause,
} from "./types";

function whereSql(where?: WhereClause): string {
  return where && where.sql.trim() ? ` WHERE ${where.sql}` : "";
}

/** Render a cell value as an inline SQL literal (for copy/export INSERTs). */
function toLiteral(v: string | null, sqlType: string | undefined): string {
  if (v === null) return "NULL";
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool"))
    return v === "1" || v.toLowerCase() === "true" ? "1" : "0";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n)) return v;
  }
  return `'${v.replaceAll("'", "''")}'`;
}

/** Postgres dialect: identifiers in double quotes, `$n` placeholders. */
export const postgresAdapter: SqlAdapter = {
  kind: "postgres",
  quoteIdent,

  buildQuery(details: QueryDetails): BuiltQuery {
    const built = sqliteBuild(details);
    // Convert ? placeholders to $1..$n for Postgres.
    let n = 0;
    const sql = built.sql.replace(/\?/g, () => `$${++n}`);
    return { sql, params: built.params };
  },
};

/** Shared PG statement builder (kept separate so the public buildQuery can
 *  post-process placeholders). */
function sqliteBuild(details: QueryDetails): BuiltQuery {
  switch (details.kind) {
    case "select": {
      const t = quoteIdent(details.table);
      const order = details.order_by
        ? ` ORDER BY ${quoteIdent(details.order_by)} ${details.order_dir ?? "ASC"}`
        : "";
      const page =
        details.limit === undefined
          ? ""
          : ` LIMIT ${details.limit}${details.offset ? ` OFFSET ${details.offset}` : ""}`;
      return {
        sql: `SELECT * FROM ${t}${whereSql(details.where)}${order}${page}`,
        params: details.where?.params ?? [],
      };
    }
    case "count":
      return {
        sql: `SELECT COUNT(*) FROM ${quoteIdent(details.table)}${whereSql(details.where)}`,
        params: details.where?.params ?? [],
      };
    case "select_distinct":
      return {
        sql: `SELECT DISTINCT ${quoteIdent(details.column)} FROM ${quoteIdent(
          details.table,
        )} WHERE ${quoteIdent(details.column)} IS NOT NULL ORDER BY 1${
          details.limit === undefined ? "" : ` LIMIT ${details.limit}`
        }`,
        params: [],
      };
    case "insert": {
      const entries = Object.entries(details.values);
      const provided = details.skip_empty
        ? entries.filter(([, v]) => v !== null && v !== "")
        : entries;
      if (provided.length === 0) {
        return {
          sql: `INSERT INTO ${quoteIdent(details.table)} (DEFAULT)`,
          params: [],
        };
      }
      const cols = provided.map(([c]) => quoteIdent(c)).join(", ");
      const marks = provided.map(() => "?").join(", ");
      return {
        sql: `INSERT INTO ${quoteIdent(details.table)} (${cols}) VALUES (${marks})`,
        params: provided.map(([, v]) => v ?? null),
      };
    }
    case "update": {
      const cols = Object.keys(details.set);
      const sets = cols.map((c) => `${quoteIdent(c)} = ?`).join(", ");
      return {
        sql: `UPDATE ${quoteIdent(details.table)} SET ${sets} WHERE ${details.where.sql}`,
        params: [
          ...cols.map((c) => details.set[c] ?? null),
          ...details.where.params,
        ],
      };
    }
    case "delete":
      return {
        sql: `DELETE FROM ${quoteIdent(details.table)} WHERE ${details.where.sql}`,
        params: details.where.params,
      };
    case "insert_literal": {
      const cols = details.columns.map((c) => quoteIdent(c)).join(", ");
      const vals = details.columns
        .map((c, i) => toLiteral(details.values[i] ?? null, details.types?.[c]))
        .join(", ");
      return {
        sql: `INSERT INTO ${quoteIdent(details.table)} (${cols}) VALUES (${vals});`,
        params: [],
      };
    }
    case "drop_table":
      return { sql: `DROP TABLE ${quoteIdent(details.table)}`, params: [] };
  }
}
