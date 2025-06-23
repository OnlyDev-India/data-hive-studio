"use server";
import { ConnectionDetailsType } from "./../../types/db.type";
import { ConnectionManager, handlers, HandlersTypes } from "@/lib/databases/db";
import { EnhancedConnectionManager } from "@/lib/databases/connection-manager";
import { FilterType, TableForm } from "@/types/table.type";
import { cookies } from "next/headers";
import { SortColumn } from "react-data-grid";
import { PaginationType } from "@/types/file.type";
import { updateConnection } from "./app-data";

// console.log(cookies().get("currentConnection")?.value);

// connectionHandler();

export async function connectDb() {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  if (!connectionUrl) {
    return {
      response: { success: false, error: "No connection to the database" },
      connectionDetails: null,
    };
  }
  if (!connectionUrl.value) {
    return {
      response: { success: false, error: "No connection to the database" },
      connectionDetails: null,
    };
  }

  const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl?.value || "");
  const dbType = (cookie.get("dbType")?.value as HandlersTypes) || null;

  if (!dbType) {
    return {
      response: { success: false, error: "Database type not specified" },
      connectionDetails: null,
    };
  }

  // Use enhanced connection manager with auto-reconnection
  const connectionManager = EnhancedConnectionManager.getInstance();
  const response = await connectionManager.connect({
    connectionDetails,
    dbType,
  });

  return { response, connectionDetails };
}

export async function changeDataBase({ newConnectionDetails }: { newConnectionDetails: Partial<ConnectionDetailsType> }) {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  if (!connectionUrl) {
    return { success: false, error: "No connection to the database" };
  }

  const oldConnectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl?.value || "");
  const updatedConnectionDetails = { ...oldConnectionDetails, ...newConnectionDetails };
  
  cookie.set("currentConnection", JSON.stringify(updatedConnectionDetails));

  // Reconnect with new details using enhanced connection manager
  const connectionManager = EnhancedConnectionManager.getInstance();
  const dbType = (cookie.get("dbType")?.value as HandlersTypes) || null;
  
  if (!dbType) {
    return { success: false, error: "Database type not specified" };
  }

  const response = await connectionManager.connect({
    connectionDetails: updatedConnectionDetails,
    dbType,
  });

  return response;
}

export async function currentConnectionDetails() {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  const connectionDetails: ConnectionDetailsType = JSON.parse(
    connectionUrl?.value || "",
  );
  return connectionDetails;
}

export async function getCurrentDatabaseType() {
  const cookie = cookies();
  const dbType = cookie.get("dbType")?.value;
  return dbType;
}

export async function isConnectedToDb() {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const currentConnection = connectionManager.getCurrentConnection();
  return currentConnection !== null;
}

export async function getTablesWithFieldsFromDb(
  currentSchema: string,
  isUpdateSchema = false,
) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return null;
  
  return await connection.getTablesWithFieldsFromDb(currentSchema, isUpdateSchema);
}

export async function getDatabases() {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return null;

  return await connection.getDatabases();
}

export async function getSchemas() {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return null;
  
  return await connection.getSchemas();
}

export async function getTableColumns(table_name: string) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { columns: null };
  
  return await connection.getTableColumns(table_name);
}

export async function getTablesData(
  table_name: string,
  options?: {
    filters?: FilterType[];
    orderBy?: SortColumn[];
    pagination?: PaginationType;
  },
) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { data: null, error: "No connection to the database" };
  
  const { data, error, totalRecords } = await connection.getTablesData(
    table_name,
    options,
  );

  return { data: JSON.stringify(data), error, totalRecords };
}

export async function getTableRelations(table_name: string) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { data: null, error: "No connection to the database" };
  
  return await connection.getTableRelations(table_name);
}

export async function dropTable(table_name: string) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { data: null, error: "No connection to the database" };
  
  return await connection.dropTable(table_name);
}

export async function executeQuery(query: string) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { data: null, message: null, error: "No connection to the database" };
  
  return await connection.executeQuery(query);
}

