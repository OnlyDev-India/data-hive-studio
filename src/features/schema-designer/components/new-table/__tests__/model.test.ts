import { describe, expect, it } from "vitest";
import {
  buildCreate,
  canAutoIncrement,
  defaultSuggestions,
  normalizeAuto,
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

describe("defaultSuggestions", () => {
  const col = (over: object) => ({ ...newColumn(), ...over });

  it("offers numbers for a number type and NULL while it is nullable", () => {
    expect(defaultSuggestions(col({ data_type: "INTEGER" }))).toEqual([
      "NULL",
      "0",
      "1",
    ]);
  });

  it("drops NULL once the column is not nullable or a primary key", () => {
    expect(
      defaultSuggestions(col({ data_type: "TEXT", not_null: true })),
    ).toEqual(["''"]);
    expect(
      defaultSuggestions(col({ data_type: "TEXT", primary_key: true })),
    ).toEqual(["''"]);
  });

  it("offers nothing for an auto increment column", () => {
    expect(
      defaultSuggestions(col({ data_type: "INTEGER", auto_increment: true })),
    ).toEqual([]);
  });

  it("keeps Postgres only functions off other databases", () => {
    const uuid = col({ data_type: "UUID", not_null: true });
    expect(defaultSuggestions(uuid)).toEqual([]);
    expect(defaultSuggestions(uuid, true)).toEqual(["gen_random_uuid()"]);
    const ts = col({ data_type: "TIMESTAMPTZ", not_null: true });
    expect(defaultSuggestions(ts, true)).toContain("NOW()");
    expect(defaultSuggestions(ts)).toEqual(["CURRENT_TIMESTAMP"]);
  });
});

describe("normalizeAuto", () => {
  it("keeps an identity on the only INTEGER primary key", () => {
    const cols = [defaultColumn()];
    expect(canAutoIncrement(cols[0], cols)).toBe(true);
    expect(normalizeAuto(cols)).toBe(cols);
  });

  it("unticks it when a second column becomes a primary key", () => {
    const cols = [
      defaultColumn(),
      { ...newColumn(), name: "b", primary_key: true },
    ];
    expect(normalizeAuto(cols)[0].auto_increment).toBe(false);
  });

  it("unticks it when the type is no longer INTEGER", () => {
    const cols = [{ ...defaultColumn(), data_type: "TEXT" }];
    expect(normalizeAuto(cols)[0].auto_increment).toBe(false);
  });
});
