import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { parseMongoJson } from "@/shared/lib/mongo-json";

/** Real-time syntax linting for the BSON/MQL document editor — the same
 *  parse error `handleChange` already computes on every edit (used to gate
 *  saving), surfaced through `@codemirror/lint`'s normal squiggly-underline
 *  + hover-tooltip UI (matching the SQL/Mongo console's `sql-lint.ts`/
 *  `nosql-lint.ts`) instead of a plain always-on decoration with no message
 *  on hover. Always shown, even for a still-being-typed constructor name
 *  like "ISODa" — `mongo-json.ts`'s `suggestConstructor` already turns that
 *  into an actionable "unknown BSON constructor `ISODa()` — did you mean
 *  `ISODate()`?" instead of a bare "unknown", so there's no need to hide
 *  the diagnostic while typing; hiding it just left the editor looking like
 *  nothing was happening at all. */
export function bsonSyntaxLinter() {
  return (view: EditorView): Diagnostic[] => {
    const doc = view.state.doc.toString();
    const { error } = parseMongoJson(doc);
    if (!error) return [];
    const from = Math.min(error.offset, doc.length);
    let to = doc.indexOf("\n", from);
    if (to === -1) to = doc.length;
    if (to <= from) to = Math.min(doc.length, from + 1);
    return [{ from, to, severity: "error", message: error.message }];
  };
}
