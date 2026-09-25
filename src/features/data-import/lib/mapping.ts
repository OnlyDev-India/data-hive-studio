import type { ColumnInfo, DbKind } from "@/shared/api";
import { typeName } from "./build-create-sql";
import { inferKind } from "./infer-types";
import type { ParsedFile } from "./types";

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

/** A field a document store will create, built from file column `from`. The
 *  name is the header, made unique against the fields already listed. */
export function newFieldFor(
  header: string,
  from: number,
  taken: string[],
  dataType: string,
): ColumnInfo {
  const base = header.trim() || `column_${from + 1}`;
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  let name = base;
  for (let n = 2; lower.has(name.toLowerCase()); n++) name = `${base}_${n}`;
  return {
    name,
    data_type: dataType,
    not_null: false,
    primary_key: false,
    default: null,
  };
}

/** Document stores: every file column the collection has no field for becomes
 *  a new field, so nothing is skipped unless the person chooses to. */
export function addUnmatched(
  parsed: ParsedFile,
  columns: ColumnInfo[],
  mapping: Mapping,
  db: DbKind | undefined,
): { mapping: Mapping; added: ColumnInfo[] } {
  const next: Mapping = { ...mapping };
  const used = new Set(Object.values(mapping).filter((v) => v !== null));
  const added: ColumnInfo[] = [];
  parsed.header.forEach((h, i) => {
    if (used.has(i)) return;
    const kind = inferKind(parsed.rows.map((r) => r[i] ?? ""));
    const field = newFieldFor(
      h,
      i,
      [...columns, ...added].map((c) => c.name),
      typeName(kind, db),
    );
    added.push(field);
    next[field.name] = i;
  });
  return { mapping: next, added };
}
