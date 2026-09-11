import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { statementRanges } from "@/shared/lib/utils";

/** The `;`-delimited statement containing `pos` — falls back to the last
 * statement so a trailing/partial one (still being typed, no `;` yet) is
 * covered too. Used to scope table/column resolution to the one statement
 * the cursor (or a lint match) is actually in — a multi-statement script
 * would otherwise leak every other statement's tables/aliases into this
 * one's suggestions/checks. */
export function statementAt(doc: string, pos: number): string {
  const ranges = statementRanges(doc);
  const stmt =
    ranges.find((r) => r.start <= pos && pos <= r.end) ??
    ranges[ranges.length - 1];
  return stmt ? doc.slice(stmt.start, stmt.end) : doc;
}

/** Words that may follow a table name in FROM/JOIN but are never an alias. */
const ALIAS_STOP = new Set([
  "where",
  "group",
  "order",
  "limit",
  "offset",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "on",
  "as",
  "set",
  "values",
  "returning",
  "union",
  "all",
  "except",
  "intersect",
  "using",
  "natural",
  "and",
  "or",
  "not",
  "when",
  "then",
  "else",
  "end",
]);

/** Keywords after which a column name is expected. */
const FIELD_KEYWORDS = new Set([
  "select",
  "distinct",
  "where",
  "and",
  "or",
  "on",
  "having",
  "by",
  "not",
  "like",
  "in",
  "between",
  "is",
  "case",
  "when",
  "then",
  "else",
  "exists",
  // UPDATE ... SET <column> = ...
  "set",
]);

// Reserved words the alias group must never swallow — without this, e.g.
// "FROM users JOIN orders" lets the alias group greedily consume "JOIN" as
// users' candidate alias (later discarded via ALIAS_STOP), but the regex
// engine's cursor has already moved past it, so the very next `JOIN orders`
// is skipped entirely and `orders` never gets registered.
const ALIAS_STOP_LOOKAHEAD = new RegExp(
  `(?!(?:${[...ALIAS_STOP].join("|")})\\b)`,
  "i",
).source;

/** Tables (and their aliases) referenced by FROM/JOIN/UPDATE/INSERT INTO
 * clauses, mapped from lowercased alias-or-name to the real table name —
 * schema-qualified (`"schema.table"`) when the reference itself was, so a
 * query naming a non-default schema still gets real column completions for
 * it (see `schemaCompletions`'s own doc comment for why there's no separate
 * schema PICKER: the query text is the only source of truth for which
 * schema a reference means). */
export function referencedTables(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(
    `\\b(?:from|join|update|into)\\s+(?:"?([A-Za-z_][\\w$]*)"?\\.)?"?([A-Za-z_][\\w$]*)"?([ \\t\\r\\n]+(?:as[ \\t\\r\\n]+)?"?${ALIAS_STOP_LOOKAHEAD}([A-Za-z_][\\w$]*)"?)?`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table_schema = m[1];
    const table = m[2];
    let alias: string | undefined = m[4];
    if (alias && ALIAS_STOP.has(alias.toLowerCase())) alias = undefined;
    const qualified = table_schema ? `${table_schema}.${table}` : table;
    out.set((alias ?? table).toLowerCase(), qualified);
    if (!out.has(table.toLowerCase())) out.set(table.toLowerCase(), qualified);
    if (table_schema && !out.has(qualified.toLowerCase()))
      out.set(qualified.toLowerCase(), qualified);
  }
  return out;
}

/** Whether the text before the cursor ends where a column would go (select
 * list, WHERE/ON/HAVING conditions, GROUP/ORDER BY, after commas/operators). */
export function inFieldPosition(before: string): boolean {
  const stripped = before.replace(/[\w$]*$/, "");
  const tokens = stripped.match(/[A-Za-z_]+|[^\sA-Za-z_]/g) ?? [];
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  if (/^[,()=<>!+\-*/%]$/.test(last)) return true;
  return FIELD_KEYWORDS.has(last.toLowerCase());
}

/** Extra completions on top of lang-sql's built-ins: auto-open the columns
 * right after `table.` / `alias.` (the built-in source stays quiet there
 * until Ctrl+Space), the TABLES right after `schema.` (there's no separate
 * schema picker — the query text itself is the only place a non-default
 * schema is named, so hinting has to key off it directly), the columns
 * right after `schema.table.`, and suggest columns of every table
 * referenced in the statement at field positions like the SELECT list or
 * WHERE clause — so columns show up as soon as a table's been named in
 * FROM/JOIN, without having to type `tablename.` again. */
export function schemaCompletions(
  schema: Record<string, Completion[]>,
  schema_tables: Record<string, string[]> = {},
): CompletionSource {
  const byTable = new Map<string, Completion[]>();
  for (const [t, cols] of Object.entries(schema))
    byTable.set(t.toLowerCase(), cols);
  const bySchema = new Map<string, Completion[]>();
  for (const [s, tables] of Object.entries(schema_tables))
    bySchema.set(
      s.toLowerCase(),
      tables.map((t) => ({ label: t, type: "table" })),
    );

  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.state.doc.sliceString(0, ctx.pos);

    // `schema.table.` with nothing typed after the SECOND dot yet — checked
    // first since it's the more specific match (the single-dot pattern
    // below only ever captures the LAST identifier before the LAST dot, so
    // it can't tell "schema.table." apart from "table." on its own).
    const two_dotted = /([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\.(\w*)$/.exec(
      before,
    );
    if (two_dotted) {
      if (two_dotted[3] || ctx.explicit) return null;
      const cols = byTable.get(
        `${two_dotted[1]}.${two_dotted[2]}`.toLowerCase(),
      );
      return cols && cols.length > 0
        ? { from: ctx.pos, options: cols, validFor: /^[\w$]*$/ }
        : null;
    }

    // `schema.` (tables in it) / `table.` / `alias.` (its columns), with
    // nothing typed after the dot yet.
    const dotted = /([A-Za-z_][\w$]*)\.(\w*)$/.exec(before);
    if (dotted) {
      if (dotted[2] || ctx.explicit) return null;
      const name = dotted[1].toLowerCase();
      const tables = bySchema.get(name);
      if (tables && tables.length > 0) {
        return { from: ctx.pos, options: tables, validFor: /^[\w$]*$/ };
      }
      const cols = byTable.get(name);
      return cols && cols.length > 0
        ? { from: ctx.pos, options: cols, validFor: /^[\w$]*$/ }
        : null;
    }

    // Field positions once the statement references at least one known
    // table. Scoped to the statement the cursor is actually in (see
    // `statementAt`), not the whole document.
    if (!inFieldPosition(before)) return null;
    const refs = referencedTables(
      statementAt(ctx.state.doc.toString(), ctx.pos),
    );
    if (refs.size === 0) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const table of refs.values()) {
      for (const c of byTable.get(table.toLowerCase()) ?? []) {
        if (!seen.has(c.label)) {
          seen.add(c.label);
          options.push(c);
        }
      }
    }
    if (options.length === 0) return null;
    const word = /\w*$/.exec(before)?.[0] ?? "";
    return { from: ctx.pos - word.length, options, validFor: /^[\w$]*$/ };
  };
}
