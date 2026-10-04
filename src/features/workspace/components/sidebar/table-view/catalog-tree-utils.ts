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
