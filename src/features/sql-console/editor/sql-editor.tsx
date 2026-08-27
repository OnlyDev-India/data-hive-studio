import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { sql as sqlLang, SQLite as SQLiteDialect } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { appEditorExtensions } from "@/features/sql-console/codemirror-theme";
import { cn, statementRanges } from "@/shared/lib/utils";

export interface SqlEditorHandle {
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

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onRunTarget: () => void;
  /** Table names offered as completions. */
  tables?: string[];
  /** Column completions per table. Enables column suggestions after
   * `table.` and in field positions. */
  schema?: Record<string, Completion[]>;
  height?: string;
  showLineNumber?: boolean;
  readOnly?: boolean;
  enableWrapping?: boolean;
  className?: string;
}

/**
 * SQL editor backed by CodeMirror 6 with the SQLite dialect. Its theme is
 * driven by the app's own design tokens (see codemirror-theme.ts), so it stays
 * in sync with light/dark mode. Ctrl+Enter runs the query.
 */
export const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    {
      value,
      onChange,
      onRun,
      onRunTarget,
      tables,
      schema,
      className,
      height = "160px",
      showLineNumber = true,
      readOnly = false,
      enableWrapping = false,
    },
    ref,
  ) {
    const cmsRef = useRef<ReactCodeMirrorRef>(null);
    const runRef = useRef(onRun);
    runRef.current = onRun;
    const runTargetRef = useRef(onRunTarget);
    runTargetRef.current = onRunTarget;

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

    useEffect(() => {
      const down = (e: KeyboardEvent) => {
        if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
        e.preventDefault();
        if (e.shiftKey) runTargetRef.current();
        else runRef.current();
      };
      document.addEventListener("keydown", down);
      return () => document.removeEventListener("keydown", down);
    }, []);

    const extensions = useMemo(() => {
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
        ...(enableWrapping ? [EditorView.lineWrapping] : []),
      ];
    }, [tables, schema, enableWrapping]);

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
          basicSetup={{
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
          }}
          placeholder="SELECT * FROM sqlite_master;"
        />
      </div>
    );
  },
);
