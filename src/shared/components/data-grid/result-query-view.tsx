import { useMemo, useState } from "react";
import CodeMirrorComponent from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { Check, Copy } from "lucide-react";
import { appEditorExtensions } from "@/shared/theme/codemirror-theme";

/** The statement behind a result, shown read only with the same colors and
 *  line numbers as the editor it came from. */
export function ResultQueryView({
  text,
  language = "sql",
}: {
  text: string;
  language?: "sql" | "js";
}) {
  const [copied, setCopied] = useState(false);
  const extensions = useMemo(
    () => [
      ...appEditorExtensions,
      EditorView.lineWrapping,
      language === "js" ? javascriptLanguage : sqlLang(),
    ],
    [language],
  );
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="group relative min-h-0 flex-1" data-selectable>
      <CodeMirrorComponent
        value={text}
        editable={false}
        theme="none"
        height="100%"
        className="h-full"
        basicSetup={{
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          closeBrackets: false,
        }}
        extensions={extensions}
      />
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy query"}
        title={copied ? "Copied" : "Copy query"}
        className="absolute top-2 right-3 rounded p-1.5 text-white/60 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white"
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
