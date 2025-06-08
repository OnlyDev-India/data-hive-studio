"use client";
import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useDispatch } from "react-redux";
import {
  addTableFile,
  addTableStructureFile,
} from "@/redux/features/open-files";
import { dropTable } from "@/lib/actions/fetch-data";
import { fetchTables } from "@/redux/features/tables";
import { AppDispatch } from "@/redux/store";
import DeleteModal from "../modals/delete-modal";
import { CopyIcon, EyeIcon, TableIcon, Trash2Icon } from "lucide-react";

const TablesMenu = ({
  children,
  table_name,
}: {
  children: React.ReactNode;
  table_name: string;
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const handleViewData = () => {
    dispatch(addTableFile({ table_name }));
  };
  const handleOpenStructure = () => {
    dispatch(addTableStructureFile({ table_name }));
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(table_name);
  };

  const handleDropTable = async () => {
    await dropTable(table_name);
    dispatch(fetchTables());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[150px] border bg-background/70 px-2 py-1 backdrop-blur-md">
        <ContextMenuItem onSelect={handleViewData} className="cursor-pointer">
          <EyeIcon className="h-4 w-4" />
          View Data
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={handleOpenStructure}
          className="cursor-pointer"
        >
          <TableIcon className="h-4 w-4" />
          View Structure
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleCopyName} className="cursor-pointer">
          <CopyIcon className="h-4 w-4" />
          Copy Name
        </ContextMenuItem>
        <ContextMenuSeparator />
        <DeleteModal 
          title="Drop Table"
          description={`Are you sure you want to drop the table "${table_name}"? This action cannot be undone.`}
          onConfirm={handleDropTable}
        >
          <div className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none text-destructive hover:bg-destructive/20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
            <Trash2Icon className="h-4 w-4" />
            Drop Table
          </div>
        </DeleteModal>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default TablesMenu;
