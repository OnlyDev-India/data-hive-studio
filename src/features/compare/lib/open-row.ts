import type { KeyVal, TableRef } from "@/shared/api";
import type { GridFilter } from "@/shared/components/data-grid/types";
import { useStudioStore } from "@/shared/store";

/** One key value in the shell syntax the Mongo grid's filter box parses. */
export function mongo_key_literal(k: KeyVal): string {
  switch (k.t) {
    case "int":
      return Number.isSafeInteger(Number(k.v))
        ? k.v
        : `NumberLong(${JSON.stringify(k.v)})`;
    case "num":
    case "ejson":
      return k.v;
    case "bool":
      return String(k.v);
    case "text":
      return JSON.stringify(k.v);
    case "oid":
      return `ObjectId(${JSON.stringify(k.v)})`;
    case "ts":
      return `ISODate(${JSON.stringify(k.v)})`;
    case "uuid":
      return `UUID(${JSON.stringify(k.v)})`;
    case "bytes":
      return `BinData(0, ${JSON.stringify(k.v)})`;
  }
}

/** A filter document matching exactly the row with this key. */
export function mongo_key_filter(key_columns: string[], key: KeyVal[]): string {
  const parts = key_columns.map(
    (col, i) => `${JSON.stringify(col)}: ${mongo_key_literal(key[i])}`,
  );
  return `{ ${parts.join(", ")} }`;
}

export function sql_key_filters(
  key_columns: string[],
  key_display: string[],
): GridFilter[] {
  return key_columns.map((column, i) => ({
    id: i + 1,
    column,
    op: "eq",
    value: key_display[i] ?? "",
    ...(i > 0 ? { conjunction: "AND" as const } : {}),
  }));
}

/** Opens a side's table or collection in its own connection's workspace,
 *  filtered to one row, and switches to that workspace. */
export function open_row(
  ref: TableRef,
  conn_id: string,
  mongo: boolean,
  key_columns: string[],
  key: KeyVal[],
  key_display: string[],
): void {
  const s = useStudioStore.getState();
  if (mongo) {
    s.openMongo(
      conn_id,
      ref.database ?? "",
      ref.table,
      mongo_key_filter(key_columns, key),
    );
  } else {
    s.openTable(
      conn_id,
      ref.table,
      sql_key_filters(key_columns, key_display),
      ref.database,
      ref.schema,
    );
  }
  if (s.activeId !== conn_id) s.setActive(conn_id);
}
