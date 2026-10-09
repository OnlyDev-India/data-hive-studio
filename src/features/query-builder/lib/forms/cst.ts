import { parse as parseSql } from "sql-parser-cst";
import { findBindVariables } from "@/shared/lib/bind-variables";
import type { Dialect } from "../sql-text";

/** A loose view of a `sql-parser-cst` node: its type, range, and children. */
export interface Node {
  type: string;
  range?: [number, number];
  [key: string]: unknown;
}

/** A parsed fragment and a way to read any node's own text back. */
export interface Fragment {
  /** The first statement's clauses. */
  clauses: Node[];
  text: (n: Node) => string;
}

/** The parser's input: bind variables read as `:name` parameters, each
 *  `${name}` as one token of its own length, so offsets and ranges still
 *  match the text. */
export function parseable(
  text: string,
  dialect: Dialect,
): Parameters<typeof parseSql> {
  if (findBindVariables([text]).length === 0)
    return [text, { dialect, includeRange: true }];
  const masked = text.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => `:${name}__`,
  );
  return [masked, { dialect, includeRange: true, paramTypes: [":name"] }];
}

/** Parse `SELECT ... <prefix><body>` (or another statement `type`) and hand
 *  back its clauses, or null when it does not parse as one statement. */
export function parseFragment(
  sql: string,
  dialect: Dialect,
  type = "select_stmt",
): Fragment | null {
  try {
    const program = parseSql(...parseable(sql, dialect)) as unknown as {
      statements: Node[];
    };
    if (program.statements.length !== 1) return null;
    const stmt = program.statements[0];
    if (stmt.type !== type) return null;
    return {
      clauses: stmt.clauses as Node[],
      text: (n) => (n.range ? sql.slice(n.range[0], n.range[1]) : ""),
    };
  } catch {
    return null;
  }
}

export function clauseOf(f: Fragment, type: string): Node | undefined {
  return f.clauses.find((c) => c.type === type);
}

/** The items of a `list_expr`, or the node alone. */
export function items(n: Node | undefined): Node[] {
  if (!n) return [];
  return n.type === "list_expr" ? (n.items as Node[]) : [n];
}

/** A keyword node's name, or several joined (`NOT IN`). */
export function keyword(op: unknown): string {
  if (typeof op === "string") return op;
  if (Array.isArray(op)) return op.map(keyword).join(" ");
  if (op && typeof op === "object" && "name" in op)
    return String((op as { name: string }).name);
  return "";
}

/** Whether `n` is a plain column: `col`, `t.col`, or quoted. */
export function isColumn(n: Node): boolean {
  if (n.type === "identifier") return true;
  if (n.type === "member_expr")
    return isColumn(n.object as Node) && isColumn(n.property as Node);
  return false;
}