export async function testConnection({
  connectionDetails,
  isConnect,
  dbType,
}: {
  connectionDetails: ConnectionDetailsType;
  isConnect?: boolean;
  dbType?: keyof typeof handlers;
}) {
  if (!dbType) return { success: false, error: "Database type not found" };

  if (!(dbType in handlers))
    return { success: false, error: "Database type not found" };

  const handler = new handlers[dbType]();
  const { success, error } = await handler.testConnection({
    connectionDetails,
  });
  
  const cookie = cookies();
  if (success && isConnect) {
    cookie.set("currentConnection", JSON.stringify(connectionDetails));
    cookie.set("dbType", dbType as string);
  }
  return { success, error };
}

export async function disconnectDb(connectionPath: string|null) {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  if (!connectionUrl) return false;

  const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl.value);
  const connectionManager = EnhancedConnectionManager.getInstance();
  await connectionManager.disconnect(connectionDetails.id);
  
  if (connectionPath) {
    await updateConnection(connectionPath, {
      ...connectionDetails,
      is_current: false,
    });
  }
  cookie.delete("currentConnection");
  cookie.delete("dbType");
  return true;
}

export async function updateTable(
  tableName: string,
  data: Array<{
    oldValue: Record<string, any>;
    newValue: Record<string, any>;
  }>,
) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return false;
  
  const response = await connection.updateTable(tableName, data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function deleteTableData(tableName: string, data: any[]) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return false;
  
  const response = await connection.deleteTableData(tableName, data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function insertTableData(data: {
  tableName: string;
  values: any[][];
}) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return false;
  
  const response = await connection.insertRecord(data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function createTable(data: TableForm) {
  const connectionManager = EnhancedConnectionManager.getInstance();
  const connection = connectionManager.getCurrentConnection();
  if (!connection) return { data: null, error: "Not connected to Database" };
  
  const response = await connection.createTable(data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function getConnectionStatus() {
  try {
    const cookie = cookies();
    const connectionUrl = cookie.get("currentConnection");
    if (!connectionUrl?.value) {
      return {
        success: false,
        error: "No active connection found"
      };
    }
    const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl.value);
    const connectionId = connectionDetails.id;
    const connectionManager = EnhancedConnectionManager.getInstance();
    const connectionState = connectionManager.getConnectionState(connectionId);
    const isHealthy = connectionManager.isConnectionHealthy(connectionId);
    const lastError = connectionManager.getLastError(connectionId);
    if (!connectionState) {
      return {
        success: false,
        error: "Connection state not found"
      };
    }
    return {
      success: true,
      connectionId,
      state: {
        isConnected: connectionState.isConnected,
        lastHealthCheck: connectionState.lastHealthCheck,
        connectionAttempts: connectionState.connectionAttempts,
        lastError: connectionState.lastError,
        isReconnecting: connectionState.isReconnecting,
        isHealthy,
      }
    };
  } catch (error) {
    console.error("Error getting connection status:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function forceReconnect(connectionId?: string) {
  try {
    const cookie = cookies();
    let id = connectionId;
    if (!id) {
      const connectionUrl = cookie.get("currentConnection");
      if (!connectionUrl?.value) {
        return { success: false, error: "No active connection found" };
      }
      const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl.value);
      id = connectionDetails.id;
    }
    const connectionManager = EnhancedConnectionManager.getInstance();
    const success = await connectionManager.forceReconnect(id!);
    return {
      success,
      message: success ? "Reconnection initiated" : "Reconnection failed"
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function getConnectionState(connectionId?: string) {
  try {
    const cookie = cookies();
    let id = connectionId;
    if (!id) {
      const connectionUrl = cookie.get("currentConnection");
      if (!connectionUrl?.value) {
        return { success: false, error: "No active connection found" };
      }
      const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl.value);
      id = connectionDetails.id;
    }
    const connectionManager = EnhancedConnectionManager.getInstance();
    const state = connectionManager.getConnectionState(id!);
    return {
      success: true,
      state
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
