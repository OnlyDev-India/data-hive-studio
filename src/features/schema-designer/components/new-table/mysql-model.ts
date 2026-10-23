import { getAdapter } from "@/shared/api";
import { mysqlDefaultSql } from "@/shared/schema-drafts/mysql-default";

export { mysqlDefaultSql };
import type { Built, ColumnDef, Draft } from "./model";

/** The MySQL type list for the new table designer (spec 0025 AC-18). */
export const MYSQL_COLUMN_TYPES = [
  "INT",
  "BIGINT",
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "BIT",
  "BOOLEAN",
  "CHAR",
  "VARCHAR",
  "TINYTEXT",
  "TEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "BINARY",
  "VARBINARY",
  "TINYBLOB",
  "BLOB",
  "MEDIUMBLOB",
  "LONGBLOB",
  "ENUM",
  "SET",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "YEAR",
  "JSON",
  "GEOMETRY",
];

/** Types that take a length, a precision or (BIT) a width. */
export const MYSQL_LENGTH_TYPES = new Set([
  "CHAR",
  "VARCHAR",
  "BINARY",
  "VARBINARY",
  "DECIMAL",
  "BIT",
]);

/** Types whose values list lives in the Length cell. */
export const MYSQL_VALUE_TYPES = new Set(["ENUM", "SET"]);

const INTEGER_TYPES = new Set([
  "INT",
  "BIGINT",
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
]);

/** Types `UNSIGNED` applies to. */
export const MYSQL_NUMERIC_TYPES = new Set([
  ...INTEGER_TYPES,
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
]);

/** Types that can take `ON UPDATE CURRENT_TIMESTAMP`. */
export const MYSQL_ON_UPDATE_TYPES = new Set(["TIMESTAMP", "DATETIME"]);

const q = (name: string) => getAdapter("mysql").quoteIdent(name);
const lit = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/** An ENUM or SET list as typed: `a, b` (each value quoted for you) or
 *  already quoted SQL (`'a','b'`, kept as written). */
export function valuesSql(raw: string): string {
  const text = raw.trim();
  if (text.startsWith("'")) return text;
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(lit)
    .join(",");
}

/** The column's type as MySQL writes it: `VARCHAR(255)`, `INT UNSIGNED`,
 *  `ENUM('a','b')`. */
export function mysqlTypeSql(c: ColumnDef): string {
  const ty = c.data_type.trim() || "VARCHAR";
  const len = c.length.trim();
  let out = ty;
  if (MYSQL_VALUE_TYPES.has(ty)) out = `${ty}(${valuesSql(len)})`;
  else if (MYSQL_LENGTH_TYPES.has(ty) && len) out = `${ty}(${len})`;
  else if (ty === "VARCHAR") out = "VARCHAR(255)";
  if (c.unsigned && MYSQL_NUMERIC_TYPES.has(ty)) out += " UNSIGNED";
  return out;
}

/** Split a reported MySQL type (`int unsigned`, `varchar(40)`,
 *  `enum('a','b')`) into the designer's fields, so a copied column lands
 *  in the same fields a typed one would. */
export function splitMysqlType(raw: string): Partial<ColumnDef> {
  const m = /^\s*([a-z]+)\s*(?:\((.*)\))?\s*(unsigned)?.*$/i.exec(raw);
  if (!m) return { data_type: raw.trim().toUpperCase(), length: "" };
  const base = m[1].toUpperCase();
  const inner = (m[2] ?? "").trim();
  return {
    data_type: base,
    // A values list stays as the server wrote it; a length loses spaces.
    length: MYSQL_VALUE_TYPES.has(base)
      ? inner
      : MYSQL_LENGTH_TYPES.has(base)
        ? inner.replace(/\s+/g, "")
        : "",
    unsigned: !!m[3],
  };
}

/** Ready made defaults MySQL takes as written. */
export function mysqlDefaultSuggestions(c: ColumnDef): string[] {
  if (c.auto_increment) return [];
  const out: string[] = [];
  if (!c.not_null && !c.primary_key) out.push("NULL");
  const ty = c.data_type;
  if (MYSQL_NUMERIC_TYPES.has(ty)) out.push("0", "1");
  else if (["CHAR", "VARCHAR"].includes(ty)) out.push("''");
  else if (ty === "BOOLEAN") out.push("FALSE", "TRUE");
  else if (ty === "BIT") out.push("b'0'", "b'1'");
  else if (MYSQL_ON_UPDATE_TYPES.has(ty)) out.push("CURRENT_TIMESTAMP");
  else if (ty === "DATE") out.push("(CURRENT_DATE)");
  else if (ty === "JSON") out.push("(JSON_OBJECT())", "(JSON_ARRAY())");
  return out;
}

