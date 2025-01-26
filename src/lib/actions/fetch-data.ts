"use server";
import { ConnectionDetailsType } from "./../../types/db.type";
import {
  connectionHandler,
  dbConnection,
  handlers,
  HandlersTypes,
} from "@/lib/databases/db";
import { FilterType } from "@/types/table.type";
import { cookies } from "next/headers";
import { PostgresClient } from "../databases/postgres";
import { SortColumn } from "react-data-grid";
import { PaginationType } from "@/types/file.type";

// console.log(cookies().get("currentConnection")?.value);

// connectionHandler();

export async function connectDb() {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  if (!connectionUrl)
    return {
      response: { success: false, error: "No connection to the database" },
      connectionDetails: null,
    };
  const updatedConnectionDetails: ConnectionDetailsType = JSON.parse(
    connectionUrl?.value || "",
  );
  const dbType = (cookie.get("dbType")?.value as HandlersTypes) || null;
  const response = await connectionHandler({
    connectionDetails: updatedConnectionDetails,
    dbType,
  });
  return { response, connectionDetails: updatedConnectionDetails };
}

export async function changeDataBase({ newConnectionDetails }: any) {
  if (!dbConnection) return null;
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  if (!connectionUrl)
    return { success: false, error: "No connection to the database" };
  const oldConnectionDetails: ConnectionDetailsType = JSON.parse(
    connectionUrl?.value || "",
  );
  cookie.set(
    "currentConnection",
    JSON.stringify({ ...oldConnectionDetails, ...newConnectionDetails }),
  );

  return {
    success: true,
  };
}

export async function currentConnectionDetails() {
  const cookie = cookies();
  const connectionUrl = cookie.get("currentConnection");
  const connectionDetails: ConnectionDetailsType = JSON.parse(
    connectionUrl?.value || "",
  );
  return connectionDetails;
}

export async function isConnectedToDb() {
  if (!dbConnection) return false;
  return true;
}

export async function getTablesWithFieldsFromDb(
  currentSchema: string,
  isUpdateSchema = false,
) {
  if (!dbConnection) return null;
  const table_fields = await dbConnection.getTablesWithFieldsFromDb(
    currentSchema,
    isUpdateSchema,
  );
  return table_fields;
}

export async function getDatabases() {
  if (!dbConnection) return null;
  const databases = await (dbConnection as PostgresClient).getDatabases?.();
  return databases;
}

export async function getSchemas() {
  if (!dbConnection) return null;
  const schemas = await (dbConnection as PostgresClient).getSchemas?.();
  return schemas;
}

export async function getTableColumns(table_name: string) {
  if (!dbConnection) return { columns: null };
  const { columns } = await dbConnection.getTableColumns(table_name);
  return { columns };
}
export async function getTablesData(
  table_name: string,
  options?: {
    filters?: FilterType[];
    orderBy?: SortColumn[];
    pagination?: PaginationType;
  },
) {
  if (!dbConnection)
    return { data: null, error: "No connection to the database" };
  const { data, error, totalRecords } = await dbConnection.getTablesData(
    table_name,
    options,
  );

  return { data: JSON.stringify(data), error, totalRecords };
}

export async function getTableRelations(table_name: string) {
  if (!dbConnection)
    return { data: null, error: "No connection to the database" };
  return await dbConnection.getTableRelations(table_name);
}

export async function dropTable(table_name: string) {
  if (!dbConnection)
    return { data: null, error: "No connection to the database" };
  return await dbConnection.dropTable(table_name);
}

export async function executeQuery(query: string) {
  if (!dbConnection)
    return {
      data: null,
      message: null,
      error: "No connection to the database",
    };
  return await dbConnection.executeQuery(query);
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

  const handler = new handlers[dbType]();
  const { success, error } = await handler.testConnection({
    connectionDetails,
  });
  const cookie = cookies();
  if (success && isConnect) {
    cookie.set("currentConnection", JSON.stringify(connectionDetails));
    cookie.set("dbType", dbType);
  }
  return { success, error };
}

export async function disconnectDb() {
  if (!dbConnection) return false;
  cookies().delete("currentConnection");
  cookies().delete("dbType");
}

export async function updateTable(
  tableName: string,
  data: Array<{
    oldValue: Record<string, any>;
    newValue: Record<string, any>;
  }>,
) {
  if (!dbConnection) return false;
  const response = await dbConnection.updateTable(tableName, data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function deleteTableData(tableName: string, data: any[]) {
  if (!dbConnection) return false;
  const response = await dbConnection.deleteTableData(tableName, data);
  return { ...response, data: JSON.stringify(response.data) };
}

export async function insertTableData(data: {
  tableName: string;
  values: any[][];
}) {
  if (!dbConnection) return false;
  const response = await dbConnection.insertRecord(data);
  return { ...response, data: JSON.stringify(response.data) };
}
