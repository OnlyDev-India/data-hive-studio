"use client";
import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import CodeEditor from "../views/editor";
import TableView from "../views/table";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "../ui/button";
import {
  ChevronDownIcon,
  CodeIcon,
  Grid2X2PlusIcon,
  PencilRulerIcon,
  PlayIcon,
  PlusIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import {
  addOpenFiles,
  rearrangeOpenFiles,
  removeFile,
  setCurrentFile,
} from "@/redux/features/open-files";
import { cn } from "@/lib/utils";
import { setExecutingQuery, setQueryOutput } from "@/redux/features/query";
import {
  executeQuery,
  getSchemas,
  getTablesWithFieldsFromDb,
} from "@/lib/actions/fetch-data";
import StructureView from "../views/structure";
import { fetchTables } from "@/redux/features/tables";
import NewTableView from "../views/newTable";
import { FileType } from "@/types/file.type";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent } from "../ui/tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import ShortcutGrid from "../common/shortcut-grids";
import { useMonaco } from "@monaco-editor/react";
import { pgSqlLanguageServer } from "../views/editor/pgsql";
import { AppDispatch } from "@/redux/store";

const tabIcons = {
  table: TableIcon,
  file: CodeIcon,
  structure: PencilRulerIcon,
  newTable: Grid2X2PlusIcon,
};

const OpenedFiles = () => {
  const [activeFileTab, setActiveFileTab] = useState("0");
  const [editor, setEditor] = useState<any>(null);
  const { openFiles, currentFile } = useSelector(
    (state: any) => state.openFiles,
  );
  const { currentSchema } = useSelector((state: any) => state.tables);

  const [dragOverIndex, setDragOverIndex] = useState(-1);
  const [dragIndex, setDragIndex] = useState(-1);
  const dispatch = useDispatch<AppDispatch>();

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
    if (openFiles[index]) {
      const currentModal = monaco.editor.getModel(
        `file:///${openFiles[index].id}`,
      );
      if (currentModal) currentModal.dispose();
      dispatch(removeFile({ id: openFiles[index].id }));
    }
  };

  const handleAddNewFile = () => {
    dispatch(addOpenFiles());
  };

  const handleRunQuery = async (edit?: any) => {
    // TODO: add logic to handle multiple query output
    try {
      const editor1 = monaco.editor;

      const currentModal = editor1.getModel(`file:///${currentFile?.id}`);
      const currentEditor = edit || editor;
      if (currentModal && currentEditor) {
        dispatch(setExecutingQuery(true));
        const selection = currentEditor.getSelection();
        const selectedText = currentModal.getValueInRange(selection);
        if (selectedText.trim() === "") return;
        const data = await executeQuery(selectedText);
        dispatch(setQueryOutput(JSON.stringify(data)));
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
    } finally {
      dispatch(setExecutingQuery(false));
    }
  };

  const initializeLanguageServer = async () => {
    let schemas: any = [];
    const schemasWithTables: { [key: string]: any } = {};
    const response = await getSchemas();
    if (response?.schemas) {
      schemas = response?.schemas;
      schemas.forEach(async (schema: any) => {
        const { tables } = await getTablesWithFieldsFromDb(schema.schema_name);
        schemasWithTables[schema.schema_name] = tables;
      });
    }

    // console.log("schemasWithTables", schemasWithTables);

    pgSqlLanguageServer(monaco, { schemasWithTables });
  };

  useEffect(() => {
    if (!monaco || !currentSchema) return;
    initializeLanguageServer();
  }, [monaco, currentSchema]);

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
    <Tabs
      defaultValue="0"
      value={activeFileTab}
      onValueChange={handleOpenedFile}
      className="relative h-full w-full bg-secondary rounded-lg"
    >
      <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg">
        <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
          {openFiles?.map((item: any, index: number) => {
            const Icon = tabIcons[item.type as "table" | "file" | "structure"];
            return (
              <div
                key={index}
                className={cn(
                  "group flex h-full items-center justify-between rounded-md border border-transparent hover:bg-background active:cursor-grabbing",
                  {
                    "border-primary bg-primary/20 hover:bg-primary/40":
                      item.id.toString() === activeFileTab,
                  },
                  { "border-l-2 border-l-red-500 rounded-l-none": index === dragOverIndex },
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
          <div className="sticky right-0 flex h-full items-center bg-secondary px-2">
            <Button
              size="icon"
              className="h-6 w-6 min-w-6"
              onClick={handleAddNewFile}
            >
              <PlusIcon size={14} />
            </Button>
          </div>
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
      {!currentFile?.type && <ShortcutGrid />}
      {currentFile?.type === "file" && (
        <CodeEditor handleRunQuery={handleRunQuery} setEditor={setEditor} />
      )}
      {currentFile?.type === "table" && <TableView />}
      {currentFile?.type === "structure" && <StructureView />}
      {currentFile?.type === "newTable" && <NewTableView />}
    </Tabs>
  );
};

export default OpenedFiles;
