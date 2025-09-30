"use client";

import { useState, useEffect, useCallback } from "react";
import * as appData from "@/lib/actions/app-data";
import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { initConnectedConnection } from "@/redux/features/appdb";
import { LocalAppStorePath } from "@/config/local-app-store-path";

export const useAppData = () => {
  const [connectionPath, setConnectionPath] = useState<string | null>(null);
  // const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // const [connections, setConnections] = useState<ConnectionsType[]>([]);
  const dispatch = useDispatch<AppDispatch>();
  const { connections, loading } = useSelector(
    (state: RootState) => state.appDB,
  );

  useEffect(() => {
    const fetchDbPath = async () => {
      try {
        if (typeof window.electron !== "undefined") {
          const path =
            (await window.electron.getConnectionsJsonPath()) +
            LocalAppStorePath.connectionsJsonPath;
          setConnectionPath(path);
          // getConnections(path);
        }
        dispatch(initConnectedConnection());
      } catch (err: any) {
        setError(err.message);
      } finally {
        // setLoading(false);
      }
    };
    fetchDbPath();
  }, []);

  const createConnection = useCallback(
    async (connection: Omit<ConnectionDetailsType, "id">) => {
      if (!connectionPath) {
        const connections = localStorage.getItem("connections");
        if (connections) {
          const connectionsArray = JSON.parse(connections) as ConnectionsType[];
          connectionsArray.push({ ...connection, id: crypto.randomUUID() });
          localStorage.setItem("connections", JSON.stringify(connectionsArray));
          return { success: true, data: { rows: [connection] }, error: null };
        } else {
          localStorage.setItem(
            "connections",
            JSON.stringify([{ ...connection, id: crypto.randomUUID() }]),
          );
          return { success: true, data: { rows: [connection] }, error: null };
        }
      }
      return appData.createConnection(connectionPath, connection);
    },
    [connectionPath],
  );

  const updateConnection = useCallback(
    async (connection: ConnectionDetailsType) => {
      if (!connectionPath) {
        const connections = localStorage.getItem("connections");
        if (connections) {
          const connectionsArray = JSON.parse(connections) as ConnectionsType[];
          const updatedConnections = connectionsArray.map((c) =>
            c.id === connection.id ? connection : c,
          );
          localStorage.setItem(
            "connections",
            JSON.stringify(updatedConnections),
          );
          return { success: true, data: { rows: [connection] }, error: null };
        } else {
          return { success: false, error: "Connections not available." };
        }
      }
      return appData.updateConnection(connectionPath, connection);
    },
    [connectionPath],
  );

  const deleteConnection = useCallback(
    async (connectionId: string) => {
      if (!connectionPath) {
        const connections = localStorage.getItem("connections");
        if (connections) {
          let connectionsArray = JSON.parse(connections) as ConnectionsType[];
          connectionsArray = connectionsArray.filter(
            (c) => c.id !== connectionId,
          );
          localStorage.setItem("connections", JSON.stringify(connectionsArray));
          return { success: true };
        } else {
          return { success: false, error: "Connections not available." };
        }
      }
      return appData.deleteConnection(connectionPath, connectionId);
    },
    [connectionPath],
  );

  return {
    connections,
    loading,
    error,
    connectionPath,
    // getConnections,
    createConnection,
    updateConnection,
    deleteConnection,
  };
};
