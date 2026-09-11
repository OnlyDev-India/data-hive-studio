import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import {
  color,
  oneDarkHighlightStyle,
  oneDarkTheme,
} from "@codemirror/theme-one-dark";

// Fixed to One Dark for now, regardless of the app's own light/dark mode —
// a real editor-theme picker (Settings) comes later; until then every query
// editor instance (SQL, Mongo console) just always renders in One Dark.
// `oneDarkTheme`/`oneDarkHighlightStyle` are CodeMirror's own official
// package for it — this file only adds the app-specific extras that aren't
// really "theme" (completion-icon-per-kind colors/glyphs, the popup corner
// radius matching the rest of the app's chrome), recolored to fit the same
// palette instead of the app's light/dark-flipping CSS tokens.
export const appEditorTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.5",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2.5em",
    padding: "0 0.4em 0 0.5em",
  },
  ".cm-tooltip": {
    borderRadius: "var(--radius-md)",
  },

  // Completion dropdown: tint each option by its kind so the list reads like
  // highlighted code (keywords blue, columns amber, tables green) instead of
  // a wall of plain foreground text.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "13px",
  },
  ".cm-completionIcon": {
    opacity: 1,
  },
  ".cm-completionIcon-keyword": {
    color: color.malibu,
  },
  ".cm-completionIcon-property": {
    color: color.whiskey,
    // Override the library default (a plain hollow box, "□") with a filled
    // diamond so field/column suggestions read as a distinct icon rather
    // than an empty placeholder box.
    "&::after": { content: "'◆'" },
  },
  ".cm-completionIcon-table": {
    color: color.sage,
    "&::after": { content: "'▣'" },
  },
  ".cm-completionIcon-type": {
    color: color.sage,
  },
  ".cm-completionIcon-variable": {
    color: color.malibu,
  },
  ".cm-completionIcon-constant": {
    color: color.whiskey,
  },
  ".cm-completionIcon-function, .cm-completionIcon-method": {
    color: color.malibu,
  },
  "li .cm-completionIcon-keyword ~ .cm-completionLabel": {
    color: color.malibu,
  },
  "li .cm-completionIcon-property ~ .cm-completionLabel": {
    color: color.whiskey,
  },
  "li .cm-completionIcon-table ~ .cm-completionLabel": {
    color: color.sage,
  },
  "li .cm-completionIcon-type ~ .cm-completionLabel": {
    color: color.sage,
  },
  ".cm-completionMatchedText": {
    textDecoration: "underline",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: color.stone,
    fontStyle: "italic",
  },
  ".cm-nonmatchingBracket": {
    color: color.coral,
  },

  // Per-statement run buttons (statement-runner.ts) + the active-statement
  // frame it draws around the statement under the cursor. Both are app
  // chrome, not syntax, so they use the app's light/dark-flipping success
  // token instead of a One Dark-specific color.
  ".cm-statement-gutter": {
    width: "1.4em",
  },
  ".cm-statement-run": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    position: "relative",
    opacity: 0.55,
  },
  ".cm-statement-run:hover": {
    opacity: 1,
    color: "var(--success)",
  },
  ".cm-statement-run--success": {
    color: "var(--success)",
    opacity: 1,
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
  ".cm-statement-frame-layer .cm-statement-frame": {
    border: "1.5px solid var(--success)",
    borderRadius: "var(--radius-md)",
    background: "color-mix(in srgb, var(--success) 6%, transparent)",
    pointerEvents: "none",
  },
});

export const appEditorExtensions = [
  oneDarkTheme,
  appEditorTheme,
  syntaxHighlighting(oneDarkHighlightStyle),
];

// Both re-exported under their old names — every existing consumer (the
// Mongo console's JS-mode editor, doc-markdown.tsx's example blocks) keeps
// working unchanged; there's only one real highlight style while the
// editor theme is fixed to One Dark.
export const sqlHighlightStyle = oneDarkHighlightStyle;
export const jsHighlightStyle = oneDarkHighlightStyle;

// The full set of editor themes this app will eventually offer (Settings >
// Editor, not built yet). Typed now so that picker has the full list ready
// to iterate; every id but "one-dark" still just resolves to One Dark until
// its own palette is written.
export type EditorThemeId =
  | "app"
  | "one-dark"
  | "vscode-dark"
  | "vscode-light"
  | "nord"
  | "okaidia"
  | "material"
  | "duotone-light"
  | "duotone-dark"
  | "xcode"
  | "xcode-dark"
  | "idea-light"
  | "idea-dark"
  | "jetbrains-light"
  | "jetbrains-dark"
  | "cursor-light"
  | "cursor-dark"
  | "claude-light"
  | "claude-dark";

export const EDITOR_THEME_LABELS: Record<EditorThemeId, string> = {
  app: "Follow app theme",
  "one-dark": "One Dark",
  "vscode-dark": "VS Code Dark",
  "vscode-light": "VS Code Light",
  nord: "Nord",
  okaidia: "Okaidia",
  material: "Material",
  "duotone-light": "Duotone Light",
  "duotone-dark": "Duotone Dark",
  xcode: "Xcode",
  "xcode-dark": "Xcode Dark",
  "idea-light": "IntelliJ IDEA Light",
  "idea-dark": "IntelliJ IDEA Dark",
  "jetbrains-light": "JetBrains Light",
  "jetbrains-dark": "JetBrains Dark",
  "cursor-light": "Cursor Light",
  "cursor-dark": "Cursor Dark",
  "claude-light": "Claude Light",
  "claude-dark": "Claude Dark",
};

export const DEFAULT_EDITOR_THEME: EditorThemeId = "one-dark";
