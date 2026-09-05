import { parse as parseSql } from "sql-parser-cst";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Completion } from "@codemirror/autocomplete";
import { referencedTables, statementAt } from "./sql-completions";

/** Client-side-only SQL validation: real syntax errors from an actual SQL
 *  grammar (`sql-parser-cst` — `@codemirror/lang-sql`'s own parser is a
 *  permissive tokenizer built for highlighting, not validation: it accepts
 *  things like `SELECT * FRM users` without complaint, so it can't do this
 *  job), a `SELECT *` with no `FROM` (syntactically legal — `*` just has
 *  nothing to expand against — but every real engine rejects it at
 *  execution time, so it's worth catching early), plus two conservative
 *  semantic checks — unknown table names, and unknown QUALIFIED columns
 *  (`table.col` / `alias.col`, alias resolved via the same
 *  `referencedTables` map the autocomplete source uses, so lint and
 *  completions never disagree).
 *
 *  Bare, unqualified column names (`SELECT id FROM users`) are deliberately
 *  never checked: without a real semantic engine there's no reliable way to
 *  tell a column reference apart from an alias or a function name — a
 *  validator that's wrong some of the time erodes trust faster than one
 *  that just checks less. Same reasoning for qualifiers that don't resolve
 *  to a known table (most likely an alias this couldn't trace, not
 *  necessarily a typo): left alone rather than guessed at. Semantic checks
 *  are also skipped entirely once there's a real syntax error — a broken
 *  statement isn't a reliable source for "what table does this mention". */
