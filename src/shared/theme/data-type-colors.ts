/**
 * One color per column data type family, shared by anything that shows a
 * column type (grid header, schema views, pickers). The colors themselves
 * are the `--type-*` CSS variables in index.css (with dark mode values);
 * this file maps a raw database type name onto them.
 */

export type DataTypeFamily =
  | "number"
  | "text"
  | "bool"
  | "datetime"
  | "json"
  | "id"
  | "enum"
  | "binary"
  | "other";

/** Tailwind text color per family. Written out in full so Tailwind's source
 *  scan picks every class up. `other` keeps the plain muted look. */
export const DATA_TYPE_TEXT_CLASS: Record<DataTypeFamily, string> = {
  number: "text-type-number",
  text: "text-type-text",
  bool: "text-type-bool",
  datetime: "text-type-datetime",
  json: "text-type-json",
  id: "text-type-id",
  enum: "text-type-enum",
  binary: "text-type-binary",
  other: "text-muted-foreground",
};

/** Raw CSS color per family, for places that style inline (charts, canvas). */
export const DATA_TYPE_CSS_VAR: Record<DataTypeFamily, string> = {
  number: "var(--type-number)",
  text: "var(--type-text)",
  bool: "var(--type-bool)",
  datetime: "var(--type-datetime)",
  json: "var(--type-json)",
  id: "var(--type-id)",
  enum: "var(--type-enum)",
  binary: "var(--type-binary)",
  other: "var(--muted-foreground)",
};

// Checked in order: arrays and documents before their element types, and
// `interval` (a duration) before the `int` number rule.
const RULES: [DataTypeFamily, RegExp][] = [
  ["json", /\[\]|^_|array|json|\bobject\b|bson|hstore|document/],
  ["id", /uuid|objectid|uniqueidentifier/],
  ["bool", /bool|^bit$/],
  ["datetime", /date|time|interval|year/],
  ["binary", /bytea|blob|binary/],
  ["enum", /enum/],
  [
    "number",
    /\b(tiny|small|medium|big)?int(eger)?\d*\b|serial|numeric|decimal|real|double|float|money|number|long/,
  ],
  ["text", /char|text|string|clob|name|xml|regex|inet|cidr|macaddr/],
];

/** Family of a raw type name from any backend (Postgres, SQLite, Mongo). */
export function dataTypeFamily(
  dataType: string | null | undefined,
): DataTypeFamily {
  const t = (dataType ?? "").trim().toLowerCase();
  if (!t) return "other";
  for (const [family, re] of RULES) if (re.test(t)) return family;
  return "other";
}

/** Tailwind text color class for a raw type name. */
export const dataTypeTextClass = (dataType: string | null | undefined) =>
  DATA_TYPE_TEXT_CLASS[dataTypeFamily(dataType)];
