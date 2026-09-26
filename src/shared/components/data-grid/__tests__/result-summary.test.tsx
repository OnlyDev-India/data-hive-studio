import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QueryResult } from "@/shared/api";
import { formatElapsed, ResultSummary } from "../result-summary";

afterEach(cleanup);

function result(over: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: ["id", "name"],
    rows: [
      ["1", "a"],
      ["2", "b"],
    ],
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms: 12.4,
    ...over,
  };
}

describe("ResultSummary", () => {
  it("sums up a successful select", () => {
    render(
      <ResultSummary result={result()} query_text="SELECT * FROM users" />,
    );
    expect(screen.getByText("Query succeeded")).toBeTruthy();
    expect(screen.getByText("Returned 2 rows in 12ms")).toBeTruthy();
    expect(screen.getByText("Rows returned")).toBeTruthy();
    expect(screen.getByText("Columns")).toBeTruthy();
    expect(screen.getByText("SELECT * FROM users")).toBeTruthy();
  });

  it("says rows affected for a write and hides the column count", () => {
    render(
      <ResultSummary
        result={result({ is_select: false, rows_affected: 1, columns: [] })}
        query_text="DELETE FROM users WHERE id = 1"
      />,
    );
    expect(screen.getByText("Affected 1 row in 12ms")).toBeTruthy();
    expect(screen.queryByText("Columns")).toBeNull();
  });

  it("shows the full error with a copy button", () => {
    render(
      <ResultSummary
        result={result({ error: 'syntax error at or near "LIMIT"' })}
        query_text="SELECT * FROM"
      />,
    );
    expect(screen.getByText("Query failed")).toBeTruthy();
    expect(screen.getByText('syntax error at or near "LIMIT"')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy error" })).toBeTruthy();
  });

  it("opens the full query from the statement card", async () => {
    const on_view_query = vi.fn();
    render(
      <ResultSummary
        result={result()}
        query_text="SELECT 1"
        on_view_query={on_view_query}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "View full query" }),
    );
    expect(on_view_query).toHaveBeenCalledOnce();
  });

  it("formats time in ms under a second and seconds above", () => {
    expect(formatElapsed(0)).toBe("0ms");
    expect(formatElapsed(1250)).toBe("1.25s");
  });
});
