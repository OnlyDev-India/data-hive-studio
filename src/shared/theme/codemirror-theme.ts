import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Base chrome: backgrounds, gutters, selection and caret all come from the
// app's own CSS variables, so the editor matches the surrounding UI exactly in
// both light and dark mode (it re-resolves when `.dark` flips on <html>).
export const appEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
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
  ".cm-content": {
    caretColor: "var(--primary)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in oklab, var(--info) 40%, transparent)",
      color: "inherit",
    },
  ".cm-cursorLayer": {
    zIndex: 2,
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--info) 30%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight: "0",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--info) 10%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--info) 12%, transparent)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "2.5em",
    padding: "0 0.4em 0 0.5em",
  },
  ".cm-activeLineGutter .cm-gutterElement": {
    color: "var(--info-dark)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
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
    color: "var(--info-dark)",
  },
  ".cm-completionIcon-property": {
    color: "var(--warning-dark)",
    // Override the library default (a plain hollow box, "□") with a filled
    // diamond so field/column suggestions read as a distinct icon rather
    // than an empty placeholder box.
    "&::after": { content: "'◆'" },
  },
  ".cm-completionIcon-table": {
    color: "var(--success-dark)",
    "&::after": { content: "'▣'" },
  },
  ".cm-completionIcon-type": {
    color: "var(--success-dark)",
  },
  ".cm-completionIcon-variable": {
    color: "var(--info-dark)",
  },
  ".cm-completionIcon-constant": {
    color: "var(--warning-dark)",
  },
  ".cm-completionIcon-function, .cm-completionIcon-method": {
    color: "var(--info-dark)",
  },
  "li .cm-completionIcon-keyword ~ .cm-completionLabel": {
    color: "var(--info-dark)",
  },
  "li .cm-completionIcon-property ~ .cm-completionLabel": {
    color: "var(--warning-dark)",
  },
  "li .cm-completionIcon-table ~ .cm-completionLabel": {
    color: "var(--success-dark)",
  },
  "li .cm-completionIcon-type ~ .cm-completionLabel": {
    color: "var(--success-dark)",
  },
  ".cm-completionMatchedText": {
    textDecoration: "underline",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--muted-foreground)",
    fontStyle: "italic",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in oklab, var(--warning) 40%, transparent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
  },
  ".cm-nonmatchingBracket": {
    color: "var(--destructive-dark)",
  },
  ".cm-placeholder": {
    color: "var(--muted-foreground)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "1px solid var(--border)",
  },
});

// Syntax colours: accents come from the app's semantic tokens (info/blue,
// success/green, warning/amber) so the code stays clearly readable against the
// app background in both modes without looking off-theme. Each _-dark token
// flips automatically: dark in light mode, light in dark mode.
export const sqlHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.punctuation, color: "var(--muted-foreground)" },
  { tag: t.operator, color: "var(--foreground)" },
  { tag: t.paren, color: "var(--muted-foreground)" },
  { tag: t.brace, color: "var(--muted-foreground)" },
  { tag: t.squareBracket, color: "var(--muted-foreground)" },
  { tag: t.keyword, color: "var(--info-dark)", fontWeight: "600" },
  { tag: t.bool, color: "var(--warning-dark)" },
  { tag: t.null, color: "var(--warning-dark)" },
  { tag: t.number, color: "var(--warning-dark)" },
  { tag: t.string, color: "var(--success-dark)" },
  { tag: t.special(t.string), color: "var(--success-dark)" },
  { tag: t.typeName, color: "var(--info-dark)" },
  { tag: t.standard(t.name), color: "var(--info-dark)" },
  { tag: t.special(t.name), color: "var(--info-dark)" },
  { tag: t.function(t.variableName), color: "var(--info-dark)" },
  { tag: t.variableName, color: "var(--foreground)" },
  { tag: t.name, color: "var(--foreground)" },
  { tag: t.propertyName, color: "var(--foreground)" },
]);

export const appEditorExtensions = [
  appEditorTheme,
  syntaxHighlighting(sqlHighlightStyle),
];
