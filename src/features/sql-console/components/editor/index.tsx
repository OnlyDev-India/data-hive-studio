import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { sql as sqlLang, SQLite as SQLiteDialect } from "@codemirror/lang-sql";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import {
  completeFromList,
  closeCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { keymap } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import {
  appEditorExtensions,
  appEditorTheme,
} from "@/shared/theme/codemirror-theme";
import { cn, statementRanges } from "@/shared/lib/utils";
import { useShortcuts, type Shortcut } from "@/shared/hooks/use-shortcut";

export interface QueryEditorHandle {
  /** If text is selected: that selection. Otherwise: the statement around the
   * cursor. Null when there's nothing to run. */
  getTarget: () => string | null;
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
]);

/** JS-specific syntax colours (Mongo console). This is the *only* highlight
 *  style in JS mode (the shared SQL one is swapped out) so its rules for
 *  property/method names can't be shadowed by the SQL foreground rules. */
const jsHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  {
    tag: [t.punctuation, t.paren, t.brace, t.squareBracket],
    color: "var(--muted-foreground)",
  },
  { tag: t.meta, color: "var(--muted-foreground)" },
  { tag: t.operator, color: "var(--foreground)" },
  { tag: t.keyword, color: "var(--info-dark)", fontWeight: "600" },
  { tag: t.modifier, color: "var(--info-dark)", fontWeight: "600" },
  { tag: [t.bool, t.null], color: "var(--warning-dark)" },
  { tag: t.number, color: "var(--warning-dark)" },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: "var(--success-dark)",
  },
  { tag: t.typeName, color: "var(--info-dark)" },
  { tag: [t.standard(t.name), t.special(t.name)], color: "var(--info-dark)" },
  // Method/call chains (`db.users.find(...)`) tinted blue so they read as code.
  {
    tag: [
      t.variableName,
      t.propertyName,
      t.function(t.variableName),
      t.function(t.propertyName),
    ],
    color: "var(--info-dark)",
  },
]);

/** Tables (and their aliases) referenced by FROM/JOIN clauses, mapped from
 * lowercased alias-or-name to the real table name. */
function referencedTables(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const re =
    /\b(?:from|join)\s+"?([A-Za-z_][\w$]*)"?([ \t\r\n]+(?:as[ \t\r\n]+)?"?([A-Za-z_][\w$]*)"?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = m[1];
    let alias: string | undefined = m[3];
    if (alias && ALIAS_STOP.has(alias.toLowerCase())) alias = undefined;
    out.set((alias ?? table).toLowerCase(), table);
    if (!out.has(table.toLowerCase())) out.set(table.toLowerCase(), table);
  }
  return out;
}

/** Whether the text before the cursor ends where a column would go (select
 * list, WHERE/ON/HAVING conditions, GROUP/ORDER BY, after commas/operators). */
function inFieldPosition(before: string): boolean {
  const stripped = before.replace(/[\w$]*$/, "");
  const tokens = stripped.match(/[A-Za-z_]+|[^\sA-Za-z_]/g) ?? [];
  const last = tokens[tokens.length - 1];
  if (!last) return false;
  if (/^[,()=<>!+\-*/%]$/.test(last)) return true;
  return FIELD_KEYWORDS.has(last.toLowerCase());
}

/** Extra completions on top of lang-sql's built-ins: auto-open the columns
 * right after `table.` / `alias.` (the built-in source stays quiet there
 * until Ctrl+Space), and suggest columns of every table referenced in the
 * statement at field positions like the SELECT list or WHERE clause. */
