import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { PreviewChunk } from "@/shared/api";

const previewPipeline = vi.fn();
vi.mock("@/shared/api", () => ({
  canCancelRun: () => true,
  cancelRun: vi.fn(() => Promise.resolve()),
  composePipeline: vi.fn(() => Promise.resolve(null)),
  previewPipeline: (...args: unknown[]) => previewPipeline(...args),
}));

import { useStudioStore, type StudioStore } from "@/shared/store";
import { DEFAULT_AGGREGATION_SETUP } from "@/shared/store/types";
import { usePreviews } from "../use-previews";

const STAGE = {
  id: "s1",
  op: "$match",
  body: "{}",
  enabled: true,
  collapsed: false,
  view: "json" as const,
  note: null,
  title: null,
};

function answer(error: string) {
  previewPipeline.mockImplementation(
    (_conn: string, _req: unknown, on_chunk: (c: PreviewChunk) => void) => {
      on_chunk({
        stage_id: "s1",
        count: 0,
        rows: [],
        documents: [],
        columns: [],
        elapsed_ms: 1,
        error,
      } as unknown as PreviewChunk);
      return Promise.resolve({ cancelled: false, source_estimate: null });
    },
  );
}

function setup() {
  return renderHook(() =>
    usePreviews({
      conn_id: "c1",
      database: "shop",
      collection: "orders",
      setup: { ...DEFAULT_AGGREGATION_SETUP, stages: [STAGE] },
    }),
  );
}

beforeEach(() => {
  previewPipeline.mockReset();
  useStudioStore.setState({
    open: [{ id: "c1", kind: "mongodb" }] as unknown as StudioStore["open"],
  });
});

describe("usePreviews offline", () => {
  it("goes offline when the database drops under an open session", async () => {
    answer("Kind: Server selection timeout: No available servers");
    const { result } = setup();
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.cards.s1.status).toBe("offline");
  });

  it("keeps a stage error on its card", async () => {
    answer("unknown group operator '$bogus'");
    const { result } = setup();
    await waitFor(() => expect(result.current.cards.s1?.status).toBe("error"));
    expect(result.current.offline).toBe(false);
  });
});
