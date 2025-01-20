"use client";
import { Editor, Monaco } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import GithubDark from "./github-dark.json";
import GithubLight from "./github-light.json";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../ui/resizable";
import Table from "../../table";
import { useDispatch, useSelector } from "react-redux";
// import { setEditor } from "@/redux/features/editor";
import { Button } from "../../ui/button";
import { TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { Tooltip } from "@radix-ui/react-tooltip";
import { ListXIcon, TriangleAlertIcon } from "lucide-react";
import { setQueryOutput } from "@/redux/features/query";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import Lottie from "lottie-react";
import LoadingAnimation from "@public/loading.json";
import { FileType } from "@/types/file.type";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTheme } from "next-themes";
import ShortcutGrid from "@/components/common/shortcut-grids";

interface CodeEditorProps {
  handleRunQuery: (editor: any) => Promise<void>;
  setEditor: (editor: any) => void;
}

const CodeEditor = ({ handleRunQuery, setEditor }: CodeEditorProps) => {
  // const [data, setData] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const dispatch = useDispatch();
  const { queryOutput, executingQuery } = useSelector(
    (state: any) => state.query,
  );
  const { currentFile }: { currentFile: FileType | null } = useSelector(
    (state: any) => state.openFiles,
  );
  const { theme } = useTheme();

  useEffect(() => {
    if (queryOutput) {
      const { data }: any = queryOutput;
      if (data) {
        setData(
          data.rows?.map((item: any) => {
            const copiedItem = JSON.parse(JSON.stringify(item));
            Object.keys(item).forEach((key) => {
              if (typeof item[key] === "object")
                copiedItem[key] = item[key]?.toString();
            });
            return copiedItem;
          }),
        );
        setColumns(
          data.columns?.map((col: { column_name: any; data_type: any }) => ({
            key: col.column_name,
            name: col.column_name,
            data_type: col.data_type,
          })),
        );
      }
    } else {
      setData([]);
      setColumns([]);
    }
  }, [queryOutput]);

  const handleClearOutput = () => {
    dispatch(setQueryOutput(null));
  };

  const debounce = useDebouncedCallback((value: string) => {
    dispatch(updateFile({ id: currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  const handleEditor = async (editor: any, monaco: Monaco) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      theme?.includes("dark") ? "github-dark" : "github-light",
    );
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
    <div className="h-full w-full">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50} minSize={10}>
          <Editor
            height={"100%"}
            language="pgsql"
            value={currentFile?.code || ""}
            onMount={handleEditor}
            onChange={updateCode}
            path={currentFile?.id}
            theme={theme?.includes("dark") ? "github-dark" : "github-light"}
            options={{
              minimap: {
                enabled: false,
              },
            }}
          />
        </ResizablePanel>
        <ResizableHandle className="data-[resize-handle-state=drag]:!h-0.5 data-[resize-handle-state=hover]:!h-0.5 data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary" />
        <ResizablePanel defaultSize={50} minSize={10}>
          <div className="h-[calc(100%-3.5rem)] w-full">
            <div className="flex items-center justify-between bg-secondary px-4 py-1.5">
              <p>output</p>
              <div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={"ghost"}
                      size={"icon"}
                      onClick={handleClearOutput}
                    >
                      <ListXIcon />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear</TooltipContent>
                </Tooltip>
              </div>
            </div>
            {executingQuery ? (
              <div className="flex h-full items-center justify-center overflow-auto p-4">
                <div className="h-48 w-48 rounded-lg border-2 bg-secondary/70">
                  <Lottie
                    animationData={LoadingAnimation}
                    className="h-full [&_path]:!stroke-foreground"
                  />
                </div>
              </div>
            ) : columns.length > 0 ? (
              <Table data={data} columns={columns} isSmall />
            ) : queryOutput?.error ? (
              <div className="h-full overflow-auto p-4">
                <Alert className="bg-secondary">
                  <TriangleAlertIcon className="h-4 w-4 stroke-red-500" />
                  <AlertTitle>Error!</AlertTitle>
                  <AlertDescription>{queryOutput.error}</AlertDescription>
                </Alert>
              </div>
            ) : queryOutput?.message ? (
              <div className="h-full overflow-auto p-4">
                <p className="rounded-lg border-2 bg-secondary/60 p-4">
                  Message :{" "}
                  <span className="text-primary">{queryOutput.message}</span>
                </p>
              </div>
            ) : (
              <div className="h-full overflow-auto p-4">
                <ShortcutGrid />
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default CodeEditor;
