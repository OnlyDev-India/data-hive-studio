import { maskStringsAndComments } from "@/shared/lib/utils";

/** `:name` (SQLite/Postgres ad-hoc convention — `::` type casts are excluded
 *  via the negative lookbehind) and `${name}` (template style). Bare `?` is
 *  deliberately not supported: unlike the other two it has no name to key a
 *  value by, and in Postgres it collides with the jsonb key-existence
 *  operators (`?`, `?|`, `?&`) — too ambiguous to scan for reliably in
 *  already-written SQL text. */
const BIND_VAR_RE = /(?<!:):([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

interface Occurrence {
  start: number;
  end: number;
  name: string;
}

/** Scans the masked (string/comment-blanked) text so a variable-shaped
 *  sequence inside a string literal or comment is never mistaken for a real
 *  placeholder — masking preserves length/positions, so the offsets found
 *  here still index correctly into the original `text`. */
function findOccurrences(text: string): Occurrence[] {
  const masked = maskStringsAndComments(text);
  const out: Occurrence[] = [];
  const re = new RegExp(BIND_VAR_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    out.push({ start: m.index, end: m.index + m[0].length, name: m[1] ?? m[2] });
  }
  return out;
}

/** Every distinct bind-variable name referenced across `texts`, in first-
 *  appearance order. */
export function findBindVariables(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const occ of findOccurrences(text)) {
      if (!seen.has(occ.name)) {
        seen.add(occ.name);
        out.push(occ.name);
      }
    }
  }
  return out;
}

/** Renders a user-entered value as a SQL literal — plain integers/decimals
 *  and `NULL` (any case) stay unquoted, empty input becomes `NULL`,
 *  everything else is single-quoted with `'` doubled. There's no structured
 *  param-binding path for ad-hoc console SQL (it's sent as raw text), so
 *  this substitution IS the escaping. */
function sqlLiteral(raw: string): string {
  const v = raw.trim();
  if (v === "" || /^null$/i.test(v)) return "NULL";
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return `'${v.replaceAll("'", "''")}'`;
}

/** Replaces every `:name`/`${name}` occurrence in `text` with its value from
 *  `values`; a name missing from `values` is left as-is. Right-to-left so
 *  each replacement's own length change never shifts a not-yet-processed
 *  occurrence's offset. */
export function substituteBindVariables(
  text: string,
  values: Record<string, string>,
): string {
  const occurrences = findOccurrences(text);
  let out = text;
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const occ = occurrences[i];
    if (!(occ.name in values)) continue;
    out = out.slice(0, occ.start) + sqlLiteral(values[occ.name]) + out.slice(occ.end);
  }
  return out;
}
