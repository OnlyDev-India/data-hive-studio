import { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  showTooltip,
  tooltips,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree, syntaxHighlighting } from "@codemirror/language";
import { linter } from "@codemirror/lint";
import {
  color,
  oneDarkHighlightStyle,
  oneDarkTheme,
} from "@codemirror/theme-one-dark";
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import { autocompletion, completeFromList } from "@codemirror/autocomplete";
import { appEditorTheme } from "@/shared/theme/codemirror-theme";
import {
  MONGO_BSON_CONSTRUCTORS,
  parseMongoJson,
  type MongoParseError,
} from "@/shared/lib/mongo-json";
import { cn } from "@/shared/lib/utils";
import { inlineDiagnostics } from "../editor/inline-diagnostics";
import { bsonSyntaxLinter } from "./bson-lint";
import { bsonKvFrameLayer } from "./bson-kv-frame";

// CodeMirror parents lint/hover tooltips inside the editor's own DOM by
// default, positioned `fixed` — normally viewport-relative, but a
// `transform` on any ancestor (or, here, the JSON inspector's own
// `overflow-hidden` modal — json-viewer/index.tsx) clips a tooltip that
// would otherwise open outside it. Rendering into `document.body`
// sidesteps that entirely — same fix `editor/index.tsx` already applies
// for the SQL/Mongo console's own lint tooltips.
const editorTooltips = tooltips({ parent: document.body });

// Being a `document.body` child only fixes CLIPPING, not stacking: the
// JSON inspector modal (json-viewer/index.tsx) is itself a `z-100` overlay
// with its own content (e.g. the search bar) painted inside that stacking
// context, so a tooltip with no z-index of its own — a plain later body
// sibling — still renders BEHIND all of it. Comfortably above every z-index
// used anywhere else in the app (highest otherwise is `z-110`).
const tooltipStackingTheme = EditorView.baseTheme({
  ".cm-tooltip": { zIndex: "1000" },
});

const CTR_SET = new Set<string>(MONGO_BSON_CONSTRUCTORS);

// Own classes (not the shared .bson-ctor/.json-key from index.css, which
// json-viewer.tsx's read-only display still uses and stays theme-adaptive).
// The text these marks wrap ALSO gets its own inner span from
// oneDarkHighlightStyle (a key's quotes are still String-tagged) — that
// NESTED span's own explicit color always wins over a plain rule on this
// wrapping class, `!important` or not (inheritance never overrides a
// descendant's own declaration). Targeting `<class> span` too, the same way
// index.css's own .bson-ctor/.json-key rules already do, reaches the
// nested span directly instead of just the wrapper.
const ctorMark = Decoration.mark({ class: "cm-bson-ctor" });
const keyMark = Decoration.mark({ class: "cm-bson-key" });
const bsonMarkTheme = EditorView.baseTheme({
  ".cm-bson-ctor, .cm-bson-ctor span": {
    color: `${color.violet} !important`,
    fontWeight: "650",
  },
  ".cm-bson-key, .cm-bson-key span": { color: `${color.coral} !important` },
});

/** Mark every quoted object key. The `javascript()` grammar parses these
 *  documents as block/sequence expressions (no PropertyName nodes), so the key
 *  nodes would be String-tagged like ordinary string values and painted the
 *  same color. A `"..."` token directly followed by `:` is always a key. */
function markQuotedKeys(doc: string, pending: DecorationRange[]) {
  let i = 0;
  while (i < doc.length) {
    const open = doc.indexOf('"', i);
    if (open === -1) break;
    let close = open + 1;
    let closed = false;
    while (close < doc.length) {
      if (doc[close] === "\\") {
        close += 2;
        continue;
      }
      if (doc[close] === '"') {
        closed = true;
        break;
      }
      close += 1;
    }
    if (!closed) break;
    let after = close + 1;
    while (after < doc.length && (doc[after] === " " || doc[after] === "\t"))
      after += 1;
    if (doc[after] === ":")
      pending.push({ from: open, to: close + 1, mark: keyMark });
    i = close + 1;
  }
}

interface DecorationRange {
  from: number;
  to: number;
  mark: Decoration;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc.toString();

  // Ranges are collected from several passes (key scan, syntax tree) and
  // added in a single sorted pass: RangeSetBuilder demands ranges be
  // supplied with non-decreasing `from` positions. The parse-error span used
  // to be marked here too — now handled by `bsonSyntaxLinter` instead, which
  // gets a real hover message via `@codemirror/lint` instead of a bare
  // always-on underline.
  const pending: DecorationRange[] = [];

