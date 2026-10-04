import { describe, expect, it } from "vitest";
import type { PreviewChunk } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import { cardFaults, hasFault } from "../card-state";
import { newStage } from "../model";
import type { CardPreview } from "../use-previews";

const chunk = (stage_id: string, extra: Partial<PreviewChunk> = {}) => ({
  stage_id,
  count: 0,
  columns: [],
  rows: [],
  documents: [],
  elapsed_ms: 0,
  ...extra,
});

describe("cardFaults", () => {
  const [a, b, c, d] = ["$match", "$group", "$sort", "$limit"].map((op) =>
    newStage(op),
  );

  it("blocks every enabled card after the first that fails", () => {
    const previews: Record<string, CardPreview> = {
      [b.id]: { status: "error", chunk: chunk(b.id, { error: "bad" }) },
      [c.id]: { status: "ready", chunk: chunk(c.id) },
    };
    const faults = cardFaults([a, b, c, d], [], previews);
    expect(faults[a.id]).toBeUndefined();
    expect(faults[b.id]).toEqual({ error: "bad", timed_out: false });
    expect(faults[c.id]).toEqual({ blocked_by: "stage 2" });
    expect(faults[d.id]).toEqual({ blocked_by: "stage 2" });
    expect(hasFault(faults)).toBe(true);
  });

  it("keeps a later card's own text error and skips disabled cards", () => {
    const off = { ...b, enabled: false };
    const faults = cardFaults(
      [a, off, c, d],
      [
        { stage_id: a.id, message: "a broke" },
        { stage_id: d.id, message: "d broke" },
      ],
      {},
    );
    expect(faults[off.id]).toBeUndefined();
    expect(faults[c.id]).toEqual({ blocked_by: "stage 1" });
    expect(faults[d.id]).toEqual({ error: "d broke" });
  });

  it("marks a time limit and ignores a running card's stale error", () => {
    const faults = cardFaults([a, b], [], {
      [a.id]: {
        status: "error",
        chunk: chunk(a.id, { error: "late", timed_out: true }),
      },
    });
    expect(faults[a.id]).toEqual({ error: "late", timed_out: true });

    const running = cardFaults([a], [], {
      [a.id]: { status: "running", chunk: chunk(a.id, { error: "old" }) },
    });
    expect(hasFault(running)).toBe(false);
  });

  describe("side chains", () => {
    const facet = (outputs: Record<string, AggregationStage[]>) => ({
      ...newStage("$facet"),
      branches: Object.entries(outputs).map(([key, stages]) => ({
        key,
        stages,
      })),
    });
    const inner = () => newStage("$match", true);

    it("a side card error holds back its chain, the parent and later cards", () => {
      const [x, y, z] = [inner(), inner(), inner()];
      const f = facet({ top: [x, y], all: [z] });
      const after = newStage("$limit");
      const faults = cardFaults(
        [a, f, after],
        [{ stage_id: x.id, branch_key: "top", message: "x broke" }],
        {},
      );
      expect(faults[x.id]).toEqual({ error: "x broke" });
      expect(faults[y.id]).toEqual({ blocked_by: "top stage 1 of stage 2" });
      expect(faults[z.id]).toBeUndefined();
      expect(faults[f.id]).toEqual({ blocked_by: "top stage 1 of stage 2" });
      expect(faults[after.id]).toEqual({
        blocked_by: "top stage 1 of stage 2",
      });
      expect(hasFault(faults)).toBe(true);
    });

    it("a main card error holds back later side chains, but not a $unionWith one", () => {
      const [x, y] = [inner(), inner()];
      const f = facet({ out: [x] });
      const union = {
        ...newStage("$unionWith"),
        branches: [{ key: "pipeline", stages: [y] }],
      };
      const faults = cardFaults(
        [a, f, union],
        [{ stage_id: a.id, message: "a broke" }],
        {},
      );
      expect(faults[x.id]).toEqual({ blocked_by: "stage 1" });
      expect(faults[y.id]).toBeUndefined();
      expect(faults[union.id]).toEqual({ blocked_by: "stage 1" });
    });
  });
});
