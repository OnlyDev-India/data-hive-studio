import { EditorView } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  oneDarkHighlightStyle,
  oneDarkTheme,
} from "@codemirror/theme-one-dark";
import { useIsDark } from "./theme";
import "./editor-theme.css";

// Light has no maintained One Light package for CodeMirror 6, so it uses
// CodeMirror's own light defaults.
const darkHighlight = syntaxHighlighting(oneDarkHighlightStyle);
const lightHighlight = syntaxHighlighting(defaultHighlightStyle);
const darkBase: Extension = [oneDarkTheme, darkHighlight];
const lightBase: Extension = [lightHighlight];

/** Base theme for the app's light or dark mode, for an editor's `theme` prop. */
export function useEditorTheme(): Extension {
  return useIsDark() ? darkBase : lightBase;
}

/** Syntax colors only, for editors that keep their own surface. */
export function useEditorHighlight(): Extension {
  return useIsDark() ? darkHighlight : lightHighlight;
}

// App overrides on top of either base. Colors are tokens, so they flip with
// the `.dark` class and need no swap.
const appEditorRules = EditorView.theme({
  "&": {
    fontSize: "var(--text-body)",
    height: "100%",
    backgroundColor: "var(--editor-background)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--editor-background)",
    border: "none",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)",
    },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.5",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0.4em 0 0.5em",
  },
  ".cm-tooltip": {
    borderRadius: "var(--radius-surface)",
  },

  // Completion dropdown: tint each option by its kind so the list reads like
  // highlighted code (keywords blue, columns amber, tables green) instead of
  // a wall of plain foreground text.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-body)",
  },
  ".cm-completionIcon": {
    opacity: 1,
  },
  // A neutral row, so the kind colored labels below stay readable on it.
  "& .cm-tooltip-autocomplete ul li[aria-selected]": {
    background: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-completionIcon-keyword": {
    color: "var(--syntax-keyword)",
  },
  ".cm-completionIcon-property": {
    color: "var(--syntax-property)",
    // Override the library default (a plain hollow box, "□") with a filled
    // diamond so field/column suggestions read as a distinct icon rather
    // than an empty placeholder box.
    "&::after": { content: "'◆'" },
  },
  ".cm-completionIcon-table": {
    color: "var(--syntax-type)",
    "&::after": { content: "'▣'" },
  },
  ".cm-completionIcon-type": {
    color: "var(--syntax-type)",
  },
  ".cm-completionIcon-variable": {
    color: "var(--syntax-keyword)",
  },
  ".cm-completionIcon-constant": {
    color: "var(--syntax-property)",
  },
  ".cm-completionIcon-function, .cm-completionIcon-method": {
    color: "var(--syntax-keyword)",
  },
  // Saved library items (src/shared/library/completions.ts).
  ".cm-completionIcon-library-snippet": {
    color: "var(--syntax-library)",
    "&::after": { content: "'✂'" },
  },
  ".cm-completionIcon-library-query": {
    color: "var(--syntax-library)",
    "&::after": { content: "'★'" },
  },
  ".cm-library-preview": {
    margin: "0",
    fontFamily: "var(--font-mono)",
    whiteSpace: "pre-wrap",
    maxWidth: "28rem",
  },
  "li .cm-completionIcon-keyword ~ .cm-completionLabel": {
    color: "var(--syntax-keyword)",
  },
  "li .cm-completionIcon-property ~ .cm-completionLabel": {
    color: "var(--syntax-property)",
  },
  "li .cm-completionIcon-table ~ .cm-completionLabel": {
    color: "var(--syntax-type)",
  },
  "li .cm-completionIcon-type ~ .cm-completionLabel": {
    color: "var(--syntax-type)",
  },
  ".cm-completionMatchedText": {
    textDecoration: "underline",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--syntax-muted)",
    fontStyle: "italic",
  },
  ".cm-nonmatchingBracket": {
    color: "var(--syntax-invalid)",
  },

  // Per-statement run buttons (statement-runner.ts) + the active-statement
  // frame it draws around the statement under the cursor. Both are app
  // chrome, not syntax, so they use the app's light/dark-flipping success
  // token.
  ".cm-statement-gutter": {
    width: "1.8em",
  },
  ".cm-statement-run": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    padding: 0,
    border: "none",
    cursor: "pointer",
    position: "relative",
    opacity: 0.55,
    marginLeft: "2px",
  },
  ".cm-statement-run:hover": {
    opacity: 1,
    color: "var(--success)",
  },
  ".cm-statement-run--success": {
    color: "var(--success)",
    opacity: 1,
  },
  ".cm-statement-run--error": {
    color: "var(--success)",
    opacity: 1,
  },
  ".cm-statement-run--error .cm-statement-run-badge": {
    background: "var(--destructive)",
    color: "white",
  },
  ".cm-statement-run-badge": {
    position: "absolute",
    bottom: "-2px",
    right: "-2px",
    width: "8px",
    height: "8px",
    borderRadius: "9999px",
    background: "var(--success)",
    color: "var(--background)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // Fold gutter (statement-runner.ts's `lucideFoldGutter`) — same chevron
  // rotated 90° open/closed as the sidebar's tree-toggle rows, not two
  // different glyphs.
  ".cm-foldGutter": {
    width: "1.2em",
  },
  ".cm-fold-marker": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    opacity: 0.55,
    cursor: "pointer",
  },
  ".cm-fold-marker:hover": {
    opacity: 1,
  },
  ".cm-fold-marker--open svg": {
    transform: "rotate(90deg)",
  },
  ".cm-statement-frame-layer .cm-statement-frame": {
    border: "0.5px solid var(--success)",
    borderRadius: "var(--radius-surface)",
    pointerEvents: "none",
  },
});

export const appEditorTheme = Prec.high(appEditorRules);
