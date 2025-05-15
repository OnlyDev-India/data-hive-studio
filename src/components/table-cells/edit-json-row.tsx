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

const EditJsonRow = ({ data, index }: any) => {
  const copyData = JSON.parse(JSON.stringify(data));
  delete copyData.isNew;
  const [updatedData, setUpdatedData] = useState(data);
  const [isValidData, setIsValidData] = useState(true);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

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
      // console.warn("Invalid JSON, skipping parse:", error.message);
      setError(error.message);
    }
  };

  const handleUpdateData = async () => {
    if (!isValidData) return;
    // console.log(updatedData, index);
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
      toast.success(`Data updated`);
      setOpen(false);
    } else if (response.updateError) {
      toast.error(response.updateError);
    } else {
      toast.error("Something went wrong");
    }

    setLoading(false);
  };

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
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>
      <DialogContent className="scrollable-container-gutter h-[80%] w-[80%] min-w-[80%] overflow-auto">
        <DialogHeader>
          <DialogTitle className="hidden">hi</DialogTitle>
        </DialogHeader>
        <Editor
          height={"100%"}
          language="json"
          value={JSON.stringify(copyData) || ""}
          onMount={handleEditor}
          onChange={updateCode}
          path={"1"}
          theme={theme?.includes("dark") ? "github-dark" : "github-light"}
          options={{
            minimap: {
              enabled: false,
            },
          }}
        />
        {error && (
          <Alert className="border-yellow-400 bg-yellow-400/20 text-yellow-400 backdrop-blur-md">
            <AlertTriangleIcon className="mr-2 size-4 stroke-yellow-400" />
            <AlertTitle>Warning</AlertTitle>
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
            {data.isNew ? "save" : loading ? "Updating..." : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditJsonRow;
