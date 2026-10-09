import { describe, expect, it } from "vitest";
import type { Clause, ClauseKind, SubChain } from "@/shared/store";
import {
  cardsText,
  newChain,
  outerChains,
  syncChains,
  viewText,
} from "../chains";
import { queryColumns, type ColumnsOf } from "../columns";
import { compose } from "../compose";
import { lanesLayout, chainHeadId, addId } from "../lanes";
import { markersIn, maskMarkers, unmaskMarkers } from "../markers";
import {
  allCards,
  endKinds,
  firstChanged,
  moveJoin,
  previewTargets,
  slotKinds,
} from "../model";
import { parseBack, rebuildCard } from "../parse-back";
import { parseConditions, printConditions } from "../forms/conditions";
import { parseSet, parseValues, printSet } from "../forms/writes";

const card = (
  kind: ClauseKind,
  body: string,
  id: string = kind,
  chains?: SubChain[],
): Clause => ({
  id,
  kind,
  body,
  aggregates: kind === "group" ? "" : null,
  view: "form",
  ...(chains ? { chains } : {}),
});

const chain = (
  id: string,
  marker: number,
  clauses: Clause[],
  collapsed = false,
): SubChain => ({ id, marker, name: null, clauses, collapsed });

const pg = (clauses: Clause[], outer?: Set<string>) =>
  compose({
    clauses,
    dialect: "postgresql",
    schema: "sales",
    cap: 1000,
    outer,
  });

/** `WHERE customer_id IN (SELECT id FROM customers WHERE country = 'IN')` */
const withSub = () => [
  card("select", ""),
  card("from", "orders"),
  card("where", "customer_id IN __dh_sub_1", "where", [
    chain("ch1", 1, [
      card("select", "id", "s.select"),
      card("from", "customers", "s.from"),
      card("where", "country = 'IN'", "s.where"),
    ]),
  ]),
];

describe("markers", () => {
  it("finds markers outside strings and masks them so they parse", () => {
    expect(markersIn("a IN __dh_sub_1 AND b = '__dh_sub_9'")).toEqual([
      { n: 1, at: 5 },
    ]);
    const masked = maskMarkers("EXISTS __dh_sub_2");
    expect(masked).toBe("EXISTS (SELECT __dh_sub_2)");
    expect(unmaskMarkers(masked)).toBe("EXISTS __dh_sub_2");
  });
});

