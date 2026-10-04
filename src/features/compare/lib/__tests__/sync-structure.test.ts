import { describe, expect, it } from "vitest";
import type {
  ColumnInfo,
  IndexInfo,
  TableRef,
  TableSchema,
  TriggerInfo,
} from "@/shared/api";
import {
  index_name_for,
  same_namespace,
  sql_structure_sync,
} from "../sync-structure";

const col = (name: string, pk = false): ColumnInfo => ({
  name,
  data_type: "text",
  not_null: pk,
  primary_key: pk,
  default: null,
});

const idx = (name: string, columns: string[]): IndexInfo => ({
  name,
  unique: false,
  columns,
  origin: "c",
});

const trig = (name: string, table: string): TriggerInfo => ({
  name,
  timing: "AFTER",
  event: "INSERT",
  sql: `CREATE TRIGGER ${name} AFTER INSERT ON ${table} BEGIN SELECT 1; END`,
});

const schema = (
  columns: ColumnInfo[],
  indexes: IndexInfo[] = [],
  triggers: TriggerInfo[] = [],
): TableSchema => ({
  kind: "table",
  columns,
  foreign_keys: [],
  indexes,
  triggers,
});

const ref = (table: string, conn_key = "sqlite:/a.db"): TableRef => ({
  conn_id: "c1",
  conn_key,
  table,
});

describe("sql_structure_sync", () => {
  it("adds and drops columns and reports the drops", () => {
    const s = sql_structure_sync(
      ref("users"),
      ref("users_copy"),
      schema([col("id", true), col("email")]),
      schema([col("id", true), col("legacy")]),
    );
    expect(s.ops.map((o) => o.kind)).toEqual(["drop_column", "add_column"]);
    expect(s.dropped_columns).toEqual(["legacy"]);
    expect(s.ops.every((o) => o.kind !== "rename_table")).toBe(true);
  });

  it("names a new index after the right table in a shared namespace", () => {
    const s = sql_structure_sync(
      ref("users"),
      ref("users_copy"),
      schema(
        [col("id", true), col("email")],
        [idx("users_email_idx", ["email"])],
      ),
      schema([col("id", true), col("email")]),
    );
    expect(s.ops).toEqual([
      expect.objectContaining({
        kind: "create_index",
        name: "users_copy_email_idx",
      }),
    ]);
  });

  it("keeps the index name across separate databases", () => {
    const s = sql_structure_sync(
      ref("users", "sqlite:/a.db"),
      ref("users_copy", "sqlite:/b.db"),
      schema(
        [col("id", true), col("email")],
        [idx("users_email_idx", ["email"])],
      ),
      schema([col("id", true), col("email")]),
    );
    expect(s.ops).toEqual([
      expect.objectContaining({
        kind: "create_index",
        name: "users_email_idx",
      }),
    ]);
  });

  it("leaves trigger changes out when the table names differ", () => {
    const s = sql_structure_sync(
      ref("users"),
      ref("people"),
      schema([col("id", true)], [], [trig("audit", "users")]),
      schema([col("id", true)]),
    );
    expect(s.ops).toEqual([]);
    expect(s.ddl).toEqual([]);
    expect(s.triggers_left_out).toBe(true);
  });

  it("syncs triggers between same named tables", () => {
    const s = sql_structure_sync(
      ref("users", "sqlite:/a.db"),
      ref("users", "sqlite:/b.db"),
      schema([col("id", true)], [], [trig("audit", "users")]),
      schema([col("id", true)]),
    );
    expect(s.ops.map((o) => o.kind)).toEqual(["create_trigger"]);
    expect(s.triggers_left_out).toBe(false);
  });
});

describe("index names", () => {
  it("swaps the left table prefix, else prefixes the right table", () => {
    expect(index_name_for("users_email_idx", "users", "users_copy")).toBe(
      "users_copy_email_idx",
    );
    expect(index_name_for("by_email", "users", "people")).toBe(
      "people_by_email",
    );
    expect(index_name_for("by_email", "users", "users")).toBe("by_email");
  });

  it("treats an unnamed database or schema as possibly shared", () => {
    const a = { ...ref("t", "postgres:app"), schema: "public" };
    expect(same_namespace(a, ref("u", "postgres:app"))).toBe(true);
    expect(same_namespace(a, { ...a, schema: "audit" })).toBe(false);
    expect(same_namespace(a, { ...a, conn_key: "postgres:other" })).toBe(false);
  });
});
