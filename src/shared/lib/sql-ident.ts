export type SqlDialect = "postgresql" | "sqlite" | "mysql";

const RESERVED = new Set([
  "on",
  "using",
  "where",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
  "outer",
  "as",
  "lateral",
  "select",
  "from",
  "group",
  "order",
  "limit",
  "table",
  "user",
]);

/** `name` as an identifier, quoted only when it has to be. Postgres folds
 *  bare names to lower case, so mixed case needs quotes there too. MySQL
 *  quotes with backticks. */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  const bare =
    dialect === "postgresql" ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][\w$]*$/;
  if (bare.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  if (dialect === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** The builder dialect for a connection kind: MySQL and MariaDB share one. */
export function sqlDialectOf(kind: string | undefined): SqlDialect {
  if (kind === "postgres") return "postgresql";
  if (kind === "mysql" || kind === "mariadb") return "mysql";
  return "sqlite";
}
