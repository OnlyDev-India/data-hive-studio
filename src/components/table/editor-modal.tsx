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

interface EditorModalProps {
  data: any;
  onSave: (data: string) => void;
  title?: string;
  children: React.ReactNode;
  isDoubleClick?: boolean;
  index: number;
  dbType?: string;
  columnMetadata?: Record<string, string>;
}

export const EditorModal = ({
  data,
  onSave,
  title = "Edit Object",
  children,
  isDoubleClick = false,
  index,
}: EditorModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [editableData, setEditableData] = useState(data);
  const [editError, setEditError] = useState<string | null>(null);
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
  };

  const handleSave = async () => {
    try {
      // Validate JSON format
      const jsonString = JSON.stringify(editableData, null, 2);
      const parsed = JSON.parse(jsonString);

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
      setEditError(null);
    } catch (error) {
      setEditError("Invalid JSON format. Please check your syntax.");
    }
  };

  const handleCancel = () => {
    setEditableData(null);
    setEditError(null);
    setIsOpen(false);
  };

  const validateJSON = (value: string) => {
    try {
      if (value) {
        const parsed = JSON.parse(value);
        setEditableData(parsed);
        setEditError(null);
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
      validateJSON(value);
    }
  };

  // Reset editable data when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      setEditableData(data);
      setEditError(null);
      setJsonValidation({ isValid: true });
      setLoading(true);
    }
  }, [isOpen, data]);

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
        <DialogHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Code2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold">
                {title}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Edit your JSON document with real-time validation
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="custom-scrollbar max-h-[calc(80vh-120px)] space-y-4 overflow-y-auto scroll-smooth pr-2">
          {/* Scroll Indicator */}
          <div className="sticky top-0 z-10 mb-2 flex items-center justify-center">
            <div className="h-1 w-16 rounded-full bg-gradient-to-r from-transparent via-muted-foreground/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
          </div>

          {/* Error Display */}
          {editError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
                <div className="space-y-1">
                  <h4 className="font-medium text-destructive">
                    Error occurred
                  </h4>
                  <p className="text-sm text-destructive/80">{editError}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            {/* Editor Header */}
            <div className="flex items-center justify-between rounded-t-lg border border-b-0 bg-muted/50 px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                <span className="text-sm font-medium text-muted-foreground">
                  JSON Editor
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Theme: {resolvedTheme === "dark" ? "Dark" : "Light"}
                </span>
                <span>•</span>
                <span>Language: JSON</span>
              </div>
            </div>

            {/* Editor Container */}
            <div className="relative rounded-b-lg border border-t-0">
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
                defaultValue={JSON.stringify(editableData, null, 2)}
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
                  roundedSelection: false,
                  automaticLayout: true,
                  wordWrap: "on",
                  folding: true,
                  showFoldingControls: "always",
                  renderLineHighlight: "all",
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            {/* JSON Validation Status */}
            <div className="flex items-center gap-2">
              {jsonValidation.isValid ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle size={16} />
                  <span className="text-sm font-medium">Valid JSON</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle size={16} />
                  <span className="text-sm font-medium">
                    Invalid JSON - Line {jsonValidation.errorLine}:{" "}
                    {jsonValidation.errorMessage}
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
