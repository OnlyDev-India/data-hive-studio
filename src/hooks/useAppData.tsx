"use client";

import { useState, useEffect, useCallback } from "react";
import * as appData from "@/lib/actions/app-data";
import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { toast } from "sonner";

export const useAppData = () => {
  const [connectionPath, setConnectionPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionsType[]>([]);

  useEffect(() => {
    const fetchDbPath = async () => {
      try {
        if (typeof window.electron !== "undefined") {
          const path = await window.electron.getConnectionsJsonPath();
          setConnectionPath(path);
          getConnections(path);
        } else {
          throw new Error("Electron environment not available.");
        }
      } catch (err: any) {
        setError(err.message);
        toast.error("Failed to initialize app data", {
          description: err.message,
        });
      } finally {
        setLoading(false);
      }
    };
    fetchDbPath();
  }, []);

  const getConnections = useCallback(async (path?: string) => {
    if (!connectionPath || !path) return { success: false, error: "Connections not available." };
    const response = await appData.getConnections(path || connectionPath);
    if (response?.success) {
      setConnections(response?.data?.rows || []);
    }
    return response;
  }, [connectionPath]);

  const createConnection = useCallback(async (connection: Omit<ConnectionDetailsType, "id">) => {
    if (!connectionPath) return { success: false, error: "Connections not available." };
    return appData.createConnection(connectionPath, connection);
  }, [connectionPath]);

  const updateConnection = useCallback(async (connection: ConnectionDetailsType) => {
    if (!connectionPath) return { success: false, error: "Connections not available." };
    return appData.updateConnection(connectionPath, connection);
  }, [connectionPath]);

  const deleteConnection = useCallback(async (connectionId: string) => {
    if (!connectionPath) return { success: false, error: "Connections not available." };
    return appData.deleteConnection(connectionPath, connectionId);
  }, [connectionPath]);

  return {
    loading,
    error,
    connectionPath,
    getConnections,
    createConnection,
    updateConnection,
    deleteConnection,
  };
};
