import { describe, expect, it } from "vitest";
import { compose } from "../compose";
import { parseBack } from "../parse-back";

const kinds = (
  sql: string,
  dialect: "postgresql" | "sqlite" = "postgresql",
) => {
  const r = parseBack(sql, dialect);
  if (!r.ok) throw new Error(r.error);
  return r.clauses.map((c) => [c.kind, c.body, c.aggregates ?? null]);
};

describe("parseBack", () => {
  it("opens a SELECT with two joins, GROUP BY and HAVING as the same cards", () => {
    const sql =
      "SELECT c.country, COUNT(*) AS n, SUM(o.total) AS revenue FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN shops s ON s.id = o.shop_id WHERE o.total > 10 GROUP BY c.country HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10 OFFSET 5";
    expect(kinds(sql)).toEqual([
      ["from", "orders o", null],
      ["join", "JOIN customers c ON c.id = o.customer_id", null],
      ["join", "LEFT JOIN shops s ON s.id = o.shop_id", null],
      ["where", "o.total > 10", null],
      ["group", "c.country", "COUNT(*) AS n, SUM(o.total) AS revenue"],
      ["having", "COUNT(*) > 1", null],
      ["order", "n DESC", null],
      ["limit", "10 OFFSET 5", null],
    ]);
    const r = parseBack(sql, "postgresql");
    if (!r.ok) throw new Error();
    const c = compose({
      clauses: r.clauses,
      dialect: "postgresql",
      schema: null,
      cap: 10,
    });
    expect(c.sql).toBe(sql);
  });

  it("keeps SELECT * implied and DISTINCT on its own card", () => {
    expect(kinds("SELECT * FROM t")).toEqual([["from", "t", null]]);
    expect(kinds("SELECT DISTINCT a, b FROM t")).toEqual([
      ["from", "t", null],
      ["select", "DISTINCT a, b", null],
    ]);
  });

  it("keeps a select list that is not keys then aggregates on a SELECT card", () => {
    expect(kinds("SELECT COUNT(*), region FROM t GROUP BY region")).toEqual([
      ["from", "t", null],
      ["group", "region", ""],
      ["select", "COUNT(*), region", null],
    ]);
  });

  it("reads SQLite's LIMIT offset, count", () => {
    expect(kinds("SELECT * FROM t LIMIT 2, 5", "sqlite").at(-1)).toEqual([
      "limit",
      "5 OFFSET 2",
      null,
    ]);
  });

  it("refuses what the cards can't hold, naming it", () => {
    const err = (sql: string) => {
      const r = parseBack(sql, "postgresql");
      return r.ok ? "" : r.error;
    };
    expect(err("WITH x AS (SELECT 1) SELECT * FROM x")).toMatch(/WITH/);
    expect(err("SELECT 1 UNION SELECT 2")).toMatch(/UNION/);
    expect(err("SELECT * FROM (SELECT 1) s")).toMatch(/subquery/);
    expect(err("SELECT * FROM generate_series(1, 3) g")).toMatch(/function/);
    expect(err("SELECT * FROM a, b")).toMatch(/comma join/);
    expect(err("SELECT * FROM a JOIN LATERAL (SELECT 1) l ON true")).toMatch(
      /LATERAL/,
    );
    expect(err("SELECT a FROM t WINDOW w AS (PARTITION BY a)")).toMatch(
      /WINDOW/,
    );
    expect(err("SELECT * FROM t FOR UPDATE")).toMatch(/FOR UPDATE/);
    expect(err("SELECT * INTO n FROM t")).toMatch(/SELECT INTO/);
    expect(err("SELECT 1; SELECT 2")).toMatch(/more than one/);
    expect(err("UPDATE t SET a = 1")).toMatch(/anything but a SELECT/);
    expect(err("SELEC 1")).toMatch(/Syntax Error/);
  });
});
