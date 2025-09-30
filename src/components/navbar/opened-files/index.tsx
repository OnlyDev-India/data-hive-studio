"use client";
import dynamic from "next/dynamic";
import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";
import TableView from "../../views/table";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "../../ui/button";
import {
  ChevronDownIcon,
  CodeIcon,
  Grid2X2PlusIcon,
  PencilRulerIcon,
  PlayIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import {
  rearrangeOpenFiles,
  removeFile,
  setCurrentFile,
} from "@/redux/features/open-files";
import { cn } from "@/lib/utils";
import { setQueryExecution, updateQueryOutput } from "@/redux/features/query";
import { executeQuery } from "@/lib/actions/fetch-data";
import StructureView from "../../views/structure";
import { fetchTables } from "@/redux/features/tables";
import NewTableView from "../../views/newTable";
import { FileType } from "@/types/file.type";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Tooltip, TooltipContent } from "../../ui/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import ShortcutGrid from "../../common/shortcut-grids";
import { useMonaco } from "@monaco-editor/react";
import { AppDispatch, RootState } from "@/redux/store";
import AddNewFile from "./add-new-button";
import VisualizerView from "../../views/visualizer";
import ResizableLayout from "@/components/common/resizable-layout";
import OutputTerminal from "@/components/views/editor/output-terminal";
import { useAppData } from "@/hooks/useAppData";
import { initConnectedConnection } from "@/redux/features/appdb";

// Dynamically import the CodeEditor component
const CodeEditor = dynamic(() => import("../../views/editor"), { ssr: false });

const tabIcons = {
  table: TableIcon,
  file: CodeIcon,
  structure: PencilRulerIcon,
  newTable: Grid2X2PlusIcon,
};

const TabsContentChild: Record<FileType["type"], React.ComponentType<any>> = {
  file: CodeEditor,
  table: TableView,
  structure: StructureView,
  newTable: NewTableView,
  visualizer: VisualizerView,
};

