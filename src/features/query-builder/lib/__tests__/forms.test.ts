import { describe, expect, it } from "vitest";
import { parseConditions, printConditions } from "../forms/conditions";
import {
  parseGroup,
  parseOrder,
  parseSelect,
  printGroup,
  printOrder,
  printSelect,
} from "../forms/lists";
import { parseJoinForm, printJoin } from "../forms/tables";
import { literal, valueKind } from "../literals";

const none = () => null;

describe("conditions", () => {
  it("round trips rows with one nested group", () => {
    const text = "a = 1 AND (b = 'x' OR c IS NULL)";
    const form = parseConditions(text, "postgresql");
    expect(form).not.toBeNull();
    expect(form!.join).toBe("AND");
    expect(form!.items).toHaveLength(2);
    expect(printConditions(form!, none)).toBe(text);
  });

  it("reads IN, NOT IN, BETWEEN, LIKE and negative numbers", () => {
    const text =
      "d IN (1, 2) AND g NOT IN ('x', 'y') AND e BETWEEN 1 AND 5 AND f LIKE 'a%' AND t.n > -3";
    const form = parseConditions(text, "postgresql")!;
    expect(form.items.map((i) => i.kind === "cond" && i.op)).toEqual([
      "IN",
      "NOT IN",
      "BETWEEN",
      "LIKE",
      ">",
    ]);
    expect(printConditions(form, none)).toBe(text);
  });

  it("reads HAVING on an aggregate", () => {
    const form = parseConditions("COUNT(*) > 10", "sqlite")!;
    expect(form.items[0]).toMatchObject({ column: "COUNT(*)", op: ">" });
  });

  it("sends what it can't show to the SQL view", () => {
    expect(
      parseConditions("CASE WHEN a THEN 1 END = 1", "postgresql"),
    ).toBeNull();
    expect(parseConditions("a = b.c", "postgresql")).toBeNull();
    expect(
      parseConditions("(a = 1 AND (b = 2 OR c = 3))", "postgresql"),
    ).toBeNull();
  });

  it("quotes a typed value by the column's type", () => {
    const form = parseConditions("", "postgresql")!;
    form.items.push(
      { kind: "cond", column: "total", op: ">", values: ["10"], kinds: [null] },
      { kind: "cond", column: "code", op: "=", values: ["10"], kinds: [null] },
      {
        kind: "cond",
        column: "name",
        op: "=",
        values: ["O'Hara"],
        kinds: [null],
      },
    );
    const types: Record<string, string> = {
      total: "numeric",
      code: "text",
      name: "varchar(40)",
    };
    expect(printConditions(form, (c) => types[c] ?? null)).toBe(
      "total > 10 AND code = '10' AND name = 'O''Hara'",
    );
  });
});

describe("literals", () => {
  it("writes numbers bare, booleans upper case, the rest quoted", () => {
    expect(literal("12.5", valueKind("numeric", "12.5"))).toBe("12.5");
    expect(literal("true", valueKind("boolean", "true"))).toBe("TRUE");
    expect(literal("2024-01-01", valueKind("date", "2024-01-01"))).toBe(
      "'2024-01-01'",
    );
    expect(literal("abc", valueKind("integer", "abc"))).toBe("'abc'");
    expect(literal("7", valueKind(null, "7"))).toBe("7");
  });
});

