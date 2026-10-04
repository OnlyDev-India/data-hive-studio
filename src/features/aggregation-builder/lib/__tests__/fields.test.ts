import { describe, expect, it } from "vitest";
import type { FieldShape } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import {
  bodyString,
  docPaths,
  fieldSuggestions,
  joinedCollection,
  treePaths,
} from "../fields";
import { newStage } from "../model";
import type { CardPreview } from "../use-previews";

const card = (id: string, op = "$match", body = "{}"): AggregationStage => ({
  ...newStage(op, true),
  id,
  body,
});

const ready = (id: string, documents: unknown[]): CardPreview => ({
  status: "ready",
  chunk: {
    stage_id: id,
    count: 1,
    columns: [],
    rows: [],
    documents,
    elapsed_ms: 0,
  },
});

const failed = (id: string): CardPreview => ({
  status: "error",
  chunk: {
    stage_id: id,
    count: 0,
    columns: [],
    rows: [],
    documents: [],
    elapsed_ms: 0,
    error: "bad",
  },
});

describe("docPaths", () => {
  it("is empty with no documents", () => {
    expect(docPaths([])).toEqual([]);
  });

  it("merges the paths of every document, without repeats", () => {
    expect(docPaths([{ a: 1 }, { a: 2, b: 1 }])).toEqual(["a", "b"]);
  });

  it("adds only the array itself for an array of scalars", () => {
    expect(docPaths([{ tags: ["x", "y"], m: [[{ z: 1 }]] }])).toEqual([
      "m",
      "m.z",
      "tags",
    ]);
  });
});

describe("treePaths", () => {
  it("lists every path of a field tree, parents before children", () => {
    const tree = [
      { path: "a", children: [{ path: "a.b" }] },
      { path: "c" },
    ] as FieldShape[];
    expect(treePaths(tree)).toEqual(["a", "a.b", "c"]);
  });
});

describe("bodyString", () => {
  it("reads a quoted or bare key's string value", () => {
    expect(bodyString('{ from: "items", as: "x" }', "from")).toBe("items");
    expect(bodyString(`{ "from": 'items' }`, "from")).toBe("items");
  });

  it("is null when the key is missing or only ends another key", () => {
    expect(bodyString('{ as: "x" }', "from")).toBeNull();
    expect(bodyString('{ datafrom: "x" }', "from")).toBeNull();
  });
});

describe("joinedCollection", () => {
  it("reads $lookup's from and both $unionWith forms", () => {
    expect(
      joinedCollection(card("l", "$lookup", '{ from: "items", as: "x" }')),
    ).toBe("items");
    expect(joinedCollection(card("u", "$unionWith", '"archive"'))).toBe(
      "archive",
    );
    expect(
      joinedCollection(
        card("u", "$unionWith", '{ coll: "archive", pipeline: [] }'),
      ),
    ).toBe("archive");
  });

  it("is null for a card that joins nothing", () => {
    expect(joinedCollection(card("m", "$match", '{ from: "x" }'))).toBeNull();
  });
});

describe("fieldSuggestions", () => {
  it("passes a disabled or write card's input straight through", () => {
    const a = card("a");
    const off = { ...card("off"), enabled: false };
    const b = card("b");
    const fields = fieldSuggestions(
      [a, off, b],
      { a: ready("a", [{ x: 1 }]), off: ready("off", [{ ignored: 1 }]) },
      ["tree"],
    );
    expect(fields).toEqual({ a: ["tree"], off: ["x"], b: ["x"] });
  });

  it("falls back to the field tree after a card whose preview failed or is missing", () => {
    const fields = fieldSuggestions(
      [card("a"), card("b"), card("c")],
      { a: failed("a") },
      ["tree"],
    );
    expect(fields).toEqual({ a: ["tree"], b: ["tree"], c: ["tree"] });
  });

  it("starts a $facet output from its parent's input", () => {
    const first = card("first");
    const facet: AggregationStage = {
      ...card("f", "$facet"),
      branches: [{ key: "top", stages: [card("t1"), card("t2")] }],
    };
    const fields = fieldSuggestions(
      [first, facet],
      { first: ready("first", [{ x: 1 }]), t1: ready("t1", [{ y: 1 }]) },
      ["tree"],
    );
    expect(fields.t1).toEqual(["x"]);
    expect(fields.t2).toEqual(["y"]);
    expect(fields.f).toEqual(["x"]);
  });

  it("starts a $lookup or $unionWith side chain from the joined collection's fields", () => {
    const lookup: AggregationStage = {
      ...card("l", "$lookup", '{ from: "items", as: "j" }'),
      branches: [{ key: "pipeline", stages: [card("lt")] }],
    };
    const union: AggregationStage = {
      ...card("u", "$unionWith", '{ coll: "gone" }'),
      branches: [{ key: "pipeline", stages: [card("ut")] }],
    };
    const fields = fieldSuggestions([lookup, union], {}, ["tree"], {
      items: ["sku"],
    });
    expect(fields.lt).toEqual(["sku"]);
    expect(fields.ut).toEqual([]);
  });
});
