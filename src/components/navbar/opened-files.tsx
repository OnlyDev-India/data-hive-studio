"use client";
import React, { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import CodeEditor from "../views/editor";
import TableView from "../views/table";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "../ui/button";
import {
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
  removeFile,
  setCurrentFile,
  updateFile,
} from "@/redux/features/open-files";
import { cn } from "@/lib/utils";
import { setExecutingQuery, setQueryOutput } from "@/redux/features/query";
import { executeQuery } from "@/lib/actions/fetch-data";
import StructureView from "../views/structure";
import { fetchTables } from "@/redux/features/tables";
import NewTableView from "../views/newTable";
import { FileType } from "@/types/file.type";

const tabIcons = {
  table: TableIcon,
  file: CodeIcon,
  structure: PencilRulerIcon,
  newTable: Grid2X2PlusIcon,
};

const OpenedFiles = () => {
  const [activeFileTab, setActiveFileTab] = useState("0");
  const { editor } = useSelector((state: any) => state.editor);
  const {
    openFiles,
    currentFile,
  }: { openFiles: FileType[]; currentFile: FileType | null } = useSelector(
    (state: any) => state.openFiles
  );
  const dispatch = useDispatch();

  // useEffect(() => {
  //   if (openFiles.length > 0) {
  //     setActiveFileTab((openFiles.length - 1).toString());
  //     dispatch(setCurrentFile(openFiles[openFiles.length - 1]));
  //   }
  // }, [openFiles.length]);

  useEffect(() => {
    if (currentFile) {
      setActiveFileTab(
        openFiles.findIndex((file) => file.id === currentFile.id).toString()
      );
    }
  }, [currentFile]);

  const handleOpenedFile = (index: string) => {
    setActiveFileTab(index);
    dispatch(setCurrentFile(openFiles[parseInt(index)]));
  };

  const handleCloseFile = (
    e: React.MouseEvent<HTMLParagraphElement>,
    index: number
  ) => {
    e.stopPropagation();
    // check if file is open
    if (openFiles[index]) {
      dispatch(removeFile({ id: openFiles[index].id }));
    }
  };

  const handleAddNewFile = () => {
    dispatch(addOpenFiles());
  };

  const handleRunQuery = async () => {
    // const editor = editorInstance;
    if (editor) {
      dispatch(setExecutingQuery(true));
      const selection = editor.getSelection(); // Get the selection range
      const selectedText = editor.getModel().getValueInRange(selection); // Get the text within the selected range
      if (selectedText.trim() === "") return;
      const data = await executeQuery(selectedText);
      dispatch(setQueryOutput(JSON.stringify(data)));
      dispatch(setExecutingQuery(false));

      if (data && "isTableEffected" in data) {
        // Type guard to check if isTableEffected exists
        if (data.isTableEffected) {
          dispatch(fetchTables() as any);
        }
      }
    }
  };

  const handleSaveFile = () => {
    if (editor) {
      // get the whole code from the editor
      const code = editor.getValue();

      dispatch(updateFile({ id: currentFile?.id, code }));
    }
  };

  return (
    <Tabs
      defaultValue="0"
      value={activeFileTab}
      onValueChange={handleOpenedFile}
      className="w-full h-full relative"
    >
      <div className="flex items-center justify-between w-full overflow-auto no-scrollbar">
        <TabsList className="justify-start w-full overflow-auto no-scrollbar bg-secondary py-0 pr-0 h-[var(--tabs-height)] rounded-none">
          {openFiles?.map((item: any, index: number) => {
            const Icon = tabIcons[item.type as "table" | "file" | "structure"];
            return (
              <div
                key={index}
                className={cn(
                  "h-full flex items-center justify-between group border-t-2 border-x border-t-transparent",
                  {
                    "border-t-primary bg-background":
                      index.toString() === activeFileTab,
                  }
                )}
              >
                <TabsTrigger
                  value={index.toString()}
                  className="h-full rounded-none pr-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                >
                  <span className="flex items-center gap-1 text-xs">
                    {Icon && <Icon size={14} className="text-primary" />}
                    {item.name}
                  </span>
                </TabsTrigger>
                <p
                  className="h-6 w-6 invisible group-hover:visible flex items-center justify-center text-muted-foreground cursor-pointer hover:text-foreground"
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
          <div className="h-full px-2 sticky right-0 flex items-center bg-secondary">
            <Button
              size="icon"
              className="h-6 w-6 min-w-6"
              onClick={handleAddNewFile}
            >
              <PlusIcon size={14} />
            </Button>
          </div>
        </TabsList>
        <div className="h-10 px-2 flex items-center bg-secondary gap-2">
          {currentFile?.type === "file" && (
            <Button
              variant={"ghost"}
              size="icon"
              className="h-6 w-6 min-w-6"
              onClick={handleRunQuery}
            >
              <PlayIcon size={14} />
            </Button>
          )}
          {/* <Button
            disabled
            className="h-6 text-foreground"
            onClick={handleSaveFile}
          >
            Save
          </Button> */}
        </div>
      </div>
      {currentFile?.type === "file" && <CodeEditor />}
      {currentFile?.type === "table" && <TableView />}
      {currentFile?.type === "structure" && <StructureView />}
      {currentFile?.type === "newTable" && <NewTableView />}
    </Tabs>
  );
};

export default OpenedFiles;
