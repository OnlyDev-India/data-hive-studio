import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/shared/api";
import { asTarget, buildCreateSql, typeName, type NewColumn } from "../build-create-sql";
import { checkCell, columnKind } from "../validate-cell";

const col = (name: string, data_type: string): ColumnInfo => ({
  name,
  data_type,
  not_null: false,
  primary_key: false,
  default: null,
});

describe("importing into MySQL and MariaDB (spec 0025 AC-21)", () => {
  const cols: NewColumn[] = [
    { name: "code", kind: "text", primaryKey: true, from: 0 },
    { name: "Full name", kind: "text", primaryKey: false, from: 1 },
    { name: "price", kind: "decimal", primaryKey: false, from: 2 },
    { name: "at", kind: "timestamp", primaryKey: false, from: 3 },
    { name: "meta", kind: "json", primaryKey: false, from: 4 },
  ];

  it("creates the table with backticks and MySQL types", () => {
    expect(buildCreateSql("new `t`", cols, "mariadb")).toBe(
      "CREATE TABLE `new ``t``` (\n  `code` varchar(255) NOT NULL,\n  `Full name` text,\n  `price` double,\n  `at` datetime,\n  `meta` json,\n  PRIMARY KEY (`code`)\n)",
    );
    expect(typeName("boolean", "mysql")).toBe("boolean");
    expect(typeName("integer", "mysql")).toBe("int");
  });

  it("checks cells against the same types the table gets", () => {
    const { columns } = asTarget(cols, "mysql");
    expect(columns[0].data_type).toBe("varchar(255)");
    expect(columns[1].data_type).toBe("text");
  });

  it("treats tinyint(1) as a boolean and sends 1 or 0", () => {
    expect(columnKind(col("ok", "tinyint(1)"))).toBe("boolean");
    expect(columnKind(col("n", "tinyint(4)"))).toBe("integer");
    expect(columnKind(col("n", "int unsigned"))).toBe("integer");
    expect(checkCell("yes", "boolean", "mysql")).toEqual({ ok: true, value: 1 });
    expect(checkCell(false, "boolean", "mariadb")).toEqual({ ok: true, value: 0 });
    expect(checkCell("true", "boolean", "postgres")).toEqual({ ok: true, value: true });
  });

  it("leaves BIT and binary cells to the server's binding rules", () => {
    expect(columnKind(col("b", "bit(4)"))).toBe("other");
    expect(columnKind(col("raw", "varbinary(16)"))).toBe("other");
    expect(checkCell("b'0101'", "other", "mysql")).toEqual({ ok: true, value: "b'0101'" });
  });
});