describe("group, select and order", () => {
  it("round trips GROUP BY keys and aggregates", () => {
    const g = parseGroup(
      "c.country, region",
      "COUNT(*) AS n, COUNT(DISTINCT o.id) AS orders, SUM(total) AS revenue, MAX(total)",
      "postgresql",
    );
    expect(g).not.toBeNull();
    expect(g!.aggregates.map((a) => a.fn)).toEqual([
      "COUNT",
      "COUNT DISTINCT",
      "SUM",
      "MAX",
    ]);
    expect(printGroup(g!)).toEqual({
      keys: "c.country, region",
      aggregates:
        "COUNT(*) AS n, COUNT(DISTINCT o.id) AS orders, SUM(total) AS revenue, MAX(total)",
    });
    expect(parseGroup("lower(x)", "", "postgresql")).toBeNull();
    expect(parseGroup("", "SUM(*)", "postgresql")).toBeNull();
  });

  it("round trips SELECT columns and aliases, leaving DISTINCT and expressions to SQL", () => {
    const s = parseSelect("c.name AS customer, total", "sqlite")!;
    expect(s).toEqual([
      { expr: "c.name", alias: "customer" },
      { expr: "total", alias: "" },
    ]);
    expect(printSelect(s)).toBe("c.name AS customer, total");
    expect(parseSelect("DISTINCT region", "sqlite")).toBeNull();
    expect(parseSelect("total * 2", "sqlite")).toBeNull();
  });

  it("round trips ORDER BY", () => {
    const o = parseOrder("total DESC, c.name", "postgresql")!;
    expect(o).toEqual([
      { expr: "total", dir: "DESC" },
      { expr: "c.name", dir: "ASC" },
    ]);
    expect(printOrder(o)).toBe("total DESC, c.name");
    expect(parseOrder("total DESC NULLS LAST", "postgresql")).toBeNull();
  });
});

describe("join", () => {
  it("reads ON as column pairs, or keeps its text", () => {
    const j = parseJoinForm(
      "LEFT JOIN customers c ON c.id = o.customer_id AND c.shop = o.shop",
      "postgresql",
    )!;
    expect(j.type).toBe("LEFT JOIN");
    expect(j.table).toEqual({ schema: null, name: "customers", alias: "c" });
    expect(j.on).toEqual({
      mode: "pairs",
      pairs: [
        { left: "c.id", right: "o.customer_id" },
        { left: "c.shop", right: "o.shop" },
      ],
    });
    expect(printJoin(j)).toBe(
      "LEFT JOIN customers c ON c.id = o.customer_id AND c.shop = o.shop",
    );
    const t = parseJoinForm("JOIN x ON x.a > o.b", "postgresql")!;
    expect(t.on).toEqual({ mode: "text", text: "x.a > o.b" });
    expect(t.type).toBe("INNER JOIN");
    expect(parseJoinForm("CROSS JOIN x", "postgresql")).toBeNull();
    expect(parseJoinForm("JOIN x USING (id)", "postgresql")).toBeNull();
  });
});

describe("cardColumns", async () => {
  const { cardColumns } = await import("../columns");
  const { newClause } = await import("../model");
  const cols: Record<string, { name: string; type: string }[]> = {
    orders: [
      { name: "id", type: "integer" },
      { name: "total", type: "numeric" },
    ],
    customers: [
      { name: "id", type: "integer" },
      { name: "country", type: "text" },
    ],
  };
  const of = (t: { name: string }) => cols[t.name];
  const card = (
    kind: Parameters<typeof newClause>[0],
    body: string,
    extra = {},
  ) => ({
    ...newClause(kind, body),
    id: kind,
    ...extra,
  });

  it("offers bare columns for one table and qualified ones for a join", () => {
    const one = cardColumns(
      [card("from", "orders"), card("where", "")],
      of,
      "postgresql",
    );
    expect(one.where.map((c) => c.name)).toEqual(["id", "total"]);
    const two = cardColumns(
      [
        card("from", "orders o"),
        card("join", "JOIN customers c ON c.id = o.id"),
        card("where", ""),
      ],
      of,
      "postgresql",
    );
    expect(two.from.map((c) => c.name)).toEqual(["o.id", "o.total"]);
    expect(two.where.map((c) => c.name)).toEqual([
      "o.id",
      "o.total",
      "c.id",
      "c.country",
    ]);
  });

  it("offers group outputs after GROUP BY and the SELECT names in ORDER BY", () => {
    const q = [
      card("from", "orders"),
      card("group", "total", { aggregates: "COUNT(*) AS n" }),
      card("having", ""),
      card("order", ""),
    ];
    const c = cardColumns(q, of, "postgresql");
    expect(c.having.map((x) => x.name)).toEqual([
      "total",
      "COUNT(*)",
      "id",
      "total",
    ]);
    expect(c.order.map((x) => x.name)).toEqual(["total", "n"]);
    const s = cardColumns(
      [card("from", "orders"), card("select", "total AS t"), card("order", "")],
      of,
      "postgresql",
    );
    expect(s.order).toEqual([{ name: "t", type: "numeric" }]);
  });
});
