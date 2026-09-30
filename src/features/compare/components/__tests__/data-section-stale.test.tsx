import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

const run = {
  sig: "an older setup",
  req: {},
  run_id: "r1",
  left_conn: "c1",
  status: "done",
  stopping: false,
  columns: ["name"],
  key_columns: ["id"],
  counts: { identical: 3, changed: 1, left_only: 0, right_only: 0 },
  rows_read: { left: 4, right: 4 },
  rows: [],
  keys: [],
  total_diffs: 1,
  next_key: null,
  page: 0,
  page_starts: [null],
  error: null,
};

vi.mock("../../lib/data-runs", () => ({
  DIFF_PAGE_SIZE: 500,
  start_data_diff: vi.fn(),
  stop_data_diff: vi.fn(),
  turn_page: vi.fn(),
  useDataRun: () => run,
}));

import { cleanup, render, screen } from "@testing-library/react";
import type { ConnectionInfo, TableSchema } from "@/shared/api";
import { EMPTY_COMPARE_SETUP } from "@/shared/store";
import { DataSection } from "../data-section";

afterEach(cleanup);

const conn = { id: "c1", kind: "sqlite", name: "a" } as ConnectionInfo;
const schema = {
  columns: [
    { name: "id", data_type: "INTEGER", primary_key: true },
    { name: "name", data_type: "TEXT", primary_key: false },
  ],
} as unknown as TableSchema;
const side = { conn_id: "c1", conn_key: "sqlite:a", table: "t" };

describe("data diff after the setup changes", () => {
  it("keeps the last results and asks for a new run", () => {
    render(
      <DataSection
        tab_key="compare:c1:0"
        setup={{ ...EMPTY_COMPARE_SETUP, left: side, right: side }}
        left={schema}
        right={schema}
        left_conn={conn}
        right_conn={conn}
        active={false}
        structure_differs={false}
      />,
    );
    expect(screen.getByText("1 difference")).toBeTruthy();
    expect(screen.getByText(/The setup changed/)).toBeTruthy();
  });
});
