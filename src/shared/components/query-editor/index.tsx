import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
} from "@uiw/react-codemirror";
import { sql as sqlLang, SQLite as SQLiteDialect } from "@codemirror/lang-sql";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorState, Prec } from "@codemirror/state";
import { closeCompletion, startCompletion } from "@codemirror/autocomplete";
import {
  keymap,
  lineNumbers,
  tooltips,
  type ViewUpdate,
} from "@codemirror/view";
import { search, selectNextOccurrence } from "@codemirror/search";
import {
  forEachDiagnostic,
  linter,
  setDiagnostics,
  type Diagnostic,
} from "@codemirror/lint";
import type { Completion } from "@codemirror/autocomplete";
import { appEditorExtensions } from "@/shared/theme/codemirror-theme";
import { useStudioStore } from "@/shared/store";
import { cn, statementRanges } from "@/shared/lib/utils";
import {
  useAppShortcut,
  useShortcuts,
  type Shortcut,
} from "@/shared/hooks/use-shortcut";
import { toCodeMirrorKey } from "@/shared/hooks/shortcut-registry";
import {
  joinLines,
  deleteBlankLines,
  uppercaseSelection,
  lowercaseSelection,
  cycleSelectionNamingStyle,
  pasteAsSqlInCondition,
} from "./editor-text-commands";
import { DelimitedListDialog } from "./delimited-list-dialog";
import { EditorContextMenu } from "./editor-context-menu";
import { EditorSearchBar } from "./editor-search-bar";
import { getTooltipRoot } from "./tooltip-root";
import { schemaCompletions } from "./sql-completions";
import { sqlLinter } from "./sql-lint";
import { nosqlSyntaxLinter } from "./nosql-lint";
import {
  lucideFoldGutter,
  markRunResult,
  statementFrameLayer,
  statementGutter,
} from "./statement-runner";
import { inlineDiagnostics } from "./inline-diagnostics";
import { insertColumnLabels } from "./insert-column-labels";
import {
  NOSQL_SHELL_COMPLETIONS,
  nosqlConsoleCompletions,
} from "./nosql-completions";
import { docHoverTheme, docHoverTooltip, type DocEntry } from "./doc-hover";
import { resolveSqlDoc } from "./sql-docs";
import { sqlSignatureHelp } from "./signature-help";
import { resolveMongoDoc } from "./nosql-docs";
import { DocDetailBody } from "./doc-markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** Tags diagnostics `setErrors` adds so they (and only they) can be swapped
 *  out on the next call without touching the linter's own diagnostics —
 *  see the comment at its use site. */
const RUN_ERROR_SOURCE = "query-run";

/** One statement to run, with its position in the document so a failed run
 *  can be flagged inline via `setErrors`. */
export interface QueryTarget {
  text: string;
  from: number;
  to: number;
}

