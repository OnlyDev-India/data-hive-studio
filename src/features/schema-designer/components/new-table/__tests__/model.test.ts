import { describe, expect, it } from "vitest";
import {
  buildCreate,
  defaultColumn,
  newColumn,
  newConstraint,
  newIndex,
  splitType,
  type Draft,
} from "../model";

const draft = (over: Partial<Draft> = {}): Draft => ({
  table: "users",
  cols: [defaultColumn()],
  fks: [],
  indexes: [],
  constraints: [],
  ...over,
});

describe("buildCreate", () => {
  it("writes the length after a type that takes one", () => {
    const cols = [
      { ...newColumn(), name: "email", data_type: "VARCHAR", length: "255" },
      { ...newColumn(), name: "note", data_type: "TEXT", length: "10" },
    ];
    const r = buildCreate(draft({ cols }));
    expect(r.ok && r.sql).toContain("VARCHAR(255)");
    // A length on a type that takes none is ignored.
    expect(r.ok && r.sql).not.toContain("TEXT(10)");
  });

  it("adds one CREATE INDEX per index after the table", () => {
    const r = buildCreate(
      draft({ indexes: [{ ...newIndex(), columns: ["id"], unique: true }] }),
    );
    expect(r.ok && r.statements).toHaveLength(2);
    expect(r.ok && r.statements[1]).toContain(
      'CREATE UNIQUE INDEX "idx_users_id" ON "users" ("id")',
    );
  });

  it("refuses an index on a column that no longer exists", () => {
    const r = buildCreate(
      draft({ indexes: [{ ...newIndex(), columns: ["gone"] }] }),
    );
    expect(r).toEqual({
      ok: false,
      error: 'Index uses "gone", which is not a column.',
    });
  });

  it("writes table level UNIQUE and CHECK constraints", () => {
    const r = buildCreate(
      draft({
        constraints: [
          { ...newConstraint(), name: "u_id", columns: ["id"] },
          { ...newConstraint(), kind: "CHECK", expr: "id > 0" },
        ],
      }),
    );
    expect(r.ok && r.sql).toContain('CONSTRAINT "u_id" UNIQUE ("id")');
    expect(r.ok && r.sql).toContain("CHECK (id > 0)");
  });

  it("asks for a CHECK expression", () => {
    const r = buildCreate(
      draft({ constraints: [{ ...newConstraint(), kind: "CHECK" }] }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("splitType", () => {
  it("splits a reported type into base and length", () => {
    expect(splitType("varchar(255)")).toEqual({
      data_type: "VARCHAR",
      length: "255",
    });
    expect(splitType("numeric(10, 2)")).toEqual({
      data_type: "NUMERIC",
      length: "10,2",
    });
    expect(splitType("integer")).toEqual({ data_type: "INTEGER", length: "" });
  });
});
