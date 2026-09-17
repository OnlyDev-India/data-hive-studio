import { parse as parseSql } from "sql-parser-cst";

/** Minimal CST shape this file actually reads — same narrow-cast approach as
 *  `sql-lint.ts` (the library's real types are deeply nested and the two
 *  modules don't need to share more than "it's a tree of typed nodes"). */
interface CstNode {
  type: string;
  [key: string]: unknown;
}

function asNodeArray(value: unknown): CstNode[] {
  return Array.isArray(value) ? (value as CstNode[]) : [];
}

/** Same dual-dialect fallback as `sql-lint.ts`'s `parseForLint` — this repo
 *  targets both, and whichever one accepts the text is what the caller's
 *  query actually ran against. */
function parseLoosely(sql: string): CstNode | null {
  for (const dialect of ["sqlite", "postgresql"] as const) {
    try {
      return parseSql(sql, { dialect }) as unknown as CstNode;
    } catch {
      continue;
    }
  }
  return null;
}

/** Unwrap a `FROM` clause's table expression down to the plain table name it
 *  refers to — table ALIASES are fine (`FROM users u` still means every
 *  column belongs to `users`), but anything else (a join, a subquery, a
 *  function call) means there's no single source table to map edits back
 *  onto. */
function plainTableName(expr: CstNode): string | null {
  if (expr.type === "alias") return plainTableName(expr.expr as CstNode);
  if (expr.type === "identifier") return expr.name as string;
  if (expr.type === "member_expr") {
    const object = expr.object as CstNode;
    const property = expr.property as CstNode;
    if (object.type === "identifier" && property.type === "identifier") {
      return `${object.name}.${property.name}`;
    }
    return null;
  }
  return null;
}

/** Whether a query is a plain, single-table `SELECT` an edit can be mapped
 *  back onto: exactly one table in `FROM` (no join, no subquery), no
 *  `GROUP BY`/`HAVING`/`DISTINCT`, and a select list of only `*` or bare
 *  column references — no computed/aliased columns, since those would break
 *  the 1:1 name mapping back to the table's real columns. `WHERE`/`ORDER
 *  BY`/`LIMIT`/`OFFSET` are all fine — they don't affect row identity.
 *  Returns the referenced table name (schema-qualified if the query itself
 *  qualified it) on success, `null` otherwise. */
export function singleTableSelect(sql: string): { table: string } | null {
  const program = parseLoosely(sql);
  if (!program) return null;
  const statements = asNodeArray(program.statements);
  if (statements.length !== 1) return null;
  const stmt = statements[0];
  if (stmt.type !== "select_stmt") return null;

  const clauses = asNodeArray(stmt.clauses);
  if (clauses.some((c) => c.type === "group_by_clause" || c.type === "having_clause")) {
    return null;
  }

  const selectClause = clauses.find((c) => c.type === "select_clause");
  if (!selectClause) return null;
  const modifiers = asNodeArray(selectClause.modifiers);
  if (
    modifiers.some(
      (m) => m.type === "select_distinct" || m.type === "select_distinct_on",
    )
  ) {
    return null;
  }
  const items = asNodeArray((selectClause.columns as CstNode | undefined)?.items);
  for (const item of items) {
    if (item.type !== "all_columns" && item.type !== "identifier" && item.type !== "member_expr") {
      return null; // function call, computed expression, or an aliased column
    }
  }

  const fromClause = clauses.find((c) => c.type === "from_clause");
  if (!fromClause) return null;
  const fromExpr = fromClause.expr as CstNode;
  if (fromExpr.type === "join_expr") return null;
  const table = plainTableName(fromExpr);
  return table ? { table } : null;
}
