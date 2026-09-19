/** Ordered parameter names for a small set of common SQLite/Postgres builtin
 *  functions — just enough to drive the signature-help tooltip's active-
 *  argument highlight while typing inside a call. `?` suffixes an optional
 *  parameter, `...` means "one or more of the last named parameter." Not
 *  exhaustive, and not a dialect-aware engine — same "useful, not complete"
 *  scope as `sql-docs.ts`'s hover documentation (a separate table: that
 *  one's `signature` strings are free-form text for human reading, this one
 *  needs a real ordered param LIST to know which argument is active). */
export interface FnSignature {
  name: string;
  params: string[];
}

export const SQL_SIGNATURES: Record<string, FnSignature> = {
  COUNT: { name: "COUNT", params: ["expression"] },
  SUM: { name: "SUM", params: ["column"] },
  AVG: { name: "AVG", params: ["column"] },
  MIN: { name: "MIN", params: ["column"] },
  MAX: { name: "MAX", params: ["column"] },
  COALESCE: { name: "COALESCE", params: ["value1", "value2", "..."] },
  CAST: { name: "CAST", params: ["expression AS type"] },
  UPPER: { name: "UPPER", params: ["text"] },
  LOWER: { name: "LOWER", params: ["text"] },
  LENGTH: { name: "LENGTH", params: ["text"] },
  TRIM: { name: "TRIM", params: ["text", "chars?"] },
  ROUND: { name: "ROUND", params: ["number", "decimals?"] },
  CONCAT: { name: "CONCAT", params: ["value1", "value2", "..."] },
  SUBSTR: { name: "SUBSTR", params: ["text", "start", "length?"] },
  SUBSTRING: { name: "SUBSTRING", params: ["text", "start", "length?"] },
  REPLACE: { name: "REPLACE", params: ["text", "search", "replacement"] },
  NULLIF: { name: "NULLIF", params: ["value1", "value2"] },
  NOW: { name: "NOW", params: [] },
};
