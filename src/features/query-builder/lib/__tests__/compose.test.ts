import { describe, expect, it } from "vitest";
import type { Clause, ClauseKind } from "@/shared/store";
import { compose, shownCount } from "../compose";
import { newClause } from "../model";

const card = (
  kind: ClauseKind,
  body: string,
  extra: Partial<Clause> = {},
): Clause => ({ ...newClause(kind, body), id: kind, ...extra });

const pg = (clauses: Clause[]) =>
  compose({ clauses, dialect: "postgresql", schema: "sales", cap: 1000 });

describe("compose", () => {
  it("builds the final query and caps each preview's input", () => {
    const c = pg([
      card("from", "orders o"),
      card("join", "LEFT JOIN customers c ON c.id = o.customer_id"),
      card("where", "o.total > 10"),
      card("order", "o.total DESC"),
      card("limit", "5 OFFSET 2"),
    ]);
    expect(c.errors.size).toBe(0);
    expect(c.sql).toBe(
      "SELECT * FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.total > 10 ORDER BY o.total DESC LIMIT 5 OFFSET 2",
    );
    expect(c.targets.map((t) => t.clause_id)).toEqual([
      "from",
      "join",
      "where",
      "order",
      "limit",
    ]);
    expect(c.targets[0].sql).toBe(
      "SELECT *, COUNT(*) OVER () AS __dh_count FROM (SELECT * FROM orders LIMIT 1000) AS o LIMIT 20",
    );
    expect(c.targets[4].sql).toMatch(/LIMIT 5 OFFSET 2$/);
    expect(c.targets[4].limit).toEqual({ limit: 5, offset: 2 });
    expect(c.probe).toBe(
      "SELECT COUNT(*) AS n FROM (SELECT 1 FROM orders LIMIT 1001) AS p",
    );
    expect(c.table).toBe("orders");
  });

  it("schema qualifies bare tables in the Postgres output only", () => {
    const clauses = [
      card("from", "orders o"),
      card("join", "JOIN crm.people p ON p.id = o.person_id"),
    ];
    expect(pg(clauses).output).toBe(
      "SELECT * FROM sales.orders o JOIN crm.people p ON p.id = o.person_id",
    );
    const lite = compose({ clauses, dialect: "sqlite", schema: null, cap: 10 });
    expect(lite.output).toBe(lite.sql);
  });

  it("uses the group keys and aggregates when there is no SELECT", () => {
    const c = pg([
      card("from", "orders"),
      card("group", "region", { aggregates: "COUNT(*) AS n, SUM(total) AS s" }),
      card("having", "COUNT(*) > 1"),
    ]);
    expect(c.sql).toBe(
      "SELECT region, COUNT(*) AS n, SUM(total) AS s FROM orders GROUP BY region HAVING COUNT(*) > 1",
    );
  });

  it("aggregates over every row when GROUP BY has no keys", () => {
    const c = pg([
      card("from", "orders"),
      card("group", "", { aggregates: "COUNT(*) AS n" }),
    ]);
    expect(c.sql).toBe("SELECT COUNT(*) AS n FROM orders");
  });

  it("wraps a DISTINCT select so the count is of distinct rows", () => {
    const c = pg([
      card("select", "DISTINCT region"),
      card("from", "orders"),
      card("limit", "3"),
    ]);
    expect(c.targets.map((t) => t.clause_id)).toEqual([
      "from",
      "limit",
      "select",
    ]);
    expect(c.targets[1].sql).toBe(
      "SELECT q.*, COUNT(*) OVER () AS __dh_count FROM (SELECT DISTINCT region FROM (SELECT * FROM orders LIMIT 1000) AS orders LIMIT 3) AS q LIMIT 20",
    );
    expect(c.targets[1].limit).toBeUndefined();
  });

  it("walks the cards in run order and previews the whole query on SELECT", () => {
    const c = pg([
      card("select", "region, total"),
      card("from", "orders"),
      card("where", "total > 1"),
      card("order", "total DESC"),
      card("limit", "5"),
    ]);
    expect(c.sql).toBe(
      "SELECT region, total FROM orders WHERE total > 1 ORDER BY total DESC LIMIT 5",
    );
    expect(c.targets.map((t) => t.clause_id)).toEqual([
      "from",
      "where",
      "order",
      "limit",
      "select",
    ]);
    // The SELECT card's target is the whole query's, LIMIT count included.
    expect(c.targets[4]).toEqual({ ...c.targets[3], clause_id: "select" });
    // WHERE runs before SELECT, so its preview has every column.
    expect(c.targets[1].sql).toMatch(/^SELECT \*, COUNT/);
  });

  it("reads an empty SELECT as every column, never skipped", () => {
    const c = pg([card("select", ""), card("from", "orders")]);
    expect(c.skipped.has("select")).toBe(false);
    expect(c.sql).toBe("SELECT * FROM orders");
    expect(c.targets.map((t) => t.clause_id)).toEqual(["from", "select"]);
  });

  it("gives SELECT no preview while a later card fails", () => {
    const c = pg([
      card("select", ""),
      card("from", "orders"),
      card("order", "total >>"),
    ]);
    expect(c.errors.has("order")).toBe(true);
    expect(c.targets.map((t) => t.clause_id)).toEqual(["from"]);
  });

  it("skips empty optional cards and blocks on an empty FROM", () => {
    const c = pg([
      card("from", "orders"),
      card("where", "  "),
      card("limit", ""),
    ]);
    expect([...c.skipped]).toEqual(["where", "limit"]);
    expect(c.sql).toBe("SELECT * FROM orders");
    const empty = pg([card("from", ""), card("where", "a = 1")]);
    expect(empty.errors.get("from")).toMatch(/Pick a table/);
    expect(empty.targets).toEqual([]);
    expect(empty.sql).toBeNull();
  });

  it("puts a parse error on the card that holds it and stops there", () => {
    const c = pg([
      card("from", "orders"),
      card("where", "total >> AND x"),
      card("order", "total"),
    ]);
    expect(c.errors.get("where")).toMatch(/^Syntax Error/);
    expect(c.errors.has("order")).toBe(false);
    expect(c.targets.map((t) => t.clause_id)).toEqual(["from"]);
    expect(c.sql).toBeNull();
  });

  it("refuses a FROM that is not one table", () => {
    const c = pg([card("from", "(SELECT 1) x")]);
    expect(c.errors.get("from")).toMatch(/one table/);
  });

  it("reads LIMIT as a count and an optional offset", () => {
    expect(
      pg([card("from", "t"), card("limit", "ten")]).errors.get("limit"),
    ).toMatch(/row count/);
  });
});