describe("compose with subqueries", () => {
  it("writes each subquery out in parentheses and previews its cards", () => {
    const c = pg(withSub());
    expect(c.errors.size).toBe(0);
    expect(c.sql).toBe(
      "SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE country = 'IN')",
    );
    expect(c.output).toBe(
      "SELECT * FROM sales.orders WHERE customer_id IN (SELECT id FROM sales.customers WHERE country = 'IN')",
    );
    const ids = c.targets.map((t) => t.clause_id);
    expect(ids).toEqual(
      expect.arrayContaining(["s.from", "s.where", "s.select", "where"]),
    );
    const sub = c.targets.find((t) => t.clause_id === "s.where")!;
    expect(sub.sql).toBe(
      "SELECT *, COUNT(*) OVER () AS __dh_count FROM (SELECT * FROM customers LIMIT 1000) AS customers WHERE country = 'IN' LIMIT 20",
    );
  });

  it("errors on a marker with no subquery, and fails the parent with its chain", () => {
    const lost = pg([
      card("select", ""),
      card("from", "orders"),
      card("where", "id IN __dh_sub_4"),
    ]);
    expect(lost.errors.get("where")).toMatch(/no subquery/);
    const bad = withSub();
    bad[2].chains![0].clauses[1] = card("from", "", "s.from");
    const c = pg(bad);
    expect(c.errors.get("s.from")).toMatch(/Pick a table/);
    expect(c.errors.get("where")).toMatch(/Fix the subquery/);
    expect(c.sql).toBeNull();
  });

  it("runs no previews for a chain that reads the outer row", () => {
    const c = pg(withSub(), new Set(["ch1"]));
    const ids = c.targets.map((t) => t.clause_id);
    expect(ids).not.toContain("s.where");
    expect(ids).toContain("where");
  });

  it("reads a subquery in FROM as a table with its alias", () => {
    const c = pg([
      card("select", "t.n"),
      card("from", "__dh_sub_1 AS t", "from", [
        chain("ch", 1, [
          card("select", "COUNT(*) AS n", "s.select"),
          card("from", "orders", "s.from"),
        ]),
      ]),
    ]);
    expect(c.sql).toBe(
      "SELECT t.n FROM (SELECT COUNT(*) AS n FROM orders) AS t",
    );
    expect(c.probe).toMatch(/FROM orders LIMIT 1001/);
    const noAlias = pg([
      card("select", ""),
      card("from", "__dh_sub_1", "from", [
        chain("ch", 1, [card("select", ""), card("from", "orders", "s.from")]),
      ]),
    ]);
    expect(noAlias.errors.get("from")).toMatch(/needs an alias/);
  });

  it("puts every CTE in front of each preview, and never qualifies its name", () => {
    const c = pg([
      card("cte", "recent", "cte", [
        chain("cte.ch", 1, [
          card("select", "", "c.select"),
          card("from", "orders", "c.from"),
          card("where", "total > 10", "c.where"),
        ]),
      ]),
      card("select", ""),
      card("from", "recent"),
    ]);
    expect(c.errors.size).toBe(0);
    expect(c.sql).toBe(
      "WITH recent AS (SELECT * FROM orders WHERE total > 10) SELECT * FROM recent",
    );
    expect(c.output).toBe(
      "WITH recent AS (SELECT * FROM sales.orders WHERE total > 10) SELECT * FROM recent",
    );
    const from = c.targets.find((t) => t.clause_id === "from")!;
    expect(from.sql.startsWith("WITH recent AS (")).toBe(true);
    const cte = c.targets.find((t) => t.clause_id === "cte")!;
    expect(cte.sql).toMatch(/FROM \(SELECT \* FROM recent\) AS q LIMIT 20$/);
    expect(c.probe).toBeNull();
  });

  it("names two CTEs that share a name", () => {
    const def = () =>
      chain(crypto.randomUUID(), 1, [
        card("select", ""),
        card("from", "t", crypto.randomUUID()),
      ]);
    const c = pg([
      card("cte", "a", "a1", [def()]),
      card("cte", "a", "a2", [def()]),
      card("select", ""),
      card("from", "a"),
    ]);
    expect(c.errors.get("a2")).toMatch(/Two CTEs/);
  });

  it("writes WITH RECURSIVE and never previews the recursive chain", () => {
    const c = pg([
      card("cte", "RECURSIVE n", "cte", [
        chain("rec", 1, [
          card("select", "x + 1", "r.select"),
          card("from", "n", "r.from"),
        ]),
      ]),
      card("select", ""),
      card("from", "n"),
    ]);
    expect(c.sql).toMatch(/^WITH RECURSIVE n AS \(/);
    expect(c.targets.map((t) => t.clause_id)).not.toContain("r.select");
  });

  it("adds set operations after HAVING and wraps their previews", () => {
    const c = pg([
      card("select", "id"),
      card("from", "orders"),
      card("compound", "UNION ALL", "u", [
        chain("side", 1, [
          card("select", "id", "s.select"),
          card("from", "archived", "s.from"),
        ]),
      ]),
      card("order", "id"),
    ]);
    expect(c.sql).toBe(
      "SELECT id FROM orders UNION ALL SELECT id FROM archived ORDER BY id",
    );
    const u = c.targets.find((t) => t.clause_id === "u")!;
    expect(u.sql).toMatch(
      /^SELECT q\.\*, COUNT\(\*\) OVER \(\) AS __dh_count FROM \(/,
    );
    expect(u.sql).toMatch(
      /UNION ALL SELECT id FROM \(SELECT \* FROM archived LIMIT 1000\) AS archived\) AS q LIMIT 20$/,
    );
    const select = c.targets.find((t) => t.clause_id === "select")!;
    expect(select.sql).toMatch(/ORDER BY id\) AS q LIMIT 20$/);
  });

  it("expands subqueries in write queries and previews their chains", () => {
    const c = pg([
      card("update", "orders o"),
      card("set", "total = __dh_sub_1", "set", [
        chain("ch", 1, [
          card("select", "MAX(total)", "s.select"),
          card("from", "orders", "s.from"),
        ]),
      ]),
    ]);
    expect(c.sql).toBe(
      "UPDATE orders o SET total = (SELECT MAX(total) FROM orders)",
    );
    expect(c.targets.map((t) => t.clause_id)).toContain("s.from");
    const insert = pg([
      card("insert", "t (a)"),
      card("values", "__dh_sub_1", "values", [
        chain("src", 1, [card("select", "a"), card("from", "s", "s.from")]),
      ]),
    ]);
    expect(insert.sql).toBe("INSERT INTO t (a) SELECT a FROM s");
  });
});

