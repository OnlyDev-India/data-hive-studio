"use client";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { ListXIcon, TriangleAlertIcon } from "lucide-react";
import { setQueryOutput } from "@/redux/features/query";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import Lottie from "lottie-react";
import LoadingAnimation from "@public/loading.json";
import { FileFileType } from "@/types/file.type";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTheme } from "next-themes";
import ShortcutGrid from "@/components/common/shortcut-grids";
import { Editor } from "@monaco-editor/react";

interface CodeEditorProps {
  handleRunQuery: (editor: any) => Promise<void>;
  setEditor: (editor: any) => void;
  dbType: string;
}

const CodeEditor = ({ handleRunQuery, setEditor, dbType }: CodeEditorProps) => {
  // const [data, setData] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const dispatch = useDispatch();
  const { queryOutput, executingQuery } = useSelector(
    (state: any) => state.query,
  );
  const { currentFile }: { currentFile: FileFileType | null } = useSelector(
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

  const handleEditor = async (editor: any, monaco: any) => { 
    // TODO: handle the system theme 
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
        <ResizablePanel
          defaultSize={50}
          minSize={10}
          className="bg-background [&>section]:overflow-hidden [&>section]:rounded-b-lg"
        >
          <Editor
            height={"100%"}
            language={dbType}
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
        <ResizableHandle className="!h-2 bg-background" />
        <ResizablePanel defaultSize={50} minSize={10} className="bg-background">
          <div className="h-[calc(100%-2.5rem)] w-full rounded-lg bg-secondary">
            <div className="mx-2 flex items-center justify-between border-b-2 border-border px-2 py-1">
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
              <div className="h-[calc(100%-2.7rem)]">
                {/* TODO: */}
                <Table data={data} columns={columns} dbType={dbType} />
              </div>
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
              <div className="h-[calc(100%-2.7rem)] overflow-auto p-4">
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
