export type SqlDialect = "postgresql" | "sqlite";

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
 *  bare names to lower case, so mixed case needs quotes there too. */
export function quoteIdent(name: string, dialect: SqlDialect): string {
  const bare =
    dialect === "postgresql" ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][\w$]*$/;
  if (bare.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  return `"${name.replace(/"/g, '""')}"`;
}
