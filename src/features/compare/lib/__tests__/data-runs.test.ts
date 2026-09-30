import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CompareChunk,
  CompareDataRequest,
  CompareSummary,
  KeyVal,
} from "@/shared/api";

const calls: CompareDataRequest[] = [];
let answer: CompareSummary;

vi.mock("@/shared/api", async (original) => ({
  ...(await original<typeof import("@/shared/api")>()),
  cancelRun: vi.fn(),
  compareData: vi.fn(
    (req: CompareDataRequest, on_chunk: (c: CompareChunk) => void) => {
      calls.push(req);
      on_chunk({
        type: "rows",
        rows: [
          {
            kind: "left_only",
            key: [{ t: "int", v: "1" }],
            key_display: ["1"],
            left: ["a"],
          },
        ],
      });
      return Promise.resolve(answer);
    },
  ),
}));

const { start_data_diff, turn_page, useDataRun } = await import("../data-runs");

const k = (v: string): KeyVal[] => [{ t: "int", v }];
const side = { conn_id: "c", conn_key: "sqlite:x", table: "t" };
const req = {
  left: side,
  right: { ...side, table: "u" },
  key_columns: ["id"],
  columns: ["name"],
  filter: null,
};
const counts = { identical: 5, changed: 0, left_only: 120_000, right_only: 0 };
const summary = (
  next: KeyVal[] | null,
  total: number | null,
  left_only = 120_000,
): CompareSummary => ({
  status: "done",
  counts: { ...counts, left_only },
  rows_read: { left: 1, right: 1 },
  total_diffs: total,
  next_key: next,
});

describe("data diff paging", () => {
  it("counts everything once, then resumes after saved page keys", async () => {
    const { result } = renderHook(() => useDataRun("tab"));

    answer = summary(k("50000"), 120_000);
    await act(() => start_data_diff("tab", "sig", req));
    expect(calls[0]).toMatchObject({ after_key: null, count_all: true });
    expect(result.current).toMatchObject({ page: 0, total_diffs: 120_000 });

    answer = summary(k("100000"), null, 3);
    await act(() => turn_page("tab", 1));
    expect(calls[1]).toMatchObject({ after_key: k("50000"), count_all: false });
    expect(result.current).toMatchObject({
      page: 1,
      total_diffs: 120_000,
      counts: { left_only: 120_000 },
    });
    expect(result.current?.rows[0].id).toBe("50000");

    answer = summary(null, null);
    await act(() => turn_page("tab", 1));
    expect(calls[2]).toMatchObject({ after_key: k("100000") });
    expect(result.current).toMatchObject({ page: 2, next_key: null });

    await act(() => turn_page("tab", 1));
    expect(calls).toHaveLength(3);

    answer = summary(k("100000"), null);
    await act(() => turn_page("tab", -1));
    expect(calls[3]).toMatchObject({ after_key: k("50000"), count_all: false });

    answer = summary(k("50000"), null);
    await act(() => turn_page("tab", -1));
    expect(calls[4]).toMatchObject({ after_key: null, count_all: false });
    expect(result.current).toMatchObject({ page: 0, total_diffs: 120_000 });

    await act(() => turn_page("tab", -1));
    expect(calls).toHaveLength(5);
  });
});
