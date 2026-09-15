/** Collapses a formatted SQL statement toward a single compact line — the
 *  inverse of Format. String literals and comments are left byte-for-byte
 *  untouched (including a line comment's own terminating newline, which is
 *  semantically required to end it — dropping it would swallow everything
 *  after into the comment); every other run of whitespace collapses to one
 *  space. */
export function compressSql(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  let pendingSpace = false;

  const flushSpace = () => {
    if (pendingSpace && out.length > 0 && !out.endsWith(" ")) out += " ";
    pendingSpace = false;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      out += ch;
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 2;
        inBlock = false;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      out += ch;
      if (ch === inStr) {
        if (next === inStr) {
          out += next;
          i += 2;
          continue;
        }
        inStr = null;
      }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      flushSpace();
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "-" && next === "-") {
      flushSpace();
      inLine = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      flushSpace();
      inBlock = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pendingSpace = true;
      i++;
      continue;
    }
    flushSpace();
    out += ch;
    i++;
  }
  return out.trim();
}
