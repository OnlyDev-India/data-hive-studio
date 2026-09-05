import { javascriptLanguage } from "@codemirror/lang-javascript";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { statementRanges } from "@/shared/lib/utils";

/** Shell-specific commands that aren't valid JavaScript at all — checked
 *  BEFORE attempting JS parsing so they're never flagged as syntax errors
 *  just for not being JS. Mirrors the exact set `nosql-completions.ts`'s
 *  `SHELL_KEYWORDS` offers (`use analytics`, `show dbs`, `show
 *  collections`). This was the actual "lint doesn't work" bug: every one
 *  of these ordinary, extremely common console commands used to come back
 *  as "Syntax error" because the JS grammar (correctly) doesn't recognize
 *  shell syntax as JavaScript. */
const SHELL_COMMAND = /^\s*(use\s+\S+|show\s+(dbs|databases|collections))\s*$/i;

/** Matches a `db.<collection>.<method>(` call so the collection name can be
 *  checked against the connection's real collection list — same shape
 *  `findMongoCall` in `nosql-completions.ts` looks for, kept independent
 *  since that one only cares about the LAST call before the cursor while
 *  this needs every call in the statement. */
const COLLECTION_CALL = /\bdb\.([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*\(/g;

/** Client-side, syntax-only validation for the NoSQL console — flags spans
 *  the JS grammar couldn't parse (unbalanced brackets/braces, malformed
 *  object literals, incomplete statements, etc), the same way `sqlLinter`
 *  flags SQL syntax errors, plus two checks that mirror `sqlLinter`'s own
 *  semantic ones: more than one query typed with no `;` between them, and
 *  an unknown collection name in a `db.<collection>.<method>(...)` call.
 *
 *  Statement boundaries here are `;`-delimited (`statementRanges`, the same
 *  splitter Run-all/Run-target use — see `editor/index.tsx`'s `getTargets`
 *  and `mongo-console-pane.tsx`'s `run_all`), NOT one-per-line: this
 *  console only ever runs one `;`-delimited chunk per query, so two
 *  commands typed on separate lines with no `;` between them are actually
 *  going to be sent to the backend as ONE combined chunk — and that's
 *  worth flagging up front as invalid, rather than only discovering it
 *  when the run fails, since the two `db.x.find(...)` calls concatenated
 *  together aren't a single valid query.
 *
 *  No field-name checks: the console is arbitrary JS method-chaining, and
 *  without actually evaluating it there's no reliable way to know which
 *  string literals are meant to be field names versus filter values (same
 *  reasoning `sqlLinter` uses to skip bare unqualified columns). Collection
 *  names ARE checkable, though — `db.<name>.` is unambiguous — so unlike
 *  the SQL linter (which needs a table AND a schema fetch), this only ever
 *  needs the collection list, already fetched for autocomplete. Generic to
 *  whatever NoSQL database is connected — despite the name, nothing here
 *  is Mongo-specific (the actual Mongo shell surface lives in
 *  `nosql-completions.ts`'s completion lists); a future differently-shaped
 *  NoSQL database can layer its own file on top of this one rather than
 *  needing changes here. */
export function nosqlSyntaxLinter(collections: string[]) {
  const known_collections = new Set(collections);

  return (view: EditorView): Diagnostic[] => {
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc.toString();
    for (const range of statementRanges(doc)) {
      const text = doc.slice(range.start, range.end);
      if (!text.trim() || SHELL_COMMAND.test(text)) continue;
      const tree = javascriptLanguage.parser.parse(text);

      let sawError = false;
      tree.iterate({
        enter: (node) => {
          if (node.type.isError) {
            sawError = true;
            diagnostics.push({
              from: range.start + node.from,
              to: range.start + Math.max(node.to, node.from + 1),
              severity: "error",
              message: "Syntax error",
            });
          }
        },
      });
      if (sawError) continue; // a real syntax error already explains it

      // More than one top-level statement in a chunk that's supposed to be
      // ONE query — e.g. two `db.x.find(...)` calls on separate lines with
      // no `;` between them. Point at the END of each statement that's
      // missing its `;` (i.e. on that statement's own line), not at the
      // query that follows it — that next query may be perfectly valid on
      // its own, so the actual mistake is the missing separator before it.
      const top = tree.topNode;
      const stmts: { from: number; to: number }[] = [];
      for (let child = top.firstChild; child; child = child.nextSibling) {
        stmts.push({ from: child.from, to: child.to });
      }
      for (let j = 1; j < stmts.length; j++) {
        const missingAt = range.start + stmts[j - 1].to;
        diagnostics.push({
          from: missingAt,
          to: missingAt,
          severity: "error",
          message: 'Missing ";" here — otherwise this is treated as one query with the next line',
        });
      }

      // Unknown collection in a db.<collection>.<method>(...) call. Skipped
      // entirely with an empty list — same reasoning as `sqlLinter`'s
      // `known_tables.size === 0` guard: the list still fetching would
      // otherwise flag every collection as unknown.
      if (known_collections.size === 0) continue;
      COLLECTION_CALL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = COLLECTION_CALL.exec(text))) {
        const name = m[1];
        if (!known_collections.has(name)) {
          const start = range.start + m.index + "db.".length;
          diagnostics.push({
            from: start,
            to: start + name.length,
            severity: "error",
            message: `Unknown collection "${name}"`,
          });
        }
      }
    }
    return diagnostics;
  };
}
