import { describe, expect, it } from "vitest";
import type { Clause, ClauseKind } from "@/shared/store";
import { quoteIdent, sqlDialectOf } from "@/shared/lib/sql-ident";
import { compose } from "../compose";
import { endKinds, newClause } from "../model";
import { parseBack, parseStatements } from "../parse-back";
import { sameName } from "../use-catalog";

const card = (kind: ClauseKind, body = "x", id: string = kind): Clause => ({
  ...newClause(kind, body),
  id,
});

describe("the MySQL builder dialect (spec 0025 AC-23)", () => {
  it("covers both MySQL and MariaDB connections", () => {
    expect(sqlDialectOf("mysql")).toBe("mysql");
    expect(sqlDialectOf("mariadb")).toBe("mysql");
    expect(sqlDialectOf("postgres")).toBe("postgresql");
    expect(sqlDialectOf("sqlite")).toBe("sqlite");
  });

  it("quotes with backticks, only when it has to", () => {
    expect(quoteIdent("orders", "mysql")).toBe("orders");
    expect(quoteIdent("Orders", "mysql")).toBe("Orders");
    expect(quoteIdent("order items", "mysql")).toBe("`order items`");
    expect(quoteIdent("a`b", "mysql")).toBe("`a``b`");
    expect(quoteIdent("select", "mysql")).toBe("`select`");
  });

  it("matches table names without regard to case", () => {
    expect(sameName("Orders", "orders", "mysql")).toBe(true);
    expect(sameName("`orders`", "orders", "mysql")).toBe(true);
  });

  it("offers no ON CONFLICT or RETURNING card", () => {
    const insert = [card("insert", "t (a)"), card("values", "(1)")];
    const kinds = endKinds(insert, "mysql");
    expect(kinds).not.toContain("conflict");
    expect(kinds).not.toContain("returning");
    expect(endKinds(insert, "postgresql")).toContain("conflict");
    const del = [card("delete", "t"), card("where", "a = 1")];
    expect(endKinds(del, "mysql")).not.toContain("returning");
  });

  it("opens a backticked MySQL query as cards and composes it with LIMIT", () => {
    const r = parseBack(
      "SELECT `o`.`id`, COUNT(*) AS n FROM `orders` `o` JOIN `items` i USING (`id`) WHERE `o`.`total` > 10 GROUP BY `o`.`id` ORDER BY n DESC LIMIT 5 OFFSET 10",
      "mysql",
    );
    if (!r.ok) throw new Error(r.error);
    const kinds = r.clauses.map((c) => c.kind);
    expect(kinds).toEqual(["select", "from", "join", "where", "group", "order", "limit"]);
    expect(r.clauses[1].body).toBe("`orders` `o`");
    const out = compose({ clauses: r.clauses, dialect: "mysql", schema: null, cap: 100 });
    expect(out.errors.size).toBe(0);
    expect(out.sql).toContain("FROM `orders` `o`");
    expect(out.sql).toContain("LIMIT 5 OFFSET 10");
  });

  it("splits a script with MySQL comments and keeps every statement", () => {
    const qs = parseStatements(
      "SELECT 1 FROM t # a ; comment\n;\nSELECT `a;b` FROM u;",
      "mysql",
    );
    expect(qs).toHaveLength(2);
  });
});
