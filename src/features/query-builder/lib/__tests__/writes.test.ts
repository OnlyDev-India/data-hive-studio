import { describe, expect, it } from "vitest";
import type { BuilderQuery, Clause, ClauseKind } from "@/shared/store";
import { cardColumns, excludedKey } from "../columns";
import { compose } from "../compose";
import {
  parseConflict,
  parseInsert,
  parseReturning,
  parseSet,
  parseValues,
  printConflict,
  printInsert,
  printSet,
  printValues,
} from "../forms/writes";
import {
  canRemove,
  newClause,
  newQuery,
  orderErrors,
  queryBadge,
  queryLabel,
  removeClause,
  runOrder,
  slotKinds,
} from "../model";
import { parseBack, parseStatements } from "../parse-back";
import { keySets } from "../use-catalog";

const card = (kind: ClauseKind, body = "", id: string = kind): Clause => ({
  ...newClause(kind, body),
  id,
});

const pg = (clauses: Clause[]) =>
  compose({ clauses, dialect: "postgresql", schema: "sales", cap: 1000 });
const lite = (clauses: Clause[]) =>
  compose({ clauses, dialect: "sqlite", schema: null, cap: 1000 });

const cards = (
  sql: string,
  dialect: "postgresql" | "sqlite" = "postgresql",
) => {
  const r = parseBack(sql, dialect);
  if (!r.ok) throw new Error(r.error);
  return { kind: r.kind, cards: r.clauses.map((c) => [c.kind, c.body]) };
};

