"use client";
import GithubDark from "./github-dark.json";
import GithubLight from "./github-light.json";
import { useDispatch, useSelector } from "react-redux";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import { useTheme } from "next-themes";
import { Editor } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import {
  getSchemas,
  getTablesWithFieldsFromDb,
} from "@/lib/actions/fetch-data";
import { pgSqlLanguageServer } from "@/lib/editor-language-servers/pgsql";
import { mongodbLanguageServer } from "@/lib/editor-language-servers/mongodb";
import { editorLanguages } from "@/types/db.type";
import { RootState } from "@/redux/store";
import { useMonaco } from "@monaco-editor/react";

interface CodeEditorProps {
  handleRunQuery: () => Promise<void>;
  setEditor: (editor: any) => void;
  dbType: string;
}

const CodeEditor = ({ handleRunQuery, setEditor, dbType }: CodeEditorProps) => {
  const dispatch = useDispatch();
  const { currentFile } = useSelector((state: RootState) => state.openFiles);
  const { queryHistory } = useSelector((state: RootState) => state.appDB);
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const actionRef = useRef<any>(null);
  const monaco = useMonaco();

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
        keybindings: [
          monacoRef.current.KeyMod.CtrlCmd | monacoRef.current.KeyCode.Enter,
        ],
        precondition: null,
        run: () => {
          handleRunQuery();
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

    // Add custom line number hover functionality
    setupLineNumberHover(editor, monaco);

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


  const setupLineNumberHover = (editor: any, monaco: any) => {
    // Add click handler for line plus button
    editor.onMouseDown((e: any) => {
      if (!e.target.element?.classList.contains("line-plus-button")) return;
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const lineNumber = e.target.position.lineNumber;
        console.log("Plus button clicked on line:", lineNumber);
        // TODO: Add inline editor implementation
      }
    });

    // Use a more direct approach with DOM manipulation
    const addHoverButtons = () => {
      const editorContainer = editor.getContainerDomNode();
      if (!editorContainer) return;

      // Find all active line number elements
      const lineNumberElements =
        editorContainer.querySelectorAll(".line-numbers");

      lineNumberElements.forEach((lineElement: any) => {
        // Skip if already has button
        if (lineElement.querySelector(".line-plus-button")) return;

        // Create plus button
        const button: HTMLButtonElement = document.createElement("button");
        button.className = "line-plus-button";
        button.innerHTML = "+";
        button.style.cssText = `
          position: absolute;
          top: 50%;
          left: 80%;
          transform: translate(-50%, -50%);
          width: 18px;
          height: 18px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 32%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          color: var(--primary);
          cursor: pointer;
          opacity: 0;
          transition: all 0.2s ease;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          z-index: 100;
        `;

        // Add hover effects
        lineElement.addEventListener("mouseenter", () => {
          button.style.opacity = "1";
          button.style.backgroundColor = "hsl(var(--primary))";
          button.style.color = "hsl(var(--foreground))";
        });

        lineElement.addEventListener("mouseleave", () => {
          button.style.opacity = "0";
        });

        // Add click handler
        // button.addEventListener("click", (e) => {
        //   console.log("button clicked");
        //   e.stopPropagation();
        //   const rect = lineElement.getBoundingClientRect();
        //   const position = editor.getPositionAt?.(rect.top);
        //   console.log("position", position);
        //   if (position) {
        //     editor.setPosition({ lineNumber: position.lineNumber, column: 1 });
        //     editor.focus();
        //     console.log("position", position);
        //     // handleRunQuery(editor);
        //   }
        // });

        lineElement.appendChild(button);
      });
    };

    // Add buttons initially
    setTimeout(addHoverButtons, 100);

    // Re-add buttons when content changes
    editor.onDidChangeModelContent(() => {
      setTimeout(addHoverButtons, 50);
    });

    editor.onDidScrollChange(() => {
      setTimeout(addHoverButtons, 50);
    });

    editor.onDidChangeCursorPosition((e: any) => {
      setTimeout(addHoverButtons, 50);
    });
  };

  return (
    currentFile?.type === "file" && (
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
    )
  );
};

export default CodeEditor;
