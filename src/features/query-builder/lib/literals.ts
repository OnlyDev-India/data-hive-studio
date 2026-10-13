/** How a value typed into a form is written as SQL, by its column's type. */

const NUMERIC =
  /^(int|integer|smallint|bigint|int2|int4|int8|serial|bigserial|smallserial|real|float|float4|float8|double|double precision|numeric|decimal|number|money|tinyint|mediumint)\b/i;
const BOOLEAN = /^(bool|boolean)$/i;
const NUMBER_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export type ValueKind = "number" | "boolean" | "text";

/** The kind of literal a column takes; with no type known, the value's own
 *  shape decides. */
export function valueKind(type: string | null, value: string): ValueKind {
  if (type) {
    if (NUMERIC.test(type.trim())) return "number";
    if (BOOLEAN.test(type.trim())) return "boolean";
    return "text";
  }
  if (NUMBER_TEXT.test(value.trim())) return "number";
  if (/^(true|false)$/i.test(value.trim())) return "boolean";
  return "text";
}

/** `value` as a literal: numbers bare, booleans TRUE and FALSE, anything
 *  else (dates too) quoted with `''` escaping. A number column given text
 *  that is not a number is quoted, so the database names the problem. */
export function literal(value: string, kind: ValueKind): string {
  const v = value.trim();
  if (kind === "number" && NUMBER_TEXT.test(v)) return v;
  if (kind === "boolean" && /^(true|false)$/i.test(v)) return v.toUpperCase();
  return `'${value.replace(/'/g, "''")}'`;
}
