/** MySQL string literal: quotes doubled, backslashes escaped. */
const lit = (v: string) => `'${v.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/** A default the table structure reports (the raw value, as `table_schema`
 *  gives it on both flavors) written back as SQL: an expression or literal
 *  the server keeps as is, anything else as a quoted string. */
export function mysqlDefaultSql(raw: string | null, extra: string): string {
  if (raw === null) return "";
  if (extra.toLowerCase().includes("default_generated")) {
    return /^(current_timestamp|now\()/i.test(raw) ? raw : `(${raw})`;
  }
  if (
    /^-?\d+(\.\d+)?$/.test(raw) ||
    /^b'[01]*'$/.test(raw) ||
    /^(current_timestamp|now)(\(\d*\))?$/i.test(raw)
  )
    return raw;
  return lit(raw);
}
