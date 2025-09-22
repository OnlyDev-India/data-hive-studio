"use client";
import GithubDark from "./github-dark.json";
import GithubLight from "./github-light.json";
import { useDispatch, useSelector } from "react-redux";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import { FileFileType } from "@/types/file.type";
import { useTheme } from "next-themes";
import { Editor } from "@monaco-editor/react";
import {
  getSchemas,
  getTablesWithFieldsFromDb,
} from "@/lib/actions/fetch-data";
import { pgSqlLanguageServer } from "@/lib/editor-language-servers/pgsql";
import { mongodbLanguageServer } from "@/lib/editor-language-servers/mongodb";
import { editorLanguages } from "@/types/db.type";

interface CodeEditorProps {
  handleRunQuery: (editor: any) => Promise<void>;
  setEditor: (editor: any) => void;
  dbType: string;
}

const CodeEditor = ({ handleRunQuery, setEditor, dbType }: CodeEditorProps) => {
  const dispatch = useDispatch();
  const { currentFile }: { currentFile: FileFileType | null } = useSelector(
    (state: any) => state.openFiles,
  );
  const { resolvedTheme } = useTheme();


  const debounce = useDebouncedCallback((value: string) => {
    dispatch(updateFile({ id: currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  

  const handleEditor = async (editor: any, monaco: any) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "github-dark" : "github-light",
    );
    if (dbType === "pgSql") {
      let schemas: any = [];
      const schemasWithTables: { [key: string]: any } = {};
      const response = await getSchemas();
      if (response?.schemas) {
        schemas = response?.schemas;
        schemas.forEach(async (schema: any) => {
          const response = await getTablesWithFieldsFromDb(schema.schema_name);
          schemasWithTables[schema.schema_name] = response?.tables;
        });
      }

      pgSqlLanguageServer(monaco, { schemasWithTables });
    }
    if (dbType === "mongodb") {
      const response = await getTablesWithFieldsFromDb("");
      mongodbLanguageServer(monaco, { collections: response?.tables || [] });
    }
    editor.addAction({
      id: "my-action-runQuery",
      label: "Run Query",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      precondition: null,
      run: () => {
        handleRunQuery(editor);
      },
    });
    setEditor(editor);
  };

  return (
    <div className="h-[calc(100%-var(--tabs-height))] w-full">
      <Editor
        height={"100%"}
        language={editorLanguages[dbType as keyof typeof editorLanguages]}
        value={currentFile?.code || ""}
        onMount={handleEditor}
        onChange={updateCode}
        path={currentFile?.id}
        theme={resolvedTheme === "dark" ? "github-dark" : "github-light"}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: "on",
          glyphMargin: false,
          roundedSelection: false,
          automaticLayout: true,
          wordWrap: "on",
          folding: true,
          showFoldingControls: "always",
          renderLineHighlight: "all",
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );
};

export default CodeEditor;
