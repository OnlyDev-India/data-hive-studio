import {
  joinText,
  parseJoin,
  parseTableRef,
  tableText,
  type Dialect,
  type TableRef,
} from "../sql-text";
import { clauseOf, isColumn, keyword, parseFragment, type Node } from "./cst";

export const JOIN_TYPES = [
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
] as const;
export type JoinType = (typeof JOIN_TYPES)[number];

export interface OnPair {
  left: string;
  right: string;
}

export interface JoinForm {
  type: JoinType;
  table: TableRef | null;
  /** `column = column` rows, or the ON text when it is anything else. */
  on: { mode: "pairs"; pairs: OnPair[] } | { mode: "text"; text: string };
}

export function parseFrom(body: string): TableRef | null {
  if (!body.trim()) return null;
  return parseTableRef(body);
}

export const printFrom = (t: TableRef) => tableText(t);

function joinType(type: string): JoinType | null {
  const t = type.toUpperCase().replace(/\s+OUTER/, "");
  if (t === "JOIN" || t === "INNER JOIN") return "INNER JOIN";
  return (JOIN_TYPES as readonly string[]).includes(t) ? (t as JoinType) : null;
}

/** JOIN text as its form. Null for a CROSS or NATURAL join, USING, or text
 *  that is not one table. */
export function parseJoinForm(body: string, dialect: Dialect): JoinForm | null {
  if (!body.trim())
    return {
      type: "INNER JOIN",
      table: null,
      on: { mode: "pairs", pairs: [] },
    };
  const parts = parseJoin(body);
  const type = parts && joinType(parts.type);
  if (!parts || !type) return null;
  const cond = parts.condition;
  if (!cond)
    return { type, table: parts.table, on: { mode: "pairs", pairs: [] } };
  if (!/^on\b/i.test(cond)) return null;
  const f = parseFragment(
    `SELECT 1 FROM t WHERE ${cond.replace(/^on\b/i, "")}`,
    dialect,
  );
  const where = f && clauseOf(f, "where_clause");
  if (!f || !where) return null;
  const pairs: OnPair[] = [];
  const walk = (n: Node): boolean => {
    if (n.type === "binary_expr" && keyword(n.operator).toUpperCase() === "AND")
      return walk(n.left as Node) && walk(n.right as Node);
    if (
      n.type === "binary_expr" &&
      keyword(n.operator) === "=" &&
      isColumn(n.left as Node) &&
      isColumn(n.right as Node)
    ) {
      pairs.push({
        left: f.text(n.left as Node),
        right: f.text(n.right as Node),
      });
      return true;
    }
    return false;
  };
  const on = walk(where.expr as Node)
    ? { mode: "pairs" as const, pairs }
    : { mode: "text" as const, text: f.text(where.expr as Node) };
  return { type, table: parts.table, on };
}

export function printJoin(j: JoinForm): string {
  if (!j.table) return "";
  const condition =
    j.on.mode === "text"
      ? j.on.text.trim()
        ? `ON ${j.on.text.trim()}`
        : ""
      : j.on.pairs.filter((p) => p.left.trim() && p.right.trim()).length > 0
        ? `ON ${j.on.pairs
            .filter((p) => p.left.trim() && p.right.trim())
            .map((p) => `${p.left} = ${p.right}`)
            .join(" AND ")}`
        : "";
  return joinText({ type: j.type, table: j.table, condition });
}
