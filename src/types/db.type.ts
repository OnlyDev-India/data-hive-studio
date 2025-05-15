import { BSONType } from "mongodb";
import sqlite3 from "sqlite3";
import { TableForm } from "./table.type";

export interface DBType extends sqlite3.Database {}

export interface ConnectionsType {
  id: string;
  name: string;
  connection_type: string;
  host: string;
  port: number;
  username: string;
  password: string;
  connection_string: string;
  database?: string;
  save_password: number;
  color: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface ConnectionDetailsType extends ConnectionsType {
  id: string;
}

export interface DatabaseClient {
  connectDb: (params: { connectionDetails: ConnectionDetailsType }) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => Promise<void>;
  isConnectedToDb: () => boolean;
  executeQuery: (query: string) => Promise<any>;
  testConnection: (params: { connectionDetails: ConnectionDetailsType }) => Promise<{ success: boolean; error?: string }>;
  getTablesWithFieldsFromDb: (currentSchema: string, isUpdateSchema?: boolean) => Promise<any>;
  getDatabases: () => Promise<any>;
  getSchemas: () => Promise<any>;
  getTableColumns: (tableName: string) => Promise<any>;
  getTablesData: (tableName: string, options?: any) => Promise<any>;
  getTableRelations: (tableName: string) => Promise<any>;
  dropTable: (tableName: string) => Promise<any>;
  updateTable: (tableName: string, data: Array<{ oldValue: Record<string, any>; newValue: Record<string, any> }>) => Promise<any>;
  deleteTableData: (tableName: string, data: any[]) => Promise<any>;
  insertRecord: (data: { tableName: string; values: any[][] }) => Promise<any>;
  createTable: (data: TableForm) => Promise<any>;
}

export const DbConnectionsTypes = [
  { value: "pgSql", label: "Postgres" },
  { value: "mongodb", label: "Mongo Db" },
  { value: "sqlite", label: "sqlite", disabled: true },
];

export const DbConnectionColors = ["#15db95", "#ff5d59", "#fad83b", "#9858ff"];

export enum pgSqlTypes {
  BOOL = 16,
  BYTEA = 17,
  CHAR = 18,
  INT8 = 20,
  INT2 = 21,
  INT4 = 23,
  REGPROC = 24,
  TEXT = 25,
  OID = 26,
  TID = 27,
  XID = 28,
  CID = 29,
  JSON = 114,
  XML = 142,
  PG_NODE_TREE = 194,
  SMGR = 210,
  PATH = 602,
  POLYGON = 604,
  CIDR = 650,
  FLOAT4 = 700,
  FLOAT8 = 701,
  ABSTIME = 702,
  RELTIME = 703,
  TINTERVAL = 704,
  CIRCLE = 718,
  MACADDR8 = 774,
  MONEY = 790,
  MACADDR = 829,
  INET = 869,
  ACLITEM = 1033,
  BPCHAR = 1042,
  VARCHAR = 1043,
  DATE = 1082,
  TIME = 1083,
  TIMESTAMP = 1114,
  TIMESTAMPTZ = 1184,
  INTERVAL = 1186,
  TIMETZ = 1266,
  BIT = 1560,
  VARBIT = 1562,
  NUMERIC = 1700,
  REFCURSOR = 1790,
  REGPROCEDURE = 2202,
  REGOPER = 2203,
  REGOPERATOR = 2204,
  REGCLASS = 2205,
  REGTYPE = 2206,
  UUID = 2950,
  TXID_SNAPSHOT = 2970,
  PG_LSN = 3220,
  PG_NDISTINCT = 3361,
  PG_DEPENDENCIES = 3402,
  TSVECTOR = 3614,
  TSQUERY = 3615,
  GTSVECTOR = 3642,
  REGCONFIG = 3734,
  REGDICTIONARY = 3769,
  JSONB = 3802,
  REGNAMESPACE = 4089,
  REGROLE = 4096,
}

export const MongoDbTypes: string[] = [
  "array",
  "binary",
  "boolean",
  "code",
  "date",
  "decimal128",
  "double",
  "int32",
  "int64",
  "maxKey",
  "minKey",
  "null",
  "object",
  "objectId",
  "BSONRegExp",
  "string",
  "BSONSymbol",
  "Timestamp",
  "undefined",
];
