import { describe, expect, it } from "vitest";
import { compose } from "../compose";
import {
  parseBack,
  parseStatements,
  rebuildCard,
  splitStatements,
  statementNote,
} from "../parse-back";

const kinds = (
  sql: string,
  dialect: "postgresql" | "sqlite" = "postgresql",
) => {
  const r = parseBack(sql, dialect);
  if (!r.ok) throw new Error(r.error);
  return r.clauses.map((c) => [c.kind, c.body, c.aggregates ?? null]);
};

describe("parseBack", () => {
  it("opens a SELECT with two joins, GROUP BY and HAVING as cards in written order", () => {
    const sql =
      "SELECT c.country, COUNT(*) AS n, SUM(o.total) AS revenue FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN shops s ON s.id = o.shop_id WHERE o.total > 10 GROUP BY c.country HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 10 OFFSET 5";
    expect(kinds(sql)).toEqual([
      ["select", "", null],
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

  it("opens statements with bind variables as cards, keeping each as written", () => {
    expect(kinds("SELECT * FROM customers WHERE country = ${cc}")).toEqual([
      ["select", "", null],
      ["from", "customers", null],
      ["where", "country = ${cc}", null],
    ]);
    const r = parseBack(
      "UPDATE orders SET status = 'shipped' WHERE id = :order_id",
      "postgresql",
    );
    expect(r.ok && r.kind).toBe("update");
    expect(r.ok && r.clauses.at(-1)?.body).toBe("id = :order_id");
  });

  it("keeps a typed subquery as a chain beside a bind variable, so output qualifies it", () => {
    const r = parseBack(
      "SELECT * FROM orders o WHERE o.total > 1",
      "postgresql",
    );
    if (!r.ok) throw new Error(r.error);
    const where = rebuildCard(
      r.clauses[2],
      "o.customer_id IN (SELECT id FROM customers) AND o.total > :min_total",
      "postgresql",
      new Set(),
    );
    expect(where?.body).toBe(
      "o.customer_id IN __dh_sub_1 AND o.total > :min_total",
    );
    const c = compose({
      clauses: [r.clauses[0], r.clauses[1], where!],
      dialect: "postgresql",
      schema: "public",
      cap: 10,
    });
    expect(c.output).toContain("(SELECT id FROM public.customers)");
  });

  it("keeps SELECT * implied and DISTINCT on its own card", () => {
    expect(kinds("SELECT * FROM t")).toEqual([
      ["select", "", null],
      ["from", "t", null],
    ]);
    expect(kinds("SELECT DISTINCT a, b FROM t")).toEqual([
      ["select", "DISTINCT a, b", null],
      ["from", "t", null],
    ]);
  });

  it("keeps a select list that is not keys then aggregates on a SELECT card", () => {
    expect(kinds("SELECT COUNT(*), region FROM t GROUP BY region")).toEqual([
      ["select", "COUNT(*), region", null],
      ["from", "t", null],
      ["group", "region", ""],
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
    expect(err("SELECT * FROM (SELECT 1)")).toMatch(/subquery/);
    expect(
      err("SELECT * FROM t WHERE a IN (WITH x AS (SELECT 1) SELECT * FROM x)"),
    ).toMatch(/WITH inside a subquery/);
    expect(err("SELECT 1 FROM t UNION DISTINCT SELECT 2 FROM u")).toMatch(
      /UNION DISTINCT/,
    );
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
    expect(err("CREATE TABLE t (a int)")).toMatch(
      /SELECT, UPDATE, DELETE and INSERT queries only/,
    );
    expect(err("SELEC 1")).toMatch(/Syntax Error/);
  });
});

describe("splitStatements", () => {
  it("names a statement from the -- name: line right above it", () => {
    const sql = [
      "-- setup",
      "CREATE TABLE t (a int);",
      "",
      "-- name: Big orders",
      "SELECT * FROM orders WHERE total > 100;",
      "-- name: Not this one",
      "",
      "UPDATE t SET a = 1",
    ].join("\n");
    expect(splitStatements(sql)).toEqual([
      { text: "CREATE TABLE t (a int)", name: null },
      { text: "SELECT * FROM orders WHERE total > 100", name: "Big orders" },
      { text: "UPDATE t SET a = 1", name: null },
    ]);
  });

  it("drops comment only pieces and keeps comments inside a statement", () => {
    expect(
      splitStatements("-- only a note;\nSELECT a -- the a\nFROM t;\n/* end */"),
    ).toEqual([{ text: "SELECT a -- the a\nFROM t", name: null }]);
  });
});

describe("parseStatements", () => {
  it("keeps every statement, as cards where they fit and as SQL where not", () => {
    const qs = parseStatements(
      [
        "CREATE TABLE t (a int);",
        "-- name: Copy",
        "INSERT INTO t SELECT a FROM s;",
        "SELECT * FROM a JOIN LATERAL (SELECT 1) l ON true;",
        "SELECT id FROM orders",
      ].join("\n"),
      "postgresql",
    );
    expect(qs.map((q) => [q.kind, q.name])).toEqual([
      ["statement", null],
      ["insert", "Copy"],
      ["statement", null],
      ["select", null],
    ]);
    expect(qs[0].clauses[0].body).toBe("CREATE TABLE t (a int)");
  });

  it("notes why a SELECT stays SQL, and when it fits", () => {
    expect(
      statementNote(
        "SELECT * FROM a JOIN LATERAL (SELECT 1) l ON true",
        "postgresql",
      ).note,
    ).toBe("A LATERAL join, kept as SQL");
    expect(statementNote("CREATE TABLE t (a int)", "postgresql")).toEqual({
      fits: false,
      note: null,
      error: "The cards hold SELECT, UPDATE, DELETE and INSERT queries only.",
    });
    expect(statementNote("SELECT a FROM t", "sqlite").fits).toBe(true);
  });
});
