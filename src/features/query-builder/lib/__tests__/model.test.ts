import { describe, expect, it } from "vitest";
import type { Clause, ClauseKind } from "@/shared/store";
import {
  firstChanged,
  moveJoin,
  newClause,
  orderErrors,
  previewTargets,
  removeClause,
  slotFor,
  slotKinds,
} from "../model";

const card = (kind: ClauseKind, body = "x", id: string = kind): Clause => ({
  ...newClause(kind, body),
  id,
});

describe("slotKinds", () => {
  const q = [card("from"), card("where"), card("order")];

  it("offers only the kinds that fit between the neighbours", () => {
    expect(slotKinds(q, 1)).toEqual(["join"]);
    expect(slotKinds(q, 2)).toEqual(["group", "select"]);
    expect(slotKinds(q, 3)).toEqual(["limit"]);
  });

  it("offers HAVING only after a GROUP BY, and never a second FROM", () => {
    const g = [card("from"), card("group")];
    expect(slotKinds(g, 2)).toContain("having");
    expect(slotKinds([card("from")], 1)).not.toContain("having");
    expect(slotKinds([card("from")], 1)).not.toContain("from");
    expect(slotKinds(q, 0)).toEqual([]);
  });

  it("lets JOIN repeat, after FROM or another JOIN", () => {
    const j = [card("from"), card("join", "JOIN a", "j1")];
    expect(slotKinds(j, 1)).toEqual(["join"]);
    expect(slotKinds(j, 2)).toContain("join");
  });
});

describe("removeClause", () => {
  it("keeps FROM and takes HAVING with GROUP BY", () => {
    const q = [card("from"), card("group"), card("having"), card("limit")];
    expect(removeClause(q, "from")).toBe(q);
    expect(removeClause(q, "group").map((c) => c.kind)).toEqual([
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
});

describe("orderErrors", () => {
  it("names a card out of place, a second FROM, and HAVING without GROUP BY", () => {
    expect(orderErrors([card("from"), card("where")]).size).toBe(0);
    expect(orderErrors([card("where", "x", "w")]).get("w")).toMatch(/FROM/);
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
