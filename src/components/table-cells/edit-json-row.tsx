"use client";
import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  AlertTriangleIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  DatabaseIcon,
  CodeIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Editor, Monaco } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import GithubDark from "@/components/views/editor/github-dark.json";
import GithubLight from "@/components/views/editor/github-light.json";
import { useDispatch, useSelector } from "react-redux";
import { FileTableType } from "@/types/file.type";
import { updateFile } from "@/redux/features/open-files";
import { updateTable } from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

const EditJsonRow = ({ data, index }: any) => {
  const copyData = JSON.parse(JSON.stringify(data));
  delete copyData.isNew;
  const [updatedData, setUpdatedData] = useState(data);
  const [isValidData, setIsValidData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [editMode, setEditMode] = useState<"json" | "structured">("json");

  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );

  const { theme } = useTheme();
  const dispatch = useDispatch();

  useEffect(() => {
    setUpdatedData(data);
  }, [data]);

  useEffect(() => {
    setLoading(false);
  }, [open]);

  const handleEditor = async (editor: any, monaco: Monaco) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      theme?.includes("dark") ? "github-dark" : "github-light",
    );
    
    // Add MongoDB-specific language support
    monaco.languages.register({ id: "mongodb-json" });
    monaco.languages.setMonacoTokensProvider("mongodb-json", {
      tokenizer: {
        root: [
          [/\b(_id|ObjectId|ISODate|NumberInt|NumberLong|NumberDecimal)\b/, "type"],
          [/\b(true|false|null)\b/, "constant"],
          [/".*?"/, "string"],
          [/\d+/, "number"],
          [/[{}\[\]]/, "delimiter"],
          [/[:]/, "delimiter"],
          [/\/\/.*/, "comment"],
        ],
      },
    });
    
    editor.getAction("editor.action.formatDocument").run();
  };

  const updateCode = (value: any) => {
    try {
      const parsed = JSON.parse(value);
      setUpdatedData(parsed);
      setIsValidData(true);
      setError("");
    } catch (error: any) {
      setIsValidData(false);
      setError(error.message);
    }
  };

  const handleUpdateData = async () => {
    if (!isValidData) return;
    setLoading(true);

    if (data.isNew) {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableData: {
            ...currentFile?.tableData,
            rows: [
              ...currentFile?.tableData?.rows.slice(0, index),
              { ...updatedData, isNew: true },
              ...currentFile?.tableData?.rows.slice(index + 1),
            ],
          },
        }),
      );
      setOpen(false);
      return;
    }

    const response = await updateTable(currentFile.tableName, [
      { oldValue: data, newValue: updatedData },
    ]);

    if (response.effectedRows) {
      dispatch(
        updateFile({
          id: currentFile?.id,
          tableData: {
            ...currentFile?.tableData,
            rows: [
              ...currentFile?.tableData?.rows.slice(0, index),
              updatedData,
              ...currentFile?.tableData?.rows.slice(index + 1),
            ],
          },
        }),
      );
      toast.success(`Document updated successfully`);
      setOpen(false);
    } else if (response.updateError) {
      toast.error(response.updateError);
    } else {
      toast.error("Something went wrong");
    }

    setLoading(false);
  };

  const formatJson = (data: any) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return JSON.stringify(data);
    }
  };

  const getDocumentStats = (data: any) => {
    const stats = {
      fields: Object.keys(data).length,
      size: JSON.stringify(data).length,
      types: {} as Record<string, number>,
    };

    Object.values(data).forEach(value => {
      const type = Array.isArray(value) ? 'array' : typeof value;
      stats.types[type] = (stats.types[type] || 0) + 1;
    });

    return stats;
  };

  const documentStats = getDocumentStats(copyData);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 border border-border bg-secondary [&_svg]:size-3"
            >
              <PencilLineIcon />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Edit Document</TooltipContent>
      </Tooltip>
      <DialogContent className="scrollable-container-gutter h-[90%] w-[90%] min-w-[90%] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <DatabaseIcon size={16} />
              Edit MongoDB Document
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {documentStats.fields} fields
              </Badge>
              <Badge variant="outline" className="text-xs">
                {documentStats.size} bytes
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={editMode} onValueChange={(value: string) => setEditMode(value as "json" | "structured")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="json" className="flex items-center gap-2">
              <CodeIcon size={16} />
              JSON Editor
            </TabsTrigger>
            <TabsTrigger value="structured" className="flex items-center gap-2">
              <DatabaseIcon size={16} />
              Structured View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="json" className="mt-4">
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                <span>Document ID: {copyData._id || 'New Document'}</span>
                {copyData._id && (
                  <Badge variant="secondary" className="text-xs">
                    MongoDB ObjectId
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {Object.entries(documentStats.types).map(([type, count]) => (
                  <Badge key={type} variant="outline" className="text-xs">
                    {type}: {count}
                  </Badge>
                ))}
              </div>
            </div>
            
            <Editor
              height="400px"
              language="mongodb-json"
              value={formatJson(copyData)}
              onMount={handleEditor}
              onChange={updateCode}
              path="mongodb-document.json"
              theme={theme?.includes("dark") ? "github-dark" : "github-light"}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: "on",
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
              }}
            />
          </TabsContent>

          <TabsContent value="structured" className="mt-4">
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Structured editing coming soon. Use the JSON editor for now.
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <Alert className="border-yellow-400 bg-yellow-400/20 text-yellow-400 backdrop-blur-md">
            <AlertTriangleIcon className="mr-2 size-4 stroke-yellow-400" />
            <AlertTitle>JSON Validation Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="items-center">
          <Button
            variant={"outline"}
            onClick={() => setOpen(false)}
            className="h-7 border-border py-0 text-xs"
          >
            Cancel
          </Button>
          <Button
            disabled={!isValidData || loading}
            onClick={handleUpdateData}
            className="h-7 py-0 text-xs text-white"
          >
            {loading && <LoaderCircleIcon className="animate-spin" />}
            {data.isNew ? "Save Document" : loading ? "Updating..." : "Update Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditJsonRow;
