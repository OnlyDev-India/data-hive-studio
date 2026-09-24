import { quoteIdent, type ColumnInfo, type DbKind } from "@/shared/api";
import { isDocumentDb } from "./typed-cell";
import { inferKind, type InferredKind } from "./infer-types";
import type { Mapping } from "./mapping";
import type { ParsedFile } from "./types";

/** One column of the table to create. `from` is the file column feeding it. */
export interface NewColumn {
  name: string;
  kind: InferredKind;
  primaryKey: boolean;
  from: number;
}

const SQLITE: Record<InferredKind, string> = {
  integer: "INTEGER",
  bigint: "INTEGER",
  decimal: "REAL",
  // SQLite stores any type name. BOOLEAN keeps the cell check and sends 1 or 0.
  boolean: "BOOLEAN",
  date: "TEXT",
  timestamp: "TEXT",
  json: "TEXT",
  text: "TEXT",
};

const POSTGRES: Record<InferredKind, string> = {
  integer: "integer",
  bigint: "bigint",
  decimal: "numeric",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamp",
  json: "jsonb",
  text: "text",
};

/** Names a new collection's fields carry. They match what the Mongo schema
 *  view reports, so the same checks apply. */
const DOCUMENT: Record<InferredKind, string> = {
  integer: "integer",
  bigint: "integer",
  decimal: "double",
  boolean: "boolean",
  date: "date",
  timestamp: "date",
  json: "object",
  text: "string",
};

/** The type name a dialect uses for a kind. */
export function typeName(kind: InferredKind, db: DbKind | undefined): string {
  if (isDocumentDb(db)) return DOCUMENT[kind];
  return (db === "postgres" ? POSTGRES : SQLITE)[kind];
}

/** A table name from a file name: `Sales 2024.csv` gives `sales_2024`. */
export function suggestTableName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) return "imported_data";
  return /^\d/.test(name) ? `t_${name}` : name;
}

/** `CREATE TABLE` for the new table. The name is left unqualified: the database
 *  layer puts the target schema on the search path for this one statement. */
export function buildCreateSql(
  table: string,
  columns: NewColumn[],
  db: DbKind | undefined,
): string {
  const lines = columns.map(
    (c) =>
      `${quoteIdent(c.name.trim())} ${typeName(c.kind, db)}${c.primaryKey ? " NOT NULL" : ""}`,
  );
  const keys = columns
    .filter((c) => c.primaryKey)
    .map((c) => quoteIdent(c.name.trim()));
  if (keys.length > 0) lines.push(`PRIMARY KEY (${keys.join(", ")})`);
  return `CREATE TABLE ${quoteIdent(table)} (\n  ${lines.join(",\n  ")}\n)`;
}

/** The columns as the mapping and type check already understand them, and the
 *  mapping that feeds each one from its file column. */
export function asTarget(
  columns: NewColumn[],
  db: DbKind | undefined,
): { columns: ColumnInfo[]; mapping: Mapping } {
  const mapping: Mapping = {};
  const infos = columns.map((c): ColumnInfo => {
    mapping[c.name.trim()] = c.from;
    return {
      name: c.name.trim(),
      data_type: typeName(c.kind, db),
      not_null: c.primaryKey,
      primary_key: c.primaryKey,
      default: null,
    };
  });
  return { columns: infos, mapping };
}

/** Starting columns for a parsed file: one per file column, types guessed
 *  from every row, names from the header (or `column_N` when it is blank). */
export function proposeColumns(parsed: ParsedFile): NewColumn[] {
  return parsed.header.map((h, i) => ({
    name: h.trim() || `column_${i + 1}`,
    kind: inferKind(parsed.rows.map((r) => r[i] ?? "")),
    primaryKey: false,
    from: i,
  }));
}

/** Why the table cannot be created yet, or null when it can. */
export function newTableProblem(
  table: string,
  columns: NewColumn[],
  existing: string[],
  db?: DbKind,
): string | null {
  const name = table.trim();
  const noun = isDocumentDb(db) ? "collection" : "table";
  if (!name) return `Give the new ${noun} a name.`;
  if (existing.some((t) => t.toLowerCase() === name.toLowerCase())) {
    return `A ${noun} named "${name}" already exists. Pick another name.`;
  }
  if (columns.length === 0) return "The file has no columns.";
  const seen = new Set<string>();
  for (const c of columns) {
    const n = c.name.trim();
    if (!n) return "Every column needs a name.";
    if (seen.has(n.toLowerCase())) return `Two columns are called "${n}".`;
    seen.add(n.toLowerCase());
  }
  return null;
}
