/** Flags SQL statements worth confirming before they run: an UPDATE/DELETE
 *  with no WHERE clause touches every row in the table, and TRUNCATE/DROP
 *  are unconditionally destructive regardless of a WHERE clause (which
 *  doesn't even apply to them). Deliberately simple (a masked-text keyword
 *  scan, not a real parser) — good enough to catch the classic "forgot the
 *  WHERE" mistake without chasing every SQL dialect's edge cases. */
import { maskStringsAndComments } from "@/shared/lib/utils";

const UNCONDITIONAL_WRITE = /^\s*(update|delete)\b/i;
const UNCONDITIONALLY_DESTRUCTIVE = /^\s*(truncate|drop)\b/i;
const HAS_WHERE = /\bwhere\b/i;

/** A short, user-facing reason this statement needs confirmation — `null`
 *  when it doesn't. */
export function dangerousSqlReason(sql: string): string | null {
  const trimmed = sql.trim();
  if (UNCONDITIONALLY_DESTRUCTIVE.test(trimmed)) {
    const verb = trimmed.match(UNCONDITIONALLY_DESTRUCTIVE)![1].toUpperCase();
    return `${verb} is unconditionally destructive`;
  }
  if (UNCONDITIONAL_WRITE.test(trimmed)) {
    const masked = maskStringsAndComments(trimmed);
    if (!HAS_WHERE.test(masked)) {
      const verb = trimmed.match(UNCONDITIONAL_WRITE)![1].toUpperCase();
      return `${verb} with no WHERE clause affects every row`;
    }
  }
  return null;
}