export interface QueryEditorHandle {
  /** The statement(s) to run: the literal selected text, split on `;`
   *  within the selection so highlighting several full statements runs
   *  each as its own result tab (matching "Run all"), or just the single
   *  statement the cursor is inside when nothing is selected. Empty array
   *  when there's nothing to run. */
  getTargets: () => QueryTarget[];
  /** Flag (or clear, with an empty array) specific ranges as failed —
   *  underlines them and shows the message on hover, independent of
   *  whatever a separate results panel shows. */
  setErrors: (errors: { from: number; to: number; message: string }[]) => void;
  /** Marks a statement's run as finished — `range` set and successful shows
   *  the gutter's checkmark badge on it; `null` clears any existing badge
   *  (e.g. the run errored, or a different statement ran instead). */
  markRunResult: (range: { from: number; to: number } | null) => void;
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
// Rendering into `getTooltipRoot()` (a single shared, named host appended
// to `document.body` — see tooltip-root.ts) sidesteps every ancestor's
// overflow/transform entirely without leaving this editor's own unlabeled
// div as a direct child of <body>.
const editorTooltips = tooltips({ parent: getTooltipRoot() });

// Search STATE + match highlighting only — no `searchKeymap` (disabled in
// `basicSetupConfig` below) and `openSearchPanel` is never called, so the
// library's own default panel never gets created. `EditorSearchBar` is the
// front end instead, driving the exact same `setSearchQuery`/`findNext`/
// `findPrevious` a hand-written panel would use, styled to match the rest
// of the app instead of CodeMirror's stock look.
const editorSearch = search();
const editorSearchMatchTheme = EditorView.baseTheme({
  ".cm-searchMatch": {
    backgroundColor: "var(--warning-light)",
    outline: "1px solid var(--warning)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--warning)",
    color: "var(--warning-foreground)",
  },
});
// The only piece of the library's bundled `searchKeymap` this app still
// wants with `searchKeymap: false` below — everything else in that keymap
// (Mod-f -> openSearchPanel, Mod-g -> findNext, Escape -> closeSearchPanel,
// …) either opens the stock panel this custom bar replaces or has no
// documented binding here. `Mod-d` is the one entry the context menu's "Add
// next occurrence" item already advertises a keyboard shortcut for.
const editorSelectOccurrenceKeymap = keymap.of([
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
]);

// `lineNumbers`/`foldGutter` are always off here — explicit `lineNumbers()`/
// `lucideFoldGutter()` extensions are added instead (after the statement-run
// gutter, in `extensions` below) so gutters render in a fixed left-to-right
// order — run buttons, line numbers, fold markers — instead of basicSetup's
// own fold gutter always landing leftmost. Module-level: a fresh object
// every render would make @uiw/react-codemirror reconfigure (and tear
// down/rebuild, killing any open completion popup) the whole basicSetup
// extension set on every keystroke — same concern as
// `completionDismissKeymap` above.
const basicSetupConfig = {
  lineNumbers: false,
  highlightActiveLineGutter: true,
  highlightActiveLine: true,
  history: true,
  foldGutter: false,
  autocompletion: true,
  closeBrackets: true,
  bracketMatching: true,
  indentOnInput: true,
  // Off — its bundled Mod-f -> openSearchPanel would otherwise fight
  // `EditorSearchBar` for the same key and pop the library's own stock
  // panel on top of it. `editorSearch`/`editorSearchMatchTheme` (added to
  // `extensions` below) plus `editorSelectOccurrenceKeymap` cover the parts
  // of that bundled keymap this app still uses.
  searchKeymap: false,
  tabSize: 2,
};

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
  /** Column completions per table (bare `"table"` keys for the connection's
   * default schema, `"schema.table"` keys for every other known schema).
   * Enables column suggestions after `table.` / `schema.table.` and in
   * field positions. */
  schema?: Record<string, Completion[]>;
  /** Table names per schema — enables the TABLE suggestions offered right
   *  after typing `schema.` (there's no separate schema picker; the query
   *  text itself is what names a non-default schema). */
  schemaTables?: Record<string, string[]>;
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
  disableWrapping?: boolean;
  className?: string;
  placeholder?: string;
  /** Toolbar-driven toggle for the live syntax/unknown-table (or
   *  unknown-collection) linter — off doesn't touch manually-pushed run
   *  errors (`setErrors`), a separate mechanism. Default on. */
  lintEnabled?: boolean;
  /** Draws each INSERT value's column name in front of it (SQL mode only —
   *  purely visual, the statement text is untouched). Toolbar-driven like
   *  `lintEnabled`. Default on, so read-only views get it too. */
  showInsertLabels?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  frameLayer?: boolean;
  autoCompletion?: boolean;
  disableEnter?: boolean;
  disableContextMenu?:boolean;
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
      onKeyDown,
      tables,
      schema,
      schemaTables,
      jsCompletions,
      connId,
      className,
      placeholder,
      language = "sql",
      height = "160px",
      showLineNumber = true,
      readOnly = false,
      disableWrapping = false,
      lintEnabled = true,
      showInsertLabels = true,
      frameLayer = true,
      autoCompletion = true,
      disableEnter = false,
      disableContextMenu=false,
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