export function sqlLinter(
  tables: string[],
  schema: Record<string, Completion[]>,
) {
  const known_tables = new Set(tables.map((t) => t.toLowerCase()));
  const columns_by_table = new Map<string, Set<string>>();
  for (const [t, cols] of Object.entries(schema)) {
    columns_by_table.set(
      t.toLowerCase(),
      new Set(cols.map((c) => c.label.toLowerCase())),
    );
  }

  return (view: EditorView): Diagnostic[] => {
    const doc = view.state.doc.toString();
    if (!doc.trim()) return [];

    const parsed = parseForLint(doc);
    if (!parsed.ok) return [parsed.diagnostic];
    const diagnostics: Diagnostic[] = starWithoutFrom(parsed.program);

    // Semantic checks need an actual schema to check against — with none
    // loaded (e.g. schema still fetching), every table would falsely read
    // as "unknown".
    if (known_tables.size === 0) return diagnostics;

    // Unknown table names in FROM/JOIN/UPDATE/INSERT INTO.
    const table_re = /\b(?:from|join|update|into)\s+"?([A-Za-z_][\w$]*)"?/gi;
    let m: RegExpExecArray | null;
    while ((m = table_re.exec(doc))) {
      const name = m[1];
      if (!known_tables.has(name.toLowerCase())) {
        const start = m.index + m[0].length - name.length;
        diagnostics.push({
          from: start,
          to: start + name.length,
          severity: "error",
          message: `Unknown table "${name}"`,
        });
      }
    }

    // Unknown columns in qualified references. Resolved per-statement (see
    // `statementAt`) — a multi-statement script otherwise lets one
    // statement's alias silently resolve against a DIFFERENT statement's
    // same-named alias for a different table.
    const refsCache = new Map<string, Map<string, string>>();
    const refsAt = (pos: number) => {
      const stmt = statementAt(doc, pos);
      let refs = refsCache.get(stmt);
      if (!refs) {
        refs = referencedTables(stmt);
        refsCache.set(stmt, refs);
      }
      return refs;
    };
    const col_re = /\b([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\b/g;
    while ((m = col_re.exec(doc))) {
      const [, qualifier, column] = m;
      const real_table = refsAt(m.index).get(qualifier.toLowerCase());
      if (!real_table) continue; // unresolved alias — not this checker's call
      const cols = columns_by_table.get(real_table.toLowerCase());
      if (!cols) continue; // no known column list for this table
      if (!cols.has(column.toLowerCase())) {
        const start = m.index + qualifier.length + 1;
        diagnostics.push({
          from: start,
          to: start + column.length,
          severity: "error",
          message: `Unknown column "${column}" on "${real_table}"`,
        });
      }
    }

    return diagnostics;
  };
}

/** Loose structural shape covering just the CST fields the checks below
 *  read — `sql-parser-cst`'s real node union is large and only matters here
 *  insofar as these few fields exist on the node kinds we look for. */
interface CstNode {
  type: string;
  range?: [number, number];
  [key: string]: unknown;
}

/** The two SQL dialects this app actually connects to. The editor doesn't
 *  currently know which real database kind it's pointed at, so a statement
 *  is only flagged when NEITHER dialect's grammar accepts it — cheap
 *  insurance against flagging valid dialect-specific syntax (Postgres'
 *  `RETURNING`/`::cast`, etc.) as wrong just because it isn't valid in the
 *  other. Whichever dialect DOES accept it is what the semantic checks
 *  below run against. */
const DIALECTS = ["sqlite", "postgresql"] as const;

type ParseForLint =
  | { ok: true; program: CstNode }
  | { ok: false; diagnostic: Diagnostic };

function parseForLint(doc: string): ParseForLint {
  let message: string | null = null;
  for (const dialect of DIALECTS) {
    try {
      const program = parseSql(doc, {
        dialect,
        includeRange: true,
      }) as unknown as CstNode;
      return { ok: true, program };
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }
  const loc = locationFromMessage(message ?? "");
  let from = loc ? offsetFromLineColumn(doc, loc.line, loc.column) : 0;
  from = Math.min(Math.max(from, 0), Math.max(doc.length - 1, 0));
  return {
    ok: false,
    diagnostic: {
      from,
      to: Math.min(from + 1, doc.length),
      severity: "error",
      // Just the human-readable first line ("Syntax Error: Unexpected …") —
      // the rest of the message is an ASCII-art excerpt meant for a
      // terminal, not a hover tooltip.
      message: (message ?? "Syntax error").split("\n")[0],
    },
  };
}

/** Flags `SELECT *` (or `SELECT table.*`) statements with no `FROM` clause
 *  — legal per the grammar (there's nothing stopping `*` from appearing in
 *  a select list on its own), but every engine this app targets rejects it
 *  at execution ("SELECT * with no tables specified is not valid" on
 *  Postgres; SQLite errors identically). `SELECT 1`/`SELECT now()` etc.
 *  without FROM are genuinely valid and untouched — this only ever matches
 *  when an `all_columns` item is actually present. */
function starWithoutFrom(program: CstNode): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const statements = asNodeArray(program.statements);
  for (const stmt of statements) {
    if (stmt.type !== "select_stmt") continue;
    const clauses = asNodeArray(stmt.clauses);
    const selectClause = clauses.find((c) => c.type === "select_clause");
    if (!selectClause) continue;
    const items = asNodeArray(
      (selectClause.columns as CstNode | undefined)?.items,
    );
    const star = items.find((i) => i.type === "all_columns");
    if (!star) continue;
    const hasFrom = clauses.some((c) => c.type === "from_clause");
    if (hasFrom) continue;
    const [from, to] = star.range ?? [0, 0];
    diagnostics.push({
      from,
      to: Math.max(to, from + 1),
      severity: "error",
      message: '"SELECT *" requires a FROM clause',
    });
  }
  return diagnostics;
}

function asNodeArray(value: unknown): CstNode[] {
  return Array.isArray(value) ? (value as CstNode[]) : [];
}

/** `sql-parser-cst`'s `parse()` only exposes structured error locations on
 *  the internal, pre-formatting error it throws before wrapping it into the
 *  `FormattedSyntaxError` it actually surfaces — so this reads the position
 *  back out of the one thing that IS public: the `--> file:line:col` line
 *  in the formatted message it's designed for humans to read. */
function locationFromMessage(
  message: string,
): { line: number; column: number } | null {
  const m = /-->\s*\S*:(\d+):(\d+)/.exec(message);
  if (!m) return null;
  return { line: Number(m[1]), column: Number(m[2]) };
}

function offsetFromLineColumn(sql: string, line: number, column: number) {
  const lines = sql.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the newline this split ate
  }
  return offset + (column - 1);
}
