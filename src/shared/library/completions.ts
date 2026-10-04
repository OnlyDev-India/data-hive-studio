import {
  insertCompletionText,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { LibraryItem, LibraryLanguage } from "./types";

const PREVIEW_LINES = 6;
/** Below schema and keyword completions, which sit at zero or above. */
const LIBRARY_BOOST = -30;

function preview(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  const head = lines.slice(0, PREVIEW_LINES).join("\n");
  return lines.length > PREVIEW_LINES ? `${head}\n…` : head;
}

/** Replaces the typed word, and the selection when it reaches further. */
function applyItem(item: LibraryItem) {
  return (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => {
    const end = Math.max(to, view.state.selection.main.to);
    if (item.kind === "snippet") {
      snippet(item.text)(view, completion, from, end);
    } else {
      view.dispatch(insertCompletionText(view.state, item.text, from, end));
    }
  };
}

export function libraryOptions(items: LibraryItem[]): Completion[] {
  const options: Completion[] = [];
  for (const item of items) {
    const base = {
      type: item.kind === "snippet" ? "library-snippet" : "library-query",
      detail: item.kind,
      info: () => {
        const pre = document.createElement("pre");
        pre.className = "cm-library-preview";
        pre.textContent = preview(item.text);
        return pre;
      },
      boost: LIBRARY_BOOST,
      apply: applyItem(item),
    };
    if (item.kind === "snippet" && item.trigger)
      options.push({ ...base, label: item.trigger });
    options.push({ ...base, label: item.name });
  }
  return options;
}

/** Completion source for one editor language. `getItems` is read on every
 *  request, so a saved item shows up at once without rebuilding the editor. */
export function libraryCompletions(
  language: LibraryLanguage,
  getItems: () => LibraryItem[],
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/\w+/);
    if (!word && !context.explicit) return null;
    const items = getItems().filter((i) => i.language === language);
    if (items.length === 0) return null;
    return {
      from: word?.from ?? context.pos,
      options: libraryOptions(items),
    };
  };
}
