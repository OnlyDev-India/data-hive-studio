import type { TableSchema } from "@/shared/api";
import type { CompareSetup } from "@/shared/store";

export type TypeClass =
  | "integer"
  | "numeric"
  | "text"
  | "bytes"
  | "bool"
  | "timestamp"
  | "uuid"
  | "json"
  | "other";

/** A declared column type's comparison class, for SQLite and Postgres type
 *  names alike. */
export function type_class(data_type: string): TypeClass {
  const t = data_type.toLowerCase();
  if (t.includes("json")) return "json";
  if (t.includes("uuid")) return "uuid";
  if (t.startsWith("bool")) return "bool";
  if (t.includes("blob") || t.includes("bytea")) return "bytes";
  if (t.includes("interval") || t.includes("point")) return "other";
  if (t.includes("date") || t.includes("time")) return "timestamp";
  if (t.includes("int") || t.includes("serial")) return "integer";
  if (/num|dec|real|floa|doub|money/.test(t)) return "numeric";
  if (/char|text|clob|name|string/.test(t)) return "text";
  return "other";
}

/** Integer and numeric keys still match by value. */
function key_family(c: TypeClass): string {
  return c === "integer" || c === "numeric" ? "number" : c;
}

/** Columns on both sides by name, in the left's order. */
export function shared_columns(l: TableSchema, r: TableSchema): string[] {
  const right = new Set(r.columns.map((c) => c.name));
  return l.columns.map((c) => c.name).filter((n) => right.has(n));
}

/** The shared primary key: the same columns, in the same order, on both
 *  sides. */
export function default_key(l: TableSchema, r: TableSchema): string[] | null {
  const lk = l.columns.filter((c) => c.primary_key).map((c) => c.name);
  const rk = r.columns.filter((c) => c.primary_key).map((c) => c.name);
  if (lk.length === 0 || lk.length !== rk.length) return null;
  return lk.every((n, i) => n === rk[i]) ? lk : null;
}

export interface DataPlan {
  shared: string[];
  key: string[];
  /** Compared columns, key excluded. */
  columns: string[];
  /** Why Compare data can't run, when it can't. */
  blocked: string | null;
}

export function plan_data(
  setup: CompareSetup,
  l: TableSchema,
  r: TableSchema,
): DataPlan {
  const shared = shared_columns(l, r);
  const shared_set = new Set(shared);
  const chosen = setup.key_columns?.filter((c) => shared_set.has(c)) ?? [];
  const key = chosen.length > 0 ? chosen : (default_key(l, r) ?? []);
  const in_key = new Set(key);
  const excluded = new Set(setup.excluded_columns);
  const columns = shared.filter((c) => !in_key.has(c) && !excluded.has(c));

  let blocked: string | null = null;
  if (key.length === 0) {
    blocked =
      "These tables share no primary key. Pick key columns present on both sides.";
  } else {
    const type_of = (s: TableSchema, name: string) =>
      type_class(s.columns.find((c) => c.name === name)?.data_type ?? "");
    for (const col of key) {
      const [lc, rc] = [type_of(l, col), type_of(r, col)];
      if (key_family(lc) !== key_family(rc)) {
        blocked = `Key column ${col} is ${lc} on the left and ${rc} on the right, so rows can't be matched. Pick another key.`;
        break;
      }
    }
  }
  return { shared, key, columns, blocked };
}
