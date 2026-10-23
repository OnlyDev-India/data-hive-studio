import type {
  BuiltQuery,
  QueryDetails,
  SqlAdapter,
  WhereClause,
} from "./types";

/** Quote an identifier the MySQL way: backticks, inner ones doubled. */
function quoteIdent(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

function whereSql(where?: WhereClause): string {
  return where && where.sql.trim() ? ` WHERE ${where.sql}` : "";
}

/** Render a cell value as an inline SQL literal (for copy/export INSERTs).
 *  A `0x` hex value in a bytes column and a `b'0101'` value or a plain
 *  number in a `BIT` column stay bare, so MySQL reads them back as those bytes and bits.
 *  Backslashes are doubled: MySQL strings treat `\` as an escape. */
function toLiteral(v: string | null, sqlType: string | undefined): string {
  if (v === null) return "NULL";
  const t = (sqlType ?? "").toLowerCase();
  if (/(binary|blob)/.test(t) && /^0x([0-9a-f]{2})*$/i.test(v)) return v;
  if (/^bit\b/.test(t) && /^(b'[01]{1,64}'|\d+)$/i.test(v)) return v;
  if (t.includes("bool"))
    return v === "1" || v.toLowerCase() === "true" ? "1" : "0";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n)) return v;
  }
  return `'${v.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}

/** MySQL and MariaDB dialect (spec 0025): backtick identifiers, `?`
 *  placeholders, `LIMIT` paging. Registered for both kinds. */
export function mysqlAdapter(kind: "mysql" | "mariadb"): SqlAdapter {
  return {
    kind,
    quoteIdent,
    buildQuery: build,
  };
}

function build(details: QueryDetails): BuiltQuery {
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
      const cols = provided.map(([c]) => quoteIdent(c)).join(", ");
      const marks = provided.map(() => "?").join(", ");
      // `() VALUES ()` is MySQL's every column at its default.
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
