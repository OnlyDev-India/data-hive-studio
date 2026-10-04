import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

const BARE_KEY = /^[A-Za-z_$][\w$]*$/;

/** Field completions for a card's JSON: `"$` inside a string offers field
 *  references, and a key position offers the field names themselves. */
export function fieldCompletions(fields: string[]): Extension {
  const refs: Completion[] = fields.map((f) => ({
    label: `$${f}`,
    type: "variable",
    boost: 1,
  }));
  const keys: Completion[] = fields.map((f) => ({
    label: f,
    apply: BARE_KEY.test(f) ? f : JSON.stringify(f),
    type: "property",
    boost: 1,
  }));
  const source = (ctx: CompletionContext) => {
    if (fields.length === 0) return null;
    const ref = ctx.matchBefore(/["']\$[\w.]*$/);
    if (ref)
      return { from: ref.from + 1, options: refs, validFor: /^\$[\w.]*$/ };
    const word = ctx.matchBefore(/[\w.]*$/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const before = ctx.state.sliceDoc(Math.max(0, word.from - 40), word.from);
    if (!/[{,]\s*$/.test(before)) return null;
    return { from: word.from, options: keys, validFor: /^[\w.]*$/ };
  };
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