  markQuotedKeys(doc, pending);

  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === "CallExpression") {
        const callee = node.node.firstChild;
        if (callee && callee.type.name === "VariableName") {
          const name = doc.slice(callee.from, callee.to);
          if (CTR_SET.has(name)) {
            pending.push({ from: callee.from, to: callee.to, mark: ctorMark });
          }
        }
      }
    },
  });

  pending.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of pending) builder.add(r.from, r.to, r.mark);

  return builder.finish();
}

function bsonDecorator() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet)
          this.decorations = buildDecorations(update.view);
      }
    },
    { decorations: (v: { decorations: DecorationSet }) => v.decorations },
  );
}

// ---- Read-only hint: a small tooltip at the cursor, shown when the user
// tries to type into a read-only editor (instead of silently doing nothing).
function createReadonlyHintDom(): HTMLDivElement {
  const dom = document.createElement("div");
  // Own class so the arrow-color override below (readonlyHintArrowTheme)
  // targets only this tooltip, not every `.cm-tooltip-arrow` in the app —
  // `create()`'s returned `dom` IS the `.cm-tooltip` element CodeMirror
  // appends the arrow into, so a class here is enough to scope it.
  dom.classList.add("dh-readonly-hint");
  dom.textContent = "Read-only — click the pencil to edit";
  dom.style.cssText =
    "padding:4px 8px;border-radius:6px;font-size:11px;" +
    "background:var(--warning-light);color:var(--warning-dark);" +
    "border:1px solid var(--warning);white-space:nowrap;";
  return dom;
}

/** CodeMirror's own tooltip arrow is hardcoded to the base theme's tooltip
 *  colors (`#f5f5f5` fill / `#bbb` border) — it has no idea this tooltip
 *  uses the warning palette instead, so left alone the arrow tip shows as a
 *  mismatched white sliver. Overridden here to match `createReadonlyHintDom`'s
 *  own background/border exactly. */
const readonlyHintArrowTheme = EditorView.baseTheme({
  ".dh-readonly-hint.cm-tooltip-above .cm-tooltip-arrow": {
    "&:before": { borderTopColor: "var(--warning)" },
    "&:after": { borderTopColor: "var(--warning-light)" },
  },
  ".dh-readonly-hint.cm-tooltip-below .cm-tooltip-arrow": {
    "&:before": { borderBottomColor: "var(--warning)" },
    "&:after": { borderBottomColor: "var(--warning-light)" },
  },
});

const setReadonlyHint = StateEffect.define<number | null>();

const readonlyHintField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setReadonlyHint)) {
        if (e.value === null) return null;
        return {
          pos: e.value,
          above: true,
          arrow: true,
          create: () => ({ dom: createReadonlyHintDom() }),
        };
      }
    }
    if (value && tr.docChanged) return null;
    return value;
  },
  provide: (f) => showTooltip.from(f),
});

/** Printable/edit keys only — arrow keys, copy/paste, Escape, etc. should
 *  navigate or act normally without triggering the read-only warning. */
function isEditAttempt(e: KeyboardEvent): boolean {
  // Backspace/Delete/Enter are edit attempts even with a modifier held —
  // Cmd+Backspace (delete line) and Option+Backspace/Delete (delete word)
  // are standard Mac editing shortcuts that still modify the document, so
  // they must trigger the read-only warning too.
  if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
    return true;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1;
}

function readonlyHint(readOnly: boolean, onReadonlyClick?: () => void) {
  let hideTimer: number | null = null;
  return [
    readonlyHintField,
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (!readOnly || !isEditAttempt(event)) return false;
        const pos = view.state.selection.main.head;
        view.dispatch({ effects: setReadonlyHint.of(pos) });
        onReadonlyClick?.();
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          view.dispatch({ effects: setReadonlyHint.of(null) });
        }, 1600);
        return false;
      },
      blur(_event, view) {
        view.dispatch({ effects: setReadonlyHint.of(null) });
        return false;
      },
    }),
  ];
}