const OpenedFiles = ({ dbType }: { dbType: string }) => {
  const [activeFileTab, setActiveFileTab] = useState("0");
  const [editor, setEditor] = useState<any>(null);
  const { openFiles, currentFile } = useSelector(
    (state: RootState) => state.openFiles,
  );

  const [dragOverIndex, setDragOverIndex] = useState(-1);
  const [dragIndex, setDragIndex] = useState(-1);
  const { updateConnection } = useAppData();
  const { queryHistory, connectedConnection } = useSelector(
    (state: RootState) => state.appDB,
  );
  const dispatch = useDispatch<AppDispatch>();

  const TabsContentChildComponent =
    TabsContentChild[currentFile?.type as FileType["type"]];

  const monaco = useMonaco();

  useEffect(() => {
    if (currentFile) {
      setActiveFileTab(
        openFiles
          .find((file: FileType) => file.id === currentFile.id)
          ?.id.toString() || "0",
      );
    }
  }, [currentFile]);

  const handleOpenedFile = (fileId: string) => {
    setActiveFileTab(fileId);
    const file = openFiles.find((file: any) => file.id === fileId);
    dispatch(setCurrentFile(file));
  };

  const handleCloseFile = (
    e: React.MouseEvent<HTMLParagraphElement>,
    index: number,
  ) => {
    e.stopPropagation();
    // check if file is open
    if (openFiles[index] && monaco?.editor) {
      const currentModal = monaco.editor.getModel(
        monaco.Uri.parse(`file:///${openFiles[index].id}`),
      );
      if (currentModal) currentModal.dispose();
      dispatch(removeFile({ id: openFiles[index].id }));
    }
  };

  const handleRunQuery = async (edit?: any) => {
    try {
      if (!monaco?.editor) return;
      const editor1 = monaco.editor;

      const currentModal = editor1.getModel(
        monaco.Uri.parse(`file:///${currentFile?.id}`),
      );
      const currentEditor = edit || editor;
      if (currentModal && currentEditor) {
        const selection = currentEditor.getSelection();
        const selectedText = currentModal.getValueInRange(selection);
        if (selectedText.trim() === "") return;

        if (dbType === "mongodb") {
          const queries = selectedText
            .split(";")
            .map((query: string) => query.trim())
            .filter((query: string) => query.length > 0);
          if (connectedConnection) {
            const updatedQueryHistory = JSON.parse(
              JSON.stringify(queryHistory),
            );
            queries.forEach((query: string) => {
              updatedQueryHistory.push(query);
            });
            updateConnection({
              ...connectedConnection,
              queryHistory: updatedQueryHistory,
            });
            dispatch(initConnectedConnection());
          }

          if (queries.length > 1) {
            // Handle multiple queries - create separate output tabs for each
            for (const query of queries) {
              const outputId = crypto.randomUUID();
              try {
                dispatch(
                  setQueryExecution({ id: outputId, executingQuery: true }),
                );
                const data = await executeQuery(query);
                dispatch(updateQueryOutput({ id: outputId, output: data }));
                if (data && "isTableEffected" in data) {
                  if (data.isTableEffected) {
                    if (data && "effectedRows" in data) {
                      toast.success(`Updated ${data.effectedRows} rows`);
                    }
                    dispatch(fetchTables());
                  }
                }
              } catch (error) {
                console.log(error);
              } finally {
                dispatch(
                  setQueryExecution({ id: outputId, executingQuery: false }),
                );
              }
            }
            return;
          }
        }

        // Handle single query (original behavior)
        const outputId = crypto.randomUUID();
        dispatch(setQueryExecution({ id: outputId, executingQuery: true }));
        const data = await executeQuery(selectedText);
        dispatch(updateQueryOutput({ id: outputId, output: data }));
        if (data && "isTableEffected" in data) {
          // Type guard to check if isTableEffected exists
          if (data.isTableEffected) {
            if (data && "effectedRows" in data) {
              toast.success(`Updated ${data.effectedRows} rows`);
            }
            dispatch(fetchTables());
          }
        }
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    dropIndex: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragIndex !== dropIndex) {
      dispatch(rearrangeOpenFiles({ dragIndex, dropIndex }));
    }
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(-1);
    setDragIndex(-1);
  };

  return (
    <ResizableLayout
      child1={
        <Tabs
          defaultValue="0"
          value={activeFileTab}
          onValueChange={handleOpenedFile}
          className="relative h-full w-full rounded-lg bg-secondary"
        >
          <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg">
            <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2 pr-0">
              {openFiles?.map((item: any, index: number) => {
                const Icon =
                  tabIcons[item.type as "table" | "file" | "structure"];
                return (
                  <div
                    key={index}
                    className={cn(
                      "group flex h-full items-center justify-between rounded-md border border-transparent hover:bg-background active:cursor-grabbing",
                      {
                        "border-primary bg-primary/20 hover:bg-primary/40":
                          item.id.toString() === activeFileTab,
                      },
                      {
                        "rounded-l-none border-l-2 border-l-red-500":
                          index === dragOverIndex,
                      },
                    )}
                    draggable
                    onDragStart={() => {
                      handleDragStart(index);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(index);
                    }}
                    onDrop={(e) => handleDrop(e, index)}
                    onDragEnd={handleDragEnd}
                  >
                    <TabsTrigger
                      value={item.id.toString()}
                      className="h-full rounded-md bg-transparent pr-0 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent"
                    >
                      <span className="flex items-center gap-1 text-xs">
                        {Icon && <Icon size={14} className="text-primary" />}
                        {item.name}
                      </span>
                    </TabsTrigger>
                    <p
                      className="invisible flex h-6 w-6 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground group-hover:visible"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseFile(e, index);
                      }}
                    >
                      <XIcon size={14} />
                    </p>
                  </div>
                );
              })}
              <AddNewFile />
            </TabsList>
            <div className="flex h-10 items-center gap-2 bg-secondary px-2">
              {currentFile?.type === "file" && (
                <div className="flex h-7 items-center rounded-md border border-border">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={"ghost"}
                        size="icon"
                        className="h-6 w-6 min-w-6 rounded-r-none hover:bg-popover"
                        onClick={() => handleRunQuery()}
                      >
                        <PlayIcon size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="space-y-1">
                      Run
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant={"ghost"}
                        size="icon"
                        className="h-6 w-6 min-w-6 rounded-l-none hover:bg-popover"
                        onClick={() => handleRunQuery()}
                      >
                        <ChevronDownIcon size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="text-xs"
                        onSelect={() => handleRunQuery()}
                      >
                        Run query
                        <DropdownMenuShortcut className="text-[10px]">
                          ctrl + enter
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
          {currentFile?.type ? (
            <TabsContentChildComponent
              dbType={dbType}
              handleRunQuery={handleRunQuery}
              setEditor={setEditor}
            />
          ) : (
            <ShortcutGrid />
          )}
        </Tabs>
      }
      child2={
        currentFile?.type === "file" ? <OutputTerminal dbType={dbType} /> : null
      }
      activeId="editor-query-output"
      config="editor"
      direction="vertical"
      isSidebar={false}
    />
  );
};

export default OpenedFiles;
