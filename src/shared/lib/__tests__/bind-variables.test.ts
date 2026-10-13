import { describe, expect, it } from "vitest";
import { findBindVariables, substituteBindVariables } from "../bind-variables";

describe("findBindVariables", () => {
  it("finds :name placeholders", () => {
    expect(findBindVariables(["SELECT * FROM t WHERE id = :id"])).toEqual([
      "id",
    ]);
  });

  it("finds ${name} placeholders", () => {
    expect(findBindVariables(["SELECT * FROM t WHERE id = ${id}"])).toEqual([
      "id",
    ]);
  });

  it("dedupes a name repeated across statements, keeping first-seen order", () => {
    expect(
      findBindVariables([
        "SELECT * FROM t WHERE a = :x",
        "SELECT * FROM t WHERE b = :y AND a = :x",
      ]),
    ).toEqual(["x", "y"]);
  });

  it("does not mistake a Postgres :: type cast for a placeholder", () => {
    expect(findBindVariables(["SELECT id::text FROM t"])).toEqual([]);
  });

  it("ignores placeholder-shaped text inside a string literal or comment", () => {
    expect(
      findBindVariables([
        "SELECT 'contact :support for help' AS msg -- see :also here",
      ]),
    ).toEqual([]);
  });

  it("returns nothing for plain SQL with no placeholders", () => {
    expect(findBindVariables(["SELECT 1"])).toEqual([]);
  });
});

describe("substituteBindVariables", () => {
  it("quotes a plain string value", () => {
    expect(
      substituteBindVariables("WHERE name = :name", { name: "O'Brien" }),
    ).toBe("WHERE name = 'O''Brien'");
  });

  it("leaves a numeric value unquoted", () => {
    expect(substituteBindVariables("WHERE age > :min", { min: "18" })).toBe(
      "WHERE age > 18",
    );
  });

  it("substitutes empty input as NULL", () => {
    expect(substituteBindVariables("SET x = :v", { v: "" })).toBe(
      "SET x = NULL",
    );
  });

  it("substitutes ${name} the same way", () => {
    expect(substituteBindVariables("WHERE id = ${id}", { id: "5" })).toBe(
      "WHERE id = 5",
    );
  });

  it("leaves a name missing from values untouched", () => {
    expect(substituteBindVariables("WHERE id = :id", {})).toBe(
      "WHERE id = :id",
    );
  });
});
