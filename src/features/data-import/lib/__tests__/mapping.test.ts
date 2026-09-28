import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/shared/api";
import {
  addUnmatched,
  autoMap,
  newFieldFor,
  unmappedRequired,
} from "../mapping";

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

describe("newFieldFor", () => {
  it("uses the header, and numbers a name that is taken", () => {
    expect(newFieldFor("age", 2, ["name"], "int").name).toBe("age");
    expect(newFieldFor("Name", 0, ["name"], "string").name).toBe("Name_2");
  });

  it("names a blank header after its position", () => {
    expect(newFieldFor(" ", 3, [], "string").name).toBe("column_4");
  });
});

describe("addUnmatched", () => {
  it("adds a field for each file column nothing matched", () => {
    const parsed = {
      format: "csv",
      header: ["name", "age"],
      rows: [["a", "1"]],
      sourceRows: [2],
    } as const;
    const cols = [col("name")];
    const auto = autoMap([...parsed.header], cols);
    const r = addUnmatched(
      {
        ...parsed,
        header: [...parsed.header],
        rows: [["a", "1"]],
        sourceRows: [2],
      },
      cols,
      auto,
      "mongodb",
    );
    expect(r.added.map((a) => a.name)).toEqual(["age"]);
    expect(r.mapping).toEqual({ name: 0, age: 1 });
  });
});
