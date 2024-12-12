import { PostgresClient } from "./postgres";
import { SqliteClient } from "./sqlite";

declare global {
  let dbConnection: PostgresClient | null;
  let appDB: SqliteClient | null;
}

// const db =
//   global.db ||
//   new PostgresClient(
//     "postgresql://project-planit_owner:YQUIuwtVO6Z3@ep-still-grass-a51vu090.us-east-2.aws.neon.tech/project-planit?sslmode=require"
//   );
// export { db };


export const handlers = {
  pgSql: PostgresClient,
  sqlite: SqliteClient,
};

export type HandlersTypes = keyof typeof handlers;

let dbConnection: PostgresClient | SqliteClient | null = null;
let appDB: any | null = null;
export const connectionHandler = async ({
  connectionString,
  dbType,
}: {
  connectionString: string;
  dbType: keyof typeof handlers | null;
}) => {
  // dbConnection = new PostgresClient(
  //   "postgresql://project-planit_owner:YQUIuwtVO6Z3@ep-still-grass-a51vu090.us-east-2.aws.neon.tech/project-planit?sslmode=require"
  // );
  if (!dbType) return { success: false, error: "Database type not found" };
  dbConnection = new handlers[dbType]();
  return dbConnection.connectDb({ connectionString });
};

export const connectToAppDB = async ({ connectionString }: any) => {
  appDB = new SqliteClient();
  return appDB.connectDb({ connectionString });
};
export { dbConnection, appDB };
