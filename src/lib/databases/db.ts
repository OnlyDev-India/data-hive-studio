import { ConnectionDetailsType } from "@/types/db.type";
import { PostgresClient } from "./postgres";
import { SqliteClient } from "./sqlite";

declare global {
  let dbConnection: PostgresClient | null;
  let appDB: SqliteClient | null;
}

export const handlers = {
  pgSql: PostgresClient,
  sqlite: SqliteClient,
};

export type HandlersTypes = keyof typeof handlers;

let dbConnection: PostgresClient | SqliteClient | null = null;
let appDB: any | null = null;
export const connectionHandler = async ({
  connectionDetails,
  dbType,
}: {
  connectionDetails: ConnectionDetailsType;
  dbType: keyof typeof handlers | null;
}) => {
  if (!dbType) return { success: false, error: "Database type not found" };
  dbConnection = new handlers[dbType]();
  return await dbConnection.connectDb({ connectionDetails });
};

export const connectToAppDB = async ({
  connectionDetails,
}: {
  connectionDetails: ConnectionDetailsType;
}) => {
  appDB = new SqliteClient();
  return appDB.connectDb({ connectionDetails });
};
export { dbConnection, appDB };
