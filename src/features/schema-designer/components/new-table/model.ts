import { quoteIdent } from "@/shared/api";

export const COLUMN_TYPES = [
  "INTEGER",
  "BIGINT",
  "TEXT",
  "VARCHAR",
  "CHAR",
  "REAL",
  "NUMERIC",
  "DECIMAL",
  "BLOB",
  "BOOLEAN",
  "UUID",
  "JSONB",
  "DATE",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "INET",
];

/** Types that take a length, or precision for the decimal ones. */
export const LENGTH_TYPES = new Set(["VARCHAR", "CHAR", "NUMERIC", "DECIMAL"]);

/** Referential actions SQLite accepts on a foreign key. */
export const FK_ACTIONS = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
] as const;
export type FkAction = (typeof FK_ACTIONS)[number];

export interface ColumnDef {
  name: string;
  data_type: string;
  /** Optional length, e.g. `255` for VARCHAR or `10,2` for DECIMAL. */
  length: string;
  primary_key: boolean;
  auto_increment: boolean;
  not_null: boolean;
  unique: boolean;
  default: string;
}

export interface FkDef {
  column: string;
  ref_table: string;
  ref_column: string;
  on_delete: FkAction;
  on_update: FkAction;
}

export interface IndexDef {
  /** Blank = a name is made from the table and columns. */
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ConstraintDef {
  kind: "UNIQUE" | "CHECK";
  /** Optional. */
  name: string;
  /** UNIQUE: the columns that must be unique together. */
  columns: string[];
  /** CHECK: the expression, e.g. `qty > 0`. */
  expr: string;
}

/** What we know about a table that can be referenced by a foreign key.
 *  SQLite only allows referencing columns that are a PRIMARY KEY or covered
 *  by a single-column UNIQUE index — everything else fails at insert time
 *  with `foreign key mismatch`. */
export interface RefTableMeta {
  cols: string[];
  pk: string | null;
  valid_targets: string[];
}

export function newColumn(): ColumnDef {
  return {
    name: "",
    data_type: "TEXT",
    length: "",
    primary_key: false,
    auto_increment: false,
    not_null: false,
    unique: false,
    default: "",
  };
}

export function defaultColumn(): ColumnDef {
  return {
    ...newColumn(),
    name: "id",
    data_type: "INTEGER",
    primary_key: true,
    auto_increment: true,
  };
}

export function newFk(): FkDef {
  return {
    column: "",
    ref_table: "",
    ref_column: "",
    on_delete: "NO ACTION",
    on_update: "NO ACTION",
  };
}

export function newIndex(): IndexDef {
  return { name: "", columns: [], unique: false };
}

export function newConstraint(): ConstraintDef {
  return { kind: "UNIQUE", name: "", columns: [], expr: "" };
}

/** The column's type as written in SQL: `VARCHAR(255)`. */
export function typeSql(c: ColumnDef): string {
  const ty = c.data_type.trim() || "TEXT";
  const len = c.length.trim();
  return len && LENGTH_TYPES.has(ty) ? `${ty}(${len})` : ty;
}

/** Split a reported type such as `varchar(255)` into the base type and length,
 *  so a copied column lands in the same fields a typed one would. */
export function splitType(raw: string): { data_type: string; length: string } {
  const m = /^\s*([A-Za-z_ ]+?)\s*\(([^)]*)\)\s*$/.exec(raw);
  if (!m) return { data_type: raw.trim().toUpperCase(), length: "" };
  const base = m[1].trim().toUpperCase();
  return LENGTH_TYPES.has(base)
    ? { data_type: base, length: m[2].replace(/\s+/g, "") }
    : { data_type: raw.trim().toUpperCase(), length: "" };
}

/** Ready made values for a column's DEFAULT, from its type and flags. Only
 *  what the database can take as written: Postgres gets its own functions. */
export function defaultSuggestions(c: ColumnDef, is_pg?: boolean): string[] {
  // An identity column fills itself, so a default would be refused.
  if (c.auto_increment) return [];
  const out: string[] = [];
  if (!c.not_null && !c.primary_key) out.push("NULL");
  switch (c.data_type) {
    case "INTEGER":
    case "BIGINT":
    case "REAL":
    case "NUMERIC":
    case "DECIMAL":
      out.push("0", "1");
      break;
    case "TEXT":
    case "VARCHAR":
    case "CHAR":
      out.push("''");
      break;
    case "BOOLEAN":
      out.push("FALSE", "TRUE");
      break;
    case "DATE":
      out.push("CURRENT_DATE");
      break;
    case "TIMESTAMP":
    case "TIMESTAMPTZ":
      out.push("CURRENT_TIMESTAMP");
      if (is_pg) out.push("NOW()");
      break;
    case "UUID":
      if (is_pg) out.push("gen_random_uuid()");
      break;
    case "JSONB":
      out.push("'{}'", "'[]'");
      break;
  }
  return out;
}

/** An identity column must be the table's only primary key, and an INTEGER. */
export function canAutoIncrement(c: ColumnDef, cols: ColumnDef[]): boolean {
  return (
    c.data_type === "INTEGER" &&
    c.primary_key &&
    cols.filter((x) => x.primary_key).length === 1
  );
}

/** Untick Auto Increment wherever it is no longer allowed, so the form never
 *  holds a combination the database would refuse. Returns the same array when
 *  nothing changes. */
export function normalizeAuto(cols: ColumnDef[]): ColumnDef[] {
  if (!cols.some((c) => c.auto_increment && !canAutoIncrement(c, cols)))
    return cols;
  return cols.map((c) =>
    c.auto_increment && !canAutoIncrement(c, cols)
      ? { ...c, auto_increment: false }
      : c,
  );
}