    // Memoized (empty deps) for the same reconfigure-on-identity-change
    // reason as `completionDismissKeymap` above — a fresh `keymap.of(...)`
    // every render would force the `extensions` memo below to recompute
    // (and @uiw/react-codemirror to tear down/rebuild the whole extension
    // set) on every keystroke.
    // `Prec.highest` — without it this sits at the same precedence as
    // basicSetup's own bundled keymap (defaultKeymap's `Enter ->
    // insertNewlineAndIndent`), and since that one is spliced into the
    // extensions list BEFORE this component's own `extensions` prop (see
    // @uiw/react-codemirror's `useCodeMirror.js`), it would run FIRST and
    // always win — silently making `disableEnter` a no-op.
    const disableEnterKeymap = useMemo(
      () =>
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: () => true,
            },
          ]),
        ),
      [],
    );

    // User-customizable text-editing commands — implemented as CodeMirror
    // `Command`s (not `useShortcuts`) since they only make sense while the
    // editor itself has focus and need the `EditorView` CodeMirror already
    // hands a `Command`, rather than reaching for `cmsRef.current?.view`
    // from a window-level listener. Applies in both SQL and Mongo-console
    // ("js") mode — generic text editing, not SQL-specific.
    // Editor zoom — a store-backed font size (independent of any per-editor
    // theme extension identity) so Cmd/Ctrl +/-/0 works the same regardless
    // of which tab/mode is focused, and persists across restarts.
    const editorFontSize = useStudioStore((s) => s.editorFontSize);
    const setEditorFontSize = useStudioStore((s) => s.setEditorFontSize);
    const zoomInBinding = useAppShortcut("editor.zoomIn");
    const zoomOutBinding = useAppShortcut("editor.zoomOut");
    const zoomResetBinding = useAppShortcut("editor.zoomReset");
    const zoomIn = () => setEditorFontSize(editorFontSize + 1);
    useShortcuts(
      [
        { ...zoomInBinding, handler: zoomIn },
        // "Zoom in" muscle memory is Cmd-PLUS, typed as Cmd+Shift+= on a US
        // keyboard — on macOS, `.key` doesn't reliably reflect Shift when
        // Cmd is also held (a documented WebKit quirk), so it can arrive as
        // either "=" or "+" with `shiftKey: true`; both are covered here
        // rather than relying on `zoomInBinding.shift` matching exactly.
        { key: "=", mod: true, shift: true, handler: zoomIn },
        { key: "+", mod: true, shift: true, handler: zoomIn },
        {
          ...zoomOutBinding,
          handler: () => setEditorFontSize(editorFontSize - 1),
        },
        { ...zoomResetBinding, handler: () => setEditorFontSize(14) },
      ],
      // Capture phase — some platforms/webviews treat Cmd/Ctrl +/-/0 as a
      // native page-zoom key equivalent; intercepting before that default
      // handling runs (and preventDefault-ing it) stops it from either
      // eating the keystroke or double-applying the zoom.
      { capture: true },
    );
    const fontSizeTheme = useMemo(
      () => EditorView.theme({ "&": { fontSize: `${editorFontSize}px` } }),
      [editorFontSize],
    );

    const joinLinesBinding = useAppShortcut("editor.joinLines");
    const deleteBlankLinesBinding = useAppShortcut("editor.deleteBlankLines");
    const uppercaseBinding = useAppShortcut("editor.uppercaseSelection");
    const lowercaseBinding = useAppShortcut("editor.lowercaseSelection");
    const cycleNamingBinding = useAppShortcut("editor.cycleNamingStyle");
    const pasteAsInBinding = useAppShortcut("editor.pasteAsInCondition");
    // The delimited-list dialog needs a whole dialog, not a synchronous
    // document edit — its keymap entry just captures the current selection
    // (falling back to the whole document when nothing's selected) and
    // opens the dialog; the actual replacement happens on Apply, below.
    const [delimitedListSource, setDelimitedListSource] = useState<{
      from: number;
      to: number;
      text: string;
    } | null>(null);
    const delimitedListBinding = useAppShortcut("editor.delimitedList");
    const openDelimitedList = useCallback(() => {
      const view = cmsRef.current?.view;
      if (!view) return true;
      const { from, to } = view.state.selection.main;
      const range =
        from === to ? { from: 0, to: view.state.doc.length } : { from, to };
      setDelimitedListSource({
        ...range,
        text: view.state.sliceDoc(range.from, range.to),
      });
      return true;
    }, []);
    // `Prec.highest` for the same reason as `disableEnterKeymap` above —
    // e.g. `Mod-Shift-u` would otherwise lose to historyKeymap's own
    // `redoSelection` binding on the same combo (bundled into basicSetup,
    // spliced in ahead of this component's `extensions`).
    const textCommandsKeymap = useMemo(
      () =>
        Prec.highest(
          keymap.of([
            { key: toCodeMirrorKey(joinLinesBinding), run: joinLines },
            {
              key: toCodeMirrorKey(deleteBlankLinesBinding),
              run: deleteBlankLines,
            },
            {
              key: toCodeMirrorKey(uppercaseBinding),
              run: uppercaseSelection,
            },
            {
              key: toCodeMirrorKey(lowercaseBinding),
              run: lowercaseSelection,
            },
            {
              key: toCodeMirrorKey(cycleNamingBinding),
              run: cycleSelectionNamingStyle,
            },
            {
              key: toCodeMirrorKey(pasteAsInBinding),
              run: pasteAsSqlInCondition,
            },
            {
              key: toCodeMirrorKey(delimitedListBinding),
              run: openDelimitedList,
            },
          ]),
        ),
      [
        joinLinesBinding,
        deleteBlankLinesBinding,
        uppercaseBinding,
        lowercaseBinding,
        cycleNamingBinding,
        pasteAsInBinding,
        delimitedListBinding,
        openDelimitedList,
      ],
    );
    const delimitedListSettings = useStudioStore(
      (s) => s.delimitedListSettings,
    );
    const setDelimitedListSettings = useStudioStore(
      (s) => s.setDelimitedListSettings,
    );

    // Memoized for the same reconfigure-on-identity-change reason as
    // `completionDismissKeymap`/`basicSetupConfig` — @uiw/react-codemirror's
    // reconfigure effect also depends on `onUpdate`'s identity.
    const handleViewUpdate = useCallback(
      (vu: ViewUpdate) => {
        if (vu.selectionSet)
          onSelectionChange?.(!vu.state.selection.main.empty);
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
          // Run exactly what's highlighted — not whichever enclosing
          // statement(s) the selection happens to touch. Still split on `;`
          // WITHIN the selection so highlighting several full statements
          // runs each as its own result tab (matching "Run all"), but never
          // reaches past the selection's own edges: expanding out used to
          // mean e.g. the Mongo console (whose commands are commonly typed
          // one-per-line with no `;` between them, so the whole document is
          // one `statementRanges` span) ran the ENTIRE script for a
          // selection of just one line.
          const selected = doc.slice(from, to);
          return statementRanges(selected)
            .map((r) => ({
              text: selected.slice(r.start, r.end),
              from: from + r.start,
              to: from + r.end,
            }))
            .filter((t) => t.text.trim());
        }
        const cursor = from;
        const stmt =
          ranges.find((r) => r.start <= cursor && cursor <= r.end) ??
          ranges[ranges.length - 1];
        return stmt
          ? [
              {
                text: doc.slice(stmt.start, stmt.end),
                from: stmt.start,
                to: stmt.end,
              },
            ]
          : [];
      },
      setErrors: (errors) => {
        const view = cmsRef.current?.view;
        if (!view) return;
        const runtimeDiagnostics: Diagnostic[] = errors.map((e) => ({
          from: e.from,
          to: e.to > e.from ? e.to : e.from + 1,
          severity: "error",
          message: e.message,
          source: RUN_ERROR_SOURCE,
        }));
        // `setDiagnostics` REPLACES the editor's entire diagnostics set —
        // every linter installed on this editor (this one, `errorLinter`)
        // shares the same underlying CodeMirror state field with the
        // syntax/semantic linter (`sqlLinter`/`nosqlSyntaxLinter`) below, so
        // calling it with just the run-error list used to wipe out whatever
        // that linter had already flagged (e.g. a "Missing ;" warning) the
        // instant a query ran, since the doc itself hadn't changed to
        // trigger the linter to recompute and repopulate it. Keeping every
        // OTHER diagnostic already present and only replacing the ones this
        // handle previously added itself (tagged via `source`) preserves
        // that live lint state across a run.
        const kept: Diagnostic[] = [];
        forEachDiagnostic(view.state, (d) => {
          if (d.source !== RUN_ERROR_SOURCE) kept.push(d);
        });
        view.dispatch(
          setDiagnostics(view.state, [...kept, ...runtimeDiagnostics]),
        );
      },
      markRunResult: (range) => {
        const view = cmsRef.current?.view;
        if (!view) return;
        markRunResult(view, range);
      },
    }));

    const runBinding = useAppShortcut("editor.run");
    const runTargetBinding = useAppShortcut("editor.runTarget");
    const saveBinding = useAppShortcut("editor.save");
    const searchBinding = useAppShortcut("editor.search");
    const [searchOpen, setSearchOpen] = useState(false);
    const shortcuts: Shortcut[] = [
      { ...runBinding, handler: onRun },
      { ...runTargetBinding, handler: onRunTarget },
      { ...searchBinding, handler: () => setSearchOpen(true) },
    ];
    if (onSave) shortcuts.push({ ...saveBinding, handler: onSave });
    useShortcuts(shortcuts);

    // Hover-over-a-keyword/method documentation (SQL keywords/functions,
    // Mongo shell methods) — see `doc-hover.ts`. The hover card itself is
    // vanilla DOM (CodeMirror tooltips render outside the React tree); its
    // "View details" button hands the full entry back here to open the
    // popup below.
    const [docDetail, setDocDetail] = useState<DocEntry | null>(null);
    const onOpenDocDetails = useCallback((entry: DocEntry) => {
      setDocDetail(entry);
    }, []);

    // Kept fresh via a bare effect (not a plain render-body assignment —
    // React Compiler's memoization can skip re-running a render body on a
    // commit it decides produced no visible output change, silently
    // stranding the ref on a stale `onRunTarget` closure; an effect always
    // runs on every commit regardless) rather than putting `onRunTarget`
    // itself in `extensions`' deps below: that prop is a fresh closure every
    // render in both callers, and rebuilding `extensions` on every keystroke
    // would tear down/recreate the whole CodeMirror extension set
    // (autocompletion included), killing any open completion popup — see the
    // identical concern on `completionDismissKeymap` above.
    const onRunTargetRef = useRef(onRunTarget);
    useEffect(() => {
      onRunTargetRef.current = onRunTarget;
    });
    const runAtCursor = useCallback(() => onRunTargetRef.current(), []);

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
          // `oneDarkTheme` (background/cursor/selection/gutter colors) +
          // `appEditorTheme` (our completion-icon overrides) +
          // `syntaxHighlighting(oneDarkHighlightStyle)` — the SQL branch
          // below gets all three via this same spread; this branch used to
          // only pull in `appEditorTheme` on its own, which has no
          // background/color rules of its own, so the console rendered in
          // whatever unstyled default CodeMirror falls back to.
          ...appEditorExtensions,
          fontSizeTheme,
          editorSearch,
          editorSearchMatchTheme,
          editorSelectOccurrenceKeymap,
          // JS parsing/highlighting. The raw language keeps CodeMirror's built-in
          // JS keyword completions (`default`, `do`, …) out of the console's
          // suggestion list — the one below is the only completion provider.
          javascriptLanguage,
          // Static list (methods, shell keywords, collection names), plus
          // dot-triggered scoping so `db.` / `db.<collection>.` auto-open
          // the right subset instead of requiring a typed prefix.
          EditorState.languageData.of(() => [{ autocomplete: mongoSource }]),
          // Dismiss the completion popup when the user types space.
          completionDismissKeymap,
          // Manually-pushed inline error markers (see `setErrors`) plus
          // real-time syntax linting as the user types (see `nosql-lint.ts`)
          // — both render through the same underline UI. Read-only views
          // (e.g. the Activity tab showing a past command) never call
          // `setErrors` and have nothing to "type", so the live linter would
          // only ever flag already-run, unchangeable text as an error —
          // skip it there.
          errorLinter,
          ...(readOnly || !lintEnabled
            ? []
            : [linter(nosqlSyntaxLinter(jsCompletions ?? []))]),
          editorTooltips,
          inlineDiagnostics,
          docHoverTooltip(resolveMongoDoc, onOpenDocDetails),
          docHoverTheme,
          // Run-button gutter before the line-number gutter (basicSetup's
          // own `lineNumbers` is disabled below — this is the only one) so
          // it renders to the LEFT of the numbers, not the right: gutters
          // render in extension order, leftmost first.
          ...(readOnly || !showLineNumber
            ? []
            : [statementGutter(runAtCursor)]),
          ...(showLineNumber ? [lineNumbers()] : []),
          ...(readOnly || !showLineNumber ? [] : [lucideFoldGutter()]),
          ...(readOnly || !frameLayer ? [] : [statementFrameLayer()]),
          ...(disableWrapping ? [] : [EditorView.lineWrapping]),
          ...(disableEnter ? [disableEnterKeymap] : []),
          ...(readOnly ? [] : [textCommandsKeymap]),
        ];
      }
      const completions: Completion[] = (tables ?? []).map((t) => ({
        label: t,
        type: "table",
      }));
      // Built once — see the identical comment in the "js" branch above for
      // why this can't be called inside the languageData callback.
      const schemaSource = schemaCompletions(schema ?? {}, schemaTables ?? {});
      return [
        ...appEditorExtensions,
        fontSizeTheme,
        editorSearch,
        editorSearchMatchTheme,
        editorSelectOccurrenceKeymap,
        sqlLang({ dialect: SQLiteDialect, schema, tables: completions }),
        // Register the schema-aware source alongside lang-sql's built-ins.
        EditorState.languageData.of(() => [{ autocomplete: schemaSource }]),
        // Dismiss the completion popup when the user types space.
        completionDismissKeymap,
        // Manually-pushed inline error markers (see `setErrors`) plus
        // real-time syntax + unknown-table/-column linting as the user
        // types (see `sql-lint.ts`) — both render through the same
        // underline UI. Skipped for read-only views (e.g. the Activity tab
        // showing a past command): there's no schema/tables context passed
        // there, so every table/column reference would falsely lint as
        // unknown, and the text can't be edited anyway.
        errorLinter,
        ...(readOnly || !lintEnabled
          ? []
          : [linter(sqlLinter(tables ?? [], schema ?? {}))]),
        editorTooltips,
        inlineDiagnostics,
        ...(showInsertLabels ? [insertColumnLabels(schema ?? {})] : []),
        docHoverTooltip(resolveSqlDoc, onOpenDocDetails),
        docHoverTheme,
        ...(readOnly ? [] : [sqlSignatureHelp()]),
        // Run-button gutter before the line-number gutter (basicSetup's own
        // `lineNumbers` is disabled below) so it renders to the LEFT of the
        // numbers — see the identical comment in the "js" branch above.
        ...(readOnly || !showLineNumber ? [] : [statementGutter(runAtCursor)]),
        ...(showLineNumber ? [lineNumbers()] : []),
        ...(readOnly || !showLineNumber ? [] : [lucideFoldGutter()]),
        ...(readOnly || !frameLayer ? [] : [statementFrameLayer()]),
        ...(disableWrapping ? [] : [EditorView.lineWrapping]),
        ...(disableEnter ? [disableEnterKeymap] : []),
        ...(readOnly ? [] : [textCommandsKeymap]),
      ];
    }, [
      tables,
      schema,
      schemaTables,
      language,
      jsCompletions,
      connId,
      disableWrapping,
      completionDismissKeymap,
      readOnly,
      onOpenDocDetails,
      runAtCursor,
      showLineNumber,
      lintEnabled,
      showInsertLabels,
      frameLayer,
      disableEnter,
      disableEnterKeymap,
      textCommandsKeymap,
      fontSizeTheme,
    ]);

    return (
      <>
        <EditorContextMenu
          getView={() => cmsRef.current?.view ?? null}
          onRun={onRun}
          onRunTarget={onRunTarget}
          onSave={onSave}
          readOnly={readOnly}
          runBinding={runBinding}
          runTargetBinding={runTargetBinding}
          saveBinding={saveBinding}
          joinLinesBinding={joinLinesBinding}
          deleteBlankLinesBinding={deleteBlankLinesBinding}
          uppercaseBinding={uppercaseBinding}
          lowercaseBinding={lowercaseBinding}
          cycleNamingBinding={cycleNamingBinding}
          pasteAsInBinding={pasteAsInBinding}
          delimitedListBinding={delimitedListBinding}
          onOpenDelimitedList={openDelimitedList}
          searchBinding={searchBinding}
          onOpenSearch={() => setSearchOpen(true)}
          disabled={disableContextMenu}
        >
          <div
            className={cn(
              "relative min-h-0 w-full overflow-hidden",
              className,
            )}
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
              basicSetup={{
                ...basicSetupConfig,
                autocompletion: autoCompletion,
              }}
              placeholder={
                placeholder
                  ? placeholder
                  : language === "js"
                    ? 'db.users.find({ "status": "active" }).limit(10)'
                    : "SELECT * FROM sqlite_master;"
              }
              {...(onKeyDown ? { onKeyDown } : {})}
            />
            <EditorSearchBar
              open={searchOpen}
              onOpenChange={setSearchOpen}
              getView={() => cmsRef.current?.view ?? null}
            />
          </div>
        </EditorContextMenu>
        <Dialog
          open={!!docDetail}
          onOpenChange={(open) => {
            if (!open) setDocDetail(null);
          }}
        >
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
            {docDetail && (
              <>
                <DialogHeader>
                  <DialogTitle className="font-mono text-base">
                    {docDetail.signature}
                  </DialogTitle>
                  <DialogDescription>{docDetail.summary}</DialogDescription>
                </DialogHeader>
                <DocDetailBody
                  entry={docDetail}
                  lang={language === "js" ? "js" : "sql"}
                />
              </>
            )}
          </DialogContent>
        </Dialog>
        <DelimitedListDialog
          source={delimitedListSource?.text ?? null}
          settings={delimitedListSettings}
          onSettingsChange={setDelimitedListSettings}
          onApply={(result) => {
            const view = cmsRef.current?.view;
            if (view && delimitedListSource) {
              view.dispatch(
                view.state.update({
                  changes: {
                    from: delimitedListSource.from,
                    to: delimitedListSource.to,
                    insert: result,
                  },
                }),
              );
            }
            setDelimitedListSource(null);
          }}
          onClose={() => setDelimitedListSource(null)}
        />
      </>
    );
  },
);