describe("shownCount", () => {
  it("cuts the LIMIT card's count by its offset and limit", () => {
    const t = { clause_id: "l", sql: "", limit: { limit: 5, offset: 2 } };
    expect(shownCount(37, t)).toBe(5);
    expect(shownCount(4, t)).toBe(2);
    expect(shownCount(1, t)).toBe(0);
    expect(shownCount(37)).toBe(37);
  });
});

describe("compose, statements and bind variables", () => {
  it("sends a statement card as written, with no previews", () => {
    const c = pg([card("statement", "CREATE INDEX i ON t (a);")]);
    expect(c.errors.size).toBe(0);
    expect(c.sql).toBe("CREATE INDEX i ON t (a)");
    expect(c.output).toBe(c.sql);
    expect(c.targets).toEqual([]);
    expect(pg([card("statement", "  ")]).errors.get("statement")).toBe(
      "Write a statement",
    );
  });

  it("previews nothing from a bind variable card on, but still composes", () => {
    const c = pg([
      card("select", ""),
      card("from", "orders o"),
      card("where", "o.id = :id"),
      card("order", "o.total"),
    ]);
    expect(c.errors.size).toBe(0);
    expect([...c.binds]).toEqual(["where"]);
    expect(c.targets.map((t) => t.clause_id)).toEqual(["from"]);
    expect(c.sql).toBe(
      "SELECT * FROM orders o WHERE o.id = :id ORDER BY o.total",
    );
  });

  it("reads ${name} as a bind variable and keeps :: casts", () => {
    const c = pg([
      card("select", "o.total::text AS t"),
      card("from", "orders o"),
      card("where", "o.status = ${status}"),
    ]);
    expect(c.errors.size).toBe(0);
    expect([...c.binds]).toEqual(["where"]);
    const plain = pg([
      card("select", "o.total::text AS t"),
      card("from", "orders o"),
    ]);
    expect(plain.binds.size).toBe(0);
    expect(plain.targets.map((t) => t.clause_id)).toEqual(["from", "select"]);
  });

  it("still finds a parse error after a bind variable card", () => {
    const c = pg([
      card("select", ""),
      card("from", "orders o"),
      card("where", "o.id = :id"),
      card("order", "o.total DESC DESC"),
    ]);
    expect(c.errors.has("order")).toBe(true);
  });
});