export interface Draft {
  table: string;
  cols: ColumnDef[];
  fks: FkDef[];
  indexes: IndexDef[];
  constraints: ConstraintDef[];
  schema?: string;
  is_pg?: boolean;
}

export type Built =
  | { ok: true; statements: string[]; sql: string }
  | { ok: false; error: string };

function indexName(table: string, ix: IndexDef): string {
  return ix.name.trim() || `idx_${table}_${ix.columns.join("_")}`;
}

/** The CREATE TABLE statement, then one CREATE INDEX per index. */
export function buildCreate(d: Draft): Built {
  const { cols, fks, schema, is_pg } = d;
  const table_name = d.table.trim();
  if (!table_name) return { ok: false, error: "Table name is required." };
  if (cols.length === 0)
    return { ok: false, error: "Add at least one column." };

  const pk_cols: string[] = [];
  for (const c of cols) {
    if (!c.name.trim())
      return { ok: false, error: "Every column needs a name." };
    if (c.primary_key) pk_cols.push(c.name.trim());
  }
  const names = new Set(cols.map((c) => c.name.trim()));

  // Postgres has no AUTOINCREMENT keyword (that's SQLite/MySQL) — the
  // equivalent is GENERATED ALWAYS AS IDENTITY on the column itself.
  const auto_keyword = is_pg ? "GENERATED ALWAYS AS IDENTITY" : "AUTOINCREMENT";
  const auto_columns = cols.filter((c) => c.auto_increment).map((c) => c.name);
  if (auto_columns.length > 0) {
    const ok =
      pk_cols.length === 1 &&
      auto_columns.length === 1 &&
      pk_cols[0] === auto_columns[0].trim() &&
      cols.some(
        (c) =>
          c.name.trim() === auto_columns[0].trim() && c.data_type === "INTEGER",
      );
    if (!ok) {
      return {
        ok: false,
        error: `${auto_keyword} requires a single INTEGER PRIMARY KEY column.`,
      };
    }
  }

  const parts: string[] = [];
  for (const c of cols) {
    let def = `${quoteIdent(c.name.trim())} ${typeSql(c)}`;
    // Postgres conventionally places the identity clause right after the
    // type, before PRIMARY KEY; SQLite requires AUTOINCREMENT to directly
    // follow PRIMARY KEY.
    if (is_pg && c.auto_increment) def += ` ${auto_keyword}`;
    if (c.primary_key && pk_cols.length === 1) {
      def += " PRIMARY KEY";
      if (!is_pg && c.auto_increment) def += ` ${auto_keyword}`;
    }
    if (c.not_null) def += " NOT NULL";
    if (c.unique) def += " UNIQUE";
    const dflt = c.default.trim();
    if (dflt) def += ` DEFAULT ${dflt}`;
    parts.push(def);
  }
  if (pk_cols.length > 1) {
    parts.push(`PRIMARY KEY (${pk_cols.map((n) => quoteIdent(n)).join(", ")})`);
  }
  for (const [i, k] of d.constraints.entries()) {
    const label =
      d.constraints.length > 1 ? `Constraint #${i + 1}` : "Constraint";
    const prefix = k.name.trim()
      ? `CONSTRAINT ${quoteIdent(k.name.trim())} `
      : "";
    if (k.kind === "CHECK") {
      if (!k.expr.trim())
        return { ok: false, error: `${label} needs a CHECK expression.` };
      parts.push(`${prefix}CHECK (${k.expr.trim()})`);
    } else {
      if (k.columns.length === 0)
        return { ok: false, error: `${label} needs at least one column.` };
      const gone = k.columns.find((n) => !names.has(n));
      if (gone)
        return {
          ok: false,
          error: `${label} uses "${gone}", which is not a column.`,
        };
      parts.push(
        `${prefix}UNIQUE (${k.columns.map((n) => quoteIdent(n)).join(", ")})`,
      );
    }
  }
  for (const [i, fk] of fks.entries()) {
    const label = fks.length > 1 ? `Foreign key #${i + 1}` : "Foreign key";
    if (!fk.column || !fk.ref_table.trim() || !fk.ref_column.trim()) {
      return {
        ok: false,
        error: `${label} is incomplete — pick the local column and fill in both referenced table and column.`,
      };
    }
    let def = `FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES ${quoteIdent(fk.ref_table.trim())} (${quoteIdent(fk.ref_column.trim())})`;
    if (fk.on_delete !== "NO ACTION") def += ` ON DELETE ${fk.on_delete}`;
    if (fk.on_update !== "NO ACTION") def += ` ON UPDATE ${fk.on_update}`;
    parts.push(def);
  }

  const qualified = schema
    ? `${quoteIdent(schema)}.${quoteIdent(table_name)}`
    : quoteIdent(table_name);
  const statements = [
    `CREATE TABLE ${qualified} (\n  ${parts.join(",\n  ")}\n);`,
  ];
  for (const [i, ix] of d.indexes.entries()) {
    const label = d.indexes.length > 1 ? `Index #${i + 1}` : "Index";
    if (ix.columns.length === 0)
      return { ok: false, error: `${label} needs at least one column.` };
    const gone = ix.columns.find((n) => !names.has(n));
    if (gone)
      return {
        ok: false,
        error: `${label} uses "${gone}", which is not a column.`,
      };
    statements.push(
      `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${quoteIdent(indexName(table_name, ix))} ON ${qualified} (${ix.columns.map((n) => quoteIdent(n)).join(", ")});`,
    );
  }
  return { ok: true, statements, sql: statements.join("\n\n") };
}
