import type { CSSProperties } from "react";
import type { SchemaObject, SchemaObjectKind } from "@/shared/api";

/** Left indent per tree depth (database=0, schema=1, category=2, object=3). */
export function depthPadding(depth: number): CSSProperties {
  return { paddingLeft: `${6 + depth * 14}px` };
}

/** Cache key for one (database, schema, kind) object list — `\n` never
 *  appears in a real identifier, unlike a plain space (a quoted Postgres
 *  identifier CAN contain one). */
export function objectKey(
  database: string,
  schema: string,
  kind: SchemaObjectKind,
) {
  return `${database}\n${schema}\n${kind}`;
}

/** Narrows a cached object list down to names matching `q` — used while
 *  searching so a lazily-fetched branch only ever shows the rows that
 *  matched, not everything it happens to have cached. Passes "loading"/
 *  null/undefined through unchanged (nothing to filter yet). */
export function filterObjects<
  T extends SchemaObject[] | "loading" | null | undefined,
>(list: T, q: string): T {
  if (!Array.isArray(list)) return list;
  return list.filter((o) => o.name.toLowerCase().includes(q)) as T;
}

export function uniqueCopyName(
  name: string,
  tables: { name: string }[],
): string {
  const used = new Set(tables.map((t) => t.name));
  if (!used.has(`${name}_copy`)) return `${name}_copy`;
  let i = 2;
  while (used.has(`${name}_copy_${i}`)) i += 1;
  return `${name}_copy_${i}`;
}

/** `<name>_<YYYYMMDD_HHmmss>` — the default name MongoDB's "Duplicate
 *  collection" dialog prefills (distinct from the SQL `_copy` suffix; a
 *  timestamp practically never collides, but fall back to `uniqueCopyName`'s
 *  numbered-suffix approach on the off chance two duplicates land in the
 *  same second). */
export function timestampedCopyName(
  name: string,
  tables: { name: string }[],
): string {
  const used = new Set(tables.map((t) => t.name));
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const base = `${name}_${stamp}`;
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}
