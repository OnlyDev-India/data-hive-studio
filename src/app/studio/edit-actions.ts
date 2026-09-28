import { redo, selectAll, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

/** Edit menu of the custom Windows/Linux title bar. On macOS the native Edit
 *  menu forwards these to whatever has focus; here the menu is HTML, so
 *  opening it moves focus away from the field the user was in. The title bar
 *  calls `rememberEditTarget` when a menu opens, and `runEditAction` then
 *  acts on that element, not on whatever holds focus by click time. */
export type EditAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "select_all";

const EXEC_COMMAND: Record<EditAction, string> = {
  undo: "undo",
  redo: "redo",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  select_all: "selectAll",
};

/** The key the grid's own `onKeyDown` (see `use-grid-keyboard.ts`) listens
 *  for, for each action. */
const SHORTCUT_KEY: Record<EditAction, string> = {
  undo: "z",
  redo: "y",
  cut: "x",
  copy: "c",
  paste: "v",
  select_all: "a",
};

let target: HTMLElement | null = null;

/** Marks the title bar, so focus sitting on one of its own buttons (a menu
 *  opened by keyboard) never counts as a field to edit. */
export const TITLE_BAR_ATTR = "data-title-bar";

/** Call before the menu takes focus (a mousedown or keydown on its trigger). */
export function rememberEditTarget() {
  const active = document.activeElement;
  target =
    active instanceof HTMLElement &&
    active !== document.body &&
    !active.closest(`[${TITLE_BAR_ATTR}]`)
      ? active
      : null;
}

/** For the menu's `finalFocus`: hands focus back to the remembered field on
 *  close instead of the menu's trigger button. `true` keeps the default. */
export function editTargetForFocus(): HTMLElement | true {
  return target?.isConnected ? target : true;
}

function isTextField(el: HTMLElement) {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable
  );
}

/** CodeMirror needs its own commands: its history and selection live in the
 *  editor state, not in the browser's undo stack, so `execCommand` can't
 *  reach them. Same clipboard handling as `editor-context-menu.tsx`. */
function runInCodeMirror(view: EditorView, action: EditAction) {
  const { from, to } = view.state.selection.main;
  const selected = from !== to ? view.state.sliceDoc(from, to) : "";
  switch (action) {
    case "undo":
      undo(view);
      break;
    case "redo":
      redo(view);
      break;
    case "select_all":
      selectAll(view);
      break;
    case "copy":
      if (selected) void navigator.clipboard.writeText(selected);
      break;
    case "cut":
      if (!selected || view.state.readOnly) break;
      void navigator.clipboard.writeText(selected);
      view.dispatch(view.state.replaceSelection(""));
      break;
    case "paste":
      if (view.state.readOnly) break;
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) view.dispatch(view.state.replaceSelection(text));
        })
        .catch(() => {
          /* clipboard permission denied — same silent no-op as the grid */
        });
      break;
  }
  view.focus();
}

/** Browsers block `execCommand("paste")`, so paste reads the clipboard
 *  itself and inserts the text as a user edit (which keeps undo working). */
function runInTextField(el: HTMLElement, action: EditAction) {
  if (action !== "paste") {
    document.execCommand(EXEC_COMMAND[action]);
    return;
  }
  void navigator.clipboard
    .readText()
    .then((text) => {
      if (!text) return;
      el.focus({ preventScroll: true });
      document.execCommand("insertText", false, text);
    })
    .catch(() => {
      /* clipboard permission denied */
    });
}

/** Anything else (the data grid's cells, plain selected text): replay the
 *  shortcut so components that own their selection handle it themselves, and
 *  fall back to the browser's own command when nothing claimed it. */
function runViaShortcut(el: HTMLElement, action: EditAction) {
  const handled = !el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: SHORTCUT_KEY[action],
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  if (!handled && action !== "paste") {
    document.execCommand(EXEC_COMMAND[action]);
  }
}

export function runEditAction(action: EditAction) {
  const el = target;
  if (!el?.isConnected) return;
  el.focus({ preventScroll: true });

  const editor = el.closest<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (view) runInCodeMirror(view, action);
  else if (isTextField(el)) runInTextField(el, action);
  else runViaShortcut(el, action);
}