describe("parse back with subqueries", () => {
  const read = (sql: string) => {
    const r = parseBack(sql, "postgresql");
    if (!r.ok) throw new Error(r.error);
    return r.clauses;
  };

  it("turns each subquery into a chain, with its marker in the card", () => {
    const cards = read(
      "SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE id IN (SELECT 1 FROM x)) AND EXISTS (SELECT 1 FROM y)",
    );
    const where = cards.find((c) => c.kind === "where")!;
    expect(where.body).toBe("customer_id IN __dh_sub_1 AND EXISTS __dh_sub_2");
    expect(where.chains!.map((ch) => ch.marker)).toEqual([1, 2]);
    const inner = where.chains![0].clauses.find((c) => c.kind === "where")!;
    expect(inner.body).toBe("id IN __dh_sub_1");
    expect(cardsText(where.chains![0].clauses)).toBe(
      "SELECT id FROM customers WHERE id IN (SELECT 1 FROM x)",
    );
  });

  it("reads WITH, set operations and a derived table", () => {
    const cards = read(
      "WITH r AS (SELECT * FROM t) SELECT a FROM (SELECT a FROM r) AS s UNION SELECT b FROM u ORDER BY 1 LIMIT 3",
    );
    expect(cards.map((c) => c.kind)).toEqual([
      "cte",
      "select",
      "from",
      "compound",
      "order",
      "limit",
    ]);
    expect(cards[2].body).toBe("__dh_sub_2 AS s");
    expect(cards[3].body).toBe("UNION");
    expect(cardsText(cards[3].chains![0].clauses)).toBe("SELECT b FROM u");
    const again = pg(cards);
    expect(again.sql).toBe(
      "WITH r AS (SELECT * FROM t) SELECT a FROM (SELECT a FROM r) AS s UNION SELECT b FROM u ORDER BY 1 LIMIT 3",
    );
  });

  it("marks only a CTE that reads itself as recursive", () => {
    const cards = read(
      "WITH RECURSIVE n (x) AS (SELECT 1 FROM one UNION ALL SELECT x + 1 FROM n WHERE x < 5) SELECT * FROM n",
    );
    expect(cards[0].body).toBe("RECURSIVE n (x)");
  });
});

describe("SQL view rebuild", () => {
  it("keeps chain ids by position and drops chains whose text is gone", () => {
    const where = withSub()[2];
    const next = rebuildCard(
      where,
      "customer_id IN (SELECT id FROM customers WHERE country = 'NL') AND x IN (SELECT 1 FROM z)",
      "postgresql",
      new Set(),
    )!;
    expect(next.chains!.map((c) => c.id)[0]).toBe("ch1");
    expect(next.chains).toHaveLength(2);
    expect(next.body).toBe("customer_id IN __dh_sub_1 AND x IN __dh_sub_2");
    expect(next.chains![0].clauses[0].id).toBe("s.select");
    const gone = rebuildCard(
      where,
      "customer_id = 1",
      "postgresql",
      new Set(),
    )!;
    expect(gone.chains).toBeUndefined();
    expect(
      rebuildCard(where, "customer_id IN (SELEC", "postgresql", new Set()),
    ).toBeNull();
  });

  it("shows a subquery inline in the parent's SQL view", () => {
    expect(viewText(withSub()[2])).toBe(
      "customer_id IN (SELECT id FROM customers WHERE country = 'IN')",
    );
  });
});

describe("chains in the model", () => {
  it("drops a chain whose marker left the text and adds asked for ones", () => {
    const where = withSub()[2];
    expect(syncChains({ ...where, body: "a = 1" }).chains).toEqual([]);
    const added = syncChains(
      { ...where, body: `${where.body} AND EXISTS __dh_sub_2` },
      [2],
    );
    expect(added.chains!.map((c) => c.marker)).toEqual([1, 2]);
    expect(added.chains![1].clauses.map((c) => c.kind)).toEqual([
      "select",
      "from",
    ]);
  });

  it("offers CTE only on a query, and no ORDER BY in a set operation's side", () => {
    const q = [card("select", ""), card("from", "t")];
    expect(endKinds(q)).toContain("cte");
    expect(endKinds(q, "postgresql", "chain")).not.toContain("cte");
    expect(endKinds(q, "postgresql", "side")).not.toContain("order");
    expect(slotKinds(q, 2, "postgresql", "side")).not.toContain("compound");
  });

  it("refreshes from the card whose subquery changed, chain cards included", () => {
    const a = withSub();
    const b = withSub();
    b[2].chains![0].clauses[2] = card("where", "country = 'NL'", "s.where");
    expect(firstChanged(a, b)).toBe("where");
    const targets = previewTargets(b, "where");
    expect([...targets]).toEqual(
      expect.arrayContaining(["where", "s.where", "s.from", "select"]),
    );
  });

  it("moves a CTE among the CTEs only", () => {
    const list = [
      card("cte", "a", "a", [newChain(1)]),
      card("cte", "b", "b", [newChain(1)]),
      card("select", ""),
      card("from", "a"),
    ];
    expect(moveJoin(list, "b", 0).map((c) => c.id)).toEqual([
      "b",
      "a",
      "select",
      "from",
    ]);
  });
});

