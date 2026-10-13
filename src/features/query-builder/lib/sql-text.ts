/** Reading and writing the table part of FROM and JOIN text. */

import { quoteIdent, type SqlDialect } from "@/shared/lib/sql-ident";

export type Dialect = SqlDialect;
export { quoteIdent };

/** One identifier: double quoted, backticked, bracketed, or bare. */
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][\w$]*)`;
const KEYWORDS = new Set([
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
]);

/** A table as written: its schema (if any), name, and alias, each in the
 *  text's own quoting. */
export interface TableRef {
  schema: string | null;
  name: string;
  alias: string | null;
}

/** The name an identifier stands for, quotes removed. */
export function unquote(ident: string): string {
  if (ident.startsWith('"')) return ident.slice(1, -1).replace(/""/g, '"');
  if (ident.startsWith("`") || ident.startsWith("[")) return ident.slice(1, -1);
  return ident;
}

const TABLE_RE = new RegExp(
  String.raw`^\s*(${IDENT})(?:\s*\.\s*(${IDENT}))?(?:\s+(?:as\s+)?(${IDENT}))?\s*$`,
  "i",
);

/** A FROM body: one table, an optional schema and alias. Null when the
 *  text is anything else (a subquery, a function, a comma join). */
export function parseTableRef(text: string): TableRef | null {
  const m = TABLE_RE.exec(text);
  if (!m) return null;
  const alias = m[3] ?? null;
  if (alias && KEYWORDS.has(alias.toLowerCase())) return null;
  if (KEYWORDS.has(m[1].toLowerCase())) return null;
  return m[2]
    ? { schema: m[1], name: m[2], alias }
    : { schema: null, name: m[1], alias };
}

/** The table as written, with its alias. */
export function tableText(t: TableRef): string {
  const name = t.schema ? `${t.schema}.${t.name}` : t.name;
  return t.alias ? `${name} ${t.alias}` : name;
}

/** How the query names this table's rows: its alias, else its name. */
export function refName(t: TableRef): string {
  return t.alias ?? t.name;
}

/** A JOIN body: the join words, the table, and the rest (ON or USING). */
export interface JoinParts {
  /** `JOIN`, `LEFT JOIN`, `INNER JOIN`, ... as written. */
  type: string;
  table: TableRef;
  /** `ON ...` or `USING (...)`, as written, or empty. */
  condition: string;
}

const JOIN_HEAD = new RegExp(
  String.raw`^\s*((?:(?:inner|cross|natural|(?:left|right|full)(?:\s+outer)?)\s+)?join)\s+`,
  "i",
);

/** Split a JOIN body. Null when it does not start with the join words or
 *  its table is not a plain table. */
export function parseJoin(text: string): JoinParts | null {
  const head = JOIN_HEAD.exec(text);
  if (!head) return null;
  const rest = text.slice(head[0].length);
  const cond = /\s(on|using)\b/i.exec(` ${rest}`);
  const table_text = cond ? rest.slice(0, cond.index) : rest;
  const table = parseTableRef(table_text);
  if (!table) return null;
  return {
    type: head[1].replace(/\s+/g, " "),
    table,
    condition: cond ? rest.slice(cond.index).trim() : "",
  };
}

export function joinText(j: JoinParts): string {
  const head = `${j.type} ${tableText(j.table)}`;
  return j.condition ? `${head} ${j.condition}` : head;
}

/** LIMIT text: a row count and an optional OFFSET. */
export function parseLimit(
  text: string,
): { limit: number; offset: number } | null {
  const m = /^\s*(\d+)(?:\s+offset\s+(\d+))?\s*$/i.exec(text);
  if (!m) return null;
  return { limit: Number(m[1]), offset: m[2] ? Number(m[2]) : 0 };
}

/** Whether a SELECT list starts with DISTINCT. */
export function isDistinct(select: string): boolean {
  return /^\s*distinct\b/i.test(select);
}

/** A CTE card's name, its RECURSIVE word, and any column list, from its
 *  body (`RECURSIVE recent (a, b)`). */
export function readCte(
  body: string,
): { recursive: boolean; name: string; columns: string } | null {
  const m =
    /^\s*(recursive\s+)?("(?:[^"]|"")+"|`[^`]+`|[A-Za-z_][\w$]*)\s*(\([^()]*\))?\s*$/i.exec(
      body,
    );
  if (!m) return null;
  return { recursive: !!m[1], name: m[2], columns: m[3]?.trim() ?? "" };
}

export const SET_OPS = ["UNION", "UNION ALL", "INTERSECT", "EXCEPT"] as const;

/** A set operation card's operator, normalized, or null. */
export function readSetOp(body: string): (typeof SET_OPS)[number] | null {
  const op = body.trim().replace(/\s+/g, " ").toUpperCase();
  return (SET_OPS as readonly string[]).includes(op)
    ? (op as (typeof SET_OPS)[number])
    : null;
}
