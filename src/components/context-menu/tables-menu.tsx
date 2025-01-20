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
    const result = await dropTable(table_name);
    dispatch(fetchTables());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[150px] px-2 py-1">
        <ContextMenuItem onSelect={handleViewData} className="text-xs">
          View Data
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleOpenStructure} className="text-xs">
          View Structure
        </ContextMenuItem>
        <ContextMenuItem disabled className="text-xs">
          Export to file
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleCopyName} className="text-xs">
          Copy Name
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleDropTable} className="text-xs">
          Drop Table
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default TablesMenu;
