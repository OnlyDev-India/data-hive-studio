import { PostgresClient } from "./postgres";
import { SqliteClient } from "./sqlite";
import { MongoDbClient } from "./mongodb";
import { setupProcessCleanup } from "@/lib/utils/process-cleanup";

// Setup process cleanup for serverless environments
setupProcessCleanup();

export const handlers = {
  pgSql: PostgresClient,
  mongodb: MongoDbClient,
  sqlite: SqliteClient,
};

export type HandlersTypes = keyof typeof handlers;