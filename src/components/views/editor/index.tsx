"use client";
import { Editor, Monaco } from "@monaco-editor/react";
import { useEffect, useState } from "react";
import GithubDark from "./github-dark.json";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../ui/resizable";
import Table from "../../table";
import { useDispatch, useSelector } from "react-redux";
import { setEditor } from "@/redux/features/editor";
import { Button } from "../../ui/button";
import {
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { Tooltip } from "@radix-ui/react-tooltip";
import { ListXIcon } from "lucide-react";
import { setQueryOutput } from "@/redux/features/query";
import { useDebouncedCallback } from "@/hooks/debounce";
import { updateFile } from "@/redux/features/open-files";
import Lottie from "lottie-react";
import LoadingAnimation from "@public/loading.json";

interface CodeEditorProps {}

const CodeEditor = ({}: CodeEditorProps) => {
  // const [data, setData] = useState("");
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const dispatch = useDispatch();
  const { queryOutput, executingQuery } = useSelector(
    (state: any) => state.query
  );
  const { currentFile }: { currentFile: FileType | null } = useSelector(
    (state: any) => state.openFiles
  );

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
          })
        );
        setColumns(
          data.columns?.map((col: { column_name: any; data_type: any }) => ({
            key: col.column_name,
            name: col.column_name,
            data_type: col.data_type,
          }))
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
    dispatch(updateFile({ id:currentFile?.id, code: value }));
  }, 300);

  const updateCode = (value: string | undefined) => {
    debounce(value || "");
  };

  return (
    <div className="w-full h-full">
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50}>
          <Editor
            height={"100%"}
            language="pgsql"
            value={currentFile?.code || ""}
            onMount={(editor, monaco: Monaco) => {
              monaco.editor.defineTheme("github-dark", GithubDark);
              monaco.editor.setTheme("github-dark");
              dispatch(setEditor(editor));
            }}
            onChange={updateCode}
            options={{
              minimap: {
                enabled: false,
              },
            }}
          />
        </ResizablePanel>
        <ResizableHandle className="data-[resize-handle-state=hover]:bg-primary data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:!h-0.5 data-[resize-handle-state=drag]:!h-0.5" />
        <ResizablePanel defaultSize={50} minSize={0.5}>
          <div className="w-full h-[calc(100%-3.5rem)]">
            <div className="bg-secondary py-1.5 px-4 flex items-center justify-between">
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
              <div className="h-full overflow-auto p-4 flex items-center justify-center">
                <div className="h-48 w-48 border-2 bg-secondary/70 rounded-lg">
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
                <p className="border-2 bg-secondary/60 p-4 rounded-lg">
                  Error :{" "}
                  <span className="text-red-500">{queryOutput.error}</span>
                </p>
              </div>
            ) : queryOutput?.message ? (
              <div className="h-full overflow-auto p-4">
                <p className="border-2 bg-secondary/60 p-4 rounded-lg">
                  Message :{" "}
                  <span className="text-primary">{queryOutput.message}</span>
                </p>
              </div>
            ) : (
              <div className="h-full overflow-auto p-4">No output</div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default CodeEditor;
