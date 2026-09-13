/** Flags SQL statements worth confirming before they run: an UPDATE/DELETE
 *  with no WHERE clause touches every row in the table, and TRUNCATE/DROP
 *  are unconditionally destructive regardless of a WHERE clause (which
 *  doesn't even apply to them). Deliberately simple (a masked-text keyword
 *  scan, not a real parser) — good enough to catch the classic "forgot the
 *  WHERE" mistake without chasing every SQL dialect's edge cases. */

const UNCONDITIONAL_WRITE = /^\s*(update|delete)\b/i;
const UNCONDITIONALLY_DESTRUCTIVE = /^\s*(truncate|drop)\b/i;
const HAS_WHERE = /\bwhere\b/i;

/** Blank out comments AND string-literal contents (keeping length/newlines
 *  intact) so a keyword scan never mistakes English text inside a string —
 *  `'the where is unknown'` — for a real WHERE clause, or a `--`/`/* … *\/`
 *  inside a string for an actual comment. Same string/comment scanner as
 *  `maskComments` (`shared/lib/utils.ts`), extended to also blank string
 *  bodies — that one keeps them since its own callers (unknown-identifier
 *  checks) need to see quoted identifiers. */
function maskStringsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLine) {
      out += blank(ch);
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        out += "  ";
        inBlock = false;
        i += 2;
      } else {
        out += blank(ch);
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === inStr) {
        if (next === inStr) {
          out += "  ";
          i += 2;
          continue;
        }
        inStr = null;
        out += ch;
        i++;
        continue;
      }
      out += blank(ch);
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLine = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

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
