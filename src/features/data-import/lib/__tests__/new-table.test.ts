import { describe, expect, it } from "vitest";
import {
  asTarget,
  buildCreateSql,
  newTableProblem,
  proposeColumns,
  suggestTableName,
  type NewColumn,
} from "../build-create-sql";
import { inferKind } from "../infer-types";
import { makeContext, prepare } from "../prepare";
import type { ParsedFile } from "../types";

describe("inferKind", () => {
  it("picks the narrowest kind that fits", () => {
    expect(inferKind(["1", "2", "-3"])).toBe("integer");
    expect(inferKind(["1", "3000000000"])).toBe("bigint");
    expect(inferKind(["1", "2.5"])).toBe("decimal");
    expect(inferKind(["true", "FALSE", ""])).toBe("boolean");
    expect(inferKind(["2024-01-31", "2024-02-01"])).toBe("date");
    expect(inferKind(["2024-01-31", "2024-02-01T10:00:00Z"])).toBe("timestamp");
    expect(inferKind([{ a: 1 }, [1]])).toBe("json");
    expect(inferKind([1, 2, 3])).toBe("integer");
  });

  it("keeps text when digits would be lost or kinds mix", () => {
    expect(inferKind(["007", "008"])).toBe("text");
    expect(inferKind(["1", "abc"])).toBe("text");
    expect(inferKind(["1", "true"])).toBe("text");
    expect(inferKind(["", null])).toBe("text");
  });
});

const cols = (over: Partial<NewColumn>[] = []): NewColumn[] =>
  [
    { name: "id", kind: "integer", primaryKey: true, from: 0 },
    { name: "Full name", kind: "text", primaryKey: false, from: 1 },
    { name: "active", kind: "boolean", primaryKey: false, from: 2 },
  ].map((c, i) => ({ ...c, ...over[i] })) as NewColumn[];

describe("buildCreateSql", () => {
  it("quotes names and adds the primary key", () => {
    expect(buildCreateSql('my "t"', cols(), "postgres")).toBe(
      'CREATE TABLE "my ""t""" (\n  "id" integer NOT NULL,\n  "Full name" text,\n  "active" boolean,\n  PRIMARY KEY ("id")\n)',
    );
  });

  it("uses SQLite type names and a composite key", () => {
    const sql = buildCreateSql(
      "t",
      cols([{}, {}, { primaryKey: true }]),
      "sqlite",
    );
    expect(sql).toContain('"active" BOOLEAN NOT NULL');
    expect(sql).toContain('PRIMARY KEY ("id", "active")');
  });

  it("names the table from the file", () => {
    expect(suggestTableName("Sales 2024.csv")).toBe("sales_2024");
    expect(suggestTableName("2024.csv")).toBe("t_2024");
    expect(suggestTableName("...csv")).toBe("imported_data");
  });
});

describe("newTableProblem", () => {
  it("blocks a taken name, an empty name and duplicate columns", () => {
    expect(newTableProblem("", cols(), [])).toMatch(/name/);
    expect(newTableProblem("Users", cols(), ["users"])).toMatch(
      /already exists/,
    );
    expect(newTableProblem("t", cols([{}, { name: "ID" }]), [])).toMatch(
      /Two columns/,
    );
    expect(newTableProblem("t", cols(), ["other"])).toBeNull();
  });
});

describe("a new table import", () => {
  const parsed: ParsedFile = {
    format: "csv",
    header: ["id", "Full name", "active"],
    rows: [
      ["1", "Ada", "yes"],
      ["2", "Bo", "nope"],
    ],
    sourceRows: [2, 3],
  };

  it("sends create_sql and checks cells against the chosen types", () => {
    const newCols = proposeColumns(parsed);
    expect(newCols.map((c) => c.kind)).toEqual(["integer", "text", "text"]);
    newCols[2].kind = "boolean";
    const target = asTarget(newCols, "sqlite");
    const prep = prepare({
      table: "people",
      createSql: buildCreateSql("people", newCols, "sqlite"),
      parsed,
      ctx: makeContext(parsed, target.mapping, target.columns, "sqlite", false),
      onError: "rollback",
      dryRun: false,
      sourceLabel: "people.csv",
    });
    expect(prep.request?.create_sql).toMatch(/^CREATE TABLE "people"/);
    expect(prep.failures).toHaveLength(1);
    expect(prep.failures[0]).toMatchObject({ sourceRow: 3, column: "active" });
    // A client failure in Roll back mode still sends the rest as a Check.
    expect(prep.request?.dry_run).toBe(true);
  });
});
