// Thin re-export barrel. `client.ts` used to be one 1090-line file; it's now
// split by domain (dispatch primitives, server-admin, connection lifecycle +
// DDL, query execution, streaming) but kept as the single import path since
// most of the app already imports from here (directly or via the
// `shared/api` barrel) and there's no reason to force a mass path rewrite.
export * from "./dispatch";
export * from "./server-admin";
export * from "./connection";
export * from "./query";
export * from "./streaming";
