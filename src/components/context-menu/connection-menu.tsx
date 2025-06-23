"use client";
import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useDispatch } from "react-redux";
import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { toast } from "sonner";
import {
  removeConnection,
  setConnectionLoading,
  setCurrentConnection,
} from "@/redux/features/appdb";
import DeleteModal from "../modals/delete-modal";
import { useRouter } from "next/navigation";
import { testConnection } from "@/lib/actions/fetch-data";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { useAppData } from "@/hooks/useAppData";

const ConnectionMenu = ({
  children,
  connection,
}: {
  children: React.ReactNode;
  connection: ConnectionsType;
}) => {
  const dispatch = useDispatch();
  const router = useRouter();
  const { deleteConnection } = useAppData();

  const handleViewData = () => {
    dispatch(setCurrentConnection(connection));
  };

  const handleConnect = async () => {
    dispatch(setConnectionLoading(true));
    const config = parseConnectionString(connection.connection_string);
    if (config.error) {
      toast.error(config.error);
      dispatch(setConnectionLoading(false));
      return;
    }
    const dbConfig = {
      id: connection.id,
      name: connection.name,
      connection_type: connection.connection_type,
      host: config.host || '',
      port: config.port || 5432,
      username: config.user || '',
      password: config.password || '',
      database: config.database || '',
      connection_string: connection.connection_string,
      save_password: connection.save_password,
      color: connection.color,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    };
    const response = await testConnection({
      connectionDetails: dbConfig as ConnectionDetailsType,
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
    const response = await deleteConnection(connection.id);
    if (response?.success) {
      toast.success("Connection removed Successfully");
      dispatch(removeConnection(connection));
    } else {
      toast.error("Failed to remove connection");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="w-full">{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[150px] px-2 py-1">
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
