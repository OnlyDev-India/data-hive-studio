import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { syntaxHighlighting } from "@codemirror/language";
import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { EditorView, tooltips } from "@codemirror/view";
import { completeFromList } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  oneDarkHighlightStyle,
  oneDarkTheme,
} from "@codemirror/theme-one-dark";
import { appEditorTheme } from "@/shared/theme/codemirror-theme";
import { getTooltipRoot } from "@/shared/components/query-editor/tooltip-root";
import { cn } from "@/shared/lib/utils";
import type { Dialect } from "../lib/sql-text";

const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  history: true,
  autocompletion: true,
  closeBrackets: true,
  bracketMatching: true,
  indentOnInput: true,
  searchKeymap: false,
  tabSize: 2,
};

// The card clips its overflow and the canvas transforms it, so suggestions
// render outside both, above the canvas panels.
const fragmentTooltips = tooltips({ parent: getTooltipRoot() });
const tooltipStackingTheme = EditorView.baseTheme({
  ".cm-tooltip": { zIndex: "1000" },
});

/** A small SQL editor for one card's fragment, with the card's columns as
 *  suggestions. */
export function SqlFragmentEditor({
  value,
  onChange,
  onBlur,
  dialect,
  columns,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  dialect: Dialect;
  columns: string[];
  placeholder?: string;
  /** The editor's accessible name. */
  label: string;
  className?: string;
}) {
  // Keyed on the names, so a refresh with the same columns keeps the editor.
  const column_key = columns.join("\n");
  const extensions = useMemo(() => {
    const names = column_key ? column_key.split("\n") : [];
    return [
      oneDarkTheme,
      appEditorTheme,
      syntaxHighlighting(oneDarkHighlightStyle),
      fragmentTooltips,
      tooltipStackingTheme,
      sql({ dialect: dialect === "postgresql" ? PostgreSQL : SQLite }),
      EditorState.languageData.of(() => [
        {
          autocomplete: completeFromList(
            names.map((n) => ({ label: n, type: "property" })),
          ),
        },
      ]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
    ];
  }, [dialect, column_key, label]);
  return (
    <div
      className={cn(
        "bg-background rounded-control text-small overflow-hidden border",
        className,
      )}
      style={{ minHeight: "2.25rem" }}
      onBlur={onBlur}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        placeholder={placeholder}
        basicSetup={BASIC_SETUP}
      />
    </div>
  );
}
