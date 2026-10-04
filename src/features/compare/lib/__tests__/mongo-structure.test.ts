import { describe, expect, it } from "vitest";
import type { FieldShape, IndexInfo, TableSchema } from "@/shared/api";
import type { DdlNamedRow } from "@/shared/components/diff-grid/types";
import { flatten_fields, mongo_structure_diff } from "../mongo-structure";

const field = (
  path: string,
  type: string,
  extra: Partial<FieldShape> = {},
): FieldShape => ({
  name: path.split(".").pop()!,
  path,
  type,
  optional: false,
  empty: false,
  depth_truncated: false,
  ...extra,
});

const index = (name: string, columns: string[], unique = false): IndexInfo => ({
  name,
  unique,
  columns,
  origin: name === "_id_" ? "pk" : "c",
  column_dirs: columns.map(() => 1),
});

const schema = (indexes: IndexInfo[]): TableSchema => ({
  kind: "table",
  columns: [],
  foreign_keys: [],
  indexes,
  triggers: [],
});

describe("mongo_structure_diff", () => {
  it("flattens nested fields into dotted paths", () => {
    const flat = flatten_fields([
      field("_id", "objectid"),
      field("address", "object", {
        children: [field("address.city", "string", { optional: true })],
      }),
      field("tags", "array", { element_types: ["string", "int"] }),
    ]);
    expect(flat).toEqual([
      { path: "_id", types: "objectid", optional: false },
      { path: "address", types: "object", optional: false },
      { path: "address.city", types: "string", optional: true },
      { path: "tags", types: "array<string | int>", optional: false },
    ]);
  });

  it("reports paths and indexes that differ, matching indexes by definition", () => {
    const left = {
      fields: [
        field("_id", "objectid"),
        field("address", "object", {
          children: [field("address.city", "string")],
        }),
        field("age", "int"),
      ],
      schema: schema([
        index("_id_", ["_id"]),
        index("email_1", ["email"], true),
      ]),
    };
    const right = {
      fields: [
        field("_id", "objectid"),
        field("address", "object"),
        field("age", "string", { optional: true }),
        field("legacy", "string"),
      ],
      schema: schema([
        index("_id_", ["_id"]),
        index("uniq_email", ["email"], true),
        index("old_1", ["legacy"]),
      ]),
    };
    const sections = mongo_structure_diff("people", right, left);
    const columns = sections.find((s) => s.entity === "column")!;
    expect(
      columns.rows.map((r) => [
        r.kind,
        "before" in r ? r.before?.name : undefined,
        "after" in r ? r.after?.name : undefined,
      ]),
    ).toEqual([
      ["delete", "legacy", undefined],
      ["insert", undefined, "address.city"],
      ["update", "age", "age"],
    ]);
    const indexes = sections.find((s) => s.entity === "index")!;
    expect(
      (indexes.rows as DdlNamedRow[]).map((r) => [r.kind, r.name]),
    ).toEqual([["delete", "old_1"]]);
  });

  it("is empty when both collections match", () => {
    const side = {
      fields: [field("_id", "objectid")],
      schema: schema([index("_id_", ["_id"])]),
    };
    expect(mongo_structure_diff("c", side, side)).toEqual([]);
  });
});