function schemaCompletions(
  schema: Record<string, Completion[]>,
): CompletionSource {
  const byTable = new Map<string, Completion[]>();
  for (const [t, cols] of Object.entries(schema))
    byTable.set(t.toLowerCase(), cols);

  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.state.doc.sliceString(0, ctx.pos);

    // `table.` / `alias.` with nothing typed after the dot yet.
    const dotted = /([A-Za-z_][\w$]*)\.(\w*)$/.exec(before);
    if (dotted) {
      const cols =
        dotted[2] || ctx.explicit ? null : byTable.get(dotted[1].toLowerCase());
      return cols && cols.length > 0
        ? { from: ctx.pos, options: cols, validFor: /^[\w$]*$/ }
        : null;
    }

    // Field positions once the statement references at least one known table.
    if (!inFieldPosition(before)) return null;
    const refs = referencedTables(ctx.state.doc.toString());
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

/** Mongo shell completions for the JS console, offered alongside the
 *  collection names. */
const MONGO_SHELL_COMPLETIONS: Completion[] = [
  { label: "find", type: "method" },
  { label: "findOne", type: "method" },
  { label: "countDocuments", type: "method" },
  { label: "count", type: "method" },
  { label: "distinct", type: "method" },
  { label: "aggregate", type: "method" },
  { label: "insertOne", type: "method" },
  { label: "insertMany", type: "method" },
  { label: "updateOne", type: "method" },
  { label: "updateMany", type: "method" },
  { label: "deleteOne", type: "method" },
  { label: "deleteMany", type: "method" },
  { label: "sort", type: "method" },
  { label: "limit", type: "method" },
  { label: "skip", type: "method" },
  { label: "pretty", type: "method" },
  { label: "use", type: "keyword" },
  { label: "show dbs", type: "keyword" },
  { label: "show collections", type: "keyword" },
];

/** Completions for the Mongo console: right after `db.` this offers
 *  collection names, right after `db.<collection>.` it offers shell methods
 *  — mirroring `schemaCompletions`' auto-open-on-dot behaviour for SQL — and
 *  anything else falls back to prefix-matching the combined list. */
function mongoConsoleCompletions(
  methods: Completion[],
  collections: Completion[],
): CompletionSource {
  const fallback = completeFromList([...methods, ...collections]);
  return (ctx: CompletionContext) => {
    const before = ctx.state.doc.sliceString(0, ctx.pos);
    if (/db\.\w*\.$/.test(before))
      return { from: ctx.pos, options: methods, validFor: /^\w*$/ };
    if (/db\.$/.test(before))
      return { from: ctx.pos, options: collections, validFor: /^\w*$/ };
    return fallback(ctx);
  };
}

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onRunTarget: () => void;
  /** Cmd/Ctrl+S while the editor is focused saves straight to a file — the
   *  same action offered when closing a tab with unsaved queries, just
   *  reachable without closing anything first. */
  onSave?: () => void;
  /** Table names offered as completions. */
  tables?: string[];
  /** Column completions per table. Enables column suggestions after
   * `table.` and in field positions. */
  schema?: Record<string, Completion[]>;
  /** "sql" (SQLite dialect) or "js" (JavaScript highlighting + colors —
   * used by the MongoDB console). */
  language?: "sql" | "js";
  /** Extra completion labels offered in "js" (Mongo console) mode — e.g. the
   *  collection names, suggested after `db.`. */
  jsCompletions?: string[];
  height?: string;
  showLineNumber?: boolean;
  readOnly?: boolean;
  enableWrapping?: boolean;
  className?: string;
}

/**
 * SQL editor backed by CodeMirror 6 with the SQLite dialect. Its theme is
 * driven by the app's own design tokens (see codemirror-theme.ts), so it stays
 * in sync with light/dark mode. Ctrl+Enter runs the query, Ctrl+Shift+Enter
 * runs the selection/statement at the cursor, Ctrl+S saves (see `onSave`).
 * Set `language` to "js" to highlight JavaScript shell commands instead
 * (MongoDB console).
 */
