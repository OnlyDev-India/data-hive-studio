"use server";
import { connectionHandler, dbConnection, handlers } from "@/lib/databases/db";
import { cookies } from "next/headers";

// console.log(cookies().get("currentConnection")?.value);

// connectionHandler();

export async function connectDb({
  connectionString,
  dbType,
}: {
  connectionString: string;
  dbType: keyof typeof handlers;
}) {
  return connectionHandler({ connectionString, dbType });
}

export async function isConnectedToDb() {
  if (!dbConnection) return false;
  return true;
}

export async function getTablesWithFieldsFromDb() {
  if (!dbConnection) return null;
  const table_fields = await dbConnection.getTablesWithFieldsFromDb();
  return table_fields;
}

export async function getTableColumns(table_name: string) {
  if (!dbConnection) return { columns: null };
  const { columns } = await dbConnection.getTableColumns(table_name);
  return { columns };
}
export async function getTablesData(table_name: string) {
  if (!dbConnection)
    return { data: null, error: "No connection to the database" };
  const { data, error } = await dbConnection.getTablesData(table_name);

  return { data, error };
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
  connectionString,
  isConnect,
  dbType,
}: {
  connectionString: string;
  isConnect?: boolean;
  dbType?: keyof typeof handlers;
}) {
  if (!dbType) return { success: false, error: "Database type not found" };
  console.log(dbType);

  const handler = new handlers[dbType]();
  const { success, error } = await handler.testConnection({ connectionString });
  const cookie = cookies();
  if (success && isConnect) {
    cookie.set("currentConnection", connectionString);
    cookie.set("dbType", dbType);
  }
  return { success, error };
}

export async function disconnectDb() {
  if (!dbConnection) return false;
  cookies().delete("currentConnection");
  cookies().delete("dbType");
}