describe("outer rows and columns", () => {
  const catalog: ColumnsOf = (t) =>
    t.name === "customers"
      ? [
          { name: "id", type: "int" },
          { name: "country", type: "text" },
        ]
      : t.name === "orders"
        ? [
            { name: "id", type: "int" },
            { name: "customer_id", type: "int" },
            { name: "total", type: "numeric" },
          ]
        : undefined;

  it("finds a chain that reads the outer row by alias or by a name only outside has", () => {
    const correlated = [
      card("select", ""),
      card("from", "customers c"),
      card("where", "EXISTS __dh_sub_1", "where", [
        chain("ex", 1, [
          card("select", "1", "e.select"),
          card("from", "orders o2", "e.from"),
          card("where", "o2.customer_id = c.id", "e.where"),
        ]),
      ]),
    ];
    expect([...outerChains(correlated, catalog, "postgresql")]).toEqual(["ex"]);
    const bare = structuredClone(correlated);
    bare[2].chains![0].clauses[2] = card(
      "where",
      "total > 0 AND country = 'IN'",
      "e.where",
    );
    expect([...outerChains(bare, catalog, "postgresql")]).toEqual(["ex"]);
    expect([...outerChains(withSub(), catalog, "postgresql")]).toEqual([]);
  });

  it("gives a derived table its chain's columns and chain cards the outer ones", () => {
    const clauses = [
      card("select", ""),
      card("from", "__dh_sub_1 AS t", "from", [
        chain("ch", 1, [
          card("select", "c.id, c.country AS land", "s.select"),
          card("from", "customers c", "s.from"),
        ]),
      ]),
      card("where", "t.id IN __dh_sub_2", "where", [
        chain("in", 2, [
          card("select", "", "i.select"),
          card("from", "orders", "i.from"),
          card("where", "", "i.where"),
        ]),
      ]),
    ];
    const cols = queryColumns(clauses, catalog, "postgresql");
    expect(cols.where.map((c) => c.name)).toEqual(["id", "land"]);
    expect(cols["i.where"].map((c) => c.name)).toEqual(
      expect.arrayContaining(["customer_id", "t.id", "t.land"]),
    );
  });
});

describe("forms with subqueries", () => {
  it("reads and writes IN, EXISTS and a scalar comparison with a subquery", () => {
    const text = maskMarkers(
      "a IN __dh_sub_1 AND NOT EXISTS __dh_sub_2 AND b > __dh_sub_3",
    );
    const c = parseConditions(text, "postgresql")!;
    expect(c.items.map((x) => x.kind === "cond" && [x.op, x.sub])).toEqual([
      ["IN", 1],
      ["NOT EXISTS", 2],
      [">", 3],
    ]);
    expect(printConditions(c, () => null)).toBe(
      "a IN __dh_sub_1 AND NOT EXISTS __dh_sub_2 AND b > __dh_sub_3",
    );
  });

  it("reads a SET subquery and a VALUES source", () => {
    const rows = parseSet(maskMarkers("total = __dh_sub_1"), "postgresql")!;
    expect(rows[0]).toMatchObject({ mode: "sub", value: "1" });
    expect(printSet(rows, () => null)).toBe("total = __dh_sub_1");
    expect(parseValues("__dh_sub_3", "postgresql")).toEqual({
      rows: [],
      source: 3,
    });
  });
});

describe("lanes with chains", () => {
  it("puts a chain to the right of its card and widens the column", () => {
    const clauses = withSub();
    const lanes = lanesLayout(
      [
        { id: "q1", clauses },
        {
          id: "q2",
          clauses: [card("select", "", "x"), card("from", "t", "y")],
        },
      ],
      {},
    );
    const where = lanes.at.where;
    const head = lanes.at[chainHeadId("ch1")];
    expect(head.x).toBeGreaterThan(where.x);
    expect(head.y).toBe(where.y);
    expect(lanes.at["s.select"].x).toBe(head.x);
    expect(lanes.xs[1]).toBeGreaterThan(head.x);
    const collapsed = withSub();
    collapsed[2].chains![0].collapsed = true;
    const shut = lanesLayout([{ id: "q1", clauses: collapsed }], {});
    expect(shut.at["s.select"]).toBeUndefined();
    expect(shut.at[addId("ch1")]).toBeUndefined();
    expect(allCards(collapsed)).toHaveLength(6);
  });
});
