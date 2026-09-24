import type { ColumnInfo } from "@/shared/api";

/** For each target column, the index of the file column that feeds it, or
 *  null when nothing does (the column keeps its default). */
export type Mapping = Record<string, number | null>;

/** Match file columns to target columns by name, ignoring case. A file
 *  column feeds at most one target column. */
export function autoMap(header: string[], columns: ColumnInfo[]): Mapping {
  const taken = new Set<number>();
  const mapping: Mapping = {};
  for (const col of columns) {
    const idx = header.findIndex(
      (h, i) => !taken.has(i) && h.toLowerCase() === col.name.toLowerCase(),
    );
    mapping[col.name] = idx === -1 ? null : idx;
    if (idx !== -1) taken.add(idx);
  }
  return mapping;
}

/** Target columns that are NOT NULL with no default and nothing mapped: the
 *  database would refuse every row, so Import is blocked and names them. */
export function unmappedRequired(
  columns: ColumnInfo[],
  mapping: Mapping,
): string[] {
  return columns
    .filter((c) => mapping[c.name] == null && c.not_null && c.default === null)
    .map((c) => c.name);
}
