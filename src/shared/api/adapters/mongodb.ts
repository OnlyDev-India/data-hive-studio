import { quoteIdent } from "../types";
import type { BuiltQuery, QueryDetails, SqlAdapter } from "./types";

/**
 * MongoDB has no SQL. The grid/CRUD + copy-to-SQL flows that go through
 * `buildQuery` are not supported — the document explorer and Mongo console
 * (phases 2-3) talk to dedicated commands instead. This adapter exists purely
 * so `getAdapter("mongodb")` resolves; calling it is a programming error.
 */
export const mongoAdapter: SqlAdapter = {
  kind: "mongodb",
  quoteIdent,
  buildQuery(details: QueryDetails): BuiltQuery {
    void details; // satisfy unused var rule; adapter throws intentionally
    throw new Error("MongoDB has no SQL query builder");
  },
};
