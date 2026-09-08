import { useMemo, useState } from "react";
import Markdown from "markdown-to-jsx";
import CodeMirrorComponent from "@uiw/react-codemirror";
import { sql as sqlLang, SQLite as SQLiteDialect } from "@codemirror/lang-sql";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Check, Copy } from "lucide-react";
import {
  sqlHighlightStyle,
  jsHighlightStyle,
} from "@/shared/theme/codemirror-theme";
import type { DocEntry } from "./doc-hover";

/** Chrome for the read-only example snippets below — deliberately NOT the
 *  main editor's `appEditorTheme` (that one sets `height: "100%"`/a 14px
 *  font sized for a full editing surface; these are a few lines inside a
 *  popup and should size to their own content instead). */
const exampleTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--muted)",
    fontSize: "12.5px",
    borderRadius: "var(--radius-md)",
  },
  ".cm-content": { padding: "10px 34px 10px 10px" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.5",
  },
  "&.cm-focused": { outline: "none" },
});

/** One example: a real (read-only) CodeMirror instance — same parser +
 *  colors the live console uses (`sqlHighlightStyle`/`jsHighlightStyle`),
 *  so an example actually looks like the code it's demonstrating instead of
 *  flat monospace text — plus a copy button, shown on hover. */
function CodeExample({ code, lang }: { code: string; lang: "sql" | "js" }) {
  const [copied, setCopied] = useState(false);
  const extensions = useMemo(
    () =>
      lang === "js"
        ? [javascriptLanguage, syntaxHighlighting(jsHighlightStyle)]
        : [
            sqlLang({ dialect: SQLiteDialect }),
            syntaxHighlighting(sqlHighlightStyle),
          ],
    [lang],
  );

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group relative">
      <CodeMirrorComponent
        value={code}
        editable={false}
        theme="none"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          closeBrackets: false,
        }}
        extensions={[exampleTheme, EditorView.lineWrapping, ...extensions]}
      />
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy example"}
        title={copied ? "Copied" : "Copy example"}
        className="text-muted-foreground hover:text-foreground hover:bg-background/80 absolute top-1.5 right-1.5 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/** Renders a `DocEntry`'s long-form description as proper Markdown (bold,
 *  inline code, lists) via `markdown-to-jsx`, followed by every example
 *  rendered as its own syntax-highlighted, copyable snippet — `lang` picks
 *  which grammar/colors the examples use (the console this popup was opened
 *  from: `"sql"` or `"js"` for the Mongo shell). Element overrides below map
 *  Markdown tags onto this app's own Tailwind styling rather than pulling in
 *  a Tailwind typography plugin for what's a handful of tags. */
export function DocDetailBody({
  entry,
  lang,
}: {
  entry: DocEntry;
  lang: "sql" | "js";
}) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <Markdown
        options={{
          overrides: {
            p: { props: { className: "text-foreground" } },
            code: {
              props: {
                className:
                  "bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]",
              },
            },
            ul: { props: { className: "list-disc space-y-1 pl-5" } },
            ol: { props: { className: "list-decimal space-y-1 pl-5" } },
          },
        }}
      >
        {entry.description}
      </Markdown>
      {entry.examples.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Example{entry.examples.length > 1 ? "s" : ""}
          </div>
          <div className="flex flex-col gap-2">
            {entry.examples.map((ex, i) => (
              <CodeExample key={i} code={ex} lang={lang} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
