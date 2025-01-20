"use server";

import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { connectToAppDB } from "../databases/db";
import { appDB } from "../databases/db";
import { SqliteClient } from "../databases/sqlite";

export const connectAppDB = async ({
  connectionDetails,
}: {
  connectionDetails: ConnectionDetailsType;
}) => {
  const { connectionString } = connectionDetails;
  if (!connectionString) return false;
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
  if (!appDB) return false;
  return appDB.executeQuery("SELECT * FROM connections;");
};

export const deleteConnection = async (connectionId: string) => {
  if (!appDB) return false;
  return appDB.executeQuery(
    `DELETE FROM connections where id='${connectionId}'`,
  );
};

export const createConnection = async (connection: ConnectionsType) => {
  if (!appDB) return false;
  console.log(connection);

  return appDB.executeQuery(
    `INSERT INTO connections (name, connection_type, connection_string, color) VALUES ('${connection.name}', '${connection.connection_type}', '${connection.connection_string}', '${connection.color}')`, // Removed the extra comma
  );
};

export const updateConnection = async (connection: ConnectionsType) => {
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
