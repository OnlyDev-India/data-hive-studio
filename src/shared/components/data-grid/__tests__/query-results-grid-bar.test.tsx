import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useStudioStore } from "@/shared/store";
import type { QueryResult } from "@/shared/api";
import { QueryResultsGrid } from "../query-results-grid";

const result: QueryResult = {
  columns: ["n"],
  rows: [["1"], ["2"]],
  rows_affected: 0,
  is_select: true,
  error: null,
  elapsed_ms: 3,
};

function renderGrid(
  loading?: { started_at: number; on_stop?: () => void },
  shown: QueryResult = result,
) {
  return render(
    <QueryResultsGrid
      result={shown}
      conn_id="c"
      tab_key="t"
      query_text="select 1 as n"
      editable_source={null}
      on_refresh={() => {}}
      loading={loading}
    />,
  );
}

const button = (name: string) => screen.getAllByRole("button", { name })[0];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  useStudioStore.setState({
    open: [{ id: "c", name: "db", kind: "postgres" }],
  } as never);
});
afterEach(cleanup);

describe("query result action bar", () => {
  it("shows the bar on a result you cannot edit, with edits turned off", () => {
    renderGrid();
    expect(button("Refresh")).toBeEnabled();
    expect(button("Columns")).toBeEnabled();
    expect(button("Add Row")).toBeDisabled();
    expect(button("Delete Row(s)")).toBeDisabled();
  });

  it("covers only the grid with the timer and Stop while refreshing", () => {
    const on_stop = vi.fn();
    renderGrid({ started_at: performance.now(), on_stop });
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
    button("Stop").click();
    expect(on_stop).toHaveBeenCalled();
    expect(button("Refresh")).toBeDisabled();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("shows a failed run's error in place of the grid, with every button off", () => {
    renderGrid(undefined, {
      columns: [],
      rows: [],
      rows_affected: 0,
      is_select: false,
      error: 'relation "nope" does not exist',
      elapsed_ms: 0,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      'relation "nope" does not exist',
    );
    expect(button("Refresh")).toBeDisabled();
    expect(button("Columns")).toBeDisabled();
    expect(button("Add Row")).toBeDisabled();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });
});
