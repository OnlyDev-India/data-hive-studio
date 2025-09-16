import { PostgresClient } from "./postgres";
import { SqliteClient } from "./sqlite";
import { MongoDbClient } from "./mongodb";

export const handlers = {
  pgSql: PostgresClient,
  mongodb: MongoDbClient,
  sqlite: SqliteClient,
};

export type HandlersTypes = keyof typeof handlers;