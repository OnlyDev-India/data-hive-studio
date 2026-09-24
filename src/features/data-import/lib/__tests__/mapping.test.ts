import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/shared/api";
import { autoMap, unmappedRequired } from "../mapping";

const col = (name: string, over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  data_type: "TEXT",
  not_null: false,
  primary_key: false,
  default: null,
  ...over,
});

describe("autoMap", () => {
  it("matches by name ignoring case and never reuses a file column", () => {
    const m = autoMap(
      ["ID", "Name", "name"],
      [col("id"), col("name"), col("nick")],
    );
    expect(m).toEqual({ id: 0, name: 1, nick: null });
  });
});

describe("unmappedRequired", () => {
  it("names NOT NULL columns with no default and no mapping", () => {
    const cols = [
      col("a", { not_null: true }),
      col("b", { not_null: true, default: "0" }),
      col("c"),
    ];
    expect(unmappedRequired(cols, { a: null, b: null, c: null })).toEqual([
      "a",
    ]);
    expect(unmappedRequired(cols, { a: 0, b: null, c: null })).toEqual([]);
  });
});
