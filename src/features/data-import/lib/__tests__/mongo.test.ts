import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/shared/api";
import { asTarget, proposeColumns } from "../build-create-sql";
import { makeContext, prepare } from "../prepare";
import { typedCell } from "../typed-cell";
import type { ParsedFile } from "../types";

const col = (name: string, data_type: string): ColumnInfo => ({
  name,
  data_type,
  not_null: false,
  primary_key: false,
  default: null,
});

const csv = (rows: string[][], header: string[]): ParsedFile => ({
  format: "csv",
  header,
  rows,
  sourceRows: rows.map((_, i) => i + 2),
});

describe("import into a collection", () => {
  const cols = [
    col("_id", "objectid"),
    col("age", "integer"),
    col("name", "string"),
  ];
  const mapping = { _id: 0, age: 1, name: 2 };

  it("leaves an empty CSV cell out of the document and keeps text as text", () => {
    const parsed = csv(
      [
        ["", "42", "Ada"],
        ["", "", ""],
      ],
      ["_id", "age", "name"],
    );
    const ctx = makeContext(parsed, mapping, cols, "mongodb", false);
    const p = prepare({
      table: "people",
      parsed,
      ctx,
      onError: "skip",
      dryRun: false,
      sourceLabel: "f.csv",
    });
    expect(p.request?.data).toEqual({
      kind: "docs",
      docs: [{ age: "42", name: "Ada" }, {}],
    });
    expect(p.request?.create_sql).toBeNull();
  });

  it("writes an empty string for a text field on request", () => {
    const parsed = csv([["", "", ""]], ["_id", "age", "name"]);
    const ctx = makeContext(parsed, mapping, cols, "mongodb", true);
    const p = prepare({
      table: "people",
      parsed,
      ctx,
      onError: "skip",
      dryRun: false,
      sourceLabel: "f.csv",
    });
    expect(p.request?.data).toEqual({ kind: "docs", docs: [{ name: "" }] });
  });

  it("keeps JSON null and nested values", () => {
    const parsed: ParsedFile = {
      format: "json",
      header: ["a", "nest"],
      rows: [[null, { x: [1] }]],
      sourceRows: [1],
    };
    const ctx = makeContext(
      parsed,
      { a: 0, nest: 1 },
      [col("a", "string"), col("nest", "object")],
      "mongodb",
      false,
    );
    const p = prepare({
      table: "c",
      parsed,
      ctx,
      onError: "rollback",
      dryRun: false,
      sourceLabel: "f.json",
    });
    expect(p.request?.data).toEqual({
      kind: "docs",
      docs: [{ a: null, nest: { x: [1] } }],
    });
  });

  it("still fails a bad integer before sending", () => {
    const parsed = csv([["", "abc", "x"]], ["_id", "age", "name"]);
    const ctx = makeContext(parsed, mapping, cols, "mongodb", false);
    const p = prepare({
      table: "people",
      parsed,
      ctx,
      onError: "skip",
      dryRun: false,
      sourceLabel: "f.csv",
    });
    expect(p.request).toBeNull();
    expect(p.failures[0]).toMatchObject({ sourceRow: 2, column: "age" });
  });

  it("sends nothing when a Roll back import has a failed row and no Check is possible", () => {
    const parsed = csv(
      [
        ["", "abc", "x"],
        ["", "1", "y"],
      ],
      ["_id", "age", "name"],
    );
    const ctx = makeContext(parsed, mapping, cols, "mongodb", false);
    const base = {
      table: "people",
      parsed,
      ctx,
      dryRun: false,
      sourceLabel: "f.csv",
    };
    expect(
      prepare({ ...base, onError: "rollback", checkable: false }).request,
    ).toBeNull();
    // On a server that can Check, the good rows go as a Check to find the rest.
    expect(
      prepare({ ...base, onError: "rollback", checkable: true }).request
        ?.dry_run,
    ).toBe(true);
  });

  it("types a new collection's fields as JSON", () => {
    const parsed = csv(
      [["1", "2.5", "true", "2024-03-01", "hi"]],
      ["n", "x", "ok", "d", "s"],
    );
    const proposed = proposeColumns(parsed);
    const target = asTarget(proposed, "mongodb");
    expect(target.columns.map((c) => c.data_type)).toEqual([
      "integer",
      "double",
      "boolean",
      "date",
      "string",
    ]);
    const ctx = makeContext(
      parsed,
      target.mapping,
      target.columns,
      "mongodb",
      false,
      true,
    );
    const p = prepare({
      table: "new_c",
      parsed,
      ctx,
      onError: "rollback",
      dryRun: false,
      sourceLabel: "f.csv",
    });
    expect(p.request?.data).toEqual({
      kind: "docs",
      docs: [
        {
          n: 1,
          x: 2.5,
          ok: true,
          d: { $date: "2024-03-01T00:00:00Z" },
          s: "hi",
        },
      ],
    });
  });
});

describe("typedCell", () => {
  it("sends a huge whole number as a 64 bit integer", () => {
    expect(typedCell("9007199254740993", "integer")).toEqual({
      ok: true,
      value: { $numberLong: "9007199254740993" },
    });
  });

  it("reads a zoneless timestamp as UTC and refuses a non date", () => {
    expect(typedCell("2024-03-01 10:30:00", "date")).toEqual({
      ok: true,
      value: { $date: "2024-03-01T10:30:00Z" },
    });
    expect(typedCell("soon", "date")).toMatchObject({ ok: false });
  });

  it("parses JSON text into a nested document", () => {
    expect(typedCell('{"a":1}', "object")).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });
});