export function BsonEditor({
  value,
  onChange,
  compact = false,
  minHeight = "200px",
  readOnly = false,
  foldable = false,
  constructorsOnly = false,
  className,
  onCreateEditor,
  onBlur,
  onReadonlyClick,
  extraExtensions,
}: {
  value: string;
  onChange: (value: string, error: MongoParseError | null) => void;
  compact?: boolean;
  minHeight?: string;
  /** Disable editing while keeping the editor navigable (row is read-only). */
  readOnly?: boolean;
  /** Called when the user tries to type inside the editor while it is read-only (the warning prompt). */
  onReadonlyClick?: () => void;
  /** Show the fold gutter so object/array blocks can be collapsed. */
  foldable?: boolean;
  /** Restrict autocomplete to BSON constructor calls (ObjectId, ISODate, …)
   *  only — no property/keyword/word suggestions from the JS grammar. */
  constructorsOnly?: boolean;
  /** Merge into the wrapper's classes (layout fill, border tweaks, …). */
  className?: string;
  onCreateEditor?: (view: EditorView) => void;
  onBlur?: () => void;
  extraExtensions?: Extension[];
}) {
  const onBlurRef = useRef(onBlur);
  useEffect(() => {
    onBlurRef.current = onBlur;
  });

  // Constructor-name completions serve both modes: in the default mode they
  // ride the JS language's autocomplete; in `constructorsOnly` mode they are
  // the ONLY source (the override replaces every other contribution).
  const constructorCompletions = useMemo(
    () =>
      completeFromList(
        MONGO_BSON_CONSTRUCTORS.map((c) => ({
          label: c,
          type: "type",
          detail: "BSON type",
        })),
      ),
    [],
  );

  const extensions = useMemo(
    () => {
      return [
        oneDarkTheme,
        appEditorTheme,
        syntaxHighlighting(oneDarkHighlightStyle),
        javascript(),
        bsonMarkTheme,
        bsonDecorator(),
        ...(readOnly ? [] : [bsonKvFrameLayer()]),
        constructorsOnly
          ? autocompletion({ override: [constructorCompletions] })
          : EditorState.languageData.of(() => [
              { autocomplete: constructorCompletions },
            ]),
        readonlyHint(readOnly, onReadonlyClick),
        readonlyHintArrowTheme,
        // Unconditional, unlike the linter below: the read-only hint tooltip
        // ONLY ever shows when `readOnly` is true, so gating this the same
        // way as the linter left it with none of the anti-clip/anti-stacking
        // fixes below applied to the one tooltip that needed them most.
        editorTooltips,
        tooltipStackingTheme,
        // Real-time syntax linting (see bson-lint.ts) — skipped read-only,
        // same reasoning as the SQL/Mongo console editor: nothing to type,
        // nothing to fix, so it'd only ever flag already-saved, unchangeable
        // content as an error.
        ...(readOnly ? [] : [linter(bsonSyntaxLinter()), inlineDiagnostics]),
        ...(extraExtensions ?? []),
      ];
    },
    // The component-level extensions supercede whatever the host passes in;
    // extraExtensions is memoized by the host so reconfiguration stays cheap.
    [
      extraExtensions,
      constructorsOnly,
      constructorCompletions,
      readOnly,
      onReadonlyClick,
    ],
  );

  // Memoized: @uiw/react-codemirror reconfigures the WHOLE extension set
  // (tearing down and recreating every basicSetup extension, including
  // autocompletion()) whenever `basicSetup` or `onChange` change identity —
  // both are in its reconfigure effect's deps. Passed inline they'd be new
  // every render, i.e. on every keystroke, killing any in-progress/open
  // completion before it could ever show.
  const handleChange = useCallback(
    (v: string) => {
      const { error } = parseMongoJson(v);
      onChange(v, error);
    },
    [onChange],
  );
  const basicSetupConfig = useMemo(
    () => ({
      lineNumbers: true,
      highlightActiveLineGutter: true,
      highlightActiveLine: true,
      history: true,
      foldGutter: foldable,
      autocompletion: !constructorsOnly,
      closeBrackets: true,
      bracketMatching: true,
      indentOnInput: true,
      tabSize: 2,
    }),
    [foldable, constructorsOnly],
  );

  return (
    <div
      className={cn(
        "bg-background overflow-hidden rounded-md border",
        compact && "text-xs",
        className,
      )}
      style={{ minHeight }}
      onBlur={() => onBlurRef.current?.()}
    >
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        theme="none"
        style={{ height: "100%" }}
        readOnly={readOnly}
        onCreateEditor={onCreateEditor}
        basicSetup={basicSetupConfig}
      />
    </div>
  );
}
