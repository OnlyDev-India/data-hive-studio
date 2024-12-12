"use client";
import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useDispatch } from "react-redux";
import { ConnectionsType } from "@/types/db.type";
import { toast } from "sonner";
import {
  removeConnection,
  setConnectionLoading,
  setCurrentConnection,
} from "@/redux/features/appdb";
import DeleteModal from "../modals/delete-modal";
import { deleteConnection } from "@/lib/actions/app-data";
import { useRouter } from "next/navigation";
import { testConnection } from "@/lib/actions/fetch-data";

const ConnectionMenu = ({
  children,
  connection,
}: {
  children: React.ReactNode;
  connection: ConnectionsType;
}) => {
  const dispatch = useDispatch();
  const router = useRouter();

  const handleViewData = () => {
    dispatch(setCurrentConnection(connection));
  };

  const handleConnect = async () => {
    dispatch(setConnectionLoading(true));
    const response = await testConnection({
      connectionString: connection.connection_string,
      isConnect: true,
      dbType: connection.connection_type as any,
    });
    if (response.success) {
      router.push("/app/editor");
    } else {
      toast.error("Failed to connect");
    }
    dispatch(setConnectionLoading(false));
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(connection.connection_string);
    toast.success("Copied to clipboard!");
  };

  const handleRemove = async () => {
    const {
      data: { rows },
    } = await deleteConnection(connection.id);

    if (rows.affectedRows) {
      toast.success("Connection removed Successfully");
      dispatch(removeConnection(connection));
    } else {
      toast.error("Failed to remove connection");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="px-2 py-1 min-w-[150px]">
        <ContextMenuItem onSelect={handleViewData}>View</ContextMenuItem>
        <ContextMenuItem onSelect={handleConnect}>connect</ContextMenuItem>
        <ContextMenuItem onSelect={handleCopyName}>
          Copy Connection String
        </ContextMenuItem>
        <DeleteModal onConfirm={handleRemove}>
          <div className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
            remove
          </div>
        </DeleteModal>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default ConnectionMenu;