describe("write query cards", () => {
  it("starts each kind with its fixed cards, an upsert with DO NOTHING", () => {
    const kinds = (q: BuilderQuery) => q.clauses.map((c) => [c.kind, c.body]);
    expect(kinds(newQuery("update"))).toEqual([
      ["update", ""],
      ["set", ""],
    ]);
    expect(kinds(newQuery("delete"))).toEqual([["delete", ""]]);
    expect(newQuery("upsert").kind).toBe("insert");
    expect(kinds(newQuery("upsert"))).toEqual([
      ["insert", ""],
      ["values", ""],
      ["conflict", "DO NOTHING"],
    ]);
  });

  it("offers only the kinds that fit, JOIN after a FROM, never USING on SQLite", () => {
    const update = [card("update", "orders"), card("set", "a = 1")];
    expect(slotKinds(update, 2)).toEqual(["from", "where", "returning"]);
    expect(slotKinds([...update, card("from", "c")], 3)).toEqual([
      "join",
      "where",
      "returning",
    ]);
    const del = [card("delete", "orders")];
    expect(slotKinds(del, 1, "postgresql")).toEqual([
      "using",
      "where",
      "returning",
    ]);
    expect(slotKinds(del, 1, "sqlite")).toEqual(["where", "returning"]);
    const insert = [card("insert", "t"), card("values", "(1)")];
    expect(slotKinds(insert, 2)).toEqual(["conflict", "returning"]);
  });

  it("keeps the fixed cards, and an UPDATE's FROM takes its JOINs", () => {
    const q = [
      card("update", "orders"),
      card("set", "a = 1"),
      card("from", "c"),
      card("join", "JOIN d ON d.id = c.id"),
      card("where", "x"),
    ];
    expect(canRemove(q, q[1])).toBe(false);
    expect(removeClause(q, "set")).toBe(q);
    expect(removeClause(q, "from").map((c) => c.kind)).toEqual([
      "update",
      "set",
      "where",
    ]);
  });

  it("flags a card out of place or of another kind", () => {
    const q = [card("update", "t"), card("where", "x"), card("set", "a = 1")];
    expect(orderErrors(q).get("set")).toMatch(/out of place/);
    expect(
      orderErrors([card("delete", "t"), card("limit", "1")]).get("limit"),
    ).toMatch(/doesn't belong/);
  });

  it("runs write cards as written", () => {
    const q = [card("update", "t"), card("set", "a = 1"), card("where", "x")];
    expect(runOrder(q).map((c) => c.id)).toEqual(["update", "set", "where"]);
  });

  it("labels a header with its kind and table", () => {
    const q = (
      kind: BuilderQuery["kind"],
      clauses: Clause[],
    ): BuilderQuery => ({
      id: "q",
      kind,
      name: null,
      clauses,
    });
    expect(queryLabel(q("update", [card("update", "orders o")]))).toBe(
      "UPDATE orders",
    );
    const upsert = q("insert", [
      card("insert", "orders (id, total)"),
      card("values", "(1, 2)"),
      card("conflict", "DO NOTHING"),
    ]);
    expect(queryBadge(upsert)).toBe("UPSERT");
    expect(queryLabel(upsert)).toBe("UPSERT orders");
    expect(queryLabel(q("delete", [card("delete")]))).toBe("DELETE");
  });
});

describe("compose a write query", () => {
  it("builds an UPDATE, schema qualified for output, with no previews", () => {
    const c = pg([
      card("update", "orders o"),
      card("set", "status = 'paid'"),
      card("from", "customers c"),
      card("join", "JOIN shops s ON s.id = c.shop_id"),
      card("where", "o.customer_id = c.id"),
      card("returning", "o.id"),
    ]);
    expect(c.errors.size).toBe(0);
    expect(c.sql).toBe(
      "UPDATE orders o SET status = 'paid' FROM customers c JOIN shops s ON s.id = c.shop_id WHERE o.customer_id = c.id RETURNING o.id",
    );
    expect(c.output).toBe(
      "UPDATE sales.orders AS o SET status = 'paid' FROM sales.customers c JOIN sales.shops s ON s.id = c.shop_id WHERE o.customer_id = c.id RETURNING o.id",
    );
    expect(c.targets).toEqual([]);
    expect(c.probe).toBeNull();
  });

  it("skips empty optional cards and names an empty fixed one", () => {
    const c = pg([
      card("delete", "orders"),
      card("where", ""),
      card("returning", ""),
    ]);
    expect(c.sql).toBe("DELETE FROM orders");
    expect([...c.skipped]).toEqual(["where", "returning"]);
    const empty = pg([card("update", "orders"), card("set", "")]);
    expect(empty.errors.get("set")).toBe("Set at least one column");
    expect(empty.sql).toBeNull();
  });

  it("asks for a FROM table when JOINs hang off an empty one", () => {
    const c = pg([
      card("update", "t"),
      card("set", "a = 1"),
      card("from", ""),
      card("join", "JOIN d ON d.id = t.id"),
    ]);
    expect(c.errors.get("from")).toMatch(/delete the JOINs/);
  });

  it("builds INSERT rows, a query source and an upsert", () => {
    expect(
      pg([
        card("insert", "orders (id, total)"),
        card("values", "(1, 10), (2, 20)"),
        card("conflict", "(id) DO UPDATE SET total = excluded.total"),
        card("returning", "*"),
      ]).output,
    ).toBe(
      "INSERT INTO sales.orders (id, total) VALUES (1, 10), (2, 20) ON CONFLICT (id) DO UPDATE SET total = excluded.total RETURNING *",
    );
    expect(
      lite([card("insert", "t (a)"), card("values", "SELECT a FROM s")]).sql,
    ).toBe("INSERT INTO t (a) SELECT a FROM s");
  });

  it("puts a parse error on the card that holds it", () => {
    const c = pg([
      card("update", "orders"),
      card("set", "status = = 1"),
      card("where", "id = 1"),
    ]);
    expect([...c.errors.keys()]).toEqual(["set"]);
    expect(
      pg([card("update", "orders x y"), card("set", "a = 1")]).errors.get(
        "update",
      ),
    ).toMatch(/one table/);
  });
});

describe("parse back a write statement", () => {
  it("opens an UPDATE with FROM, a JOIN, WHERE and RETURNING", () => {
    expect(
      cards(
        "UPDATE orders o SET status = 'paid' FROM customers c JOIN shops s ON s.id = c.shop_id WHERE o.cid = c.id RETURNING o.id",
      ),
    ).toEqual({
      kind: "update",
      cards: [
        ["update", "orders o"],
        ["set", "status = 'paid'"],
        ["from", "customers c"],
        ["join", "JOIN shops s ON s.id = c.shop_id"],
        ["where", "o.cid = c.id"],
        ["returning", "o.id"],
      ],
    });
  });

  it("opens a DELETE with USING", () => {
    expect(
      cards("DELETE FROM orders o USING customers c WHERE o.cid = c.id"),
    ).toEqual({
      kind: "delete",
      cards: [
        ["delete", "orders o"],
        ["using", "customers c"],
        ["where", "o.cid = c.id"],
      ],
    });
  });

  it("opens an upsert and an INSERT from a query", () => {
    expect(
      cards(
        "INSERT INTO orders AS o (id, total) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET total = excluded.total WHERE o.total < 5 RETURNING id",
      ),
    ).toEqual({
      kind: "insert",
      cards: [
        ["insert", "orders AS o (id, total)"],
        ["values", "(1, 'a')"],
        [
          "conflict",
          "(id) DO UPDATE SET total = excluded.total WHERE o.total < 5",
        ],
        ["returning", "id"],
      ],
    });
    expect(
      cards(
        "INSERT INTO t (a) SELECT a FROM s ON CONFLICT DO NOTHING",
        "sqlite",
      ).cards,
    ).toEqual([
      ["insert", "t (a)"],
      ["values", "__dh_sub_1"],
      ["conflict", "DO NOTHING"],
    ]);
  });

  it("keeps what the cards can't hold as SQL, saying why", () => {
    const note = (sql: string, d: "postgresql" | "sqlite" = "postgresql") => {
      const r = parseBack(sql, d);
      return r.ok ? null : r.note;
    };
    expect(note("INSERT OR REPLACE INTO t VALUES (1)", "sqlite")).toBe(
      "This INSERT form, kept as SQL",
    );
    expect(note("INSERT INTO t DEFAULT VALUES")).toMatch(/kept as SQL/);
    expect(note("WITH x AS (SELECT 1) UPDATE t SET a = 1")).toMatch(
      /kept as SQL/,
    );
  });

  it("round trips through compose", () => {
    const [q] = parseStatements(
      "-- name: Pay\nUPDATE orders SET status = 'paid' WHERE id = 3",
      "postgresql",
    );
    expect(q.name).toBe("Pay");
    expect(
      compose({
        clauses: q.clauses,
        dialect: "postgresql",
        schema: null,
        cap: 10,
      }).sql,
    ).toBe("UPDATE orders SET status = 'paid' WHERE id = 3");
  });
});

describe("write forms", () => {
  const typeOf = (c: string) =>
    ({ total: "numeric", paid: "boolean", note: "text" })[c] ?? null;

  it("reads and writes SET rows: values by column type, DEFAULT, expressions", () => {
    const rows = parseSet(
      "total = 10, note = 'x', paid = DEFAULT, n = n + 1",
      "postgresql",
    )!;
    expect(rows.map((r) => [r.column, r.mode, r.value])).toEqual([
      ["total", "value", "10"],
      ["note", "value", "x"],
      ["paid", "default", ""],
      ["n", "expr", "n + 1"],
    ]);
    expect(
      printSet(
        [
          { column: "total", mode: "value", value: "12.5", kind: null },
          { column: "note", mode: "value", value: "it's", kind: null },
          { column: "paid", mode: "value", value: "true", kind: null },
          { column: "", mode: "value", value: "x", kind: null },
        ],
        typeOf,
      ),
    ).toBe("total = 12.5, note = 'it''s', paid = TRUE");
    expect(parseSet("(a, b) = (1, 2)", "postgresql")).toBeNull();
  });

  it("reads and writes the INSERT target with its alias and columns", () => {
    const f = parseInsert("orders AS o (id, total)", "postgresql")!;
    expect(f).toEqual({
      table: { schema: null, name: "orders", alias: "o" },
      columns: ["id", "total"],
    });
    expect(printInsert(f)).toBe("orders AS o (id, total)");
    expect(printInsert({ ...f, columns: [] })).toBe("orders AS o");
  });

  it("reads and writes VALUES rows, empty cells as NULL", () => {
    const f = parseValues("(1, 'a', NULL), (2, DEFAULT, 'b')", "postgresql")!;
    expect(f.rows.map((r) => r.map((c) => c.value))).toEqual([
      ["1", "a", ""],
      ["2", "DEFAULT", "b"],
    ]);
    expect(printValues(f, () => null)).toBe(
      "(1, 'a', NULL), (2, DEFAULT, 'b')",
    );
    expect(
      printValues(
        {
          rows: [
            [
              { value: "7", kind: null },
              { value: "7", kind: null },
            ],
          ],
        },
        (i) => (i === 0 ? "integer" : "text"),
      ),
    ).toBe("(7, '7')");
    expect(parseValues("(now())", "postgresql")).toBeNull();
    expect(parseValues("SELECT 1", "postgresql")).toBeNull();
  });

  it("reads and writes ON CONFLICT", () => {
    const f = parseConflict(
      "(id) DO UPDATE SET total = excluded.total WHERE orders.total < 5",
      "postgresql",
    )!;
    expect(f.target).toEqual(["id"]);
    expect(f.action).toBe("update");
    expect(f.set[0]).toMatchObject({
      column: "total",
      mode: "expr",
      value: "excluded.total",
    });
    expect(f.where).toBe("orders.total < 5");
    expect(printConflict(f, typeOf)).toBe(
      "(id) DO UPDATE SET total = excluded.total WHERE orders.total < 5",
    );
    expect(printConflict({ ...f, target: [], action: "nothing" }, typeOf)).toBe(
      "DO NOTHING",
    );
    expect(
      parseConflict("ON CONSTRAINT orders_pkey DO NOTHING", "postgresql"),
    ).toBeNull();
  });

  it("reads RETURNING as every column or picked ones", () => {
    expect(parseReturning("*", "postgresql")).toEqual({ all: true, items: [] });
    expect(parseReturning("id, total AS t", "postgresql")).toEqual({
      all: false,
      items: [
        { expr: "id", alias: "" },
        { expr: "total", alias: "t" },
      ],
    });
  });
});

describe("write card columns and keys", () => {
  const cols: Record<string, { name: string; type: string }[]> = {
    orders: [
      { name: "id", type: "integer" },
      { name: "total", type: "numeric" },
    ],
    customers: [{ name: "id", type: "integer" }],
  };
  const columnsOf = (t: { name: string }) => cols[t.name];

  it("offers the target's bare columns to SET, every table's to WHERE", () => {
    const out = cardColumns(
      [
        card("update", "orders o"),
        card("set", ""),
        card("from", "customers c"),
        card("where", ""),
      ],
      columnsOf,
      "postgresql",
    );
    expect(out.set.map((c) => c.name)).toEqual(["id", "total"]);
    expect(out.where.map((c) => c.name)).toEqual(["o.id", "o.total", "c.id"]);
    expect(out.from.map((c) => c.name)).toEqual(["c.id"]);
  });

  it("gives VALUES the INSERT columns in order, and ON CONFLICT excluded ones", () => {
    const out = cardColumns(
      [
        card("insert", "orders (total, id)"),
        card("values", ""),
        card("conflict", ""),
      ],
      columnsOf,
      "postgresql",
    );
    expect(out.values).toEqual([
      { name: "total", type: "numeric" },
      { name: "id", type: "integer" },
    ]);
    expect(out[excludedKey("conflict")].map((c) => c.name)).toEqual([
      "excluded.total",
      "excluded.id",
    ]);
  });

  it("reads key sets: the primary key, then unique indexes on plain columns", () => {
    expect(
      keySets({
        columns: [
          {
            name: "id",
            data_type: "int",
            not_null: true,
            primary_key: true,
            default: null,
          },
        ],
        foreign_keys: [],
        indexes: [
          { name: "pk", unique: true, columns: ["id"], origin: "pk" },
          { name: "u", unique: true, columns: ["shop", "code"], origin: "u" },
          { name: "l", unique: true, columns: ["lower(email)"], origin: "c" },
          { name: "i", unique: false, columns: ["total"], origin: "c" },
        ],
        triggers: [],
      }),
    ).toEqual([["id"], ["shop", "code"]]);
  });
});
