import { describe, expect, it } from "vitest";
import {
  buildCreate,
  defaultColumn,
  newColumn,
  newIndex,
  normalizeAuto,
  type ColumnDef,
  type Draft,
} from "../model";
import {
  mysqlDefaultSql,
  mysqlTypeSql,
  splitMysqlType,
  valuesSql,
} from "../mysql-model";

const col = (patch: Partial<ColumnDef>): ColumnDef => ({
  ...newColumn(),
  ...patch,
});

const draft = (patch: Partial<Draft>): Draft => ({
  table: "items",
  cols: [defaultColumn(true)],
  fks: [],
  indexes: [],
  constraints: [],
  is_mysql: true,
  ...patch,
});

describe("MySQL new table builder (spec 0025 AC-18)", () => {
  it("writes one CREATE TABLE with the MySQL attributes and table options", () => {
    const built = buildCreate(
      draft({
        cols: [
          defaultColumn(true),
          col({
            name: "kind",
            data_type: "ENUM",
            length: "a, b",
            not_null: true,
            default: "'a'",
          }),
          col({
            name: "changed",
            data_type: "TIMESTAMP",
            default: "CURRENT_TIMESTAMP",
            on_update: true,
            comment: "last write",
          }),
        ],
        indexes: [{ ...newIndex(), columns: ["kind"] }],
        table_options: {
          charset: "utf8mb4",
          collation: "utf8mb4_bin",
          comment: "it's stock",
        },
      }),
    );
    expect(built).toEqual({
      ok: true,
      statements: [built.ok ? built.sql : ""],
      sql:
        "CREATE TABLE `items` (\n" +
        "  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,\n" +
        "  `kind` ENUM('a','b') NOT NULL DEFAULT 'a',\n" +
        "  `changed` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'last write',\n" +
        "  PRIMARY KEY (`id`),\n" +
        "  INDEX `idx_items_kind` (`kind`)\n" +
        ") CHARACTER SET utf8mb4 COLLATE utf8mb4_bin COMMENT = 'it''s stock';",
    });
  });

  it("refuses an ENUM without values and auto increment off the only key", () => {
    expect(
      buildCreate(draft({ cols: [col({ name: "k", data_type: "ENUM" })] })),
    ).toMatchObject({ ok: false });
    const two_keys = [
      defaultColumn(true),
      col({ name: "b", data_type: "INT", primary_key: true }),
    ];
    expect(buildCreate(draft({ cols: two_keys }))).toMatchObject({
      ok: false,
    });
    // The form unticks it before that, the way it does on SQLite.
    expect(normalizeAuto(two_keys, true)[0].auto_increment).toBe(false);
    expect(normalizeAuto([defaultColumn(true)], true)[0].auto_increment).toBe(
      true,
    );
  });

  it("writes types the MySQL way", () => {
    expect(mysqlTypeSql(col({ data_type: "VARCHAR" }))).toBe("VARCHAR(255)");
    expect(
      mysqlTypeSql(
        col({ data_type: "DECIMAL", length: "10,2", unsigned: true }),
      ),
    ).toBe("DECIMAL(10,2) UNSIGNED");
    expect(mysqlTypeSql(col({ data_type: "TEXT", unsigned: true }))).toBe(
      "TEXT",
    );
    expect(valuesSql("'x','it''s'")).toBe("'x','it''s'");
    expect(valuesSql("a, it's ,")).toBe("'a','it''s'");
  });

  it("reads a reported type back into the designer's fields", () => {
    expect(splitMysqlType("int unsigned")).toEqual({
      data_type: "INT",
      length: "",
      unsigned: true,
    });
    expect(splitMysqlType("decimal(10, 2)")).toMatchObject({
      data_type: "DECIMAL",
      length: "10,2",
    });
    expect(splitMysqlType("enum('a','b c')")).toMatchObject({
      data_type: "ENUM",
      length: "'a','b c'",
    });
  });

  it("turns a reported default back into SQL", () => {
    expect(mysqlDefaultSql("anon", "")).toBe("'anon'");
    expect(mysqlDefaultSql("12", "")).toBe("12");
    expect(mysqlDefaultSql("b'0'", "")).toBe("b'0'");
    expect(mysqlDefaultSql("CURRENT_TIMESTAMP", "DEFAULT_GENERATED")).toBe(
      "CURRENT_TIMESTAMP",
    );
    expect(mysqlDefaultSql("uuid()", "DEFAULT_GENERATED")).toBe("(uuid())");
    expect(mysqlDefaultSql(null, "")).toBe("");
  });
});