/** MySQL's `AUTO_INCREMENT` needs an integer column that is a key; the
 *  designer offers it on the table's only primary key column. */
export function mysqlCanAutoIncrement(
  c: ColumnDef,
  cols: ColumnDef[],
): boolean {
  return (
    INTEGER_TYPES.has(c.data_type) &&
    c.primary_key &&
    cols.filter((x) => x.primary_key).length === 1
  );
}

/** One `CREATE TABLE` holding every column, key, index, check and foreign
 *  key, so creating the table is all or nothing on MySQL (spec 0025
 *  AC-19). Table options follow the closing parenthesis. */
export function buildCreateMysql(d: Draft): Built {
  const name = d.table.trim();
  if (!name) return { ok: false, error: "Table name is required." };
  if (d.cols.length === 0)
    return { ok: false, error: "Add at least one column." };
  const names = new Set(d.cols.map((c) => c.name.trim()));
  const pk = d.cols.filter((c) => c.primary_key).map((c) => c.name.trim());
  const parts: string[] = [];
  for (const c of d.cols) {
    const col = c.name.trim();
    if (!col) return { ok: false, error: "Every column needs a name." };
    if (MYSQL_VALUE_TYPES.has(c.data_type) && !valuesSql(c.length))
      return {
        ok: false,
        error: `${col} needs its ${c.data_type} values, e.g. a, b, c.`,
      };
    if (c.auto_increment && !mysqlCanAutoIncrement(c, d.cols))
      return {
        ok: false,
        error:
          "AUTO_INCREMENT needs an integer column that is the only primary key.",
      };
    let def = `${q(col)} ${mysqlTypeSql(c)}`;
    if (c.not_null || c.primary_key) def += " NOT NULL";
    const dflt = c.default.trim();
    if (dflt) def += ` DEFAULT ${dflt}`;
    if (c.auto_increment) def += " AUTO_INCREMENT";
    if (c.on_update && MYSQL_ON_UPDATE_TYPES.has(c.data_type))
      def += " ON UPDATE CURRENT_TIMESTAMP";
    if (c.unique && !c.primary_key) def += " UNIQUE";
    if (c.comment?.trim()) def += ` COMMENT ${lit(c.comment.trim())}`;
    parts.push(def);
  }
  if (pk.length > 0) parts.push(`PRIMARY KEY (${pk.map(q).join(", ")})`);
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
    const ix_name = ix.name.trim() || `idx_${name}_${ix.columns.join("_")}`;
    parts.push(
      `${ix.unique ? "UNIQUE INDEX" : "INDEX"} ${q(ix_name)} (${ix.columns.map(q).join(", ")})`,
    );
  }
  for (const [i, k] of d.constraints.entries()) {
    const label =
      d.constraints.length > 1 ? `Constraint #${i + 1}` : "Constraint";
    const prefix = k.name.trim() ? `CONSTRAINT ${q(k.name.trim())} ` : "";
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
      parts.push(`${prefix}UNIQUE (${k.columns.map(q).join(", ")})`);
    }
  }
  for (const [i, fk] of d.fks.entries()) {
    const label = d.fks.length > 1 ? `Foreign key #${i + 1}` : "Foreign key";
    if (!fk.column || !fk.ref_table.trim() || !fk.ref_column.trim())
      return {
        ok: false,
        error: `${label} is incomplete. Pick the local column and fill in both referenced table and column.`,
      };
    let def = `FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.ref_table.trim())} (${q(fk.ref_column.trim())})`;
    if (fk.on_delete !== "NO ACTION") def += ` ON DELETE ${fk.on_delete}`;
    if (fk.on_update !== "NO ACTION") def += ` ON UPDATE ${fk.on_update}`;
    parts.push(def);
  }
  const opts: string[] = [];
  const t = d.table_options;
  if (t?.charset.trim()) opts.push(`CHARACTER SET ${t.charset.trim()}`);
  if (t?.collation.trim()) opts.push(`COLLATE ${t.collation.trim()}`);
  if (t?.comment.trim()) opts.push(`COMMENT = ${lit(t.comment.trim())}`);
  const sql = `CREATE TABLE ${q(name)} (\n  ${parts.join(",\n  ")}\n)${opts.length ? ` ${opts.join(" ")}` : ""};`;
  return { ok: true, statements: [sql], sql };
}
