import type { QueryOp, WireFilter } from "@/shared/api";

/** Human-readable status-bar text for "what this grid is effectively
 *  running" — SQL for table connections, a Mongo-shell-shaped string for
 *  Mongo/DocumentDB ones. Built from the same structured `get_filtered_op()`
 *  the grid already exposes for exports, so it can never disagree with what
 *  the grid is actually filtering/sorting by. This is a DISPLAY string only
 *  (not parsed back, not sent anywhere) — best-effort for the Mongo filter
 *  case in particular, where a `WireFilter[]` doesn't capture every operator
 *  BSON supports. */
export function formatQueryPreview(
  op: Extract<QueryOp, { kind: "select" }>,
  page_size: number,
  is_mongo: boolean,
): string {
  return is_mongo
    ? format_mongo_preview(op, page_size)
    : format_sql_preview(op, page_size);
}

function format_sql_preview(
  op: Extract<QueryOp, { kind: "select" }>,
  page_size: number,
): string {
  let s = `SELECT * FROM "${op.table}"`;
  const where = sql_where(op.filters, op.custom_where);
  if (where) s += ` WHERE ${where}`;
  if (op.order_by) s += ` ORDER BY ${op.order_by} ${op.order_dir ?? "ASC"}`;
  s += ` LIMIT ${page_size}`;
  return s;
}

function sql_where(
  filters: WireFilter[] | undefined,
  custom_where: string | undefined,
): string {
  if (custom_where?.trim()) return custom_where.trim();
  if (!filters?.length) return "";
  return filters
    .map((f, i) => {
      const prefix = i === 0 ? "" : ` ${f.conjunction ?? "AND"} `;
      switch (f.op) {
        case "is_null":
          return `${prefix}${f.column} IS NULL`;
        case "is_not_null":
          return `${prefix}${f.column} IS NOT NULL`;
        case "contains":
          return `${prefix}${f.column} LIKE '%${f.value}%'`;
        case "starts_with":
          return `${prefix}${f.column} LIKE '${f.value}%'`;
        case "ends_with":
          return `${prefix}${f.column} LIKE '%${f.value}'`;
        case "gt":
          return `${prefix}${f.column} > '${f.value}'`;
        case "gte":
          return `${prefix}${f.column} >= '${f.value}'`;
        case "lt":
          return `${prefix}${f.column} < '${f.value}'`;
        case "lte":
          return `${prefix}${f.column} <= '${f.value}'`;
        case "neq":
          return `${prefix}${f.column} != '${f.value}'`;
        default:
          return `${prefix}${f.column} = '${f.value}'`;
      }
    })
    .join("");
}

function format_mongo_preview(
  op: Extract<QueryOp, { kind: "select" }>,
  page_size: number,
): string {
  const filter = op.custom_where?.trim() || mongo_filter(op.filters) || "{}";
  let s = `db.${op.table}.find(${filter})`;
  if (op.order_by)
    s += `.sort({ ${op.order_by}: ${op.order_dir === "ASC" ? 1 : -1} })`;
  s += `.limit(${page_size})`;
  return s;
}

function mongo_filter(filters: WireFilter[] | undefined): string | null {
  if (!filters?.length) return null;
  const parts = filters.map((f) => {
    switch (f.op) {
      case "is_null":
        return `${f.column}: null`;
      case "is_not_null":
        return `${f.column}: { $ne: null }`;
      case "neq":
        return `${f.column}: { $ne: "${f.value}" }`;
      case "gt":
        return `${f.column}: { $gt: ${f.value} }`;
      case "gte":
        return `${f.column}: { $gte: ${f.value} }`;
      case "lt":
        return `${f.column}: { $lt: ${f.value} }`;
      case "lte":
        return `${f.column}: { $lte: ${f.value} }`;
      case "contains":
        return `${f.column}: { $regex: "${f.value}" }`;
      case "starts_with":
        return `${f.column}: { $regex: "^${f.value}" }`;
      case "ends_with":
        return `${f.column}: { $regex: "${f.value}$" }`;
      default:
        return `${f.column}: "${f.value}"`;
    }
  });
  return `{ ${parts.join(", ")} }`;
}
