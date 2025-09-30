"use client";
import GithubDark from "./github-dark.json";
import GithubLight from "./github-light.json";
import { useDispatch, useSelector } from "react-redux";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import { FileFileType } from "@/types/file.type";
import { useTheme } from "next-themes";
import { Editor } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import {
  getSchemas,
  getTablesWithFieldsFromDb,
} from "@/lib/actions/fetch-data";
import { pgSqlLanguageServer } from "@/lib/editor-language-servers/pgsql";
import { mongodbLanguageServer } from "@/lib/editor-language-servers/mongodb";
import { editorLanguages } from "@/types/db.type";
import { RootState } from "@/redux/store";

interface CodeEditorProps {
  handleRunQuery: (editor: any, queryHistory?: string[]|null) => Promise<void>;
  setEditor: (editor: any) => void;
  dbType: string;
}

const CodeEditor = ({ handleRunQuery, setEditor, dbType }: CodeEditorProps) => {
  const dispatch = useDispatch();
  const { currentFile } = useSelector(
    (state: RootState) => state.openFiles,
  );
  const { queryHistory } = useSelector((state: RootState) => state.appDB);
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const actionRef = useRef<any>(null);


  const debounce = useDebouncedCallback((value: string) => {
    dispatch(updateFile({ id: currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  // Update the addAction whenever queryHistory changes
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      // Dispose the existing action if it exists
      if (actionRef.current) {
        actionRef.current.dispose();
      }
      
      // Add the action with updated queryHistory
      actionRef.current = editorRef.current.addAction({
        id: "my-action-runQuery",
        label: "Run Query",
        keybindings: [monacoRef.current.KeyMod.CtrlCmd | monacoRef.current.KeyCode.Enter],
        precondition: null,
        run: () => {
          handleRunQuery(editorRef.current);
        },
      });
    }
  }, [queryHistory, handleRunQuery]);

  

  const handleEditor = async (editor: any, monaco: any) => {
    monacoRef.current = monaco;
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
    setEditor(editor);
    editorRef.current = editor;
  };

  return currentFile?.type==="file" && (
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
