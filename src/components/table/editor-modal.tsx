import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import GithubDark from "@/components/views/editor/github-dark.json";
import GithubLight from "@/components/views/editor/github-light.json";
import { updateFile } from "@/redux/features/open-files";
import { useDispatch, useSelector } from "react-redux";
import { updateTable } from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  Code2,
  ChevronUp,
} from "lucide-react";
import {
  safeParseMongoJSON,
  stringifyWithMongoFunctions,
} from "@/lib/utils/mongodb-parser";
import { convertDataToEditor } from "@/lib/utils/mongodb-parser";
import { mongoJsonLanguageServer } from "@/lib/editor-language-servers/mongodb";

interface EditorModalProps {
  data: any;
  onSave: (data: string) => void;
  title?: string;
  children: React.ReactNode;
  isDoubleClick?: boolean;
  index: number;
  dbType?: string;
  columnMetadata: Record<string, string>;
  isEditable?: boolean;
}

export const EditorModal = ({
  data,
  onSave,
  title = "Edit Object",
  children,
  isDoubleClick = false,
  index,
  dbType,
  columnMetadata,
  isEditable,
}: EditorModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [displayData, setDisplayData] = useState(data);
  const [jsonValidation, setJsonValidation] = useState<{
    isValid: boolean;
    errorLine?: number;
    errorMessage?: string;
  }>({ isValid: true });
  const { resolvedTheme } = useTheme();
  const dispatch = useDispatch();
  const currentFile = useSelector((state: any) => state.openFiles.currentFile);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const handleEditor = async (editor: any, monaco: any) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "github-dark" : "github-light",
    );

    // Inject MongoDB functions into the editor context if this is MongoDB
    if (dbType === "mongodb") {
      await mongoJsonLanguageServer(monaco);
    }
  };

  const handleSave = async () => {
    try {
      // Use custom MongoDB parser instead of JSON.parse
      let parsed;
      if (dbType === "mongodb") {
        // For MongoDB, editableData already contains the normal data
        const result = safeParseMongoJSON(displayData);
        // const editableData = convertEditorToData(displayData);
        parsed = result.data;
      } else {
        // Use regular JSON parsing for non-MongoDB
        const jsonString = JSON.stringify(displayData, null, 2);
        parsed = JSON.parse(jsonString);
      }

      if (data.isNew) {
        dispatch(
          updateFile({
            id: currentFile?.id,
            tableData: {
              ...currentFile?.tableData,
              rows: [
                ...currentFile?.tableData?.rows.slice(0, index),
                { ...parsed, isNew: true },
                ...currentFile?.tableData?.rows.slice(index + 1),
              ],
            },
          }),
        );
        setIsOpen(false);
        return;
      }

      const response = await updateTable(currentFile.tableName, [
        { oldValue: data, newValue: parsed },
      ]);

      if (response.effectedRows) {
        dispatch(
          updateFile({
            id: currentFile?.id,
            tableData: {
              ...currentFile?.tableData,
              rows: [
                ...currentFile?.tableData?.rows.slice(0, index),
                parsed,
                ...currentFile?.tableData?.rows.slice(index + 1),
              ],
            },
          }),
        );
        toast.success(`Document updated successfully`);
        setIsOpen(false);
      } else if (response.updateError) {
        toast.error(response.updateError);
      } else {
        toast.error("Something went wrong");
      }

      setLoading(false);

      onSave("update");
      setJsonValidation({ isValid: true });
    } catch (error) {
      setJsonValidation({
        isValid: false,
        errorMessage: "Invalid JSON format. Please check your syntax.",
      });
    }
  };

  const handleCancel = () => {
    setJsonValidation({ isValid: true });
    setIsOpen(false);
  };

  const validateJSON = (value: string) => {
    try {
      if (value) {
        JSON.parse(value);
        setJsonValidation({ isValid: true });
        return true;
      }
    } catch (error: any) {
      // Parse error to get line number and message
      const errorMessage = error.message;
      const lineMatch = errorMessage.match(/position (\d+)/);
      const lineNumber = lineMatch ? parseInt(lineMatch[1]) : 0;

      setJsonValidation({
        isValid: false,
        errorLine: lineNumber,
        errorMessage: errorMessage.replace(/^JSON\.parse error: /, ""),
      });
      return false;
    }
    return false;
  };

  const handleChange = (value: string | undefined) => {
    if (value) {
      if (dbType === "mongodb") {
        // Use custom MongoDB parser that preserves function calls
        setDisplayData(value);
        const result = safeParseMongoJSON(value);
        if (!result.success) {
          setJsonValidation({
            isValid: false,
            errorLine: result.errorLine || 0,
            errorMessage:
              result.error ||
              "Invalid MongoDB format. Use functions like ObjectId(), ISODate(), etc.",
          });
        } else {
          setJsonValidation({ isValid: true });
        }
      } else {
        // Use regular JSON validation
        validateJSON(value);
      }
    }
  };

  // Reset editable data when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      // Convert data to executable functions for MongoDB editing
      let displayData = data;
      if (dbType === "mongodb" && data) {
        displayData = convertDataToEditor(data, columnMetadata);
        displayData = stringifyWithMongoFunctions(displayData);
      } else {
        displayData = JSON.stringify(displayData, null, 2);
      }
      // Store display data for the editor
      setDisplayData(displayData);
      setJsonValidation({ isValid: true });
      setLoading(true);
    }
  }, [isOpen, data, dbType]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="h-full w-full cursor-pointer"
        onClick={() => !isDoubleClick && setIsOpen(true)}
        onDoubleClick={() => isDoubleClick && setIsOpen(true)}
      >
        {children}
      </div>
      <DialogContent className="max-h-[80vh] max-w-4xl overflow-hidden border-0 bg-gradient-to-br from-background to-muted/20 shadow-2xl">
        <DialogHeader className="border-b border-border/50 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-muted">
              <Code2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                {title}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {dbType === "mongodb"
                  ? "Edit MongoDB document"
                  : "Edit JSON document"}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[calc(80vh-120px)] space-y-4 overflow-y-auto scroll-smooth pr-2">
          <div>
            {/* Editor Header */}
            <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/50 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium text-muted-foreground">
                  {dbType === "mongodb" ? "MongoDB Editor" : "JSON Editor"}
                </span>
                {dbType === "mongodb" && (
                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    MongoDB Mode
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Theme: {resolvedTheme === "dark" ? "Dark" : "Light"}
                  </span>
                  <span>•</span>
                  <span>Language: JSON</span>
                </div>
              </div>
            </div>

            {/* Editor Container */}
            <div className="relative overflow-hidden rounded-b-lg border border-t-0">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm font-medium">
                      Loading editor...
                    </span>
                  </div>
                </div>
              )}

              <Editor
                height="400px"
                defaultLanguage="json"
                defaultValue={displayData}
                theme={
                  resolvedTheme === "dark" ? "github-dark" : "github-light"
                }
                onMount={(editor, monaco) => {
                  handleEditor(editor, monaco);
                  setLoading(false);
                }}
                onChange={handleChange}
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
                  readOnly: !isEditable,
                  lineNumbersMinChars: 3,
                }}
              />
            </div>
          </div>

          {isEditable && (
            <>
              <div className="flex items-center justify-between">
                {/* Validation Status */}
                <div className="flex items-center gap-2">
                  {jsonValidation.isValid ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle size={16} />
                      <span className="text-sm font-medium">
                        {dbType === "mongodb"
                          ? "Valid MongoDB Format"
                          : "Valid JSON"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle size={16} />
                      <span className="text-sm font-medium">
                        {dbType === "mongodb"
                          ? `Invalid MongoDB Format - ${jsonValidation.errorMessage}`
                          : `Invalid JSON - Line ${jsonValidation.errorLine}: ${jsonValidation.errorMessage}`}
                      </span>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={!jsonValidation.isValid || isSaving}
                    className="min-w-[120px]"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Scroll to Top Button */}
        <div className="absolute bottom-4 right-4">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full opacity-0 shadow-lg transition-all duration-300 hover:scale-110 group-hover:opacity-100"
            onClick={() => {
              const scrollContainer =
                document.querySelector(".custom-scrollbar");
              if (scrollContainer) {
                scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
