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
  const [schemaContext, setSchemaContext] = useState<string>("");

  const debounce = useDebouncedCallback((value: string) => {
    dispatch(updateFile({ id: currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  const createInlineEditorWidget = (editor: any, monaco: any, lineNumber: number, useAI: boolean = true) => {
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
      
      // Track the current insertion position for streaming
      const currentInsertionLine = lineNumber;
      let streamedContent = "";
      
      const handleStream = (chunk: string) => {
        // For streaming: append chunk to the editor in real-time
        streamedContent += chunk;
        
        // Get the current position to insert
        const position = editor.getPosition() || { lineNumber: currentInsertionLine, column: 1 };
        
        // Insert the chunk at the current position
        const range = new monaco.Range(
          currentInsertionLine, 
          1, 
          currentInsertionLine, 
          1
        );
        
        // Replace the entire streamed content to handle it properly
        editor.executeEdits("stream-insert", [{
          range: new monaco.Range(lineNumber, 1, currentInsertionLine, Number.MAX_SAFE_INTEGER),
          text: streamedContent
        }]);
        
        // Move cursor to end of inserted text
        const lines = streamedContent.split('\n');
        const lastLineNumber = lineNumber + lines.length - 1;
        const lastLineLength = lines[lines.length - 1].length;
        editor.setPosition({ lineNumber: lastLineNumber, column: lastLineLength + 1 });
      };
      
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

      // Handle height changes from inline editor
      let currentZoneHeight = 100;
      const handleHeightChange = (newHeight: number) => {
        const targetHeight = Math.max(newHeight + 20, 90); // Add padding, min 90px
        
        // Only update if significantly different to prevent flickering (threshold: 15px)
        if (Math.abs(targetHeight - currentZoneHeight) > 15) {
          currentZoneHeight = targetHeight;
          
          editor.changeViewZones((changeAccessor: any) => {
            if (inlineEditorWidgetRef.current) {
              changeAccessor.removeZone(inlineEditorWidgetRef.current);
            }
            
            const updatedZoneId = changeAccessor.addZone({
              afterLineNumber: lineNumber - 1,
              heightInPx: targetHeight,
              domNode: domNode,
            });
            
            inlineEditorWidgetRef.current = updatedZoneId;
          });
          
          // Restore focus to textarea after zone update
          setTimeout(() => {
            const textarea = domNode.querySelector('textarea');
            if (textarea) {
              textarea.focus();
              // Restore cursor position to end
              textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }
          }, 20);
        }
      };
      
      // Render inline editor with AI mode if requested
      root.render(
        <InlineEditor
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          onStream={useAI ? handleStream : undefined}
          onHeightChange={handleHeightChange}
          useAI={useAI}
          dbType={dbType}
          schemaContext={schemaContext}
        />
      );
      
      // Create the view zone with initial height
      const zoneId = changeAccessor.addZone({
        afterLineNumber: lineNumber - 1,
        heightInPx: 100, // Initial height, will update based on content
        domNode: domNode,
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

      // Add the Run Query action
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

      // Add AI-powered inline editor action (Ctrl+K)
      editorRef.current.addAction({
        id: "ai-inline-editor",
        label: "AI: Generate Query",
        keybindings: [
          monacoRef.current.KeyMod.CtrlCmd | monacoRef.current.KeyCode.KeyK,
        ],
        precondition: null,
        run: (editor: any) => {
          const position = editor.getPosition();
          if (position) {
            createInlineEditorWidget(editor, monacoRef.current, position.lineNumber, true);
          }
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

    // Add placeholder when editor is empty
    setupPlaceholder(editor, monaco);

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
      
      // Build schema context for AI
      const contextParts: string[] = [];
      Object.entries(schemasWithTables).forEach(([schemaName, tables]: [string, any]) => {
        if (tables && Array.isArray(tables)) {
          tables.forEach((table: any) => {
            const columns = table.columns?.map((col: any) => 
              `${col.column_name} (${col.data_type})`
            ).join(', ');
            contextParts.push(`${schemaName}.${table.table_name}: ${columns}`);
          });
        }
      });
      setSchemaContext(contextParts.join('\n'));
    }
    if (dbType === "mongodb") {
      const response = await getTablesWithFieldsFromDb("");
      mongodbLanguageServer(monaco, { collections: response?.tables || [] });
      
      // Build schema context for AI
      const collections = response?.tables || [];
      if (collections.length > 0) {
        const contextParts = collections.map((collection: any) => {
          const fields = collection.fields?.map((field: any) => field.name).join(', ');
          return `Collection: ${collection.table_name}\nFields: ${fields}`;
        });
        setSchemaContext(contextParts.join('\n\n'));
      }
    }
    setEditor(editor);
    editorRef.current = editor;
  };


  const setupPlaceholder = (editor: any, monaco: any) => {
    let placeholderContentWidget: any = null;

    const updatePlaceholder = () => {
      const model = editor.getModel();
      if (!model) return;

      const position = editor.getPosition();
      if (!position) return;

      const currentLineNumber = position.lineNumber;
      const currentLineContent = model.getLineContent(currentLineNumber);
      
      // Remove existing placeholder if any
      if (placeholderContentWidget) {
        editor.removeContentWidget(placeholderContentWidget);
        placeholderContentWidget = null;
      }

      if(inlineEditorWidgetRef.current) {
        return;
      }
      
      // Show placeholder only when current line is empty
      if (!currentLineContent || currentLineContent.trim() === "") {
        const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const shortcut = isMac ? '⌘+K' : 'Ctrl+K';
        
        placeholderContentWidget = {
          getId: () => 'editor.placeholder',
          getDomNode: () => {
            const node = document.createElement('span');
            node.style.cssText = `
              color: hsl(var(--muted-foreground));
              opacity: 0.5;
              font-style: italic;
              pointer-events: none;
              user-select: none;
              font-size: 14px;
              white-space: nowrap;
              display: inline-block;
            `;
            node.textContent = `${shortcut} to generate query`;
            return node;
          },
          getPosition: () => ({
            position: {
              lineNumber: currentLineNumber,
              column: 1,
            },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }),
        };
        
        editor.addContentWidget(placeholderContentWidget);
      }
    };

    // Update placeholder initially
    setTimeout(updatePlaceholder, 100);

    // Update placeholder when content changes
    editor.onDidChangeModelContent(() => {
      updatePlaceholder();
    });

    // Update placeholder when cursor position changes
    editor.onDidChangeCursorPosition(() => {
      updatePlaceholder();
    });

    // Update placeholder when model changes (switching files)
    editor.onDidChangeModel(() => {
      setTimeout(updatePlaceholder, 50);
    });
  };

  const setupLineNumberHover = (editor: any, monaco: any) => {
    // Add click handler for line plus button
    editor.onMouseDown((e: any) => {
      if (!e.target.element?.classList.contains("line-plus-button")) return;
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const lineNumber = e.target.position.lineNumber;
        
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
      <div className="h-[calc(100%-var(--tabs-height))] w-full select-text">
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
