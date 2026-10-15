import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Without these, `text-caption` reads as a color and loses to `text-muted-foreground`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "small", "body", "title", "heading", "display"],
      radius: ["inset", "control", "surface", "dialog", "pill"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Last path segment of a native file path — handles both `/` (mac/Linux)
 *  and `\` (Windows) separators since the path comes from Tauri's native
 *  save dialog, whichever platform that's running on. */
export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Split raw SQL (or console commands) into statement ranges, ignoring `;`
 * inside string literals and `--` / `//` / `/* *&#47;` comments. Offsets are
 * in the input string. `//` is valid JS/console syntax (MongoDB shell); it is
 * never valid SQL, so accepting it here is safe for both. NoSQL console text
 * with no `;` at all comes back as ONE statement spanning everything —
 * intentional: this console only runs one query per `;`-delimited chunk, so
 * several commands typed without a `;` between them ARE meant to be treated
 * (and, if invalid together, flagged) as a single one — see
 * `nosql-lint.ts`'s multi-statement check. */
/** Blanks out `--` / `//` / `&#47;* *&#47;` comments (and skips over string
 * literals so a `--`/`//`/`&#47;*` inside a quoted string is never mistaken
 * for one), replacing every masked character with a space — same length and
 * same newline positions as the input, so offsets computed against the
 * result still line up with the original text. For regex-based lint checks
 * (unknown table/collection names, etc.) that scan raw text rather than a
 * real parse tree: those regexes have no idea what a comment is, so without
 * this they'd just as happily match — and flag — text a user has commented
 * out. Uses the exact same string/comment scanner as `statementRanges`, so
 * the two never disagree about what counts as a comment. */
export function maskComments(sql: string): string {
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
          out += sql.slice(i, i + 2);
          i += 2;
          continue;
        }
        inStr = null;
      }
      out += ch;
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
    if (ch === "/" && next === "/") {
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

/** Like `maskComments`, but also blanks string-literal BODIES (keeping their
 *  quotes, so positions/lengths still line up) — `maskComments` keeps quoted
 *  text since its own callers (unknown-identifier checks) need to still see
 *  quoted identifiers. SQL-only comment styles (`--`, `/* *\/`), no `//` —
 *  callers scanning arbitrary SQL text (danger-statement detection,
 *  bind-variable placeholders, function-call argument parsing) that must
 *  never mistake English text or punctuation inside a string/comment for
 *  real SQL syntax. */
export function maskStringsAndComments(sql: string): string {
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

/** How a script splits into statements. `mysql` (MySQL and MariaDB, spec
 *  0025 AC-10) adds `#` comments, `-- ` comments only with the space MySQL
 *  requires, backslash escapes in strings, and `DELIMITER xx` lines. */
export type SplitDialect = "default" | "mysql";

export function statementRanges(
  sql: string,
  dialect: SplitDialect = "default",
): { start: number; end: number }[] {
  if (dialect === "mysql") return mysqlStatementRanges(sql);
  const ranges: { start: number; end: number }[] = [];
  let i = 0;
  let start = 0;
  const n = sql.length;
  let inStr: string | null = null;
  let inLine = false;
  let inBlock = false;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLine) {
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i += 2;
      } else i++;
      continue;
    }
    if (inStr) {
      if (ch === inStr) {
        if (next === inStr) {
          i += 2;
          continue;
        }
        inStr = null;
      }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "-" && next === "-") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === ";") {
      ranges.push({ start, end: i });
      start = i + 1;
    }
    i++;
  }
  ranges.push({ start, end: n });
  return ranges;
}

/** MySQL's statement splitter. A `DELIMITER xx` line changes the terminator
 *  and is never part of a statement, so a mysqldump file that creates a
 *  procedure with `DELIMITER ;;` runs as written. `/*! ... *\/` versioned
 *  comments stay inside their statement (the server runs them as code). */
function mysqlStatementRanges(sql: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const n = sql.length;
  let terminator = ";";
  let start = 0;
  let i = 0;
  let lineStart = true;
  const push = (end: number) => {
    if (sql.slice(start, end).trim()) ranges.push({ start, end });
  };
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineStart) {
      const m = /^[ \t]*delimiter[ \t]+(\S+)[^\n]*(\n|$)/i.exec(sql.slice(i));
      if (m) {
        push(i);
        terminator = m[1];
        i += m[0].length;
        start = i;
        continue;
      }
    }
    lineStart = ch === "\n";
    if (ch === "'" || ch === '"' || ch === "`") {
      i++;
      while (i < n) {
        if (sql[i] === "\\" && ch !== "`") {
          i += 2;
          continue;
        }
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    const dashComment =
      ch === "-" && next === "-" && (i + 2 >= n || /\s/.test(sql[i + 2]));
    if (ch === "#" || dashComment) {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (sql.startsWith(terminator, i)) {
      push(i);
      i += terminator.length;
      start = i;
      continue;
    }
    i++;
  }
  ranges.push({ start, end: n });
  return ranges;
}
