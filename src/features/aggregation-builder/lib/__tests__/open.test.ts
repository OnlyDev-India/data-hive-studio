import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedPipeline } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

const api = vi.hoisted(() => ({
  parsePipeline: vi.fn(),
  composePipeline: vi.fn(),
  getActiveSchema: vi.fn(),
}));
const pickCollection = vi.hoisted(() => vi.fn());
const pickPipelineFile = vi.hoisted(() => vi.fn());

vi.mock("@/shared/api", async (orig) => ({
  ...(await orig<object>()),
  ...api,
}));
vi.mock("@/shared/components/collection-picker", () => ({ pickCollection }));
vi.mock("@/shared/lib/platform", async (orig) => ({
  ...(await orig<object>()),
  pickPipelineFile,
}));

import {
  openAggregationPicked,
  openPipelineFile,
  openPipelineText,
} from "../open";

const parsed = (collection: string | null): ParsedPipeline => ({
  collection,
  stages: [
    { op: "$limit", body: "10", enabled: true, title: "Ten", note: null },
  ],
});

let openAggregation: ReturnType<typeof vi.fn>;
let pushNotification: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  openAggregation = vi.fn();
  pushNotification = vi.fn();
  useStudioStore.setState({ openAggregation, pushNotification } as never);
});

const opened = () => {
  const [conn, database, collection, , setup] = openAggregation.mock.calls[0];
  return { conn, database, collection, setup };
};

describe("openPipelineText", () => {
  it("opens the collection the text names, over the one passed in", async () => {
    api.parsePipeline.mockResolvedValue(parsed("orders"));

    const ok = await openPipelineText("c1", "text", {
      database: "shop",
      collection: "other",
    });

    expect(ok).toBe(true);
    expect(pickCollection).not.toHaveBeenCalled();
    const o = opened();
    expect([o.conn, o.database, o.collection]).toEqual([
      "c1",
      "shop",
      "orders",
    ]);
    expect(o.setup.stages).toHaveLength(1);
    expect(o.setup.stages[0]).toMatchObject({
      op: "$limit",
      body: "10",
      title: "Ten",
    });
    expect(o.setup).toMatchObject({ file_path: null, saved_text: null });
  });

  it("falls back to the collection passed in when the text names none", async () => {
    api.parsePipeline.mockResolvedValue(parsed(null));
    await openPipelineText("c1", "text", { database: "shop", collection: "x" });
    expect(opened().collection).toBe("x");
  });

  it("asks for a collection in the database when nothing names one", async () => {
    api.parsePipeline.mockResolvedValue(parsed(null));
    pickCollection.mockResolvedValue({ database: "db2", collection: "picked" });

    await openPipelineText("c1", "text", { database: "shop" });

    expect(pickCollection).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ database: "shop" }),
    );
    expect(opened()).toMatchObject({ database: "db2", collection: "picked" });
  });

  it("opens nothing when the collection picker is cancelled", async () => {
    api.parsePipeline.mockResolvedValue(parsed(null));
    pickCollection.mockResolvedValue(null);

    const ok = await openPipelineText("c1", "text", { database: "" });

    expect(ok).toBe(false);
    expect(pickCollection).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ database: undefined }),
    );
    expect(openAggregation).not.toHaveBeenCalled();
  });

  it("shows the parser's error and opens nothing for bad text", async () => {
    api.parsePipeline.mockRejectedValue(
      new Error("Stage 1 (line 2, column 3)"),
    );

    const ok = await openPipelineText("c1", "bad", { database: "shop" });

    expect(ok).toBe(false);
    expect(openAggregation).not.toHaveBeenCalled();
    expect(pushNotification).toHaveBeenCalledWith({
      kind: "error",
      title: "Could not read the pipeline",
      detail: "Stage 1 (line 2, column 3)",
    });
  });

  it("starts a tab opened from a file as saved", async () => {
    api.parsePipeline.mockResolvedValue(parsed("orders"));
    api.composePipeline.mockResolvedValue({ file: "saved text" });

    await openPipelineText("c1", "text", {
      database: "shop",
      file_path: "/p.js",
    });

    expect(api.composePipeline).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        stages: [expect.objectContaining({ op: "$limit" })],
      }),
    );
    expect(opened().setup).toMatchObject({
      file_path: "/p.js",
      saved_text: "saved text",
    });
  });

  it("still opens a file when composing its saved text fails", async () => {
    api.parsePipeline.mockResolvedValue(parsed("orders"));
    api.composePipeline.mockRejectedValue(new Error("down"));

    const ok = await openPipelineText("c1", "text", {
      database: "shop",
      file_path: "/p.js",
    });

    expect(ok).toBe(true);
    expect(opened().setup).toMatchObject({
      file_path: "/p.js",
      saved_text: null,
    });
  });
});

describe("openPipelineFile", () => {
  it("does nothing when no file is picked", async () => {
    pickPipelineFile.mockResolvedValue(null);
    await openPipelineFile("c1");
    expect(api.parsePipeline).not.toHaveBeenCalled();
    expect(openAggregation).not.toHaveBeenCalled();
  });

  it("fills in the builder tab's database and collection", async () => {
    pickPipelineFile.mockResolvedValue({
      path: "/p.js",
      name: "p.js",
      text: "t",
    });
    api.parsePipeline.mockResolvedValue(parsed(null));
    api.composePipeline.mockResolvedValue({ file: "t" });

    await openPipelineFile("c1", { database: "shop", collection: "orders" });

    expect(api.getActiveSchema).not.toHaveBeenCalled();
    expect(opened()).toMatchObject({ database: "shop", collection: "orders" });
    expect(opened().setup.file_path).toBe("/p.js");
  });

  it("uses the connection's active database without a builder tab", async () => {
    pickPipelineFile.mockResolvedValue({
      path: "/p.js",
      name: "p.js",
      text: "t",
    });
    api.getActiveSchema.mockResolvedValue("live");
    api.parsePipeline.mockResolvedValue(parsed("orders"));
    api.composePipeline.mockResolvedValue({ file: "t" });

    await openPipelineFile("c1");

    expect(opened()).toMatchObject({ database: "live", collection: "orders" });
  });

  it("still opens when the active database cannot be read", async () => {
    pickPipelineFile.mockResolvedValue({
      path: "/p.js",
      name: "p.js",
      text: "t",
    });
    api.getActiveSchema.mockRejectedValue(new Error("offline"));
    api.parsePipeline.mockResolvedValue(parsed("orders"));
    api.composePipeline.mockResolvedValue({ file: "t" });

    await openPipelineFile("c1");

    expect(opened()).toMatchObject({ database: "", collection: "orders" });
  });

  it("reports a file that cannot be read", async () => {
    pickPipelineFile.mockRejectedValue(new Error("permission denied"));

    await openPipelineFile("c1");

    expect(pushNotification).toHaveBeenCalledWith({
      kind: "error",
      title: "Could not open the file",
      detail: "permission denied",
    });
  });
});

describe("openAggregationPicked", () => {
  it("opens the picked collection", async () => {
    pickCollection.mockResolvedValue({
      database: "shop",
      collection: "orders",
    });
    await openAggregationPicked("c1");
    expect(openAggregation).toHaveBeenCalledWith("c1", "shop", "orders");
  });

  it("opens nothing when the picker is cancelled", async () => {
    pickCollection.mockResolvedValue(null);
    await openAggregationPicked("c1");
    expect(openAggregation).not.toHaveBeenCalled();
  });
});
