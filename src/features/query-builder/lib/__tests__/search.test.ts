import { describe, expect, it } from "vitest";
import type {
  BuilderQuery,
  BuilderQueryKind,
  Clause,
  ClauseKind,
  SubChain,
} from "@/shared/store";
import { keepCollapsed } from "../chains";
import { headerId } from "../lanes";
import { openChains, searchQueries } from "../search";

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
  clauses: Clause[],
  collapsed = false,
  marker = 1,
): SubChain => ({ id, marker, name: null, clauses, collapsed });

const query = (
  id: string,
  clauses: Clause[],
  kind: BuilderQueryKind = "select",
  name: string | null = null,
): BuilderQuery => ({ id, kind, name, clauses });

const tab = (): BuilderQuery[] => [
  query("q1", [
    card("select", "o.id, o.status", "q1.select"),
    card("from", "orders o", "q1.from"),
    card("where", "o.status = 'paid'", "q1.where"),
  ]),
  query(
    "q2",
    [
      card("select", "", "q2.select"),
      card("from", "customers", "q2.from"),
      card("where", "id IN __dh_sub_1", "q2.where", [
        chain(
          "ch1",
          [
            card("select", "customer_id", "s.select"),
            card("from", "orders", "s.from"),
            card("where", "status = 'open'", "s.where"),
          ],
          true,
        ),
      ]),
    ],
    "select",
    "Open customers",
  ),
  query(
    "q3",
    [card("statement", "CREATE TABLE audit (id int)", "q3.stmt")],
    "statement",
  ),
];

const find = (text: string) => searchQueries(tab(), text, "postgresql");

describe("searchQueries", () => {
  it("is null for blank text", () => {
    expect(find("  ")).toBeNull();
  });

  it("finds table.column through an alias and a subquery's bare column", () => {
    const r = find("ORDERS.STATUS")!;
    expect(r.hits).toEqual(["q1.select", "q1.where", "s.where"]);
    expect(r.dim).toEqual(new Set(["q3"]));
    expect(r.open).toEqual(new Set(["ch1"]));
  });

  it("finds query names and auto labels as header hits", () => {
    expect(find("open customers")!.hits[0]).toBe(headerId("q2"));
    expect(find("sql statement: create")!.hits).toEqual([headerId("q3")]);
    expect(find("audit")!.hits).toEqual(["q3.stmt"]);
  });

  it("finds card text and table names, never a marker", () => {
    expect(find("'paid'")!.hits).toEqual(["q1.where"]);
    expect(find("customers")!.hits).toEqual([headerId("q2"), "q2.from"]);
    // WHERE id reads customers.id, the list's one table.
    expect(find("customers.id")!.hits).toEqual(["q2.where"]);
    expect(find("__dh_sub")!.hits).toEqual([]);
  });

  it("dims every query when nothing matches", () => {
    const r = find("nothing here")!;
    expect(r.hits).toEqual([]);
    expect(r.dim).toEqual(new Set(["q1", "q2", "q3"]));
  });
});

describe("openChains", () => {
  it("opens the named chains without touching the others", () => {
    const qs = tab();
    expect(openChains(qs, new Set())).toBe(qs);
    const out = openChains(qs, new Set(["ch1"]));
    expect(out[1].clauses[2].chains![0].collapsed).toBe(false);
    expect(qs[1].clauses[2].chains![0].collapsed).toBe(true);
  });
});

describe("keepCollapsed", () => {
  it("keeps each chain collapsed or open as it is now", () => {
    const before = tab()[1].clauses;
    const now = openChains(tab(), new Set(["ch1"]))[1].clauses;
    expect(keepCollapsed(before, now)[2].chains![0].collapsed).toBe(false);
    expect(keepCollapsed(now, before)[2].chains![0].collapsed).toBe(true);
  });
});
