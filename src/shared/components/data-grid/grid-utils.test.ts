import { describe, expect, it } from "vitest";
import { rowToObject, sortRows, toJsonValue, toSqlLiteral } from "./grid-utils";

describe("toJsonValue", () => {
  it("passes through null", () => {
    expect(toJsonValue(null, "text")).toBeNull();
  });

  it("parses boolean-typed columns from '1'/'0' and true/false strings", () => {
    expect(toJsonValue("1", "boolean")).toBe(true);
    expect(toJsonValue("0", "boolean")).toBe(false);
    expect(toJsonValue("true", "bool")).toBe(true);
    expect(toJsonValue("false", "bool")).toBe(false);
  });

  it("re-parses embedded JSON for object/array/bson-typed columns", () => {
    expect(toJsonValue('{"a":1}', "json_object")).toEqual({ a: 1 });
    expect(toJsonValue("[1,2,3]", "array")).toEqual([1, 2, 3]);
    expect(toJsonValue('{"$oid":"x"}', "bson_objectid")).toEqual({
      $oid: "x",
    });
  });

  it("falls back to the raw string when embedded JSON fails to parse", () => {
    expect(toJsonValue("not json", "object")).toBe("not json");
  });

  it("coerces clean numeric-typed values to numbers, leaves the rest as strings", () => {
    expect(toJsonValue("42", "integer")).toBe(42);
    expect(toJsonValue("3.14", "double precision")).toBe(3.14);
    // Not a clean round-trip (e.g. leading zeros / whitespace) — stays a string.
    expect(toJsonValue("42abc", "integer")).toBe("42abc");
  });

  it("leaves untyped/text values as-is", () => {
    expect(toJsonValue("hello", "text")).toBe("hello");
    expect(toJsonValue("hello", undefined)).toBe("hello");
  });
});

describe("toSqlLiteral", () => {
  it("renders null as NULL", () => {
    expect(toSqlLiteral(null, "text")).toBe("NULL");
  });

  it("renders boolean-typed values as 1/0", () => {
    expect(toSqlLiteral("1", "boolean")).toBe("1");
    expect(toSqlLiteral("true", "bool")).toBe("1");
    expect(toSqlLiteral("0", "boolean")).toBe("0");
    expect(toSqlLiteral("false", "bool")).toBe("0");
  });

  it("renders clean numeric values bare (unquoted)", () => {
    expect(toSqlLiteral("42", "integer")).toBe("42");
    expect(toSqlLiteral("3.14", "numeric")).toBe("3.14");
  });

  it("quotes and escapes strings, doubling embedded single quotes", () => {
    expect(toSqlLiteral("O'Brien", "text")).toBe("'O''Brien'");
    expect(toSqlLiteral("plain", "text")).toBe("'plain'");
  });
});

describe("rowToObject", () => {
  it("builds a column->value object using col_index_of and applies toJsonValue per type", () => {
    const raw = ["1", "42", "hello"];
    const columns = ["active", "count", "name"];
    const col_index_of = { active: 0, count: 1, name: 2 };
    const types = { active: "boolean", count: "integer", name: "text" };
    expect(rowToObject(raw, columns, col_index_of, types)).toEqual({
      active: true,
      count: 42,
      name: "hello",
    });
  });

  it("defaults missing column index to 0 and missing types to untyped passthrough", () => {
    const raw = ["only"];
    expect(rowToObject(raw, ["x"], {}, undefined)).toEqual({ x: "only" });
  });
});

describe("sortRows", () => {
  const columns = ["id", "name"];

  it("returns rows unchanged when no sort column is set", () => {
    const rows = [
      ["2", "b"],
      ["1", "a"],
    ];
    expect(sortRows(rows, columns, null, true)).toBe(rows);
  });

  it("returns rows unchanged when the sort column doesn't exist", () => {
    const rows = [["2", "b"]];
    expect(sortRows(rows, columns, "missing", true)).toBe(rows);
  });

  it("sorts numerically when both values are clean numbers", () => {
    const rows = [
      ["10", "a"],
      ["2", "b"],
      ["1", "c"],
    ];
    expect(sortRows(rows, columns, "id", true).map((r) => r[0])).toEqual([
      "1",
      "2",
      "10",
    ]);
    expect(sortRows(rows, columns, "id", false).map((r) => r[0])).toEqual([
      "10",
      "2",
      "1",
    ]);
  });

  it("sorts lexicographically when values aren't clean numbers", () => {
    const rows = [
      ["x", "charlie"],
      ["x", "alice"],
      ["x", "bob"],
    ];
    expect(sortRows(rows, columns, "name", true).map((r) => r[1])).toEqual([
      "alice",
      "bob",
      "charlie",
    ]);
  });

  it("puts NULLs last regardless of direction", () => {
    const rows = [
      ["1", "a"],
      [null, "b"],
      ["3", "c"],
    ];
    expect(sortRows(rows, columns, "id", true).map((r) => r[0])).toEqual([
      "1",
      "3",
      null,
    ]);
    expect(sortRows(rows, columns, "id", false).map((r) => r[0])).toEqual([
      "3",
      "1",
      null,
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      ["2", "b"],
      ["1", "a"],
    ];
    const copy = rows.map((r) => [...r]);
    sortRows(rows, columns, "id", true);
    expect(rows).toEqual(copy);
  });
});
