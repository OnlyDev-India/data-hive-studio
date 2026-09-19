/** Whether a statement changes data or schema, only to decide whether to ask
 *  first on a Production or "Confirm before writes" connection (spec 0007).
 *  A miss means no prompt and nothing else: the backend is the authority for
 *  read only, so these never have to be perfect, only cheap. Same masked
 *  text approach as `dangerous-sql.ts`, not a real parser. */
import { maskStringsAndComments } from "@/shared/lib/utils";
import { looksLikeMongoWrite } from "./stopped-status";

/** First words of statements that only read. Anything else asks. */
const READ_KEYWORDS = new Set([
  "select",
  "with",
  "values",
  "table",
  "show",
  "explain",
  "describe",
  "desc",
]);
/** A data changing statement hiding behind an allowed opener, for example
 *  `WITH gone AS (DELETE ... RETURNING *) SELECT * FROM gone`. */
const HIDDEN_WRITE = /\b(insert|update|delete|merge)\b/i;
/** `PRAGMA name = value` writes, a bare `PRAGMA name` reads. */
const PRAGMA_WRITE = /^pragma\b[^;]*=/i;

/** True when one SQL statement may change data or schema. Empty text and
 *  comment only text are not writes. */
export function isWriteSql(sql: string): boolean {
  // Strip comments and strings first, then any leading parentheses.
  const masked = maskStringsAndComments(sql)
    .trim()
    .replace(/^[\s(]+/, "");
  if (!masked) return false;
  const first = masked.match(/^[a-z_]+/i)?.[0].toLowerCase();
  if (!first) return true; // Unknown shape: ask rather than guess it is safe.
  if (first === "pragma") return PRAGMA_WRITE.test(masked);
  if (!READ_KEYWORDS.has(first)) return true;
  if (first === "with" && HIDDEN_WRITE.test(masked)) return true;
  return false;
}

/** True when a MongoDB console command may write: a write method (see
 *  `looksLikeMongoWrite`), an aggregate that ends in `$out` or `$merge`, or
 *  a raw `runCommand` / `adminCommand`, which can do anything. */
export function isWriteMongo(command: string): boolean {
  if (looksLikeMongoWrite(command)) return true;
  if (/\$(out|merge)\b/.test(command)) return true;
  return /\.\s*(runCommand|adminCommand)\s*\(/i.test(command);
}
