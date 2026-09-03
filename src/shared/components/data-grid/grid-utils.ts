/** Pure, hook-free helpers used by {@link useGridController} — split out so
 *  they're unit-testable without mounting the grid, and so the controller
 *  file itself is a bit smaller. See grid-controller.ts's top comment for why
 *  the stateful hook itself isn't split further: its selection/editing/sort
 *  state is one tightly-coupled closure, not independently separable pieces. */

/** Convert a raw cell string into the value shown in the JSON viewer. */
export function toJsonValue(
  v: string | null,
  sqlType: string | undefined,
): unknown {
  if (v === null) return null;
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool")) return v === "1" || v.toLowerCase() === "true";
  // Mongo object / array columns arrive as embedded JSON strings (nested
  // documents are flattened into a single cell). Re-parse them so the JSON
  // drill-down shows the real nested structure instead of an escaped string.
  if (t.includes("object") || t.includes("array") || t.startsWith("bson")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) return n;
  }
  return v;
}

/** Render a cell value as a SQL literal for an INSERT statement. */
export function toSqlLiteral(
  v: string | null,
  sqlType: string | undefined,
): string {
  if (v === null) return "NULL";
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool"))
    return v === "1" || v.toLowerCase() === "true" ? "1" : "0";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n)) return v;
  }
  return `'${v.replaceAll("'", "''")}'`;
}

/** Build a `{ column: value }` object for one raw row. */
export function rowToObject(
  raw: (string | null)[],
  columns: string[],
  col_index_of: Record<string, number>,
  types: Record<string, string> | undefined,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const col of columns) {
    obj[col] = toJsonValue(raw[col_index_of[col] ?? 0] ?? null, types?.[col]);
  }
  return obj;
}

/** Sort rows client-side, mirroring SQL defaults (NULLs last, numeric-aware). */
export function sortRows(
  rows: (string | null)[][],
  columns: string[],
  sort_col: string | null,
  sort_asc: boolean,
): (string | null)[][] {
  if (!sort_col) return rows;
  const ci = columns.indexOf(sort_col);
  if (ci < 0) return rows;
  return [...rows].sort((a, b) => {
    const av = a[ci];
    const bv = b[ci];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const na = Number(av);
    const nb = Number(bv);
    if (
      !Number.isNaN(na) &&
      !Number.isNaN(nb) &&
      String(na) === av.trim() &&
      String(nb) === bv.trim()
    ) {
      return sort_asc ? na - nb : nb - na;
    }
    return sort_asc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}
