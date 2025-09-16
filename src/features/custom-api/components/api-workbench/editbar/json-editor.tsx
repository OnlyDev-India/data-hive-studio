import { useRef, forwardRef, useImperativeHandle } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import GithubDark from '@/components/views/editor/github-dark.json';
import GithubLight from '@/components/views/editor/github-light.json';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export interface JsonEditorRef {
  getEditor: () => any;
}

const JsonEditor = forwardRef<JsonEditorRef, JsonEditorProps>(({ value, onChange, placeholder, className = '' }, ref) => {
  const editorRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current
  }));

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    
    // Define GitHub themes
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "github-dark" : "github-light"
    );
    
    // Handle placeholder behavior
    if (placeholder && !value) {
      editor.setValue(placeholder);
      // Style placeholder text
      const model = editor.getModel();
      if (model) {
        editor.deltaDecorations([], [{
          range: model.getFullModelRange(),
          options: {
            inlineClassName: 'monaco-placeholder',
            isWholeLine: true
          }
        }]);
      }
    }
    const jsonLanguageService = monaco.languages.json.jsonDefaults;

    // Customize JSON validation to allow MongoDB functions
    jsonLanguageService.setDiagnosticsOptions({
      validate: false, // Disable JSON validation for MongoDB
      allowComments: true,
      schemas: [],
    });
  };

  return (
    <>
      <style jsx>{`
        :global(.monaco-placeholder) {
          color: hsl(var(--muted-foreground)) !important;
          font-style: italic !important;
        }
      `}</style>
      <div className={`min-h-20 border rounded-md overflow-hidden ${className}`}>
        <Editor
          height="120px"
          language="json"
          value={value || ''}
          onChange={(value) => onChange(value || '')}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            glyphMargin: false,
            folding: false,
            lineHeight: 20,
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            padding: { top: 8, bottom: 8 },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            renderLineHighlight: 'none',
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
      </div>
    </>
  );
});

JsonEditor.displayName = 'JsonEditor';

export default JsonEditor;
