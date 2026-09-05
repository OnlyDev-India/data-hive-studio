import {
  forwardRef,
  useCallback,
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
import { closeCompletion, startCompletion } from "@codemirror/autocomplete";
import { keymap, tooltips, type ViewUpdate } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import type { Completion } from "@codemirror/autocomplete";
import {
  appEditorExtensions,
  appEditorTheme,
} from "@/shared/theme/codemirror-theme";
import { cn, statementRanges } from "@/shared/lib/utils";
import { useShortcuts, type Shortcut } from "@/shared/hooks/use-shortcut";
import { schemaCompletions } from "./sql-completions";
import { sqlLinter } from "./sql-lint";
import { nosqlSyntaxLinter } from "./nosql-lint";
import { inlineDiagnostics } from "./inline-diagnostics";
import {
  NOSQL_SHELL_COMPLETIONS,
  nosqlConsoleCompletions,
} from "./nosql-completions";

/** One statement to run, with its position in the document so a failed run
 *  can be flagged inline via `setErrors`. */
export interface QueryTarget {
  text: string;
  from: number;
  to: number;
}

export interface QueryEditorHandle {
  /** The statement(s) to run: every `;`-delimited statement the current
   *  selection touches (so selecting several statements runs each as its
   *  own result tab, matching "Run all"), or just the single statement the
   *  cursor is inside when nothing is selected. Empty array when there's
   *  nothing to run. */
  getTargets: () => QueryTarget[];
  /** Flag (or clear, with an empty array) specific ranges as failed —
   *  underlines them and shows the message on hover, independent of
   *  whatever a separate results panel shows. */
  setErrors: (errors: { from: number; to: number; message: string }[]) => void;
}

// `linter(null)` installs the diagnostics state field/underline rendering
// without any automatic (re-)computation — diagnostics are only ever pushed
// manually via `setErrors`. Module-level and shared across every editor
// instance since neither extension holds per-instance state.
const errorLinter = linter(null);

// CodeMirror parents lint/hover tooltips inside the editor's own DOM by
// default, positioned `fixed` — normally viewport-relative, but a
// `transform` on any ancestor (framer-motion's animated panels apply one)
// makes `fixed` relative to THAT ancestor instead, so a tooltip that has to
// open above a diagnostic on line 1 (there's no room within the editor to
// open above it there) ends up clipped by this editor's own
// `overflow-hidden` wrapper below instead of floating freely over the page.
// Rendering into `document.body` sidesteps every ancestor's
// overflow/transform entirely.
const editorTooltips = tooltips({ parent: document.body });

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

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onRunTarget: () => void;
  /** Fires whenever the selection goes from empty to non-empty or back —
   *  lets the caller phrase "Run selection" vs. "Run query at cursor"
   *  correctly instead of always saying "selection" even when there isn't
   *  one. */
  onSelectionChange?: (hasSelection: boolean) => void;
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
  /** Connection id — "js" mode uses this to fetch (and cache) per-collection
   *  field names for suggestions inside a query body. Required for those
   *  suggestions; everything else in "js" mode works without it. */
  connId?: string;
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
      onSelectionChange,
      onSave,
      tables,
      schema,
      jsCompletions,
      connId,
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
    // Memoized (empty deps — the handlers only close over `view`, never
    // component state) for the same reason as `basicSetupConfig` below: this
    // is a dependency of the `extensions` memo, and this is a controlled
    // editor that re-renders on every keystroke. An unmemoized `keymap.of(...)`
    // here would get a new identity every render, forcing `extensions` to
    // recompute and @uiw/react-codemirror to tear down and rebuild the whole
    // extension set (autocompletion() included) on every keystroke — killing
    // any completion popup before it could ever paint.
    const completionDismissKeymap = useMemo(
      () =>
        keymap.of([
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
              // Close the popup but DON'T insert "(" ourselves (unlike the
              // other handlers here) — dispatching it manually bypasses the
              // browser's normal input pipeline, which is exactly where
              // closeBrackets() hooks in (an EditorView.inputHandler, not a
              // keymap binding). Returning false instead lets that default
              // pipeline run, so "(" still gets auto-paired with ")".
              closeCompletion(view);
              return false;
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
        ]),
      [],
    );

    // Memoized for the same reconfigure-on-identity-change reason as
    // `completionDismissKeymap`/`basicSetupConfig` — @uiw/react-codemirror's
    // reconfigure effect also depends on `onUpdate`'s identity.
    const handleViewUpdate = useCallback(
      (vu: ViewUpdate) => {
        if (vu.selectionSet) onSelectionChange?.(!vu.state.selection.main.empty);
      },
      [onSelectionChange],
    );

    useImperativeHandle(ref, () => ({
      getTargets: () => {
        const view = cmsRef.current?.view;
        if (!view) return [];
        const { from, to, empty } = view.state.selection.main;
        const doc = view.state.doc.toString();
        const ranges = statementRanges(doc);
        if (!empty) {
          // Every statement the selection touches (even partially) runs in
          // full — so selecting several statements runs each as its own
          // result tab, matching "Run all", instead of firing the whole
          // selected blob as one (likely invalid) combined statement.
          return ranges
            .filter((r) => r.start < to && r.end > from)
            .map((r) => ({
              text: doc.slice(r.start, r.end),
              from: r.start,
              to: r.end,
            }));
        }
        const cursor = from;
        const stmt =
          ranges.find((r) => r.start <= cursor && cursor <= r.end) ??
          ranges[ranges.length - 1];
        return stmt
          ? [{ text: doc.slice(stmt.start, stmt.end), from: stmt.start, to: stmt.end }]
          : [];
      },
      setErrors: (errors) => {
        const view = cmsRef.current?.view;
        if (!view) return;
        const diagnostics: Diagnostic[] = errors.map((e) => ({
          from: e.from,
          to: e.to > e.from ? e.to : e.from + 1,
          severity: "error",
          message: e.message,
        }));
        view.dispatch(setDiagnostics(view.state, diagnostics));
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
        // Built ONCE per `extensions` recompute — NOT inside the
        // languageData callback below. CodeMirror recomputes that facet on
        // every transaction (every keystroke), so a factory call inside it
        // would hand back a brand-new closure each time; CodeMirror tracks
        // in-flight completion requests by source-function IDENTITY, so a
        // constantly-changing identity means a request can never be
        // recognized as "still the same source" once it resolves — it just
        // restarts forever and nothing ever shows.
        const mongoSource = nosqlConsoleCompletions(
          connId ?? "",
          NOSQL_SHELL_COMPLETIONS,
          collectionOptions,
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
          EditorState.languageData.of(() => [{ autocomplete: mongoSource }]),
          // Dismiss the completion popup when the user types space.
          completionDismissKeymap,
          // Manually-pushed inline error markers (see `setErrors`) plus
          // real-time syntax linting as the user types (see `nosql-lint.ts`)
          // — both render through the same underline UI.
          errorLinter,
          linter(nosqlSyntaxLinter(jsCompletions ?? [])),
          editorTooltips,
          inlineDiagnostics,
          ...(enableWrapping ? [EditorView.lineWrapping] : []),
        ];
      }
      const completions: Completion[] = (tables ?? []).map((t) => ({
        label: t,
        type: "table",
      }));
      // Built once — see the identical comment in the "js" branch above for
      // why this can't be called inside the languageData callback.
      const schemaSource = schemaCompletions(schema ?? {});
      return [
        ...appEditorExtensions,
        sqlLang({ dialect: SQLiteDialect, schema, tables: completions }),
        // Register the schema-aware source alongside lang-sql's built-ins.
        EditorState.languageData.of(() => [{ autocomplete: schemaSource }]),
        // Dismiss the completion popup when the user types space.
        completionDismissKeymap,
        // Manually-pushed inline error markers (see `setErrors`) plus
        // real-time syntax + unknown-table/-column linting as the user
        // types (see `sql-lint.ts`) — both render through the same
        // underline UI.
        errorLinter,
        linter(sqlLinter(tables ?? [], schema ?? {})),
        editorTooltips,
        inlineDiagnostics,
        ...(enableWrapping ? [EditorView.lineWrapping] : []),
      ];
    }, [
      tables,
      schema,
      language,
      jsCompletions,
      connId,
      enableWrapping,
      completionDismissKeymap,
    ]);

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
          onUpdate={handleViewUpdate}
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
