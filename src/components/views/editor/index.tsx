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
import { createRoot } from "react-dom/client";
import InlineEditor from "./inline-editor";
import LinePlusButton from "./line-plus-button";

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
  const inlineEditorWidgetRef = useRef<any>(null);

  const debounce = useDebouncedCallback((value: string) => {
    dispatch(updateFile({ id: currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  const createInlineEditorWidget = (editor: any, monaco: any, lineNumber: number) => {
    // Remove existing view zone if any
    if (inlineEditorWidgetRef.current) {
      editor.changeViewZones((changeAccessor: any) => {
        changeAccessor.removeZone(inlineEditorWidgetRef.current);
      });
    }

    // Create view zone above the target line
    editor.changeViewZones((changeAccessor: any) => {
      const domNode = document.createElement("div");
      
      // Create React root and render the component
      const root = createRoot(domNode);
      
      const handleSubmit = (value: string) => {
        if (value) {
          // Insert the new line above the target line
          const range = new monaco.Range(lineNumber, 1, lineNumber, 1);
          editor.executeEdits("insert-line", [{
            range: range,
            text: value + "\n"
          }]);
        }
        // Remove the view zone
        editor.changeViewZones((changeAccessor: any) => {
          changeAccessor.removeZone(inlineEditorWidgetRef.current);
        });
        inlineEditorWidgetRef.current = null;
        root.unmount();
        editor.focus();
      };
      
      const handleCancel = () => {
        // Remove the view zone
        editor.changeViewZones((changeAccessor: any) => {
          changeAccessor.removeZone(inlineEditorWidgetRef.current);
        });
        inlineEditorWidgetRef.current = null;
        root.unmount();
        editor.focus();
      };
      
      root.render(
        <InlineEditor
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );
      
      // Create the view zone
      const zoneId = changeAccessor.addZone({
        afterLineNumber: lineNumber - 1,
        heightInPx: 90,
        domNode: domNode,
        // Allow height to be updated dynamically
        onDomNodeTop: (top: number) => {
          // This callback can be used to update position if needed
        }
      });
      
      inlineEditorWidgetRef.current = zoneId;
    });
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
        
        // Create inline editor widget using the separate function
        createInlineEditorWidget(editor, monaco, lineNumber);
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

        // Add group class to line element for CSS hover
        lineElement.classList.add("group");

        // Create container for React component
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "line-plus-button-container";
        buttonContainer.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          display: flex;
          justify-content: end;
          align-items: center;
          z-index: 100;
        `;

        // Create button wrapper that allows pointer events
        const buttonWrapper = document.createElement("div");
        buttonWrapper.style.cssText = `
          pointer-events: auto;
          position: relative;
        `;

        // Create React root and render the component
        const root = createRoot(buttonWrapper);
        

        root.render(
          <LinePlusButton
          />
        );

        buttonContainer.appendChild(buttonWrapper);
        lineElement.appendChild(buttonContainer);
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
