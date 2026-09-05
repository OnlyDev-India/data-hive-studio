import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

/** Renders each diagnostic's message inline at the end of its line — like
 *  the VS Code "Error Lens"/Console Ninja style, instead of making the user
 *  hover the underline to find out what's wrong. Purely additive: the
 *  normal underline + hover tooltip from `@codemirror/lint` still work
 *  exactly as before, this just adds a visible summary next to the code. */
class InlineDiagnosticWidget extends WidgetType {
  message: string;
  severity: "error" | "warning" | "info" | "hint";

  constructor(message: string, severity: "error" | "warning" | "info" | "hint") {
    super();
    this.message = message;
    this.severity = severity;
  }

  eq(other: InlineDiagnosticWidget) {
    return other.message === this.message && other.severity === this.severity;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-inline-diagnostic cm-inline-diagnostic-${this.severity}`;
    // First line only — a multi-line message (e.g. a parser's ASCII-art
    // excerpt) would otherwise blow out the line height.
    span.textContent = `  ${this.message.split("\n")[0]}`;
    return span;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const widgets: { pos: number; deco: Decoration }[] = [];
  // At most one inline message per line — several diagnostics stacked at
  // the same spot would be unreadable; the first (highest-priority, since
  // callers push syntax errors before semantic ones) wins.
  const seen_lines = new Set<number>();
  forEachDiagnostic(state, (d, from) => {
    const line = state.doc.lineAt(from);
    if (seen_lines.has(line.number)) return;
    seen_lines.add(line.number);
    widgets.push({
      pos: line.to,
      deco: Decoration.widget({
        widget: new InlineDiagnosticWidget(d.message, d.severity),
        side: 1,
      }),
    });
  });
  widgets.sort((a, b) => a.pos - b.pos);
  return Decoration.set(
    widgets.map(({ pos, deco }) => deco.range(pos)),
  );
}

const inlineDiagnosticsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }
    update(update: ViewUpdate) {
      // Diagnostics change either because the document changed (automatic
      // linters re-run on every edit) or because something dispatched
      // `setDiagnosticsEffect` directly (manual `setErrors` pushes, or the
      // automatic linter's own debounced result — it uses the same effect
      // internally).
      const diagnosticsChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setDiagnosticsEffect)),
      );
      if (update.docChanged || diagnosticsChanged) {
        this.decorations = buildDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const inlineDiagnosticsTheme = EditorView.baseTheme({
  ".cm-inline-diagnostic": {
    opacity: 0.75,
    fontStyle: "italic",
    fontSize: "0.85em",
    pointerEvents: "none",
    whiteSpace: "pre",
  },
  ".cm-inline-diagnostic-error": { color: "var(--destructive)" },
  ".cm-inline-diagnostic-warning": { color: "var(--warning-dark)" },
  ".cm-inline-diagnostic-info": { color: "var(--info-dark)" },
  ".cm-inline-diagnostic-hint": { color: "var(--muted-foreground)" },
});

export const inlineDiagnostics = [
  inlineDiagnosticsPlugin,
  inlineDiagnosticsTheme,
];
