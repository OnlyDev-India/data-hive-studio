import { describe, expect, it } from "vitest";
import {
  upgradeQueryBuilderSetup,
  type BuilderQuery,
  type Clause,
  type ClauseKind,
  type QueryBuilderSetup,
} from "@/shared/store";
import { DEFAULT_QUERY_BUILDER_SETUP } from "@/shared/store/types";
import {
  duplicateQuery,
  firstChanged,
  moveJoin,
  moveQuery,
  newClause,
  orderErrors,
  pickedAfterDelete,
  pickQuery,
  previewTargets,
  queryLabel,
  statementKeyword,
  statementQuery,
  removeClause,
  runOrder,
  slotFor,
  slotKinds,
} from "../model";

const card = (kind: ClauseKind, body = "x", id: string = kind): Clause => ({
  ...newClause(kind, body),
  id,
});

describe("slotKinds", () => {
  const q = [card("select"), card("from"), card("where"), card("order")];

  it("offers only the kinds that fit between the neighbours", () => {
    expect(slotKinds(q, 2)).toEqual(["join"]);
    expect(slotKinds(q, 3)).toEqual(["group", "compound"]);
    expect(slotKinds(q, 4)).toEqual(["limit"]);
  });

  it("never offers SELECT or FROM, and HAVING only after a GROUP BY", () => {
    const g = [card("select"), card("from"), card("group")];
    expect(slotKinds(g, 3)).toContain("having");
    const bare = [card("select"), card("from")];
    expect(slotKinds(bare, 2)).not.toContain("having");
    expect(slotKinds(bare, 2)).not.toContain("select");
    expect(slotKinds(bare, 2)).not.toContain("from");
    expect(slotKinds(q, 0)).toEqual([]);
    expect(slotKinds(q, 1)).toEqual([]);
  });

  it("lets JOIN repeat, after FROM or another JOIN", () => {
    const j = [card("select"), card("from"), card("join", "JOIN a", "j1")];
    expect(slotKinds(j, 2)).toEqual(["join"]);
    expect(slotKinds(j, 3)).toContain("join");
  });
});

describe("removeClause", () => {
  it("keeps SELECT and FROM and takes HAVING with GROUP BY", () => {
    const q = [
      card("select"),
      card("from"),
      card("group"),
      card("having"),
      card("limit"),
    ];
    expect(removeClause(q, "from")).toBe(q);
    expect(removeClause(q, "select")).toBe(q);
    expect(removeClause(q, "group").map((c) => c.kind)).toEqual([
      "select",
      "from",
      "limit",
    ]);
  });
});

describe("moveJoin", () => {
  it("moves a JOIN among the JOINs only", () => {
    const q = [
      card("from"),
      card("join", "JOIN a", "a"),
      card("join", "JOIN b", "b"),
      card("where"),
    ];
    expect(moveJoin(q, "b", 0).map((c) => c.id)).toEqual([
      "from",
      "b",
      "a",
      "where",
    ]);
    expect(moveJoin(q, "where", 0)).toBe(q);
  });
});

describe("slotFor", () => {
  it("puts a new card after the last card that comes before it", () => {
    const q = [card("from"), card("join", "JOIN a", "a"), card("limit")];
    expect(slotFor(q, "where")).toBe(2);
    expect(slotFor(q, "join")).toBe(2);
    expect(slotFor(q, "limit")).toBe(3);
  });
});

describe("firstChanged and previewTargets", () => {
  const q = [card("from"), card("where"), card("limit")];

  it("finds the first card whose text changed", () => {
    const edited = q.map((c) => (c.id === "where" ? { ...c, body: "y" } : c));
    expect(firstChanged(q, edited)).toBe("where");
    expect(firstChanged(q, [{ ...q[0], body: "t" }, q[1], q[2]])).toBeNull();
  });

  it("ignores a flip between form and SQL", () => {
    const flipped = q.map((c) => ({ ...c, view: "form" as const }));
    expect(firstChanged(q, flipped)).toBeUndefined();
  });

  it("refreshes from the card that moved into a removed card's place", () => {
    expect(firstChanged(q, [q[0], q[2]])).toBe("limit");
    expect(firstChanged(q, [q[0], q[1]])).toBeUndefined();
  });

  it("targets the card and every card after it", () => {
    expect([...previewTargets(q, "where")]).toEqual(["where", "limit"]);
    expect([...previewTargets(q, null)]).toEqual(["from", "where", "limit"]);
  });

  it("follows run order, always adding the SELECT card", () => {
    const w = [card("select"), card("from"), card("where"), card("order")];
    expect(runOrder(w).map((c) => c.kind)).toEqual([
      "from",
      "where",
      "select",
      "order",
    ]);
    expect([...previewTargets(w, "order")]).toEqual(["order", "select"]);
    const edited = w.map((c) => (c.id === "where" ? { ...c, body: "y" } : c));
    expect(firstChanged(w, edited)).toBe("where");
    expect([...previewTargets(w, "where")]).toEqual([
      "where",
      "select",
      "order",
    ]);
  });
});