export const QueryEditor = forwardRef<QueryEditorHandle, QueryEditorProps>(
  function QueryEditor(
    {
      value,
      onChange,
      onRun,
      onRunTarget,
      onSave,
      tables,
      schema,
      jsCompletions,
      className,
      language = "sql",
      height = "160px",
      showLineNumber = true,
      readOnly = false,
      enableWrapping = false,
    },
    ref,
  ) {
    const cmsRef = useRef<ReactCodeMirrorRef>(null);

    // Word-breaking characters close a lingering completion popup instead of
    // filtering it. `.` gets its own handler below: it's the member-access
    // trigger (`table.`, `db.`), so instead of just closing it re-opens the
    // popup immediately after inserting the dot.
    const completionDismissKeymap = keymap.of([
      {
        key: " ",
        run: (view) => {
          closeCompletion(view);
          view.dispatch(view.state.replaceSelection(" "));
          return true;
        },
      },
      {
        key: ".",
        run: (view) => {
          closeCompletion(view);
          view.dispatch(view.state.replaceSelection("."));
          startCompletion(view);
          return true;
        },
      },
      {
        key: "(",
        run: (view) => {
          closeCompletion(view);
          view.dispatch(view.state.replaceSelection("("));
          return true;
        },
      },
      {
        key: ",",
        run: (view) => {
          closeCompletion(view);
          view.dispatch(view.state.replaceSelection(","));
          return true;
        },
      },
    ]);

    useImperativeHandle(ref, () => ({
      getTarget: () => {
        const view = cmsRef.current?.view;
        if (!view) return null;
        const { from, to, empty } = view.state.selection.main;
        if (!empty) return view.state.sliceDoc(from, to);
        const cursor = from;
        const doc = view.state.doc.toString();
        const ranges = statementRanges(doc);
        const stmt =
          ranges.find((r) => r.start <= cursor && cursor <= r.end) ??
          ranges[ranges.length - 1];
        return stmt ? doc.slice(stmt.start, stmt.end) : null;
      },
    }));

    const shortcuts: Shortcut[] = [
      { key: "Enter", mod: true, handler: onRun },
      { key: "Enter", mod: true, shift: true, handler: onRunTarget },
    ];
    if (onSave) shortcuts.push({ key: "s", mod: true, handler: onSave });
    useShortcuts(shortcuts);

    const extensions = useMemo(() => {
      if (language === "js") {
        const collectionOptions: Completion[] = (jsCompletions ?? []).map(
          (c) => ({ label: c, type: "property" }),
        );
        return [
          appEditorTheme,
          // JS parsing/highlighting. The raw language keeps CodeMirror's built-in
          // JS keyword completions (`default`, `do`, …) out of the console's
          // suggestion list — the one below is the only completion provider.
          javascriptLanguage,
          syntaxHighlighting(jsHighlightStyle),
          // Static list (methods, shell keywords, collection names), plus
          // dot-triggered scoping so `db.` / `db.<collection>.` auto-open
          // the right subset instead of requiring a typed prefix.
          EditorState.languageData.of(() => [
            {
              autocomplete: mongoConsoleCompletions(
                MONGO_SHELL_COMPLETIONS,
                collectionOptions,
              ),
            },
          ]),
          // Dismiss the completion popup when the user types space.
          completionDismissKeymap,
          ...(enableWrapping ? [EditorView.lineWrapping] : []),
        ];
      }
      const completions: Completion[] = (tables ?? []).map((t) => ({
        label: t,
        type: "table",
      }));
      return [
        ...appEditorExtensions,
        sqlLang({ dialect: SQLiteDialect, schema, tables: completions }),
        // Register the schema-aware source alongside lang-sql's built-ins.
        EditorState.languageData.of(() => [
          { autocomplete: schemaCompletions(schema ?? {}) },
        ]),
        // Dismiss the completion popup when the user types space.
        completionDismissKeymap,
        ...(enableWrapping ? [EditorView.lineWrapping] : []),
      ];
    }, [tables, schema, language, jsCompletions, enableWrapping, completionDismissKeymap]);

    // Memoized: @uiw/react-codemirror reconfigures the WHOLE extension set
    // (tearing down and recreating every basicSetup extension, including
    // autocompletion()) whenever this object's reference changes. Passed
    // inline it would be a new object every render — i.e. on every
    // keystroke, since this is a controlled editor — killing any
    // in-progress/open completion before it could ever show.
    const basicSetupConfig = useMemo(
      () => ({
        lineNumbers: showLineNumber,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        history: true,
        foldGutter: false,
        autocompletion: true,
        closeBrackets: true,
        bracketMatching: true,
        indentOnInput: true,
        searchKeymap: true,
        tabSize: 2,
      }),
      [showLineNumber],
    );

    return (
      <div
        className={cn("min-h-0 w-full overflow-hidden", className)}
        style={{ height }}
      >
        <CodeMirror
          ref={cmsRef}
          value={value}
          onChange={onChange}
          extensions={extensions}
          theme="none"
          style={{ height: "100%" }}
          readOnly={readOnly}
          basicSetup={basicSetupConfig}
          placeholder={
            language === "js"
              ? 'db.users.find({ "status": "active" }).limit(10)'
              : "SELECT * FROM sqlite_master;"
          }
        />
      </div>
    );
  },
);
