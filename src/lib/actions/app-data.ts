"use server";

import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { connectToAppDB, AppDBManager } from "../databases/db";
import { SqliteClient } from "../databases/sqlite";

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

export const getConnections = async () => {
  const appDBManager = AppDBManager.getInstance();
  const appDB = appDBManager.getConnection();
  if (!appDB) return false;
  return appDB.executeQuery("SELECT * FROM connections;");
};

export const deleteConnection = async (connectionId: string) => {
  const appDBManager = AppDBManager.getInstance();
  const appDB = appDBManager.getConnection();
  if (!appDB) return false;
  return appDB.executeQuery(
    `DELETE FROM connections where id='${connectionId}'`,
  );
};

export const createConnection = async (connection: ConnectionsType) => {
  const appDBManager = AppDBManager.getInstance();
  const appDB = appDBManager.getConnection();
  if (!appDB) return false;

  return appDB.executeQuery(
    `INSERT INTO connections (name, connection_type, connection_string, color) VALUES (?, ?, ?, ?)`,
    [connection.name, connection.connection_type, connection.connection_string, connection.color]
  );
};

export const updateConnection = async (connection: ConnectionsType) => {
  const appDBManager = AppDBManager.getInstance();
  const appDB = appDBManager.getConnection();
  if (!appDB) return false;
  const updateFields = `
    name = '${connection.name}',
    connection_type = '${connection.connection_type}',
    connection_string = '${connection.connection_string}',
    color = '${connection.color}'
  `;

  return appDB.executeQuery(`
    UPDATE connections
    SET ${updateFields}
    WHERE id = '${connection.id}'
  `);
};
