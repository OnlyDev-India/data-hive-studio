"use server";

import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { connectToAppDB, AppDBManager } from "../databases/db";
import { SqliteClient } from "../databases/sqlite";

const fs = require("fs").promises;

async function getConnectionsPath() {
  if (typeof window !== "undefined" && window.electron) {
    return window.electron.getConnectionsJsonPath();
  }
  throw new Error("Electron environment not found.");
}

async function readConnections(connectionPath: string): Promise<ConnectionsType[]> {
  const filePath = connectionPath;
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

async function writeConnections(connectionPath: string, connections: ConnectionsType[]): Promise<void> {
  const filePath = connectionPath;
  await fs.writeFile(filePath, JSON.stringify(connections, null, 2));
}

export const connectAppDB = async ({
  connectionDetails,
}: {
  connectionDetails: ConnectionDetailsType;
}) => {
  const { connection_string } = connectionDetails;
  if (!connection_string) return false;
  return connectToAppDB({ connectionDetails });
};

export const testConnection = async ({
  connectionDetails,
}: {
  connectionDetails: ConnectionDetailsType;
}) => {
  return new SqliteClient().testConnection({ connectionDetails });
};

export const getConnections = async (connectionPath: string) => {
  try {
    const connections = await readConnections(connectionPath);
    return { success: true, data: { rows: connections } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const deleteConnection = async (connectionPath: string, connectionId: string) => {
  try {
    let connections = await readConnections(connectionPath);
    const filteredConnections = connections.filter((c) => c.id !== connectionId);
    const deleteConnections = connections.filter((c) => c.id === connectionId);
    if (deleteConnections.length<1) {
      throw new Error("Connection not found to delete.");
    }
    await writeConnections(connectionPath, filteredConnections);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const createConnection = async (connectionPath: string, connection: Omit<ConnectionDetailsType, "id">) => {
  try {
    const connections = await readConnections(connectionPath);
    // Simple ID generation for the new connection
    const newConnection = { ...connection, id: crypto.randomUUID() };
    connections.push(newConnection);
    await writeConnections(connectionPath, connections);
    return { success: true, data: { rows: [newConnection] } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const updateConnection = async (connectionPath: string, connection: ConnectionsType) => {
  try {
    let connections = await readConnections(connectionPath);
    const index = connections.findIndex((c) => c.id === connection.id);
    if (index === -1) throw new Error("Connection not found.");
    connections[index] = { ...connections[index], ...connection };
    await writeConnections(connectionPath, connections);
    return { success: true, data: { rows: [connection] } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const updateConnectionLastUsed = async (connectionPath: string, connectionId: string) => {
  try {
    let connections = await readConnections(connectionPath);
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) throw new Error("Connection not found.");
    // The `last_used` property will be dynamically added or updated.
    (connection as any).last_used = Date.now();
    await writeConnections(connectionPath, connections);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

export const getLastUsedConnection = async (connectionPath: string) => {
  try {
    const connections = await readConnections(connectionPath);
    if (connections.length === 0) return { success: true, data: { rows: [] } };
    const sortedConnections = connections.sort((a, b) => {
      const a_last_used = (a as any).last_used || 0;
      const b_last_used = (b as any).last_used || 0;
      return b_last_used - a_last_used;
    });
    return { success: true, data: { rows: [sortedConnections[0]] } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
