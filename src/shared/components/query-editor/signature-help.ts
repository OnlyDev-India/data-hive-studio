import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { maskStringsAndComments } from "@/shared/lib/utils";
import { SQL_SIGNATURES, type FnSignature } from "./sql-signatures";

const isWordChar = (c: string | undefined) => !!c && /[\w$]/.test(c);

/** Finds the call `SQL_SIGNATURES` entry enclosing `pos`, and which (0-based)
 *  argument the cursor is currently in — walks backward from `pos` over
 *  `masked` text (a `maskStringsAndComments`'d copy, so a `(`/`)`/`,` inside
 *  a string literal never confuses the scan), tracking paren depth so a
 *  nested call's own parens/commas don't count against the OUTER call. */
function findActiveCall(
  masked: string,
  pos: number,
): { entry: FnSignature; openParen: number; argIndex: number } | null {
  let depth = 0;
  let argIndex = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = masked[i];
    if (ch === ")") {
      depth++;
    } else if (ch === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      let j = i - 1;
      while (j >= 0 && /\s/.test(masked[j])) j--;
      const end = j + 1;
      while (j >= 0 && isWordChar(masked[j])) j--;
      const name = masked.slice(j + 1, end);
      const entry = name ? SQL_SIGNATURES[name.toUpperCase()] : undefined;
      return entry ? { entry, openParen: i, argIndex } : null;
    } else if (ch === "," && depth === 0) {
      argIndex++;
    }
  }
  return null;
}

/** `findActiveCall`, but from raw (unmasked) text — the form easiest to
 *  unit-test directly, and what `buildTooltip` itself uses. */
export function activeCallAt(
  text: string,
  pos: number,
): { entry: FnSignature; openParen: number; argIndex: number } | null {
  return findActiveCall(maskStringsAndComments(text), pos);
}

function buildTooltip(state: EditorState): Tooltip | null {
  const pos = state.selection.main.head;
  const call = activeCallAt(state.doc.toString(), pos);
  if (!call) return null;
  const { entry, openParen, argIndex } = call;
  return {
    pos: openParen + 1,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-sig-help";
      const name = document.createElement("span");
      name.className = "cm-sig-help-name";
      name.textContent = `${entry.name}(`;
      dom.appendChild(name);
      const active = Math.min(argIndex, Math.max(entry.params.length - 1, 0));
      entry.params.forEach((p, i) => {
        const span = document.createElement("span");
        span.textContent = i === entry.params.length - 1 ? p : `${p}, `;
        if (i === active) span.className = "cm-sig-help-active";
        dom.appendChild(span);
      });
      const close = document.createElement("span");
      close.textContent = ")";
      dom.appendChild(close);
      return { dom };
    },
  };
}

const signatureHelpField = StateField.define<Tooltip | null>({
  create: buildTooltip,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return buildTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

/** Shows a floating signature card while the cursor sits inside a call to a
 *  function listed in `SQL_SIGNATURES`, bolding whichever argument position
 *  the cursor is currently in — the classic IDE "signature help" behavior,
 *  triggered by cursor position rather than a deliberate hover (see
 *  `doc-hover.ts` for that, separate and complementary: hover documents any
 *  keyword/function by name, this tracks live progress through one call's
 *  argument list). */
export function sqlSignatureHelp(): Extension {
  return [signatureHelpField, signatureHelpTheme];
}

export const signatureHelpTheme = EditorView.baseTheme({
  ".cm-sig-help": {
    padding: "6px 10px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12.5px",
    color: "var(--popover-foreground)",
    whiteSpace: "nowrap",
  },
  ".cm-sig-help-name": {
    fontWeight: "600",
    color: "var(--info-dark)",
  },
  ".cm-sig-help-active": {
    fontWeight: "700",
    textDecoration: "underline",
  },
});
