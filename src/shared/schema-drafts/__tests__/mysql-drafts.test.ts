import { describe, expect, it } from "vitest";
import type { TableSchema } from "@/shared/api";
import {
  build_ops,
  col_is_dirty,
  cols_from_schema,
  describe_schema_changes,
  type ColDraft,
  type TableOptsDraft,
} from "../drafts";

const schema: TableSchema = {
  kind: "table",
  columns: [
    {
      name: "id",
      data_type: "int unsigned",
      not_null: true,
      primary_key: true,
      default: null,
      enum_values: [],
      is_array: false,
      extra: "auto_increment",
    },
    {
      name: "changed",
      data_type: "timestamp",
      not_null: false,
      primary_key: false,
      default: "CURRENT_TIMESTAMP",
      enum_values: [],
      is_array: false,
      extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP",
      comment: "last write",
    },
  ],
  foreign_keys: [],
  indexes: [],
  triggers: [],
  table_options: {
    engine: "InnoDB",
    charset: "utf8mb4",
    collation: "utf8mb4_0900_ai_ci",
    comment: "",
  },
};

const ops_of = (cols: ColDraft[], opts?: TableOptsDraft) =>
  build_ops("items", "items", cols, [], (n) => n, [], [], ["id"], opts);

describe("MySQL schema drafts (spec 0025 AC-18)", () => {
  it("loads each column's attributes and starts clean", () => {
    const cols = cols_from_schema(schema, true);
    expect(cols[1].mysql?.now).toEqual({
      auto_increment: false,
      on_update: true,
      comment: "last write",
    });
    expect(cols[1].default_text).toBe("CURRENT_TIMESTAMP");
    const quoted = cols_from_schema(
      {
        ...schema,
        columns: [{ ...schema.columns[1], default: "anon", extra: "" }],
      },
      true,
    );
    // MySQL reports the raw value; the editor shows SQL.
    expect(quoted[0].default_text).toBe("'anon'");
    expect(cols.some(col_is_dirty)).toBe(false);
    expect(ops_of(cols)).toEqual([]);
    // Other engines get no MySQL attributes.
    expect(cols_from_schema(schema)[1].mysql).toBeUndefined();
  });

  it("sends only the attributes that changed, on an alter", () => {
    const cols = cols_from_schema(schema, true);
    const m = cols[1].mysql!;
    cols[1] = {
      ...cols[1],
      mysql: { ...m, now: { ...m.now, on_update: false, comment: "" } },
    };
    expect(col_is_dirty(cols[1])).toBe(true);
    expect(ops_of(cols)).toEqual([
      {
        kind: "alter_column",
        table: "items",
        column: "changed",
        attrs: { on_update: "", comment: "" },
      },
    ]);
    const [section] = describe_schema_changes(
      "items",
      "items",
      cols,
      [],
      (n) => n,
      [],
      [],
      ["id"],
    );
    expect(section).toMatchObject({
      entity: "column",
      rows: [
        {
          kind: "update",
          before: {
            type: "timestamp on update CURRENT_TIMESTAMP comment 'last write'",
          },
          after: { type: "timestamp" },
        },
      ],
    });
  });

  it("turns table option edits into one set_table_options op", () => {
    const cols = cols_from_schema(schema, true);
    const orig = schema.table_options!;
    expect(
      ops_of(cols, {
        orig,
        now: { ...orig, collation: "utf8mb4_bin", comment: "stock" },
      }),
    ).toEqual([
      {
        kind: "set_table_options",
        table: "items",
        collation: "utf8mb4_bin",
        comment: "stock",
      },
    ]);
    // An emptied picker keeps what the table has.
    expect(ops_of(cols, { orig, now: { ...orig, charset: "" } })).toEqual([]);
  });
});
