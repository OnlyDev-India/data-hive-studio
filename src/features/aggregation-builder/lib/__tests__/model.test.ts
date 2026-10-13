import { describe, expect, it } from "vitest";
import type { AggregationStage } from "@/shared/store";
import { docPaths, fieldSuggestions } from "../fields";
import {
  EMPTY_HISTORY,
  record,
  redo,
  undo,
} from "@/shared/components/builder-canvas";
import {
  addBranch,
  changeOp,
  duplicateStage,
  facetKeyError,
  firstChanged,
  insertStage,
  moveStage,
  newStage,
  patchStage,
  previewTargets,
  removeStage,
  setSubPipeline,
  toSpec,
  withChain,
} from "../model";

const card = (id: string, body = "{}", op = "$match"): AggregationStage => ({
  ...newStage(op),
  id,
  body,
});

describe("firstChanged", () => {
  const a = card("a");
  const b = card("b", "{ x: 1 }");
  const c = card("c", "10", "$limit");

  it("is undefined when nothing a preview reads changed", () => {
    expect(firstChanged([a, b], [a, { ...b, collapsed: true }])).toBe(
      undefined,
    );
  });

  it("names the edited card", () => {
    expect(firstChanged([a, b, c], [a, { ...b, body: "{ x: 2 }" }, c])).toEqual(
      {
        stage_id: "b",
      },
    );
  });

  it("names the inserted card, and a toggled one", () => {
    const n = card("n");
    expect(firstChanged([a, c], [a, n, c])).toEqual({ stage_id: "n" });
    expect(firstChanged([a, b], [a, { ...b, enabled: false }])).toEqual({
      stage_id: "b",
    });
  });

  it("names the card that took a removed card's place", () => {
    expect(firstChanged([a, b, c], [a, c])).toEqual({ stage_id: "c" });
  });

  it("is null when the last card was removed", () => {
    expect(firstChanged([a, b], [a])).toBe(null);
  });
});

describe("changeOp", () => {
  it("swaps the template while the body is untouched", () => {
    const st = newStage("$match");
    expect(changeOp(st, "$limit").body).toBe("10");
  });

  it("keeps the user's own text", () => {
    const st = { ...newStage("$match"), body: '{ status: "A" }' };
    expect(changeOp(st, "$project").body).toBe('{ status: "A" }');
  });
});

it("insertStage puts the card at the index", () => {
  const out = insertStage([card("a"), card("b")], 1, card("n"));
  expect(out.map((s) => s.id)).toEqual(["a", "n", "b"]);
});

describe("card moves and history", () => {
  const a = card("a");
  const b = card("b");
  const c = card("c");
  const out = card("o", '"copy"', "$out");

  it("moves a card and keeps a write stage last", () => {
    const ids = (s: AggregationStage[]) => s.map((x) => x.id);
    expect(ids(moveStage([a, b, c], "a", 2))).toEqual(["b", "c", "a"]);
    expect(ids(moveStage([a, b, out], "a", 5))).toEqual(["b", "a", "o"]);
    expect(moveStage([a, b, out], "o", 0)).toEqual([a, b, out]);
  });

  it("duplicates a card right after it with a new id", () => {
    const { stages, copy } = duplicateStage([a, b], "a");
    expect(stages.map((s) => s.id)).toEqual(["a", copy?.id, "b"]);
    expect(copy?.body).toBe(a.body);
    expect(duplicateStage([a, out], "o").copy).toBeNull();
  });

  it("undoes and redoes whole pipelines, and a new change drops redo", () => {
    let h = record(EMPTY_HISTORY, [a]);
    const [h2, back] = undo(h, [a, b]);
    expect(back).toEqual([a]);
    const [h3, fwd] = redo(h2, [a]);
    expect(fwd).toEqual([a, b]);
    h = record(h2, [a]);
    expect(h.future).toEqual([]);
    expect(h3.past).toHaveLength(1);
  });
});

describe("field suggestions", () => {
  it("offer the previous card's output paths, else the field tree", () => {
    expect(
      docPaths([{ a: 1, b: { c: 2 }, d: [{ e: 1 }], _id: { $oid: "x" } }]),
    ).toEqual(["_id", "a", "b", "b.c", "d", "d.e"]);
    const a = card("a");
    const b = card("b");
    const fields = fieldSuggestions(
      [a, b],
      {
        a: {
          status: "ready",
          chunk: {
            stage_id: "a",
            count: 1,
            columns: [],
            rows: [],
            documents: [{ x: 1 }],
            elapsed_ms: 0,
          },
        },
      },
      ["tree"],
    );
    expect(fields).toEqual({ a: ["tree"], b: ["x"] });
  });
});

