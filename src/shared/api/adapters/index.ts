import type { DbKind } from "../types";
import type { SqlAdapter } from "./types";
import { sqliteAdapter } from "./sqlite";
import { postgresAdapter } from "./postgres";

export type {
  BuiltQuery,
  QueryDetails,
  SqlAdapter,
  WhereClause,
} from "./types";

/** One adapter per database kind. Adding a backend = adding an entry here. */
const ADAPTERS: Partial<Record<DbKind, SqlAdapter>> = {
  sqlite: sqliteAdapter,
  postgres: postgresAdapter,
};

/** Get the query builder for a connection's database kind. */
export function getAdapter(kind: DbKind): SqlAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) throw new Error(`No SQL adapter implemented for ${kind}`);
  return adapter;
}
