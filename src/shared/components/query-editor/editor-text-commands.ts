import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";

/** Runs `fn` over every selection range's text (each cursor's enclosing
 *  word when its range is empty — e.g. `Cmd+Shift+U` with no selection
 *  still uppercases the identifier under the caret, matching how most
 *  editors treat these as "act on the current word" commands). Shared by
 *  the case-conversion and naming-style commands below. */
function applyToSelections(
  view: EditorView,
  fn: (text: string) => string,
): boolean {
  const { state } = view;
  const result = state.changeByRange((range) => {
    const target = range.empty ? state.wordAt(range.from) : range;
    if (!target) return { range };
    const text = state.sliceDoc(target.from, target.to);
    const next = fn(text);
    if (next === text) return { range };
    return {
      changes: { from: target.from, to: target.to, insert: next },
      range: EditorSelection.range(target.from, target.from + next.length),
    };
  });
  if (result.changes.empty) return false;
  view.dispatch(state.update(result, { scrollIntoView: true }));
  return true;
}

/** JetBrains/VS-Code-style Join Lines: merges the line under the cursor
 *  with the next one (or, with a multi-line selection, every line the
 *  selection spans) into one, joining with a single space unless the
 *  joined line was already blank or the previous one already ends in a
 *  space. The cursor lands exactly at the join point, computed by mapping
 *  the original end-of-first-line position through the resulting changes
 *  rather than hand-tracked arithmetic. */
export const joinLines: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLineNo = range.empty
    ? startLine.number + 1
    : state.doc.lineAt(range.to).number;
  if (endLineNo > state.doc.lines || endLineNo === startLine.number) {
    return false;
  }

  const changes: ChangeSpec[] = [];
  let hasContent = startLine.text.trim().length > 0;
  let cursor = startLine.to;
  for (let n = startLine.number + 1; n <= endLineNo; n++) {
    const line = state.doc.line(n);
    const leading = /^\s*/.exec(line.text)![0].length;
    const rest = line.text.slice(leading);
    const insert = hasContent && rest.length > 0 ? " " : "";
    changes.push({ from: cursor, to: line.from + leading, insert });
    cursor = line.to;
    if (rest.length > 0) hasContent = true;
  }
  const changeSet = state.changes(changes);
  view.dispatch(
    state.update({
      changes: changeSet,
      selection: EditorSelection.cursor(changeSet.mapPos(startLine.to)),
      scrollIntoView: true,
      userEvent: "delete",
    }),
  );
  return true;
};

/** Removes every whitespace-only line within the selection (the whole
 *  document when nothing is selected) — content and its own line
 *  terminator, so non-blank lines keep exactly the terminator they already
 *  had. The document's very last line, when it's the only line and it's
 *  blank, is left alone (nothing sensible to collapse it into). */
export const deleteBlankLines: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLineNo = range.empty ? 1 : state.doc.lineAt(range.from).number;
  const endLineNo = range.empty
    ? state.doc.lines
    : state.doc.lineAt(range.to).number;

  const changes: ChangeSpec[] = [];
  for (let n = startLineNo; n <= endLineNo; n++) {
    const line = state.doc.line(n);
    if (line.text.trim().length > 0) continue;
    if (n < state.doc.lines) {
      changes.push({ from: line.from, to: line.to + 1 });
    } else if (n > 1) {
      changes.push({ from: state.doc.line(n - 1).to, to: line.to });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch(
    state.update({ changes, scrollIntoView: true, userEvent: "delete" }),
  );
  return true;
};

/** Uppercase/lowercase the selection, or the word under the cursor when
 *  there's no selection. */
export const uppercaseSelection: Command = (view) =>
  applyToSelections(view, (s) => s.toUpperCase());
export const lowercaseSelection: Command = (view) =>
  applyToSelections(view, (s) => s.toLowerCase());

type NamingStyle = "snake" | "camel" | "pascal";
const NAMING_CYCLE: NamingStyle[] = ["snake", "camel", "pascal"];

function capitalize(w: string): string {
  return w.length === 0 ? w : w[0].toUpperCase() + w.slice(1);
}

/** Splits an identifier into lowercase words regardless of its current
 *  style — snake_case on `_`, camelCase/PascalCase on lower-to-upper
 *  boundaries (and consecutive-caps-then-lowercase, so `HTTPServer` splits
 *  as `HTTP`/`Server` not `H`/`T`/`T`/`P`/`Server`). */
function toWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function detectNamingStyle(identifier: string): NamingStyle {
  if (identifier.includes("_")) return "snake";
  if (/^[A-Z]/.test(identifier)) return "pascal";
  return "camel";
}

/** Cycles an identifier snake_case → camelCase → PascalCase → snake_case —
 *  detects the CURRENT style (not the previous conversion's target) so
 *  cycling stays correct even if the text was hand-edited between calls. */
export function cycleNamingStyle(identifier: string): string {
  const words = toWords(identifier);
  if (words.length === 0) return identifier;
  const current = detectNamingStyle(identifier);
  const next =
    NAMING_CYCLE[(NAMING_CYCLE.indexOf(current) + 1) % NAMING_CYCLE.length];
  if (next === "snake") return words.join("_");
  if (next === "pascal") return words.map(capitalize).join("");
  return words[0] + words.slice(1).map(capitalize).join("");
}

/** Cycles the naming style of the selection, or the identifier under the
 *  cursor when there's no selection — bound to a single shortcut (not
 *  three separate "convert to X" ones) since repeating it steps through
 *  every style in turn. */
export const cycleSelectionNamingStyle: Command = (view) =>
  applyToSelections(view, cycleNamingStyle);

/** Reformats clipboard text (e.g. a pasted spreadsheet column, one value
 *  per line) into a SQL `IN (...)` list at the cursor — single-quoted,
 *  comma-joined, blank lines dropped. Reading the clipboard is async, so
 *  (unlike every other command here) this can't return its real result
 *  synchronously; it claims the keystroke immediately and dispatches the
 *  insert once the read resolves. */
export const pasteAsSqlInCondition: Command = (view) => {
  void (async () => {
    let raw: string;
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      return; // permission denied/unavailable — silently no-op
    }
    const values = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (values.length === 0) return;
    const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
    view.dispatch(view.state.replaceSelection(`(${list})`));
  })();
  return true;
};