describe("side chains", () => {
  const inner = (id: string, op = "$match") => ({
    ...newStage(op, true),
    id,
  });
  const facet = (id: string, outputs: Record<string, AggregationStage[]>) => ({
    ...newStage("$facet"),
    id,
    branches: Object.entries(outputs).map(([key, stages]) => ({
      key,
      stages,
    })),
  });
  const ids = (s: AggregationStage[]) => s.map((x) => x.id);

  it("a main chain $facet and $unionWith start with a side chain, not inside one", () => {
    const f = newStage("$facet");
    expect(f.body).toBe("{}");
    expect(f.branches?.map((b) => b.key)).toEqual(["output"]);
    expect(f.branches?.[0].stages.map((s) => s.op)).toEqual(["$limit"]);
    expect(newStage("$unionWith").branches).toEqual([
      { key: "pipeline", stages: [] },
    ]);
    expect(newStage("$lookup").branches).toBeUndefined();
    expect(newStage("$facet", true).branches).toBeUndefined();
    expect(newStage("$facet", true).body).toContain("output");
  });

  it("changing the operator starts the side chains over", () => {
    const f = newStage("$facet");
    const m = changeOp(f, "$match");
    expect(m.branches).toBeUndefined();
    expect(m.body).toBe("{}");
    expect(changeOp(newStage("$match"), "$unionWith").branches).toHaveLength(1);
  });

  it("moves, removes and patches inside a side chain without leaving it", () => {
    const f = facet("f", { top: [inner("x"), inner("y")], all: [inner("z")] });
    const stages = [card("a"), f];
    const moved = moveStage(stages, "x", 1);
    expect(ids(moved[1].branches![0].stages)).toEqual(["y", "x"]);
    expect(moved[1].branches![1]).toBe(f.branches[1]);
    const gone = removeStage(stages, "y");
    expect(ids(gone[1].branches![0].stages)).toEqual(["x"]);
    const off = patchStage(stages, "z", { enabled: false });
    expect(off[1].branches![1].stages[0].enabled).toBe(false);
    expect(off[0]).toBe(stages[0]);
    const added = withChain(stages, { parent: "f", key: "all" }, (c) =>
      insertStage(c, 0, inner("n")),
    );
    expect(ids(added[1].branches![1].stages)).toEqual(["n", "z"]);
  });

  it("duplicates a parent with its side chains under new ids", () => {
    const f = facet("f", { top: [inner("x")] });
    const { stages, copy } = duplicateStage([f], "f");
    expect(stages).toHaveLength(2);
    expect(copy?.branches?.[0].stages[0].id).not.toBe("x");
    expect(copy?.branches?.[0].stages[0].body).toBe(
      f.branches[0].stages[0].body,
    );
    const inside = duplicateStage([f], "x").stages;
    expect(inside[0].branches![0].stages).toHaveLength(2);
  });

  it("adds outputs under free names and checks output names", () => {
    const f = facet("f", { output: [] });
    const { stages, key } = addBranch([f], "f");
    expect(key).toBe("output2");
    expect(stages[0].branches!.map((b) => b.key)).toEqual([
      "output",
      "output2",
    ]);
    expect(facetKeyError("a.b", [])).toContain("$ or .");
    expect(facetKeyError("x", ["x"])).toContain("already");
    expect(facetKeyError("", [])).toBeTruthy();
    expect(facetKeyError("fine", ["x"])).toBeNull();
  });

  it("the $lookup switch adds or drops its side chain", () => {
    const l = { ...newStage("$lookup"), id: "l" };
    const on = setSubPipeline([l], "l", true);
    expect(on[0].branches).toEqual([{ key: "pipeline", stages: [] }]);
    expect(setSubPipeline(on, "l", false)[0].branches).toBeUndefined();
  });

  it("sends side chains in the spec only when there are any", () => {
    const f = facet("f", { top: [inner("x")] });
    const spec = toSpec([card("a"), f]);
    expect(spec.stages[0].branches).toBeUndefined();
    expect(spec.stages[1].branches?.[0].stages[0].id).toBe("x");
  });

  it("a side chain edit refreshes from that card; other side changes from the parent", () => {
    const f = facet("f", { top: [inner("x"), inner("y")], all: [inner("z")] });
    const edited = patchStage([f], "y", { body: "{ q: 1 }" });
    expect(firstChanged([f], edited)).toEqual({
      stage_id: "y",
      branch_key: "top",
    });
    const renamed = [
      { ...f, branches: [{ ...f.branches[0], key: "t2" }, f.branches[1]] },
    ];
    expect(firstChanged([f], renamed)).toEqual({ stage_id: "f" });
    const dropped = removeStage([f], "y");
    expect(firstChanged([f], dropped)).toEqual({ stage_id: "f" });
  });

  it("previews the cards Rust runs for each kind of refresh", () => {
    const f = facet("f", { top: [inner("x"), inner("y")], all: [inner("z")] });
    const stages = [card("a"), f, card("b"), card("o", '"c"', "$out")];
    const all = [...previewTargets(stages, null)].sort();
    expect(all).toEqual(["a", "b", "f", "x", "y", "z"]);
    expect(
      [...previewTargets(stages, { stage_id: "y", branch_key: "top" })].sort(),
    ).toEqual(["b", "f", "y"]);
    expect([...previewTargets(stages, { stage_id: "b" })]).toEqual(["b"]);
  });
});
