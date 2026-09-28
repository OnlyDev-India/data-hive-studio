import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { QueryResult } from "@/shared/api";

const tableSchema = vi.fn().mockResolvedValue({ columns: [] });
const grid = vi.fn();

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  tableSchema: (...args: unknown[]) => tableSchema(...args),
}));
vi.mock("@/shared/components/data-grid/query-results-grid", () => ({
  QueryResultsGrid: (props: { editable_source: unknown }) => {
    grid(props.editable_source);
    return null;
  },
}));

import { SqlResults } from "../editor-tab";

afterEach(cleanup);

function result(): QueryResult {
  return {
    columns: ["id"],
    rows: [["1"]],
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms: 1,
  };
}

function view(r: QueryResult) {
  return (
    <SqlResults
      result={r}
      conn_id="c1"
      tab_key="t1"
      sql='select * from "User"'
      on_refresh={vi.fn()}
    />
  );
}

describe("switching back to a result tab", () => {
  it("reuses the table lookup instead of describing the table again", async () => {
    const r = result();
    const first = render(view(r));
    await waitFor(() =>
      expect(grid).toHaveBeenLastCalledWith(
        expect.objectContaining({ table: "User" }),
      ),
    );
    first.unmount();

    grid.mockClear();
    render(view(r));

    expect(tableSchema).toHaveBeenCalledOnce();
    expect(grid).toHaveBeenLastCalledWith(
      expect.objectContaining({ table: "User" }),
    );
  });

  it("describes again for a new result from a rerun", async () => {
    tableSchema.mockClear();
    render(view(result()));
    await waitFor(() => expect(tableSchema).toHaveBeenCalledOnce());
    cleanup();
    render(view(result()));
    await waitFor(() => expect(tableSchema).toHaveBeenCalledTimes(2));
  });
});
