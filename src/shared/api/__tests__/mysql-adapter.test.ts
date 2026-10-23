import { describe, expect, it } from "vitest";
import { getAdapter } from "../adapters";

describe("mysql adapter", () => {
  const mysql = getAdapter("mysql");

  it("is registered for both mysql and mariadb", () => {
    expect(mysql?.kind).toBe("mysql");
    expect(getAdapter("mariadb")?.kind).toBe("mariadb");
  });

  it("quotes identifiers with backticks", () => {
    expect(mysql?.quoteIdent("a`b")).toBe("`a``b`");
  });

  it("pages with LIMIT and OFFSET", () => {
    const built = mysql?.buildQuery({
      kind: "select",
      table: "t",
      limit: 50,
      offset: 100,
    });
    expect(built?.sql).toBe("SELECT * FROM `t` LIMIT 50 OFFSET 100");
  });

  it("keeps hex bytes and BIT values bare in copied INSERTs", () => {
    const built = mysql?.buildQuery({
      kind: "insert_literal",
      table: "t",
      columns: ["raw", "b", "note", "n"],
      values: ["0xDEAD", "b'0101'", "it's a \\ test", "7"],
      types: { raw: "varbinary(10)", b: "bit(4)", note: "varchar(20)", n: "int" },
    });
    expect(built?.sql).toBe(
      "INSERT INTO `t` (`raw`, `b`, `note`, `n`) VALUES (0xDEAD, b'0101', 'it''s a \\\\ test', 7);",
    );
  });

  it("keeps a plain number bare in a BIT column and quotes anything else", () => {
    const built = mysql?.buildQuery({
      kind: "insert_literal",
      table: "t",
      columns: ["b", "c", "j"],
      values: ["5", "abc", '{"a": 1}'],
      types: { b: "bit(4)", c: "bit(4)", j: "json" },
    });
    expect(built?.sql).toBe(
      "INSERT INTO `t` (`b`, `c`, `j`) VALUES (5, 'abc', '{\"a\": 1}');",
    );
  });
});
