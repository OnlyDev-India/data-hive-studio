import { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import {
  syntaxTree,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
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

const CTR_SET = new Set<string>(MONGO_BSON_CONSTRUCTORS);

// ---- Syntax colours (mirror the app theme's semantic tokens). -------------
const bsonHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.punctuation, t.paren, t.brace, t.squareBracket], color: "var(--muted-foreground)" },
  { tag: t.operator, color: "var(--foreground)" },
  { tag: t.keyword, color: "var(--info-dark)", fontWeight: "600" },
  { tag: [t.bool, t.null], color: "var(--warning-dark)" },
  { tag: t.number, color: "var(--warning-dark)" },
  { tag: [t.string, t.special(t.string)], color: "var(--success-dark)" },
  {
    tag: [t.propertyName, t.variableName, t.standard(t.name), t.special(t.name)],
    color: "var(--foreground)",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "var(--bson-ctor)",
  },
]);

const ctorMark = Decoration.mark({ class: "bson-ctor" });
const keyMark = Decoration.mark({ class: "json-key" });
const errorMark = Decoration.mark({ class: "cm-mongo-error" });

/** Mark every quoted object key. The `javascript()` grammar parses these
 *  documents as block/sequence expressions (no PropertyName nodes), so the key
 *  nodes would be String-tagged like ordinary string values and painted the
 *  same color. A `"..."` token directly followed by `:` is always a key. */
function markQuotedKeys(
  doc: string,
  pending: DecorationRange[],
) {
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
    if (doc[after] === ":") pending.push({ from: open, to: close + 1, mark: keyMark });
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

  // Ranges are collected from several passes (key scan, syntax tree, parse
  // error) and added in a single sorted pass: RangeSetBuilder demands ranges
  // be supplied with non-decreasing `from` positions.
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

  const { error } = parseMongoJson(doc);
  if (error) {
    const from = Math.min(error.offset, doc.length);
    let to = doc.indexOf("\n", from);
    if (to === -1) to = doc.length;
    if (to <= from) to = Math.min(doc.length, from + 1);
    pending.push({ from, to, mark: errorMark });
  }

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
          strictSide: true,
          arrow: true,
          create: () => {
            const dom = document.createElement("div");
            dom.textContent = "Read-only — click the pencil to edit";
            dom.style.cssText =
              "padding:4px 8px;border-radius:6px;font-size:11px;" +
              "background:var(--warning-light);color:var(--warning-dark);" +
              "border:1px solid var(--warning);white-space:nowrap;";
            return { dom };
          },
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
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length === 1) return true;
  return e.key === "Backspace" || e.key === "Delete" || e.key === "Enter";
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
        appEditorTheme,
        javascript(),
        syntaxHighlighting(bsonHighlightStyle),
        bsonDecorator(),
        (constructorsOnly
          ? autocompletion({ override: [constructorCompletions] })
          : EditorState.languageData.of(() => [
              { autocomplete: constructorCompletions },
            ])),
        readonlyHint(readOnly, onReadonlyClick),
        ...(extraExtensions ?? []),
      ];
    },
    // The component-level extensions supercede whatever the host passes in;
    // extraExtensions is memoized by the host so reconfiguration stays cheap.
    [extraExtensions, constructorsOnly, constructorCompletions, readOnly, onReadonlyClick],
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
        "overflow-hidden rounded-md border bg-background",
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
