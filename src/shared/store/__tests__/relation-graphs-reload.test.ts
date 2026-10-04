import { beforeEach, describe, expect, it, vi } from "vitest";

const schemaGraph = vi.fn();
const mongoGraph = vi.fn();
vi.mock("../../api/connection", () => ({
  schemaGraph: (...a: unknown[]) => schemaGraph(...a),
}));
vi.mock("../../api/relation-graph", () => ({
  mongoGraph: (...a: unknown[]) => mongoGraph(...a),
}));
vi.mock("../../api/query", () => ({ cancelRun: vi.fn(async () => {}) }));

import { graphKey, useRelationGraphs } from "../relation-graphs";
import type { GraphEntry } from "../relation-graphs";

const entry = (
  target: GraphEntry["target"],
  stubSchema?: string,
): GraphEntry => ({
  target,
  graph: {
    tables: stubSchema
      ? [{ schema: stubSchema, name: "accounts", stub: true, columns: [] }]
      : [],
    links: [],
  },
  loaded_at: 0,
  status: "ready",
});

describe("reloadMatching", () => {
  beforeEach(() => {
    schemaGraph.mockReset().mockReturnValue(new Promise(() => {}));
    mongoGraph.mockReset().mockReturnValue(new Promise(() => {}));
    useRelationGraphs.setState({
      graphs: {
        [graphKey("c", undefined, "public")]: entry({
          connId: "c",
          schema: "public",
          mongo: false,
        }),
        [graphKey("c", undefined, "sales")]: entry(
          { connId: "c", schema: "sales", mongo: false },
          "public",
        ),
        [graphKey("c", undefined, "hr")]: entry({
          connId: "c",
          schema: "hr",
          mongo: false,
        }),
        [graphKey("c", "billing", "public")]: entry({
          connId: "c",
          database: "billing",
          schema: "public",
          mongo: false,
        }),
        [graphKey("other", undefined, "public")]: entry({
          connId: "other",
          schema: "public",
          mongo: false,
        }),
      },
    });
  });

  it("reloads the schema's own diagrams and those with a stub of it, once each", () => {
    useRelationGraphs.getState().reloadMatching("c", "app", "public", "app");
    const loaded = schemaGraph.mock.calls.map((c) => `${c[1]}|${c[2]}`);
    expect(loaded.sort()).toEqual(["undefined|public", "undefined|sales"]);
  });

  it("matches a named database against the connection's own name", () => {
    useRelationGraphs
      .getState()
      .reloadMatching("c", "billing", "public", "app");
    expect(schemaGraph.mock.calls.map((c) => c[1])).toEqual(["billing"]);
  });

  it("reloads every diagram of a SQLite connection", () => {
    useRelationGraphs
      .getState()
      .reloadMatching("c", undefined, undefined, "app");
    expect(schemaGraph).toHaveBeenCalledTimes(4);
  });

  it("resamples a Mongo database", () => {
    useRelationGraphs.setState({
      graphs: {
        [graphKey("m", "shop")]: entry({
          connId: "m",
          database: "shop",
          mongo: true,
        }),
        [graphKey("m", "logs")]: entry({
          connId: "m",
          database: "logs",
          mongo: true,
        }),
      },
    });
    useRelationGraphs.getState().reloadMatching("m", "shop", undefined, "shop");
    expect(mongoGraph).toHaveBeenCalledTimes(1);
    expect(mongoGraph.mock.calls[0][1]).toBe("shop");
  });
});