describe("orderErrors", () => {
  it("names a card out of place, a second FROM, and HAVING without GROUP BY", () => {
    expect(
      orderErrors([card("select"), card("from"), card("where")]).size,
    ).toBe(0);
    expect(
      orderErrors([card("from"), card("select", "x", "s")]).get("s"),
    ).toMatch(/out of place/);
    expect(
      orderErrors([card("from"), card("from", "x", "f2")]).get("f2"),
    ).toMatch(/Only one FROM/);
    expect(
      orderErrors([card("from"), card("limit"), card("where", "x", "w")]).get(
        "w",
      ),
    ).toMatch(/out of place/);
    expect(
      orderErrors([card("from"), card("having", "x", "h")]).get("h"),
    ).toMatch(/GROUP BY/);
  });
});

const q = (id: string, name: string | null = null): BuilderQuery => ({
  id,
  kind: "select",
  name,
  clauses: [card("select", "", `${id}s`), card("from", "orders o", `${id}f`)],
});

describe("queries", () => {
  const qs = [q("a"), q("b"), q("c"), q("d")];

  it("picks one, toggles with Cmd, and picks a range with Shift", () => {
    expect(pickQuery(qs, ["a"], "c", "only")).toEqual(["c"]);
    expect(pickQuery(qs, ["a"], "c", "toggle")).toEqual(["a", "c"]);
    expect(pickQuery(qs, ["a", "c"], "c", "toggle")).toEqual(["a"]);
    expect(pickQuery(qs, ["a"], "a", "toggle")).toEqual(["a"]);
    expect(pickQuery(qs, ["b"], "d", "range")).toEqual(["b", "c", "d"]);
    expect(pickQuery(qs, ["d"], "b", "range")).toEqual(["d", "c", "b"]);
  });

  it("makes the previous query current when the current one goes", () => {
    expect(pickedAfterDelete(qs, ["c"], "c")).toEqual(["b"]);
    expect(pickedAfterDelete(qs, ["a"], "a")).toEqual(["b"]);
    expect(pickedAfterDelete(qs, ["a", "c"], "a")).toEqual(["c"]);
    expect(pickedAfterDelete([q("a")], ["a"], "a")).toEqual([]);
  });

  it("moves, duplicates with new ids, and labels a query", () => {
    expect(moveQuery(qs, "a", 2).map((x) => x.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    const copy = duplicateQuery(q("a", "Top"));
    expect(copy.id).not.toBe("a");
    expect(copy.name).toBe("Top copy");
    expect(copy.clauses.map((c) => c.id)).not.toContain("as");
    expect(queryLabel(q("a"))).toBe("SELECT orders");
    expect(queryLabel(q("a", "Top"))).toBe("Top");
  });
});

describe("upgradeQueryBuilderSetup", () => {
  it("turns a saved clause list into one SELECT query with SELECT first", () => {
    const old = {
      ...DEFAULT_QUERY_BUILDER_SETUP,
      queries: undefined,
      picked_query_ids: undefined,
      clauses: [card("from", "t"), card("where"), card("select", "a")],
    } as unknown as QueryBuilderSetup;
    const up = upgradeQueryBuilderSetup(old);
    expect(up.queries).toHaveLength(1);
    expect(up.queries[0].clauses.map((c) => c.id)).toEqual([
      "select",
      "from",
      "where",
    ]);
    expect(up.picked_query_ids).toEqual([up.queries[0].id]);
    expect("clauses" in up).toBe(false);
  });

  it("adds an empty SELECT card when the old list had none", () => {
    const old = {
      ...DEFAULT_QUERY_BUILDER_SETUP,
      clauses: [card("from", "t")],
    } as unknown as QueryBuilderSetup;
    const kinds = upgradeQueryBuilderSetup(old).queries[0].clauses.map((c) => [
      c.kind,
      c.body,
    ]);
    expect(kinds).toEqual([
      ["select", ""],
      ["from", "t"],
    ]);
  });
});

describe("statement queries", () => {
  it("label and badge from the first keyword", () => {
    expect(statementKeyword("-- note\n  create table t (a int)")).toBe(
      "CREATE",
    );
    expect(statementKeyword("(select 1)")).toBe("SELECT");
    expect(statementKeyword("")).toBe("SQL");
    expect(queryLabel(statementQuery("DROP TABLE t"))).toBe(
      "SQL statement: DROP",
    );
    expect(queryLabel(statementQuery("DROP TABLE t", "Clean up"))).toBe(
      "Clean up",
    );
  });
});
