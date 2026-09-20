import type { Completion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { parse as parseSql } from "sql-parser-cst";
import { DIALECTS, asNodeArray, type CstNode } from "./sql-lint";

/** Draws each INSERT value's column name right before the value — a
 *  reading aid for long `INSERT INTO t (a, b, …) VALUES (…, …, …)`
 *  statements, where a value's column is otherwise only known by counting
 *  position back up to the column list. Purely visual: widgets are
 *  decorations, so they never touch `EditorState.doc` and what runs is
 *  byte-identical to what's typed. */
export interface InsertLabel {
  /** Document offset of the value the label sits in front of. */
  pos: number;
  name: string;
}

function parseDoc(doc: string): CstNode | null {
  // Same dialect fallback as `sql-lint.ts`: the editor doesn't know which
  // engine it's pointed at, so a statement is labeled if EITHER accepts it.
  for (const dialect of DIALECTS) {
    try {
      return parseSql(doc, {
        dialect,
        includeRange: true,
      }) as unknown as CstNode;
    } catch {
      // try the next dialect
    }
  }
  return null;
}

function identifierName(node: unknown): string | null {
  const n = node as CstNode | undefined;
  return n?.type === "identifier" && typeof n.name === "string" ? n.name : null;
}

/** `table` for a bare reference, `schema.table` for a qualified one — the
 *  same key shapes the `schema` prop uses. Anything else (a three part
 *  name, an expression) has no lookup key, so it goes unlabeled. */
function tableKey(table: unknown): string | null {
  const n = table as CstNode | undefined;
  if (!n) return null;
  const bare = identifierName(n);
  if (bare) return bare;
  if (n.type !== "member_expr") return null;
  const schema = identifierName(n.object);
  const name = identifierName(n.property);
  return schema && name ? `${schema}.${name}` : null;
}

function listItems(node: unknown): CstNode[] {
  const inner = (node as CstNode | undefined)?.expr as CstNode | undefined;
  return inner?.type === "list_expr" ? asNodeArray(inner.items) : [];
}

/** One label per value of every VALUES tuple in every INSERT statement of
 *  `doc`. Empty when the document doesn't parse — a half typed statement
 *  gets no labels rather than stale or guessed ones. A tuple is only
 *  labeled up to `min(column count, value count)`, so a count mismatch
 *  never pins a value to the wrong column. */
export function insertLabels(
  doc: string,
  columns_by_table: ReadonlyMap<string, string[]>,
): InsertLabel[] {
  // Cheap gate: most edits happen in documents with no INSERT at all, and
  // this runs on every keystroke, so skip the full parse for those.
  if (!/\binsert\b/i.test(doc)) return [];
  const program = parseDoc(doc);
  if (!program) return [];

  const labels: InsertLabel[] = [];
  for (const stmt of asNodeArray(program.statements)) {
    if (stmt.type !== "insert_stmt") continue;
    const clauses = asNodeArray(stmt.clauses);
    const insert = clauses.find((c) => c.type === "insert_clause");
    const values = clauses.find((c) => c.type === "values_clause");
    if (!insert || !values) continue; // DEFAULT VALUES / INSERT … SELECT

    let names: (string | null)[];
    if (insert.columns) {
      names = listItems(insert.columns).map(identifierName);
    } else {
      const key = tableKey(insert.table);
      const known = key ? columns_by_table.get(key.toLowerCase()) : undefined;
      if (!known) continue; // unknown table: leave it unlabeled, not guessed
      names = known;
    }

    const tuples = asNodeArray((values.values as CstNode | undefined)?.items);
    for (const tuple of tuples) {
      const items = listItems(tuple);
      const count = Math.min(names.length, items.length);
      for (let i = 0; i < count; i++) {
        const name = names[i];
        const from = items[i].range?.[0];
        if (name === null || from === undefined) continue;
        labels.push({ pos: from, name });
      }
    }
  }
  return labels;
}

class InsertColumnLabelWidget extends WidgetType {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  eq(other: InsertColumnLabelWidget) {
    return other.name === this.name;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-insert-column-label";
    span.textContent = this.name;
    // Decorative: the label is not part of the document, so it stays out of
    // the accessibility tree rather than reading as extra statement text.
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(
  doc: string,
  columns_by_table: ReadonlyMap<string, string[]>,
): DecorationSet {
  try {
    return Decoration.set(
      insertLabels(doc, columns_by_table).map(({ pos, name }) =>
        Decoration.widget({
          widget: new InsertColumnLabelWidget(name),
          side: -1,
        }).range(pos),
      ),
      true,
    );
  } catch {
    // A label is a nicety; whatever went wrong, the editor keeps working.
    return Decoration.none;
  }
}

const insertColumnLabelsTheme = EditorView.baseTheme({
  ".cm-insert-column-label": {
    display: "inline",
    marginRight: "0.35em",
    padding: "0 0.35em",
    borderRadius: "0.25em",
    fontSize: "0.8em",
    fontStyle: "italic",
    whiteSpace: "nowrap",
    color: "var(--muted-foreground)",
    backgroundColor:
      "color-mix(in srgb, var(--muted-foreground) 15%, transparent)",
    userSelect: "none",
    pointerEvents: "none",
  },
});

/** `schema` is the editor's existing table → column completions map (bare
 *  `table` keys for the default schema, `schema.table` for the rest); it
 *  only supplies column order for an INSERT with no explicit column list. */
export function insertColumnLabels(
  schema: Record<string, Completion[]>,
): Extension {
  const columns_by_table = new Map<string, string[]>();
  for (const [table, cols] of Object.entries(schema)) {
    columns_by_table.set(
      table.toLowerCase(),
      cols.map((c) => c.label),
    );
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(
          view.state.doc.toString(),
          columns_by_table,
        );
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildDecorations(
            update.state.doc.toString(),
            columns_by_table,
          );
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [plugin, insertColumnLabelsTheme];
}
