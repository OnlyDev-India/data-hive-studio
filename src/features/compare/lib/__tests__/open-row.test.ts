import { describe, expect, it } from "vitest";
import { mongo_key_filter, sql_key_filters } from "../open-row";

describe("open row filters", () => {
  it("matches a SQL row on every key column", () => {
    expect(sql_key_filters(["a", "b"], ["1", "x"])).toEqual([
      { id: 1, column: "a", op: "eq", value: "1" },
      { id: 2, column: "b", op: "eq", value: "x", conjunction: "AND" },
    ]);
  });

  it("writes Mongo keys in the shell syntax the filter box reads", () => {
    expect(
      mongo_key_filter(["_id"], [{ t: "oid", v: "65f0c0ffee0000000000abcd" }]),
    ).toBe('{ "_id": ObjectId("65f0c0ffee0000000000abcd") }');
    expect(
      mongo_key_filter(
        ["n", "s", "big"],
        [
          { t: "int", v: "7" },
          { t: "text", v: 'a"b' },
          { t: "int", v: "9007199254740993" },
        ],
      ),
    ).toBe('{ "n": 7, "s": "a\\"b", "big": NumberLong("9007199254740993") }');
  });
});
